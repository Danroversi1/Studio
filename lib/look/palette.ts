// Colors from an image, by plain arithmetic (deterministic; never a model). Pure; unit-tested.

export const toHex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
export function fromHex(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/** Readable text color on a swatch. */
export const inkOn = (hex: string) => { const [r, g, b] = fromHex(hex); return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#111111" : "#ffffff"; };

/** The average color of a small square around (x, y) in an RGBA buffer. */
export function sampleAt(rgba: Uint8ClampedArray, w: number, h: number, x: number, y: number, radius = 2): string {
  let r = 0, g = 0, b = 0, n = 0;
  for (let yy = Math.max(0, Math.round(y) - radius); yy <= Math.min(h - 1, Math.round(y) + radius); yy++) {
    for (let xx = Math.max(0, Math.round(x) - radius); xx <= Math.min(w - 1, Math.round(x) + radius); xx++) {
      const i = (yy * w + xx) * 4;
      if (rgba[i + 3] < 16) continue;
      r += rgba[i]; g += rgba[i + 1]; b += rgba[i + 2]; n++;
    }
  }
  return n ? toHex(r / n, g / n, b / n) : "#000000";
}

/** Suggest up to k colors (median cut over the image's pixels, largest groups first).
 *  The same image always gives the same colors. Suggestions, not the film's whole palette. */
export function suggestPalette(rgba: Uint8ClampedArray, k = 6, maxSamples = 20000): string[] {
  const px: [number, number, number][] = [];
  const total = rgba.length / 4;
  const step = Math.max(1, Math.floor(total / maxSamples));
  for (let p = 0; p < total; p += step) {
    const i = p * 4;
    if (rgba[i + 3] < 128) continue;
    px.push([rgba[i], rgba[i + 1], rgba[i + 2]]);
  }
  if (!px.length) return [];
  let boxes: [number, number, number][][] = [px];
  while (boxes.length < k) {
    // Split the box with the widest color range (ties: the bigger box).
    let best = -1, bestRange = -1, bestCh = 0;
    boxes.forEach((b, bi) => {
      if (b.length < 2) return;
      for (let c = 0; c < 3; c++) {
        let lo = 255, hi = 0;
        for (const p of b) { if (p[c] < lo) lo = p[c]; if (p[c] > hi) hi = p[c]; }
        const range = (hi - lo) * 1e6 + b.length;
        if (range > bestRange) { bestRange = range; best = bi; bestCh = c; }
      }
    });
    if (best < 0 || bestRange < 1e6) break;
    const b = [...boxes[best]].sort((p, q) => p[bestCh] - q[bestCh] || p[0] - q[0] || p[1] - q[1] || p[2] - q[2]);
    // Split at a value boundary near the middle, so identical colors stay together.
    const m = b[b.length >> 1][bestCh];
    let mid = b.findIndex((q) => q[bestCh] > m);
    if (mid <= 0) mid = b.findIndex((q) => q[bestCh] >= m);
    if (mid <= 0) mid = b.length >> 1;
    boxes = [...boxes.slice(0, best), b.slice(0, mid), b.slice(mid), ...boxes.slice(best + 1)];
  }
  const colors = boxes
    .map((b) => { const s = [0, 0, 0]; for (const p of b) { s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; } return { n: b.length, hex: toHex(s[0] / b.length, s[1] / b.length, s[2] / b.length) }; })
    .sort((a, b) => b.n - a.n || a.hex.localeCompare(b.hex));
  // Drop near-duplicates.
  const out: string[] = [];
  for (const c of colors) {
    const [r, g, b] = fromHex(c.hex);
    if (out.every((o) => { const [r2, g2, b2] = fromHex(o); return Math.abs(r - r2) + Math.abs(g - g2) + Math.abs(b - b2) > 24; })) out.push(c.hex);
  }
  return out;
}
