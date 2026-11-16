import assert from "node:assert/strict";
import { test } from "node:test";
import { fromHex, sampleAt, suggestPalette, toHex } from "../../lib/look/palette";
import { resolveFrameLook } from "../../lib/look/resolve";
import { accessOf, cleanApplies, type LookDirection, type LookRef } from "../../lib/look/types";

function img(colors: [number, number, number][], each: number) {
  const a = new Uint8ClampedArray(colors.length * each * 4);
  colors.forEach((c, ci) => { for (let i = 0; i < each; i++) { const o = (ci * each + i) * 4; a[o] = c[0]; a[o + 1] = c[1]; a[o + 2] = c[2]; a[o + 3] = 255; } });
  return a;
}

test("palette suggestions are deterministic and ordered by area", () => {
  const data = img([[85, 107, 47], [200, 200, 190], [30, 30, 30]], 400);
  const a = suggestPalette(data, 3), b = suggestPalette(data, 3);
  assert.deepEqual(a, b);
  assert.equal(a.length, 3);
  assert.ok(a.includes("#556b2f") && a.includes("#c8c8be") && a.includes("#1e1e1e"));
  assert.deepEqual(suggestPalette(img([[10, 20, 30]], 50), 6), ["#0a141e"], "one color gives one suggestion");
});

test("sampling and hex", () => {
  assert.equal(toHex(255, 0, 128), "#ff0080");
  assert.deepEqual(fromHex("#ff0080"), [255, 0, 128]);
  const data = img([[100, 150, 200]], 25);
  assert.equal(sampleAt(data, 5, 5, 2, 2), "#6496c8");
});

const dir = (id: string, extra: Partial<LookDirection> = {}): LookDirection => ({ id, name: id, intention: "", notes: "", palette: [], scope: { film: true },
  status: "approved", isDefault: false, version: 1, position: 0, referenceIds: [], ...extra });
const ref = (id: string): LookRef => ({ id, assetId: "a", thumbAssetId: null, crop: null, sourceUrl: null, sourceEntityId: null, title: id, tags: [], reason: "",
  useFor: "", leaveOut: "", applies: { film: true }, status: "approved", palette: [], attribution: "", permission: "", position: 0 });

test("frame look resolution order and conflicts", () => {
  const def = dir("warm", { isDefault: true }), cold = dir("cold", { scope: { scenes: [3] } }), dream = dir("dream", { scope: { entities: ["marie"] } });
  const ds = [def, cold, dream];
  assert.equal(resolveFrameLook(null, null, ds, [], { entityIds: [] }).kind, "direction");
  assert.equal((resolveFrameLook(null, null, ds, [], { entityIds: [] }) as { direction: LookDirection }).direction.id, "warm");
  assert.equal((resolveFrameLook(null, null, ds, [], { scene: 3, entityIds: [] }) as { direction: LookDirection }).direction.id, "cold");
  const c = resolveFrameLook(null, null, ds, [], { scene: 3, entityIds: ["marie"] });
  assert.equal(c.kind, "conflict", "two scoped directions are never combined");
  assert.equal((resolveFrameLook({ mode: "direction", direction_id: "dream", version: 1 }, null, ds, [], { scene: 3, entityIds: ["marie"] }) as { direction: LookDirection }).direction.id, "dream", "her choice settles it");
  assert.equal((resolveFrameLook(null, "cold", ds, [], { entityIds: [] }) as { direction: LookDirection }).direction.id, "cold", "storyboard choice beats the default");
  const out = resolveFrameLook({ mode: "direction", direction_id: "warm", version: 1 }, null, [dir("warm", { isDefault: true, version: 3 })], [], { entityIds: [] });
  assert.equal((out as { outdated: boolean }).outdated, true, "a frame set against an older version is marked");
  const r = resolveFrameLook({ mode: "references", reference_ids: ["r1"] }, null, ds, [ref("r1"), ref("r2")], { entityIds: [] });
  assert.equal(r.kind === "references" && r.refs.map((x) => x.id).join(), "r1");
  assert.equal(resolveFrameLook(null, null, [dir("x", { status: "draft", isDefault: false })], [], { entityIds: [] }).kind, "none");
});

test("access labels and scope cleanup", () => {
  assert.equal(accessOf({ assetId: null, crop: null, sourceUrl: "https://pinterest.com/x" }), "link");
  assert.equal(accessOf({ assetId: "a", crop: null, sourceUrl: "https://x" }), "image");
  assert.equal(accessOf({ assetId: null, crop: null, sourceUrl: null }), "missing");
  assert.deepEqual(cleanApplies({ entities: [], scenes: [] }), { film: true });
  assert.deepEqual(cleanApplies({ scenes: [2] }), { entities: [], scenes: [2] });
});
