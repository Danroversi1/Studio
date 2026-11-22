import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cleanTerms, eligible, localDate, localTime, mentions, nextDaily, preferredSupported, selectFor, storyKey, summarize, type CandidateItem } from "../../lib/bubbles/select";
import { fetchRetry, sharedFetch, type FetchCache } from "../../lib/knowledge/shared-fetch";
import { FetchError, type Fetched } from "../../lib/knowledge/fetch";

const item = (id: string, title: string, extra: Partial<CandidateItem> = {}): CandidateItem => ({
  id, version: 1, title, url: `https://news.example/${id}`, content: "", published_at: "2026-11-20T08:00:00Z", retrieved_at: "2026-11-20T09:17:00Z",
  source_id: "s1", source: "Google News: Paris", ...extra,
});
const pool = [
  item("a", "Paris metro strike enters third day"),
  item("b", "Chipmaker unveils new AI accelerator", { source_id: "s2", source: "Hacker News: AI" }),
  item("c", "Football: PSG wins in Lyon", { published_at: "2026-11-20T07:00:00Z" }),
  item("d", "Celebrity gossip rocks Paris fashion week"),
  item("e", "Paris weather: rain all day", { source_id: "w", source: "Weather: Paris" }),
];

test("only main roles have a bubble", () => {
  assert.ok(eligible("protagonist") && eligible("antagonist") && eligible("supporting"));
  assert.ok(!eligible("featured") && !eligible(null));
});

test("topics match whole words, avoid wins", () => {
  assert.ok(mentions("Paris metro strike", "paris"));
  assert.ok(!mentions("Comparison of things", "paris"));
  assert.ok(mentions("New AI accelerator", "AI"));
  assert.ok(!mentions("said the chair", "AI"));
});

test("different bubbles select differently from the same shared pool", () => {
  const johnny = selectFor(pool, { topics: ["Paris"], avoid: ["gossip"], attention: 5 });
  const marie = selectFor(pool, { topics: ["AI", "football"], avoid: [], attention: 5 });
  assert.deepEqual(johnny.map((e) => e.item_id).sort(), ["a", "e"]);
  assert.deepEqual(marie.map((e) => e.item_id).sort(), ["b", "c"]);
  assert.ok(johnny.every((e) => e.matched.includes("Paris")));
});

test("attention limits how much is available, and proposals are capped", () => {
  const all = selectFor(pool, { topics: [], avoid: [], attention: 2 });
  assert.equal(all.length, 2);
  const many = selectFor(Array.from({ length: 20 }, (_, i) => item(`x${i}`, `Paris story number ${i} about the city`)), { topics: ["Paris"], avoid: [], attention: 10 });
  assert.equal(many.length, 10);
  assert.equal(many.filter((e) => e.propose).length, 3);
});

test("one story from several outlets is available once", () => {
  const dup = [item("p", "Paris metro strike enters third day - Le Monde"), item("q", "Paris metro strike enters third day - Reuters", { source_id: "s9" })];
  assert.equal(storyKey(dup[0]), storyKey(dup[1]));
  assert.equal(selectFor(dup, { topics: ["Paris"], avoid: [], attention: 5 }).length, 1);
});

test("already-offered coverage isn't offered again; a corrected report comes back as an update", () => {
  const seen = new Map([["a", 1], ["e", 1]]);
  assert.equal(selectFor(pool, { topics: ["Paris"], avoid: ["gossip"], attention: 5 }, seen).length, 0);
  const corrected = pool.map((i) => i.id === "a" ? { ...i, version: 2, title: "Paris metro strike ends (corrected)" } : i);
  const out = selectFor(corrected, { topics: ["Paris"], avoid: ["gossip"], attention: 5 }, seen);
  assert.equal(out.length, 1);
  assert.equal(out[0].update_of, 1);
  assert.equal(out[0].key, "a:2");
  assert.match(summarize("Johnny", out, { topics: ["Paris"], avoid: [], attention: 5 }), /update to earlier reports|is an update/);
});

test("the summary describes coverage, never reading", () => {
  const s = summarize("Johnny", selectFor(pool, { topics: ["Paris"], avoid: [], attention: 5 }), { topics: ["Paris"], avoid: [], attention: 5 });
  assert.match(s, /available to Johnny/);
  assert.match(s, /not what they read/);
  assert.doesNotMatch(s, /Johnny (read|saw|learned|feels|thinks|knows)/);
  assert.match(summarize("Marie", [], { topics: ["chess"], avoid: [], attention: 3 }), /No new coverage of chess/);
});

