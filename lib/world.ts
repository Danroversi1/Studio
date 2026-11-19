// World & Time: where the story happens, when, and how much time it spans.
// Pure (unit-tested). The database keeps one record per film (story_world); this file
// holds the shapes, the checks, and what STUDIO works out (a calculated span, a
// suggested sentence, what may need review after a change).
//
// Keep separate: film runtime (how long the audience watches, projects.settings.runtime),
// setting (where), periods (when), narrative span (earliest to latest story event),
// coverage (continuous or selected moments), presentation order (deeper section).

export const SECTIONS = ["where", "when", "span", "coverage", "summary", "deeper"] as const;
export type Section = (typeof SECTIONS)[number];

export const PLACE_KINDS = ["real", "invented", "mixed", "unknown"] as const;
export type PlaceKind = (typeof PLACE_KINDS)[number];
export interface Place {
  name: string;
  kind: PlaceKind;
  /** Optional: a room, a city, a planet… */
  scale?: string;
  /** Optional: the bigger place this one is inside (by name). */
  within?: string;
  /** Optional: the same place as one of the film's Locations (shared id). */
  location_id?: string;
}
export interface WhereValue { places: Place[]; note: string; undecided?: boolean }

export const PRECISIONS = ["exact", "year", "approximate", "era", "relative", "invented", "undecided"] as const;
export type Precision = (typeof PRECISIONS)[number];
export interface Period {
  /** Her own words for the period ("2046", "the summer before the flood"). Always kept. */
  label: string;
  precision: Precision;
  /** Normalized years when the label is a calendar date (BCE as negative). */
  start_year?: number | null;
  end_year?: number | null;
}
export interface WhenValue { periods: Period[]; note: string; undecided?: boolean }

export const SPAN_BASES = ["creator", "undecided"] as const;
export interface SpanValue {
  /** Her words: "one afternoon", "ten years", "several generations". */
  text: string;
  /** Her span in years, when she gave one that converts cleanly (used only to spot a mismatch). */
  years?: number | null;
  basis: (typeof SPAN_BASES)[number];
  /** Different characters or worlds experience time differently. */
  unusual?: boolean;
}

export const COVERAGES = ["continuous", "selected", "mixed", "undecided"] as const;
export type Coverage = (typeof COVERAGES)[number];
export const COVERAGE_LABEL: Record<Coverage, string> = {
  continuous: "We follow it as it happens",
  selected: "We visit a few important moments",
  mixed: "A bit of both",
  undecided: "Not decided",
};

export interface SummaryValue { text: string }
export const DEEPER_KEYS = ["places", "chronology", "scene_timing", "travel", "rules", "time_behavior", "presentation_order"] as const;
export type DeeperKey = (typeof DEEPER_KEYS)[number];
/** The deeper details shown and offered (the Director removed the rest; anything already
 *  written in them is kept in the saved world but no longer shown or sent to partners). */
export const SHOWN_DEEPER: readonly DeeperKey[] = ["chronology", "rules"];
export const DEEPER_LABEL: Record<DeeperKey, { label: string; help: string }> = {
  places: { label: "Places and how they connect", help: "Which places sit inside others, what's near, what's far." },
  chronology: { label: "Chronology", help: "What happens when, in story order." },
  scene_timing: { label: "Scene timing", help: "Time of day, seasons, how long between scenes." },
  travel: { label: "Travel and communication", help: "How people get around and reach each other." },
  rules: { label: "World rules", help: "Anything that works differently from our world." },
  time_behavior: { label: "Unusual time", help: "Time loops, time moving differently for someone…" },
  presentation_order: { label: "Presentation order", help: "The order the audience discovers events, if it's not story order." },
};
export type DeeperValue = Partial<Record<DeeperKey, string>>;

export type SectionValue<S extends Section> =
  S extends "where" ? WhereValue : S extends "when" ? WhenValue : S extends "span" ? SpanValue :
  S extends "coverage" ? Coverage : S extends "summary" ? SummaryValue : DeeperValue;

/** Who put it there. "director" = she typed it; "conversation" = she decided it while
 *  talking with the World Builder (her own words were checked). */
export type Source = "director" | "conversation";
export type ProposalSource = "world_builder" | "story_read";
export interface Field<V> { value: V; source: Source; at: string }
export interface Proposal<V> { value: V; source: ProposalSource; at: string; why?: string }

export interface World {
  version: number;
  confirmed: { [S in Section]?: Field<SectionValue<S>> };
  proposals: { [S in Section]?: Proposal<SectionValue<S>> };
}
export const EMPTY_WORLD: World = { version: 0, confirmed: {}, proposals: {} };

