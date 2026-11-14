// Artwork download. RLS decides whether the caller may see the asset row at all; only then
// is a short-lived signed URL issued. Unauthorized and nonexistent look identical (404).
import { NextResponse } from "next/server";
import { assertConfiguredBucket, getStorage } from "@/lib/storage";
import { supabaseServer } from "@/lib/supabase/server";

const DOWNLOAD_TTL_SECONDS = 5 * 60;

export async function GET(_request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await params;
  const sb = await supabaseServer();
  const { data: asset } = await sb.from("assets").select("storage_bucket, storage_key").eq("id", assetId).maybeSingle();
  if (!asset) return new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

  assertConfiguredBucket(asset.storage_bucket);
  const signed = await (await getStorage()).signDownload(asset.storage_key, DOWNLOAD_TTL_SECONDS);
  const res = NextResponse.redirect(signed.url, 302);
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}
