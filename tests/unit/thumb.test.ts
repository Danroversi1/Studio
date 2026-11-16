import assert from "node:assert/strict";
import { test } from "node:test";
import { cropPlacement, thumbOf, windowOf } from "../../lib/thumb";

test("a crop fills its box exactly when the box matches its shape", () => {
  const c = { file_id: "f", slide: 2, ...windowOf(0.25, 0.1, 0.3) };
  assert.ok(Math.abs(c.h - 0.4) < 1e-9, "4:3 window on a 16:9 slide");
  const p = cropPlacement(c, 120, 90);
  assert.ok(Math.abs(p.width - 400) < 1e-6);
  assert.ok(Math.abs(p.left + 100) < 1e-6 && Math.abs(p.top + 22.5) < 1e-6);
});
test("windows stay inside the slide", () => {
  const w = windowOf(0.9, 0.9, 0.3);
  assert.ok(w.x + w.w <= 1 && w.y + w.h <= 1);
});
test("reads either kind of thumbnail", () => {
  assert.equal(thumbOf({ thumbnail_asset_id: "a" })?.kind, "asset");
  assert.equal(thumbOf({ thumbnail_crop: { file_id: "f", slide: 1, x: 0, y: 0, w: 0.3, h: 0.4 } })?.kind, "crop");
  assert.equal(thumbOf({}), null);
});
