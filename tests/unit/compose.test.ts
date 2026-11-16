import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FRAME_W, History, addLayer, cleanComposition, copyForNewFrame, duplicateLayers, emptyComposition, frameH, group, hits, pick,
  reorder, resizeFromHandle, rotateTo, setAspect, snapMove, tipFor, toFrame, toLocal, update, withGroup, libraryUse, viewToFrame,
} from "../../lib/storyboard/compose";
import { applyLook, isNeutral } from "../../lib/storyboard/look";
import { DEFAULT_LOOK } from "../../lib/storyboard/compose";

const base = () => {
  let c = emptyComposition(16 / 9);
  c = addLayer(c, { type: "shape", name: "A", shape: "rect", x: 400, y: 300, w: 200, h: 100, rot: 0, libraryId: undefined }).comp;
  c = addLayer(c, { type: "image", name: "B", libraryId: "lib1", assetId: "as1", x: 1000, y: 450, w: 300, h: 400, rot: 30 }).comp;
  return c;
};

test("local/frame transforms round-trip and hit-testing respects rotation", () => {
  const l = base().layers[1];
  const [x, y] = toFrame(l, 100, -50); const [lx, ly] = toLocal(l, x, y);
  assert.ok(Math.abs(lx - 100) < 1e-9 && Math.abs(ly + 50) < 1e-9);
  assert.ok(hits(l, l.x, l.y)); assert.ok(!hits(l, l.x + 400, l.y));
});
test("picking takes the topmost visible, unlocked layer", () => {
  let c = base();
  c = addLayer(c, { type: "shape", name: "C", shape: "rect", x: 400, y: 300, w: 50, h: 50, rot: 0 }).comp;
  assert.equal(pick(c, 400, 300)?.name, "C");
  c = update(c, [c.layers[2].id], () => ({ locked: true }));
  assert.equal(pick(c, 400, 300)?.name, "A");
});
test("edits never change the original (frames stay independent)", () => {
  const c = base(); const before = JSON.stringify(c);
  const d = update(c, [c.layers[0].id], () => ({ x: 9 }));
  assert.equal(JSON.stringify(c), before); assert.equal(d.layers[0].x, 9);
  const copy = copyForNewFrame(c);
  assert.notEqual(copy.layers[0].id, c.layers[0].id, "new layer IDs");
  assert.deepEqual(libraryUse(copy), ["lib1"], "same shared library item");
  const moved = update(copy, [copy.layers[1].id], () => ({ x: 0 }));
  assert.equal(c.layers[1].x, 1000, "moving in the copy doesn't move the original");
  assert.equal(moved.layers[1].libraryId, c.layers[1].libraryId);
});
test("duplicate, reorder, group", () => {
  const c = base(); const [a, b] = c.layers.map((l) => l.id);
  const d = duplicateLayers(c, [a]);
  assert.equal(d.comp.layers.length, 3); assert.equal(d.comp.layers[2].x, 440);
  assert.deepEqual(reorder(c, [a], "front").layers.map((l) => l.id), [b, a]);
  assert.deepEqual(reorder(c, [b], "down").layers.map((l) => l.id), [b, a]);
  const g = group(c, [a, b]);
  assert.deepEqual(withGroup(g, [a]).sort(), [a, b].sort());
});
test("resize keeps the opposite corner fixed; ratio kept when asked", () => {
  const l = { ...base().layers[0] };
  const r = resizeFromHandle(l, [1, 1], 600, 400, true);
  assert.ok(Math.abs((r.w! / r.h!) - 2) < 1e-9);
  const opp = toFrame({ ...l, ...r }, -r.w! / 2, -r.h! / 2);
  assert.ok(Math.abs(opp[0] - 300) < 1e-6 && Math.abs(opp[1] - 250) < 1e-6);
  assert.equal(rotateTo(l, l.x + 100, l.y, true).rot, 90);
});
test("snapping to the frame centre gives a guide", () => {
  const c = base(); const id = c.layers[0].id;
  const s = snapMove(c, [id], FRAME_W / 2 - 400 + 3, 0, 8);
  assert.equal(s.dx, FRAME_W / 2 - 400); assert.ok(s.guides.some((g) => g.x === FRAME_W / 2));
});
test("undo and redo restore edits", () => {
  const h = new History(); const c0 = base(); const c1 = update(c0, [c0.layers[0].id], () => ({ x: 1 }));
  h.push(c0);
  assert.equal(h.undo(c1)?.layers[0].x, 400); assert.equal(h.redo(c0)?.layers[0].x, 1);
  assert.equal(h.canRedo, false);
});
test("stored data is cleaned; aspect changes keep things centred", () => {
  const c = cleanComposition({ aspect: 99, layers: [{ type: "evil" }, { type: "text", text: "Hi", fontSize: 9999 }], look: { grain: { amount: 5 } } });
  assert.equal(c.aspect, 4); assert.equal(c.layers.length, 1); assert.equal(c.layers[0].fontSize, 600); assert.equal(c.look.grain.amount, 0.3);
  const b = base(); const w = setAspect(b, 2.39);
  assert.ok(Math.abs(w.layers[0].y - (300 + (FRAME_W / 2.39 - frameH(b)) / 2)) < 1e-9);
});
test("2D framing maps the view back to the frame", () => {
  const c = { ...base(), framing: { zoom: 2, panX: 100, panY: 0 } };
  const [x, y] = viewToFrame(c, FRAME_W / 2, frameH(c) / 2);
  assert.ok(Math.abs(x - (FRAME_W / 2 + 100)) < 1e-9 && Math.abs(y - frameH(c) / 2) < 1e-9);
});
test("tips are deterministic suggestions", () => {
  assert.match(tipFor(emptyComposition()), /Start with/);
  const c = addLayer(emptyComposition(), { type: "shape", name: "P", shape: "person-stand", x: FRAME_W / 2, y: 400, w: 150, h: 400, rot: 0 }).comp;
  assert.match(tipFor(c), /closer to the edge/);
});
test("look: neutral is identity; grain is seeded and resolution-aware", () => {
  const w = 48, h = 32, px = new Uint8ClampedArray(w * h * 4).fill(128);
  assert.ok(isNeutral(DEFAULT_LOOK));
  const same = applyLook(px, w, h, DEFAULT_LOOK);
  assert.ok(Math.max(...same.map((v, i) => Math.abs(v - px[i]))) <= 1);
  const g = { ...DEFAULT_LOOK, grain: { amount: 0.06, size: 8, seed: 42 } };
  const a = applyLook(px, w, h, g), b = applyLook(px, w, h, g);
  assert.deepEqual([...a], [...b], "same seed, same grain (preview = export)");
  const c = applyLook(px, w, h, { ...g, grain: { ...g.grain, seed: 43 } });
  assert.notDeepEqual([...a], [...c]);
  const gray = applyLook(Uint8ClampedArray.from([200, 50, 50, 255]), 1, 1, { ...DEFAULT_LOOK, grayscale: true });
  assert.ok(gray[0] === gray[1] && gray[1] === gray[2]);
});
