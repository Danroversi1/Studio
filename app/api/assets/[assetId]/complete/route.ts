// Step 3 of an artwork upload: the server inspects the stored object itself and only then
// marks the asset ready (service role). The browser's word is never trusted.
import { NextResponse } from "next/server";
import { verifyStoredObject } from "@/lib/assets/validate";
import { assertConfiguredBucket, getStorage } from "@/lib/storage";
import { supabaseServer, supabaseService } from "@/lib/supabase/server";

export async function POST(_request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await params;
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });

  const service = supabaseService();
  const { data: asset } = await service
    .from("assets")
    .select("id, project_id, storage_bucket, storage_key, mime_type, metadata, upload_status, created_by")
    .eq("id", assetId)
    .maybeSingle();
  // Only the user who reserved the upload can finish it, and only while they can still edit.
  if (!asset || asset.created_by !== auth.user.id) return NextResponse.json({ error: "Upload not found." }, { status: 404 });
  const { data: caps } = await sb.rpc("my_project_capabilities", { p_project: asset.project_id });
  if (!caps?.can_edit) return NextResponse.json({ error: "Your access level does not allow uploads." }, { status: 403 });
  if (asset.upload_status !== "pending") return NextResponse.json({ error: `Upload is already ${asset.upload_status}.` }, { status: 409 });

  assertConfiguredBucket(asset.storage_bucket);
  const storage = await getStorage();
  const declared = { mimeType: asset.mime_type as string, byteSize: Number(asset.metadata?.declared_byte_size) };
  const check = verifyStoredObject(declared, await storage.inspect(asset.storage_key, 16));
  if (!check.ok) {
    await service.rpc("fail_asset_upload", { p_asset: assetId, p_reason: check.error });
    return NextResponse.json({ error: check.error }, { status: 422 });
  }
  const checksum = await storage.sha256(asset.storage_key);
  const { error } = await service.rpc("complete_asset_upload", {
    p_asset: assetId,
    p_byte_size: check.value.byteSize,
    p_checksum_sha256: checksum,
    p_mime_type: check.value.mimeType,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: error.code === "PT409" ? 409 : 400 });

  // Expired reservations are failed inside complete_asset_upload; report that honestly.
  const { data: after } = await service.from("assets").select("upload_status").eq("id", assetId).single();
  if (after?.upload_status !== "ready") {
    return NextResponse.json({ error: "The upload took too long and expired. Please upload again." }, { status: 410 });
  }
  return NextResponse.json({ ok: true, assetId });
}
