"use server";
// Storyboards: create, edit shots (revisions), reorder (identity unchanged), approve / lock,
// annotate, references with roles, pick frames from history, cancel jobs, clear review flags.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { friendlyError, withMessage } from "@/lib/errors";
import { cleanShot } from "@/lib/storyboard/shot";
import { scriptScenes } from "@/lib/storyboard/review";
import { supabaseServer } from "@/lib/supabase/server";

type R = { ok: true; id?: string } | { ok: false; error: string };
const fail = (e: { code?: string; message?: string } | null): R => ({ ok: false, error: friendlyError(e).message });
const path = (p: string, s?: string) => `/projects/${p}/storyboards${s ? `/${s}` : ""}`;

/** "Create Your Frame": start from text, script scenes and/or images (combinable). */
export async function createStoryboard(fd: FormData) {
  const projectId = String(fd.get("projectId") ?? "");
  const title = String(fd.get("title") ?? "").trim() || "New storyboard";
  const brief = String(fd.get("brief") ?? "").trim();
  const sceneNums = fd.getAll("scene").map(Number).filter((n) => n > 0);
  const withImages = fd.get("images") === "1";
  const sb = await supabaseServer();
  const { data: sp } = await sb.from("entities").select("id").eq("project_id", projectId).eq("kind", "screenplay").order("created_at").limit(1).maybeSingle();
  let scenes: { number: number; heading: string; text: string }[] = [];
  if (sceneNums.length && sp) {
    const { data: v } = await sb.from("versions").select("content").eq("entity_id", sp.id).order("version_number", { ascending: false }).limit(1).maybeSingle();
    scenes = scriptScenes(String(v?.content?.body ?? "")).filter((s) => sceneNums.includes(s.number)).slice(0, 12);
  }
  const paths = [brief ? "text" : "", scenes.length ? "script" : "", withImages ? "images" : ""].filter(Boolean);
  const { data: id, error } = await sb.rpc("storyboard_create", {
    p_project: projectId, p_title: title, p_brief: brief,
    p_entry: { paths, scenes: scenes.map((s) => ({ number: s.number, heading: s.heading, text: s.text.slice(0, 4000) })) },
  });
  if (error) redirect(withMessage(path(projectId), "error", friendlyError(error).message));
  // A simple first shot list from her own material: one shot per chosen scene, or one for her
  // description. The Shot Builder can break these down further; nothing is invented here.
  const firsts = scenes.length
    ? scenes.map((s) => ({ action: s.text.split("\n").find((l) => l.trim())?.slice(0, 600) ?? s.heading, source: { kind: "script", scene: s.number, heading: s.heading, excerpt: s.text.slice(0, 2000) } }))
    : brief ? [{ action: brief.slice(0, 1200), source: { kind: "text", excerpt: brief.slice(0, 2000) } }] : [];
  for (const c of firsts) {
    await sb.rpc("storyboard_shot_save", { p_sequence: id, p_shot: null, p_content: cleanShot(c), p_origin: "director", p_position: null, p_expected_revision: null });
  }
  revalidatePath(`/projects/${projectId}`, "layout");
  redirect(`${path(projectId, id as string)}${withImages ? "?panel=refs" : ""}`);
}

export async function updateStoryboard(input: { projectId: string; sequenceId: string; title?: string; brief?: string; settings?: Record<string, unknown> }): Promise<R> {
  const sb = await supabaseServer();
  const { error } = await sb.rpc("storyboard_update", { p_sequence: input.sequenceId, p_title: input.title ?? null, p_brief: input.brief ?? null, p_settings: input.settings ?? null });
  if (error) return fail(error);
  revalidatePath(path(input.projectId, input.sequenceId));
  return { ok: true };
}

export async function archiveStoryboard(fd: FormData) {
  const projectId = String(fd.get("projectId")), sequenceId = String(fd.get("sequenceId"));
  const sb = await supabaseServer();
  const { error } = await sb.rpc("storyboard_archive", { p_sequence: sequenceId });
  if (error) redirect(withMessage(path(projectId, sequenceId), "error", friendlyError(error).message));
  revalidatePath(`/projects/${projectId}`, "layout");
  redirect(withMessage(path(projectId), "notice", "Storyboard removed. Its pictures are kept in the film."));
}

