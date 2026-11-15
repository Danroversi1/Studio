import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateSpan, cleanValue, composeSentence, guessPrecision, parseYears, reviewNotes, spanConflict, spanYears, type SpanValue, type WhenValue, type WhereValue, type World } from "../../lib/world";

const when2 = cleanValue("when", { periods: [{ label: "2046" }, { label: "2056" }] }) as WhenValue;

test("LA in 2046 and 2056: ten years, selected moments", () => {
  assert.deepEqual(when2.periods.map((p) => [p.precision, p.start_year]), [["year", 2046], ["year", 2056]]);
  assert.deepEqual(calculateSpan(when2), { years: 10, approximate: false, text: "10 years" });
  const c: World["confirmed"] = {
    where: { value: cleanValue("where", { places: [{ name: "Los Angeles", kind: "real" }] }) as WhereValue, source: "director", at: "" },
    when: { value: when2, source: "director", at: "" },
    coverage: { value: "selected", source: "director", at: "" },
  };
  assert.equal(composeSentence(c), "A story in Los Angeles, seen in 2046 and again in 2056.");
});

test("a span from her words and a mismatch flag, never an overwrite", () => {
  assert.equal(spanYears("ten years"), 10);
  assert.equal(spanYears("one afternoon"), null);
  const s = cleanValue("span", { text: "five years" }) as SpanValue;
  assert.match(spanConflict(s, calculateSpan(when2)) ?? "", /five years.*10 years/);
  assert.equal(spanConflict(cleanValue("span", { text: "ten years" }) as SpanValue, calculateSpan(when2)), null);
});

test("approximate and unusual times stay honest", () => {
  assert.equal(guessPrecision("the 1990s"), "approximate");
  assert.deepEqual(parseYears("the 1990s"), { start: 1990, end: 1999 });
  assert.equal(guessPrecision("the third moon of Zarn"), "invented");
  assert.equal(guessPrecision("not decided"), "undecided");
  assert.equal(calculateSpan(cleanValue("when", { periods: [{ label: "the third moon" }, { label: "the great thaw" }] }) as WhenValue), null);
  const approx = calculateSpan(cleanValue("when", { periods: [{ label: "around 1950" }, { label: "around 2000" }] }) as WhenValue);
  assert.equal(approx?.text, "about 50 years");
});

test("one afternoon in one room needs no dates", () => {
  const c: World["confirmed"] = {
    where: { value: cleanValue("where", { places: [{ name: "Grandma's kitchen", kind: "invented", scale: "a room" }] }) as WhereValue, source: "director", at: "" },
    span: { value: cleanValue("span", { text: "one afternoon" }) as SpanValue, source: "director", at: "" },
  };
  assert.equal(composeSentence(c), "A story in Grandma's kitchen, spanning one afternoon.");
});

test("an empty world says nothing; changes create review notes only when something changed", () => {
  assert.equal(composeSentence({}), null);
  assert.deepEqual(reviewNotes("when", undefined, when2), []);
  const r = reviewNotes("when", when2, cleanValue("when", { periods: [{ label: "1946" }, { label: "1956" }] }));
  assert.match(r[0], /2046 & 2056 → 1946 & 1956/);
  assert.deepEqual(reviewNotes("when", when2, when2), []);
});

import { worldOpsFromTool, EMPTY_WORLD } from "../../lib/world";
import { splitChoices } from "../../components/partner-chat";

test("the World Builder: her words make it hers, anything else is a suggestion", () => {
  const her = "It's LA. Mostly the same street, every time.";
  const { ops } = worldOpsFromTool({ changes: [
    { section: "where", where: { places: [{ name: "Los Angeles", kind: "real" }] }, her_words: "It's LA" },
    { section: "span", span: { text: "ten years" }, her_words: "ten years", why: "from her dates" },
    { section: "summary", summary: "A life in LA." },
    { section: "mood", her_words: "x" },
  ] }, her, EMPTY_WORLD);
  assert.equal(ops.length, 3);
  assert.equal(ops[0].her_words, "It's LA");
  assert.equal(ops[1].her_words, undefined, "words not in her message → suggestion");
  assert.deepEqual(ops[2].value, { text: "A life in LA." });
});

test("answer chips are split off the reply", () => {
  assert.deepEqual(splitChoices("What changes?\n\n[[choices: The city has changed | My character sees it differently | A bit of both]]"),
    { body: "What changes?", choices: ["The city has changed", "My character sees it differently", "A bit of both"] });
  assert.deepEqual(splitChoices("No chips here."), { body: "No chips here.", choices: [] });
});

import { openingFor, systemPrompt } from "../../lib/agents/partners";
test("the Dialogue partner: the parent's prompt verbatim, plus how STUDIO works", () => {
  const p = systemPrompt("dialogue");
  assert.ok(p.startsWith("STUDIO — DIALOGUE PARTNER / v1"));
  assert.match(p, /never use the inactive NORM record/);
  assert.match(p, /You cannot edit her script/);
  assert.equal(openingFor("dialogue", { hasStory: true, runtime: "3-5", filmTitle: "Johnny" }),
    "Let's hear your characters. Who is talking, and what does one of them want from the other?");
  assert.match(openingFor("dialogue", { hasStory: true, runtime: "3-5", filmTitle: "Johnny", scenes: 7 }), /7 scenes in your script for “Johnny”/);
});
