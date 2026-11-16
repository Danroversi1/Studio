// "Suggest Shots" (optional, on request): returns editable proposals; adds nothing by itself.
import { NextResponse } from "next/server";
import { aiConfigured } from "@/lib/ai/configured";
import { friendlyError } from "@/lib/errors";
import { scriptScenes } from "@/lib/storyboard/review";
import { runShotSuggestions } from "@/lib/storyboard/suggest";
import { supabaseServer } from "@/lib/supabase/server";

export const maxDuration = 120;

export async function POST(req: Request, { params }: { params: Promise<{ sequenceId: string }> }) {
  const { sequenceId } = await params;
  const body = (await req.json().catch(() => null)) as { scene?: number | null; moment?: string } | null;
  if (!aiConfigured()) return NextResponse.json({ error: "The AI team isn't set up yet." }, { status: 503 });
  const sb = await supabaseServer();
  const { data: seq } = await sb.from("storyboard_sequences").select("id, project_id, brief").eq("id", sequenceId).maybeSingle();
  if (!seq) return NextResponse.json({ error: "Storyboard not found." }, { status: 404 });
  let moment = (body?.moment ?? "").trim();
  if (body?.scene) {
    const { data: sp } = await sb.from("entities").select("id").eq("project_id", seq.project_id).eq("kind", "screenplay").order("created_at").limit(1).maybeSingle();
    const { data: v } = sp ? await sb.from("versions").select("content").eq("entity_id", sp.id).order("version_number", { ascending: false }).limit(1).maybeSingle() : { data: null };
    const sc = scriptScenes(String(v?.content?.body ?? "")).find((s) => s.number === body.scene);
    if (sc) moment = `${sc.heading}\n${sc.text}${moment ? `\n\n${moment}` : ""}`;
  }
  if (!moment) moment = seq.brief ?? "";
  if (!moment.trim()) return NextResponse.json({ error: "Pick a scene or describe the moment." }, { status: 400 });
  const { data: runId, error } = await sb.rpc("storyboard_suggest_request", { p_sequence: sequenceId, p_scope: { scene: body?.scene ?? null, moment: moment.slice(0, 8000) } });
  if (error) return NextResponse.json({ error: friendlyError(error).message }, { status: 400 });
  const { data: project } = await sb.from("projects").select("runtime:settings->>runtime").eq("id", seq.project_id).single();
  const r = await runShotSuggestions(String(runId), moment, (project as { runtime?: string } | null)?.runtime ?? null);
  if ("error" in r && r.error) return NextResponse.json({ error: r.error }, { status: 502 });
  const shots = (r.shots ?? []).map((s) => ({ action: s.action, why: s.why, size: s.size, angle: s.angle, durationS: s.durationS, source: s.source }));
  return NextResponse.json({ shots, refused: r.refused ?? [] }, { headers: { "Cache-Control": "no-store" } });
}
