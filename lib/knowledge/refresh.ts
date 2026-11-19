// SERVER ONLY. Feed collection: deterministic and model-free (checked by
// tests/unit/no-model-calls.test.ts). Refreshing stores items and nothing else: it never
// creates, changes or queues dialogue. A failed refresh keeps every item already collected.
import { supabaseService } from "../supabase/server";
import { detectSource, type AdapterId } from "./adapters";
import { discoverFeeds, parseFeed, type ParsedFeed } from "./feed";
import { FetchError, fetchPublic } from "./fetch";
import { isWatchFeed, parseHn, PER_SOURCE } from "./watch";
import { parseWeather } from "./weather";

const FEED_ACCEPT = "application/rss+xml, application/atom+xml, application/rdf+xml, application/xml;q=0.9, text/xml;q=0.9, text/html;q=0.5, */*;q=0.1";

export interface FoundFeed { adapter: AdapterId; feedUrl: string; pageUrl: string; feed: ParsedFeed }
export type IdentifyResult =
  | { ok: true; found: FoundFeed }
  | { ok: false; status: "needs_authorization" | "unsupported" | "not_found"; message: string; service?: string };

/** Works out the feed behind an address (a feed itself, or a page that advertises one). */
export async function identifyFeed(input: string): Promise<IdentifyResult> {
  const d = detectSource(input);
  if (!d) return { ok: false, status: "not_found", message: "That doesn't look like a web address." };
  if (d.adapter === null) return { ok: false, status: d.status, message: d.reason, service: d.service };
  const tried = new Set<string>();
  const queue = [...d.candidates];
  let lastError = "No feed was found at that address.";
  while (queue.length && tried.size < 5) {
    const url = queue.shift()!;
    if (tried.has(url)) continue;
    tried.add(url);
    try {
      const r = await fetchPublic(url, { accept: FEED_ACCEPT });
      if (r.status === 401 || r.status === 403) { lastError = `The site refused access (${r.status}).`; continue; }
      if (r.status >= 400) { lastError = `The site answered with an error (${r.status}).`; continue; }
      const feed = parseFeed(r.body);
      if (feed) return { ok: true, found: { adapter: d.adapter, feedUrl: r.url, pageUrl: input, feed } };
      if (/html/i.test(r.contentType) || /<html[\s>]/i.test(r.body.slice(0, 2000))) {
        for (const f of discoverFeeds(r.body, r.url).slice(0, 3)) queue.push(f);
        if (!queue.length) lastError = "That page doesn't offer a feed. You can still save it as a link.";
      }
    } catch (e) {
      lastError = e instanceof FetchError ? e.message : "The site couldn't be reached.";
    }
  }
  return { ok: false, status: "not_found", message: lastError };
}

export interface RefreshOutcome { ok: boolean; skipped?: boolean; added?: number; changed?: number; unchanged?: boolean; error?: string }

/** One refresh attempt for one feed. `force` = she asked for it (ignores the schedule, not
 *  the one-minute guard). */
export async function refreshFeed(sourceId: string, force = false): Promise<RefreshOutcome> {
  const db = supabaseService();
  const { data: claimed } = await db.rpc("kb_feed_claim", { p_source: sourceId, p_force: force });
  const src = (claimed as { id: string; feed_url: string; adapter: string; http_etag: string | null; http_last_modified: string | null }[] | null)?.[0];
  if (!src) return { ok: true, skipped: true };
  const fail = async (msg: string, status: string | null = null) => {
    await db.rpc("kb_feed_fail", { p_source: sourceId, p_error: msg, p_status: status });
    return { ok: false, error: msg };
  };
  try {
    const headers: Record<string, string> = {};
    if (src.http_etag) headers["If-None-Match"] = src.http_etag;
    if (src.http_last_modified) headers["If-Modified-Since"] = src.http_last_modified;
    const isJson = src.adapter === "hn" || src.adapter === "weather";
    const watch = isWatchFeed(src.adapter, src.feed_url);
    const r = await fetchPublic(src.feed_url, { accept: isJson ? "application/json, text/plain;q=0.5" : FEED_ACCEPT, headers: isJson ? {} : headers, timeoutMs: 15_000 });
    if (r.status === 304) {
      await db.rpc("kb_feed_unchanged", { p_source: sourceId });
      return { ok: true, unchanged: true };
    }
    if (r.status === 401 || r.status === 403) return await fail(`The site refused access (${r.status}). It may now require signing in.`);
    if (r.status === 404 || r.status === 410) return await fail(`The feed is no longer at this address (${r.status}).`);
    if (r.status === 429) return await fail("The site asked us to slow down (429). Studio will try again later.");
    if (r.status >= 400) return await fail(`The site answered with an error (${r.status}).`);
    let items; let meta: Record<string, unknown> = { etag: r.etag, last_modified: r.lastModified };
    if (src.adapter === "hn" || src.adapter === "weather") {
      // Free JSON sources (discussion search, weather); read deterministically (no model).
      let city = "";
      if (src.adapter === "weather") {
        const { data: t } = await db.from("knowledge_sources").select("title").eq("id", sourceId).maybeSingle();
        city = String(t?.title ?? "").replace(/^(Stopped: )?Weather: /, "") || "The city";
      }
      const parsed = src.adapter === "hn" ? parseHn(r.body) : parseWeather(r.body, city);
      if (!Array.isArray(parsed)) return await fail(parsed.error);
      items = parsed;
    } else {
      const feed = parseFeed(r.body);
      if (!feed) return await fail("This address no longer returns a feed.");
      items = feed.items.slice(0, watch ? PER_SOURCE : 100);
      meta = { ...meta, title: feed.title, site_url: feed.site_url };
    }
    const { data, error } = await db.rpc("kb_feed_ingest", { p_source: sourceId, p_items: items, p_meta: meta });
    if (error) return await fail("The new items couldn't be saved.");
    // Watches stay small: only the newest items are kept (her kept items never trimmed).
    if (watch) await db.rpc("kb_trim_watch", { p_source: sourceId });
    const res = (data ?? {}) as { new?: number; changed?: number };
    return { ok: true, added: res.new ?? 0, changed: res.changed ?? 0 };
  } catch (e) {
    return await fail(e instanceof FetchError ? e.message : "The site couldn't be reached.");
  }
}

/** Feeds that are due, oldest first (optionally for one film). Bounded by count and time. */
export async function refreshDue(opts: { projectId?: string; limit?: number; budgetMs?: number } = {}): Promise<{ checked: number; ok: number; failed: number }> {
  const db = supabaseService();
  // Feeds of deleted films are never refreshed.
  let q = db.from("knowledge_sources").select("id, projects!inner(status)").neq("projects.status", "deleted").eq("kind", "feed").is("archived_at", null).is("disconnected_at", null)
    .eq("paused", false).lte("next_refresh_at", new Date().toISOString()).order("next_refresh_at", { ascending: true }).limit(opts.limit ?? 25);
  if (opts.projectId) q = q.eq("project_id", opts.projectId);
  const { data } = await q;
  const started = Date.now();
  let ok = 0, failed = 0, checked = 0;
  for (const row of data ?? []) {
    if (Date.now() - started > (opts.budgetMs ?? 45_000)) break;
    const r = await refreshFeed(String(row.id));
    if (r.skipped) continue;
    checked++;
    if (r.ok) ok++; else failed++;
  }
  return { checked, ok, failed };
}
