// Characters the script calls out who aren't in the cast yet. Speaker cues are found here
// (no AI); people only mentioned in action lines come from the cast-scan agent. Pure.
import { parseBreakdown, titleCase } from "./scene-plan";

export interface ScriptPerson { name: string; description: string; first_scene: number }

/** "The President" = "PRESIDENT" = "the president."; "Mr X" = "Mr. X". */
export function normName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim().replace(/^(the|a|an) /, "");
}

/** Speakers (dialogue cues) with the scene they first speak in. */
export function speakers(body: string): ScriptPerson[] {
  const out = new Map<string, ScriptPerson>();
  for (const sc of parseBreakdown(body)) {
    for (const c of sc.characters) {
      const k = normName(c);
      if (k && !out.has(k)) out.set(k, { name: titleCase(c), description: `Speaks in scene ${sc.number} (${sc.heading}).`, first_scene: sc.number });
    }
  }
  return [...out.values()];
}

/** People not already known (cast, or ones she removed), deduplicated, at most `max`. */
export function newPeople(known: string[], people: ScriptPerson[], max = 12): ScriptPerson[] {
  const have = new Set(known.map(normName));
  const out: ScriptPerson[] = [];
  for (const p of people) {
    const name = p.name.trim().slice(0, 80);
    const k = normName(name);
    if (!k || k.length < 2 || have.has(k)) continue;
    have.add(k);
    out.push({ ...p, name });
    if (out.length >= max) break;
  }
  return out;
}

export const castSummary = (p: ScriptPerson) =>
  `Not described yet. ${p.description.trim()} First appears in scene ${p.first_scene} of the script.`.slice(0, 600);
