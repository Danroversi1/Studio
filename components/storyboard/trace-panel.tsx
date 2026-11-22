"use client";
// Trace: turn a reference picture in the frame into board layers in the film's Look & Feel
// style. Classic image processing and VTracer (open source), all on this computer; no AI.
// The original picture is never changed: every result is a new layer above it.
import { useEffect, useMemo, useState } from "react";
import type { Composition, Layer } from "@/lib/storyboard/compose";
import type { ImageState } from "@/lib/storyboard/render";
import { TREATMENT_HINT, TREATMENT_LABEL, type Treatment } from "@/lib/storyboard/trace";
import type { LookDirection } from "@/lib/look/types";

const KINDS: Treatment[] = ["pencil", "tones", "palette", "vector"];

export function TracePanel({ comp, selected, images, directions, frameDirectionId, editable, onTraceOver, onPlace }: {
  comp: Composition; selected: string[]; images: Map<string, ImageState>; directions: LookDirection[]; frameDirectionId: string | null; editable: boolean;
  onTraceOver: (sourceId: string) => void;
  onPlace: (sourceId: string, blob: Blob, name: string) => Promise<void>;
}) {
  const pictures = comp.layers.filter((l): l is Layer & { assetId: string } => l.type === "image" && !!l.assetId);
  const initial = pictures.find((l) => selected.includes(l.id))?.id ?? pictures[0]?.id ?? "";
  const [sourceId, setSourceId] = useState(initial);
  useEffect(() => { if (!pictures.some((l) => l.id === sourceId)) setSourceId(initial); }, [initial, pictures, sourceId]);
  const source = pictures.find((l) => l.id === sourceId) ?? null;
  const usable = directions.filter((d) => d.status !== "archived" && d.palette.length);
  const [kind, setKind] = useState<Treatment>("pencil");
  const [dirId, setDirId] = useState(frameDirectionId && usable.some((d) => d.id === frameDirectionId) ? frameDirectionId : usable[0]?.id ?? "");
  const direction = usable.find((d) => d.id === dirId) ?? null;
  const [detail, setDetail] = useState(0.5);
  const [weight, setWeight] = useState(1);
  const [levels, setLevels] = useState(4);
  const [dither, setDither] = useState(false);
  const [busy, setBusy] = useState<"run" | "place" | null>(null);
  const [result, setResult] = useState<{ blob: Blob; preview: string; svg?: string; key: string } | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const needsPalette = kind === "palette" || kind === "vector";
  const settingsKey = useMemo(() => JSON.stringify({ sourceId, kind, dirId, detail, weight, levels, dither }), [sourceId, kind, dirId, detail, weight, levels, dither]);
  useEffect(() => () => { if (result) URL.revokeObjectURL(result.preview); }, [result]);

  async function run() {
    if (!source) return;
    const st = images.get(source.assetId);
    if (!st || !st.ok) { setMsg({ kind: "error", text: "The picture is still loading. Try again in a moment." }); return; }
    if (needsPalette && kind === "palette" && !direction) { setMsg({ kind: "error", text: "Add colours to a Look & Feel direction first." }); return; }
    setBusy("run"); setMsg(null);
    try {
      const { runTreatment } = await import("@/lib/storyboard/trace-run");
      const r = await runTreatment(kind, st.img, source.crop, { detail, weight, levels, dither, palette: needsPalette ? (direction?.palette.map((c) => c.hex) ?? []) : [] });
      setResult({ ...r, key: settingsKey });
    } catch (e) {
      setMsg({ kind: "error", text: e instanceof Error ? e.message : "That didn't work. Try again." });
    } finally { setBusy(null); }
  }

  async function place() {
    if (!source || !result) return;
    setBusy("place"); setMsg(null);
    try {
      const style = needsPalette && direction ? ` · ${direction.name}` : "";
      await onPlace(source.id, result.blob, `${TREATMENT_LABEL[kind]}${style} · ${source.name}`);
      setMsg({ kind: "ok", text: "Added as a new layer above the picture. Fade it, hide it or draw over it in Layers." });
    } catch (e) {
      setMsg({ kind: "error", text: e instanceof Error ? e.message : "The layer couldn't be saved." });
    } finally { setBusy(null); }
  }

  if (!pictures.length) {
    return (
      <div className="flex flex-col gap-2 text-sm">
        <p className="font-medium">Trace from a reference</p>
        <p className="help">Put a location or reference picture in this frame first: from the tray under the canvas, a Look &amp; Feel reference, or Assets. Then come back here.</p>
      </div>
    );
  }
  const stale = result && result.key !== settingsKey;
  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex flex-col gap-1">
        <p className="font-medium">Trace from a reference</p>
        <p className="text-xs text-muted">Done on this computer with classic image processing and VTracer (open source). No AI. Your picture stays as it is; results are new layers.</p>
      </div>
      <label className="flex flex-col gap-1 text-xs">Picture
        <select className="field py-1.5 text-sm" value={sourceId} onChange={(e) => { setSourceId(e.target.value); setResult(null); }}>
          {pictures.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </label>
      {editable && (
        <div className="flex flex-col gap-1 border-b border-line pb-3">
          <button type="button" className="btn" onClick={() => onTraceOver(sourceId)}>Trace over it</button>
          <span className="text-xs text-muted">Fades and locks the picture, and opens a drawing layer on top with the pen ready.</span>
        </div>
      )}
      <div role="radiogroup" aria-label="Treatment" className="flex flex-wrap gap-1.5">
        {KINDS.map((k) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} aria-pressed={kind === k} onClick={() => setKind(k)} className="chip min-h-9 px-3 text-xs">{TREATMENT_LABEL[k]}</button>
        ))}
      </div>
      <p className="text-xs text-muted">{TREATMENT_HINT[kind]}</p>

      {needsPalette && (
        usable.length ? (
          <label className="flex flex-col gap-1 text-xs">Look &amp; Feel direction
            <select className="field py-1.5 text-sm" value={dirId} onChange={(e) => setDirId(e.target.value)}>
              {usable.map((d) => <option key={d.id} value={d.id}>{d.name}{d.id === frameDirectionId ? " (this frame)" : ""}</option>)}
            </select>
            {direction && (
              <span className="mt-1 flex flex-wrap gap-1" aria-label={`Palette of ${direction.name}`}>
                {direction.palette.map((c, i) => <span key={i} className="size-5 rounded-full border border-line" style={{ background: c.hex }} title={c.label ?? c.hex} />)}
              </span>
            )}
          </label>
        ) : kind === "palette" ? (
          <p className="text-xs text-warn">None of your Look &amp; Feel directions has a palette yet. Add colours to one on the Treatment desk.</p>
        ) : <p className="text-xs text-muted">No direction palette yet: VTracer will pick a few colours from the picture.</p>
      )}

      {(kind === "pencil" || kind === "vector") && (
        <label className="flex flex-col gap-1 text-xs">Detail <input type="range" min={0} max={1} step={0.05} value={detail} onChange={(e) => setDetail(Number(e.target.value))} /></label>
      )}
      {kind === "pencil" && (
        <label className="flex flex-col gap-1 text-xs">Line weight <input type="range" min={1} max={3} step={1} value={weight} onChange={(e) => setWeight(Number(e.target.value))} /></label>
      )}
      {kind === "tones" && (
        <label className="flex flex-col gap-1 text-xs">Values: {levels} greys <input type="range" min={2} max={6} step={1} value={levels} onChange={(e) => setLevels(Number(e.target.value))} /></label>
      )}
      {kind === "palette" && (
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={dither} onChange={(e) => setDither(e.target.checked)} /> Grain (dithering) instead of flat colour</label>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn" disabled={!!busy || (kind === "palette" && !direction)} onClick={() => void run()}>{busy === "run" ? "Working…" : result ? "Preview again" : "Preview"}</button>
        {result && editable && <button type="button" className="btn-primary" disabled={!!busy || !!stale} onClick={() => void place()}>{busy === "place" ? "Adding…" : "Add as a layer"}</button>}
      </div>
      {result && (
        <figure className="flex flex-col gap-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={result.preview} alt={`${TREATMENT_LABEL[kind]} preview`} className="w-full border border-line bg-[repeating-conic-gradient(var(--color-panel-2)_0_25%,var(--color-panel-3)_0_50%)] bg-[length:16px_16px]" />
          <figcaption className="text-xs text-muted">{stale ? "Settings changed: preview again before adding." : "Preview. Not part of the frame until you add it."}
            {result.svg && !stale && <> · <a className="text-accent" download="trace.svg" href={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(result.svg)}`}>Download SVG</a></>}
          </figcaption>
        </figure>
      )}
      {msg && <p role={msg.kind === "error" ? "alert" : "status"} className={`text-xs ${msg.kind === "error" ? "text-danger" : "text-muted"}`}>{msg.text}</p>}
    </div>
  );
}
