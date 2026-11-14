// Step 1 of an artwork upload: reserve an asset (database authorizes and generates the key),
// then return a short-lived signed PUT URL for exactly that key.
import { NextResponse } from "next/server";
import { validateUploadIntent } from "@/lib/assets/validate";
import { friendlyError } from "@/lib/errors";
import { assertConfiguredBucket, getStorage } from "@/lib/storage";
import { supabaseServer } from "@/lib/supabase/server";

const UPLOAD_TTL_SECONDS = 10 * 60;

export async function POST(request: Request) {
  const intent = validateUploadIntent(await request.json().catch(() => null));
  if (!intent.ok) return NextResponse.json({ error: intent.error }, { status: 400 });

  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });

  const { data, error } = await sb.rpc("begin_asset_upload", {
    p_entity: intent.value.entityId,
    p_file_name: intent.value.fileName,
    p_mime_type: intent.value.mimeType,
    p_byte_size: intent.value.byteSize,
  });
  if (error || !data?.[0]) {
    const f = friendlyError(error);
    return NextResponse.json({ error: f.message }, { status: f.kind === "permission" ? 403 : f.kind === "not_found" ? 404 : 400 });
  }
  const row = data[0] as { asset_id: string; storage_bucket: string; storage_key: string };
  assertConfiguredBucket(row.storage_bucket);
  const storage = await getStorage();
  const upload = await storage.signUpload(row.storage_key, intent.value.mimeType, intent.value.byteSize, UPLOAD_TTL_SECONDS);
  return NextResponse.json(
    { assetId: row.asset_id, upload: { url: upload.url, method: upload.method, headers: upload.headers } },
    { headers: { "Cache-Control": "no-store" } },
  );
}
