"use server";
// Knowledge Base: research, collections and updating sources. Plain data work: nothing here
// calls or imports a model (checked by tests/unit/no-model-calls.test.ts), and nothing here
// creates or changes dialogue.
import { revalidatePath } from "next/cache";
import { friendlyError } from "@/lib/errors";
import { detectSource, normalizeUrl } from "@/lib/knowledge/adapters";
import { FetchError, fetchPublic } from "@/lib/knowledge/fetch";
import { readLinkMeta } from "@/lib/knowledge/link-meta";
import { identifyFeed, refreshDue, refreshFeed } from "@/lib/knowledge/refresh";
import { buildWatchFeeds, WATCH_LIMIT } from "@/lib/knowledge/watch";
import { feedsForTopic, planWatches, type WatchTopic } from "@/lib/knowledge/plan";
import { supabaseServer } from "@/lib/supabase/server";

type R = { ok: true; id?: string; note?: string } | { ok: false; error: string };
const fail = (e: { code?: string; message?: string } | null): R => ({ ok: false, error: friendlyError(e).message });
const touch = (projectId: string) => { revalidatePath(`/projects/${projectId}/knowledge`); revalidatePath(`/projects/${projectId}/connections`); };

async function canEdit(projectId: string) {
  const sb = await supabaseServer();
  const { data } = await sb.rpc("my_project_capabilities", { p_project: projectId });
  return { sb, edit: !!data?.can_edit, review: !!data?.can_review };
}

export async function kbAddNote(input: { projectId: string; title: string; body: string; collections: string[] }): Promise<R> {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("kb_research_save", { p_project: input.projectId, p_source: null,
    p_data: { kind: "note", title: input.title, body: input.body, collections: input.collections } });
  if (error) return fail(error);
  touch(input.projectId);
  return { ok: true, id: data as string };
}

