// Printable storyboard (use the browser's "Save as PDF"). Numbered frames with action,
// dialogue, notes and proposed durations; camera/lens/look details optional; credits for
// references. Storyboard images are planning drawings, not production specifications.
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/storyboard/print-button";
import { formatOf } from "@/lib/storyboard/camera";
import { ROLE_LABELS } from "@/lib/storyboard/prompt";
import { ANGLES, cleanShot, FOCUS, formatSeconds, labelOf, sequenceTiming, SIZES } from "@/lib/storyboard/shot";
import { supabaseServer } from "@/lib/supabase/server";

export default async function PrintStoryboard({ params, searchParams }: {
  params: Promise<{ sequenceId: string }>; searchParams: Promise<{ meta?: string; per?: string }>;
}) {
  const { sequenceId } = await params;
  const { meta, per } = await searchParams;
  const sb = await supabaseServer();
  const { data: seq } = await sb.from("storyboard_sequences").select("id, project_id, title, brief, settings").eq("id", sequenceId).maybeSingle();
  if (!seq) notFound();
  const [{ data: project }, { data: shots }, { data: refs }] = await Promise.all([
    sb.from("projects").select("name").eq("id", seq.project_id).single(),
    sb.from("storyboard_shots").select("id, content, state, locked, frame_asset_id, notes").eq("sequence_id", sequenceId).is("archived_at", null).order("position"),
    sb.from("storyboard_refs").select("role, title, url, attribution, access").eq("sequence_id", sequenceId),
  ]);
  const list = (shots ?? []).map((s) => ({ ...s, content: cleanShot(s.content) }));
  const timing = sequenceTiming(list);
  const showMeta = meta === "1";
  const cols = per === "1" ? 1 : per === "3" ? 3 : 2;
  const aspect = (seq.settings as { aspect?: number })?.aspect ?? 16 / 9;
  const credits = (refs ?? []).filter((r) => r.attribution || r.url);
  const q = (m: boolean, p: number) => `?${m ? "meta=1&" : ""}per=${p}`;

  return (
    <main className="mx-auto max-w-5xl bg-white p-6 text-black print:max-w-none print:p-0">
      <style>{`@media print { @page { size: landscape; margin: 12mm; } .no-print { display: none !important; } .frame { break-inside: avoid; } }`}</style>
      <div className="no-print mb-6 flex flex-wrap items-center gap-2 border-b border-black/20 pb-4">
        <PrintButton />
        <a className="btn" href={q(!showMeta, cols)}>{showMeta ? "Hide" : "Show"} camera, lens &amp; look details</a>
        {[1, 2, 3].map((n) => <a key={n} className={`btn ${n === cols ? "btn-primary" : ""}`} href={q(showMeta, n)}>{n} per row</a>)}
      </div>
      <header className="mb-4 flex items-end justify-between gap-4 border-b-2 border-black pb-2">
        <div>
          <p className="text-xs uppercase tracking-[0.2em]">{project?.name} · Storyboard</p>
          <h1 className="text-2xl font-bold uppercase">{seq.title}</h1>
          {seq.brief && <p className="max-w-3xl text-sm">{seq.brief}</p>}
        </div>
        <p className="text-right text-xs">{list.length} shots · {timing.label}<br />{new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}</p>
      </header>
      <ol className="grid gap-4" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {list.map((s, i) => {
          const c = s.content;
          const fmt = c.camera ? formatOf(c.camera) : null;
          return (
            <li key={s.id} className="frame flex flex-col gap-1 border border-black/40 p-2">
              <div className="flex items-baseline justify-between text-xs font-bold uppercase"><span>Shot {i + 1}</span><span>{c.durationS ? `${formatSeconds(c.durationS)} (proposed)` : ""}</span></div>
              <div className="w-full border border-black/30 bg-neutral-100" style={{ aspectRatio: String(c.camera?.aspect ?? aspect) }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {s.frame_asset_id ? <img src={`/api/assets/${s.frame_asset_id}`} alt={`Shot ${i + 1}`} className="size-full object-contain" /> : <p className="flex size-full items-center justify-center text-xs text-neutral-500">No frame yet</p>}
              </div>
              <p className="text-sm">{c.action}</p>
              {c.dialogue && <p className="text-sm italic">“{c.dialogue}”</p>}
              <p className="text-xs">{[labelOf(SIZES, c.size), labelOf(ANGLES, c.angle)].filter(Boolean).join(" · ")}{c.movement ? ` · Movement: ${c.movement}` : ""}</p>
              {s.notes && <p className="text-xs">Notes: {s.notes}</p>}
              {showMeta && (
                <p className="text-[10px] text-neutral-700">
                  {c.camera?.focalMm ? `${c.camera.focalMm} mm ${c.camera.anamorphic ? `anamorphic ${c.camera.squeeze ?? 2}×` : "spherical"}${fmt ? ` · ${fmt.name}` : ""}` : "Lens not set"}
                  {c.camera?.aperture ? ` · ${c.camera.apertureKind === "T" ? "T" : "f/"}${c.camera.aperture}` : ""}{c.focus ? ` · ${labelOf(FOCUS, c.focus).split(" (")[0]}` : ""}
                  {c.distanceM ? ` · camera ~${c.distanceM} m` : ""}{c.lensCharacter ? ` · ${c.lensCharacter}` : ""}
                </p>
              )}
              <p className="text-[10px] uppercase tracking-[0.1em] text-neutral-600">{s.state === "approved" ? "Approved" : "Proposal"}{s.locked ? " · locked" : ""}</p>
            </li>
          );
        })}
      </ol>
      <footer className="mt-6 border-t border-black/30 pt-2 text-[10px] text-neutral-700">
        <p>Storyboard frames are planning drawings made with an image model. They are not production specifications, and camera, lens and look details are creative guidance, not exact optics. Durations are proposals; the total is an estimate.</p>
        {credits.length > 0 && <p className="mt-1">References: {credits.map((r) => `${ROLE_LABELS[r.role]}${r.title ? ` “${r.title}”` : ""}${r.attribution ? ` by ${r.attribution}` : ""}${r.url ? ` (${r.url})` : ""}`).join("; ")}.</p>}
      </footer>
    </main>
  );
}
