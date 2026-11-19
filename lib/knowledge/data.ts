// SERVER ONLY. Reads for the Knowledge Base and the desks that use it (RLS applies: only
// members of this film see its research).
import { supabaseServer } from "../supabase/server";

import { thumbOf } from "../thumb";
import type { KCharacter, KCollection, KItem, KMember, KSource } from "./types";
export type { KCharacter, KCollection, KItem, KMember, KSource } from "./types";
export { collectionsOf } from "./types";

const SOURCE_COLS = "id, kind, adapter, status, title, url, feed_url, origin, asset_id, reference_id, director_note, paused, disconnected_at, refresh_hours, next_refresh_at, last_attempt_at, last_success_at, last_error, failures, created_at, updated_at";
const ITEM_COLS = "id, source_id, title, url, author, published_at, retrieved_at, content, content_status, version, director_note, verification, verification_note, updated_at";

export async function getKnowledge(projectId: string) {
  const sb = await supabaseServer();
  const [sources, items, collections, members, refs, links] = await Promise.all([
    sb.from("knowledge_sources").select(SOURCE_COLS).eq("project_id", projectId).is("archived_at", null).order("created_at", { ascending: false }),
    sb.from("knowledge_items").select(ITEM_COLS).eq("project_id", projectId).is("archived_at", null)
      .order("published_at", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }).limit(600),
    sb.from("knowledge_collections").select("id, name, description, character_id").eq("project_id", projectId).is("archived_at", null).order("name"),
    sb.from("knowledge_collection_members").select("collection_id, source_id, item_id").eq("project_id", projectId),
    sb.from("research_references").select("id, title, source_url, source_domain, created_at").eq("project_id", projectId).order("created_at", { ascending: false }).limit(200),
    sb.from("character_knowledge").select("collection_id, character_id, purpose, temporal").eq("project_id", projectId).is("archived_at", null),
  ]);
  const { data: chars } = await sb.from("entities").select("id, name, metadata").eq("project_id", projectId).eq("kind", "character").is("archived_at", null).order("name");
  const linkRows = (links.data ?? []) as { collection_id: string; character_id: string; purpose: string; temporal: string }[];
  const characters: KCharacter[] = ((chars ?? []) as { id: string; name: string; metadata: Record<string, unknown> | null }[]).map((c) => ({
    id: c.id, name: c.name, thumb: thumbOf(c.metadata),
    links: linkRows.filter((l) => l.character_id === c.id).map((l) => ({ collection_id: l.collection_id, purpose: l.purpose, temporal: l.temporal })),
  }));
  const src = (sources.data ?? []) as KSource[];
  const live = new Set(src.map((s) => s.id));
  const imported = new Set(src.map((s) => s.reference_id).filter(Boolean));
  return {
    sources: src,
    items: ((items.data ?? []) as KItem[]).filter((i) => live.has(i.source_id)),
    collections: (collections.data ?? []) as KCollection[],
    members: (members.data ?? []) as KMember[],
    references: (refs.data ?? []).filter((r) => !imported.has(r.id)) as { id: string; title: string | null; source_url: string | null; source_domain: string | null }[],
    characters,
    usedByCharacters: linkRows.reduce<Record<string, number>>((m, l) => ({ ...m, [l.collection_id]: (m[l.collection_id] ?? 0) + 1 }), {}),
  };
}

