"use server";
// Look & Feel: plain data editing. Nothing here calls or imports a model
// (checked by tests/unit/no-model-calls.test.ts).
import { revalidatePath } from "next/cache";
import { friendlyError } from "@/lib/errors";
import { supabaseServer } from "@/lib/supabase/server";

type R = { ok: true; id?: string; n?: number; version?: number } | { ok: false; error: string; conflict?: boolean };
const fail = (e: { code?: string; message?: string } | null): R => ({ ok: false, error: friendlyError(e).message, conflict: e?.code === "PT409" });
const touch = (projectId: string) => { revalidatePath(`/projects/${projectId}/treatment`); revalidatePath(`/projects/${projectId}/storyboards`, "layout"); };

/** The film's Look & Feel owner (for uploads). */
export async function lookOwner(input: { projectId: string }): Promise<R> {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("look_owner_entity", { p_project: input.projectId });
  return error ? fail(error) : { ok: true, id: data as string };
}

/** An image with these exact bytes already in the film (so it isn't stored twice). */
export async function findLookAsset(input: { projectId: string; sha256: string }): Promise<{ assetId: string | null; thumbAssetId: string | null }> {
  const sb = await supabaseServer();
  const { data } = await sb.rpc("look_find_asset", { p_project: input.projectId, p_sha256: input.sha256 });
  const row = (data as { asset_id: string; thumb_asset_id: string | null }[] | null)?.[0];
  return { assetId: row?.asset_id ?? null, thumbAssetId: row?.thumb_asset_id ?? null };
}

export async function saveLookRef(input: { projectId: string; refId: string | null; data: Record<string, unknown> }): Promise<R> {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("look_reference_save", { p_project: input.projectId, p_ref: input.refId, p_data: input.data });
  if (error) return fail(error);
  touch(input.projectId);
  return { ok: true, id: data as string };
}

export async function moveLookRef(input: { projectId: string; refId: string; position: number }): Promise<R> {
  const sb = await supabaseServer();
  const { error } = await sb.rpc("look_reference_move", { p_ref: input.refId, p_position: input.position });
  if (error) return fail(error);
  touch(input.projectId);
  return { ok: true };
}

/** Remove from the collection; the image stays wherever else it's used. */
export async function removeLookRef(input: { projectId: string; refId: string }): Promise<R> {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("look_reference_remove", { p_ref: input.refId });
  if (error) return fail(error);
  touch(input.projectId);
  return { ok: true, n: data as number };
}

export async function saveDirection(input: { projectId: string; directionId: string | null; data: Record<string, unknown>; expectedVersion: number | null }): Promise<R> {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("look_direction_save", { p_project: input.projectId, p_dir: input.directionId, p_data: input.data, p_expected_version: input.expectedVersion });
  if (error) return fail(error);
  const row = (data as { direction_id: string; version: number; flagged: number }[])[0];
  touch(input.projectId);
  return { ok: true, id: row.direction_id, version: row.version, n: row.flagged };
}

export async function setDefaultDirection(input: { projectId: string; directionId: string | null }): Promise<R> {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("look_direction_set_default", { p_project: input.projectId, p_dir: input.directionId });
  if (error) return fail(error);
  touch(input.projectId);
  return { ok: true, n: data as number };
}

export async function moveDirection(input: { projectId: string; directionId: string; position: number }): Promise<R> {
  const sb = await supabaseServer();
  const { error } = await sb.rpc("look_direction_move", { p_dir: input.directionId, p_position: input.position });
  if (error) return fail(error);
  touch(input.projectId);
  return { ok: true };
}

export async function setSequenceLook(input: { projectId: string; sequenceId: string; directionId: string | null }): Promise<R> {
  const sb = await supabaseServer();
  const { error } = await sb.rpc("storyboard_sequence_look", { p_sequence: input.sequenceId, p_direction: input.directionId });
  if (error) return fail(error);
  touch(input.projectId);
  return { ok: true };
}

export async function setFrameLook(input: { projectId: string; shotId: string; look: Record<string, unknown> | null }): Promise<R> {
  const sb = await supabaseServer();
  const { error } = await sb.rpc("storyboard_shot_look", { p_shot: input.shotId, p_look: input.look });
  if (error) return fail(error);
  touch(input.projectId);
  return { ok: true };
}
