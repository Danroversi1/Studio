"use server";
// Outline → proposed dialogue → Script desk review. Drafting and reviewing call a cloud
// model (Anthropic Claude); everything else here is plain data work. Accepting writes a NEW
// script revision (earlier revisions stay in history) and changes only that one scene.
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { aiConfigured } from "@/lib/ai/configured";
import { friendlyError } from "@/lib/errors";
import { latestScript } from "@/lib/knowledge/connect-data";
import { buildRequest, WORKFLOW_VERSION, type DialogueRequest } from "@/lib/dialogue/request";
import { researchUpdates } from "@/lib/dialogue/data";
import { processQueue, researchCheck, reviewProposal } from "@/lib/dialogue/run";
import { replaceScene, sceneWithAdopted, sceneWithProposal, splitScenes, type DialogueElement } from "@/lib/dialogue/scenes";
import { supabaseServer } from "@/lib/supabase/server";

export type DR = { ok: true; id?: string; note?: string } | { ok: false; error: string };
const fail = (e: { code?: string; message?: string } | null): DR => ({ ok: false, error: friendlyError(e).message });
const touch = (projectId: string) => { revalidatePath(`/projects/${projectId}/script`); revalidatePath(`/projects/${projectId}`, "layout"); };

/** Develop scene (on demand), or Request a revision (with her note). */
export async function developDialogue(input: { projectId: string; sceneKey: string; directorNote?: string; parentId?: string }): Promise<DR> {
  if (!aiConfigured()) return { ok: false, error: "Dialogue drafting isn't set up on this server." };
  const sb = await supabaseServer();
  const b = await buildRequest(sb, input.projectId, input.sceneKey, { directorNote: input.directorNote, parentId: input.parentId });
  if (!b.ok) return b;
  if (!b.request.characters.length && !b.request.unknown_speakers.length) return { ok: false, error: "No characters are in this scene yet. Add who's in it to the outline beat or the scene." };
  const { data, error } = await sb.rpc("dialogue_request", { p_project: input.projectId, p_scene_key: input.sceneKey, p_data: {
    trigger: input.parentId ? "revision" : "on_demand", request_hash: b.hash, request: b.request, beat_id: b.request.beat?.id ?? "",
    parent_id: input.parentId ?? "", director_note: input.directorNote ?? "", workflow_version: WORKFLOW_VERSION } });
  if (error) return fail(error);
  const row = (data as { proposal_id: string; existing: boolean }[])[0];
  if (row.existing) { touch(input.projectId); return { ok: true, id: row.proposal_id, note: "Nothing changed since the last draft, so it's shown again instead of drafting a new one." }; }
  await processQueue(input.projectId, { max: 1, budgetMs: 240_000 });
  touch(input.projectId);
  return { ok: true, id: row.proposal_id };
}

/** Picks up waiting drafts (e.g. Auto-draft) while the Script desk is open. */
export async function continueDrafts(input: { projectId: string }): Promise<{ done: number }> {
  const sb = await supabaseServer();
  const { data: caps } = await sb.rpc("my_project_capabilities", { p_project: input.projectId });
  if (!caps?.can_edit || !aiConfigured()) return { done: 0 };
  const done = await processQueue(input.projectId, { max: 1, budgetMs: 240_000 });
  if (done) touch(input.projectId);
  return { done };
}

export async function cancelDialogue(input: { projectId: string; proposalId: string }): Promise<DR> {
  const sb = await supabaseServer();
  const { error } = await sb.rpc("dialogue_cancel", { p_project: input.projectId, p_proposal: input.proposalId });
  if (error) return fail(error);
  touch(input.projectId);
  return { ok: true, note: "Cancelled." };
}

export async function decideDialogue(input: { projectId: string; proposalId: string; action: "reject" | "restore"; note?: string }): Promise<DR> {
  const sb = await supabaseServer();
  const { error } = await sb.rpc("dialogue_decide", { p_project: input.projectId, p_proposal: input.proposalId, p_action: input.action, p_version: null, p_note: input.note ?? null });
  if (error) return fail(error);
  touch(input.projectId);
  return { ok: true };
}

