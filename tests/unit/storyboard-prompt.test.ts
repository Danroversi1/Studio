import assert from "node:assert/strict";
import { test } from "node:test";
import { assetPrompt, illustratePrompt, outputSize } from "../../lib/storyboard/prompt";
import { between, cleanShot, sequenceTiming, textKey } from "../../lib/storyboard/shot";

test("illustrating keeps her composition and her words", () => {
  const p = illustratePrompt(cleanShot({ action: "Johnny sips coffee.", notice: "the cup shakes", size: "close" }), "ink", [{ name: "Johnny standing", kind: "pose" }]);
  assert.match(p, /director's own rough composition/); assert.match(p, /Keep its framing/); assert.match(p, /Johnny sips coffee/);
  assert.match(p, /the cup shakes/); assert.match(p, /\[2\] Johnny standing \(pose\)/); assert.match(p, /ink/);
});
test("a created asset states the single view it shows", () => {
  const p = assetPrompt({ kind: "background", name: "Café", description: "small corner café", views: "wide, eye level" }, "pencil");
  assert.match(p, /no people/); assert.match(p, /Only one view/); assert.match(p, /wide, eye level/);
});
test("output sizes keep the aspect and are multiples of 16", () => {
  for (const a of [1.33, 1.78, 1.85, 2.39, 0.5625]) {
    const { width, height } = outputSize(a);
    assert.equal(width % 16, 0); assert.equal(height % 16, 0);
    assert.ok(Math.abs(width / height - a) < 0.06);
  }
});
test("timing keeps proposals separate from missing durations; order keys; text keys", () => {
  const t = sequenceTiming([{ content: { action: "a", durationS: 3 } }, { content: { action: "b" } }]);
  assert.equal(t.totalS, 3); assert.equal(t.missing, 1); assert.match(t.label, /1 without a duration/);
  assert.equal(between(1000, 2000), 1500); assert.equal(between(null, 1000), 0);
  assert.equal(textKey("Johnny sips  coffee."), textKey("johnny sips coffee"));
  assert.equal(cleanShot({ action: "x", size: "huge", notice: "n" }).size, undefined);
  assert.equal(cleanShot({ action: "x", notice: "n" }).notice, "n");
});
