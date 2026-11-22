"use server";
// Storyboards: every routine action here is plain data editing. Nothing in this file calls
// or imports an AI model (verified by tests/unit/no-model-calls.test.ts).
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { friendlyError, withMessage } from "@/lib/errors";
import { cleanComposition, emptyComposition } from "@/lib/storyboard/compose";
import { scriptScenes } from "@/lib/storyboard/review";
import { cleanShot } from "@/lib/storyboard/shot";
import { supabaseServer } from "@/lib/supabase/server";

type R = { ok: true; id?: string; n?: number } | { ok: false; error: string; conflict?: boolean };
const fail = (e: { code?: string; message?: string } | null): R => ({ ok: false, error: friendlyError(e).message, conflict: e?.code === "PT409" });
const path = (p: string, s?: string) => `/projects/${p}/storyboards${s ? `/${s}` : ""}`;

/** Start a storyboard from text, script scenes and/or images (combinable). No AI. */
export async function createStoryboard(fd: FormData) {
  const projectId = String(fd.get("projectId") ?? "");
  const title = String(fd.get("title") ?? "").trim() || "New storyboard";
  const brief = String(fd.get("brief") ?? "").trim();
  const aspect = Number(fd.get("aspect")) || 16 / 9;
  const sceneNums = fd.getAll("scene").map(Number).filter((n) => n > 0);
  const withImages = fd.get("images") === "1";
  const sb = await supabaseServer();
  let scenes: { number: number; heading: string; text: string }[] = [];
  if (sceneNums.length) {
    const { data: sp } = await sb.from("entities").select("id").eq("project_id", projectId).eq("kind", "screenplay").order("created_at").limit(1).maybeSingle();
    if (sp) {
      const { data: v } = await sb.from("versions").select("content").eq("entity_id", sp.id).order("version_number", { ascending: false }).limit(1).maybeSingle();
      scenes = scriptScenes(String(v?.content?.body ?? "")).filter((s) => sceneNums.includes(s.number)).slice(0, 12);
    }
  }
  const paths = [brief ? "text" : "", scenes.length ? "script" : "", withImages ? "images" : ""].filter(Boolean);
  const { data: id, error } = await sb.rpc("storyboard_create", {
    p_project: projectId, p_title: title, p_brief: brief,
    p_entry: { paths, scenes: scenes.map((s) => ({ number: s.number, heading: s.heading, text: s.text.slice(0, 4000) })) },
  });
  if (error) redirect(withMessage(path(projectId), "error", friendlyError(error).message));
  await sb.rpc("storyboard_update", { p_sequence: id, p_title: null, p_brief: null, p_settings: { aspect } });
  // One empty frame per chosen scene (her own words as the frame's action), or one frame.
  const firsts = scenes.length
    ? scenes.map((s) => ({ action: s.text.split("\n").find((l) => l.trim())?.slice(0, 600) ?? s.heading, source: { kind: "script", scene: s.number, heading: s.heading, excerpt: s.text.slice(0, 2000) } }))
    : [{ action: brief.slice(0, 1200), source: { kind: "text", excerpt: brief.slice(0, 2000) } }];
  for (const c of firsts) {
    await sb.rpc("storyboard_shot_save", { p_sequence: id, p_shot: null, p_content: cleanShot(c), p_origin: "director", p_position: null, p_expected_revision: null, p_composition: emptyComposition(aspect) });
  }
  revalidatePath(`/projects/${projectId}`, "layout");
  redirect(`${path(projectId, id as string)}${withImages ? "?panel=assets" : ""}`);
}

export async function updateStoryboard(input: { projectId: string; sequenceId: string; title?: string; brief?: string; settings?: Record<string, unknown> }): Promise<R> {
  const sb = await supabaseServer();
  const { error } = await sb.rpc("storyboard_update", { p_sequence: input.sequenceId, p_title: input.title ?? null, p_brief: input.brief ?? null, p_settings: input.settings ?? null });
  return error ? fail(error) : { ok: true };
}

