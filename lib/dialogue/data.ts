// SERVER ONLY. What the Script desk shows about scenes and dialogue proposals, including
// deterministic flags: the outline or the scene changed since a draft, and research that
// changed or arrived after a draft was accepted (the draft itself is never touched).
import { createHash } from "node:crypto";
import { latestScript, outlineBeats } from "../knowledge/connect-data";
import { supabaseServer } from "../supabase/server";
import { sceneSignature, splitScenes, type DialogueElement } from "./scenes";

type Sb = Awaited<ReturnType<typeof supabaseServer>>;
const hash = (s: string) => createHash("sha256").update(s).digest("hex");

export interface ProposalView {
  id: string; scene_key: string; status: string; trigger: string; parent_id: string | null; director_note: string | null;
  created_at: string; finished_at: string | null; decided_at: string | null; error: string | null; snapshot_id: string | null;
  result: { elements: DialogueElement[]; assumptions: string[]; open_choices: string[]; new_facts: { text: string; kind: string }[]; note: string; warnings?: string[] } | null;
  provenance: Record<string, unknown>; reviews: { observation: string; question: string; suggestion: string; focus: string; at: string }[];
  flags: { research_check?: { summary: string; conflicts: { line: string; item_id: string; explanation: string }[]; at: string }; decision?: string };
  stale: { outline: boolean; scene: boolean };
  research: { item_id: string; version: number; title: string; use: string; reason: string; collection: string; character: string; current_version: number | null; url: string | null; source: string; date: string | null }[];
  updates: number;
  /** Approved simulation events this draft dramatizes (exact versions). */
  event_refs?: { id: string; version: number }[];
}

export async function researchUpdates(sb: Sb, projectId: string, p: { snapshot_id: string | null; decided_at: string | null; provenance: Record<string, unknown> }) {
  if (!p.snapshot_id) return { changed: [] as string[], added: [] as string[] };
  const { data: snap } = await sb.from("knowledge_snapshots").select("items").eq("id", p.snapshot_id).maybeSingle();
  const items = (snap?.items ?? []) as { item_id: string; version: number; character_id: string }[];
  const changed: string[] = [];
  if (items.length) {
    const { data: cur } = await sb.from("knowledge_items").select("id, version").in("id", items.map((i) => i.item_id));
    for (const i of items) if ((cur ?? []).find((c) => c.id === i.item_id && c.version > i.version)) changed.push(i.item_id);
  }
  const chars = ((p.provenance.characters ?? []) as { id: string }[]).map((c) => c.id);
  let added: string[] = [];
  if (p.decided_at && chars.length) {
    const { data: links } = await sb.from("character_knowledge").select("collection_id").eq("project_id", projectId).in("character_id", chars).is("archived_at", null).neq("purpose", "director_only");
    const cols = [...new Set((links ?? []).map((l) => l.collection_id))];
    if (cols.length) {
      const { data: inCols } = await sb.rpc("kb_collection_items", { p_project: projectId, p_collections: cols });
      const ids = [...new Set(((inCols ?? []) as { item_id: string }[]).map((r) => r.item_id))];
      if (ids.length) {
        const { data: fresh } = await sb.from("knowledge_items").select("id").in("id", ids.slice(0, 400)).gt("created_at", p.decided_at).limit(20);
        added = (fresh ?? []).map((f) => f.id);
      }
    }
  }
  return { changed, added };
}

