import assert from "node:assert/strict";
import { test } from "node:test";
import { newPeople, normName, speakers } from "../../lib/script-cast";

test("names match across case, articles and punctuation", () => {
  assert.equal(normName("The President"), normName("PRESIDENT"));
  assert.equal(normName("Mr X"), normName("Mr. X"));
});
test("finds speakers and skips the cast and removed characters", () => {
  const body = "INT. OFFICE - DAY\n\nThe president waits.\n\nTHE PRESIDENT\nWell?\n\nARMAND\nSir.\n\nEXT. STREET - DAY\n\nKID (V.O.)\nHi!";
  const s = speakers(body);
  assert.deepEqual(s.map((p) => p.name), ["The President", "Armand", "Kid"]);
  assert.equal(s[2].first_scene, 2);
  assert.deepEqual(newPeople(["Armand", "kid"], s).map((p) => p.name), ["The President"]);
});
test("caps and dedupes", () => {
  const ps = [{ name: "The Kid", description: "", first_scene: 1 }, { name: "kid", description: "", first_scene: 2 }];
  assert.equal(newPeople([], ps).length, 1);
  assert.equal(newPeople([], Array.from({ length: 20 }, (_, i) => ({ name: `P${i}x`, description: "", first_scene: 1 })), 5).length, 5);
});