export async function archiveStoryboard(fd: FormData) {
  const projectId = String(fd.get("projectId")), sequenceId = String(fd.get("sequenceId"));
  const sb = await supabaseServer();
  const { error } = await sb.rpc("storyboard_archive", { p_sequence: sequenceId });
  if (error) redirect(withMessage(path(projectId, sequenceId), "error", friendlyError(error).message));
  revalidatePath(`/projects/${projectId}`, "layout");
  redirect(withMessage(path(projectId), "notice", "Storyboard removed. Its pictures stay in the film."));
}

/** "Add a Frame" (optionally after another, with a starting composition). */
export async function addFrame(input: { projectId: string; sequenceId: string; position: number | null; content?: unknown; composition?: unknown; origin?: "director" | "agent" }): Promise<R> {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("storyboard_shot_save", {
    p_sequence: input.sequenceId, p_shot: null, p_content: cleanShot(input.content ?? { action: "" }), p_origin: input.origin ?? "director",
    p_position: input.position, p_expected_revision: null, p_composition: input.composition ? cleanComposition(input.composition) : null,
  });
  return error ? fail(error) : { ok: true, id: data as string };
}

/** Frame details (action, dialogue, what to notice, camera notes, duration). */
export async function saveFrameDetails(input: { sequenceId: string; shotId: string; content: unknown; expectedRevision: number }): Promise<R> {
  const sb = await supabaseServer();
  const { error } = await sb.rpc("storyboard_shot_save", {
    p_sequence: input.sequenceId, p_shot: input.shotId, p_content: cleanShot(input.content), p_origin: "director",
    p_position: null, p_expected_revision: input.expectedRevision, p_composition: null,
  });
  return error ? fail(error) : { ok: true };
}

/** Autosave of the editable composition (debounced by the editor; no version row). */
export async function saveComposition(input: { shotId: string; composition: unknown; expectedVersion: number }): Promise<R> {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("storyboard_shot_compose", { p_shot: input.shotId, p_composition: cleanComposition(input.composition), p_expected_version: input.expectedVersion });
  return error ? fail(error) : { ok: true, n: data as number };
}

/** Keep a trace made in her browser: plain vector paths plus the settings and references it
 *  came from, so it can be made again. The database refuses anything but path data. */
export async function saveTrace(input: {
  projectId: string; shotId: string | null; treatment: string; settings: Record<string, unknown>; source: unknown[];
  width: number; height: number; paths: { d: string; f?: string; s?: string; w?: number }[];
}): Promise<R> {
  const sb = await supabaseServer();
  const paths = input.paths.map((p) => {
    const o: Record<string, unknown> = { d: String(p.d) };
    if (p.f) o.f = p.f; if (p.s) o.s = p.s; if (typeof p.w === "number") o.w = Math.round(p.w * 100) / 100;
    return o;
  });
  const { data, error } = await sb.rpc("storyboard_trace_save", {
    p_project: input.projectId, p_shot: input.shotId, p_treatment: input.treatment, p_settings: input.settings, p_source: input.source,
    p_width: Math.round(input.width), p_height: Math.round(input.height), p_paths: paths,
  });
  return error ? fail(error) : { ok: true, id: data as string };
}

/** The film's treatment preset, used across boards. */
export async function saveTreatmentPreset(input: { projectId: string; settings: Record<string, unknown>; expectedVersion: number | null }): Promise<R> {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("storyboard_treatment_save", { p_project: input.projectId, p_settings: input.settings, p_expected_version: input.expectedVersion });
  return error ? fail(error) : { ok: true, n: data as number };
}

/** "Save": record a version of the frame. */
export async function saveVersion(input: { shotId: string }): Promise<R> {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("storyboard_shot_snapshot", { p_shot: input.shotId });
  return error ? fail(error) : { ok: true, n: data as number };
}

export async function restoreVersion(input: { shotId: string; revision: number }): Promise<R> {
  const sb = await supabaseServer();
  const { error } = await sb.rpc("storyboard_shot_restore", { p_shot: input.shotId, p_revision: input.revision });
  return error ? fail(error) : { ok: true };
}

export async function duplicateFrame(input: { shotId: string; composition: unknown }): Promise<R> {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("storyboard_shot_duplicate", { p_shot: input.shotId, p_composition: cleanComposition(input.composition) });
  return error ? fail(error) : { ok: true, id: data as string };
}

