import { test } from "node:test";
import assert from "node:assert/strict";
import { hexToRgb, pencil, toPalette, toneGreys, tones, vectorOptions, workingSize } from "../../lib/storyboard/trace";

// A 40×30 picture: light background, a dark block on the right half.
function picture(w = 40, h = 30) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, dark = x >= 20;
    data[i] = dark ? 40 : 220; data[i + 1] = dark ? 50 : 210; data[i + 2] = dark ? 60 : 190; data[i + 3] = 255;
  }
  return { data, width: w, height: h };
}

test("pencil draws the edge, leaves flat areas clear", () => {
  const p = picture();
  const out = pencil(p, { detail: 0.5 });
  const alpha = (x: number, y: number) => out[(y * 40 + x) * 4 + 3];
  assert.ok(alpha(19, 15) > 100 || alpha(20, 15) > 100, "line at the boundary");
  assert.equal(alpha(5, 15), 0, "clear on the flat light side");
  assert.equal(alpha(35, 15), 0, "clear on the flat dark side");
  assert.deepEqual(pencil(p, { detail: 0.5 }), out, "deterministic");
  const thick = pencil(p, { detail: 0.5, weight: 3 });
  const count = (a: Uint8ClampedArray) => a.filter((_, i) => i % 4 === 3 && a[i] > 0).length;
  assert.ok(count(thick) > count(out), "weight thickens lines");
});

test("tones uses only the value-study greys, dark stays dark", () => {
  const out = tones(picture(), 3);
  const greys = toneGreys(3);
  for (let i = 0; i < out.length; i += 4) assert.ok(greys.includes(out[i]));
  assert.ok(out[(15 * 40 + 35) * 4] < out[(15 * 40 + 5) * 4], "dark block is darker than the light side");
  assert.deepEqual(toneGreys(9).length, 6);
});

test("palette maps every pixel to a palette colour", () => {
  const pal = ["#1b1b1b", "#e0c088", "#5a7d3c"];
  const out = toPalette(picture(), pal);
  const allowed = pal.map((h) => hexToRgb(h)!.join(","));
  for (let i = 0; i < out.length; i += 4) assert.ok(allowed.includes(`${out[i]},${out[i + 1]},${out[i + 2]}`));
  assert.equal(`${out[(15 * 40 + 35) * 4]},${out[(15 * 40 + 35) * 4 + 1]},${out[(15 * 40 + 35) * 4 + 2]}`, "27,27,27");
  const d = toPalette(picture(), pal, { dither: true });
  for (let i = 0; i < d.length; i += 4) assert.ok(allowed.includes(`${d[i]},${d[i + 1]},${d[i + 2]}`), "dithering keeps to the palette");
  assert.throws(() => toPalette(picture(), ["nope"]), /no palette/);
});

test("working size and vector options", () => {
  assert.deepEqual(workingSize(4000, 2000, 1400), { w: 1400, h: 700 });
  assert.deepEqual(workingSize(300, 200), { w: 300, h: 200 });
  assert.deepEqual(vectorOptions(["a1b2c3", "#zzzzzz"]).palette, ["#a1b2c3"]);
  assert.equal(vectorOptions([]).palette, undefined);
  assert.ok(vectorOptions([], 1).filterSpeckle < vectorOptions([], 0).filterSpeckle, "more detail keeps smaller shapes");
});

test("a treatment thumbnail window maps onto the rendered slide", async () => {
  const { cropRect } = await import("../../lib/thumb-picture");
  assert.deepEqual(cropRect({ x: 0.25, y: 0.1, w: 0.5, h: 0.5 }, 1600, 900), { x: 400, y: 90, w: 800, h: 450 });
  assert.deepEqual(cropRect({ x: 0.9, y: 0.9, w: 0.5, h: 0.5 }, 1000, 1000), { x: 900, y: 900, w: 100, h: 100 }, "kept inside the slide");
});
