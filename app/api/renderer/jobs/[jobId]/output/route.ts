// Reserve the result upload: a short-lived signed PUT for exactly one new asset key.
import { validateUploadIntent } from "@/lib/assets/validate";
import { assertConfiguredBucket, getStorage } from "@/lib/storage";
import { deviceFrom, json, readJson } from "@/lib/local/server";
import { supabaseService } from "@/lib/supabase/server";

export async function POST(req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const who = await deviceFrom(req);
  if ("error" in who) return who.error;
  const body = await readJson<{ mimeType?: string; byteSize?: number }>(req);
  const intent = validateUploadIntent({ entityId: "00000000-0000-4000-8000-000000000000", fileName: "local-frame.png", mimeType: body?.mimeType, byteSize: body?.byteSize });
  if (!intent.ok) return json({ error: intent.error }, 400);
  const { data, error } = await supabaseService().rpc("local_job_reserve_output", { p_job: jobId, p_device: who.deviceId, p_mime: intent.value.mimeType, p_byte_size: intent.value.byteSize });
  const row = (data as { asset_id: string; storage_bucket: string; storage_key: string }[] | null)?.[0];
  if (error || !row) return json({ error: error?.message ?? "Couldn't reserve the upload." }, error?.code === "PT409" ? 409 : 400);
  assertConfiguredBucket(row.storage_bucket);
  const up = await (await getStorage()).signUpload(row.storage_key, intent.value.mimeType, intent.value.byteSize, 10 * 60);
  return json({ assetId: row.asset_id, upload: { url: up.url, method: up.method, headers: up.headers } });
}
