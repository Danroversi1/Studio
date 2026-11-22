import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanComposition, emptyComposition, laneOf, toBoxFraction, type Composition } from "../../lib/storyboard/compose";
import { buildSvg } from "../../lib/storyboard/svg-export";
import { putTraces } from "../../lib/storyboard/trace-store";

putTraces([{ id: "t1", treatment: "outline", width: 100, height: 50, settings: { ink: "#141414" }, source: [],
  paths: [{ d: "M0 0L10 10", s: "#141414", w: 2 }, { d: "M0 0L5 0L5 5Z", f: "#141414" }, { d: "M0 0\"/><script>", f: "#000000" }] }]);

function comp(): Composition {
  return cleanComposition({
    ...emptyComposition(16 / 9),
    layers: [
      { id: "img", type: "image", name: "Johnny", assetId: "a1", x: 400, y: 300, w: 400, h: 600, rot: 0,
        masks: [{ mode: "keep", pts: [0, 0, 1, 0, 1, 1] }, { mode: "remove", pts: [0.1, 0.1, 0.2, 0.1] }] },
      { id: "vec", type: "vector", name: "Lines", traceId: "t1", treatment: "outline", sourceIds: ["img"], x: 400, y: 300, w: 400, h: 200, rot: 0, removed: [1], weight: 4 },
      { id: "dr", type: "drawing", name: "Mine", x: 800, y: 450, w: 1600, h: 900, rot: 0, strokes: [{ color: "#ff0000", width: 5, pts: [0, 0, 10, 10] }] },
      { id: "nt", type: "drawing", role: "annotation", name: "Notes", x: 800, y: 450, w: 1600, h: 900, rot: 0, strokes: [] },
      { id: "tx", type: "text", name: "Caption", text: "<b>Run</b> & \"go\"", x: 800, y: 800, w: 600, h: 100, rot: 0 },
      { id: "bad", type: "vector", name: "no trace id", x: 0, y: 0, w: 10, h: 10, rot: 0 },
    ],
  });
}

test("vector layers, masks and lanes survive cleaning", () => {
  const c = comp();
  assert.equal(c.layers.length, 5, "a vector layer without a trace is dropped");
  const img = c.layers[0], vec = c.layers[1];
  assert.equal(img.masks?.length, 1, "a mask needs at least three points");
  assert.deepEqual(vec.removed, [1]);
  assert.equal(vec.weight, 4);
  assert.deepEqual(c.layers.map(laneOf), ["reference", "trace", "drawing", "annotation", "annotation"]);
});

test("lasso points land on the picture itself, through flips", () => {
  const l = { id: "a", type: "image" as const, name: "", x: 100, y: 100, w: 200, h: 100, rot: 0 };
  assert.deepEqual(toBoxFraction(l, 0, 50), [0, 0]);
  assert.deepEqual(toBoxFraction({ ...l, flipX: true }, 0, 50), [1, 0]);
});

test("vector SVG: real paths, no pictures, nothing unsafe", () => {
  const { svg, leftOut } = buildSvg(comp(), "vector");
  assert.match(svg, /<path d="M0 0L10 10" fill="none" stroke="#141414" stroke-width="4"/, "line weight override changes the real stroke");
  assert.ok(!svg.includes("M0 0L5 0L5 5Z"), "a deleted path is left out");
  assert.ok(!svg.includes("<script"), "invalid path data never reaches the file");
  assert.ok(!svg.includes("<image"), "no pictures in a vector-only file");
  assert.ok(svg.includes("&lt;b&gt;Run&lt;/b&gt; &amp; &quot;go&quot;"), "text is escaped");
  assert.deepEqual(leftOut, ["picture “Johnny”"]);
});

test("mixed SVG embeds only image data URIs, with masks", () => {
  const ok = buildSvg(comp(), "mixed", new Map([["a1", "data:image/png;base64,iVBORw0KGgo="]]));
  assert.match(ok.svg, /<image href="data:image\/png;base64,iVBORw0KGgo="/);
  assert.match(ok.svg, /<clipPath id="L0k"><polygon/);
  const bad = buildSvg(comp(), "mixed", new Map([["a1", "javascript:alert(1)"]]));
  assert.ok(!bad.svg.includes("javascript"), "anything but an image data URI is refused");
  assert.equal(bad.leftOut.length, 1);
});
