import { test } from "node:test";
import assert from "node:assert/strict";
import { canSee, itemDay, reachLabel, reachOf, realDateOf, storyDayOf, tierOf, PROTAGONIST_LABEL } from "../../lib/knowledge/timeline";
import { bufferFor, reachableDay, renderForCharacter, renderForDirector, type Timeline } from "../../lib/knowledge/timeline-data";

test("story days map to real dates from Day 1", () => {
  assert.equal(storyDayOf("2026-11-20T23:00:00Z", "2026-11-20"), 1);
  assert.equal(storyDayOf("2026-11-22", "2026-11-20"), 3);
  assert.equal(storyDayOf("2026-11-19", "2026-11-20"), 0);
  assert.equal(realDateOf(3, "2026-11-20"), "2026-11-22");
  assert.equal(itemDay({ published_at: null, retrieved_at: "2026-11-24T08:00:00Z" }, "2026-11-20"), 5);
});

test("the example: on Day 3, antagonist through Day 7, Johnny Day 2, supporting Day 3", () => {
  const acc = { enabled: true, ahead_days: 4 };
  assert.equal(reachOf("antagonist", acc, 3), 7);
  assert.equal(reachOf("protagonist", null, 3), 2);
  assert.equal(reachOf("supporting", null, 3), 3);
  assert.equal(reachOf("featured", null, 3), 3);
  assert.equal(reachOf("protagonist", null, 1), 0, "Day 1: backstory only");
});

test("future access is an antagonist permission only", () => {
  assert.equal(tierOf("protagonist", { enabled: true, ahead_days: 9 }), "behind");
  assert.equal(tierOf("supporting", { enabled: true, ahead_days: 9 }), "present");
  assert.equal(tierOf("antagonist", { enabled: false, ahead_days: 9 }), "present");
  assert.equal(tierOf("antagonist", { enabled: true, ahead_days: 9 }), "ahead");
  assert.equal(canSee(3, 2), false);
  assert.equal(canSee(3, 2, true), true, "a discovery opens it");
  assert.match(reachLabel("protagonist", null, 3, 9), /through Day 2: one day behind\. Discoveries can close the gap\./);
  assert.match(PROTAGONIST_LABEL, /^Routine knowledge: one day behind\. Discoveries can close the gap\.$/);
});

const TL: Timeline = {
  anchor: "2026-11-20", anchorSet: true, anchorLocked: false, worldDay: 3, worldDate: "2026-11-22", collectedThrough: 6,
  characters: [
    { id: "j", name: "Johnny", role: "protagonist", access: null, tier: "behind", reach: 2, label: "behind" },
    { id: "x", name: "Mr. X", role: "antagonist", access: { enabled: true, ahead_days: 2 }, tier: "ahead", reach: 5, label: "ahead" },
    { id: "d", name: "Director", role: "supporting", access: null, tier: "present", reach: 3, label: "present" },
  ],
  buffer: [
    { id: "f4", title: "SECRET Day four plan", url: null, day: 4, source: "Wire", source_id: "s1", version: 1 },
    { id: "f6", title: "SECRET Day six plan", url: null, day: 6, source: "Wire", source_id: "s1", version: 1 },
    { id: "o4", title: "SECRET Other source", url: null, day: 4, source: "Other", source_id: "s2", version: 1 },
  ],
  recent: [{ id: "t3", title: "Today", url: null, day: 3, source: "Wire", source_id: "s1", version: 1 }],
  permitted: { x: { sources: ["s1"], items: [] } },
  discoveries: [{ id: "dd", character_id: "j", day: 3, method: "forensic", what: "Cut wire", how: null, item_id: "t3", item_day: 3, created_at: "" }],
  predictions: [], interventions: [], flags: [],
  briefings: [{ id: "b", from_character: "x", to_character: "d", day: 3, kind: "briefing", content: "SECRET expect the plant", item_ids: ["f4"], flag_ids: [] }],
};

test("the antagonist's buffer: window and permitted sources only", () => {
  assert.deepEqual(bufferFor(TL, "x").map((i) => i.id), ["f4"]);
  assert.deepEqual(bufferFor(TL, "j"), []);
  assert.equal(reachableDay(TL, "j", 3, "t3"), true, "his discovery");
  assert.equal(reachableDay(TL, "j", 3, "other"), false);
  assert.equal(reachableDay(TL, "d", 4, "f4"), false, "supporting can't query the buffer");
  assert.equal(reachableDay(TL, "x", 4, "f4"), true);
  assert.equal(reachableDay(TL, "x", 6, "f6"), false, "beyond his window");
});

test("the protagonist's agent never sees the buffer or others' briefings", () => {
  const j = renderForCharacter(TL, "j");
  assert.doesNotMatch(j, /SECRET/);
  assert.match(j, /Cut wire/);
  assert.match(j, /one day behind/);
  const d = renderForCharacter(TL, "d");
  assert.match(d, /SECRET expect the plant/, "the recipient sees the claim");
  assert.doesNotMatch(d, /Day four plan/);
  const x = renderForCharacter(TL, "x");
  assert.match(x, /Day four plan/);
  assert.doesNotMatch(x, /Day six plan|Other source|Cut wire/, "no window overrun, no other sources, no Johnny's discoveries");
  assert.match(renderForDirector(TL), /World day: Day 3/);
});
