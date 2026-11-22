// SERVER ONLY. Society's mood: the once-a-day shared fetch (every film reads the same public
// data, so it's fetched once). No model. Each source is independent: a failure keeps its
// earlier data, is recorded with the reason, and doesn't stop the others.
import { supabaseService } from "../supabase/server";
import { fetchPublic } from "../knowledge/fetch";
import { parseFeed } from "../knowledge/feed";
import { SERIES, SOURCES, REPORT_FEEDS, classifyReport, parseEcb, parseEurostat, parseSce, parseUmich, type Point, type SourceId } from "./sources";

const SINCE = "2015-01";
const UMICH = (f: string) => `https://www.sca.isr.umich.edu/files/${f}.csv`;
const EUROSTAT = `https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/ei_bsco_m?${[
  "format=JSON", "lang=EN", "geo=EU27_2020", "s_adj=SA", `sinceTimePeriod=${SINCE}`,
  ...SERIES.filter((s) => s.source === "ec_bcs").map((s) => `indic=${s.key}`),
].join("&")}`;
const ECB = `https://data-api.ecb.europa.eu/service/data/CES/M.Z18.ALL.T.${SERIES.filter((s) => s.source === "ecb_ces").map((s) => s.key).join("+")}.NUM_VAR.WM?startPeriod=${SINCE}&format=csvdata`;
const SCE = "https://www.newyorkfed.org/medialibrary/interactives/sce/sce/downloads/data/frbny-sce-data.xlsx";

async function get(url: string, opts: { binary?: boolean; accept?: string } = {}) {
  let last: unknown;
  for (let i = 0; i < 2; i++) {   // one retry
    try {
      const r = await fetchPublic(url, { timeoutMs: 25_000, maxBytes: 6_000_000, accept: opts.accept ?? "*/*", binary: opts.binary });
      if (r.status === 200) return r;
      last = new Error(`The source answered ${r.status}.`);
      if (r.status < 500) break;
    } catch (e) { last = e; }
    await new Promise((res) => setTimeout(res, 1500));
  }
  throw last instanceof Error ? last : new Error("The source couldn't be reached.");
}

const readers: Record<Exclude<SourceId, "polls">, () => Promise<Point[]>> = {
  umich: async () => (await Promise.all(["tbmics", "tbmiccice", "tbmpx1px5"].map(async (f) => parseUmich(f, (await get(UMICH(f), { accept: "text/csv,*/*" })).body)))).flat(),
  nyfed_sce: async () => { const r = await get(SCE, { binary: true }); return parseSce(r.bytes!); },
  ec_bcs: async () => parseEurostat(JSON.parse((await get(EUROSTAT, { accept: "application/json" })).body)),
  ecb_ces: async () => parseEcb((await get(ECB, { accept: "text/csv" })).body),
};

export interface SocietyRefresh { sources: Record<string, { ok: boolean; points?: number; reports?: number; error?: string }> }

export async function refreshSociety(): Promise<SocietyRefresh> {
  const db = supabaseService();
  const now = new Date().toISOString();
  const minPeriod = `${SINCE}-01`;
  const result: SocietyRefresh = { sources: {} };
  await db.from("society_sources").upsert(Object.entries(SOURCES).map(([id, s]) => ({ id, label: s.label })), { onConflict: "id", ignoreDuplicates: false });

  await Promise.all((Object.keys(readers) as (keyof typeof readers)[]).map(async (id) => {
    await db.from("society_sources").update({ last_attempt_at: now }).eq("id", id);
    try {
      const pts = (await readers[id]()).filter((p) => p.period >= minPeriod);
      if (!pts.length) throw new Error("The source answered, but nothing could be read from it.");
      for (let i = 0; i < pts.length; i += 500) {
        const { error } = await db.from("society_points").upsert(pts.slice(i, i + 500).map((p) => ({ ...p, source_id: id, fetched_at: now })), { onConflict: "series,period" });
        if (error) throw new Error(error.message);
      }
      const latest = pts.map((p) => p.period).sort().pop()!;
      await db.from("society_sources").update({ last_success_at: now, last_error: null, latest_period: latest }).eq("id", id);
      result.sources[id] = { ok: true, points: pts.length };
    } catch (e) {
      const msg = (e instanceof Error ? e.message : "Couldn't refresh.").slice(0, 400);
      await db.from("society_sources").update({ last_error: msg }).eq("id", id);
      result.sources[id] = { ok: false, error: msg };
    }
  }));

  // Poll reports: fixed searches, kept only when they're from a listed pollster and on a theme.
  await db.from("society_sources").update({ last_attempt_at: now }).eq("id", "polls");
  let reports = 0, failed = 0;
  for (const url of REPORT_FEEDS) {
    try {
      const r = await get(url, { accept: "application/rss+xml, application/xml;q=0.9, */*;q=0.5" });
      const feed = parseFeed(r.body, { maxItems: 60, maxContent: 200 });
      const pew = url.startsWith("https://www.pewresearch.org/");
      const rows = (feed?.items ?? []).flatMap((it) => {
        const c = classifyReport(it.title, pew ? "Pew Research Center" : undefined);
        return c && it.url ? [{ url: it.url, title: c.title, publisher: c.publisher, region: c.region, themes: c.themes, published_at: it.published_at, fetched_at: now }] : [];
      });
      if (rows.length) {
        const { error } = await db.from("society_reports").upsert(rows, { onConflict: "url", ignoreDuplicates: true });
        if (!error) reports += rows.length;
      }
    } catch { failed++; }
  }
  // Keep the list small: the last 120 days, at most 300.
  await db.from("society_reports").delete().lt("published_at", new Date(Date.now() - 120 * 86400_000).toISOString());
  const { data: extra } = await db.from("society_reports").select("id").order("published_at", { ascending: false, nullsFirst: false }).range(300, 1000);
  if (extra?.length) await db.from("society_reports").delete().in("id", extra.map((x) => x.id));
  if (failed < REPORT_FEEDS.length) await db.from("society_sources").update({ last_success_at: now, last_error: failed ? `${failed} of ${REPORT_FEEDS.length} searches failed.` : null }).eq("id", "polls");
  else await db.from("society_sources").update({ last_error: "No poll searches could be reached." }).eq("id", "polls");
  result.sources.polls = failed < REPORT_FEEDS.length ? { ok: true, reports } : { ok: false, error: "No poll searches could be reached." };
  return result;
}
