// The companion checks in (reporting what it can do) and receives at most one job she
// submitted for this computer, with short-lived download links for exactly that job's
// input images. Nothing else from the project is sent.
import { assertConfiguredBucket, getStorage } from "@/lib/storage";
import { deviceFrom, json, readJson } from "@/lib/local/server";
import { supabaseService } from "@/lib/supabase/server";

export async function POST(req: Request) {
  const body = await readJson<{ report?: unknown; active?: string[] }>(req);
  const who = await deviceFrom(req, body?.report ?? null);
  if ("error" in who) return who.error;
  const active = (body?.active ?? []).filter((x) => typeof x === "string" && /^[0-9a-f-]{36}$/.test(x)).slice(0, 5);
  const sb = supabaseService();
  const { data: jobId, error } = await sb.rpc("local_job_claim", { p_device: who.deviceId, p_active: active });
  if (error) return json({ error: "Studio couldn't check for jobs." }, 500);
  if (!jobId) return json({ job: null, pollSeconds: 5 });
  const { data: j } = await sb.from("storyboard_jobs").select("id, model, prompt, params, bundle, reference_assets").eq("id", jobId).single();
  const refs = (j?.reference_assets ?? []) as { asset_id: string; role: string }[];
  const { data: assets } = await sb.from("assets").select("id, storage_bucket, storage_key, mime_type").in("id", refs.map((r) => r.asset_id));
  const storage = await getStorage();
  const labels = new Map(((j?.bundle as { inputs?: { asset_id: string; label?: string }[] })?.inputs ?? []).map((i) => [i.asset_id, i.label ?? ""]));
  const inputs = [];
  for (const r of refs) {
    const a = assets?.find((x) => x.id === r.asset_id);
    if (!a) {
      await sb.rpc("local_job_fail", { p_job: jobId, p_device: who.deviceId, p_code: "missing_input", p_message: "A reference picture is no longer in the film.", p_meta: null });
      return json({ job: null, pollSeconds: 5 });
    }
    assertConfiguredBucket(a.storage_bucket);
    const signed = await storage.signDownload(a.storage_key, 15 * 60);
    inputs.push({ role: r.role, assetId: a.id, label: labels.get(a.id) ?? "", mime: a.mime_type, url: signed.url, headers: signed.headers });
  }
  return json({ job: { id: j!.id, workflow: j!.model, prompt: j!.prompt, params: j!.params, inputs }, pollSeconds: 2 });
}
