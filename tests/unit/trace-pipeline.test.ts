import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const P = require("../../vendor-src/trace-pipeline.cjs");
const IT = require("imagetracerjs");

// OpenCV's Emscripten module is a thenable that resolves to itself, so it is never awaited
// directly: wait for the runtime, then hand it back inside a box.
let cvP: Promise<{ cv: any }> | null = null; // eslint-disable-line @typescript-eslint/no-explicit-any
function cvLoad() {
  cvP ??= new Promise((ok) => {
    const cv = require("@techstark/opencv-js");
    const iv = setInterval(() => { if (cv.Mat) { clearInterval(iv); ok({ cv }); } }, 10);
  });
  return cvP; // the box, never the module (an async return would resolve the thenable again)
}

// A 160×100 "photo": light wall, a dark door, a mid-grey window, a figure cut out (transparent) on the right.
function photo(w = 160, h = 100) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    let v = 225;
    if (x > 20 && x < 50 && y > 30) v = 35;              // door
    if (x > 70 && x < 110 && y > 20 && y < 55) v = 130;   // window
    d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = x > 140 ? 0 : 255; // masked strip
  }
  return { width: w, height: h, data: d };
}

test("edge linking and simplification turn pixels into lines", () => {
  const w = 20, h = 10, bin = new Uint8Array(w * h);
  for (let x = 2; x < 18; x++) bin[5 * w + x] = 255;          // one horizontal edge
  const chains = P.linkEdges(bin, w, h);
  assert.equal(chains.length, 1, "one chain");
  assert.equal(chains[0].length / 2, 16, "every edge pixel once");
  assert.deepEqual(P.simplifyLine(chains[0], 0.5), [2.5, 5.5, 17.5, 5.5], "a straight edge becomes two points");
});

test("each preset produces bounded vector paths, with no network and no model", async () => {
  const { cv } = await cvLoad();
  const out: Record<string, { paths: { d: string; f?: string; s?: string; w?: number }[]; stats: { paths: number } }> = {};
  for (const treatment of ["outline", "ink", "three_tone"]) {
    out[treatment] = P.trace(cv, IT, photo(), { treatment, detail: 0.6, simplify: 0.3, weight: 3, ink: "#101820" });
    const r = out[treatment];
    assert.ok(r.paths.length > 0, `${treatment}: some paths`);
    for (const p of r.paths) assert.match(p.d, /^[MLQCZ0-9 .-]+$/, "path data only");
  }
  assert.ok(out.outline.paths.every((p) => p.s === "#101820" && p.w === 3 && !p.f), "outline: strokes with the chosen weight");
  assert.ok(out.ink.paths.every((p) => p.f === "#101820"), "ink: filled black shapes in the ink colour");
  assert.deepEqual([...new Set(out.three_tone.paths.map((p) => p.f))].sort(), ["#101820", "#8a8a8a"], "three-tone: grey and dark regions; white stays paper");
  // Masked-out pixels (x > 140) never produce ink.
  const xs = out.ink.paths.flatMap((p) => p.d.match(/-?\d+(\.\d+)?/g)!.map(Number).filter((_, i) => i % 2 === 0));
  assert.ok(Math.max(...xs) <= 141, "nothing traced inside the masked area");
  const thick = P.trace(cv, IT, photo(), { treatment: "ink", weight: 7 });
  const thin = P.trace(cv, IT, photo(), { treatment: "ink", weight: 1 });
  const area = (r: { paths: { d: string }[] }) => r.paths.reduce((n, p) => n + p.d.length, 0);
  assert.ok(area(thick) !== area(thin), "ink line weight changes the traced geometry");
});

test("cancelling stops a trace", async () => {
  const { cv } = await cvLoad();
  assert.throws(() => P.trace(cv, IT, photo(), { treatment: "outline" }, null, () => true), /cancelled/);
});