/** Saves a link with its public metadata. Only her excerpt (if any) is stored as content. */
export async function kbSaveLink(input: { projectId: string; url: string; excerpt?: string; note?: string; collections: string[] }): Promise<R> {
  const { sb, edit } = await canEdit(input.projectId);
  if (!edit) return { ok: false, error: "Your access level does not allow that." };
  const u = normalizeUrl(input.url);
  const d = detectSource(input.url);
  if (!u || !d) return { ok: false, error: "That doesn't look like a web address." };
  const url = u.toString();
  let meta = { title: null as string | null, site: null as string | null, author: null as string | null, published_at: null as string | null, description: null as string | null };
  let note = "";
  if (d.adapter !== null) {
    try {
      const r = await fetchPublic(url, { accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1", maxBytes: 1_500_000 });
      if (r.status < 400 && /html/i.test(r.contentType)) meta = readLinkMeta(r.body);
      else if (r.status >= 400) note = `The page answered ${r.status}, so only the address was saved.`;
    } catch (e) {
      note = `${e instanceof FetchError ? e.message : "The page couldn't be read."} Only the address was saved.`;
    }
  } else {
    note = d.reason;
  }
  const { data, error } = await sb.rpc("kb_research_save", { p_project: input.projectId, p_source: null, p_data: {
    kind: "link", url, title: meta.title ?? undefined, origin: meta.site ?? new URL(url).hostname.replace(/^www\./, ""),
    author: meta.author ?? undefined, published_at: meta.published_at ?? "",
    body: input.excerpt?.trim() ?? "", director_note: [input.note?.trim(), meta.description ? `Page description: ${meta.description}` : ""].filter(Boolean).join("\n\n"),
    collections: input.collections,
  } });
  if (error) return fail(error);
  touch(input.projectId);
  return { ok: true, id: data as string, note: note || undefined };
}

export async function kbUpdateResearch(input: { projectId: string; sourceId: string; data: Record<string, unknown> }): Promise<R> {
  const sb = await supabaseServer();
  const { error } = await sb.rpc("kb_research_save", { p_project: input.projectId, p_source: input.sourceId, p_data: input.data });
  if (error) return fail(error);
  touch(input.projectId);
  return { ok: true };
}

export async function kbAnnotateItem(input: { projectId: string; itemId: string; data: Record<string, unknown> }): Promise<R> {
  const sb = await supabaseServer();
  const { error } = await sb.rpc("kb_item_annotate", { p_project: input.projectId, p_item: input.itemId, p_data: input.data });
  if (error) return fail(error);
  touch(input.projectId);
  return { ok: true };
}

export async function kbArchive(input: { projectId: string; sourceId: string }): Promise<R> {
  const sb = await supabaseServer();
  const { error } = await sb.rpc("kb_source_archive", { p_project: input.projectId, p_source: input.sourceId });
  if (error) return fail(error);
  touch(input.projectId);
  return { ok: true };
}

export async function kbImportReference(input: { projectId: string; referenceId: string; collections: string[] }): Promise<R> {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("kb_research_save", { p_project: input.projectId, p_source: null,
    p_data: { kind: "reference", reference_id: input.referenceId, collections: input.collections } });
  if (error) return fail(error);
  touch(input.projectId);
  return { ok: true, id: data as string };
}

export async function kbDocumentOwner(input: { projectId: string }): Promise<R> {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("kb_owner_entity", { p_project: input.projectId });
  return error ? fail(error) : { ok: true, id: data as string };
}

export async function kbSaveDocument(input: { projectId: string; assetId: string; title: string; text: string; collections: string[] }): Promise<R> {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("kb_research_save", { p_project: input.projectId, p_source: null,
    p_data: { kind: "document", asset_id: input.assetId, title: input.title, body: input.text.slice(0, 40000), collections: input.collections } });
  if (error) return fail(error);
  touch(input.projectId);
  return { ok: true, id: data as string, note: input.text.length > 40000 ? "Only the first 40,000 characters of text were imported." : undefined };
}

// ---- Updating sources ------------------------------------------------------------------------
export type FeedPreview =
  | { ok: true; adapter: string; feedUrl: string; pageUrl: string; title: string; count: number; dated: number; samples: { title: string; date: string | null }[] }
  | { ok: false; status: string; error: string; service?: string };

/** Looks before connecting: is there a readable feed here, and what's in it? */
export async function kbPreviewFeed(input: { projectId: string; url: string }): Promise<FeedPreview> {
  const { edit } = await canEdit(input.projectId);
  if (!edit) return { ok: false, status: "error", error: "Your access level does not allow that." };
  const r = await identifyFeed(input.url);
  if (!r.ok) return { ok: false, status: r.status, error: r.message, service: r.service };
  const f = r.found;
  return {
    ok: true, adapter: f.adapter, feedUrl: f.feedUrl, pageUrl: f.pageUrl, title: f.feed.title || new URL(f.feedUrl).hostname,
    count: f.feed.items.length, dated: f.feed.items.filter((i) => i.published_at).length,
    samples: f.feed.items.slice(0, 4).map((i) => ({ title: i.title, date: i.published_at })),
  };
}

export async function kbAddFeed(input: { projectId: string; feedUrl: string; pageUrl: string; adapter: string; title: string; refreshHours: number; collections: string[] }): Promise<R> {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("kb_feed_add", { p_project: input.projectId, p_data: {
    feed_url: input.feedUrl, url: /^https?:\/\//.test(input.pageUrl) ? input.pageUrl : undefined, adapter: input.adapter,
    title: input.title, refresh_hours: input.refreshHours, collections: input.collections,
  } });
  if (error) return fail(error);
  const id = data as string;
  const first = await refreshFeed(id, true);
  touch(input.projectId);
  return { ok: true, id, note: first.ok ? `Connected: ${first.added ?? 0} items collected.` : `Saved, but the first refresh failed: ${first.error}` };
}

export async function kbFeedUpdate(input: { projectId: string; sourceId: string; data: Record<string, unknown> }): Promise<R> {
  const sb = await supabaseServer();
  const { error } = await sb.rpc("kb_feed_update", { p_project: input.projectId, p_source: input.sourceId, p_data: input.data });
  if (error) return fail(error);
  touch(input.projectId);
  return { ok: true };
}

export async function kbRefreshNow(input: { projectId: string; sourceId: string }): Promise<R> {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("kb_feed_request_refresh", { p_project: input.projectId, p_source: input.sourceId });
  if (error) return fail(error);
  if (!data) return { ok: true, note: "It was just checked. Try again in a minute." };
  const r = await refreshFeed(input.sourceId, true);
  touch(input.projectId);
  if (!r.ok) return { ok: false, error: `Refresh failed: ${r.error} Everything collected before is still here.` };
  return { ok: true, note: r.unchanged ? "No changes since the last check." : `${r.added ?? 0} new, ${r.changed ?? 0} updated.` };
}

/** When the Knowledge Base is opened: refresh this film's feeds that are due (bounded). */
export async function kbRefreshDueOnOpen(input: { projectId: string }): Promise<{ checked: number }> {
  const { review } = await canEdit(input.projectId);
  if (!review) return { checked: 0 };
  const r = await refreshDue({ projectId: input.projectId, limit: 4, budgetMs: 20_000 });
  if (r.checked) touch(input.projectId);
  return { checked: r.checked };
}

// ---- Collections -----------------------------------------------------------------------------
export async function kbCollectionSave(input: { projectId: string; collectionId: string | null; name: string; description: string }): Promise<R> {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("kb_collection_save", { p_project: input.projectId, p_collection: input.collectionId, p_name: input.name, p_description: input.description });
  if (error) return fail(error);
  touch(input.projectId);
  return { ok: true, id: data as string };
}

export async function kbCollectionArchive(input: { projectId: string; collectionId: string }): Promise<R> {
  const sb = await supabaseServer();
  const { error } = await sb.rpc("kb_collection_archive", { p_project: input.projectId, p_collection: input.collectionId });
  if (error) return fail(error);
  touch(input.projectId);
  return { ok: true };
}

export async function kbCollectionMember(input: { projectId: string; collectionId: string; sourceId?: string; itemId?: string; on: boolean }): Promise<R> {
  const sb = await supabaseServer();
  const { error } = await sb.rpc("kb_collection_member", { p_project: input.projectId, p_collection: input.collectionId,
    p_source: input.sourceId ?? null, p_item: input.itemId ?? null, p_on: input.on });
  if (error) return fail(error);
  touch(input.projectId);
  return { ok: true };
}

/** A character's own knowledge collection (made and connected to them on first use). */
export async function kbCharacterCollection(input: { projectId: string; characterId: string }): Promise<R> {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("kb_character_collection", { p_project: input.projectId, p_character: input.characterId });
  if (error) return fail(error);
  touch(input.projectId);
  return { ok: true, id: data as string };
}

// ---- World (free; no model) ----------------------------------------------------------------
export async function worldSetUp(input: { projectId: string; connectAll: boolean }): Promise<R> {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("kb_world_collection", { p_project: input.projectId, p_connect_all: input.connectAll });
  if (error) return fail(error);
  const row = (data as { collection_id: string; connected: number }[])[0];
  touch(input.projectId);
  return { ok: true, id: row.collection_id, note: row.connected ? `Connected to ${row.connected} character${row.connected === 1 ? "" : "s"}.` : undefined };
}

/** Follow something in the world with free sources; checked once a day. */
export async function kbWorldWatchAdd(input: { projectId: string; query: string; news: boolean; reactions: boolean }): Promise<R> {
  const feeds = buildWatchFeeds(input.query, { news: input.news, reactions: input.reactions });
  if (!feeds.length) return { ok: false, error: input.news || input.reactions ? "Type a few words to follow." : "Choose news, reactions or both." };
  const sb = await supabaseServer();
  const { error } = await sb.rpc("kb_world_watch_add", { p_project: input.projectId, p_query: input.query.trim(), p_feeds: feeds });
  if (error) return fail(error);
  const { data: rows } = await sb.from("knowledge_sources").select("id").eq("project_id", input.projectId).eq("watch_query", input.query.trim()).is("archived_at", null);
  // The two free sources are different sites, so they're checked side by side.
  const outs = await Promise.all((rows ?? []).map((r) => refreshFeed(String(r.id), true)));
  const found = outs.reduce((n, o) => n + (o.ok ? o.added ?? 0 : 0), 0);
  const problem = outs.find((o) => !o.ok && o.error)?.error;
  touch(input.projectId);
  return { ok: true, note: `Following. ${found} item${found === 1 ? "" : "s"} found.${problem ? ` One source didn't answer yet: ${problem}` : ""} Checked again once a day.` };
}

export async function kbWorldWatchRemove(input: { projectId: string; query: string }): Promise<R> {
  const sb = await supabaseServer();
  const { error } = await sb.rpc("kb_world_watch_remove", { p_project: input.projectId, p_query: input.query });
  if (error) return fail(error);
  touch(input.projectId);
  return { ok: true, note: "Stopped following. Items you kept are still in World." };
}

export async function kbItemPin(input: { projectId: string; itemId: string; pinned: boolean }): Promise<R> {
  const sb = await supabaseServer();
  const { error } = await sb.rpc("kb_item_pin", { p_project: input.projectId, p_item: input.itemId, p_pinned: input.pinned });
  if (error) return fail(error);
  touch(input.projectId);
  return { ok: true, note: input.pinned ? "Kept: it won't be trimmed." : "No longer kept." };
}

export async function decideImpression(input: { projectId: string; impressionId: string; accept: boolean; text?: string }): Promise<R> {
  const sb = await supabaseServer();
  const { error } = await sb.rpc("impression_decide", { p_project: input.projectId, p_impression: input.impressionId, p_accept: input.accept, p_text: input.text ?? null });
  if (error) return fail(error);
  touch(input.projectId);
  return { ok: true, note: input.accept ? "Accepted. It will color this character's dialogue." : "Dismissed." };
}

/** What she typed → topics to follow (no AI): shown to her to confirm. "The cities in the
 *  story" means the real places she set in World & Time. */
export async function kbWorldPlan(input: { projectId: string; prompt: string }): Promise<{ ok: true; topics: WatchTopic[]; free: number; cities: string[] } | { ok: false; error: string }> {
  const sb = await supabaseServer();
  const [{ data: w }, { data: srcs }] = await Promise.all([
    sb.from("story_world").select("data").eq("project_id", input.projectId).maybeSingle(),
    sb.from("knowledge_sources").select("watch_query").eq("project_id", input.projectId).is("archived_at", null).not("watch_query", "is", null),
  ]);
  const places = ((w?.data as { confirmed?: { where?: { value?: { places?: { name: string; kind: string }[] } } } } | null)?.confirmed?.where?.value?.places ?? []);
  const cities = places.filter((p) => p.kind !== "invented" && p.name?.trim()).map((p) => p.name.trim());
  const used = new Set(((srcs ?? []) as { watch_query: string }[]).map((r) => r.watch_query.toLowerCase())).size;
  const topics = planWatches(input.prompt, cities);
  if (!topics.length) return { ok: false, error: /cit(y|ies)|places/i.test(input.prompt) && !cities.length
    ? "Your story has no real cities in World & Time yet. Add them there, or type the city names."
    : "Type a few topics, separated by commas (for example: AI, semiconductors, the economy)." };
  return { ok: true, topics, free: Math.max(0, WATCH_LIMIT - used), cities };
}

/** Follow the topics she confirmed. Each topic is its own watch (free; checked once a day). */
export async function kbWorldFollow(input: { projectId: string; topics: (WatchTopic & { useNews: boolean; useReactions: boolean })[] }): Promise<R> {
  const sb = await supabaseServer();
  const safeNews = (q: string | null) => (q && /^[\p{L}\p{N}\s"'()\-]{1,300}$/u.test(q) ? q : null);
  const added: string[] = []; const problems: string[] = [];
  for (const t of input.topics.slice(0, WATCH_LIMIT)) {
    const topic: WatchTopic = { label: t.label.slice(0, 200), news: safeNews(t.news), reactions: t.reactions ? t.reactions.replace(/[^\p{L}\p{N}\s"'-]/gu, " ").trim().slice(0, 200) || null : null };
    const feeds = feedsForTopic(topic, { news: t.useNews, reactions: t.useReactions });
    if (!feeds.length) continue;
    const { error } = await sb.rpc("kb_world_watch_add", { p_project: input.projectId, p_query: topic.label, p_feeds: feeds });
    if (error) { problems.push(`${topic.label}: ${friendlyError(error).message}`); if (error.message.includes("up to 10")) break; continue; }
    added.push(topic.label);
  }
  if (!added.length) return { ok: false, error: problems[0] ?? "Nothing to follow." };
  const { data: rows } = await sb.from("knowledge_sources").select("id, watch_query").eq("project_id", input.projectId).in("watch_query", added).is("archived_at", null);
  const outs = await Promise.all(((rows ?? []) as { id: string; watch_query: string }[]).map(async (r) => ({ q: r.watch_query, o: await refreshFeed(String(r.id), true) })));
  const found = new Map<string, number>();
  for (const { q, o } of outs) found.set(q, (found.get(q) ?? 0) + (o.ok ? o.added ?? 0 : 0));
  const empty = added.filter((q) => !found.get(q));
  const total = [...found.values()].reduce((a, b) => a + b, 0);
  touch(input.projectId);
  return { ok: true, note: `Following ${added.length} topic${added.length === 1 ? "" : "s"}: ${total} items found.`
    + (empty.length ? ` Nothing matched this week for ${empty.map((q) => `"${q}"`).join(", ")}; it will look again tomorrow, or stop it and try other words.` : "")
    + (problems.length ? ` Not added: ${problems.join("; ")}.` : "") + " Checked again once a day." };
}