test("the daily schedule is one fixed UTC minute; local time follows daylight saving", () => {
  assert.equal(nextDaily(new Date("2026-11-20T08:00:00Z")).toISOString(), "2026-11-20T09:17:00.000Z");
  assert.equal(nextDaily(new Date("2026-11-20T09:17:00Z")).toISOString(), "2026-11-21T09:17:00.000Z");
  assert.match(localTime(new Date("2026-11-20T09:17:00Z"), "America/New_York"), /^4:17 AM EST$/);
  assert.match(localTime(new Date("2026-07-20T09:17:00Z"), "America/New_York"), /^5:17 AM EDT$/);
  // The day after the clocks change (Nov 1, 2026), the same run is an hour earlier locally.
  assert.match(localTime(new Date("2026-10-31T09:17:00Z"), "America/New_York"), /5:17 AM EDT/);
  assert.match(localTime(new Date("2026-11-02T09:17:00Z"), "America/New_York"), /4:17 AM EST/);
  assert.equal(localDate(new Date("2026-11-20T23:30:00Z"), "Europe/Paris"), "2026-11-21");
  assert.equal(localDate(new Date("2026-11-20T23:30:00Z"), "America/New_York"), "2026-11-20");
});

test("a chosen time is marked unsupported unless it's the fixed time", () => {
  assert.ok(preferredSupported("04:17", "America/New_York", new Date("2026-11-20T00:00:00Z")));
  assert.ok(!preferredSupported("07:00", "America/New_York", new Date("2026-11-20T00:00:00Z")));
  assert.ok(preferredSupported("10:17", "Europe/Paris", new Date("2026-11-20T00:00:00Z")));
});

test("terms are cleaned and bounded", () => {
  assert.deepEqual(cleanTerms("Paris, , AI;Paris\nfootball"), ["Paris", "AI", "football"]);
  assert.equal(cleanTerms(Array.from({ length: 20 }, (_, i) => `t${i}`).join(",")).length, 12);
});

const ok = (body = "{}"): Fetched => ({ url: "u", status: 200, contentType: "application/json", body, etag: null, lastModified: null });

test("shared fetch: the same address is fetched once for every film and character", async () => {
  let calls = 0;
  const get = async () => { calls++; await new Promise((r) => setTimeout(r, 5)); return ok(); };
  const cache: FetchCache = new Map();
  await Promise.all([1, 2, 3].map(() => sharedFetch(cache, "https://news.google.com/rss/search?q=paris", {}, get, 0)));
  await sharedFetch(cache, "https://news.google.com/rss/search?q=ai", {}, get, 0);
  assert.equal(calls, 2);
});

test("retries are bounded: one retry on network errors and 5xx, none for blocked addresses", async () => {
  let n = 0;
  const flaky = async () => { if (n++ === 0) throw new FetchError("reset", null, "network"); return ok(); };
  assert.equal((await fetchRetry("u", {}, 0, flaky)).status, 200);
  assert.equal(n, 2);
  let m = 0;
  const down = async () => { m++; return { ...ok(), status: 503 }; };
  assert.equal((await fetchRetry("u", {}, 0, down)).status, 503);
  assert.equal(m, 2);
  let b = 0;
  const blocked = async () => { b++; throw new FetchError("blocked", null, "blocked"); };
  await assert.rejects(fetchRetry("u", {}, 0, blocked));
  assert.equal(b, 1);
  let f = 0;
  const dead = async () => { f++; throw new FetchError("down", null, "network"); };
  await assert.rejects(fetchRetry("u", {}, 0, dead));
  assert.equal(f, 2);
});

test("the daily job is scheduled in vercel.json and runs the bubble refresh", () => {
  const v = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: { path: string; schedule: string }[] };
  assert.ok(v.crons.some((c) => c.path === "/api/cron/knowledge" && c.schedule === "17 9 * * *"));
  const route = readFileSync("app/api/cron/knowledge/route.ts", "utf8");
  assert.match(route, /refreshBubbles\(\{ projectId: film, trigger: "scheduled"/);
});

test("refreshing writes only coverage and run records", () => {
  const src = readFileSync("lib/bubbles/run.ts", "utf8");
  const rpcs = [...src.matchAll(/rpc\("([a-z_]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(rpcs)].sort(), ["bubble_refresh_start", "bubble_refresh_start_scheduled", "bubble_run_finish", "bubble_snapshot_put"]);
  assert.doesNotMatch(src, /\.(insert|update|upsert|delete)\(/);
  assert.doesNotMatch(src, /from\("(sim_[a-z_]+|dialogue_[a-z_]+)"\)/);
});

test("what a character follows directly counts as one of their interests", () => {
  const followed = { ...item("f", "Grandmaster wins the candidates final"), source_id: "own", source: "News: chess", own: "chess tournaments" };
  const out = selectFor([followed, item("x", "Unrelated city council story")], { topics: ["AI"], avoid: [], attention: 5 });
  assert.deepEqual(out.map((e) => [e.item_id, e.matched]), [["f", ["chess tournaments"]]]);
  const avoided = selectFor([{ ...followed, title: "Chess gossip roundup" }], { topics: ["AI"], avoid: ["gossip"], attention: 5 });
  assert.equal(avoided.length, 0, "avoid still wins");
});

test("interest labels are short search phrases", async () => {
  const { cleanLabel } = await import("../../lib/bubbles/interests");
  assert.equal(cleanLabel('- "AI safety research."'), "AI safety research");
  assert.equal(cleanLabel("x".repeat(80)).length, 60);
});
