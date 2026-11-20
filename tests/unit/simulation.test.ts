import { test } from "node:test";
import assert from "node:assert/strict";
import { checkEvent, checkRun, fictionalDate, happinessLabel, isTracked, nextScheduled, ruleSentence, stepToPoints, stressLabel, type CheckContext, type RawEvent } from "../../lib/sim/rules";

const ctx: CheckContext = {
  characters: [{ id: "J", name: "Johnny" }, { id: "M", name: "Marie" }, { id: "X", name: "Mr. X" }],
  access: { n1: ["J"], n2: ["J", "M"] },
  material: [
    { id: "n1", version: 1, title: "Chipmaker CEO resigns", url: "https://x/1", published_at: "2026-11-19T10:00:00Z", retrieved_at: "2026-11-20T09:00:00Z", source: "Google News" },
    { id: "n2", version: 2, title: "Markets slide", url: null, published_at: "2026-11-21T10:00:00Z", retrieved_at: "2026-11-21T11:00:00Z", source: "Google News" },
  ],
  rules: [{ id: "r1", family: "character", character_id: "J" }, { id: "r2", family: "world", character_id: null }],
  intensity: 2, fictionalDate: "2026-11-20",
};
const ev = (over: Partial<RawEvent> = {}): RawEvent => ({ ref: "e1", title: "The CEO resigns", description: "d", relevance: "r", basis: "source", source_item_ids: ["n1"],
  depends_on_refs: [], rationale: "", characters: [{ name: "Johnny", involvement: "encounters_source", stress_step: 2, happiness_step: -1, feel: "uneasy", movement: "Calls his mentor.", rule_ids: ["r1", "r2", "nope"] }], ...over });

test("Simulation rules read as plain sentences", () => {
  assert.equal(ruleSentence({ family: "character", when_text: "he encounters evidence he cannot explain", stress: 1, happiness: 0, tend_text: "investigate", relief_text: "talking with his mentor" }, "Johnny"),
    "When he encounters evidence he cannot explain, Johnny becomes more stressed and tends to investigate. Talking with his mentor can bring relief.");
  assert.equal(ruleSentence({ family: "world", when_text: "prices rise", stress: 1, happiness: -1, tend_text: null, relief_text: null }, null),
    "When prices rise, characters become more stressed and sadder.");
});

test("Emotional state: two independent axes, approachable labels, bounded changes", () => {
  assert.equal(stressLabel(70), "Very stressed");
  assert.equal(happinessLabel(70), "Very happy"); // stressed and happy together
  assert.equal(stepToPoints(2, 2), 14);
  assert.equal(stepToPoints(3, 3), 25, "capped per event");
  assert.equal(stepToPoints(99, 1), 13, "steps are bounded");
  assert.equal(stepToPoints(1, 1), 4, "gentle intensity shifts less");
});

test("Simulation: sources, knowledge and rules are checked without AI", () => {
  const a = checkEvent(ev(), ctx)!;
  assert.equal(a.basis, "source");
  assert.deepEqual(a.characters.map((c) => [c.name, c.d_stress, c.d_happiness, c.rule_ids]), [["Johnny", 14, -7, ["r1", "r2"]]]);
  assert.equal(a.sources[0].item_id, "n1");
  // Marie can't know about n1: she's left out with an explanation
  const b = checkEvent(ev({ characters: [{ name: "Marie", involvement: "encounters_source", stress_step: 1, happiness_step: 0, feel: "", movement: "", rule_ids: ["r1"] }] }), ctx)!;
  assert.equal(b.characters.length, 0);
  assert.ok(b.flags?.some((f) => f.includes("Marie doesn't have a way to know")));
  // …unless someone who knows tells her
  const c = checkEvent(ev({ characters: [
    { name: "Johnny", involvement: "encounters_source", stress_step: 1, happiness_step: 0, feel: "", movement: "", rule_ids: [] },
    { name: "Marie", involvement: "told_by_character", told_by: "Johnny", stress_step: 1, happiness_step: 0, feel: "", movement: "", rule_ids: ["r1"] }] }), ctx)!;
  assert.deepEqual(c.characters.map((x) => [x.name, x.channel, x.rule_ids]), [["Johnny", "Through the news they follow", []], ["Marie", "Told by Johnny", []]], "Johnny's rule doesn't apply to Marie");
  // A source dated after the story's date can only be an adaptation
  const d = checkEvent(ev({ source_item_ids: ["n2"], characters: [] }), ctx)!;
  assert.equal(d.basis, "adaptation");
  // Invented sources are removed; strangers are dropped
  const e = checkEvent(ev({ source_item_ids: ["made-up"], basis: "source", characters: [{ name: "Nobody", involvement: "directly_involved", stress_step: 1, happiness_step: 1, feel: "", movement: "", rule_ids: [] }] }), ctx)!;
  assert.equal(e.basis, "fiction");
  assert.equal(e.characters.length, 0);
  assert.ok(e.flags!.length >= 2);
});

