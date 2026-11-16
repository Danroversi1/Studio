// Look Preview finishing: an original, approximate "stock-inspired" finish applied after
// generation, so the director can compare the underlying image and the finished preview
// without regenerating. Pipeline (documented, applied the same way every time):
//   decode sRGB → linear light
//   1. color balance (temperature / tint) in linear light
//   2. halation (red-orange glow around bright highlights) and bloom (neutral glow), each
//      its own pass, radius scaled to output resolution
//   3. saturation (in linear, around Rec. 709 luma)
//   encode back to sRGB
//   4. tone curve (contrast S-curve, toe lift, shoulder roll-off) on the encoded image
//   5. grain: spatial noise blurred to a grain size given in micrometres on the capture
//      format, so it scales with output resolution and format; stronger in midtones
// This is not a LUT and not a film emulation: it cannot reproduce depth of field, lens
// geometry or real emulsion response. Pure (unit-tested).

export interface FinishParams {
  tone?: { contrast?: number; toe?: number; shoulder?: number };
  color?: { temperature?: number; tint?: number; saturation?: number };
  grain?: { amount?: number; size_um?: number; chroma?: number };
  halation?: { amount?: number; radius_px_at_2k?: number; threshold?: number };
  bloom?: { amount?: number };
  softness?: { amount?: number };
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Seeded PRNG (mulberry32) so the same image + preset always gives the same grain. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Separable box blur, three passes ≈ Gaussian with the given sigma (in pixels). */
export function blur(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
  if (sigma < 0.3) return src.slice();
  const r = Math.max(1, Math.round(Math.sqrt((12 * sigma * sigma) / 3 + 1) / 2));
  let a = src.slice(), b = new Float32Array(src.length);
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) {               // horizontal
      let acc = 0; const row = y * w;
      for (let x = -r; x <= r; x++) acc += a[row + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        b[row + x] = acc / (2 * r + 1);
        acc += a[row + Math.min(w - 1, x + r + 1)] - a[row + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {               // vertical
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += b[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        a[y * w + x] = acc / (2 * r + 1);
        acc += b[Math.min(h - 1, y + r + 1) * w + x] - b[Math.max(0, y - r) * w + x];
      }
    }
  }
  return a;
}

/** Grain size in pixels: grain in µm on the capture area, mapped to the output width. */
export function grainPixels(sizeUm: number, captureWidthMm: number, outputWidthPx: number): number {
  return Math.max(0.5, ((sizeUm / 1000) / captureWidthMm) * outputWidthPx);
}

export function toneCurve(x: number, t: FinishParams["tone"] = {}): number {
  const k = 1 + 2 * (t.contrast ?? 0);
  const xk = x ** k, yk = (1 - x) ** k;
  let y = xk + yk === 0 ? x : xk / (xk + yk);
  y = (t.toe ?? 0) * 0.06 + (1 - (t.toe ?? 0) * 0.06) * y;           // lift blacks
  y = y - (t.shoulder ?? 0) * 0.08 * y * y * y;                        // roll off whites
  return clamp01(y);
}

/** Apply a finish to RGBA pixels (0–255, as from a canvas). Returns new pixels. */
export function applyFinish(rgba: Uint8ClampedArray, w: number, h: number, p: FinishParams, opts: { captureWidthMm?: number; seed?: number } = {}): Uint8ClampedArray {
  const n = w * h;
  const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n);
  for (let i = 0; i < n; i++) { R[i] = toLinear(rgba[i * 4] / 255); G[i] = toLinear(rgba[i * 4 + 1] / 255); B[i] = toLinear(rgba[i * 4 + 2] / 255); }

  // 1. color balance
  const temp = p.color?.temperature ?? 0, tint = p.color?.tint ?? 0;
  if (temp || tint) for (let i = 0; i < n; i++) { R[i] *= 1 + temp; B[i] *= 1 - temp; G[i] *= 1 - tint; }

  // 2. halation and bloom (separate passes)
  const scale = w / 2048;
  const glow = (amount: number, radius: number, threshold: number, tintRGB: [number, number, number]) => {
    if (amount <= 0) return;
    const m = new Float32Array(n);
    for (let i = 0; i < n; i++) { const l = 0.2126 * R[i] + 0.7152 * G[i] + 0.0722 * B[i]; m[i] = Math.max(0, l - threshold); }
    const g = blur(m, w, h, radius * scale);
    for (let i = 0; i < n; i++) { R[i] += g[i] * amount * tintRGB[0]; G[i] += g[i] * amount * tintRGB[1]; B[i] += g[i] * amount * tintRGB[2]; }
  };
  glow(p.halation?.amount ?? 0, p.halation?.radius_px_at_2k ?? 6, p.halation?.threshold ?? 0.8, [1, 0.35, 0.15]);
  glow(p.bloom?.amount ?? 0, 24, 0.7, [1, 1, 1]);

  // 3. saturation
  const sat = p.color?.saturation ?? 1;
  if (sat !== 1) for (let i = 0; i < n; i++) {
    const l = 0.2126 * R[i] + 0.7152 * G[i] + 0.0722 * B[i];
    R[i] = l + (R[i] - l) * sat; G[i] = l + (G[i] - l) * sat; B[i] = l + (B[i] - l) * sat;
  }

  // encode, 4. tone
  const out = new Uint8ClampedArray(rgba.length);
  const tone = p.tone ?? {};
  const toneOn = (tone.contrast ?? 0) !== 0 || (tone.toe ?? 0) !== 0 || (tone.shoulder ?? 0) !== 0;
  const er = new Float32Array(n), eg = new Float32Array(n), eb = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let r = toSrgb(clamp01(R[i])), g = toSrgb(clamp01(G[i])), b = toSrgb(clamp01(B[i]));
    if (toneOn) { r = toneCurve(r, tone); g = toneCurve(g, tone); b = toneCurve(b, tone); }
    er[i] = r; eg[i] = g; eb[i] = b;
  }

  // 5. grain (spatial texture, not a color lookup)
  const amount = p.grain?.amount ?? 0;
  if (amount > 0) {
    const sigma = grainPixels(p.grain?.size_um ?? 8, opts.captureWidthMm ?? 24.89, w);
    const rand = rng(opts.seed ?? 1);
    const noise = () => { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = rand() + rand() + rand() - 1.5; return a; };
    const norm = (a: Float32Array) => { const s = Math.sqrt(a.reduce((t, v) => t + v * v, 0) / n) || 1; for (let i = 0; i < n; i++) a[i] /= s; return a; };
    const mono = norm(blur(noise(), w, h, sigma));
    const chroma = p.grain?.chroma ?? 0;
    const cr = chroma ? norm(blur(noise(), w, h, sigma)) : null, cb = chroma ? norm(blur(noise(), w, h, sigma)) : null;
    for (let i = 0; i < n; i++) {
      const l = 0.2126 * er[i] + 0.7152 * eg[i] + 0.0722 * eb[i];
      const k = amount * (0.35 + 2.6 * l * (1 - l));      // strongest in the midtones
      er[i] += k * (mono[i] + (cr ? chroma * cr[i] : 0));
      eg[i] += k * mono[i];
      eb[i] += k * (mono[i] + (cb ? chroma * cb[i] : 0));
    }
  }
  for (let i = 0; i < n; i++) {
    out[i * 4] = Math.round(clamp01(er[i]) * 255); out[i * 4 + 1] = Math.round(clamp01(eg[i]) * 255);
    out[i * 4 + 2] = Math.round(clamp01(eb[i]) * 255); out[i * 4 + 3] = rgba[i * 4 + 3];
  }
  return out;
}
