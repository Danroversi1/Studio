// Local color and texture for a frame, with no model calls. One documented pipeline, used
// identically for the on-screen preview and for exports:
//   1. decode sRGB → linear light
//   2. exposure (×2^stops) and warm/cool balance, in linear light
//   3. saturation around Rec. 709 luma (or full grayscale)
//   4. encode back to sRGB, then contrast (a monotonic S-curve)
//   5. vignette (darken towards the corners)
//   6. grain: a separate texture pass — seeded noise blurred to a grain size given in µm on
//      a capture width, so it scales with output resolution and repeats exactly for a seed.
// Original images are never changed; this runs on a rendered copy.
import type { Look } from "./compose";
import { blur, grainPixels, toneCurve } from "./finish";

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

export const isNeutral = (l: Look) =>
  l.exposure === 0 && l.contrast === 0 && l.saturation === 1 && l.warmth === 0 && !l.grayscale && l.vignette === 0 && l.grain.amount === 0;

function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Apply a look to RGBA pixels in place-safe fashion (returns new pixels). */
export function applyLook(rgba: Uint8ClampedArray, w: number, h: number, look: Look, captureWidthMm = 24.89): Uint8ClampedArray {
  const n = w * h, out = new Uint8ClampedArray(rgba.length);
  const gain = 2 ** look.exposure, warm = look.warmth * 0.12, sat = look.grayscale ? 0 : look.saturation;
  const toneOn = look.contrast !== 0;
  const cx = w / 2, cy = h / 2, maxR = Math.hypot(cx, cy);
  const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let r = toLinear(rgba[i * 4] / 255) * gain * (1 + warm), g = toLinear(rgba[i * 4 + 1] / 255) * gain, b = toLinear(rgba[i * 4 + 2] / 255) * gain * (1 - warm);
    if (sat !== 1) { const l = 0.2126 * r + 0.7152 * g + 0.0722 * b; r = l + (r - l) * sat; g = l + (g - l) * sat; b = l + (b - l) * sat; }
    let er = toSrgb(clamp01(r)), eg = toSrgb(clamp01(g)), eb = toSrgb(clamp01(b));
    if (toneOn) {
      const t = { contrast: Math.max(0, look.contrast) * 0.5 };
      if (look.contrast > 0) { er = toneCurve(er, t); eg = toneCurve(eg, t); eb = toneCurve(eb, t); }
      else { const k = 1 + look.contrast * 0.5; er = 0.5 + (er - 0.5) * k; eg = 0.5 + (eg - 0.5) * k; eb = 0.5 + (eb - 0.5) * k; }
    }
    if (look.vignette > 0) {
      const x = i % w, y = (i / w) | 0, d = Math.hypot(x - cx, y - cy) / maxR;
      const v = 1 - look.vignette * Math.max(0, d - 0.35) ** 1.6 * 1.4;
      er *= v; eg *= v; eb *= v;
    }
    R[i] = er; G[i] = eg; B[i] = eb;
  }
  if (look.grain.amount > 0) {
    const sigma = grainPixels(look.grain.size, captureWidthMm, w);
    const rand = rng(look.grain.seed || 1);
    const noise = new Float32Array(n);
    for (let i = 0; i < n; i++) noise[i] = rand() + rand() + rand() - 1.5;
    const b = blur(noise, w, h, sigma);
    let s = 0; for (let i = 0; i < n; i++) s += b[i] * b[i];
    const norm = Math.sqrt(s / n) || 1;
    for (let i = 0; i < n; i++) {
      const l = 0.2126 * R[i] + 0.7152 * G[i] + 0.0722 * B[i];
      const k = (look.grain.amount * (0.35 + 2.6 * l * (1 - l)) * b[i]) / norm;
      R[i] += k; G[i] += k; B[i] += k;
    }
  }
  for (let i = 0; i < n; i++) {
    out[i * 4] = Math.round(clamp01(R[i]) * 255); out[i * 4 + 1] = Math.round(clamp01(G[i]) * 255);
    out[i * 4 + 2] = Math.round(clamp01(B[i]) * 255); out[i * 4 + 3] = rgba[i * 4 + 3];
  }
  return out;
}

/** Stock-inspired starting points (original Studio settings, not calibrated emulations). */
export const LOOK_PRESETS: { id: string; name: string; look: Partial<Look>; source: string }[] = [
  { id: "neutral", name: "Neutral", look: { exposure: 0, contrast: 0, saturation: 1, warmth: 0, grayscale: false, vignette: 0, grain: { amount: 0, size: 8, seed: 1 } }, source: "No adjustment." },
  { id: "pencil-gray", name: "Grayscale storyboard", look: { grayscale: true, contrast: 0.15 }, source: "Original Studio setting." },
  { id: "daylight-fine", name: "Daylight, fine grain (stock-inspired: 50D/250D)", look: { contrast: 0.2, saturation: 0.95, warmth: 0.25, grain: { amount: 0.035, size: 7, seed: 7 }, vignette: 0.1 },
    source: "Original Studio approximation from general descriptions in Kodak's VISION3 50D/250D documents; not calibrated." },
  { id: "tungsten-night", name: "Tungsten night (stock-inspired: 500T)", look: { exposure: -0.3, contrast: 0.25, saturation: 0.9, warmth: -0.35, grain: { amount: 0.06, size: 9, seed: 11 }, vignette: 0.25 },
    source: "Original Studio approximation from general descriptions in Kodak's VISION3 500T documents; not calibrated." },
  { id: "warm-interior", name: "Warm interior (stock-inspired: 200T)", look: { contrast: 0.15, saturation: 0.92, warmth: 0.45, grain: { amount: 0.045, size: 8, seed: 5 }, vignette: 0.15 },
    source: "Original Studio approximation from general descriptions in Kodak's VISION3 200T documents; not calibrated." },
];
