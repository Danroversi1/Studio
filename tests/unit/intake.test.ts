import assert from "node:assert/strict";
import { test } from "node:test";
import { composeIntake, parseIntake } from "../../lib/intake";

test("answers round-trip through the saved story text", () => {
  const a = { idea: "What if the sea forgot the moon?", who: "Mira, the keeper.\nShe wants a quiet night.", difficulty: "The light fails." };
  const body = composeIntake(a);
  assert.match(body, /^## What's your story idea\?\nWhat if/);
  assert.deepEqual(parseIntake(body), a);
});

test("empty answers are left out", () => {
  assert.equal(composeIntake({ idea: "  ", who: "Mira", difficulty: "" }), "## Whose story is it?\nMira");
  assert.deepEqual(parseIntake("## Whose story is it?\nMira"), { idea: "", who: "Mira", difficulty: "" });
});

test("an older free-form synopsis is kept whole as the idea", () => {
  const old = "A planet peaked the curiosity of an entity.\n\nIt observes.";
  assert.deepEqual(parseIntake(old), { idea: old, who: "", difficulty: "" });
  assert.deepEqual(parseIntake(""), { idea: "", who: "", difficulty: "" });
});
