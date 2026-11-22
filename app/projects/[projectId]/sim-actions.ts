"use server";
// World simulation desk. Controls, rules, states, decisions and day closing are plain data
// work (no model). Advance One Day and Reassess call a small cloud model (Claude Haiku) and
// only ever create proposals. Dialogue is only developed from approved events: the database
// refuses anything else.
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { aiConfigured } from "@/lib/ai/configured";
import { friendlyError } from "@/lib/errors";
import { supabaseServer } from "@/lib/supabase/server";
import { advanceDay, reassessEvent } from "@/lib/sim/run";
import { buildRequest, WORKFLOW_VERSION, type ApprovedEvent } from "@/lib/dialogue/request";
import { processQueue } from "@/lib/dialogue/run";
import { isTracked, parseBullets, type EventData } from "@/lib/sim/rules";
import { roleOf } from "@/lib/characters/roles";

export type SR = { ok: true; note?: string } | { ok: false; error: string };
const fail = (e: { code?: string; message?: string } | null): SR => ({ ok: false, error: friendlyError(e).message });
const touch = (projectId: string) => { revalidatePath(`/projects/${projectId}`, "layout"); revalidatePath(`/projects/${projectId}/world`); revalidatePath(`/projects/${projectId}/script`); };

export async function simSaveSettings(input: { projectId: string; data: Record<string, unknown> }): Promise<SR> {
  const sb = await supabaseServer();
  const { error } = await sb.rpc("sim_settings_save", { p_project: input.projectId, p_data: input.data });
  if (error) return fail(error);
  touch(input.projectId);
  return { ok: true };
}

export async function simSaveRule(input: { projectId: string; ruleId: string | null; data: Record<string, unknown> }): Promise<SR> {
  const sb = await supabaseServer();
  const { error } = await sb.rpc("sim_rule_save", { p_project: input.projectId, p_rule: input.ruleId, p_data: input.data });
  if (error) return fail(error);
  touch(input.projectId);
  return { ok: true, note: "Saved. It applies from the next day the simulation prepares." };
}

export async function simRemoveRule(input: { projectId: string; ruleId: string }): Promise<SR> {
  const sb = await supabaseServer();
  const { error } = await sb.rpc("sim_rule_remove", { p_project: input.projectId, p_rule: input.ruleId });
  if (error) return fail(error);
  touch(input.projectId);
  return { ok: true, note: "Removed from the next day on. Past days keep the rules they used." };
}

export async function simSetState(input: { projectId: string; characterId: string; stress: number; happiness: number; note?: string }): Promise<SR> {
  const sb = await supabaseServer();
  const { data: ent } = await sb.from("entities").select("metadata").eq("id", input.characterId).eq("project_id", input.projectId).maybeSingle();
  if (!isTracked(roleOf(ent?.metadata as Record<string, unknown> | null)))
    return { ok: false, error: "Feelings are tracked for protagonists, antagonists and supporting characters. Choose one of those roles first." };
  const { data, error } = await sb.rpc("sim_state_set", { p_project: input.projectId, p_character: input.characterId, p_stress: Math.round(input.stress), p_happiness: Math.round(input.happiness), p_note: input.note ?? null });
  if (error) return fail(error);
  touch(input.projectId);
  return { ok: true, note: data === "adjusted" ? "Recorded as a change today. Earlier days stay as they were." : data === "unchanged" ? "No change." : "Starting point saved." };
}

export async function simAdvance(input: { projectId: string }): Promise<SR> {
  if (!aiConfigured()) return { ok: false, error: "The simulation's AI isn't set up on this server." };
  const sb = await supabaseServer();
  const r = await advanceDay({ projectId: input.projectId, trigger: "manual", userClient: sb });
  touch(input.projectId);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, note: r.proposed ? `Day ${r.day}: ${r.proposed} proposed event${r.proposed === 1 ? "" : "s"} to review.` : `Day ${r.day}: no events proposed. ${r.note}` };
}

export async function simCancelRun(input: { projectId: string; runId: string }): Promise<SR> {
  const sb = await supabaseServer();
  const { error } = await sb.rpc("sim_run_cancel", { p_project: input.projectId, p_run: input.runId });
  if (error) return fail(error);
  touch(input.projectId);
  return { ok: true, note: "Cancelled. Nothing was changed." };
}

