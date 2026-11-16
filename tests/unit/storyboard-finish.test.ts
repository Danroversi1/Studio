import assert from "node:assert/strict";
import { test } from "node:test";
import { applyFinish, grainPixels, toneCurve } from "../../lib/storyboard/finish";

function image(w: number, h: number, f: (x: number, y: number) => number) {
  const a = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = f(x, y); const i = (y * w + x) * 4; a[i] = a[i + 1] = a[i + 2] = v; a[i + 3] = 255; }
  return a;
}
const maxDiff = (a: Uint8ClampedArray, b: Uint8ClampedArray) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };
const stdev = (a: Uint8ClampedArray) => { const v: number[] = []; for (let i = 0; i < a.length; i += 4) v.push(a[i]); const mu = v.reduce((s, x) => s + x, 0) / v.length; return Math.sqrt(v.reduce((s, x) => s + (x - mu) ** 2, 0) / v.length); };

test("no finish leaves the image unchanged (round-trip through linear light)", () => {
  const img = image(32, 16, (x) => x * 8);
  assert.ok(maxDiff(applyFinish(img, 32, 16, {}), img) <= 1);
});
test("grain is spatial texture: none without it, present with it, repeatable", () => {
  const flat = image(64, 64, () => 128);
  assert.equal(stdev(applyFinish(flat, 64, 64, { grain: { amount: 0 } })), 0);
  const a = applyFinish(flat, 64, 64, { grain: { amount: 0.05, size_um: 8 } }, { seed: 7 });
  const b = applyFinish(flat, 64, 64, { grain: { amount: 0.05, size_um: 8 } }, { seed: 7 });
  assert.ok(stdev(a) > 2); assert.equal(maxDiff(a, b), 0);
});
test("grain size scales with resolution and format", () => {
  assert.ok(grainPixels(8, 24.89, 4096) > grainPixels(8, 24.89, 2048) * 1.9);
  assert.ok(grainPixels(8, 12.52, 2048) > grainPixels(8, 24.89, 2048) * 1.9, "Super 16 grain looks bigger than Super 35");
});
test("halation glows only around highlights", () => {
  const img = image(64, 32, (x) => (x > 40 && x < 44 ? 255 : 30));
  const out = applyFinish(img, 64, 32, { halation: { amount: 0.5, radius_px_at_2k: 200, threshold: 0.6 } });
  const at = (x: number) => out[(16 * 64 + x) * 4];
  assert.ok(at(46) > 30, "glow next to the highlight"); assert.ok(at(46) > out[(16 * 64 + 46) * 4 + 2], "warm (red over blue)");
  assert.ok(Math.abs(at(5) - 30) <= 1, "dark areas far away untouched");
});
test("the tone curve is monotonic and stays in range", () => {
  let prev = -1;
  for (let i = 0; i <= 100; i++) { const y = toneCurve(i / 100, { contrast: 0.2, toe: 0.1, shoulder: 0.2 }); assert.ok(y >= prev && y >= 0 && y <= 1); prev = y; }
});
