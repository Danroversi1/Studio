// Machine-readable shot list (JSON) for one storyboard.
import { NextResponse } from "next/server";
import { cleanShot, sequenceTiming } from "@/lib/storyboard/shot";
import { supabaseServer } from "@/lib/supabase/server";

export async function GET(_req: Request, { params }: { params: Promise<{ sequenceId: string }> }) {
  const { sequenceId } = await params;
  const sb = await supabaseServer();
  const { data: seq } = await sb.from("storyboard_sequences").select("id, project_id, title, brief, settings, created_at, updated_at").eq("id", sequenceId).maybeSingle();
  if (!seq) return new NextResponse("Not found", { status: 404 });
  const [{ data: shots }, { data: refs }] = await Promise.all([
    sb.from("storyboard_shots").select("id, position, state, locked, origin, revision, approved_revision, content, frame_asset_id, look_asset_id, notes, review")
      .eq("sequence_id", sequenceId).is("archived_at", null).order("position"),
    sb.from("storyboard_refs").select("id, shot_id, role, title, borrow, ignore, access, url, attribution, asset_id, entity_id").eq("sequence_id", sequenceId),
  ]);
  const list = (shots ?? []).map((s) => ({ ...s, content: cleanShot(s.content) }));
  const t = sequenceTiming(list);
  const out = {
    format: "studio-storyboard", version: 1, exported_at: new Date().toISOString(),
    storyboard: { id: seq.id, title: seq.title, brief: seq.brief, settings: seq.settings },
    timing: { proposed_total_seconds: t.totalS, shots_without_duration: t.missing, note: "Durations are proposals, not measured timings." },
    shots: list.map((s, i) => ({
      number: i + 1, id: s.id, state: s.state, locked: s.locked, proposed_by: s.origin, revision: s.revision, approved_revision: s.approved_revision,
      ...s.content, frame_asset_id: s.frame_asset_id, look_asset_id: s.look_asset_id, notes: s.notes, needs_review: s.review,
    })),
    references: refs ?? [],
    disclaimer: "Storyboard images are planning drawings, not production specifications. Camera and lens values are creative guidance.",
  };
  const name = seq.title.replace(/[^A-Za-z0-9 _-]/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "storyboard";
  return new NextResponse(JSON.stringify(out, null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${name}-shot-list.json"`, "Cache-Control": "no-store" },
  });
}
