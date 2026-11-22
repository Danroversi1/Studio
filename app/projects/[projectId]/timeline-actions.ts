"use server";
// The Knowledge Timeline: plain data work, no model. Every rule is enforced in the database.
import { revalidatePath } from "next/cache";
import { friendlyError } from "@/lib/errors";
import { supabaseServer } from "@/lib/supabase/server";

type R = { ok: true } | { ok: false; error: string };

async function call(projectId: string, fn: string, args: Record<string, unknown>): Promise<R> {
  const sb = await supabaseServer();
  const { error } = await sb.rpc(fn, args);
  if (error) return { ok: false, error: friendlyError(error).message };
  revalidatePath(`/projects/${projectId}`, "layout");
  return { ok: true };
}

export async function tlSetAnchor(i: { projectId: string; date: string }) {
  return call(i.projectId, "timeline_set_anchor", { p_project: i.projectId, p_date: i.date });
}
export async function tlSetAccess(i: { projectId: string; characterId: string; enabled: boolean; ahead: number }) {
  return call(i.projectId, "timeline_access_set", { p_character: i.characterId, p_enabled: i.enabled, p_ahead: i.ahead });
}
export async function tlAddDiscovery(i: { projectId: string; characterId: string; method: string; what: string; how: string; itemId: string | null }) {
  return call(i.projectId, "timeline_discovery_add", { p_character: i.characterId, p_method: i.method, p_what: i.what, p_how: i.how || null, p_item: i.itemId });
}
export async function tlAddPrediction(i: { projectId: string; characterId: string; prediction: string; discoveryIds: string[]; itemIds: string[] }) {
  return call(i.projectId, "timeline_prediction_add", { p_character: i.characterId, p_prediction: i.prediction, p_discoveries: i.discoveryIds, p_items: i.itemIds });
}
export async function tlResolvePrediction(i: { projectId: string; predictionId: string; status: string; note: string }) {
  return call(i.projectId, "timeline_prediction_resolve", { p_prediction: i.predictionId, p_status: i.status, p_note: i.note || null });
}
export async function tlAddIntervention(i: { projectId: string; characterId: string; action: string; expected: string; predictionId: string | null; discoveryIds: string[]; itemIds: string[] }) {
  return call(i.projectId, "timeline_intervention_add", { p_character: i.characterId, p_action: i.action, p_expected: i.expected || null, p_prediction: i.predictionId,
    p_discoveries: i.discoveryIds, p_items: i.itemIds });
}
export async function tlOutcome(i: { projectId: string; interventionId: string; outcome: string }) {
  return call(i.projectId, "timeline_intervention_outcome", { p_intervention: i.interventionId, p_outcome: i.outcome });
}
export async function tlReassess(i: { projectId: string; flagId: string; revised: string }) {
  return call(i.projectId, "timeline_flag_reassess", { p_flag: i.flagId, p_revised: i.revised });
}
export async function tlBrief(i: { projectId: string; fromId: string | null; toId: string; kind: string; content: string; itemIds: string[]; flagIds: string[] }) {
  return call(i.projectId, "timeline_briefing_add", { p_from: i.fromId, p_to: i.toId, p_kind: i.kind, p_content: i.content, p_items: i.itemIds, p_flags: i.flagIds });
}
