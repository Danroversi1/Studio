// Printable storyboard (browser "Save as PDF"), rendered locally from the editable frames.
import { notFound } from "next/navigation";
import { PrintSheet } from "@/components/storyboard/print-sheet";
import { cleanComposition, libraryUse } from "@/lib/storyboard/compose";
import { cleanShot, sequenceTiming } from "@/lib/storyboard/shot";
import { supabaseServer } from "@/lib/supabase/server";

export default async function PrintStoryboard({ params }: { params: Promise<{ sequenceId: string }> }) {
  const { sequenceId } = await params;
  const sb = await supabaseServer();
  const { data: seq } = await sb.from("storyboard_sequences").select("id, project_id, title, brief, settings").eq("id", sequenceId).maybeSingle();
  if (!seq) notFound();
  const aspect = Number((seq.settings as { aspect?: number } | null)?.aspect) || 16 / 9;
  const [{ data: project }, { data: shots }, { data: lib }] = await Promise.all([
    sb.from("projects").select("name").eq("id", seq.project_id).single(),
    sb.from("storyboard_shots").select("id, content, composition, state, locked, notes").eq("sequence_id", sequenceId).is("archived_at", null).order("position"),
    sb.from("storyboard_library").select("id, name, asset_id, attribution, source_url").eq("project_id", seq.project_id),
  ]);
  const byId = new Map((lib ?? []).map((i) => [i.id, i]));
  const frames = (shots ?? []).map((s) => {
    const c = cleanComposition(s.composition, aspect);
    return { id: s.id, content: cleanShot(s.content), notes: s.notes ?? "", state: s.state, locked: s.locked,
      composition: { ...c, layers: c.layers.map((l) => (l.libraryId && byId.get(l.libraryId)?.asset_id ? { ...l, assetId: byId.get(l.libraryId)!.asset_id as string } : l)) } };
  });
  const used = new Set(frames.flatMap((f) => libraryUse(f.composition)));
  const credits = [...used].map((id) => byId.get(id)).filter((i) => i && (i.attribution || i.source_url)).map((i) => `${i!.name}${i!.attribution ? ` — ${i!.attribution}` : ""}${i!.source_url ? ` (${i!.source_url})` : ""}`);
  return <PrintSheet project={project?.name ?? ""} title={seq.title} brief={seq.brief} frames={frames} totals={sequenceTiming(frames).label} credits={credits} />;
}
