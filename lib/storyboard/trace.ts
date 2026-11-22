// Tracing treatments for a reference picture: classic image processing, no AI. Pure
// (unit-tested): every function takes RGBA pixels and returns new RGBA pixels, and the same
// input with the same settings always gives the same result.
//   pencil  — edges (Sobel on a softened luminance) as dark lines on transparent paper
//   tones   — luminance reduced to 2–6 flat greys (the classic storyboard value study)
//   palette — every pixel mapped to the nearest colour of a Look & Feel palette (CIELAB),
//             optionally with Floyd–Steinberg dithering for grain instead of flat fills

export interface Pixels { data: Uint8ClampedArray | Uint8Array; width: number; height: number }
export type Treatment = "pencil" | "tones" | "palette" | "vector";

export const TREATMENT_LABEL: Record<Treatment, string> = {
  pencil: "Pencil lines",
  tones: "Flat tones",
  palette: "Look & Feel palette",
  vector: "Vector shapes",
};
export const TREATMENT_HINT: Record<Treatment, string> = {
  pencil: "The picture's edges as pencil lines on clear paper, ready to trace over.",
  tones: "Light and shadow reduced to a few flat greys: the classic storyboard value study.",
  palette: "The picture recoloured with only your direction's palette.",
  vector: "Clean, smooth shapes in your direction's palette (traced with VTracer).",
};

const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

export function luminance(p: Pixels): Float32Array {
  const n = p.width * p.height, out = new Float32Array(n), d = p.data;
  for (let i = 0; i < n; i++) out[i] = 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2];
  return out;
}

function blur3(src: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      s += src[yy * w + xx]; n++;
    }
    out[y * w + x] = s / n;
  }
  return out;
}

/** Value below which the given fraction of the samples fall. */
function quantile(values: Float32Array, q: number): number {
  const hist = new Uint32Array(1024);
  let max = 0;
  for (const v of values) if (v > max) max = v;
  if (max <= 0) return 0;
  for (const v of values) hist[Math.min(1023, Math.floor((v / max) * 1023))]++;
  let acc = 0; const target = q * values.length;
  // The upper edge of the bin where the target is reached: values in that bin count as below.
  for (let i = 0; i < 1024; i++) { acc += hist[i]; if (acc >= target) return ((i + 1) / 1023) * max; }
  return max;
}

/** Pencil lines. detail 0..1: more detail keeps fainter edges. weight 1..3: line thickness. */
export function pencil(p: Pixels, opts: { detail?: number; weight?: number; ink?: [number, number, number] } = {}): Uint8ClampedArray {
  const { width: w, height: h } = p;
  const detail = Math.min(1, Math.max(0, opts.detail ?? 0.5));
  const weight = Math.min(3, Math.max(1, Math.round(opts.weight ?? 1)));
  const ink = opts.ink ?? [28, 28, 28];
  const L = blur3(luminance(p), w, h);
  const mag = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const gx = -L[i - w - 1] - 2 * L[i - 1] - L[i + w - 1] + L[i - w + 1] + 2 * L[i + 1] + L[i + w + 1];
    const gy = -L[i - w - 1] - 2 * L[i - w] - L[i - w + 1] + L[i + w - 1] + 2 * L[i + w] + L[i + w + 1];
    mag[i] = Math.hypot(gx, gy);
  }
  // Keep the strongest edges: from the top 6% (little detail) to the top 22% (lots).
  const cut = Math.max(8, quantile(mag, 1 - (0.06 + detail * 0.16)));
  let line = new Float32Array(w * h);
  for (let i = 0; i < mag.length; i++) line[i] = mag[i] >= cut ? Math.min(1, 0.55 + (0.45 * (mag[i] - cut)) / (cut + 1)) : 0;
  for (let k = 1; k < weight; k++) { // thicken: max over the 3×3 neighbourhood
    const t = new Float32Array(line.length);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let m = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < w && yy < h && line[yy * w + xx] > m) m = line[yy * w + xx];
      }
      t[y * w + x] = m;
    }
    line = t;
  }
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < line.length; i++) {
    out[i * 4] = ink[0]; out[i * 4 + 1] = ink[1]; out[i * 4 + 2] = ink[2];
    out[i * 4 + 3] = Math.round(line[i] * 255);
  }
  return out;
}

/** Light to dark greys for a value study of n levels (2–6). */
export function toneGreys(levels: number): number[] {
  const n = Math.min(6, Math.max(2, Math.round(levels)));
  return Array.from({ length: n }, (_, i) => Math.round(242 - (i * (242 - 34)) / (n - 1)));
}