export async function simEditEvent(input: { projectId: string; eventId: string; expectedVersion: number; data: EventData; confirm: boolean }): Promise<SR> {
  const sb = await supabaseServer();
  const { error } = await sb.rpc("sim_event_edit", { p_project: input.projectId, p_event: input.eventId, p_expected_version: input.expectedVersion, p_data: input.data, p_confirm: input.confirm });
  if (error) return fail(error);
  touch(input.projectId);
  return { ok: true, note: "Saved as a new version." };
}

export async function simReassess(input: { projectId: string; eventId: string; clearDeps: boolean; why: string }): Promise<SR> {
  if (!aiConfigured()) return { ok: false, error: "The simulation's AI isn't set up on this server." };
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  const { data: version, error } = await sb.rpc("sim_reassess_check", { p_project: input.projectId, p_event: input.eventId });
  if (error || !user) return fail(error);
  const r = await reassessEvent({ projectId: input.projectId, eventId: input.eventId, version: Number(version), uid: user.id, clearDeps: input.clearDeps, why: input.why.slice(0, 300) });
  touch(input.projectId);
  return r.ok ? { ok: true, note: "Updated how they might feel and what they might do." } : r;
}

/** Approve / reject / defer / restore. After approval, an optional bounded dialogue draft (her setting). */
export async function simDecide(input: { projectId: string; eventId: string; action: "approve" | "reject" | "defer" | "restore"; version: number }): Promise<SR> {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("sim_event_decide", { p_project: input.projectId, p_event: input.eventId, p_action: input.action, p_version: input.version });
  if (error) return fail(error);
  touch(input.projectId);
  if (data === "blocked") return { ok: false, error: "It depends on an event that changed or isn't approved. Reassess it first." };
  if (data === "already") return { ok: true, note: "Already approved." };
  if (input.action === "approve") {
    const { data: s } = await sb.from("sim_settings").select("auto_dialogue").eq("project_id", input.projectId).maybeSingle();
    const { data: ev } = await sb.from("sim_events").select("target_scene_key").eq("id", input.eventId).single();
    if (s?.auto_dialogue && ev?.target_scene_key && aiConfigured()) {
      const q = await queueEventDialogue(input.projectId, ev.target_scene_key, [input.eventId], "event");
      return { ok: true, note: q.ok ? "Approved. A dialogue draft for its scene is being prepared on the Script desk." : `Approved. (No draft: ${q.error})` };
    }
    return { ok: true, note: "Approved: it's now part of the story." };
  }
  return { ok: true, note: input.action === "reject" ? "Rejected. Anything depending on it needs reassessing." : input.action === "defer" ? "Deferred: it moves to the next day when you close this one." : "Back as a proposal." };
}

export async function simSetScene(input: { projectId: string; eventId: string; sceneKey: string }): Promise<SR> {
  const sb = await supabaseServer();
  const { error } = await sb.rpc("sim_event_scene", { p_project: input.projectId, p_event: input.eventId, p_scene_key: input.sceneKey });
  if (error) return fail(error);
  touch(input.projectId);
  return { ok: true };
}

export async function simAddEvent(input: { projectId: string; data: EventData; revises?: string | null }): Promise<SR> {
  const sb = await supabaseServer();
  const { error } = await sb.rpc("sim_event_add", { p_project: input.projectId, p_data: input.data, p_revises: input.revises ?? null });
  if (error) return fail(error);
  touch(input.projectId);
  return { ok: true, note: "Added to today as your own event." };
}

export async function simCloseDay(input: { projectId: string; day: number }): Promise<SR> {
  const sb = await supabaseServer();
  const { error } = await sb.rpc("sim_day_close", { p_project: input.projectId, p_day: input.day });
  if (error) return fail(error);
  touch(input.projectId);
  return { ok: true, note: `Day ${input.day} closed. The next day can be prepared.` };
}

async function approvedEvents(sb: Awaited<ReturnType<typeof supabaseServer>>, projectId: string, ids: string[]): Promise<ApprovedEvent[] | null> {
  const { data: evs } = await sb.from("sim_events").select("id, day, status, approved_version, current_version").eq("project_id", projectId).in("id", ids);
  const list = (evs ?? []) as { id: string; day: number; status: string; approved_version: number | null; current_version: number }[];
  if (list.length !== ids.length || list.some((e) => e.status !== "approved" || e.approved_version !== e.current_version)) return null;
  const { data: vers } = await sb.from("sim_event_versions").select("event_id, version, data").in("event_id", ids);
  return list.map((e) => {
    const d = ((vers ?? []) as { event_id: string; version: number; data: EventData }[]).find((v) => v.event_id === e.id && v.version === e.approved_version)!.data;
    return { id: e.id, version: e.approved_version!, day: e.day, title: d.title, description: d.description, basis: d.basis,
      characters: d.characters.map((c) => ({ name: c.name, feel: c.feel, movement: c.movement })) };
  });
}

