// Society's mood: which public surveys Studio reads, and how to read them. Pure (no network,
// no database, no model), so every parser is tested against the real formats.
//
// Every number here comes from an established public survey of people (not markets, not
// models): University of Michigan Surveys of Consumers and the New York Fed Survey of
// Consumer Expectations (US); the European Commission's consumer survey (via Eurostat) and
// the ECB Consumer Expectations Survey (EU / euro area).
import { readZip } from "../zip";
import { decodeEntities } from "../knowledge/feed";

export type Region = "US" | "EU";
export type Theme = "jobs" | "prices" | "affordability" | "wellbeing";
export const THEMES: Theme[] = ["jobs", "prices", "affordability", "wellbeing"];
export const THEME_LABEL: Record<Theme, string> = { jobs: "Jobs", prices: "Prices & inflation", affordability: "Affordability", wellbeing: "Well-being" };
export const THEME_HINT: Record<Theme, string> = {
  jobs: "How secure people feel about work: losing a job, finding one, unemployment.",
  prices: "How much inflation people see and expect.",
  affordability: "Whether people can make ends meet, keep up with payments, and afford big purchases.",
  wellbeing: "How people feel about their finances and the future overall.",
};

export type SourceId = "umich" | "nyfed_sce" | "ec_bcs" | "ecb_ces" | "polls";
export const SOURCES: Record<SourceId, { label: string; short: string; page: string; region: Region | "World" }> = {
  umich: { label: "University of Michigan, Surveys of Consumers", short: "U. Michigan", page: "https://www.sca.isr.umich.edu/", region: "US" },
  nyfed_sce: { label: "Federal Reserve Bank of New York, Survey of Consumer Expectations", short: "NY Fed SCE", page: "https://www.newyorkfed.org/microeconomics/sce", region: "US" },
  ec_bcs: { label: "European Commission Consumer Survey (Eurostat)", short: "EU Consumer Survey", page: "https://ec.europa.eu/eurostat/databrowser/view/ei_bsco_m/default/table", region: "EU" },
  ecb_ces: { label: "European Central Bank, Consumer Expectations Survey", short: "ECB CES", page: "https://www.ecb.europa.eu/stats/ecb_surveys/consumer_exp_survey/html/index.en.html", region: "EU" },
  polls: { label: "Poll reports from established pollsters", short: "Poll reports", page: "", region: "World" },
};

export interface Series { id: string; region: Region; theme: Theme; label: string; unit: "index" | "%" | "balance"; better: "up" | "down"; source: SourceId; key: string }

