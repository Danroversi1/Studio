"use client";
// The storyboard PDF: every frame rendered here with the same renderer as the canvas, then
// the browser's "Save as PDF". Images that can't be drawn are named, not silently dropped.
import { useEffect, useState } from "react";
import type { Composition } from "@/lib/storyboard/compose";
import { loadAll, renderComposition } from "@/lib/storyboard/render";
import type { ShotContent } from "@/lib/storyboard/shot";
import { ANGLES, SIZES, formatSeconds, labelOf } from "@/lib/storyboard/shot";

export interface PrintFrame { id: string; content: ShotContent; composition: Composition; notes: string; state: string; locked: boolean }

export function PrintSheet({ project, title, brief, frames, totals, credits }: {
  project: string; title: string; brief: string; frames: PrintFrame[]; totals: string; credits: string[];
}) {
  const [urls, setUrls] = useState<(string | null)[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [meta, setMeta] = useState(true);
  const [cols, setCols] = useState(2);
  useEffect(() => {
    let live = true;
    (async () => {
      const ids = [...new Set(frames.flatMap((f) => f.composition.layers.filter((l) => !l.hidden && l.assetId).map((l) => l.assetId!)))];
      const images = await loadAll(ids);
      const out: (string | null)[] = [], bad: string[] = [];
      for (const [i, f] of frames.entries()) {
        const c = document.createElement("canvas");
        const res = renderComposition(c, f.composition, images, 1400);
        res.missing.forEach((m) => bad.push(`Frame ${i + 1}: “${m.layer}” ${m.error}`));
        if (res.tainted) bad.push(`Frame ${i + 1}: an image blocks export (cross-origin)`);
        try { out.push(c.toDataURL("image/png")); } catch { out.push(null); }
      }
      if (live) { setUrls(out); setProblems(bad); }
    })();
    return () => { live = false; };
  }, [frames]);
  return (
    <main className="mx-auto max-w-5xl bg-white p-6 text-black print:max-w-none print:p-0">
      <style>{`@media print { @page { size: landscape; margin: 12mm; } .no-print { display: none !important; } .frame { break-inside: avoid; } }`}</style>
      <div className="no-print mb-6 flex flex-wrap items-center gap-2 border-b border-black/20 pb-4">
        <button type="button" className="btn-primary" onClick={() => window.print()} disabled={urls.length < frames.length}>{urls.length < frames.length ? "Rendering frames…" : "Save as PDF / Print"}</button>
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={meta} onChange={(e) => setMeta(e.target.checked)} /> Camera notes</label>
        {[1, 2, 3].map((n) => <button key={n} type="button" className={`btn ${n === cols ? "btn-primary" : ""}`} onClick={() => setCols(n)}>{n} per row</button>)}
        {problems.length > 0 && <p className="w-full text-sm text-red-700">Some pictures couldn&apos;t be drawn: {problems.join(" · ")}</p>}
      </div>
      <header className="mb-4 flex items-end justify-between gap-4 border-b-2 border-black pb-2">
        <div>
          <p className="text-xs uppercase tracking-[0.2em]">{project} · Storyboard</p>
          <h1 className="text-2xl font-bold uppercase">{title}</h1>
          {brief && <p className="max-w-3xl text-sm">{brief}</p>}
        </div>
        <p className="text-right text-xs">{frames.length} frames · {totals}<br />{new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}</p>
      </header>
      <ol className="grid gap-4" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {frames.map((f, i) => {
          const c = f.content;
          return (
            <li key={f.id} className="frame flex flex-col gap-1 border border-black/40 p-2">
              <div className="flex items-baseline justify-between text-xs font-bold uppercase"><span>Frame {i + 1}</span><span>{c.durationS ? `${formatSeconds(c.durationS)} (proposed)` : ""}</span></div>
              <div className="w-full border border-black/30 bg-neutral-100" style={{ aspectRatio: String(f.composition.aspect) }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {urls[i] ? <img src={urls[i]!} alt={`Frame ${i + 1}`} className="size-full object-contain" /> : <p className="flex size-full items-center justify-center text-xs text-neutral-500">{urls.length > i ? "Couldn't render" : "Rendering…"}</p>}
              </div>
              {c.notice && <p className="text-xs"><b>Notice:</b> {c.notice}</p>}
              {c.action && <p className="text-sm">{c.action}</p>}
              {c.dialogue && <p className="text-sm italic">“{c.dialogue}”</p>}
              {meta && (c.size || c.angle || c.cameraNotes || c.camera?.focalMm) && (
                <p className="text-[10px] text-neutral-700">{[labelOf(SIZES, c.size), labelOf(ANGLES, c.angle), c.cameraNotes, c.camera?.focalMm ? `${c.camera.focalMm} mm (note)` : ""].filter(Boolean).join(" · ")}</p>
              )}
              {f.notes && <p className="text-xs">Notes: {f.notes}</p>}
              <p className="text-[10px] uppercase tracking-[0.1em] text-neutral-600">{f.state === "approved" ? "Approved" : "Proposal"}{f.locked ? " · locked" : ""}</p>
            </li>
          );
        })}
      </ol>
      <footer className="mt-6 border-t border-black/30 pt-2 text-[10px] text-neutral-700">
        <p>Storyboard frames are planning drawings, not production specifications. Camera notes are guidance; the 2D frames are not optical simulations. Durations are proposals; the total is an estimate.</p>
        {credits.length > 0 && <p className="mt-1">Credits: {credits.join("; ")}.</p>}
      </footer>
    </main>
  );
}
