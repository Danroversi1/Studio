// "How {name} is doing": one 0–10 mood (0 sad and stressed … 10 happy and calm).
// Pure and deterministic. The judging of each item against each rule ("in tune" +1, "at odds"
// −1, unrelated 0) happens on her own computer; everything below is Studio's code, so the same
// judgments always give the same score.
//
//   harmony  = Σ weight·relation / Σ weight·|relation|        (−1 … +1; null if nothing related)
//   target   = 5 + 5·harmony                                   (or her starting point on a quiet day)
//   score    = previous + rate·(target − previous)             (rate 0.4; 0.2 drifting on quiet days)
//
// Approved story events still nudge it: (Δhappiness − Δstress) / 40 per event.

export const MOOD_RATE = 0.4;
export const DRIFT_RATE = 0.2;
export const DEFAULT_START = 5;

export interface MoodRule { id: string; version: number; text: string; weight: number }
export interface MoodItem { key: string; item_id: string; title: string; source: string }
export interface MoodPayload { character: string; rules: MoodRule[]; items: MoodItem[] }
export interface Judgment { item_key: string; rule_id: string; relation: -1 | 0 | 1; reason: string }

/** A rule's weight: 1 + how strongly she said it moves them (its feel steps), so 1–3. */
export const ruleWeight = (stress: number, happiness: number) => 1 + Math.min(2, Math.max(Math.abs(stress), Math.abs(happiness)));

/** Keep only judgments about real items and real rules; at most one per pair; short reasons. */
export function cleanJudgments(raw: unknown, p: Pick<MoodPayload, "rules" | "items">): Judgment[] {
  if (!Array.isArray(raw)) return [];
  const rules = new Set(p.rules.map((r) => r.id));
  const items = new Set(p.items.map((i) => i.key));
  const seen = new Set<string>();
  const out: Judgment[] = [];
  for (const x of raw.slice(0, 400)) {
    if (!x || typeof x !== "object") continue;
    const j = x as Record<string, unknown>;
    const item = String(j.item_key ?? ""), rule = String(j.rule_id ?? "");
    const rel = Number(j.relation);
    if (!items.has(item) || !rules.has(rule) || ![-1, 0, 1].includes(rel)) continue;
    const k = `${item}|${rule}`;
    if (seen.has(k)) continue;
    seen.add(k);
    if (rel === 0) continue;
    out.push({ item_key: item, rule_id: rule, relation: rel as -1 | 1, reason: String(j.reason ?? "").replace(/\s+/g, " ").trim().slice(0, 200) });
  }
  return out;
}

export function harmony(judgments: Judgment[], rules: MoodRule[]): number | null {
  const w = new Map(rules.map((r) => [r.id, r.weight]));
  let num = 0, den = 0;
  for (const j of judgments) {
    if (!j.relation) continue;
    const weight = w.get(j.rule_id) ?? 1;
    num += weight * j.relation;
    den += weight;
  }
  return den ? num / den : null;
}

const clamp10 = (n: number) => Math.max(0, Math.min(10, n));

/** One day's step. `prev` is yesterday's final mood (her override if she set one). */
export function dayScore(prev: number, h: number | null, start: number = DEFAULT_START): { target: number; score: number } {
  const target = h === null ? clamp10(start) : clamp10(5 + 5 * h);
  const rate = h === null ? DRIFT_RATE : MOOD_RATE;
  return { target, score: Math.round(clamp10(prev + rate * (target - prev)) * 100) / 100 };
}

/** The nudge from approved story events since the last scored day. */
export const eventNudge = (changes: { d_stress: number; d_happiness: number }[]) =>
  changes.reduce((a, c) => a + (c.d_happiness - c.d_stress) / 40, 0);

export const showMood = (n: number) => (Math.round(clamp10(n) * 2) / 2).toFixed(1).replace(/\.0$/, "");

export function moodLabel(n: number): string {
  return n < 1.5 ? "In turmoil" : n < 3.5 ? "Troubled" : n < 4.5 ? "Uneasy" : n <= 5.5 ? "Steady" : n <= 6.5 ? "Fine" : n <= 8.5 ? "At ease" : "Thriving";
}

export interface DayRow { id: string; day: string; status: string; needs_judging: boolean; judgments: Judgment[]; payload: Partial<MoodPayload>; override: number | null; score: number | null }

/**
 * Settle a character's days in order: every day after the last unsettled one is (re)computed
 * from its stored judgments, so overrides and a new starting point flow forward. Stops at the
 * first day still waiting for her computer.
 */
export function settle(days: DayRow[], start: number): { id: string; prev: number; harmony: number | null; target: number; score: number }[] {
  const out: { id: string; prev: number; harmony: number | null; target: number; score: number }[] = [];
  let prev = start;
  for (const d of [...days].sort((a, b) => a.day.localeCompare(b.day))) {
    if (d.status === "waiting" && d.needs_judging) break;
    const h = d.status === "failed" ? null : harmony(d.judgments ?? [], (d.payload?.rules ?? []) as MoodRule[]);
    const r = dayScore(prev, h, start);
    out.push({ id: d.id, prev, harmony: h, target: r.target, score: r.score });
    prev = d.override ?? r.score;
  }
  return out;
}