export const SERIES: Series[] = [
  // United States
  { id: "us.sce.job_loss", region: "US", theme: "jobs", label: "Chance of losing their job in the next year", unit: "%", better: "down", source: "nyfed_sce", key: "Job separation expectation|B" },
  { id: "us.sce.job_find", region: "US", theme: "jobs", label: "Chance of finding a job within 3 months if they lost theirs", unit: "%", better: "up", source: "nyfed_sce", key: "Job finding expectations|B" },
  { id: "us.sce.unemp_up", region: "US", theme: "jobs", label: "Chance unemployment will be higher in a year", unit: "%", better: "down", source: "nyfed_sce", key: "Unemployment Expectations|B" },
  { id: "us.umich.infl_1y", region: "US", theme: "prices", label: "Expected inflation, next 12 months (median)", unit: "%", better: "down", source: "umich", key: "tbmpx1px5|PX_MD" },
  { id: "us.sce.infl_1y", region: "US", theme: "prices", label: "Expected inflation, next 12 months (median, NY Fed)", unit: "%", better: "down", source: "nyfed_sce", key: "Inflation expectations|B" },
  { id: "us.umich.infl_5y", region: "US", theme: "prices", label: "Expected inflation, next 5 years (median)", unit: "%", better: "down", source: "umich", key: "tbmpx1px5|PX5_MD" },
  { id: "us.umich.current", region: "US", theme: "affordability", label: "Current conditions: personal finances and buying conditions", unit: "index", better: "up", source: "umich", key: "tbmiccice|ICC" },
  { id: "us.sce.delinquency", region: "US", theme: "affordability", label: "Chance of missing a minimum debt payment in 3 months", unit: "%", better: "down", source: "nyfed_sce", key: "Delinquency expectations|B" },
  { id: "us.umich.sentiment", region: "US", theme: "wellbeing", label: "Consumer sentiment", unit: "index", better: "up", source: "umich", key: "tbmics|ICS_ALL" },
  { id: "us.umich.expect", region: "US", theme: "wellbeing", label: "Expectations for the future", unit: "index", better: "up", source: "umich", key: "tbmiccice|ICE" },
  { id: "us.sce.better_off", region: "US", theme: "wellbeing", label: "Expect to be better off minus worse off in a year", unit: "balance", better: "up", source: "nyfed_sce", key: "Household financial situation|ahead" },
  // European Union / euro area
  { id: "eu.ec.unemp", region: "EU", theme: "jobs", label: "Unemployment expectations, next 12 months", unit: "balance", better: "down", source: "ec_bcs", key: "BS-UE-NY" },
  { id: "eu.ecb.unemp", region: "EU", theme: "jobs", label: "Expected unemployment rate in 12 months (euro area, median)", unit: "%", better: "down", source: "ecb_ces", key: "C4031" },
  { id: "eu.ec.prices_next", region: "EU", theme: "prices", label: "Price trends expected, next 12 months", unit: "balance", better: "down", source: "ec_bcs", key: "BS-PT-NY" },
  { id: "eu.ec.prices_last", region: "EU", theme: "prices", label: "Price trends felt, last 12 months", unit: "balance", better: "down", source: "ec_bcs", key: "BS-PT-LY" },
  { id: "eu.ecb.infl_exp", region: "EU", theme: "prices", label: "Expected inflation, next 12 months (euro area, median)", unit: "%", better: "down", source: "ecb_ces", key: "C1120" },
  { id: "eu.ecb.infl_felt", region: "EU", theme: "prices", label: "Inflation felt, last 12 months (euro area, median)", unit: "%", better: "down", source: "ecb_ces", key: "C1020" },
  { id: "eu.ec.purchases_now", region: "EU", theme: "affordability", label: "Right time to make major purchases", unit: "balance", better: "up", source: "ec_bcs", key: "BS-MP-PR" },
  { id: "eu.ec.household", region: "EU", theme: "affordability", label: "Households saving vs. running into debt", unit: "balance", better: "up", source: "ec_bcs", key: "BS-SFSH" },
  { id: "eu.ecb.income", region: "EU", theme: "affordability", label: "Expected household income growth (euro area, median)", unit: "%", better: "up", source: "ecb_ces", key: "C3220" },
  { id: "eu.ec.confidence", region: "EU", theme: "wellbeing", label: "Consumer confidence", unit: "balance", better: "up", source: "ec_bcs", key: "BS-CSMCI" },
  { id: "eu.ec.finances_next", region: "EU", theme: "wellbeing", label: "Own finances, next 12 months", unit: "balance", better: "up", source: "ec_bcs", key: "BS-FS-NY" },
  { id: "eu.ec.finances_last", region: "EU", theme: "wellbeing", label: "Own finances, last 12 months", unit: "balance", better: "up", source: "ec_bcs", key: "BS-FS-LY" },
];

