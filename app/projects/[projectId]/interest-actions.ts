"use server";
// What each main character is into. She can prompt it ("Johnny reads about…"), draw it from a
// link or a document, or add it by hand. Suggestions are only suggestions; each interest she
// keeps becomes a free daily news search that belongs to that character. Links that are feeds
// can be followed by the character.
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { aiConfigured } from "@/lib/ai/configured";
import { friendlyError } from "@/lib/errors";
import { supabaseServer } from "@/lib/supabase/server";
import { fetchPublic, FetchError } from "@/lib/knowledge/fetch";
import { toPlainText } from "@/lib/knowledge/feed";
import { readLinkMeta } from "@/lib/knowledge/link-meta";
import { identifyFeed, refreshFeed } from "@/lib/knowledge/refresh";
import { feedsForTopic } from "@/lib/knowledge/plan";
import { cleanLabel, suggestInterests, type InterestSuggestions } from "@/lib/bubbles/interests";

type Fail = { ok: false; error: string };
const fail = (e: { code?: string; message?: string } | null): Fail => ({ ok: false, error: friendlyError(e).message });
const touch = (projectId: string, characterId: string) => revalidatePath(`/projects/${projectId}/items/${characterId}`);

export type SuggestResult = { ok: true; suggestions: InterestSuggestions; feed: { title: string; feedUrl: string; pageUrl: string } | null; note?: string } | Fail;

