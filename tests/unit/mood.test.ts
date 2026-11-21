import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanJudgments, dayScore, eventNudge, harmony, moodLabel, ruleWeight, settle, showMood, type DayRow, type MoodRule } from "../../lib/mood/score";

const rules: MoodRule[] = [{ id: "open", version: 1, text: "When AI research is shared openly, Johnny becomes happier.", weight: 2 }, { id: "war", version: 1, text: "When countries clash, Johnny becomes more stressed.", weight: 1 }];
const items = [{ key: "a:1", item_id: "a", title: "Lab open-sources its model", source: "HN" }, { key: "b:1", item_id: "b", title: "Chip export ban tightens", source: "News" }];

test("weights come from how strongly the rule moves them", () => {
  assert.equal(ruleWeight(0, 0), 1);
  assert.equal(ruleWeight(1, -2), 3);
  assert.equal(ruleWeight(2, 2), 3);
});

test("only judgments about the day's real items and rules are kept", () => {
  const j = cleanJudgments([
    { item_key: "a:1", rule_id: "open", relation: 1, reason: "Open-sourcing   is exactly what he hopes for" },
    { item_key: "a:1", rule_id: "open", relation: -1, reason: "duplicate" },
    { item_key: "zz", rule_id: "open", relation: 1, reason: "invented item" },
    { item_key: "b:1", rule_id: "nope", relation: -1, reason: "invented rule" },
    { item_key: "b:1", rule_id: "war", relation: 5, reason: "bad value" },
    { item_key: "b:1", rule_id: "war", relation: 0, reason: "unrelated" },
  ], { rules, items });
  assert.equal(j.length, 1);
  assert.equal(j[0].reason, "Open-sourcing is exactly what he hopes for");
});

test("consonance lifts toward 10, dissonance pulls toward 0, gradually", () => {
  assert.equal(harmony([{ item_key: "a:1", rule_id: "open", relation: 1, reason: "" }], rules), 1);
  assert.equal(harmony([{ item_key: "b:1", rule_id: "war", relation: -1, reason: "" }], rules), -1);
  // weighted: +2 (open) and −1 (war) → 1/3
  assert.ok(Math.abs(harmony([{ item_key: "a:1", rule_id: "open", relation: 1, reason: "" }, { item_key: "b:1", rule_id: "war", relation: -1, reason: "" }], rules)! - 1 / 3) < 1e-9);
  assert.equal(harmony([], rules), null);
  assert.deepEqual(dayScore(5, 1), { target: 10, score: 7 });
  assert.deepEqual(dayScore(5, -1), { target: 0, score: 3 });
  assert.deepEqual(dayScore(8, null, 5), { target: 5, score: 7.4 }, "a quiet day drifts back toward the start");
  assert.equal(dayScore(9.9, 1).score <= 10, true);
});

test("days settle in order; overrides and the start flow forward; a waiting day stops the chain", () => {
  const day = (id: string, d: string, rel: -1 | 1 | null, extra: Partial<DayRow> = {}): DayRow => ({
    id, day: d, status: "judged", needs_judging: true, override: null, score: null, payload: { rules },
    judgments: rel === null ? [] : [{ item_key: "a:1", rule_id: "open", relation: rel, reason: "" }], ...extra,
  });
  const out = settle([day("2", "2026-11-21", 1), day("1", "2026-11-20", -1), day("3", "2026-11-22", 1, { status: "waiting" })], 5);
  assert.deepEqual(out.map((o) => [o.id, o.prev, o.score]), [["1", 5, 3], ["2", 3, 5.8]]);
  const over = settle([day("1", "2026-11-20", -1, { override: 8 }), day("2", "2026-11-21", 1)], 5);
  assert.equal(over[1].prev, 8, "her override is the next day's starting point");
  const quiet = settle([day("1", "2026-11-20", null, { status: "waiting", needs_judging: false })], 6);
  assert.deepEqual(quiet.map((o) => o.score), [6], "a day with no rules or no coverage settles without judging");
  const failed = settle([day("1", "2026-11-20", 1, { status: "failed" })], 5);
  assert.equal(failed[0].harmony, null, "a day that couldn't be judged counts as quiet");
});

test("approved events still nudge the mood; labels read plainly", () => {
  assert.equal(eventNudge([{ d_stress: 14, d_happiness: -7 }]), -0.525);
  assert.equal(showMood(6.74), "6.5");
  assert.equal(showMood(7), "7");
  assert.equal(moodLabel(0.5), "In turmoil");
  assert.equal(moodLabel(5), "Steady");
  assert.equal(moodLabel(9.5), "Thriving");
});
