// What every agent reads as "her synopsis": the latest saved Story desk text, with the cast
// answer brought up to date. Her cast answer ("Whose story is it?") is written once, but she
// keeps describing each character on its own page afterwards, and the Story desk shows those
// newer descriptions in its cast box. Agents must read the same thing she sees, so each cast
// line takes the character's current description when it has one. Pure (unit-tested).
import { parseCast } from "../cast";
import { INTAKE_QUESTIONS, parseIntake } from "../intake";

export interface CastCard { name: string; summary: string }

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const UNDESCRIBED = /^not described yet\b/i;

export function currentSynopsis(body: string, cards: CastCard[]): string {
  const text = (body ?? "").trim();
  if (!text) return "";
  const a = parseIntake(text);
  if (!a.who.trim()) return text;
  const byName = new Map(cards.filter((c) => c.summary.trim() && !UNDESCRIBED.test(c.summary.trim())).map((c) => [norm(c.name), c.summary.trim()]));
  const cast = parseCast(a.who);
  if (!cast.length) return text;
  let changed = false;
  const lines = cast.map((m) => {
    const now = byName.get(norm(m.name));
    if (now && norm(now) !== norm(m.description)) { changed = true; return `${m.name}: ${now}`; }
    return `${m.name}: ${m.description}`;
  });
  if (!changed) return text;
  return INTAKE_QUESTIONS
    .map((q) => {
      const v = q.key === "who" ? `${lines.join("\n\n")}\n(Each line above is the character's current description from their character page.)` : a[q.key].trim();
      return v ? `## ${q.heading}\n${v}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

/** "saved 22 Nov 2026, 20:20 UTC" for a timestamp, or "" when unknown. */
export function savedLabel(at: string | null | undefined): string {
  if (!at) return "";
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  const m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  const hh = String(d.getUTCHours()).padStart(2, "0"), mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `saved ${d.getUTCDate()} ${m} ${d.getUTCFullYear()}, ${hh}:${mm} UTC`;
}
