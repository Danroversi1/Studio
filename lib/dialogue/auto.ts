// SERVER ONLY. Optional Auto-draft: after she deliberately saves an outline beat, queue a
// proposal for ONLY the scenes laid out from that beat, and only when the beat changed
// substantially since the last proposal. Never runs from feed refreshes. Bounded by the
// database (at most 3 waiting/drafting per film, 1 drafting at a time, de-duplicated).
import { supabaseServer } from "../supabase/server";
import { latestScript } from "../knowledge/connect-data";
import { buildRequest, WORKFLOW_VERSION } from "./request";
import { splitScenes } from "./scenes";

type Sb = Awaited<ReturnType<typeof supabaseServer>>;

/** Word-set similarity (Dice), 0..1. A beat counts as substantially revised below 0.85. */
export function similarity(a: string, b: string): number {
  const w = (s: string) => new Set(s.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []);
  const A = w(a), B = w(b);
  if (!A.size && !B.size) return 1;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return (2 * inter) / (A.size + B.size);
}

export async function queueAutoDraftsForBeat(sb: Sb, projectId: string, beatId: string): Promise<number> {
  const { data: s } = await sb.from("dialogue_settings").select("auto_draft, paused").eq("project_id", projectId).maybeSingle();
  if (!s?.auto_draft || s.paused) return 0;
  const script = await latestScript(sb, projectId);
  const scenes = splitScenes(script.body).filter((x) => x.beatId === beatId);
  let queued = 0;
  for (const scene of scenes) {
    const { data: last } = await sb.from("dialogue_proposals").select("request").eq("project_id", projectId).eq("scene_key", scene.key)
      .in("status", ["ready", "accepted", "drafting", "queued"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
    const prevBeat = (last?.request as { beat?: { text?: string } } | null)?.beat?.text ?? null;
    const b = await buildRequest(sb, projectId, scene.key);
    if (!b.ok) continue;
    if (prevBeat !== null && similarity(prevBeat, b.request.beat?.text ?? "") >= 0.85) continue;
    const { data, error } = await sb.rpc("dialogue_request", { p_project: projectId, p_scene_key: scene.key, p_data: {
      trigger: "auto", request_hash: b.hash, request: b.request, beat_id: b.request.beat?.id ?? "", workflow_version: WORKFLOW_VERSION } });
    if (!error && data && !(data as { existing: boolean }[])[0]?.existing) queued++;
    if (error) break; // e.g. three already in progress: stop, don't hammer
  }
  return queued;
}

export async function scenesForKey(body: string) { return splitScenes(body); }
