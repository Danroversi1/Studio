// The result is uploaded: Studio inspects the stored object itself (type, size, checksum)
// before accepting it, exactly as for her own uploads.
import { verifyStoredObject } from "@/lib/assets/validate";
import { assertConfiguredBucket, getStorage } from "@/lib/storage";
import { deviceFrom, json, readJson } from "@/lib/local/server";
import { supabaseService } from "@/lib/supabase/server";

export async function POST(req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const who = await deviceFrom(req);
  if ("error" in who) return who.error;
  const body = await readJson<{ assetId?: string; meta?: Record<string, unknown> }>(req);
  const sb = supabaseService();
  const { data: a } = await sb.from("assets").select("id, storage_bucket, storage_key, mime_type, metadata, upload_status").eq("id", body?.assetId ?? "").maybeSingle();
  const meta = (a?.metadata ?? {}) as Record<string, unknown>;
  if (!a || meta.storyboard_job_id !== jobId || meta.renderer_device !== who.deviceId) return json({ error: "Upload not found." }, 404);
  if (a.upload_status === "pending") {
    assertConfiguredBucket(a.storage_bucket);
    const storage = await getStorage();
    const check = verifyStoredObject({ mimeType: a.mime_type, byteSize: Number(meta.declared_byte_size) }, await storage.inspect(a.storage_key, 16));
    if (!check.ok) { await sb.rpc("fail_asset_upload", { p_asset: a.id, p_reason: check.error }); return json({ error: check.error }, 422); }
    const { error } = await sb.rpc("complete_asset_upload", { p_asset: a.id, p_byte_size: check.value.byteSize, p_checksum_sha256: await storage.sha256(a.storage_key), p_mime_type: check.value.mimeType });
    if (error) return json({ error: "The upload couldn't be checked." }, 400);
  }
  const m = body?.meta ?? {};
  const clean = Object.fromEntries(Object.entries(m).filter(([k, v]) => /^[a-z_]{1,40}$/.test(k) && (typeof v === "string" ? v.length < 300 : typeof v === "number" || typeof v === "boolean")));
  const { data: applied, error } = await sb.rpc("local_job_complete", { p_job: jobId, p_device: who.deviceId, p_asset: a.id, p_meta: clean });
  if (error) return json({ error: error.message }, 400);
  return json({ ok: true, shown: !!applied });
}
