// World simulation: the deterministic parts. Plain-language rules, emotional labels, bounded
// emotional changes, and the checks that keep proposals honest (who could know what, which
// sources exist, the daily limit). Pure and unit-tested; no model, no database.
//
// Emotional state is a fictional writing control on two independent axes, each -100..100:
//   stress:    -100 very calm … 0 steady … +100 very stressed
//   happiness: -100 very sad  … 0 neutral … +100 very happy
// A character can be stressed and happy at the same time.

export type Family = "world" | "character" | "story" | "periphery";
export interface SimRule {
  id: string; family: Family; character_id: string | null; when_text: string; stress: number; happiness: number;
  tend_text: string | null; relief_text: string | null; enabled: boolean; version: number; effective_day: number;
}
export interface SimSettings {
  max_events: number; intensity: 1 | 2 | 3; flexibility: 1 | 2 | 3; paused: boolean; auto_daily: boolean; auto_dialogue: boolean;
  start_date: string | null; clock_day: number; version: number;
}
export type Basis = "source" | "adaptation" | "fiction";
export type Involvement = "encounters_source" | "directly_involved" | "told_by_character";
export interface EventCharacter {
  character_id: string; name: string; d_stress: number; d_happiness: number; feel: string; movement: string;
  channel: string; involvement: Involvement; rule_ids: string[];
}
export interface EventSource { item_id: string; version: number; title: string; url: string | null; published_at: string | null; retrieved_at: string; source: string }
export interface EventData {
  title: string; description: string; relevance: string; basis: Basis; sources: EventSource[];
  characters: EventCharacter[]; rationale: string; fictional_date: string | null; flags?: string[];
}

/** Feelings are tracked only for the characters the story centres on. Featured characters (and
 *  ones without a role yet) can still be in events and act, but their feelings aren't tracked. */
export const TRACKED_ROLES = ["protagonist", "antagonist", "supporting"] as const;
export const isTracked = (role: string | null | undefined) => !!role && (TRACKED_ROLES as readonly string[]).includes(role);

export const FAMILY_LABEL: Record<Family, string> = { world: "Pressure from the world", character: "Character tendency", story: "Story consequence", periphery: "How the world works" };
export const FAMILY_HINT: Record<Family, string> = {
  world: "Conditions in the world that create pressure or relief.",
  character: "How one character tends to feel and respond.",
  story: "How responses lead to possible actions and consequences.",
  periphery: "How the world around the story operates: how news spreads, what reaches whom, how people and institutions respond. No feelings.",
};
export const INTENSITY_LABEL = { 1: "Gentle", 2: "Moderate", 3: "Strong" } as const;
export const FLEXIBILITY_LABEL = { 1: "Steady", 2: "Some surprises", 3: "Open" } as const;
export const FLEXIBILITY_PROMPT = {
  1: "Characters stay close to their usual tendencies.",
  2: "Characters mostly follow their tendencies, with some variation when it fits what they want.",
  3: "Characters may make surprising choices, as long as they stay in character and within what they know.",
} as const;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
export const bound = (n: number) => clamp(Math.round(n), -100, 100);

/** Plain-language feel words for a rule's small structured change (-2..2 on each axis). */
export function feelWords(stress: number, happiness: number): string {
  const s = stress === 2 ? "much more stressed" : stress === 1 ? "more stressed" : stress === -1 ? "calmer" : stress === -2 ? "much calmer" : "";
  const h = happiness === 2 ? "much happier" : happiness === 1 ? "happier" : happiness === -1 ? "sadder" : happiness === -2 ? "much sadder" : "";
  return [s, h].filter(Boolean).join(" and ") || "no particular change";
}

