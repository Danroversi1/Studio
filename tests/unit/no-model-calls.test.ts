// "Build first. Generate when needed." The code behind routine storyboard actions (opening,
// uploading, composing, camera, look, ordering, save/reload, export) must not be able to
// reach a model: walk its imports and fail if any path leads to a model-calling module.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";

const ROOT = resolve(import.meta.dirname, "../..");
const FORBIDDEN = [
  "lib/storyboard/provider.ts",               // the cloud image provider (OpenAI): never on the local path
  "lib/ai/client.ts", "lib/storyboard/suggest.ts", "lib/storyboard/run-job.ts", "lib/agents/run-partner-turn.ts",
  "lib/agents/run-story-breakdown.ts", "lib/agents/run-scene-plan.ts", "lib/agents/run-cast-scan.ts", "lib/agents/run-world-read.ts",
  "lib/agents/run-character-talk.ts", "lib/dialogue/run.ts", "lib/agents/run-impression.ts", "lib/sim/run.ts",
];
const ROUTINE = [
  "app/projects/[projectId]/storyboard-actions.ts",          // every routine server action
  "components/storyboard/studio.tsx",                         // the Compose screen (canvas, panels, autosave, export)
  "components/storyboard/compose-canvas.tsx", "components/storyboard/panels.tsx",
  "components/storyboard/print-sheet.tsx", "components/storyboard/card-thumb.tsx",
  "app/projects/[projectId]/storyboards/page.tsx",
  "app/projects/[projectId]/storyboards/[sequenceId]/page.tsx",   // opening a storyboard
  "app/print/storyboards/[sequenceId]/page.tsx",
  "app/api/storyboards/[sequenceId]/export/route.ts", "app/api/storyboards/frame-versions/route.ts",
  "app/projects/[projectId]/look-actions.ts",                 // Look & Feel: add, tag, order, approve, directions
  "components/look/look-feel.tsx", "components/look/directions.tsx", "components/look/parts.tsx",
  "components/storyboard/look-refs.tsx", "lib/look/palette.ts", "lib/look/resolve.ts", "lib/look/upload.ts",
  // (The Treatment page itself also hosts optional AI features through the shared actions.ts,
  //  e.g. the Story Lead breakdown; Look & Feel's own modules above are the ones checked.)
  "app/api/look/[directionId]/bundle/route.ts",
  // Local rendering: everything Studio does for Generate Locally / the companion.
  "app/projects/[projectId]/local-actions.ts", "components/storyboard/local-generate.tsx", "components/storyboard/renderer-setup.tsx",
  "app/projects/[projectId]/storyboards/renderer/page.tsx", "lib/local/bundle.ts", "lib/local/server.ts",
  "app/api/renderer/pair/route.ts", "app/api/renderer/poll/route.ts", "app/api/renderer/jobs/[jobId]/progress/route.ts",
  "app/api/renderer/jobs/[jobId]/output/route.ts", "app/api/renderer/jobs/[jobId]/complete/route.ts", "app/api/renderer/jobs/[jobId]/fail/route.ts",
  "app/api/assets/route.ts", "app/api/assets/[assetId]/complete/route.ts", "app/api/assets/[assetId]/route.ts",
  // Knowledge Base: browsing, adding, tagging, collections and feed refreshes (scheduled or
  // manual). Feed collection is deterministic and must never reach a model or dialogue.
  "app/projects/[projectId]/knowledge-actions.ts",
  "app/api/cron/knowledge/route.ts", "lib/knowledge/refresh.ts", "lib/knowledge/data.ts", "lib/knowledge/eligibility.ts",
  // Connecting collections to characters, previewing what they could draw on, scene time.
  "app/projects/[projectId]/connect-actions.ts", "components/connections-desk.tsx", "components/knowledge/knowledge-connections.tsx",
  "lib/knowledge/connect-data.ts", "app/projects/[projectId]/connections/page.tsx",
  // World watches: free public sources, no model, no tokens.
  "lib/knowledge/watch.ts",
  // World simulation: limits, knowledge checks, emotional bounds, approvals and the desk's data.
  "lib/sim/rules.ts", "lib/sim/data.ts",
];

