import assert from "node:assert/strict";
import { test } from "node:test";
import { between, sortByOrder } from "../../lib/notebook-order";

const a = { id: "a", created_at: "2026-11-15T10:00:00Z" };
const b = { id: "b", created_at: "2026-11-15T11:00:00Z" };
const c = { id: "c", created_at: "2026-11-15T12:00:00Z" };

test("creation order until something is placed", () => {
  assert.deepEqual(sortByOrder([c, a, b]).map((x) => x.id), ["a", "b", "c"]);
});
test("a new beat inserted between two others lands between them", () => {
  const n = { id: "n", created_at: "2026-11-15T13:00:00Z", position: between(a, b) };
  assert.deepEqual(sortByOrder([a, b, c, n]).map((x) => x.id), ["a", "n", "b", "c"]);
  const first = { id: "f", created_at: "2026-11-15T14:00:00Z", position: between(null, a) };
  assert.equal(sortByOrder([a, b, first])[0].id, "f");
});
