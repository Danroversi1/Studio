// World watches: following something in the world with FREE public sources, no model, no
// tokens. Pure (unit-tested): builds the source addresses and reads their JSON answers.
//   News:      Google News search feed (public RSS; no key) — headline, outlet, date, link.
//              (GDELT was tried first but turns away requests from shared cloud servers.)
//   Reactions: Hacker News search by Algolia (public; no key) — recent posts and comments.
// Checked once a day; each watch keeps only its newest items (see kb_trim_watch).
import { toPlainText, type FeedItem } from "./feed";

export const WATCH_LIMIT = 10;
export const PER_SOURCE = 15;
export const NEWS_SEARCH = "https://news.google.com/rss/search";
export const HN_SEARCH = "https://hn.algolia.com/api/v1/search_by_date";

/** Is this feed one of the free World watches (kept small: newest PER_SOURCE items)? */
export const isWatchFeed = (adapter: string, url: string) =>
  adapter === "hn" || (adapter === "rss" && url.startsWith(`${NEWS_SEARCH}?`));

/** Words she typed → a safe search string (letters, numbers, spaces, quotes for phrases). */
export function cleanQuery(q: string): string {
  return q.replace(/[^\p{L}\p{N}\s"'-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 200);
}

export function buildWatchFeeds(query: string, opts: { news: boolean; reactions: boolean }) {
  const q = cleanQuery(query);
  const out: { adapter: "rss" | "hn"; feed_url: string; title: string }[] = [];
  if (!q) return out;
  if (opts.news) {
    const p = new URLSearchParams({ q: `${q} when:7d`, hl: "en-US", gl: "US", ceid: "US:en" });
    out.push({ adapter: "rss", feed_url: `${NEWS_SEARCH}?${p}`, title: `News: ${q}` });
  }
  if (opts.reactions) {
    const p = new URLSearchParams({ query: q, tags: "(story,comment)", hitsPerPage: String(PER_SOURCE) });
    out.push({ adapter: "hn", feed_url: `${HN_SEARCH}?${p}`, title: `Reactions: ${q}` });
  }
  return out;
}

const safeUrl = (u: unknown) => (typeof u === "string" && /^https?:\/\//.test(u) ? u.slice(0, 2000) : null);

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
