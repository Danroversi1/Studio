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