/** Suggest interests from what she typed, a link, or a document's text. */
export async function interestsSuggest(input: { projectId: string; characterId: string; name: string; text?: string; url?: string; from: "prompt" | "link" | "document" }): Promise<SuggestResult> {
  const sb = await supabaseServer();
  let uid = "";
  if (aiConfigured()) {
    const { data, error } = await sb.rpc("interests_ai_check", { p_project: input.projectId, p_character: input.characterId });
    if (error) return fail(error);
    uid = String(data);
  } else {
    const { data } = await sb.from("entities").select("id").eq("id", input.characterId).eq("project_id", input.projectId).eq("kind", "character").maybeSingle();
    if (!data) return { ok: false, error: "Character not found." };
  }
  let text = (input.text ?? "").slice(0, 60_000);
  let feed: { title: string; feedUrl: string; pageUrl: string } | null = null;
  if (input.from === "link") {
    const url = (input.url ?? "").trim();
    if (!/^https?:\/\//i.test(url)) return { ok: false, error: "Paste a full web address (https://…)." };
    const found = await identifyFeed(url).catch(() => null);
    if (found?.ok) feed = { title: found.found.feed.title || url, feedUrl: found.found.feedUrl, pageUrl: url };
    try {
      const r = await fetchPublic(url, { accept: "text/html, text/plain;q=0.9, */*;q=0.5", timeoutMs: 15_000 });
      if (r.status >= 400) throw new FetchError(`The site answered with an error (${r.status}).`, r.status, "http");
      const m = readLinkMeta(r.body);
      text = [m.title, m.description, toPlainText(r.body, 12_000)].filter(Boolean).join("\n");
    } catch (e) {
      if (!feed) return { ok: false, error: e instanceof FetchError ? e.message : "That page couldn't be read." };
      text = [feed.title, ...(found?.ok ? found.found.feed.items.slice(0, 20).map((i) => i.title) : [])].join("\n");
    }
  }
  if (text.trim().length < 3) return { ok: false, error: "There's nothing to read there." };
  const suggestions = await suggestInterests({ projectId: input.projectId, uid, character: input.name, text, from: input.from });
  return { ok: true, suggestions, feed, note: suggestions.via === "simple" ? "Read without AI (split into topics)." : undefined };
}

/** Keep interests: each one becomes their own daily news search (and a topic of their coverage). */
export async function interestsAdd(input: { projectId: string; characterId: string; interests: string[]; avoid?: string[] }): Promise<{ ok: true; note: string } | Fail> {
  const sb = await supabaseServer();
  const added: string[] = [], skipped: string[] = [];
  for (const raw of input.interests.slice(0, 12)) {
    const label = cleanLabel(raw);
    if (label.length < 2) continue;
    const feeds = feedsForTopic({ label, news: label, reactions: null }, { news: true, reactions: false });
    const { error } = await sb.rpc("kb_character_watch_add", { p_project: input.projectId, p_character: input.characterId, p_query: label, p_feeds: feeds });
    if (error) { if (error.code === "23505") { skipped.push(label); continue; } return fail(error); }
    added.push(label);
  }
  if (input.avoid?.length) {
    const r = await mergeProfile(input.projectId, input.characterId, { addAvoid: input.avoid });
    if (!r.ok) return r;
  }
  if (added.length) {
    // Load them now (in the background) so the first items arrive without waiting for the morning.
    after(async () => {
      const { data } = await sb.from("knowledge_sources").select("id").eq("watch_character", input.characterId).in("watch_query", added).is("archived_at", null);
      await Promise.all(((data ?? []) as { id: string }[]).map((s) => refreshFeed(s.id, true).catch(() => null)));
      touch(input.projectId, input.characterId);
    });
  }
  touch(input.projectId, input.characterId);
  return { ok: true, note: `${added.length ? `Following ${added.join(", ")}. Loading now; they'll show in the next refresh.` : "Nothing new to follow."}${skipped.length ? ` Already following ${skipped.join(", ")}.` : ""}` };
}

export async function interestRemove(input: { projectId: string; characterId: string; label: string }): Promise<{ ok: true } | Fail> {
  const sb = await supabaseServer();
  const { error } = await sb.rpc("kb_character_watch_remove", { p_project: input.projectId, p_character: input.characterId, p_query: input.label });
  if (error) return fail(error);
  touch(input.projectId, input.characterId);
  return { ok: true };
}

async function mergeProfile(projectId: string, characterId: string, ch: { addAvoid?: string[]; removeAvoid?: string; attention?: number }): Promise<{ ok: true } | Fail> {
  const sb = await supabaseServer();
  const { data: b } = await sb.from("character_bubbles").select("topics, avoid, attention").eq("character_id", characterId).maybeSingle();
  let avoid = ((b?.avoid ?? []) as string[]);
  if (ch.addAvoid) avoid = [...new Set([...avoid, ...ch.addAvoid.map(cleanLabel).filter((a) => a.length >= 2)])].slice(0, 12);
  if (ch.removeAvoid) avoid = avoid.filter((a) => a.toLowerCase() !== ch.removeAvoid!.toLowerCase());
  const { error } = await sb.rpc("bubble_profile_save", { p_project: projectId, p_character: characterId, p_topics: (b?.topics ?? []) as string[], p_avoid: avoid, p_attention: ch.attention ?? b?.attention ?? 5 });
  return error ? fail(error) : { ok: true };
}

export async function avoidAdd(input: { projectId: string; characterId: string; label: string }) {
  const r = await mergeProfile(input.projectId, input.characterId, { addAvoid: [input.label] });
  if (r.ok) touch(input.projectId, input.characterId);
  return r;
}
export async function avoidRemove(input: { projectId: string; characterId: string; label: string }) {
  const r = await mergeProfile(input.projectId, input.characterId, { removeAvoid: input.label });
  if (r.ok) touch(input.projectId, input.characterId);
  return r;
}
export async function attentionSet(input: { projectId: string; characterId: string; attention: number }) {
  const r = await mergeProfile(input.projectId, input.characterId, { attention: Math.round(input.attention) });
  if (r.ok) touch(input.projectId, input.characterId);
  return r;
}

/** The character follows a feed (a blog, a channel, a news site) found at a link. */
export async function followFeed(input: { projectId: string; characterId: string; feedUrl: string; pageUrl: string; title: string }): Promise<{ ok: true; note: string } | Fail> {
  const sb = await supabaseServer();
  const { data: coll, error: e1 } = await sb.rpc("kb_character_collection", { p_project: input.projectId, p_character: input.characterId });
  if (e1) return fail(e1);
  const { data: id, error } = await sb.rpc("kb_feed_add", { p_project: input.projectId, p_data: {
    adapter: "rss", feed_url: input.feedUrl, url: input.pageUrl, title: input.title.slice(0, 300), refresh_hours: 24, origin: "Followed by a character", collections: [coll],
  } });
  if (error) return fail(error);
  after(async () => { await refreshFeed(String(id), true).catch(() => null); touch(input.projectId, input.characterId); });
  touch(input.projectId, input.characterId);
  return { ok: true, note: `Following ${input.title}. Its newest posts load now.` };
}

export async function unfollowFeed(input: { projectId: string; characterId: string; sourceId: string }): Promise<{ ok: true } | Fail> {
  const sb = await supabaseServer();
  const { error } = await sb.rpc("kb_source_archive", { p_project: input.projectId, p_source: input.sourceId });
  if (error) return fail(error);
  touch(input.projectId, input.characterId);
  return { ok: true };
}