function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(from), spec);
  else return null; // packages
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) if (existsSync(c) && !c.endsWith("/")) { try { readFileSync(c); return c; } catch { /* dir */ } }
  return null;
}
function graph(entry: string): Map<string, string[]> {
  const seen = new Map<string, string[]>();
  const stack: [string, string[]][] = [[join(ROOT, entry), [entry]]];
  while (stack.length) {
    const [file, path] = stack.pop()!;
    if (seen.has(file)) continue;
    seen.set(file, path);
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/^\s*import\s+(type\s+)?[^;]*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/gm)) {
      if (m[1]) continue; // type-only imports never run
      const next = resolveImport(file, m[2] ?? m[3]);
      if (next) stack.push([next, [...path, next.replace(`${ROOT}/`, "")]]);
    }
  }
  return seen;
}

for (const entry of ROUTINE) {
  test(`no route to a model from ${entry}`, () => {
    const g = graph(entry);
    for (const [file, path] of g) {
      const rel = file.replace(`${ROOT}/`, "");
      assert.ok(!FORBIDDEN.includes(rel), `${entry} can reach ${rel} via ${path.join(" → ")}`);
      assert.doesNotMatch(readFileSync(file, "utf8"), /^\s*import\s+(?!type)[^;]*from\s+["']@anthropic-ai\/sdk["']/m, `${rel} imports the Anthropic SDK`);
    }
  });
}

test("the optional AI routes are the only storyboard entry points that can call a model", () => {
  const ai = graph("app/api/storyboards/[sequenceId]/ai/route.ts");
  assert.ok([...ai.keys()].some((f) => f.endsWith("lib/storyboard/run-job.ts")));
  const sug = graph("app/api/storyboards/[sequenceId]/suggest/route.ts");
  assert.ok([...sug.keys()].some((f) => f.endsWith("lib/ai/client.ts")));
});

test("feed refreshes can't reach dialogue at all (no drafting cascade from new research)", () => {
  for (const entry of ["app/api/cron/knowledge/route.ts", "lib/knowledge/refresh.ts", "app/projects/[projectId]/knowledge-actions.ts"]) {
    for (const [file, path] of graph(entry)) {
      assert.ok(!file.includes("/lib/dialogue/") && !file.endsWith("run-impression.ts"),
        `${entry} reaches ${file.replace(`${ROOT}/`, "")} via ${path.join(" → ")}`);
    }
  }
});

test("drafting dialogue is reachable only from the dialogue actions and the outline's Auto-draft hook", () => {
  const d = graph("app/projects/[projectId]/dialogue-actions.ts");
  assert.ok([...d.keys()].some((f) => f.endsWith("lib/dialogue/run.ts")));
  assert.ok(!graph("lib/dialogue/scenes.ts").has(join(ROOT, "lib/ai/client.ts")));
  assert.ok(!graph("lib/dialogue/request.ts").has(join(ROOT, "lib/ai/client.ts")), "building a request (retrieval, rules) needs no model");
});

test("the world simulation can propose events but can't reach dialogue drafting", () => {
  for (const entry of ["lib/sim/run.ts", "app/api/cron/simulation/route.ts"]) {
    for (const [file, path] of graph(entry)) {
      assert.ok(!file.endsWith("lib/dialogue/run.ts") && !file.endsWith("dialogue-actions.ts") && !file.endsWith("sim-actions.ts"),
        `${entry} reaches ${file.replace(`${ROOT}/`, "")} via ${path.join(" → ")}`);
    }
  }
  // Dialogue from events goes only through the approval-gated action.
  assert.ok([...graph("app/projects/[projectId]/sim-actions.ts").keys()].some((f) => f.endsWith("lib/dialogue/run.ts")));
});