export async function saveShot(input: { projectId: string; sequenceId: string; shotId: string | null; content: unknown; position?: number | null; expectedRevision?: number | null }): Promise<R> {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("storyboard_shot_save", {
    p_sequence: input.sequenceId, p_shot: input.shotId, p_content: cleanShot(input.content), p_origin: "director",
    p_position: input.position ?? null, p_expected_revision: input.expectedRevision ?? null,
  });
  if (error) return fail(error);
  revalidatePath(path(input.projectId, input.sequenceId));
  return { ok: true, id: data as string };
}

export async function moveShot(input: { projectId: string; sequenceId: string; shotId: string; position: number }): Promise<R> {
  const sb = await supabaseServer();
  const { error } = await sb.rpc("storyboard_shot_move", { p_shot: input.shotId, p_position: input.position });
  if (error) return fail(error);
  revalidatePath(path(input.projectId, input.sequenceId));
  return { ok: true };
}

export async function setShotState(input: { projectId: string; sequenceId: string; shotId: string; state?: "proposed" | "approved" | null; locked?: boolean | null }): Promise<R> {
  const sb = await supabaseServer();
  const { error } = await sb.rpc("storyboard_shot_state", { p_shot: input.shotId, p_state: input.state ?? null, p_locked: input.locked ?? null });
  if (error) return fail(error);
  revalidatePath(path(input.projectId, input.sequenceId));
  return { ok: true };
}

export async function saveShotNotes(input: { projectId: string; sequenceId: string; shotId: string; notes: string }): Promise<R> {
  const sb = await supabaseServer();
  const { error } = await sb.rpc("storyboard_shot_notes", { p_shot: input.shotId, p_notes: input.notes });
  if (error) return fail(error);
  revalidatePath(path(input.projectId, input.sequenceId));
  return { ok: true };
}

export async function removeShot(input: { projectId: string; sequenceId: string; shotId: string }): Promise<R> {
  const sb = await supabaseServer();
  const { error } = await sb.rpc("storyboard_shot_archive", { p_shot: input.shotId });
  if (error) return fail(error);
  revalidatePath(path(input.projectId, input.sequenceId));
  return { ok: true };
}

export async function pickFrame(input: { projectId: string; sequenceId: string; shotId: string; slot: "frame" | "look"; assetId: string | null }): Promise<R> {
  const sb = await supabaseServer();
  const { error } = await sb.rpc("storyboard_shot_pick", { p_shot: input.shotId, p_slot: input.slot, p_asset: input.assetId });
  if (error) return fail(error);
  revalidatePath(path(input.projectId, input.sequenceId));
  return { ok: true };
}

export async function clearReview(input: { projectId: string; sequenceId: string; shotId: string }): Promise<R> {
  const sb = await supabaseServer();
  const { error } = await sb.rpc("storyboard_shot_review", { p_shot: input.shotId, p_review: null });
  if (error) return fail(error);
  revalidatePath(path(input.projectId, input.sequenceId));
  return { ok: true };
}

export async function saveRef(input: { projectId: string; sequenceId: string; refId: string | null; data: Record<string, unknown> }): Promise<R> {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("storyboard_ref_save", { p_sequence: input.sequenceId, p_ref: input.refId, p_data: input.data });
  if (error) return fail(error);
  revalidatePath(path(input.projectId, input.sequenceId));
  return { ok: true, id: data as string };
}

export async function removeRef(input: { projectId: string; sequenceId: string; refId: string }): Promise<R> {
  const sb = await supabaseServer();
  const { error } = await sb.rpc("storyboard_ref_remove", { p_ref: input.refId });
  if (error) return fail(error);
  revalidatePath(path(input.projectId, input.sequenceId));
  return { ok: true };
}

export async function cancelJob(input: { projectId: string; sequenceId: string; jobId: string }): Promise<R> {
  const sb = await supabaseServer();
  const { error } = await sb.rpc("storyboard_job_cancel", { p_job: input.jobId });
  if (error) return fail(error);
  revalidatePath(path(input.projectId, input.sequenceId));
  return { ok: true };
}
