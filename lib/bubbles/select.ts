// Characters' daily media bubbles — pure selection rules (no model, no database).
//
// What's AVAILABLE to a character on a day: the newest shared World coverage, filtered by what
// they pay attention to and what they avoid, capped by how much they take in. Availability is
// not exposure. The summary describes coverage; it never says what they read or think.
import { isTracked } from "../sim/rules";

export const DAILY_UTC = { hour: 9, minute: 17 } as const; // the knowledge cron in vercel.json
export const DEFAULT_TZ = "America/New_York";
export const DEFAULT_ATTENTION = 5;
export const MAX_PROPOSED = 3; // proposals per character per day (the event review caps the total)

export interface BubbleProfile { topics: string[]; avoid: string[]; attention: number }
export interface CandidateItem {
  id: string; version: number; title: string; url: string | null; content: string;
  published_at: string | null; retrieved_at: string; source_id: string; source: string;
}
export interface BubbleEntry {
  key: string; item_id: string; version: number; title: string; url: string | null; source: string; source_id: string;
  published_at: string | null; retrieved_at: string; matched: string[]; propose: boolean; update_of?: number;
}

export const eligible = (role: string | null) => isTracked(role);

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const STOP = new Set(["the", "and", "of", "in", "on", "for", "a", "an", "to", "news", "about"]);

/** Does a topic phrase appear in the text? Every meaningful word must be there as a word. */
export function mentions(text: string, phrase: string): boolean {
  const t = ` ${norm(text)} `;
  const words = norm(phrase).split(" ").filter((w) => w && !STOP.has(w));
  if (!words.length) return false;
  return words.every((w) => t.includes(` ${w} `) || (w.length >= 5 && t.includes(` ${w}s `)));
}

/** One story told by several outlets counts once: same address, or the same headline. */
export function storyKey(i: Pick<CandidateItem, "url" | "title">): string {
  const head = norm(i.title.replace(/\s[-–|]\s[^-–|]{2,60}$/, "")); // "Headline - Outlet"
  return head.length >= 12 ? `t:${head}` : `u:${(i.url ?? "").replace(/[?#].*$/, "").replace(/\/$/, "").toLowerCase()}`;
}

const when = (i: Pick<CandidateItem, "published_at" | "retrieved_at">) => Date.parse(i.published_at ?? i.retrieved_at) || 0;

/**
 * The day's selection for one character. `seen` holds earlier entries (item id → newest version
 * already offered), so a day shows new coverage, and a changed report comes back as an update.
 */
export function selectFor(items: CandidateItem[], p: BubbleProfile, seen: Map<string, number> = new Map()): BubbleEntry[] {
  const limit = Math.max(1, Math.min(15, p.attention || DEFAULT_ATTENTION));
  const topics = p.topics.filter((t) => norm(t));
  const scored = items.flatMap((i) => {
    const prev = seen.get(i.id);
    if (prev !== undefined && prev >= i.version) return [];
    const text = `${i.title} ${i.content.slice(0, 600)}`;
    if (p.avoid.some((a) => mentions(text, a))) return [];
    const matched = topics.filter((t) => mentions(text, t));
    if (topics.length && !matched.length) return [];
    return [{ i, matched, prev }];
  }).sort((a, b) => b.matched.length - a.matched.length || when(b.i) - when(a.i) || a.i.id.localeCompare(b.i.id));
  const stories = new Set<string>();
  const out: BubbleEntry[] = [];
  for (const { i, matched, prev } of scored) {
    const k = storyKey(i);
    if (stories.has(k)) continue;
    stories.add(k);
    out.push({
      key: `${i.id}:${i.version}`, item_id: i.id, version: i.version, title: i.title, url: i.url, source: i.source, source_id: i.source_id,
      published_at: i.published_at, retrieved_at: i.retrieved_at, matched, propose: false, ...(prev !== undefined ? { update_of: prev } : {}),
    });
    if (out.length >= limit) break;
  }
  // Only coverage that matches something they follow is offered to the event review.
  out.filter((e) => e.matched.length || !topics.length).slice(0, MAX_PROPOSED).forEach((e) => { e.propose = true; });
  return out;
}

/** A short description of what was available — never what they read, felt or concluded. */
export function summarize(name: string, entries: BubbleEntry[], p: BubbleProfile): string {
  if (!entries.length) {
    return p.topics.length ? `No new coverage of ${list(p.topics.slice(0, 3))} reached ${name}'s bubble today.` : `No new coverage reached ${name}'s bubble today.`;
  }
  const byTopic = new Map<string, number>();
  for (const e of entries) for (const t of e.matched) byTopic.set(t, (byTopic.get(t) ?? 0) + 1);
  const topics = [...byTopic].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t, n]) => `${t} (${n})`);
  const sources = [...new Set(entries.map((e) => e.source))].slice(0, 3);
  const updates = entries.filter((e) => e.update_of !== undefined).length;
  const lead = entries[0].title.length > 110 ? `${entries[0].title.slice(0, 107)}…` : entries[0].title;
  return [
    `${entries.length} new ${entries.length === 1 ? "item was" : "items were"} available to ${name}${topics.length ? ` — ${list(topics)}` : ""}, from ${list(sources)}.`,
    `Most prominent: “${lead}”.`,
    updates ? `${updates} ${updates === 1 ? "is an update" : "are updates"} to earlier reports.` : "",
    "This is what was around them, not what they read.",
  ].filter(Boolean).join(" ");
}
const list = (xs: string[]) => xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;

/** The next daily refresh after `now` (always the same UTC minute). */
export function nextDaily(now: Date): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), DAILY_UTC.hour, DAILY_UTC.minute));
  if (d <= now) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

/** A time shown in the film's timezone (daylight saving handled by the platform's tz data). */
export function localTime(at: Date, tz: string, withDate = false): string {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", timeZoneName: "short", ...(withDate ? { weekday: "short", month: "short", day: "numeric" } : {}) }).format(at);
  } catch {
    return at.toISOString().slice(0, 16).replace("T", " ") + " UTC";
  }
}

/** The film's local date for a moment (what a day's snapshot is filed under). */
export function localDate(at: Date, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

/** Does her chosen time match what the hosting can actually run? (Daily, one fixed minute.) */
export function preferredSupported(preferred: string, tz: string, on: Date = new Date()): boolean {
  const fixed = nextDaily(on);
  const hm = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(fixed);
  return hm === preferred;
}

export function cleanTerms(raw: string): string[] {
  return [...new Set(raw.split(/[,\n;]/).map((t) => t.trim().slice(0, 60)).filter((t) => t.length >= 2))].slice(0, 12);
}
