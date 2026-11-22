"use client";
// Treatment: turn the chosen references into editable vector lines, in her browser. Preview
// runs small and fast while she adjusts; "Keep" traces at full size and saves the paths. The
// film's treatment preset (palette, contrast, outline weight, detail, shadow, background) is a
// set of editable settings she saves once and applies across boards. Look & Feel references
// are shown for her eye only: Studio doesn't read or copy their style. No AI anywhere here.
import { useEffect, useMemo, useRef, useState } from "react";
import type { Composition, Layer, Treatment } from "@/lib/storyboard/compose";
import { DEFAULT_TRACE, FINAL_SIDE, PREVIEW_SIDE, STAGES, cancelTraces, traceLayers, type TraceResult, type TraceSettings } from "@/lib/storyboard/trace-run";
import { getTrace } from "@/lib/storyboard/trace-store";
import { RefVisual } from "@/components/look/parts";
import type { LookRef } from "@/lib/look/types";

export interface FilmTreatment { ink: string; mid: string; bg: string; contrast: number; weight: number; detail: number; shadow: number }
export const DEFAULT_FILM: FilmTreatment = { ink: DEFAULT_TRACE.ink, mid: DEFAULT_TRACE.mid, bg: "#ffffff", contrast: 0.5, weight: 3, detail: 0.5, shadow: 0.5 };
const hex = (x: unknown, d: string) => (typeof x === "string" && /^#[0-9a-f]{6}$/i.test(x) ? x : d);
const unit = (x: unknown, d: number) => (typeof x === "number" && x >= 0 && x <= 1 ? x : d);
export function cleanFilmTreatment(x: Record<string, unknown> | null | undefined): FilmTreatment {
  const o = x ?? {};
  return { ink: hex(o.ink, DEFAULT_FILM.ink), mid: hex(o.mid, DEFAULT_FILM.mid), bg: hex(o.bg, DEFAULT_FILM.bg), contrast: unit(o.contrast, 0.5),
    weight: typeof o.weight === "number" && o.weight >= 0.5 && o.weight <= 12 ? o.weight : 3, detail: unit(o.detail, 0.5), shadow: unit(o.shadow, 0.5) };
}

const PRESETS: { id: Treatment; name: string; what: string }[] = [
  { id: "outline", name: "Outline", what: "Edges found in the picture, linked into lines you can edit. Line weight sets the stroke." },
  { id: "ink", name: "Ink", what: "Dark shapes filled solid, like brush ink. Line weight thickens the shapes before tracing." },
  { id: "three_tone", name: "Three-tone", what: "Paper, a mid grey and a dark: three flat tones. Shadow moves the cuts." },
];

export interface Kept { result: TraceResult; settings: TraceSettings; sources: Layer[] }

export function TreatmentPanel({ comp, selected, editable, lookRefs, film, filmVersion, canEdit, onPreview, onKeep, onSaveFilm, onApplyFilm, onMessage }: {
  comp: Composition; selected: string[]; editable: boolean; lookRefs: LookRef[];
  film: FilmTreatment; filmVersion: number | null; canEdit: boolean;
  onPreview: (p: { result: TraceResult; settings: TraceSettings } | null) => void;
  /** replace: the traced layer being re-traced (only it changes). */
  onKeep: (kept: Kept[], replace: Layer | null) => Promise<void>;
  onSaveFilm: (t: FilmTreatment) => Promise<boolean>;
  onApplyFilm: (t: FilmTreatment) => void;
  onMessage: (m: { kind: "error" | "notice"; text: string } | null) => void;
}) {
  const sel = comp.layers.filter((l) => selected.includes(l.id));
  const retrace = sel.length === 1 && sel[0].type === "vector" ? sel[0] : null;
  const sources = useMemo(() => retrace
    ? comp.layers.filter((l) => retrace.sourceIds?.includes(l.id) && l.type === "image")
    : sel.filter((l) => l.type === "image" && !l.hidden), [comp.layers, retrace, sel]);
  const missingSources = retrace ? (retrace.sourceIds ?? []).filter((id) => !comp.layers.some((l) => l.id === id)).length : 0;

  const [s, setS] = useState<TraceSettings>(() => ({ ...DEFAULT_TRACE, ink: film.ink, mid: film.mid, contrast: film.contrast, weight: film.weight, detail: film.detail, shadow: film.shadow }));
  const [live, setLive] = useState(true);
  const [separate, setSeparate] = useState(true);
  const [busy, setBusy] = useState<null | { stage: string; pct: number; final: boolean }>(null);
  const [preview, setPreviewState] = useState<TraceResult | null>(null);
  const [warn, setWarn] = useState<string | null>(null);
  const [ft, setFt] = useState<FilmTreatment>(film);
  useEffect(() => setFt(film), [film]);

  // Re-trace starts from the settings the trace was made with (so it's reproducible).
  const retraceId = retrace?.traceId;
  useEffect(() => {
    const t = getTrace(retraceId);
    if (t) setS((cur) => ({ ...cur, ...(t.settings as Partial<TraceSettings>), treatment: t.treatment }));
  }, [retraceId]);

  const key = sources.map((l) => `${l.id}:${l.assetId}:${l.x}:${l.y}:${l.w}:${l.h}:${l.rot}:${JSON.stringify(l.crop ?? null)}:${l.masks?.length ?? 0}:${l.flipX ? 1 : 0}`).join("|");
  const token = useRef(0);
  useEffect(() => {
    if (!live || !sources.length || !editable) { setPreviewState(null); onPreview(null); return; }
    const my = ++token.current;
    const t = setTimeout(async () => {
      setBusy({ stage: "loading", pct: 0, final: false });
      try {
        const r = await traceLayers(sources, s, PREVIEW_SIDE, (stage, pct) => { if (token.current === my) setBusy({ stage, pct, final: false }); });
        if (token.current !== my) return;
        setPreviewState(r); onPreview({ result: r, settings: s });
        setWarn(r.tooComplex ? `This would make ${r.stats.paths.toLocaleString()} lines: too many to keep. Raise Simplify or lower Detail.` : null);
      } catch (e) {
        if (token.current === my && !(e instanceof Error && e.message === "cancelled")) { onMessage({ kind: "error", text: e instanceof Error ? e.message : "The preview didn't work." }); onPreview(null); }
      } finally { if (token.current === my) setBusy(null); }
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, key, s, editable]);
  useEffect(() => () => { cancelTraces(); onPreview(null); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function keep() {
    if (!sources.length) return;
    token.current++; // a running preview no longer matters
    onPreview(null);
    const groups = !retrace && separate && sources.length > 1 ? sources.map((l) => [l]) : [sources];
    const kept: Kept[] = [];
    try {
      for (const [i, g] of groups.entries()) {
        const r = await traceLayers(g, s, FINAL_SIDE, (stage, pct) => setBusy({ stage: groups.length > 1 ? `${stage}` : stage, pct: (i + pct) / groups.length, final: true }));
        if (r.tooComplex) {
          setWarn(`“${g.map((l) => l.name).join(", ")}” would make ${r.stats.paths.toLocaleString()} lines: too many to keep. Press “Simplify more” and try again.`);
          return;
        }
        if (!r.paths.length) { setWarn("That trace came out empty. Try more Detail or Contrast."); return; }
        kept.push({ result: r, settings: s, sources: g });
      }
      setBusy({ stage: "finish", pct: 0.98, final: true });
      await onKeep(kept, retrace);
      setWarn(null);
    } catch (e) {
      onMessage({ kind: "error", text: e instanceof Error ? e.message : "The trace couldn't be kept." });
    } finally { setBusy(null); }
  }

  const set = (p: Partial<TraceSettings>) => setS((c) => ({ ...c, ...p }));
  const slider = (k: "detail" | "contrast" | "simplify" | "shadow", label: string, help: string) => (
    <label className="flex flex-col gap-0.5 text-xs" title={help}>
      <span className="flex justify-between"><span>{label}</span><span className="text-muted">{Math.round(s[k] * 100)}</span></span>
      <input type="range" min={0} max={1} step={0.05} value={s[k]} disabled={!editable} onChange={(e) => set({ [k]: Number(e.target.value) })} />
    </label>
  );

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2">
        <h3 className="font-semibold">{retrace ? `Re-trace “${retrace.name}”` : "Trace"}</h3>
        {!sources.length ? (
          <p className="help">{retrace ? (missingSources ? "The references this was traced from were removed, so it can't be traced again. Its lines are still editable." : "Its references are hidden or missing.")
            : "Select one or more references on the canvas (Shift-click for several), then choose a treatment. Cut them out first with the Lasso if you only want part of a picture."}</p>
        ) : (
          <p className="text-xs text-muted">From: {sources.map((l) => l.name).join(", ")}{retrace ? ". Only this traced layer is replaced; your drawing, notes and references stay as they are (Undo brings the old lines back)." : ""}</p>
        )}
        <div className="grid grid-cols-3 gap-1" role="radiogroup" aria-label="Treatment">
          {PRESETS.map((p) => (
            <button key={p.id} type="button" role="radio" aria-checked={s.treatment === p.id} disabled={!editable} onClick={() => set({ treatment: p.id })}
              className={`btn min-h-9 px-1 text-xs ${s.treatment === p.id ? "btn-primary" : ""}`}>{p.name}</button>
          ))}
        </div>
        <p className="text-xs text-muted">{PRESETS.find((p) => p.id === s.treatment)!.what}</p>
        {slider("detail", "Detail", "More detail finds smaller edges and keeps smaller shapes")}
        {slider("contrast", "Contrast", "Stretches light and dark before tracing")}
        {slider("simplify", "Simplify", "Smooths lines and drops small specks (less texture clutter)")}
        {s.treatment !== "outline" && slider("shadow", "Shadow amount", "How much of the picture counts as dark")}
        <label className="flex flex-col gap-0.5 text-xs">
          <span className="flex justify-between"><span>Line weight</span><span className="text-muted">{s.weight}</span></span>
          <input type="range" min={0.5} max={12} step={0.5} value={s.weight} disabled={!editable || s.treatment === "three_tone"} onChange={(e) => set({ weight: Number(e.target.value) })} />
          {s.treatment === "three_tone" && <span className="text-muted">Three-tone has no lines (only filled tones).</span>}
        </label>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <label className="flex items-center gap-1">Ink <input type="color" value={s.ink} disabled={!editable} onChange={(e) => set({ ink: e.target.value })} /></label>
          {s.treatment === "three_tone" && <label className="flex items-center gap-1">Mid tone <input type="color" value={s.mid} disabled={!editable} onChange={(e) => set({ mid: e.target.value })} /></label>}
          <label className="flex items-center gap-1"><input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} /> Live preview</label>
        </div>
        {!retrace && sources.length > 1 && (
          <label className="flex items-start gap-1 text-xs">
            <input type="checkbox" checked={separate} onChange={(e) => setSeparate(e.target.checked)} className="mt-0.5" />
            <span>Keep each reference as its own traced layer.{!separate && <b className="text-danger"> Tracing them together makes one flat drawing: you won&apos;t be able to tell whose lines are whose afterwards.</b>}</span>
          </label>
        )}
        {busy && (
          <div role="status" className="flex flex-col gap-1 text-xs">
            <span>{busy.final ? "Tracing at full size: " : "Preview: "}{STAGES[busy.stage] ?? busy.stage}</span>
            <progress max={1} value={busy.pct} className="w-full" />
          </div>
        )}
        {!busy && preview && live && <p className="text-xs text-muted" role="status">Preview: {preview.stats.paths.toLocaleString()} paths in {preview.ms} ms (shown on the canvas, not saved).</p>}
        {warn && (
          <p role="alert" className="text-xs text-danger">{warn}{" "}
            <button type="button" className="underline" onClick={() => { set({ simplify: Math.min(1, s.simplify + 0.2), detail: Math.max(0, s.detail - 0.15) }); setWarn(null); }}>Simplify more</button>
          </p>
        )}
        <div className="flex flex-wrap gap-1">
          <button type="button" className="btn-primary min-h-9 px-3 text-xs" disabled={!editable || !sources.length || (!!busy && busy.final)} onClick={() => void keep()}>
            {retrace ? "Re-trace (replace these lines)" : "Keep trace"}
          </button>
          {busy && <button type="button" className="btn min-h-9 px-2 text-xs" onClick={() => { token.current++; cancelTraces(); setBusy(null); onPreview(null); }}>Cancel</button>}
        </div>
        <p className="text-xs text-muted">Runs in this browser (OpenCV.js + ImageTracer.js). Nothing is uploaded and no AI is used. The trace keeps its settings and links to its references, so it can be made again.</p>
      </section>

      <section className="flex flex-col gap-2 border-t border-line pt-3">
        <h3 className="font-semibold">Film treatment</h3>
        <p className="help">Your saved choices for every board in this film. Use them here, or apply them to the lines and backgrounds of all boards.</p>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <label className="flex items-center gap-1">Ink <input type="color" value={ft.ink} disabled={!canEdit} onChange={(e) => setFt({ ...ft, ink: e.target.value })} /></label>
          <label className="flex items-center gap-1">Mid <input type="color" value={ft.mid} disabled={!canEdit} onChange={(e) => setFt({ ...ft, mid: e.target.value })} /></label>
          <label className="flex items-center gap-1">Background <input type="color" value={ft.bg} disabled={!canEdit} onChange={(e) => setFt({ ...ft, bg: e.target.value })} /></label>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          {([["contrast", "Contrast"], ["detail", "Detail"], ["shadow", "Shadow"]] as const).map(([k, label]) => (
            <label key={k} className="flex flex-col gap-0.5"><span>{label} {Math.round(ft[k] * 100)}</span>
              <input type="range" min={0} max={1} step={0.05} value={ft[k]} disabled={!canEdit} onChange={(e) => setFt({ ...ft, [k]: Number(e.target.value) })} /></label>
          ))}
          <label className="flex flex-col gap-0.5"><span>Outline weight {ft.weight}</span>
            <input type="range" min={0.5} max={12} step={0.5} value={ft.weight} disabled={!canEdit} onChange={(e) => setFt({ ...ft, weight: Number(e.target.value) })} /></label>
        </div>
        <div className="flex flex-wrap gap-1">
          <button type="button" className="btn min-h-8 px-2 text-xs" disabled={!editable} onClick={() => set({ ink: ft.ink, mid: ft.mid, contrast: ft.contrast, weight: ft.weight, detail: ft.detail, shadow: ft.shadow })}>Use for this trace</button>
          {canEdit && <button type="button" className="btn min-h-8 px-2 text-xs" onClick={async () => { if (await onSaveFilm(ft)) onMessage({ kind: "notice", text: "Film treatment saved. It's the starting point for every trace." }); }}>
            {filmVersion ? "Save film treatment" : "Save as film treatment"}</button>}
          {canEdit && <button type="button" className="btn min-h-8 px-2 text-xs" onClick={() => onApplyFilm(ft)}>Apply to all boards</button>}
        </div>
        {lookRefs.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="label">Look &amp; Feel for this frame</p>
            <ul className="grid grid-cols-3 gap-1">
              {lookRefs.slice(0, 9).map((r) => (
                <li key={r.id} className="flex flex-col gap-0.5">
                  <div className="aspect-square overflow-hidden border border-line bg-panel-2"><RefVisual r={r} className="size-full object-cover" /></div>
                  {r.palette.length > 0 && canEdit && (
                    <button type="button" className="flex h-4 w-full overflow-hidden border border-line" title="Use these palette colours for ink, mid and background"
                      onClick={() => { const p = r.palette.map((c) => c.hex).filter((h) => /^#[0-9a-f]{6}$/i.test(h)); setFt({ ...ft, ink: p[0] ?? ft.ink, mid: p[1] ?? ft.mid, bg: p[2] ?? ft.bg }); }}>
                      {r.palette.slice(0, 5).map((c, i) => <span key={i} className="h-full flex-1" style={{ background: c.hex }} />)}
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted">Shown for your eye. Studio doesn&apos;t analyse or copy a reference&apos;s style: you set the treatment, and can borrow a palette you saved with a reference.</p>
          </div>
        )}
      </section>
    </div>
  );
}
