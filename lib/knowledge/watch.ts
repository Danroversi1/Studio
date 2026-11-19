// World watches: following something in the world with FREE public sources, no model, no
// tokens. Pure (unit-tested): builds the source addresses and reads their JSON answers.
//   News:      GDELT DOC 2.0 API (open global news index; no key) — titles, links, outlet, date first seen.
//   Reactions: Hacker News search by Algolia (public; no key) — recent posts and comments.
// Checked once a day; each watch keeps only its newest items (see kb_trim_watch).
import { toPlainText, type FeedItem } from "./feed";

export const WATCH_LIMIT = 10;
export const PER_SOURCE = 15;

/** Words she typed → a safe search string (letters, numbers, spaces, quotes for phrases). */
export function cleanQuery(q: string): string {
  return q.replace(/[^\p{L}\p{N}\s"'-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 200);
}

export function buildWatchFeeds(query: string, opts: { news: boolean; reactions: boolean }) {
  const q = cleanQuery(query);
  const out: { adapter: "gdelt" | "hn"; feed_url: string; title: string }[] = [];
  if (!q) return out;
  if (opts.news) {
    const p = new URLSearchParams({ query: `${q} sourcelang:english`, mode: "ArtList", format: "json", maxrecords: String(PER_SOURCE), sort: "DateDesc", timespan: "1w" });
    out.push({ adapter: "gdelt", feed_url: `https://api.gdeltproject.org/api/v2/doc/doc?${p}`, title: `News: ${q}` });
  }
  if (opts.reactions) {
    const p = new URLSearchParams({ query: q, tags: "(story,comment)", hitsPerPage: String(PER_SOURCE) });
    out.push({ adapter: "hn", feed_url: `https://hn.algolia.com/api/v1/search_by_date?${p}`, title: `Reactions: ${q}` });
  }
  return out;
}

const safeUrl = (u: unknown) => (typeof u === "string" && /^https?:\/\//.test(u) ? u.slice(0, 2000) : null);

/** GDELT "seendate" is like 20261118T094500Z (when the index first saw the article). */
export function gdeltDate(s: unknown): string | null {
  const m = typeof s === "string" ? /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s) : null;
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
  return Number.isFinite(d.getTime()) && d.getTime() <= Date.now() + 86_400_000 ? d.toISOString() : null;
}

export function parseGdelt(body: string): FeedItem[] | { error: string } {
  let j: { articles?: { url?: string; title?: string; seendate?: string; domain?: string; sourcecountry?: string; language?: string }[] };
  try { j = JSON.parse(body); } catch {
    // GDELT answers problems as plain text (e.g. a phrase that's too short).
    return { error: `The news index said: ${toPlainText(body, 200) || "no answer"}` };
  }
  const seen = new Set<string>();
  return (j.articles ?? []).flatMap((a) => {
    const url = safeUrl(a.url);
    if (!url || seen.has(url) || !a.title) return [];
    seen.add(url);
    return [{ key: url, title: toPlainText(a.title, 400).replace(/\s+/g, " "), url, author: null, published_at: gdeltDate(a.seendate),
      content: [a.domain, a.sourcecountry].filter(Boolean).join(" · ") }];
  }).slice(0, PER_SOURCE);
}

export function parseHn(body: string): FeedItem[] | { error: string } {
  let j: { hits?: { objectID?: string; created_at?: string; title?: string | null; url?: string | null; author?: string; story_title?: string | null;
    story_url?: string | null; comment_text?: string | null; story_text?: string | null }[] };
  try { j = JSON.parse(body); } catch { return { error: "The discussion search didn't answer properly." }; }
  return (j.hits ?? []).flatMap((h) => {
    if (!h.objectID || !/^\d+$/.test(h.objectID)) return [];
    const isComment = !h.title;
    const text = toPlainText(h.comment_text ?? h.story_text ?? "", 600).replace(/\s+/g, " ");
    const about = h.story_title ? toPlainText(h.story_title, 200) : "";
    const title = isComment ? `${h.author ?? "Someone"} on "${about || "a discussion"}"` : toPlainText(h.title ?? "", 300);
    const link = safeUrl(h.url ?? h.story_url);
    return [{ key: `hn:${h.objectID}`, title: title.slice(0, 400), url: `https://news.ycombinator.com/item?id=${h.objectID}`, author: h.author ?? null,
      published_at: h.created_at && Number.isFinite(Date.parse(h.created_at)) ? new Date(h.created_at).toISOString() : null,
      content: [text, link ? `About: ${link}` : ""].filter(Boolean).join("\n") }];
  }).slice(0, PER_SOURCE);
}