export async function getDialogueDesk(projectId: string) {
  const sb = await supabaseServer();
  const [script, beats, ctx, props, settings, chars] = await Promise.all([
    latestScript(sb, projectId), outlineBeats(sb, projectId),
    sb.from("scene_contexts").select("scene_key, beat_id, story_date, story_date_note, objectives, runtime_seconds, tone, pinned_snapshot_id, version").eq("project_id", projectId),
    sb.from("dialogue_proposals").select("id, scene_key, status, trigger, parent_id, director_note, created_at, finished_at, decided_at, error, snapshot_id, result, provenance, reviews, flags, event_refs")
      .eq("project_id", projectId).order("created_at", { ascending: false }).limit(120),
    sb.from("dialogue_settings").select("auto_draft, paused").eq("project_id", projectId).maybeSingle(),
    sb.from("entities").select("id, name").eq("project_id", projectId).eq("kind", "character").is("archived_at", null).neq("status", "archived").order("name"),
  ]);
  const scenes = splitScenes(script.body);
  const sigByKey = new Map(scenes.map((s) => [s.key, hash(sceneSignature(s))]));
  const beatHash = new Map(beats.map((b) => [b.id, hash(b.text)]));
  const snapIds = [...new Set((props.data ?? []).map((p) => p.snapshot_id).filter(Boolean))] as string[];
  const { data: snaps } = snapIds.length ? await sb.from("knowledge_snapshots").select("id, items").in("id", snapIds) : { data: [] };
  const allItemIds = [...new Set(((snaps ?? []) as { items: { item_id: string }[] }[]).flatMap((s) => s.items.map((i) => i.item_id)))];
  const { data: itemRows } = allItemIds.length ? await sb.from("knowledge_items").select("id, version, url, published_at, knowledge_sources(title)").in("id", allItemIds) : { data: [] };
  const itemInfo = new Map(((itemRows ?? []) as unknown as { id: string; version: number; url: string | null; published_at: string | null; knowledge_sources: { title: string } | null }[]).map((i) => [i.id, i]));
  const charName = new Map(((chars.data ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));

  const proposals: ProposalView[] = [];
  for (const p of (props.data ?? []) as unknown as Omit<ProposalView, "stale" | "research" | "updates">[]) {
    const prov = p.provenance as { outline?: { beat_id: string; beat_hash: string } | null; scene_signature?: string };
    const snap = ((snaps ?? []) as { id: string; items: { item_id: string; version: number; use: string; reason: string; collection: string; character_id: string; title: string }[] }[]).find((s) => s.id === p.snapshot_id);
    let updates = 0;
    if (p.status === "accepted") { const u = await researchUpdates(sb, projectId, p); updates = u.changed.length + u.added.length; }
    proposals.push({
      ...p, reviews: (p.reviews ?? []) as ProposalView["reviews"], flags: (p.flags ?? {}) as ProposalView["flags"],
      stale: {
        outline: !!prov.outline && beatHash.has(prov.outline.beat_id) && beatHash.get(prov.outline.beat_id) !== prov.outline.beat_hash,
        scene: !!prov.scene_signature && sigByKey.has(p.scene_key) && sigByKey.get(p.scene_key) !== prov.scene_signature && p.status !== "accepted",
      },
      research: (snap?.items ?? []).map((i) => {
        const info = itemInfo.get(i.item_id);
        return { item_id: i.item_id, version: i.version, title: i.title, use: i.use, reason: i.reason, collection: i.collection, character: charName.get(i.character_id) ?? "",
          current_version: info?.version ?? null, url: info?.url ?? null, source: info?.knowledge_sources?.title ?? "", date: info?.published_at ?? null };
      }),
      updates,
    });
  }
  return {
    scenes: scenes.map((s) => {
      const b = s.beatId ? beats.findIndex((x) => x.id === s.beatId) : -1;
      return { key: s.key, heading: s.heading, beatId: s.beatId, beatNumber: b >= 0 ? b + 1 : null, beatText: b >= 0 ? beats[b].text : null, characters: s.characters, text: s.text };
    }),
    contexts: (ctx.data ?? []) as { scene_key: string; beat_id: string | null; story_date: string | null; story_date_note: string | null; objectives: Record<string, string>; runtime_seconds: number | null; tone: string | null; pinned_snapshot_id: string | null; version: number }[],
    proposals,
    settings: { auto_draft: !!settings.data?.auto_draft, paused: !!settings.data?.paused },
    characters: (chars.data ?? []) as { id: string; name: string }[],
    scriptVersionId: script.versionId,
  };
}
