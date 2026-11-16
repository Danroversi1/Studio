// Progress from her computer. The reply says whether she asked to cancel.
import { deviceFrom, json, readJson } from "@/lib/local/server";
import { supabaseService } from "@/lib/supabase/server";

export async function POST(req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const who = await deviceFrom(req);
  if ("error" in who) return who.error;
  const body = await readJson<{ stage?: string; pct?: number; message?: string }>(req);
  const progress = { stage: String(body?.stage ?? "working").slice(0, 40), pct: Math.max(0, Math.min(100, Number(body?.pct) || 0)), message: String(body?.message ?? "").slice(0, 300) };
  const { data, error } = await supabaseService().rpc("local_job_progress", { p_job: jobId, p_device: who.deviceId, p_progress: progress });
  if (error) return json({ error: "Job not found." }, 404);
  return json({ cancel: !!data });
}