/** Accept the whole proposal (possibly edited), or adopt selected lines, into the script. */
export async function acceptDialogue(input: { projectId: string; proposalId: string; mode: "all" | "adopt"; elements: DialogueElement[];
  facts: { text: string; kind: string }[]; expectedScriptVersionId: string | null }): Promise<DR> {
  const sb = await supabaseServer();
  const { data: p } = await sb.from("dialogue_proposals").select("id, scene_key, status, result").eq("id", input.proposalId).eq("project_id", input.projectId).maybeSingle();
  if (!p || !p.result) return { ok: false, error: "That draft isn't available." };
  if (!["ready", "superseded", "accepted"].includes(p.status)) return { ok: false, error: "That draft isn't ready." };
  const els = (input.elements ?? []).slice(0, 40).map((e) => ({ ...e, text: String(e.text ?? "").slice(0, 1200) })).filter((e) => e.text.trim());
  if (!els.length) return { ok: false, error: input.mode === "adopt" ? "Pick at least one line." : "The draft is empty." };
  const script = await latestScript(sb, input.projectId);
  if (!script.entityId) return { ok: false, error: "There's no script yet." };
  if (input.expectedScriptVersionId && script.versionId !== input.expectedScriptVersionId) {
    return { ok: false, error: "The script changed since you opened this page. Reload to compare with the latest version." };
  }
  const scene = splitScenes(script.body).find((s) => s.key === p.scene_key);
  if (!scene) return { ok: false, error: "That scene is no longer in the script." };
  const nextScene = input.mode === "all" ? sceneWithProposal(scene, els) : sceneWithAdopted(scene, els);
  const body = replaceScene(script.body, scene, nextScene);
  const { data: version, error } = await sb.rpc("create_revision", {
    p_entity: script.entityId, p_content: { body }, p_change_summary: `${input.mode === "all" ? "Dialogue accepted" : `${els.length} line${els.length > 1 ? "s" : ""} adopted`} · ${scene.heading}`.slice(0, 300),
    p_parent_version: script.versionId, p_base_version: script.currentId, p_asset_ids: [], p_status: "submitted",
  });
  if (error) return fail(error);
  const { error: e2 } = await sb.rpc("dialogue_decide", { p_project: input.projectId, p_proposal: p.id, p_action: input.mode === "all" ? "accept" : "adopt", p_version: version, p_note: null });
  if (e2) return fail(e2);
  // New story facts go to the Story desk as ideas for her to confirm (the existing decision
  // mechanism); nothing becomes canon silently.
  for (const f of (input.facts ?? []).slice(0, 8)) {
    const prefix = f.kind === "adaptation" ? "Proposed adaptation (from accepted dialogue)" : "From accepted dialogue";
    await sb.rpc("add_notebook_item", { p_project: input.projectId, p_kind: "idea", p_body: `${prefix}, ${scene.heading}: ${String(f.text).slice(0, 600)}` });
  }
  touch(input.projectId);
  return { ok: true, id: String(version), note: `Saved as a new script revision.${input.facts?.length ? ` ${input.facts.length} new story idea${input.facts.length > 1 ? "s" : ""} sent to the Story desk to confirm.` : ""}` };
}

export async function reviewDialogue(input: { projectId: string; proposalId: string; elements: DialogueElement[]; focus?: string }): Promise<DR> {
  if (!aiConfigured()) return { ok: false, error: "The script partner isn't set up on this server." };
  const sb = await supabaseServer();
  const { data: uid, error } = await sb.rpc("dialogue_note_allowed", { p_project: input.projectId, p_proposal: input.proposalId });
  if (error) return fail(error);
  const { data: p } = await sb.from("dialogue_proposals").select("request").eq("id", input.proposalId).single();
  try {
    await reviewProposal(input.proposalId, String(uid), (input.elements ?? []).slice(0, 40), p?.request as DialogueRequest, input.focus ?? null);
  } catch { return { ok: false, error: "The script partner couldn't answer just now." }; }
  touch(input.projectId);
  return { ok: true };
}

/** Accepted dialogue vs research that changed or arrived later. The draft is never changed. */
export async function checkDialogueResearch(input: { projectId: string; proposalId: string }): Promise<DR> {
  if (!aiConfigured()) return { ok: false, error: "This check isn't set up on this server." };
  const sb = await supabaseServer();
  const { data: uid, error } = await sb.rpc("dialogue_note_allowed", { p_project: input.projectId, p_proposal: input.proposalId });
  if (error) return fail(error);
  const { data: p } = await sb.from("dialogue_proposals").select("result, snapshot_id, decided_at, provenance").eq("id", input.proposalId).single();
  if (!p) return { ok: false, error: "Draft not found." };
  const u = await researchUpdates(sb, input.projectId, p as never);
  const ids = [...u.changed, ...u.added].slice(0, 12);
  if (!ids.length) return { ok: true, note: "No research has changed or arrived since this was accepted." };
  const { data: items } = await sb.from("knowledge_items").select("id, title, published_at, content").in("id", ids);
  try {
    const r = await researchCheck(input.proposalId, String(uid), ((p.result as { elements?: DialogueElement[] })?.elements ?? []).slice(0, 40),
      ((items ?? []) as { id: string; title: string; published_at: string | null; content: string }[]).map((i) => ({ id: i.id, title: i.title, date: i.published_at, content: i.content })));
    touch(input.projectId);
    return { ok: true, note: r.conflicts.length ? `${r.conflicts.length} possible conflict${r.conflicts.length > 1 ? "s" : ""} flagged. Your accepted dialogue is unchanged.` : "No conflicts found." };
  } catch { return { ok: false, error: "The check couldn't run just now." }; }
}

export async function pinSceneResearch(input: { projectId: string; sceneKey: string; snapshotId: string | null }): Promise<DR> {
  const sb = await supabaseServer();
  const { error } = await sb.rpc("scene_snapshot_pin", { p_project: input.projectId, p_scene_key: input.sceneKey, p_snapshot: input.snapshotId });
  if (error) return fail(error);
  touch(input.projectId);
  return { ok: true, note: input.snapshotId ? "Pinned: new drafts for this scene use exactly this research." : "Unpinned: new drafts use the latest eligible research." };
}

export async function saveAutoDraft(input: { projectId: string; auto: boolean | null; paused: boolean | null }): Promise<DR> {
  const sb = await supabaseServer();
  const { error } = await sb.rpc("dialogue_settings_save", { p_project: input.projectId, p_auto: input.auto, p_paused: input.paused });
  if (error) return fail(error);
  touch(input.projectId);
  if (input.auto || input.paused === false) after(() => processQueue(input.projectId, { max: 2 }).catch(() => 0));
  return { ok: true };
}