export async function moveFrame(input: { shotId: string; position: number }): Promise<R> {
  const sb = await supabaseServer();
  const { error } = await sb.rpc("storyboard_shot_move", { p_shot: input.shotId, p_position: input.position });
  return error ? fail(error) : { ok: true };
}

export async function setFrameState(input: { shotId: string; state?: "proposed" | "approved" | null; locked?: boolean | null }): Promise<R> {
  const sb = await supabaseServer();
  const { error } = await sb.rpc("storyboard_shot_state", { p_shot: input.shotId, p_state: input.state ?? null, p_locked: input.locked ?? null });
  return error ? fail(error) : { ok: true };
}

export async function saveFrameNotes(input: { shotId: string; notes: string }): Promise<R> {
  const sb = await supabaseServer();
  const { error } = await sb.rpc("storyboard_shot_notes", { p_shot: input.shotId, p_notes: input.notes });
  return error ? fail(error) : { ok: true };
}

export async function removeFrame(input: { shotId: string }): Promise<R> {
  const sb = await supabaseServer();
  const { error } = await sb.rpc("storyboard_shot_archive", { p_shot: input.shotId });
  return error ? fail(error) : { ok: true };
}

export async function clearReview(input: { shotId: string }): Promise<R> {
  const sb = await supabaseServer();
  const { error } = await sb.rpc("storyboard_shot_review", { p_shot: input.shotId, p_review: null });
  return error ? fail(error) : { ok: true };
}

export async function pickIllustration(input: { shotId: string; assetId: string | null }): Promise<R> {
  const sb = await supabaseServer();
  const { error } = await sb.rpc("storyboard_shot_pick", { p_shot: input.shotId, p_asset: input.assetId });
  return error ? fail(error) : { ok: true };
}

// ---- Asset library -----------------------------------------------------------------------
export async function saveLibraryItem(input: { projectId: string; itemId: string | null; data: Record<string, unknown> }): Promise<R> {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("storyboard_library_save", { p_project: input.projectId, p_item: input.itemId, p_data: input.data });
  return error ? fail(error) : { ok: true, id: data as string };
}

export async function libraryUsage(input: { itemId: string }): Promise<{ ok: true; frames: { shot_id: string; sequence_title: string; frame_number: number; locked: boolean }[] } | { ok: false; error: string }> {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("storyboard_library_usage", { p_item: input.itemId });
  return error ? { ok: false, error: friendlyError(error).message } : { ok: true, frames: (data ?? []) as never };
}

/** Replace a shared asset everywhere; expectedFrames is the count she was shown. */
export async function replaceLibrarySource(input: { itemId: string; assetId: string; expectedFrames: number }): Promise<R> {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("storyboard_library_replace", { p_item: input.itemId, p_asset: input.assetId, p_expected_frames: input.expectedFrames });
  return error ? fail(error) : { ok: true, n: data as number };
}

export async function archiveLibraryItem(input: { itemId: string }): Promise<R> {
  const sb = await supabaseServer();
  const { error } = await sb.rpc("storyboard_library_archive", { p_item: input.itemId });
  return error ? fail(error) : { ok: true };
}

/** Lens shelf: a lens she picked (usually from Lens Addiction) with her own notes. */
export async function saveLens(input: { projectId: string; lensId: string | null; data: Record<string, unknown> }): Promise<R> {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("storyboard_lens_save", { p_project: input.projectId, p_item: input.lensId, p_data: input.data });
  return error ? fail(error) : { ok: true, id: data as string };
}

export async function archiveLens(input: { lensId: string }): Promise<R> {
  const sb = await supabaseServer();
  const { error } = await sb.rpc("storyboard_lens_archive", { p_item: input.lensId });
  return error ? fail(error) : { ok: true };
}

export async function cancelJob(input: { jobId: string }): Promise<R> {
  const sb = await supabaseServer();
  const { error } = await sb.rpc("storyboard_job_cancel", { p_job: input.jobId });
  return error ? fail(error) : { ok: true };
}

export async function refreshStoryboard(input: { projectId: string; sequenceId: string }) {
  revalidatePath(path(input.projectId, input.sequenceId));
}
