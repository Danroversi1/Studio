import assert from "node:assert/strict";
import { test } from "node:test";
import { depthOfField, distanceForFraming, equivalentFocal, fieldOfView, frameSizeAt, usedArea } from "../../lib/storyboard/camera";

const near = (a: number, b: number, tol = 0.2) => assert.ok(Math.abs(a - b) <= tol, `${a} ≈ ${b}`);

test("50 mm on full frame: textbook angles", () => {
  const f = fieldOfView({ formatId: "ff", focalMm: 50 })!;
  near(f.h, 39.6); near(f.v, 27.0); near(f.d, 46.8);
});
test("same focal length, smaller capture area = narrower view", () => {
  const ff = fieldOfView({ formatId: "ff", focalMm: 35 })!.h;
  const s35 = fieldOfView({ formatId: "s35", focalMm: 35 })!.h;
  const s16 = fieldOfView({ formatId: "s16", focalMm: 35 })!.h;
  assert.ok(ff > s35 && s35 > s16);
});
test("cropping to a wider aspect keeps the width, loses height", () => {
  const a = usedArea({ formatId: "s35", aspect: 2.39 })!;
  near(a.widthMm, 24.89, 0.01); near(a.heightMm, 24.89 / 2.39, 0.01);
  const b = usedArea({ formatId: "s35", aspect: 1.33 })!;
  near(b.heightMm, 18.66, 0.01);
});
test("a 2× anamorphic lens doubles the scene width on the same gate", () => {
  const sph = fieldOfView({ formatId: "ana35", focalMm: 50, aspect: 2.39 })!;
  const ana = fieldOfView({ formatId: "ana35", focalMm: 50, anamorphic: true, squeeze: 2, aspect: 2.39 })!;
  assert.ok(ana.h > sph.h * 1.6, "much wider horizontally");
  // De-squeezed 43.9 × 18.6 cropped to 2.39 → width 43.9 mm.
  near(usedArea({ formatId: "ana35", anamorphic: true, squeeze: 2, aspect: 2.39 })!.widthMm, 43.9, 0.05);
});
test("frame size grows with distance; framing distance follows the lens", () => {
  const c = { formatId: "s35", focalMm: 32, aspect: 1.85 };
  assert.ok(frameSizeAt(c, 4)!.widthM > frameSizeAt(c, 2)!.widthM * 1.99);
  const wide = distanceForFraming({ ...c, focalMm: 25 }, "medium")!;
  const tele = distanceForFraming({ ...c, focalMm: 85 }, "medium")!;
  assert.ok(tele > wide * 3, "a longer lens needs the camera further away for the same framing");
});
test("equivalent focal length across formats", () => {
  // 50 mm on full frame ≈ 34–35 mm on Super 35 (crop factor ~1.45 by width).
  near(equivalentFocal({ formatId: "ff", focalMm: 50 }, { formatId: "s35" })!, 34.6, 0.3);
});
test("depth of field: wider aperture or closer focus = shallower", () => {
  const a = depthOfField({ formatId: "s35", focalMm: 50, aperture: 2, focusM: 3 })!;
  const b = depthOfField({ formatId: "s35", focalMm: 50, aperture: 8, focusM: 3 })!;
  assert.ok((a.farM! - a.nearM) < (b.farM! - b.nearM));
  assert.ok(a.nearM < 3 && a.farM! > 3);
  assert.equal(depthOfField({ formatId: "s35", focalMm: 50, aperture: 2, focusM: 3, apertureKind: "T" })!.approximate, true);
  assert.equal(depthOfField({ formatId: "s35", focalMm: 18, aperture: 16, focusM: 10 })!.farM, null, "beyond hyperfocal: sharp to infinity");
});