// ---------------------------------------------------------------------------
// Checking values (the database repeats the essential checks)
// ---------------------------------------------------------------------------
const str = (x: unknown, max: number) => (typeof x === "string" ? x.replace(/\s+/g, " ").trim().slice(0, max) : "");
const longStr = (x: unknown, max: number) => (typeof x === "string" ? x.replace(/\r\n?/g, "\n").trim().slice(0, max) : "");
const year = (x: unknown) => (typeof x === "number" && Number.isInteger(x) && Math.abs(x) <= 100000 ? x : null);

export function cleanValue(section: Section, raw: unknown): SectionValue<Section> | null {
  const o = (raw ?? {}) as Record<string, unknown>;
  switch (section) {
    case "where": {
      const places = (Array.isArray(o.places) ? o.places : []).slice(0, 30).map((p: Record<string, unknown>) => ({
        name: str(p?.name, 120),
        kind: (PLACE_KINDS as readonly string[]).includes(p?.kind as string) ? (p.kind as PlaceKind) : "unknown",
        ...(str(p?.scale, 60) ? { scale: str(p.scale, 60) } : {}),
        ...(str(p?.within, 120) ? { within: str(p.within, 120) } : {}),
        ...(typeof p?.location_id === "string" && /^[0-9a-f-]{36}$/i.test(p.location_id) ? { location_id: p.location_id } : {}),
      })).filter((p) => p.name);
      const undecided = o.undecided === true || (!places.length && !str(o.note, 400));
      return { places, note: str(o.note, 400), ...(undecided ? { undecided: true } : {}) };
    }
    case "when": {
      const periods = (Array.isArray(o.periods) ? o.periods : []).slice(0, 12).map((p: Record<string, unknown>) => {
        const label = str(p?.label, 120);
        const precision = (PRECISIONS as readonly string[]).includes(p?.precision as string) ? (p.precision as Precision) : guessPrecision(label);
        const parsed = parseYears(label);
        const start = year(p?.start_year) ?? parsed.start;
        const end = year(p?.end_year) ?? parsed.end ?? start;
        return { label, precision, start_year: start, end_year: end };
      }).filter((p) => p.label);
      const undecided = o.undecided === true || (!periods.length && !str(o.note, 400));
      return { periods, note: str(o.note, 400), ...(undecided ? { undecided: true } : {}) };
    }
    case "span": {
      const text = str(o.text, 200);
      const basis = text && o.basis !== "undecided" ? "creator" : "undecided";
      return { text, basis, years: year(o.years) ?? spanYears(text), ...(o.unusual === true ? { unusual: true } : {}) };
    }
    case "coverage":
      return (COVERAGES as readonly string[]).includes(raw as string) ? (raw as Coverage) : null;
    case "summary": {
      const text = longStr(o.text, 600);
      return text ? { text } : null;
    }
    case "deeper": {
      const out: DeeperValue = {};
      for (const k of DEEPER_KEYS) { const v = longStr(o[k], 4000); if (v) out[k] = v; }
      return out;
    }
  }
}

