// Regenerate lib/agents/specs/*.ts from the parent's specs in docs/agents/*.txt.
// Usage: node scripts/gen-agent-specs.mjs
import { readFileSync, writeFileSync } from "node:fs";
const specs = [
  ["docs/agents/story-development-agent.txt", "lib/agents/specs/story-partner.ts", "STORY_PARTNER_SPEC", "the parent's agent specification, used verbatim as the\n// partner's instructions"],
  ["docs/agents/production-design-agent.txt", "lib/agents/specs/design-partner.ts", "DESIGN_PARTNER_SPEC", "the parent's agent specification, used verbatim as the\n// partner's instructions"],
  ["docs/agents/story-development-process.txt", "lib/agents/specs/story-process.ts", "STORY_PROCESS_SPEC", "the parent's story development\n// process, used verbatim as additional instructions for the Story partner"],
];
for (const [src, out, name, what] of specs) {
  const text = readFileSync(src, "utf8");
  writeFileSync(out, `// Generated from ${src} (${what}). Do not edit by hand.\nexport const ${name} = ${JSON.stringify(text)};\n`);
  console.log("wrote", out);
}