async function queueEventDialogue(projectId: string, sceneKey: string, ids: string[], trigger: "on_demand" | "event"): Promise<SR & { id?: string }> {
  const sb = await supabaseServer();
  const events = await approvedEvents(sb, projectId, ids);
  if (!events) return { ok: false, error: "Only approved events can be developed into dialogue." };
  const b = await buildRequest(sb, projectId, sceneKey, { events });
  if (!b.ok) return b;
  const { data, error } = await sb.rpc("dialogue_request", { p_project: projectId, p_scene_key: sceneKey, p_data: {
    trigger, request_hash: b.hash, request: b.request, beat_id: b.request.beat?.id ?? "", workflow_version: WORKFLOW_VERSION,
    events: events.map((e) => ({ id: e.id, version: e.version })) } });
  if (error) return fail(error);
  const row = (data as { proposal_id: string; existing: boolean }[])[0];
  if (trigger === "event") after(() => processQueue(projectId, { max: 1, budgetMs: 240_000 }).then(() => undefined));
  return { ok: true, id: row.proposal_id };
}

/** Develop Dialogue from selected approved events, in a scene she chooses (the default path). */
export async function simDevelopDialogue(input: { projectId: string; sceneKey: string; eventIds: string[] }): Promise<SR> {
  if (!aiConfigured()) return { ok: false, error: "Dialogue drafting isn't set up on this server." };
  if (!input.eventIds.length) return { ok: false, error: "Select at least one approved event." };
  if (input.eventIds.length > 10) return { ok: false, error: "Ten events at most for one scene." };
  const q = await queueEventDialogue(input.projectId, input.sceneKey, input.eventIds, "on_demand");
  if (!q.ok) return q;
  await processQueue(input.projectId, { max: 1, budgetMs: 240_000 });
  touch(input.projectId);
  return { ok: true, note: "Draft ready on the Script desk, in that scene. Your script changes only if you accept it." };
}

/** Rules as one box of bullet points (a character's, or the world's): one rule per bullet, saved as versions. */
export async function simSaveBullets(input: { projectId: string; family: "character" | "periphery"; characterId?: string | null; text: string }): Promise<{ ok: true; note: string } | { ok: false; error: string }> {
  const sb = await supabaseServer();
  const bullets = parseBullets(input.text);
  let q = sb.from("sim_rules").select("id, when_text, stress, happiness, tend_text, relief_text, enabled")
    .eq("project_id", input.projectId).eq("family", input.family).is("archived_at", null).order("created_at");
  q = input.family === "character" ? q.eq("character_id", input.characterId ?? "") : q.is("character_id", null);
  const { data: cur, error: e1 } = await q;
  if (e1) return { ok: false, error: friendlyError(e1).message };
  const rows = (cur ?? []) as { id: string; when_text: string; stress: number; happiness: number; tend_text: string | null; relief_text: string | null; enabled: boolean }[];
  let changed = 0;
  for (let i = 0; i < Math.max(rows.length, bullets.length); i++) {
    const r = rows[i], b = bullets[i];
    if (r && !b) {
      const { error } = await sb.rpc("sim_rule_remove", { p_project: input.projectId, p_rule: r.id });
      if (error) return { ok: false, error: friendlyError(error).message };
      changed++;
      continue;
    }
    const plain = r && r.when_text === b && !r.stress && !r.happiness && !r.tend_text && !r.relief_text && r.enabled;
    if (plain) continue;
    const { error } = await sb.rpc("sim_rule_save", { p_project: input.projectId, p_rule: r?.id ?? null,
      p_data: { family: input.family, character_id: input.family === "character" ? input.characterId : null, when_text: b, stress: 0, happiness: 0, tend_text: "", relief_text: "", enabled: true } });
    if (error) return { ok: false, error: friendlyError(error).message };
    changed++;
  }
  touch(input.projectId);
  return { ok: true, note: changed ? `Saved ${bullets.length} rule${bullets.length === 1 ? "" : "s"}. They apply from the next day.` : "No changes." };
}
