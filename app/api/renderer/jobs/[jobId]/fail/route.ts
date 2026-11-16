// A failure (or a confirmed stop) on her computer. Studio never retries by itself.
import { deviceFrom, json, readJson } from "@/lib/local/server";
import { supabaseService } from "@/lib/supabase/server";

const CODES = new Set(["cancelled", "out_of_memory", "missing_model", "workflow_not_ready", "renderer_unreachable", "renderer_error", "bad_input", "upload_failed", "missing_input", "timeout"]);

export async function POST(req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const who = await deviceFrom(req);
  if ("error" in who) return who.error;
  const body = await readJson<{ code?: string; message?: string; localFile?: string }>(req);
  const code = CODES.has(body?.code ?? "") ? body!.code! : "renderer_error";
  // Only the file NAME is recorded (never a path on her computer).
  const localFile = typeof body?.localFile === "string" ? body.localFile.split(/[\\/]/).pop()!.slice(0, 120) : undefined;
  await supabaseService().rpc("local_job_fail", { p_job: jobId, p_device: who.deviceId, p_code: code, p_message: String(body?.message ?? "").slice(0, 1000), p_meta: localFile ? { local_file: localFile } : null });
  return json({ ok: true });
}
