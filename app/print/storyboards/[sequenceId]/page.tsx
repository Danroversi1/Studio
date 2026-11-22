// Printable storyboard (browser "Save as PDF"), rendered locally from the editable frames.
import { notFound } from "next/navigation";
import { PrintSheet } from "@/components/storyboard/print-sheet";
import { cleanComposition, libraryUse } from "@/lib/storyboard/compose";
import { cleanShot, sequenceTiming } from "@/lib/storyboard/shot";
import { loadTraces } from "@/lib/storyboard/traces-data";
import { supabaseServer } from "@/lib/supabase/server";

export default async function PrintStoryboard({ params }: { params: Promise<{ sequenceId: string }> }) {
  const { sequenceId } = await params;
  const sb = await supabaseServer();
  const { data: seq } = await sb.from("storyboard_sequences").select("id, project_id, title, brief, settings").eq("id", sequenceId).maybeSingle();
  if (!seq) notFound();
  const aspect = Number((seq.settings as { aspect?: number } | null)?.aspect) || 16 / 9;
  const [{ data: project }, { data: shots }, { data: lib }, { data: lensRows }] = await Promise.all([
    sb.from("projects").select("name").eq("id", seq.project_id).single(),
    sb.from("storyboard_shots").select("id, content, composition, state, locked, notes, illustration_asset_id").eq("sequence_id", sequenceId).is("archived_at", null).order("position"),
    sb.from("storyboard_library").select("id, name, asset_id, attribution, source_url").eq("project_id", seq.project_id),
    sb.from("storyboard_lens_shelf").select("id, name, source_name, source_url").eq("project_id", seq.project_id),
  ]);
  const lensName = new Map((lensRows ?? []).map((l) => [l.id as string, l.name as string]));
  const byId = new Map((lib ?? []).map((i) => [i.id, i]));
  const frames = (shots ?? []).map((s) => {
    const c = cleanComposition(s.composition, aspect);
    const content = cleanShot(s.content);
    return { id: s.id, content, picture: (s.illustration_asset_id as string | null) ?? null, lensName: content.lensId ? lensName.get(content.lensId) ?? null : null, notes: s.notes ?? "", state: s.state, locked: s.locked,
      composition: { ...c, layers: c.layers.map((l) => (l.libraryId && byId.get(l.libraryId)?.asset_id ? { ...l, assetId: byId.get(l.libraryId)!.asset_id as string } : l)) } };
  });
  const used = new Set(frames.flatMap((f) => libraryUse(f.composition)));
  const lensesUsed = new Set(frames.map((f) => f.content.lensId).filter(Boolean));
  const lensCredits = (lensRows ?? []).filter((l) => lensesUsed.has(l.id) && l.source_url).map((l) => `Lens: ${l.name} — via ${l.source_name || "link"} (${l.source_url})`);
  const credits = [...used].map((id) => byId.get(id)).filter((i) => i && (i.attribution || i.source_url)).map((i) => `${i!.name}${i!.attribution ? ` — ${i!.attribution}` : ""}${i!.source_url ? ` (${i!.source_url})` : ""}`);
  const traces = await loadTraces(sb, frames.map((f) => f.composition));
  return <PrintSheet traces={traces} project={project?.name ?? ""} title={seq.title} brief={seq.brief} frames={frames} totals={sequenceTiming(frames).label} credits={[...credits, ...lensCredits]} />;
}