test("Simulation: the daily limit and zero events", () => {
  const many = [ev({ ref: "a" }), ev({ ref: "b", depends_on_refs: ["a", "zzz"] }), ev({ ref: "c" })];
  const r = checkRun(many, ctx, 2);
  assert.equal(r.length, 2);
  assert.deepEqual(r[1].depends_on_refs, ["a"]);
  assert.deepEqual(checkRun(many, ctx, 0), []);
  assert.deepEqual(checkRun([], ctx, 3), [], "zero events is a valid day");
});

test("Simulation: story time and real time stay separate", () => {
  assert.equal(fictionalDate("2026-11-20", 1), "2026-11-20");
  assert.equal(fictionalDate("2026-12-31", 2), "2027-01-01");
  assert.equal(fictionalDate(null, 3), null);
  assert.equal(nextScheduled(new Date("2026-11-20T08:00:00Z")).toISOString(), "2026-11-20T09:37:00.000Z");
  assert.equal(nextScheduled(new Date("2026-11-20T10:00:00Z")).toISOString(), "2026-11-21T09:37:00.000Z");
});

import { dayOneFromTimeline } from "../../lib/sim/rules";
test("Simulation: Day 1 comes from the World & Time timeline", () => {
  const today = "2026-11-20";
  assert.equal(dayOneFromTimeline([{ label: "March 3, 2026", precision: "exact", start_year: 2026 }], today).date, "2026-03-03");
  assert.equal(dayOneFromTimeline([{ label: "November 2026", precision: "exact", start_year: 2026 }], today).date, "2026-11-01");
  assert.equal(dayOneFromTimeline([{ label: "2026", precision: "year", start_year: 2026 }], today).date, "2026-11-20", "present year starts today");
  assert.equal(dayOneFromTimeline([{ label: "1999", precision: "year", start_year: 1999 }], today).date, "1999-01-01");
  assert.equal(dayOneFromTimeline([{ label: "2031-06-15", precision: "exact", start_year: 2031 }], today).date, "2031-06-15");
  assert.equal(dayOneFromTimeline([{ label: "the summer before the flood", precision: "relative", start_year: null }], today).date, today);
  assert.equal(dayOneFromTimeline(undefined, today).date, today);
});

test("Simulation: feelings are tracked only for protagonist, antagonist and supporting roles", () => {
  const c2: CheckContext = { ...ctx, tracked: ["M"] };
  const r = checkEvent(ev({ characters: [{ name: "Johnny", involvement: "encounters_source", stress_step: 3, happiness_step: -2, feel: "panicked", movement: "Calls his mentor.", rule_ids: [] }] }), c2)!;
  assert.deepEqual([r.characters[0].d_stress, r.characters[0].d_happiness, r.characters[0].feel, r.characters[0].movement], [0, 0, "", "Calls his mentor."], "an untracked character can still act");
});
test("Tracked roles", () => {
  assert.ok(isTracked("protagonist") && isTracked("antagonist") && isTracked("supporting"));
  assert.ok(!isTracked("featured") && !isTracked(null));
});
