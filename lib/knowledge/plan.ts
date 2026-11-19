// Turning what she types into World watches, deterministically (no AI, no tokens).
// The free sources match every word, so a sentence like "find news about AI, chips and
// the economy" finds nothing. Here it becomes separate topics; "the cities in the story"
// becomes each real city from World & Time. She sees the plan and confirms it. Pure.
import { NEWS_SEARCH, HN_SEARCH, PER_SOURCE, cleanQuery } from "./watch";
import { weatherUrl } from "./weather";

export interface WatchTopic {
  label: string;          // what she sees, and the watch's name
  news: string | null;    // Google News query (supports quotes, OR, parentheses)
  reactions: string | null; // Hacker News query (plain words; null = not useful there)
  weather?: string | null;  // a city whose daily weather report to bring in (Open-Meteo)
}
const WEATHER_WORDS = /^(weather|forecast|forecasts|weather reports?|temperature)$/i;

const LEAD = [
  /^(please\s+)?(can you\s+|could you\s+)?(find|search( for)?|look( for| up)?|get|follow|show( me)?|track|watch|tell me( about)?|i want( to)?( know)?( about)?|give me)\s+(me\s+)?/i,
  /^(all\s+)?(the\s+)?(latest\s+|recent\s+)?(news|stories|articles|headlines|updates|information|info)\s*/i,
  /^(about|on|for|regarding|related to|around)\s+/i,
  /^(the\s+following|these|this)\s*:?\s*/i,
];
const CITY_REF = /\b(for|in|of|from|around)?\s*(each\s+of\s+|every\s+|all\s+(of\s+)?)?(the\s+)?(cities|city|places|locations)(\s+(in|of|from)\s+(the|my|our)\s+(story|film|movie|world))?\b/i;
const quote = (s: string) => (/\s/.test(s) ? `"${s}"` : s);
const words = (s: string) => s.split(/\s+(?:and|&|or|\+)\s+|\s*\/\s*/i).map((w) => cleanQuery(w).replace(/^(the|a|an)\s+/i, "")).filter((w) => w.length >= 2);

function stripLead(s: string): string {
  let out = s.trim();
  for (let i = 0; i < 3; i++) for (const re of LEAD) out = out.replace(re, "");
  return out.replace(/[.!?]+$/, "").trim();
}

export function planWatches(prompt: string, cities: string[]): WatchTopic[] {
  const text = stripLead((prompt ?? "").replace(/\r\n?/g, "\n"));
  const parts = text.split(/[,;\n•]+|:\s+/).map((p) => stripLead(p)).filter(Boolean);
  const out: WatchTopic[] = [];
  const add = (t: WatchTopic) => { if (t.label.length >= 2 && !out.some((x) => x.label.toLowerCase() === t.label.toLowerCase())) out.push({ ...t, label: t.label.slice(0, 200) }); };
  for (const part of parts) {
    if (CITY_REF.test(part)) {
      const local = /\b(news|updates|stories|headlines)\b/i.test(part);
      const rest = part.replace(CITY_REF, " ").replace(/\blocal\b/gi, " ").replace(/\b(news|updates|stories|headlines)\b/gi, " ")
        .replace(/\s+/g, " ").trim().replace(/^(and|&|or|\+)\s+|\s+(and|&|or|\+)$/gi, "").trim();
      const all = words(rest);
      const weather = all.some((w) => WEATHER_WORDS.test(w));
      const what = all.filter((w) => !WEATHER_WORDS.test(w));
      for (const city of cities.map((c) => cleanQuery(c)).filter(Boolean)) {
        if (!all.length) { add({ label: `${city}: local news`, news: quote(city), reactions: null }); continue; }
        const label = [local ? "local news" : "", ...all].filter(Boolean).join(", ").replace(/, ([^,]*)$/, " and $1");
        // Local news already covers the rest; otherwise search for what she named.
        const news = local ? quote(city) : what.length ? `${quote(city)} ${what.length > 1 ? `(${what.map(quote).join(" OR ")})` : quote(what[0])}` : null;
        add({ label: `${city}: ${label}`, news, reactions: null, weather: weather ? city : null });
      }
      continue;
    }
    const w = words(part);
    if (!w.length) continue;
    add({ label: w.join(" and "), news: w.length > 1 ? w.map(quote).join(" OR ") : quote(w[0]), reactions: w.length === 1 ? w[0] : null });
  }
  return out;
}

/** The free sources for one topic (same shape the watch RPC checks). */
export function feedsForTopic(t: WatchTopic, opts: { news: boolean; reactions: boolean; weatherAt?: { lat: number; lon: number } | null }) {
  const feeds: { adapter: "rss" | "hn" | "weather"; feed_url: string; title: string }[] = [];
  if (t.weather && opts.weatherAt) feeds.push({ adapter: "weather", feed_url: weatherUrl(opts.weatherAt.lat, opts.weatherAt.lon), title: `Weather: ${t.weather}` });
  if (opts.news && t.news) feeds.push({ adapter: "rss", feed_url: `${NEWS_SEARCH}?${new URLSearchParams({ q: `${t.news} when:7d`, hl: "en-US", gl: "US", ceid: "US:en" })}`, title: `News: ${t.label}` });
  if (opts.reactions && t.reactions) feeds.push({ adapter: "hn", feed_url: `${HN_SEARCH}?${new URLSearchParams({ query: t.reactions, tags: "(story,comment)", hitsPerPage: String(PER_SOURCE) })}`, title: `Reactions: ${t.label}` });
  return feeds;
}
