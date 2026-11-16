// The treatment's current slide list (permanent IDs and label text), read fresh from the
// deck's embed page so slides she just added or moved show up. Only for a Slides deck
// linked to this film; no sign-in, no AI. Keeps the list with the treatment.
import { NextResponse } from "next/server";
import { parseEmbedSlides } from "@/lib/google/embed-slides";
import { trimSlides } from "@/lib/slide-match";
import { supabaseServer } from "@/lib/supabase/server";

export const maxDuration = 30;
const FILE_RE = /^[A-Za-z0-9_-]{10,200}$/;

export async function GET(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const file = new URL(req.url).searchParams.get("file") ?? "";
  const no = (status: number, error: string) => NextResponse.json({ slides: null, error }, { status, headers: { "Cache-Control": "no-store" } });
  if (!FILE_RE.test(file)) return no(400, "Unknown treatment.");
  const sb = await supabaseServer();
  // RLS: only someone on this film sees its references.
  const { data: refs } = await sb.from("research_references").select("id").eq("project_id", projectId)
    .like("source_url", `%/presentation/d/${file}%`).limit(1);
  if (!refs?.length) return no(404, "That treatment isn't linked to this film.");
  let html = "";
  try {
    const res = await fetch(`https://docs.google.com/presentation/d/${file}/embed?rm=minimal`, { cache: "no-store", redirect: "follow", signal: AbortSignal.timeout(15000) });
    if (res.ok && new URL(res.url).hostname === "docs.google.com") html = await res.text();
  } catch {}
  const slides = trimSlides(parseEmbedSlides(html));
  if (!slides.length) return no(200, "Google didn't share the slides (is the treatment shared \"anyone with the link\"?).");
  await sb.rpc("save_treatment_slides", { p_project: projectId, p_file: file, p_slides: slides }); // best effort
  return NextResponse.json({ slides }, { headers: { "Cache-Control": "no-store" } });
}
