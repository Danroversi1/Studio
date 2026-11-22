// Society's mood: reads (shared public data + the film's chosen societies). Works with the
// signed-in client (pages) or the service client (simulation).
import type { SupabaseClient } from "@supabase/supabase-js";
import { moods, type ThemeMood } from "./score";
import { SOURCES, type Region, type SourceId, type Theme } from "./sources";

export interface SocietyReport { id: string; url: string; title: string; publisher: string; region: string; themes: Theme[]; published_at: string | null }
export interface SocietySource { id: SourceId; label: string; page: string; last_attempt_at: string | null; last_success_at: string | null; last_error: string | null; latest_period: string | null; stale: boolean }

export async function getSociety(sb: SupabaseClient, projectId: string): Promise<{ regions: Region[]; moods: ThemeMood[]; reports: SocietyReport[]; sources: SocietySource[] }> {
  const since = new Date(Date.now() - 125 * 31 * 86400_000).toISOString().slice(0, 10);
  const [{ data: set }, { data: pts }, { data: reps }, { data: srcs }] = await Promise.all([
    sb.from("bubble_settings").select("society_regions").eq("project_id", projectId).maybeSingle(),
    sb.from("society_points").select("series, period, value").gte("period", since).order("period").limit(5000),
    sb.from("society_reports").select("id, url, title, publisher, region, themes, published_at").order("published_at", { ascending: false, nullsFirst: false }).limit(40),
    sb.from("society_sources").select("id, label, last_attempt_at, last_success_at, last_error, latest_period"),
  ]);
  const regions = ((set?.society_regions as Region[] | undefined) ?? ["US", "EU"]).filter((r) => r === "US" || r === "EU");
  const byS = new Map<string, { period: string; value: number }[]>();
  for (const p of (pts ?? []) as { series: string; period: string; value: number }[]) {
    if (!byS.has(p.series)) byS.set(p.series, []);
    byS.get(p.series)!.push({ period: p.period, value: Number(p.value) });
  }
  const reports = ((reps ?? []) as SocietyReport[]).filter((r) => r.region === "World" || regions.includes(r.region as Region)).slice(0, 25);
  const sources = ((srcs ?? []) as Omit<SocietySource, "page" | "stale">[]).filter((s) => s.id in SOURCES).map((s) => ({
    ...s, page: SOURCES[s.id].page, stale: !s.last_success_at || Date.now() - Date.parse(s.last_success_at) > 3 * 86400_000 || !!s.last_error,
  }));
  return { regions, moods: moods(byS, regions), reports, sources };
}
export type Society = Awaited<ReturnType<typeof getSociety>>;
