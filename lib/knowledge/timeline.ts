// The Knowledge Timeline: who can know what on which story day. Pure (unit-tested); the
// database enforces the same rules (timeline_reach / timeline_can_see).
//
// Day 1 is the world as of a real date (the anchor). Every collected item falls on a story
// day by its date (published, else collected). On world day W:
//   antagonist with the permission → through W + ahead (the collected buffer)
//   protagonist                     → routine knowledge through W − 1, plus discoveries
//   everyone else                   → through W
import type { CastRole } from "../characters/roles";

export const METHODS = ["observation", "conversation", "research", "forensic", "hypothesis", "pattern"] as const;
export type Method = (typeof METHODS)[number];
export const METHOD_LABEL: Record<Method, string> = {
  observation: "Direct observation",
  conversation: "Conversation or trusted contact",
  research: "Research",
  forensic: "Forensic evidence",
  hypothesis: "Testing a hypothesis",
  pattern: "Recognizing a pattern",
};
export const PROTAGONIST_LABEL = "Routine knowledge: one day behind. Discoveries can close the gap.";

export interface Access { enabled: boolean; ahead_days: number }

const DAY = 86_400_000;
const utcDay = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);

/** Story day of a real date, given Day 1's real date. */
export function storyDayOf(dateIso: string, anchor: string): number {
  return Math.round((utcDay(dateIso) - utcDay(anchor)) / DAY) + 1;
}
/** The real date a story day maps to. */
export function realDateOf(day: number, anchor: string): string {
  return new Date(utcDay(anchor) + (day - 1) * DAY).toISOString().slice(0, 10);
}
export function itemDay(item: { published_at: string | null; retrieved_at: string }, anchor: string): number {
  return storyDayOf(item.published_at ?? item.retrieved_at, anchor);
}

export type Tier = "ahead" | "behind" | "present";
export function tierOf(role: CastRole | null, access?: Access | null): Tier {
  if (role === "antagonist" && access?.enabled) return "ahead";
  if (role === "protagonist") return "behind";
  return "present";
}

/** The furthest story day a character's routine knowledge reaches on world day W. */
export function reachOf(role: CastRole | null, access: Access | null | undefined, worldDay: number): number {
  const t = tierOf(role, access);
  return t === "ahead" ? worldDay + access!.ahead_days : t === "behind" ? worldDay - 1 : worldDay;
}

/** Could they draw on an item from this day? (A discovery of that item also opens it.) */
export function canSee(day: number, reach: number, discovered = false): boolean {
  return day <= reach || discovered;
}

export function dayLabel(day: number): string {
  return day <= 0 ? "before the story (backstory)" : `Day ${day}`;
}

export function reachLabel(role: CastRole | null, access: Access | null | undefined, worldDay: number, collectedThrough: number): string {
  const t = tierOf(role, access);
  const r = reachOf(role, access, worldDay);
  if (t === "ahead") {
    const real = Math.min(r, Math.max(worldDay, collectedThrough));
    return `Sees ahead through Day ${r} (${access!.ahead_days} day${access!.ahead_days === 1 ? "" : "s"}); the collected buffer reaches Day ${Math.max(worldDay, collectedThrough)}, so in practice through Day ${real}.`;
  }
  if (t === "behind") return `Routine knowledge through ${dayLabel(r)}. ${PROTAGONIST_LABEL}`;
  return `Through Day ${r} (the current day), from their sources and what actually reaches them.`;
}
