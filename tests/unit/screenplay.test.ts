import assert from "node:assert/strict";
import { test } from "node:test";
import { LINES_PER_PAGE, classify, pages, parseScript } from "../../lib/screenplay";

const SAMPLE = `# ACT ONE

EXT. OCEAN CLIFF - NIGHT

Waves hit the rocks. A light turns.

MIRA
(whispering)
Is anyone up there?

CUT TO:

INT. LIGHTHOUSE - CONTINUOUS

[[note to self: make the stairs longer]]
She climbs.

# ACT TWO

.THE LAMP ROOM

>THE END<`;

test("classifies Fountain-style elements", () => {
  const t = classify(SAMPLE).map((e) => e.type);
  assert.deepEqual(t, ["act", "scene", "action", "character", "parenthetical", "dialogue", "transition", "scene", "action", "act", "scene", "centered"]);
  const action = classify(SAMPLE).find((e) => e.text.includes("climbs"));
  assert.equal(action?.text.includes("note to self"), false, "notes are ignored");
});

test("finds scenes and her act markers", () => {
  const p = parseScript(SAMPLE);
  assert.deepEqual(p.scenes.map((s) => [s.heading, s.act]), [
    ["EXT. OCEAN CLIFF - NIGHT", 1], ["INT. LIGHTHOUSE - CONTINUOUS", 1], ["THE LAMP ROOM", 2],
  ]);
  assert.deepEqual(p.acts.map((a) => a.label), ["ACT ONE", "ACT TWO"]);
  assert.ok(p.totalPages > 0 && p.totalPages < 1);
});

test("about 55 lines make a page", () => {
  const long = Array.from({ length: 120 }, (_, i) => `Line of action number ${i}.`).join("\n\n");
  const p = parseScript(`INT. ROOM - DAY\n\n${long}`);
  assert.ok(p.totalPages > 4 && p.totalPages < 5, `got ${p.totalPages}`);
  assert.equal(pages(p.elements).length, Math.ceil(p.totalPages));
  assert.equal(LINES_PER_PAGE, 55);
});

test("empty script is zero pages", () => {
  assert.equal(parseScript("").totalPages, 0);
  assert.equal(parseScript("   \n\n ").scenes.length, 0);
});
