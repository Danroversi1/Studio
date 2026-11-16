"use server";
// Local rendering (her side): pair a computer, submit one frame, cancel, check progress.
// Nothing here calls a model or a cloud image service; generation happens on her computer.
import { friendlyError } from "@/lib/errors";
import type { DeviceRow } from "@/lib/local/types";
import { supabaseServer } from "@/lib/supabase/server";

type R<T = undefined> = ({ ok: true } & (T extends undefined ? object : { data: T })) | { ok: false; error: string };
const fail = (e: { code?: string; message?: string } | null) => ({ ok: false as const, error: friendlyError(e).message });

export async function startPairing(): Promise<R<string>> {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("renderer_pair_start");
  return error ? fail(error) : { ok: true, data: data as string };
}

export async function revokeDevice(input: { deviceId: string }): Promise<R> {
  const sb = await supabaseServer();
  const { error } = await sb.rpc("renderer_revoke", { p_device: input.deviceId });
  return error ? fail(error) : { ok: true };
}

export async function saveManualHardware(input: { deviceId: string; gpu: string; vramGb: string; notes: string }): Promise<R> {
  const sb = await supabaseServer();
  const { error } = await sb.rpc("renderer_set_manual", { p_device: input.deviceId, p_manual: { gpu: input.gpu, vramGb: input.vramGb, notes: input.notes } });
  return error ? fail(error) : { ok: true };
}

export async function myDevices(): Promise<DeviceRow[]> {
  const sb = await supabaseServer();
  const { data } = await sb.from("renderer_devices").select("id, name, report, last_seen_at, created_at, revoked_at").is("revoked_at", null).order("created_at");
  return (data ?? []).map((d) => ({ id: d.id, name: d.name, report: (d.report ?? {}) as DeviceRow["report"], lastSeenAt: d.last_seen_at, createdAt: d.created_at, revokedAt: d.revoked_at }));
}

export async function requestLocalJob(input: {
  shotId: string; deviceId: string; workflow: string; prompt: string; params: Record<string, unknown>; bundle: Record<string, unknown>; baseAssetId: string | null; key: string;
}): Promise<R<string>> {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("local_job_request", {
    p_shot: input.shotId, p_device: input.deviceId, p_workflow: input.workflow, p_prompt: input.prompt, p_params: input.params,
    p_bundle: input.bundle, p_base_asset: input.baseAssetId, p_idempotency_key: input.key,
  });
  return error ? fail(error) : { ok: true, data: data as string };
}

export async function cancelLocalJob(input: { jobId: string }): Promise<R<string>> {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("local_job_cancel", { p_job: input.jobId });
  return error ? fail(error) : { ok: true, data: data as string };
}

export interface LocalJob {
  id: string; shotId: string | null; status: string; createdAt: string; startedAt: string | null; completedAt: string | null;
  progress: { stage?: string; pct?: number; message?: string; local_file?: string } | null; cancelRequested: boolean; error: string | null;
  outputAssetId: string | null; applied: boolean; workflow: string; params: Record<string, unknown>; usage: Record<string, unknown> | null;
  bundle: Record<string, unknown> | null; deviceId: string | null;
}

/** Local jobs for one storyboard (polled while something is running). */
export async function localJobs(input: { sequenceId: string }): Promise<LocalJob[]> {
  const sb = await supabaseServer();
  const { data } = await sb.from("storyboard_jobs")
    .select("id, shot_id, status, created_at, started_at, completed_at, progress, cancel_requested_at, error, output_asset_id, applied, model, params, usage, bundle, device_id")
    .eq("sequence_id", input.sequenceId).eq("kind", "local").order("created_at", { ascending: false }).limit(60);
  return (data ?? []).map((j) => ({
    id: j.id, shotId: j.shot_id, status: j.status, createdAt: j.created_at, startedAt: j.started_at, completedAt: j.completed_at,
    progress: j.progress as LocalJob["progress"], cancelRequested: !!j.cancel_requested_at, error: j.error, outputAssetId: j.output_asset_id,
    applied: !!j.applied, workflow: j.model, params: (j.params ?? {}) as Record<string, unknown>, usage: j.usage as Record<string, unknown> | null,
    bundle: j.bundle as Record<string, unknown> | null, deviceId: j.device_id,
  }));
}
