// BROWSER. Runs a tracing treatment on a picture already loaded on the page: pixels are read
// from a canvas, processed here (lib/storyboard/trace.ts) or in the VTracer Web Worker
// (public/vendor/vtracer/), and returned as a transparent PNG. Nothing is sent anywhere
// until she places the result, which then uploads like any other image. No AI.
import type { Crop } from "./compose";
import { pencil, tones, toPalette, vectorOptions, workingSize, type Treatment } from "./trace";

export interface TreatmentSettings { detail: number; weight: number; levels: number; palette: string[]; dither: boolean }

function sourcePixels(img: HTMLImageElement, crop?: Crop) {
  const c = crop ?? { l: 0, t: 0, r: 0, b: 0 };
  const sx = img.naturalWidth * c.l, sy = img.naturalHeight * c.t;
  const sw = img.naturalWidth * (1 - c.l - c.r), sh = img.naturalHeight * (1 - c.t - c.b);
  const { w, h } = workingSize(sw, sh);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("This browser can't read the picture.");
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
  try {
    return ctx.getImageData(0, 0, w, h);
  } catch {
    throw new Error("This picture can't be read for tracing (it isn't stored in Studio). Upload it to your library first.");
  }
}

function toPng(rgba: Uint8ClampedArray, w: number, h: number): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0);
  return new Promise((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error("The result couldn't be made."))), "image/png"));
}

let worker: Worker | null = null;
function vectorize(px: ImageData, options: object): Promise<string> {
  worker ??= new Worker("/vendor/vtracer/worker.js");
  const w = worker;
  return new Promise((ok, fail) => {
    const timer = setTimeout(() => { w.terminate(); worker = null; fail(new Error("Vector tracing took too long. Try less detail.")); }, 60_000);
    w.onmessage = (e: MessageEvent<{ ok: boolean; svg?: string; error?: string }>) => {
      clearTimeout(timer);
      if (e.data.ok && e.data.svg) ok(e.data.svg); else fail(new Error(e.data.error || "Vector tracing failed."));
    };
    w.onerror = () => { clearTimeout(timer); w.terminate(); worker = null; fail(new Error("The vector tracer couldn't start in this browser.")); };
    const copy = new Uint8Array(px.data); // transfer a copy; keep the original pixels
    w.postMessage({ rgba: copy.buffer, width: px.width, height: px.height, options }, [copy.buffer]);
  });
}

async function svgToPng(svg: string, w: number, h: number): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = await new Promise<HTMLImageElement>((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => fail(new Error("The traced shapes couldn't be drawn.")); i.src = url; });
    const canvas = document.createElement("canvas");
    canvas.width = w * 2; canvas.height = h * 2; // crisper edges for the smooth shapes
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error("The result couldn't be made."))), "image/png"));
  } finally { URL.revokeObjectURL(url); }
}

/** Run one treatment. Returns a PNG and an object URL for previewing it. */
export async function runTreatment(kind: Treatment, img: HTMLImageElement, crop: Crop | undefined, s: TreatmentSettings): Promise<{ blob: Blob; preview: string; svg?: string }> {
  const px = sourcePixels(img, crop);
  let blob: Blob, svg: string | undefined;
  if (kind === "vector") {
    svg = await vectorize(px, vectorOptions(s.palette, s.detail));
    blob = await svgToPng(svg, px.width, px.height);
  } else {
    const out = kind === "pencil" ? pencil(px, { detail: s.detail, weight: s.weight })
      : kind === "tones" ? tones(px, s.levels)
      : toPalette(px, s.palette, { dither: s.dither });
    blob = await toPng(out, px.width, px.height);
  }
  return { blob, preview: URL.createObjectURL(blob), svg };
}