/** "When Johnny finds evidence he can't explain, he becomes more stressed and tends to investigate. Talking with his mentor can bring relief." */
export function ruleSentence(r: Pick<SimRule, "family" | "when_text" | "stress" | "happiness" | "tend_text" | "relief_text">, who: string | null): string {
  if (r.family === "periphery") {
    const w = r.when_text.trim().replace(/[.]+$/, "");
    const then = (r.tend_text ?? "").trim().replace(/^then,?\s+/i, "").replace(/[.]+$/, "");
    if (then) return `When ${w}, ${then}.`;
    const t = r.when_text.trim();   // a plain bullet reads as she wrote it
    return /[.!?]$/.test(t) ? capital(t) : `${capital(t)}.`;
  }
  // A character rule written as a plain bullet point reads exactly as she wrote it.
  if (r.family === "character" && !r.stress && !r.happiness && !r.tend_text?.trim() && !r.relief_text?.trim()) {
    const t = r.when_text.trim();
    return /[.!?]$/.test(t) ? capital(t) : `${capital(t)}.`;
  }
  const subject = who ?? (r.family === "world" ? "characters" : "they");
  const when = r.when_text.trim().replace(/[.]+$/, "");
  const feel = feelWords(r.stress, r.happiness);
  const verb = subject === "characters" || subject === "they" ? "become" : "becomes";
  const tend = r.tend_text?.trim() ? ` and ${subject === "characters" || subject === "they" ? "tend" : "tends"} to ${r.tend_text.trim().replace(/^to\s+/i, "").replace(/[.]+$/, "")}` : "";
  const main = feel === "no particular change" && !tend ? `When ${when}, ${subject} take note.` : `When ${when}, ${subject} ${feel === "no particular change" ? "notice" : `${verb} ${feel}`}${tend}.`;
  const relief = r.relief_text?.trim() ? ` ${capital(r.relief_text.trim().replace(/[.]+$/, ""))} can bring relief.` : "";
  return main + relief;
}
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Approachable labels for the two axes. */
export function stressLabel(v: number): string {
  return v <= -60 ? "Very calm" : v <= -20 ? "Calm" : v < 20 ? "Steady" : v < 60 ? "Tense" : "Very stressed";
}
export function happinessLabel(v: number): string {
  return v <= -60 ? "Very sad" : v <= -20 ? "Low" : v < 20 ? "Neutral" : v < 60 ? "Happy" : "Very happy";
}
export function changeWords(dStress: number, dHappy: number): string {
  const s = Math.abs(dStress) < 3 ? "" : dStress > 0 ? `stress ${dStress >= 15 ? "rises a lot" : "rises"}` : `stress ${dStress <= -15 ? "eases a lot" : "eases"}`;
  const h = Math.abs(dHappy) < 3 ? "" : dHappy > 0 ? `happiness ${dHappy >= 15 ? "rises a lot" : "rises"}` : `sadness ${dHappy <= -15 ? "deepens a lot" : "deepens"}`;
  return [s, h].filter(Boolean).join("; ") || "little change";
}

/** A model step (-3..3) → points, scaled by response intensity and bounded per event. */
const SCALE = { 1: 0.6, 2: 1, 3: 1.4 } as const;
export const STEP_POINTS = 7;
export const MAX_PER_EVENT = 25;
export function stepToPoints(step: number, intensity: 1 | 2 | 3): number {
  const s = clamp(Math.round(Number(step) || 0), -3, 3);
  return clamp(Math.round(s * STEP_POINTS * SCALE[intensity]), -MAX_PER_EVENT, MAX_PER_EVENT);
}