export interface Point { series: string; period: string; value: number }

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const isNum = (s: string) => s.trim() !== "" && Number.isFinite(Number(s));
const period = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}-01`;

/** A tiny CSV reader (quotes, commas and newlines inside quotes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** University of Michigan "Month,YYYY,COL,…" files. */
export function parseUmich(file: string, csv: string): Point[] {
  const rows = parseCsv(csv).filter((r) => r.length > 2);
  const head = rows[0]?.map((h) => h.trim()) ?? [];
  const out: Point[] = [];
  for (const r of rows.slice(1)) {
    const m = MONTHS.indexOf(r[0]?.trim().toLowerCase() ?? "") + 1, y = Number(r[1]);
    if (!m || !Number.isInteger(y)) continue;
    for (const s of SERIES.filter((x) => x.source === "umich" && x.key.startsWith(`${file}|`))) {
      const i = head.indexOf(s.key.split("|")[1]);
      if (i >= 0 && isNum(r[i] ?? "")) out.push({ series: s.id, period: period(y, m), value: Number(r[i]) });
    }
  }
  return out;
}

/** Eurostat JSON-stat 2.0 for ei_bsco_m (one geo, several indicators). */
export function parseEurostat(json: unknown): Point[] {
  const d = json as { value?: Record<string, number>; id?: string[]; size?: number[]; dimension?: Record<string, { category: { index: Record<string, number> } }> };
  if (!d?.value || !d.id || !d.size || !d.dimension) return [];
  const byPos = d.id.map((dim) => Object.fromEntries(Object.entries(d.dimension![dim].category.index).map(([k, i]) => [i, k])) as Record<number, string>);
  const iIndic = d.id.indexOf("indic"), iTime = d.id.indexOf("time");
  if (iIndic < 0 || iTime < 0) return [];
  const out: Point[] = [];
  for (const [flat, v] of Object.entries(d.value)) {
    let n = Number(flat);
    const pos: number[] = new Array(d.size.length);
    for (let k = d.size.length - 1; k >= 0; k--) { pos[k] = n % d.size[k]; n = Math.floor(n / d.size[k]); }
    const indic = byPos[iIndic][pos[iIndic]], t = byPos[iTime][pos[iTime]];
    const s = SERIES.find((x) => x.source === "ec_bcs" && x.key === indic);
    const m = /^(\d{4})-(\d{2})$/.exec(t ?? "");
    if (s && m && Number.isFinite(v)) out.push({ series: s.id, period: period(Number(m[1]), Number(m[2])), value: v });
  }
  return out;
}

/** ECB data portal CSV (CES, euro area, weighted medians). */
export function parseEcb(csv: string): Point[] {
  const rows = parseCsv(csv);
  const h = rows[0] ?? [];
  const iKey = h.indexOf("KEY"), iT = h.indexOf("TIME_PERIOD"), iV = h.indexOf("OBS_VALUE");
  const out: Point[] = [];
  for (const r of rows.slice(1)) {
    const key = r[iKey] ?? "";
    const parts = key.split(".");
    if (parts[1] !== "M" || parts[3] !== "ALL" || parts[7] !== "WM") continue;
    const s = SERIES.find((x) => x.source === "ecb_ces" && x.key === parts[5]);
    const m = /^(\d{4})-(\d{2})$/.exec(r[iT] ?? "");
    if (s && m && isNum(r[iV] ?? "")) out.push({ series: s.id, period: period(Number(m[1]), Number(m[2])), value: Number(r[iV]) });
  }
  return out;
}

/** New York Fed SCE workbook: the named sheets, first column yyyymm. */
export async function parseSce(bytes: Uint8Array): Promise<Point[]> {
  const entries = await readZip(bytes);
  const file = (n: string) => entries.find((e) => e.name === n);
  const text = (n: string) => { const f = file(n); return f ? new TextDecoder().decode(f.bytes) : ""; };
  const shared = [...text("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => decodeEntities(m[1].replace(/<[^>]+>/g, "")));
  const wb = text("xl/workbook.xml"), rels = text("xl/_rels/workbook.xml.rels");
  const sheetFile = (name: string) => {
    const rid = new RegExp(`<sheet[^>]*name="${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*r:id="([^"]+)"`).exec(wb)?.[1];
    if (!rid) return null;
    const t = new RegExp(`<Relationship[^>]*Id="${rid}"[^>]*Target="([^"]+)"`).exec(rels)?.[1] ?? new RegExp(`<Relationship[^>]*Target="([^"]+)"[^>]*Id="${rid}"`).exec(rels)?.[1];
    return t ? (t.startsWith("/") ? t.slice(1) : `xl/${t}`) : null;
  };
  const rowsOf = (name: string) => {
    const f = sheetFile(name);
    if (!f) return [];
    const xml = text(f);
    return [...xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((r) => {
      const cells: Record<string, string> = {};
      for (const c of r[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const col = /r="([A-Z]+)\d+"/.exec(c[1])?.[1];
        const v = /<v>([\s\S]*?)<\/v>/.exec(c[2] ?? "")?.[1] ?? "";
        if (col) cells[col] = /t="s"/.test(c[1]) && v ? shared[Number(v)] ?? "" : v;
      }
      return cells;
    });
  };
  const out: Point[] = [];
  const bySheet = new Map<string, Series[]>();
  for (const s of SERIES.filter((x) => x.source === "nyfed_sce")) {
    const sheet = s.key.split("|")[0];
    bySheet.set(sheet, [...(bySheet.get(sheet) ?? []), s]);
  }
  for (const [sheet, list] of bySheet) {
    for (const r of rowsOf(sheet)) {
      const m = /^(\d{4})(\d{2})$/.exec((r.A ?? "").trim());
      if (!m) continue;
      const p = period(Number(m[1]), Number(m[2]));
      for (const s of list) {
        const col = s.key.split("|")[1];
        if (col === "ahead") {
          // Year ahead: G much worse, H somewhat worse, I same, J somewhat better, K much better.
          const v = ["G", "H", "J", "K"].map((k) => Number(r[k]));
          if (v.every(Number.isFinite)) out.push({ series: s.id, period: p, value: Math.round((v[2] + v[3] - v[0] - v[1]) * 10) / 10 });
        } else if (isNum(r[col] ?? "")) out.push({ series: s.id, period: p, value: Math.round(Number(r[col]) * 100) / 100 });
      }
    }
  }
  return out;
}

// --- Poll reports -------------------------------------------------------------------------

/** Publishers whose polls count (matched on the outlet name Google News appends). */
export const POLLSTERS: { name: RegExp; label: string; region: Region | "World" }[] = [
  { name: /^gallup( news)?$/i, label: "Gallup", region: "US" },
  { name: /^pew research center$/i, label: "Pew Research Center", region: "US" },
  { name: /^ap-?norc( center)?/i, label: "AP-NORC", region: "US" },
  { name: /^ipsos/i, label: "Ipsos", region: "World" },
  { name: /^(today\.)?yougov/i, label: "YouGov", region: "World" },
  { name: /^(federal reserve bank of new york|new york fed|liberty street economics)$/i, label: "New York Fed", region: "US" },
  { name: /^(eurobarometer|europa\.eu)$/i, label: "Eurobarometer", region: "EU" },
  { name: /^eurofound$/i, label: "Eurofound", region: "EU" },
  { name: /^(ecb|european central bank)$/i, label: "European Central Bank", region: "EU" },
];

export const THEME_WORDS: Record<Theme, RegExp> = {
  jobs: /\b(jobs?|employ\w*|unemploy\w*|layoffs?|work(ers|place)?|labou?r|wages?|career)\b/i,
  prices: /\b(inflation|prices?|cost of living|tariffs?|grocer\w*)\b/i,
  affordability: /\b(afford\w*|housing|rent|mortgage|debt|bills|cost of living|making ends meet|savings?|cut back)\b/i,
  wellbeing: /\b(well-?being|happiness|happy|life satisfaction|mental health|stress\w*|optimis\w*|pessimis\w*|confidence|mood)\b/i,
};

/** Keep a Google News / Pew headline only if it's from a listed pollster and about a theme. */
export function classifyReport(rawTitle: string, fallbackPublisher?: string): { title: string; publisher: string; region: Region | "World"; themes: Theme[] } | null {
  const m = / - ([^-]{2,80})$/.exec(rawTitle.trim());
  const outlet = (m?.[1] ?? fallbackPublisher ?? "").trim();
  const title = (m ? rawTitle.slice(0, m.index) : rawTitle).trim();
  const p = POLLSTERS.find((x) => x.name.test(outlet));
  if (!p || title.length < 12) return null;
  const themes = THEMES.filter((t) => THEME_WORDS[t].test(title));
  if (!themes.length) return null;
  // Region from the headline first (the UK isn't in the EU; G7 / global polls are world-wide).
  const eu = /\b(europe\w*|EU|euro ?zone|euro area|germany|german\w*|france|french|italy|italian\w*|spain|spanish|netherlands|dutch|poland|polish|ireland|irish)\b/i.test(title);
  const us = /\b(americans?|united states|US)\b|\bU\.S\./i.test(title.replace(/\bus\b/g, ""));
  const world = /\b(G7|G20|global\w*|world\w*|countries|nations|britain|british|UK|canad\w*|india\w*|japan\w*|china|chinese)\b/i.test(title);
  const region: Region | "World" = eu && !us ? "EU" : us && !eu ? "US" : world || eu || us ? "World" : p.region;
  return { title: title.slice(0, 500), publisher: p.label, region, themes };
}

const NEWS = "https://news.google.com/rss/search";
const q = (s: string, gl: "US" | "GB") => `${NEWS}?${new URLSearchParams({ q: `${s} when:30d`, hl: gl === "US" ? "en-US" : "en-GB", gl, ceid: `${gl}:en` })}`;
/** The fixed searches (one shared fetch each per day for every film). */
export const REPORT_FEEDS: string[] = [
  q("(site:news.gallup.com OR site:apnorc.org OR site:today.yougov.com OR site:ipsos.com) (jobs OR employment OR layoffs OR inflation OR prices)", "US"),
  q("(site:news.gallup.com OR site:apnorc.org OR site:today.yougov.com OR site:ipsos.com) (affordability OR \"cost of living\" OR wellbeing OR \"well-being\" OR happiness)", "US"),
  q("site:pewresearch.org (jobs OR inflation OR prices OR \"cost of living\" OR affordability OR wellbeing OR happiness OR economy)", "US"),
  q("(Eurobarometer OR Eurofound OR site:ipsos.com OR site:yougov.co.uk) (inflation OR \"cost of living\" OR jobs OR wellbeing OR affordability)", "GB"),
];
