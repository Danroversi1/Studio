import assert from "node:assert/strict";
import { test } from "node:test";
import { slidesFor } from "../../lib/slide-match";

const deck = [
  { id: "a", text: "Look and Feel" },
  { id: "b", text: "Story\nJohnny meets Marie at the coffee shop." },
  { id: "c", text: "Casting/Johnny\nA terrorist on the run" },
  { id: "d", text: "Casting/Marie" },
  { id: "e", text: "Location / Coffee Shop" },
  { id: "f", text: "Casting / Mr. X" },
];
test("labeled slides come first", () => {
  assert.deepEqual(slidesFor(deck, "Johnny", "character"), [3, 2]);
  assert.deepEqual(slidesFor(deck, "Marie", "character"), [4, 2]);
  assert.deepEqual(slidesFor(deck, "Coffee Shop", "location"), [5, 2]);
});
test("punctuation, case and articles don't matter", () => {
  assert.deepEqual(slidesFor(deck, "Mr X", "character"), [6]);
  assert.deepEqual(slidesFor(deck, "the coffee shop", "location"), [5, 2]);
});
test("no partial-word matches", () => {
  assert.deepEqual(slidesFor([{ id: "x", text: "Johnnycake recipes" }], "Johnny", "character"), []);
});
test("possessives and stray dots don't matter", () => {
  const d = [{ id: "a", text: "Locations / President office" }, { id: "b", text: "Locations / Mr X. Hideout" }, { id: "c", text: "Locations / Marie\u2019s Apartment" }];
  assert.deepEqual(slidesFor(d, "President's Office", "location"), [1]);
  assert.deepEqual(slidesFor(d, "Mr. X's Hideout", "location"), [2]);
  assert.deepEqual(slidesFor(d, "Marie's Apartment", "location"), [3]);
  assert.deepEqual(slidesFor([{ id: "p", text: "Casting / President" }], "The President", "character"), [1]);
});
test("reads the live deck's labels", async () => {
  const { parseEmbedSlides } = await import("../../lib/google/embed-slides");
  const html = `x["s1",0,"",[]] y["s2",1,"",[]] <g id=\\x22s1\\x22><p aria-label=\\x22Look and Feel\\x22></g><g id=\\x22s2\\x22><p aria-label=\\x22Casting \\/ \\x26#xa;The Newscaster\\x22><p aria-label=\\x22Screenshot 1.png\\x22></g>`;
  const d = parseEmbedSlides(html);
  assert.deepEqual(d.map((x) => x.id), ["s1", "s2"]);
  assert.equal(d[1].text, "Casting / \nThe Newscaster");
  assert.deepEqual(slidesFor(d, "The Newscaster", "character"), [2]);
});