/** Flat tones: luminance split into n bands of equal area (so every grey is used). */
export function tones(p: Pixels, levels = 4): Uint8ClampedArray {
  const greys = toneGreys(levels);
  const L = blur3(luminance(p), p.width, p.height);
  const cuts = greys.slice(1).map((_, i) => quantile(L, (i + 1) / greys.length));
  const out = new Uint8ClampedArray(L.length * 4);
  for (let i = 0; i < L.length; i++) {
    let band = 0;
    while (band < cuts.length && L[i] > cuts[band]) band++;
    const g = greys[greys.length - 1 - band]; // darkest band = darkest grey
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = g;
    out[i * 4 + 3] = p.data[i * 4 + 3];
  }
  return out;
}

export function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toLab(r: number, g: number, b: number): [number, number, number] {
  const lin = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const R = lin(r), G = lin(g), B = lin(b);
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const x = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047), y = f(0.2126 * R + 0.7152 * G + 0.0722 * B), z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

/** Index of the palette colour nearest to (r, g, b) in CIELAB. */
export function nearest(lab: [number, number, number][], r: number, g: number, b: number): number {
  const [L, A, B] = toLab(r, g, b);
  let best = 0, bd = Infinity;
  for (let i = 0; i < lab.length; i++) {
    const d = (L - lab[i][0]) ** 2 + (A - lab[i][1]) ** 2 + (B - lab[i][2]) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/** Recolour with only the palette's colours. dither → Floyd–Steinberg error diffusion. */
export function toPalette(p: Pixels, hexes: string[], opts: { dither?: boolean } = {}): Uint8ClampedArray {
  const pal = hexes.map(hexToRgb).filter((c): c is [number, number, number] => !!c);
  if (!pal.length) throw new Error("This direction has no palette yet. Add colours to it in Look & Feel.");
  const lab = pal.map(([r, g, b]) => toLab(r, g, b));
  const { width: w, height: h } = p;
  const work = new Float32Array(w * h * 3);
  for (let i = 0; i < w * h; i++) { work[i * 3] = p.data[i * 4]; work[i * 3 + 1] = p.data[i * 4 + 1]; work[i * 3 + 2] = p.data[i * 4 + 2]; }
  const out = new Uint8ClampedArray(w * h * 4);
  const spread = (x: number, y: number, e: number[], f: number) => {
    if (x < 0 || x >= w || y >= h) return;
    const j = (y * w + x) * 3;
    work[j] += e[0] * f; work[j + 1] += e[1] * f; work[j + 2] += e[2] * f;
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    const r = clamp(work[i * 3]), g = clamp(work[i * 3 + 1]), b = clamp(work[i * 3 + 2]);
    const c = pal[nearest(lab, r, g, b)];
    out[i * 4] = c[0]; out[i * 4 + 1] = c[1]; out[i * 4 + 2] = c[2]; out[i * 4 + 3] = p.data[i * 4 + 3];
    if (opts.dither) {
      const e = [r - c[0], g - c[1], b - c[2]];
      spread(x + 1, y, e, 7 / 16); spread(x - 1, y + 1, e, 3 / 16); spread(x, y + 1, e, 5 / 16); spread(x + 1, y + 1, e, 1 / 16);
    }
  }
  return out;
}

/** Working size: at most `max` pixels on the long side, keeping proportions. */
export function workingSize(w: number, h: number, max = 1400): { w: number; h: number } {
  const s = Math.min(1, max / Math.max(w, h, 1));
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

/** VTracer options for a palette-constrained trace. detail 0..1 (more detail keeps smaller shapes). */
export interface VectorOptions {
  mode: "spline"; hierarchical: "stacked"; filterSpeckle: number; cornerThreshold: number; lengthThreshold: number;
  spliceThreshold: number; pathPrecision: number; palette?: string[]; maxColors?: number;
}
export function vectorOptions(palette: string[], detail = 0.5): VectorOptions {
  const d = Math.min(1, Math.max(0, detail));
  const pal = palette.map((h) => (h.startsWith("#") ? h : `#${h}`)).filter((h) => /^#[0-9a-f]{6}$/i.test(h));
  return {
    mode: "spline" as const, hierarchical: "stacked" as const,
    filterSpeckle: Math.round(12 - d * 9), cornerThreshold: 60, lengthThreshold: 4, spliceThreshold: 45, pathPrecision: 2,
    ...(pal.length ? { palette: pal } : { maxColors: Math.round(4 + d * 8) }),
  };
}
