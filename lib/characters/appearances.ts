// How many scenes of her script each character appears in: they speak in the scene, or the
// scene's own text names them (art-department notes like [[Props: photos of Johnny]] don't count). Used to order characters within a role. Pure (unit-tested); no model.
import { splitScenes } from "../dialogue/scenes";

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function countAppearances(script: string, names: string[]): Record<string, number> {
  const scenes = splitScenes(script).map((s) => ({ ...s, text: s.text.replace(/\[\[[\s\S]*?\]\]/g, " ") }));
  const out: Record<string, number> = {};
  for (const name of names) {
    const n = name.trim();
    if (!n) continue;
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${esc(n)}($|[^\\p{L}\\p{N}])`, "iu");
    const upper = n.toUpperCase();
    out[n.toLowerCase()] = scenes.filter((s) => s.characters.some((c) => c.toUpperCase() === upper) || re.test(s.text)).length;
  }
  return out;
}
