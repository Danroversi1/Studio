// Society's mood, scored: for each region and theme, 0 (as gloomy as it has been in the last
// ten years) to 10 (as upbeat as it has been). Pure and deterministic.
//
//   indicator score = 10 × share of the last 120 months where people felt worse than now
//                     (for "lower is better" questions, worse means a higher reading)
//   theme score     = average of its indicators' scores
//   direction       = better / worse / steady vs the previous month (each indicator, then a vote)
import { SERIES, THEMES, type Region, type Series, type Theme } from "./sources";

export const WINDOW_MONTHS = 120;

export interface Reading { series: Series; latest: { period: string; value: number } | null; previous: number | null; score: number | null; change: "better" | "worse" | "steady" | null }
export interface ThemeMood { region: Region; theme: Theme; score: number | null; change: "better" | "worse" | "steady" | null; latestPeriod: string | null; readings: Reading[] }

export function readingFor(s: Series, points: { period: string; value: number }[]): Reading {
  const pts = [...points].sort((a, b) => a.period.localeCompare(b.period)).slice(-WINDOW_MONTHS);
  const latest = pts[pts.length - 1] ?? null;
  if (!latest) return { series: s, latest: null, previous: null, score: null, change: null };
  const previous = pts.length > 1 ? pts[pts.length - 2].value : null;
  const worse = pts.filter((p) => (s.better === "up" ? p.value < latest.value : p.value > latest.value)).length;
  const ties = pts.filter((p) => p.value === latest.value).length - 1;
  const score = pts.length >= 12 ? Math.round(((worse + ties / 2) / (pts.length - 1 || 1)) * 100) / 10 : null;
  const tol = s.unit === "index" || s.unit === "balance" ? 0.5 : 0.1;
  const d = previous === null ? null : latest.value - previous;
  const change = d === null ? null : Math.abs(d) < tol ? "steady" : (d > 0) === (s.better === "up") ? "better" : "worse";
  return { series: s, latest, previous, score, change };
}

export function moods(byS: Map<string, { period: string; value: number }[]>, regions: Region[]): ThemeMood[] {
  const out: ThemeMood[] = [];
  for (const region of regions) for (const theme of THEMES) {
    const readings = SERIES.filter((s) => s.region === region && s.theme === theme).map((s) => readingFor(s, byS.get(s.id) ?? []));
    const scored = readings.filter((r) => r.score !== null);
    const score = scored.length ? Math.round((scored.reduce((a, r) => a + r.score!, 0) / scored.length) * 10) / 10 : null;
    const votes = readings.map((r) => r.change === "better" ? 1 : r.change === "worse" ? -1 : 0).reduce((a: number, b: number) => a + b, 0);
    const known = readings.some((r) => r.change);
    const latestPeriod = readings.map((r) => r.latest?.period ?? "").sort().pop() || null;
    out.push({ region, theme, score, change: known ? (votes > 0 ? "better" : votes < 0 ? "worse" : "steady") : null, latestPeriod, readings });
  }
  return out;
}

export function moodWord(n: number | null): string {
  if (n === null) return "No data yet";
  return n < 2 ? "Very gloomy" : n < 4 ? "Gloomy" : n < 6 ? "Mixed" : n < 8 ? "Upbeat" : "Very upbeat";
}

export const fmtValue = (s: Series, v: number) => s.unit === "%" ? `${v.toFixed(1)}%` : s.unit === "balance" ? `${v > 0 ? "+" : ""}${v.toFixed(1)}` : v.toFixed(1);
export const fmtMonth = (p: string | null) => p ? new Date(`${p}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }) : "—";

/** A compact description for the simulation (no numbers it could misquote as facts beyond these). */
export function forPrompt(ms: ThemeMood[]): { region: Region; theme: string; mood_0_10: number | null; mood: string; trend: string | null; as_of: string | null; evidence: string[] }[] {
  return ms.map((m) => ({
    region: m.region, theme: m.theme, mood_0_10: m.score, mood: moodWord(m.score), trend: m.change, as_of: m.latestPeriod?.slice(0, 7) ?? null,
    evidence: m.readings.filter((r) => r.latest).map((r) => `${r.series.label}: ${fmtValue(r.series, r.latest!.value)} (${r.latest!.period.slice(0, 7)}${r.change ? `, ${r.change} than the month before` : ""})`),
  }));
}
