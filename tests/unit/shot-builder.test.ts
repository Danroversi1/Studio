import assert from "node:assert/strict";
import { test } from "node:test";
import { PARTNERS, isPartnerId, shotsFromTool, systemPrompt } from "../../lib/agents/partners";

const material = "Johnny is at a coffee shop smoking a cigaret and drinking coffee. An explosion is heard.";

test("Shot Builder is a partner with its own brief", () => {
  assert.ok(isPartnerId("shots"));
  assert.equal(PARTNERS.shots.name, "Shot Builder");
  assert.match(systemPrompt("shots"), /ONE focused question/);
  assert.match(systemPrompt("shots"), /Never invent plot events/);
});
test("shots must quote her words; invented events are refused", () => {
  const { shots, report } = shotsFromTool({ shots: [
    { her_words: "An explosion is heard.", action: "Cups rattle as the boom hits.", size: "close", duration_s: 2 },
    { her_words: "Johnny pulls out a gun", action: "Johnny draws a gun." },
  ] }, material);
  assert.equal(shots.length, 1);
  assert.equal((shots[0].source as { excerpt: string }).excerpt, "An explosion is heard.");
  assert.equal(shots[0].durationS, 2);
  assert.match(report[1], /Not added/);
});
test("matching ignores case and punctuation, not words", () => {
  assert.equal(shotsFromTool({ shots: [{ her_words: "johnny is at a coffee shop", action: "x" }] }, material).shots.length, 1);
  assert.equal(shotsFromTool({ shots: [{ her_words: "coffee", action: "x" }] }, material).shots.length, 1);
  assert.equal(shotsFromTool({ shots: [{ her_words: "tea", action: "x" }] }, material).shots.length, 0);
});
