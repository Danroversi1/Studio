// The job runner against a mocked provider and a fake database (no network, no real images).
import assert from "node:assert/strict";
import { test } from "node:test";
import { mockProvider, openAiProvider } from "../../lib/storyboard/provider";
import { runStoryboardJob } from "../../lib/storyboard/run-job";

function fakeDb(job: Record<string, unknown>) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  let started = false;
  const db = {
    calls,
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (fn === "storyboard_job_start") { const ok = !started; started = true; return { data: ok, error: null }; }
      return { data: null, error: null };
    },
    from: (t: string) => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: t === "storyboard_jobs" ? job : { entity_id: "ent", title: "Opening" } }) }) }),
    }),
  };
  return db;
}

const job = { id: "j1", sequence_id: "s", shot_id: "sh", kind: "look", mode: "look", prompt: "p", params: { output: { width: 1536, height: 832 } },
  reference_assets: [{ asset_id: "ref1", role: "character" }], base_asset_id: "frame1" };

test("sends the base frame first, then references; records the result", async () => {
  const db = fakeDb(job);
  const provider = mockProvider();
  const read = async (id: string) => ({ bytes: new TextEncoder().encode(id), mime: "image/png" as const });
  const res = await runStoryboardJob(db as never, "j1", { provider, service: db as never, read, store: async () => "out1" });
  assert.equal(res.assetId, "out1");
  assert.deepEqual(provider.calls[0].images.map((i) => new TextDecoder().decode(i.bytes)), ["frame1", "ref1"]);
  assert.deepEqual([provider.calls[0].width, provider.calls[0].height], [1536, 832]);
  assert.ok(db.calls.some((c) => c.fn === "storyboard_job_complete" && c.args.p_asset === "out1"));
});
test("a provider failure is recorded and nothing is stored", async () => {
  const db = fakeDb(job);
  let stored = false;
  const res = await runStoryboardJob(db as never, "j1", { provider: mockProvider({ fail: "declined" }), service: db as never,
    read: async () => ({ bytes: new Uint8Array([1]), mime: "image/png" }), store: async () => { stored = true; return "x"; } });
  assert.equal(res.error, "declined"); assert.equal(stored, false);
  assert.ok(db.calls.some((c) => c.fn === "storyboard_job_fail"));
});
test("an unopenable reference fails the job honestly (no silent text-only fallback)", async () => {
  const db = fakeDb(job);
  const res = await runStoryboardJob(db as never, "j1", { provider: mockProvider(), service: db as never, read: async () => null, store: async () => "x" });
  assert.match(res.error ?? "", /couldn't be opened/);
});
test("a job can't run twice", async () => {
  const db = fakeDb(job);
  const deps = { provider: mockProvider(), service: db as never, read: async () => ({ bytes: new Uint8Array([1]), mime: "image/png" as const }), store: async () => "x" };
  await runStoryboardJob(db as never, "j1", deps);
  assert.match((await runStoryboardJob(db as never, "j1", deps)).error ?? "", /already/);
});
test("without a key, OpenAI says what's missing and never pretends to generate", async () => {
  const p = openAiProvider({});
  assert.match(p.missing ?? "", /OPENAI_API_KEY/);
  await assert.rejects(p.generate({ prompt: "x", width: 1536, height: 864, images: [] }));
  assert.equal(p.capabilities.seed, false);
});
