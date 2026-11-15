import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCast } from "../../lib/cast";

test("one per line", () => {
  assert.deepEqual(parseCast("Johnny: A man with second thoughts.\nMarie: His girlfriend.\n"), [
    { name: "Johnny", description: "A man with second thoughts." },
    { name: "Marie", description: "His girlfriend." },
  ]);
});

test("several in one paragraph", () => {
  const r = parseCast("Johnny: A terrorist going thru an existential crisis. Marie: His girlfriend, she does not know what he does. Jacques: Homeless friend.");
  assert.deepEqual(r.map((c) => c.name), ["Johnny", "Marie", "Jacques"]);
  assert.equal(r[1].description, "His girlfriend, she does not know what he does.");
});

test("plain sentences don't invent characters", () => {
  assert.deepEqual(parseCast("It's about a girl and her robot. She wants to win."), []);
  assert.deepEqual(parseCast("the robot: wants to dance"), []);
});

test("multi-word names and duplicates", () => {
  assert.deepEqual(parseCast("- Old Man River: keeps the bridge.\nOld Man River: again"), [{ name: "Old Man River", description: "keeps the bridge." }]);
});
