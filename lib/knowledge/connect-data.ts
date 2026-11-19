// SERVER ONLY. What the Connections desk and the dialogue process need to know about
// knowledge → character connections, scene time and the outline. No model.
import { byRole, roleOf } from "@/lib/characters/roles";
import { splitScenes } from "../dialogue/scenes";
import { PARTS } from "../scene-plan";
import { sortByOrder } from "../notebook-order";
import { supabaseServer } from "../supabase/server";
import { eligibility, type LinkRule, type Purpose, type Temporal, type Use } from "./eligibility";

export interface KnowledgeLink {
  id: string; character_id: string; collection_id: string; purpose: Purpose; temporal: Temporal;
  scope_terms: string[]; from_beat: string | null; note: string | null; updated_at: string;
}
export interface SceneContext {
  scene_key: string; beat_id: string | null; story_date: string | null; story_date_note: string | null;
  objectives: Record<string, string>; runtime_seconds: number | null; tone: string | null; pinned_snapshot_id: string | null; version: number;
}
export interface Beat { id: string; part: string; text: string }

type Sb = Awaited<ReturnType<typeof supabaseServer>>;

export async function outlineBeats(sb: Sb, projectId: string): Promise<Beat[]> {
  const { data } = await sb.from("story_notebook").select("id, kind, body, created_at, position").eq("project_id", projectId)
    .in("kind", PARTS).neq("status", "archived");
  return sortByOrder((data ?? []) as { id: string; kind: string; body: string; created_at: string; position: number | null }[])
    .map((n) => ({ id: n.id, part: n.kind, text: String(n.body ?? "") }));
}

export async function latestScript(sb: Sb, projectId: string) {
  const { data: ent } = await sb.from("entities").select("id, current_version_id").eq("project_id", projectId).eq("kind", "screenplay").order("created_at").limit(1).maybeSingle();
  if (!ent) return { entityId: null as string | null, versionId: null as string | null, currentId: null as string | null, body: "" };
  const { data: v } = await sb.from("versions").select("id, content").eq("entity_id", ent.id).order("version_number", { ascending: false }).limit(1).maybeSingle();
  return { entityId: ent.id as string, versionId: (v?.id ?? null) as string | null, currentId: (ent.current_version_id ?? null) as string | null, body: String((v?.content as { body?: string } | null)?.body ?? "") };
}

export async function getConnectContext(projectId: string) {
  const sb = await supabaseServer();
  const [chars, cols, links, ctx, beats, script] = await Promise.all([
    sb.from("entities").select("id, name, metadata").eq("project_id", projectId).eq("kind", "character").is("archived_at", null).neq("status", "archived").order("name"),
    sb.from("knowledge_collections").select("id, name, description").eq("project_id", projectId).is("archived_at", null).order("name"),
    sb.from("character_knowledge").select("id, character_id, collection_id, purpose, temporal, scope_terms, from_beat, note, updated_at").eq("project_id", projectId).is("archived_at", null),
    sb.from("scene_contexts").select("scene_key, beat_id, story_date, story_date_note, objectives, runtime_seconds, tone, pinned_snapshot_id, version").eq("project_id", projectId),
    outlineBeats(sb, projectId),
    latestScript(sb, projectId),
  ]);
  const colIds = (cols.data ?? []).map((c) => c.id);
  const { data: inCols } = colIds.length ? await sb.rpc("kb_collection_items", { p_project: projectId, p_collections: colIds }) : { data: [] };
  const counts: Record<string, number> = {};
  for (const r of (inCols ?? []) as { collection_id: string }[]) counts[r.collection_id] = (counts[r.collection_id] ?? 0) + 1;
  const scenes = splitScenes(script.body).map((s) => ({ key: s.key, heading: s.heading, beatId: s.beatId, characters: s.characters }));
  return {
    characters: byRole(((chars.data ?? []) as { id: string; name: string; metadata: Record<string, unknown> | null }[]).map((c) => ({ id: c.id, name: c.name, role: roleOf(c.metadata) }))),
    collections: ((cols.data ?? []) as { id: string; name: string; description: string | null }[]).map((c) => ({ ...c, count: counts[c.id] ?? 0 })),
    links: (links.data ?? []) as KnowledgeLink[],
    contexts: (ctx.data ?? []) as SceneContext[],
    beats, scenes,
  };
}

export interface PreviewItem { id: string; title: string; url: string | null; published_at: string | null; source: string; use: Use; reason: string }

/** "What could this character draw from this collection?" for one scene (or with no scene). */
export async function previewLink(projectId: string, rule: LinkRule & { collection_id: string }, sceneKey: string | null): Promise<{
  items: PreviewItem[]; scene: { key: string; story_date: string | null; beat_id: string | null } | null; total: number;
}> {
  const sb = await supabaseServer();
  const [{ data: ids }, beats] = await Promise.all([
    sb.rpc("kb_collection_items", { p_project: projectId, p_collections: [rule.collection_id] }),
    outlineBeats(sb, projectId),
  ]);
  const itemIds = [...new Set(((ids ?? []) as { item_id: string }[]).map((r) => r.item_id))].slice(0, 400);
  let scene: { key: string; story_date: string | null; beat_id: string | null } | null = null;
  if (sceneKey) {
    const { data } = await sb.from("scene_contexts").select("story_date, beat_id").eq("project_id", projectId).eq("scene_key", sceneKey).maybeSingle();
    const beatFromKey = /^b:([^:]+):/.exec(sceneKey)?.[1] ?? null;
    scene = { key: sceneKey, story_date: data?.story_date ?? null, beat_id: data?.beat_id ?? beatFromKey };
  }
  if (!itemIds.length) return { items: [], scene, total: 0 };
  const { data: items } = await sb.from("knowledge_items").select("id, title, url, published_at, content, source_id, knowledge_sources(title)")
    .in("id", itemIds).order("published_at", { ascending: false, nullsFirst: false });
  const order = beats.map((b) => b.id);
  const out: PreviewItem[] = ((items ?? []) as unknown as { id: string; title: string; url: string | null; published_at: string | null; content: string; knowledge_sources: { title: string } | null }[]).map((i) => {
    const e = eligibility(rule, i, scene ?? { story_date: null, beat_id: null }, order);
    return { id: i.id, title: i.title, url: i.url, published_at: i.published_at, source: i.knowledge_sources?.title ?? "", use: e.use, reason: e.reason };
  });
  return { items: out, scene, total: out.length };
}
