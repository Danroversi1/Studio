// SERVER ONLY. Characters' daily media bubbles: one shared refresh per film (manual or
// scheduled), then a code-only selection per character. Model-free (checked by
// tests/unit/no-model-calls.test.ts) and dialogue-free: it stores coverage snapshots and run
// records and nothing else — no events, feelings, knowledge, story time or dialogue.
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseService } from "../supabase/server";
import { refreshFeed, type FetchCache } from "../knowledge/refresh";
import { roleOf } from "../characters/roles";
import { DEFAULT_ATTENTION, eligible, selectFor, summarize, type BubbleProfile, type CandidateItem } from "./select";

type Db = SupabaseClient;
export interface SourceResult { ok: boolean; added: number; error: string | null; stale: boolean; title: string }
export interface BubbleRunResult { ok: boolean; skipped?: boolean; error?: string; runId?: string; selected?: number; sources?: Record<string, SourceResult> }

const WINDOW_HOURS = 48;   // new coverage is what was collected in the last two days
const SEEN_DAYS = 14;      // what's already been offered isn't offered again (unless updated)

/** The sources a film's bubbles draw on: its World watches plus feeds given to characters. */
async function bubbleSources(db: Db, projectId: string) {
  const [{ data: watches }, { data: links }] = await Promise.all([
    db.from("knowledge_sources").select("id, title, status, last_attempt_at, last_success_at, last_error, paused, next_refresh_at")
      .eq("project_id", projectId).eq("kind", "feed").is("archived_at", null).is("disconnected_at", null).not("watch_query", "is", null),
    db.from("character_knowledge").select("character_id, collection_id").eq("project_id", projectId).is("archived_at", null).neq("purpose", "director_only"),
  ]);
  const colIds = [...new Set(((links ?? []) as { collection_id: string }[]).map((l) => l.collection_id))];
  const { data: mem } = colIds.length ? await db.from("knowledge_collection_members").select("collection_id, source_id").in("collection_id", colIds).not("source_id", "is", null) : { data: [] };
  const linkedIds = [...new Set(((mem ?? []) as { source_id: string }[]).map((m) => m.source_id))];
  const { data: linked } = linkedIds.length ? await db.from("knowledge_sources").select("id, title, status, last_attempt_at, last_success_at, last_error, paused, next_refresh_at")
    .in("id", linkedIds).eq("kind", "feed").is("archived_at", null).is("disconnected_at", null) : { data: [] };
  type Src = { id: string; title: string; status: string; last_attempt_at: string | null; last_success_at: string | null; last_error: string | null; paused: boolean; next_refresh_at: string | null };
  const all = new Map<string, Src>();
  for (const s of [...((watches ?? []) as Src[]), ...((linked ?? []) as Src[])]) all.set(s.id, s);
  const charSources = new Map<string, Set<string>>();
  for (const l of (links ?? []) as { character_id: string; collection_id: string }[]) {
    for (const m of (mem ?? []) as { collection_id: string; source_id: string }[]) {
      if (m.collection_id !== l.collection_id) continue;
      if (!charSources.has(l.character_id)) charSources.set(l.character_id, new Set());
      charSources.get(l.character_id)!.add(m.source_id);
    }
  }
  const worldIds = new Set(((watches ?? []) as Src[]).map((s) => s.id));
  return { sources: [...all.values()], worldIds, charSources };
}

async function pool<T, R>(xs: T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, xs.length) }, async () => { while (i < xs.length) { const k = i++; out[k] = await f(xs[k]); } }));
  return out;
}

/**
 * One refresh for one film. Manual: `userClient` is the Director's client (her permission is
 * checked by the database). Scheduled: service role; a paused film records a skip and stops.
 * Manual and scheduled share one lock, so they can't run together.
 */
