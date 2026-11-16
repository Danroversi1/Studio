// Machine-readable shot list + editable compositions (JSON). No AI.
import { NextResponse } from "next/server";
import { cleanComposition, libraryUse } from "@/lib/storyboard/compose";
import { cleanShot, sequenceTiming } from "@/lib/storyboard/shot";
import { supabaseServer } from "@/lib/supabase/server";

export async function GET(_req: Request, { params }: { params: Promise<{ sequenceId: string }> }) {
  const { sequenceId } = await params;
  const sb = await supabaseServer();
  const { data: seq } = await sb.from("storyboard_sequences").select("id, project_id, title, brief, settings, created_at, updated_at").eq("id", sequenceId).maybeSingle();
  if (!seq) return new NextResponse("Not found", { status: 404 });
  const [{ data: shots }, { data: lib }] = await Promise.all([
    sb.from("storyboard_shots").select("id, position, state, locked, origin, revision, approved_revision, content, composition, composition_version, illustration_asset_id, notes, review, look")
      .eq("sequence_id", sequenceId).is("archived_at", null).order("position"),
    sb.from("storyboard_library").select("id, kind, name, asset_id, entity_id, views, purpose, note, usage, source_url, attribution, permission, origin, version").eq("project_id", seq.project_id),
  ]);
  const list = (shots ?? []).map((s) => ({ ...s, content: cleanShot(s.content), composition: cleanComposition(s.composition) }));
  const used = new Set(list.flatMap((s) => libraryUse(s.composition)));
  const t = sequenceTiming(list);
  const out = {
    format: "studio-storyboard", version: 2, exported_at: new Date().toISOString(),
    storyboard: { id: seq.id, title: seq.title, brief: seq.brief, settings: seq.settings },
    timing: { proposed_total_seconds: t.totalS, frames_without_duration: t.missing, note: "Durations are proposals, not measured timings." },
    frames: list.map((s, i) => ({
      number: i + 1, id: s.id, state: s.state, locked: s.locked, proposed_by: s.origin, version: s.revision, approved_version: s.approved_revision,
      ...s.content, notes: s.notes, needs_review: s.review, composition: s.composition, composition_version: s.composition_version, ai_illustration_asset_id: s.illustration_asset_id, look_and_feel: s.look ?? { mode: "default" },
    })),
    library: (lib ?? []).filter((i) => used.has(i.id)),
    disclaimer: "Storyboard frames are planning drawings, not production specifications. Camera values are notes, not optical simulation.",
  };
  const name = seq.title.replace(/[^A-Za-z0-9 _-]/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "storyboard";
  return new NextResponse(JSON.stringify(out, null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${name}-storyboard.json"`, "Cache-Control": "no-store" },
  });
}