/** Fictional date of a day: day 1 = start date. Real time and story time are kept separate. */
export function fictionalDate(start: string | null, day: number): string | null {
  if (!start || day < 1) return null;
  const d = new Date(`${start}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + day - 1);
  return d.toISOString().slice(0, 10);
}

/** Day 1's date from her World & Time timeline (pure). An exact date she wrote is used as is;
 *  a month means its first day; a story set in the present year starts today; another year
 *  starts on January 1. No usable date → today. She can always choose another date. */
export function dayOneFromTimeline(periods: { label: string; precision: string; start_year?: number | null }[] | undefined, today: string): { date: string; why: string } {
  const p = (periods ?? []).find((x) => x.precision === "exact" || x.precision === "year") ?? (periods ?? [])[0];
  if (!p) return { date: today, why: "today (no date in World & Time yet)" };
  const label = p.label.trim();
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(label);
  if (iso) return { date: `${iso[1]}-${iso[2]}-${iso[3]}`, why: `your timeline (${label})` };
  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const m = new RegExp(`\\b(${MONTHS.join("|")})[a-z]*\\.?\\s+(?:(\\d{1,2})(?:st|nd|rd|th)?,?\\s+)?(\\d{4})\\b`, "i").exec(label);
  if (m) {
    const mm = String(MONTHS.indexOf(m[1].toLowerCase().slice(0, 3)) + 1).padStart(2, "0");
    const dd = m[2] ? String(Math.min(31, Number(m[2]))).padStart(2, "0") : "01";
    return { date: `${m[3]}-${mm}-${dd}`, why: `your timeline (${label})` };
  }
  const y = p.start_year;
  if (y == null || !Number.isFinite(y) || y < 1 || y > 9999) return { date: today, why: `today (your timeline, "${label}", has no calendar date)` };
  if (String(y) === today.slice(0, 4)) return { date: today, why: `today (your story is set in ${y})` };
  return { date: `${String(y).padStart(4, "0")}-01-01`, why: `your timeline (${label})` };
}

/** The next run of the daily schedule (vercel.json cron "37 9 * * *", UTC; after the feed refresh at 9:17). */
export const SCHEDULE_UTC = { hour: 9, minute: 37 };
export function nextScheduled(now: Date): Date {
  const n = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), SCHEDULE_UTC.hour, SCHEDULE_UTC.minute));
  if (n <= now) n.setUTCDate(n.getUTCDate() + 1);
  return n;
}

// ---- Validating what a model proposes -----------------------------------------------------------
export interface RawCharacter { name: string; involvement: string; told_by?: string; stress_step: number; happiness_step: number; feel: string; movement: string; rule_ids: string[] }
export interface RawEvent { ref: string; title: string; description: string; relevance: string; basis: string; source_item_ids: string[]; depends_on_refs: string[]; characters: RawCharacter[]; rationale: string }
export interface Material { id: string; version: number; title: string; url: string | null; published_at: string | null; retrieved_at: string; source: string }
export interface CheckContext {
  characters: { id: string; name: string }[];
  /** item id → ids of characters who could encounter it in the story by the fictional date */
  access: Record<string, string[]>;
  material: Material[];
  rules: Pick<SimRule, "id" | "family" | "character_id">[];
  intensity: 1 | 2 | 3;
  fictionalDate: string | null;
  /** ids of characters whose feelings are tracked (protagonist / antagonist / supporting) */
  tracked?: string[];
}

const txt = (s: unknown, n: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/** Cleans one proposed event. Returns null when nothing usable is left. Flags explain removals. */
export function checkEvent(raw: RawEvent, ctx: CheckContext): EventData | null {
  const flags: string[] = [];
  const title = txt(raw.title, 140);
  if (title.length < 2) return null;
  const byId = new Map(ctx.material.map((m) => [m.id, m]));
  const ids = [...new Set((raw.source_item_ids ?? []).filter((id) => byId.has(id)))].slice(0, 6);
  if ((raw.source_item_ids ?? []).length > ids.length) flags.push("A source that wasn't provided was removed.");
  const sources = ids.map((id) => byId.get(id)!);
  let basis: Basis = raw.basis === "source" || raw.basis === "adaptation" ? raw.basis : "fiction";
  // A source claim is only "source-derived" if it exists by the story's date; otherwise it's an adaptation.
  if (basis === "source" && (!sources.length || sources.some((m) => !m.published_at || !ctx.fictionalDate || m.published_at.slice(0, 10) > ctx.fictionalDate))) {
    basis = sources.length ? "adaptation" : "fiction";
    flags.push(sources.length ? "Marked as an adaptation: the source isn't dated on or before the story's date." : "Marked as fiction: no source was given.");
  }
  if (basis === "adaptation" && !sources.length) basis = "fiction";
  const nameToId = new Map(ctx.characters.map((c) => [c.name.toUpperCase(), c.id]));
  const ruleOk = new Map(ctx.rules.map((r) => [r.id, r]));
  const affected: EventCharacter[] = [];
  const seen = new Set<string>();
  for (const c of (raw.characters ?? []).slice(0, 8)) {
    const id = nameToId.get(txt(c.name, 120).toUpperCase());
    if (!id || seen.has(id)) { if (!id && c.name) flags.push(`${txt(c.name, 60)} isn't a character in this film.`); continue; }
    const inv: Involvement = c.involvement === "directly_involved" || c.involvement === "told_by_character" ? c.involvement : "encounters_source";
    // Knowledge: no reacting to things they couldn't know.
    if (inv === "encounters_source") {
      if (!sources.length || !sources.some((m) => (ctx.access[m.id] ?? []).includes(id))) { flags.push(`${ctx.characters.find((x) => x.id === id)!.name} doesn't have a way to know about this yet, so they were left out.`); continue; }
    } else if (inv === "told_by_character") {
      const teller = nameToId.get(txt(c.told_by, 120).toUpperCase());
      const tellerKnows = teller && teller !== id && (sources.some((m) => (ctx.access[m.id] ?? []).includes(teller)) || affected.some((a) => a.character_id === teller));
      if (!tellerKnows) { flags.push(`${ctx.characters.find((x) => x.id === id)!.name} would need someone who knows to tell them; left out.`); continue; }
    } else if (basis === "source") {
      // Being "in" a real-world event only works as fiction.
      basis = "adaptation";
    }
    seen.add(id);
    const feels = !ctx.tracked || ctx.tracked.includes(id);
    const ruleIds = [...new Set((c.rule_ids ?? []).filter((r) => { const x = ruleOk.get(r); return x && x.family !== "periphery" && (x.family !== "character" || x.character_id === id); }))].slice(0, 4);
    affected.push({
      character_id: id, name: ctx.characters.find((x) => x.id === id)!.name,
      d_stress: feels ? stepToPoints(c.stress_step, ctx.intensity) : 0, d_happiness: feels ? stepToPoints(c.happiness_step, ctx.intensity) : 0,
      feel: txt(c.feel, 200), movement: txt(c.movement, 300),
      channel: inv === "encounters_source" ? "Through the news they follow" : inv === "told_by_character" ? `Told by ${txt(c.told_by, 80)}` : "It happens to them",
      involvement: inv, rule_ids: ruleIds,
    });
  }
  return {
    title, description: txt(raw.description, 800), relevance: txt(raw.relevance, 400), basis,
    sources: sources.map((m) => ({ item_id: m.id, version: m.version, title: m.title, url: m.url, published_at: m.published_at, retrieved_at: m.retrieved_at, source: m.source })),
    characters: affected, rationale: txt(raw.rationale, 400), fictional_date: ctx.fictionalDate, ...(flags.length ? { flags: [...new Set(flags)] } : {}),
  };
}

/** Cleans a whole run: at most `remaining` events; dependencies only on earlier events of the run. */
export function checkRun(raw: RawEvent[], ctx: CheckContext, remaining: number): { ref: string; depends_on_refs: string[]; data: EventData }[] {
  const out: { ref: string; depends_on_refs: string[]; data: EventData }[] = [];
  for (const e of raw ?? []) {
    if (out.length >= Math.max(0, remaining)) break;
    const data = checkEvent(e, ctx);
    if (!data) continue;
    const ref = txt(e.ref, 20) || `e${out.length + 1}`;
    out.push({ ref, depends_on_refs: (e.depends_on_refs ?? []).filter((d) => out.some((o) => o.ref === d)), data });
  }
  return out;
}

/** Bullet points → one rule each (blank lines and bullet marks dropped; at most 20, 300 chars). */
export function parseBullets(text: string): string[] {
  return text.split(/\r?\n/).map((l) => l.replace(/^\s*(?:[-*•–·]|\d+[.)])\s*/, "").trim()).filter((l) => l.length >= 2).map((l) => l.slice(0, 300)).slice(0, 20);
}