export async function refreshBubbles(input: { projectId: string; trigger: "manual" | "scheduled"; userClient?: Db; cache?: FetchCache; budgetMs?: number }): Promise<BubbleRunResult> {
  const db = supabaseService();
  const started = Date.now();
  const open = input.trigger === "manual"
    ? await (input.userClient ?? db).rpc("bubble_refresh_start", { p_project: input.projectId })
    : await db.rpc("bubble_refresh_start_scheduled", { p_project: input.projectId });
  if (open.error) return { ok: false, error: open.error.code === "PT409" ? "A refresh is already running." : open.error.message };
  const runId = open.data as string | null;
  if (!runId) return { ok: true, skipped: true };
  const finish = (status: string, sources: Record<string, SourceResult>, selected: number, note: string | null, error: string | null) =>
    db.rpc("bubble_run_finish", { p_run: runId, p_status: status, p_sources: sources, p_selected: selected, p_note: note, p_error: error });
  try {
    // 1. Shared fetch: each source once (and each address once across films in a cron run).
    const { sources, worldIds, charSources } = await bubbleSources(db, input.projectId);
    const cache = input.cache ?? new Map();
    const results: Record<string, SourceResult> = {};
    await pool(sources.filter((s) => !s.paused), 4, async (s) => {
      if (Date.now() - started > (input.budgetMs ?? 40_000)) { results[s.id] = { ok: false, added: 0, error: "Not reached this time.", stale: true, title: s.title }; return; }
      const r = await refreshFeed(s.id, input.trigger === "manual", cache);
      results[s.id] = r.skipped
        ? { ok: s.status !== "error", added: 0, error: s.status === "error" ? s.last_error : null, stale: s.status === "error", title: s.title }
        : { ok: r.ok, added: (r.added ?? 0) + (r.changed ?? 0), error: r.ok ? null : (r.error ?? "Failed."), stale: !r.ok, title: s.title };
    });

    // 2. Selection per eligible character — from what's stored, so a failed source still
    //    contributes its earlier items, and other sources aren't held up by it.
    const { data: ents } = await db.from("entities").select("id, name, metadata").eq("project_id", input.projectId).eq("kind", "character").is("archived_at", null).neq("status", "archived");
    const chars = ((ents ?? []) as { id: string; name: string; metadata: Record<string, unknown> | null }[]).filter((c) => eligible(roleOf(c.metadata)));
    const { data: bub } = chars.length ? await db.from("character_bubbles").select("character_id, topics, avoid, attention, active").in("character_id", chars.map((c) => c.id)) : { data: [] };
    const prof = new Map(((bub ?? []) as { character_id: string; topics: string[]; avoid: string[]; attention: number; active: boolean }[]).map((b) => [b.character_id, b]));
    const active = chars.filter((c) => prof.get(c.id)?.active !== false);
    const srcIds = sources.map((s) => s.id);
    const since = new Date(Date.now() - WINDOW_HOURS * 3600_000).toISOString();
    const { data: rows } = srcIds.length ? await db.from("knowledge_items").select("id, version, title, url, content, published_at, retrieved_at, updated_at, source_id")
      .in("source_id", srcIds).is("archived_at", null).or(`retrieved_at.gte.${since},updated_at.gte.${since}`).order("retrieved_at", { ascending: false }).limit(300) : { data: [] };
    const title = new Map(sources.map((s) => [s.id, s.title.replace(/^(Stopped: )?/, "")]));
    const items: CandidateItem[] = ((rows ?? []) as unknown as (Omit<CandidateItem, "source" | "content"> & { content: string | null })[]).map((r) => ({ ...r, content: r.content ?? "", source: title.get(r.source_id) ?? "A source" }));
    const seenSince = new Date(Date.now() - SEEN_DAYS * 86400_000).toISOString().slice(0, 10);
    const { data: prior } = active.length ? await db.from("bubble_snapshots").select("character_id, items").in("character_id", active.map((c) => c.id)).gte("run_date", seenSince) : { data: [] };
    let selected = 0;
    for (const c of active) {
      const p = prof.get(c.id);
      const profile: BubbleProfile = { topics: p?.topics ?? [], avoid: p?.avoid ?? [], attention: p?.attention ?? DEFAULT_ATTENTION };
      const mine = charSources.get(c.id) ?? new Set<string>();
      const pool_ = items.filter((i) => worldIds.has(i.source_id) || mine.has(i.source_id));
      const seen = new Map<string, number>();
      for (const s of ((prior ?? []) as { character_id: string; items: { item_id: string; version: number }[] }[]).filter((s) => s.character_id === c.id)) {
        for (const e of s.items) seen.set(e.item_id, Math.max(seen.get(e.item_id) ?? 0, e.version ?? 1));
      }
      const entries = selectFor(pool_, profile, seen);
      const put = await db.rpc("bubble_snapshot_put", { p_run: runId, p_character: c.id, p_items: entries, p_summary: summarize(c.name, entries, profile), p_profile: profile });
      if (put.error) throw new Error(put.error.message);
      selected += Number(put.data ?? 0);
    }
    const failed = Object.values(results).filter((r) => !r.ok).length;
    const status = failed && failed === Object.keys(results).length ? "failed" : failed ? "partial" : "succeeded";
    const note = !sources.length ? "No World watches yet — add some in World & Time." : !chars.length ? "No protagonist, antagonist or supporting characters yet." : null;
    await finish(status === "failed" && active.length ? "partial" : status, results, selected, note, failed ? `${failed} source${failed === 1 ? "" : "s"} couldn't be refreshed; earlier material kept.` : null);
    return { ok: true, runId, selected, sources: results };
  } catch (e) {
    await finish("failed", {}, 0, null, e instanceof Error ? e.message.slice(0, 400) : "The refresh failed.");
    return { ok: false, runId, error: "The refresh failed. Earlier coverage is kept." };
  }
}

/** Films the daily job refreshes: not deleted, not paused, with at least one main character. */
export async function scheduledBubbleFilms(limit = 12): Promise<string[]> {
  const db = supabaseService();
  const { data } = await db.from("entities").select("project_id, metadata, projects!inner(status)").eq("kind", "character").neq("projects.status", "deleted")
    .in("metadata->>cast_role", ["protagonist", "antagonist", "supporting"]).limit(500);
  const ids = [...new Set(((data ?? []) as { project_id: string }[]).map((r) => r.project_id))];
  if (!ids.length) return [];
  const { data: paused } = await db.from("bubble_settings").select("project_id").in("project_id", ids).eq("paused", true);
  const p = new Set(((paused ?? []) as { project_id: string }[]).map((r) => r.project_id));
  // Paused films still get a "skipped" record (so the Director sees the day was skipped).
  return [...ids.filter((i) => !p.has(i)), ...ids.filter((i) => p.has(i))].slice(0, limit);
}
