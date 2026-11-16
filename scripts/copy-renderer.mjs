// Publish the companion program, its setup guide and workflow manifests as static files
// (public/renderer/), so the director can download them from Studio. Tests are not published.
import { cpSync, mkdirSync, readdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

const src = "renderer", dst = join("public", "renderer");
rmSync(dst, { recursive: true, force: true });
mkdirSync(join(dst, "workflows"), { recursive: true });
for (const f of ["studio_renderer.py", "README.md"]) cpSync(join(src, f), join(dst, f));
for (const w of readdirSync(join(src, "workflows"))) {
  const m = join(src, "workflows", w, "manifest.json");
  if (existsSync(m)) { mkdirSync(join(dst, "workflows", w), { recursive: true }); cpSync(m, join(dst, "workflows", w, "manifest.json")); }
}
console.log("Published the local renderer companion to public/renderer/");
