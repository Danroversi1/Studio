// A Look & Feel direction's reference bundle (one version), for a future renderer or export:
// references with their role, access, her notes, permissions and asset IDs — not the whole
// library. Same sign-in and film permissions as the rest of STUDIO. No model involved.
import { NextResponse } from "next/server";
import { friendlyError } from "@/lib/errors";
import { supabaseServer } from "@/lib/supabase/server";

export async function GET(req: Request, { params }: { params: Promise<{ directionId: string }> }) {
  const { directionId } = await params;
  const v = new URL(req.url).searchParams.get("version");
  const version = v && /^\d{1,6}$/.test(v) ? Number(v) : null;
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const { data, error } = await sb.rpc("look_bundle", { p_dir: directionId, p_version: version });
  if (error) {
    const f = friendlyError(error);
    return NextResponse.json({ error: f.message }, { status: f.kind === "permission" ? 403 : f.kind === "not_found" ? 404 : 400 });
  }
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
