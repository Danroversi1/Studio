// BROWSER. Turns the chosen reference layers into editable vector paths, entirely on this
// device: the layers are drawn (with crops, flips and masks) onto a canvas, its pixels go to a
// Web Worker (public/vendor/trace/) running OpenCV.js + ImageTracer.js, and plain path data
// comes back. Nothing leaves the browser until she keeps the result. No AI, no model calls.
//   - Preview runs at PREVIEW_SIDE; the kept trace at FINAL_SIDE (bounded input size).
//   - Only the latest request matters: an older job is cancelled when a new one starts.
import type { Layer, Treatment } from "./compose";
import { loadAll, rasterLayers } from "./render";
import type { TracePath } from "./trace-store";

export const PREVIEW_SIDE = 640;
export const FINAL_SIDE = 1600;

/** The controls she adjusts. Detail, contrast, simplify and shadow are 0..1. */
export interface TraceSettings {
  treatment: Treatment; detail: number; contrast: number; simplify: number; shadow: number;
  weight: number; ink: string; mid: string;
}
export const DEFAULT_TRACE: TraceSettings = { treatment: "outline", detail: 0.5, contrast: 0.5, simplify: 0.4, shadow: 0.5, weight: 3, ink: "#141414", mid: "#9a9a9a" };

export interface TraceResult {
  width: number; height: number; paths: TracePath[]; tooComplex: boolean; stats: { paths: number; chars: number };
  box: { x0: number; y0: number; x1: number; y1: number }; ms: number;
}

type Msg = { type: "progress"; id: number; stage: string; pct: number } | { type: "done"; id: number; result: Omit<TraceResult, "box" | "ms"> } | { type: "error"; id: number; message: string };

let worker: Worker | null = null;
let seq = 0;
const waiting = new Map<number, { ok: (r: Omit<TraceResult, "box" | "ms">) => void; fail: (e: Error) => void; progress?: (stage: string, pct: number) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  // Loaded only when she first traces: OpenCV.js is ~11 MB and is fetched from this site.
  worker = new Worker("/vendor/trace/trace-worker.js");
  worker.onmessage = (e: MessageEvent<Msg>) => {
    const m = e.data, w = waiting.get(m.id);
    if (!w) return;
    if (m.type === "progress") w.progress?.(m.stage, m.pct);
    else { waiting.delete(m.id); if (m.type === "done") w.ok(m.result); else w.fail(new Error(m.message)); }
  };
  worker.onerror = () => { for (const w of waiting.values()) w.fail(new Error("The tracing tool couldn't start in this browser.")); waiting.clear(); worker = null; };
  return worker;
}

export const STAGES: Record<string, string> = {
  loading: "Loading the tracing tools…", prepare: "Preparing the picture…", edges: "Finding edges…", lines: "Linking edges into lines…",
  shapes: "Finding shapes…", tones: "Separating tones…", trace: "Tracing paths…", finish: "Finishing…",
};

/** Trace these layers. Starting a new trace cancels any older one still running. */
export async function traceLayers(layers: Layer[], settings: TraceSettings, side: number, progress?: (stage: string, pct: number) => void): Promise<TraceResult> {
  const t0 = performance.now();
  const ids = [...new Set(layers.map((l) => l.assetId).filter((x): x is string => !!x))];
  const images = await loadAll(ids);
  const bad = ids.filter((id) => !images.get(id)?.ok);
  if (bad.length) throw new Error("A reference picture couldn't be loaded. Upload it from your computer and try again.");
  const { canvas, box } = rasterLayers(layers, images, side);
  let data: ImageData;
  try {
    data = canvas.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, canvas.width, canvas.height);
  } catch {
    throw new Error("This picture comes from another site that doesn't allow tracing. Download it, then use Upload to add it here.");
  }
  canvas.width = canvas.height = 0; // release the bitmap
  const w = getWorker();
  for (const [id] of waiting) { w.postMessage({ type: "cancel", id }); }
  const id = ++seq;
  const result = await new Promise<Omit<TraceResult, "box" | "ms">>((ok, fail) => {
    waiting.set(id, { ok, fail, progress });
    w.postMessage({ type: "trace", id, data: data.data.buffer, width: data.width, height: data.height, settings }, [data.data.buffer]);
  });
  return { ...result, box, ms: Math.round(performance.now() - t0) };
}

/** Cancel whatever is running (e.g. she closed the panel). */
export function cancelTraces() {
  if (!worker) return;
  for (const [id, w] of waiting) { worker.postMessage({ type: "cancel", id }); w.fail(new Error("cancelled")); }
  waiting.clear();
}
