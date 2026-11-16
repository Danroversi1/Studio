import assert from "node:assert/strict";
import { test } from "node:test";
import { reviewFor, scriptScenes } from "../../lib/storyboard/review";

const script = `# BEGINNING

INT. COFFEE SHOP - DAY
[[beat:abc]]

- Johnny is at a coffee shop smoking a cigaret and drinking coffee. An explosion is heard.

[[Props: cigarette]]

JOHNNY
(write the line)

EXT. STREET - DAY

Johnny receives a message.`;

test("scenes with their text, without notes or placeholders", () => {
  const s = scriptScenes(script);
  assert.equal(s.length, 2);
  assert.equal(s[0].heading, "INT. COFFEE SHOP - DAY");
  assert.match(s[0].text, /^Johnny is at a coffee shop/);
  assert.doesNotMatch(s[0].text, /Props|write the line|beat/);
});
test("a shot from an unchanged scene needs no review", () => {
  const shot = { action: "x", source: { kind: "script" as const, heading: "INT. COFFEE SHOP - DAY", excerpt: "An explosion is heard." }, characters: ["Johnny"] };
  assert.equal(reviewFor(shot, { scenes: scriptScenes(script), cast: ["Johnny"], locations: [] }), null);
});
test("a changed scene is flagged with what it was and what it is now", () => {
  const shot = { action: "x", source: { kind: "script" as const, heading: "INT. COFFEE SHOP - DAY", excerpt: "An explosion is heard." } };
  const changed = script.replace("An explosion is heard.", "A siren wails.");
  const r = reviewFor(shot, { scenes: scriptScenes(changed), cast: [], locations: [] })!;
  assert.match(r.reason, /Scene 1 .* changed/); assert.equal(r.was, "An explosion is heard."); assert.match(r.now!, /siren/);
});
test("removed scenes, characters and places are flagged", () => {
  const s = scriptScenes(script);
  assert.match(reviewFor({ action: "x", source: { kind: "script", heading: "INT. ROOFTOP - NIGHT", excerpt: "x" } }, { scenes: s, cast: [], locations: [] })!.reason, /no longer in the script/);
  assert.match(reviewFor({ action: "x", characters: ["Marie"] }, { scenes: s, cast: ["Johnny"], locations: [] })!.reason, /Marie is no longer in the cast/);
  assert.match(reviewFor({ action: "x", location: "Bridge" }, { scenes: s, cast: [], locations: ["Coffee Shop"] })!.reason, /Bridge/);
});
