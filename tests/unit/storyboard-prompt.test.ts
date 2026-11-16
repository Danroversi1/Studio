import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPrompt, outputSize } from "../../lib/storyboard/prompt";
import { between, cleanShot, sequenceTiming, textKey } from "../../lib/storyboard/shot";

const base = {
  shot: cleanShot({ action: "Johnny sips coffee by the window.", size: "medium", angle: "low", characters: ["Johnny"], location: "Coffee Shop",
    camera: { formatId: "s35", focalMm: 40, aspect: 1.85 } }),
  mode: "storyboard" as const, kind: "frame" as const, style: "pencil" as const, aspect: 1.85,
  cast: [{ name: "Johnny", summary: "A tired man in a gray coat" }, { name: "Marie", summary: "A journalist" }],
  locations: [{ name: "Coffee Shop", summary: "Small café" }], refs: [],
};

test("storyboard prompts lead with composition, carry her action, and only cast in the shot", () => {
  const p = buildPrompt(base);
  assert.match(p, /storyboard frame/); assert.match(p, /Johnny sips coffee/); assert.match(p, /gray coat/);
  assert.doesNotMatch(p, /journalist/, "Marie isn't in this shot");
  assert.match(p, /creative guidance/); assert.match(p, /Do not draw any text/);
});
test("text-only references are never described as images", () => {
  const p = buildPrompt({ ...base, refs: [
    { role: "drawing_style", title: "Her sketch", borrow: "line weight", ignore: "colors", attached: true },
    { role: "lighting", title: "Rainy neon street", borrow: "", ignore: "", attached: false },
  ] });
  assert.match(p, /\[1\] Drawing style — Her sketch; borrow: line weight; ignore: colors/);
  assert.match(p, /Described references \(no image attached\): Lighting or atmosphere: Rainy neon street/);
});
test("a look preview with a grain finish asks for a clean image (no double grain)", () => {
  const withGrain = buildPrompt({ ...base, mode: "look", kind: "look", finish: { name: "x", params: { grain: { amount: 0.05 } } }, baseIsStoryboard: true });
  assert.match(withGrain, /no film grain/); assert.match(withGrain, /Keep its composition/); assert.match(withGrain, /approximation/);
  const none = buildPrompt({ ...base, mode: "look", kind: "look", finish: { name: "none", params: { grain: { amount: 0 } } } });
  assert.doesNotMatch(none, /no film grain/);
});
test("movement is a note, not something a still can show", () => {
  assert.match(buildPrompt({ ...base, shot: { ...base.shot, movement: "slow push in" } }), /can't show movement/);
});
test("output sizes keep the aspect and are multiples of 16", () => {
  for (const a of [1.33, 1.78, 1.85, 2.39]) {
    const { width, height } = outputSize(a);
    assert.equal(width % 16, 0); assert.equal(height % 16, 0);
    assert.ok(Math.abs(width / height - a) < 0.06);
  }
});
test("timing totals separate missing durations; order keys and text keys", () => {
  const t = sequenceTiming([{ content: { action: "a", durationS: 3 } }, { content: { action: "b" } }]);
  assert.equal(t.totalS, 3); assert.equal(t.missing, 1); assert.match(t.label, /1 without a duration/);
  assert.equal(between(1000, 2000), 1500); assert.equal(between(null, 1000), 0);
  assert.equal(textKey("Johnny sips  coffee."), textKey("johnny sips coffee"));
  assert.deepEqual(cleanShot({ action: "x", size: "huge", camera: { focalMm: 99999 } }).size, undefined);
});