// ---------------------------------------------------------------------------
// Years and spans
// ---------------------------------------------------------------------------
export function guessPrecision(label: string): Precision {
  const t = label.toLowerCase();
  if (!t || /not (sure|decided)|don'?t know|undecided/.test(t)) return "undecided";
  if (/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d{1,2},? \d{3,4}\b/.test(t)) return "exact";
  if (/\b(about|around|circa|ca\.|c\.|early|mid|late|~)\b|\d0s\b|’\d0s|'\d0s/.test(t)) return "approximate";
  if (/\b\d{3,4}\b/.test(t)) return "year";
  if (/\b(century|age|era|period|dynasty|ice age|middle ages|victorian|medieval|renaissance)\b/.test(t)) return "era";
  if (/\b(before|after|later|years? (ago|from now)|future|past|childhood|today|now)\b/.test(t)) return "relative";
  return "invented";
}

/** Calendar years in her words, when there are any: "2046" → 2046; "1990s" → 1990–1999;
 *  "300 BC" → -300. Anything else → nulls (we never guess). */
export function parseYears(label: string): { start: number | null; end: number | null } {
  const t = label.toLowerCase();
  const decade = /\b(\d{3})0'?s\b/.exec(t);
  if (decade) { const s = Number(decade[1]) * 10; return { start: s, end: s + 9 }; }
  const ys = [...t.matchAll(/\b(\d{3,4})\s*(bce|bc|ce|ad)?\b/g)].map((m) => (m[2] && m[2].startsWith("b") ? -Number(m[1]) : Number(m[1])));
  if (!ys.length) return { start: null, end: null };
  return { start: Math.min(...ys), end: Math.max(...ys) };
}

const WORD_NUM: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, hundred: 100 };
/** "ten years" → 10, "18 months" → 1.5, "a century" → 100. Vague spans → null. */
export function spanYears(text: string): number | null {
  const t = text.toLowerCase();
  const m = /\b(\d+(?:\.\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundred)\s+(year|month|week|day|decade|century|centuries)s?\b/.exec(t);
  if (!m) return null;
  const n = Number(m[1]) || WORD_NUM[m[1]];
  const per = { year: 1, month: 1 / 12, week: 1 / 52, day: 1 / 365, decade: 10, century: 100, centuries: 100 }[m[2] as "year"];
  return Math.round(n * per * 100) / 100;
}

export interface CalculatedSpan { years: number; approximate: boolean; text: string }
/** A span STUDIO can work out from her dates: only when at least two periods have
 *  calendar years. Approximate dates give an "about" span; never more precise than the dates. */
export function calculateSpan(when: WhenValue | undefined): CalculatedSpan | null {
  const ps = (when?.periods ?? []).filter((p) => p.start_year != null);
  if (ps.length < 2 && !(ps.length === 1 && ps[0].end_year != null && ps[0].end_year !== ps[0].start_year)) return null;
  const lo = Math.min(...ps.map((p) => p.start_year as number));
  const hi = Math.max(...ps.map((p) => (p.end_year ?? p.start_year) as number));
  const years = hi - lo;
  if (years <= 0) return null;
  const approximate = ps.some((p) => p.precision !== "exact" && p.precision !== "year");
  return { years, approximate, text: `${approximate ? "about " : ""}${years} ${years === 1 ? "year" : "years"}` };
}

/** Her span and her dates disagree (more than a year apart). We flag it; we never pick one. */
export function spanConflict(span: SpanValue | undefined, calc: CalculatedSpan | null): string | null {
  if (!span || span.basis !== "creator" || span.years == null || !calc || span.unusual) return null;
  const tolerance = calc.approximate ? Math.max(2, calc.years * 0.2) : 1;
  if (Math.abs(span.years - calc.years) <= tolerance) return null;
  return `You wrote "${span.text}", but your dates are ${calc.text} apart. Which is right, or do both make sense?`;
}

// ---------------------------------------------------------------------------
// Reading the world
// ---------------------------------------------------------------------------
export function placesText(w?: WhereValue): string {
  if (!w || w.undecided || !w.places.length) return "";
  const names = w.places.map((p) => p.name);
  return names.length <= 2 ? names.join(" & ") : `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}
export function periodsText(w?: WhenValue): string {
  if (!w || w.undecided || !w.periods.length) return "";
  const l = w.periods.map((p) => p.label);
  return l.length <= 2 ? l.join(" & ") : `${l.slice(0, -1).join(", ")} & ${l[l.length - 1]}`;
}

/** One plain sentence from what she has confirmed, and nothing else. Null if there's
 *  not enough to say. */
export function composeSentence(c: World["confirmed"]): string | null {
  const where = placesText(c.where?.value);
  const when = c.when?.value;
  const periods = when && !when.undecided ? when.periods.map((p) => p.label) : [];
  const span = c.span?.value?.basis === "creator" ? c.span.value.text : "";
  const cov = c.coverage?.value;
  if (!where && !periods.length) return null;
  let s = "A story";
  if (where) s += ` in ${where}`;
  if (periods.length === 1) s += `, ${/^\d/.test(periods[0]) ? "in " : ""}${periods[0]}`;
  if (periods.length === 2) s += cov === "continuous" ? `, from ${periods[0]} to ${periods[1]}` : `, seen in ${periods[0]} and again in ${periods[1]}`;
  if (periods.length > 2) s += `, across ${periods.join(", ")}`;
  if (span) s += `, spanning ${span}`;
  return `${s}.`;
}

/** Things elsewhere in the film that might need a look after she changes a confirmed
 *  setting. Suggestions to review only; nothing else is changed. */
export function reviewNotes(section: Section, before: unknown, after: unknown): string[] {
  if (before == null) return [];
  if (section === "when") {
    const a = periodsText(before as WhenValue), b = periodsText(after as WhenValue);
    if (a === b || !a) return [];
    return [`Review after a time change (${a} → ${b || "not decided"}): objects and technology in scenes and designs, and character ages if they're tied to years.`];
  }
  if (section === "where") {
    const a = placesText(before as WhereValue), b = placesText(after as WhereValue);
    if (a === b || !a) return [];
    return [`Review after a setting change (${a} → ${b || "not decided"}): Locations, scene headings and design references.`];
  }
  if (section === "span") {
    const a = (before as SpanValue).text, b = (after as SpanValue).text;
    if (a === b || !a) return [];
    return [`Review after a span change (${a} → ${b || "not decided"}): character ages and how the film shows time passing.`];
  }
  return [];
}

/** The world for the creative partners: confirmed vs suggested, never mixed. */
export function renderWorld(w: World): string {
  const c = w.confirmed, p = w.proposals;
  const line = (label: string, conf: string, prop: string) =>
    `${label}: ${conf || "(not decided)"}${prop ? ` | suggestion she hasn't accepted: ${prop}` : ""}`;
  const where = (v?: WhereValue) => v ? (v.undecided ? "not decided" : `${v.places.map((x) => x.name).join("; ")}${v.note ? ` — ${v.note}` : ""}`) : "";
  const when = (v?: WhenValue) => v ? (v.undecided ? "not decided" : `${v.periods.map((x) => `${x.label} [${x.precision}]`).join("; ")}${v.note ? ` — ${v.note}` : ""}`) : "";
  const span = (v?: SpanValue) => v ? (v.basis === "undecided" ? "not decided" : `${v.text}${v.unusual ? " (time works differently for some)" : ""}`) : "";
  const calc = calculateSpan(c.when?.value);
  const deeper = c.deeper?.value ? SHOWN_DEEPER.filter((k) => c.deeper!.value[k]).map((k) => `  ${DEEPER_LABEL[k].label}: ${c.deeper!.value[k]!.slice(0, 600)}`).join("\n") : "";
  return [
    line("Where", where(c.where?.value), where(p.where?.value as WhereValue | undefined)),
    line("When", when(c.when?.value), when(p.when?.value as WhenValue | undefined)),
    line("Time span", span(c.span?.value), span(p.span?.value as SpanValue | undefined)) + (calc ? ` (from her dates: ${calc.text})` : ""),
    line("Coverage", c.coverage ? COVERAGE_LABEL[c.coverage.value] : "", p.coverage ? COVERAGE_LABEL[p.coverage.value as Coverage] : ""),
    line("In a sentence", c.summary?.value.text ?? "", ""),
    deeper ? `Deeper notes:\n${deeper}` : "",
  ].filter(Boolean).join("\n");
}

export function isEmptyWorld(w: World) {
  return !Object.keys(w.confirmed).length && !Object.keys(w.proposals).length;
}

/** The stored row (story_world) as a World. Anything unexpected is dropped. */
export function toWorld(row: { data?: unknown; version?: number } | null | undefined): World {
  const d = (row?.data ?? {}) as { confirmed?: Record<string, unknown>; proposals?: Record<string, unknown> };
  const pick = (o: Record<string, unknown> | undefined) => {
    const out: Record<string, unknown> = {};
    for (const s of SECTIONS) if (o && o[s] && typeof o[s] === "object" && "value" in (o[s] as object)) out[s] = o[s];
    return out;
  };
  return { version: row?.version ?? 0, confirmed: pick(d.confirmed) as World["confirmed"], proposals: pick(d.proposals) as World["proposals"] };
}

export interface WorldOp { section: Section; value: unknown; her_words?: string; why?: string; reviews?: string[] }

/** The World Builder's update_world call, cleaned. "Hers" only when her cited words are in
 *  her latest message (the database checks again); otherwise a suggestion. */
export function worldOpsFromTool(input: unknown, herMessage: string, world: World | null): { ops: WorldOp[]; report: string[] } {
  const changes = ((input as { changes?: unknown[] })?.changes ?? []).slice(0, 4) as Record<string, unknown>[];
  const msg = herMessage.replace(/\s+/g, " ").toLowerCase();
  const ops: WorldOp[] = [];
  const report: string[] = [];
  for (const c of changes) {
    const section = c.section as Section;
    if (!(SECTIONS as readonly string[]).includes(section)) { report.push("Skipped: unknown section."); continue; }
    let raw = c[section];
    if (section === "summary") raw = { text: raw };
    if (section === "span") { const r = (raw ?? {}) as Record<string, unknown>; raw = { ...r, basis: r.undecided ? "undecided" : "creator" }; }
    const value = cleanValue(section, raw);
    if (value == null) { report.push(`Skipped ${section}: nothing usable.`); continue; }
    const words = typeof c.her_words === "string" ? c.her_words.replace(/\s+/g, " ").trim() : "";
    const hers = !!words && words.length <= 500 && msg.includes(words.toLowerCase());
    if (hers) {
      ops.push({ section, value, her_words: words, reviews: reviewNotes(section, world?.confirmed[section]?.value, value) });
      report.push(`${section}: recorded as her decision.`);
    } else {
      ops.push({ section, value, why: typeof c.why === "string" ? c.why.slice(0, 300) : undefined });
      report.push(`${section}: shown as a suggestion for her to accept or dismiss${words ? " (her_words weren't in her latest message)" : ""}.`);
    }
  }
  return { ops, report };
}
