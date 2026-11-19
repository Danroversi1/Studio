// Deterministic feed reading: RSS 2.0, RSS 1.0 (RDF) and Atom, plus finding a feed link in
// a web page. Pure (unit-tested), no model, no network. Feed text is untrusted data: it is
// reduced to plain text here and never treated as instructions anywhere.

export interface FeedItem {
  key: string;            // stable identity for de-duplication (guid / id / link / title+date)
  title: string;
  url: string | null;
  author: string | null;
  published_at: string | null;  // ISO, or null when the feed gives no date (unknown stays unknown)
  content: string;        // plain text summary as provided by the feed (trimmed)
}
export interface ParsedFeed { kind: "rss" | "atom" | "rdf"; title: string; site_url: string | null; items: FeedItem[] }

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** HTML or XML fragment → readable plain text (scripts/styles dropped, tags removed). */
export function toPlainText(s: string, max = 4000): string {
  const t = decodeEntities(
    s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/<(script|style|iframe|noscript)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    // Entities can encode markup ("&lt;script&gt;"): strip again after decoding.
    .replace(/<[^>]{0,200}>/g, " ")
    .replace(/[ \t\f\v\r]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

const cdata = (s: string) => s.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1");

/** Text of the first <tag> child (namespaced tags like dc:creator included). */
function child(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag.replace(":", "\\:")}(?:\\s[^>]*)?(?:/>|>([\\s\\S]*?)</${tag.replace(":", "\\:")}>)`, "i");
  const m = re.exec(xml);
  return m ? cdata(m[1] ?? "") : null;
}
function attr(tagSrc: string, name: string): string | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(tagSrc);
  return m ? decodeEntities(m[2] ?? m[3] ?? "") : null;
}
function blocks(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?</${tag}>`, "gi");
  return xml.match(re) ?? [];
}

export function parseDate(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = Date.parse(s.trim());
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  // Implausible dates are treated as unknown rather than guessed.
  if (d.getUTCFullYear() < 1900 || t > Date.now() + 2 * 86_400_000) return null;
  return d.toISOString();
}

function safeUrl(u: string | null, base?: string | null): string | null {
  if (!u) return null;
  try {
    const url = new URL(decodeEntities(u.trim()), base ?? undefined);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch { return null; }
}

function oneLine(s: string | null, max: number) {
  return toPlainText(s ?? "", max).replace(/\s+/g, " ").trim();
}

/** Parse a feed document. Returns null when it isn't RSS, RDF or Atom. */
export function parseFeed(xml: string, opts: { maxItems?: number; maxContent?: number } = {}): ParsedFeed | null {
  const max = opts.maxItems ?? 100;
  const maxContent = opts.maxContent ?? 4000;
  const src = xml.replace(/^﻿/, "").slice(0, 5_000_000);
  const isAtom = /<feed[\s>]/i.test(src) && /xmlns\s*=\s*["']http:\/\/www\.w3\.org\/2005\/Atom["']/i.test(src);
  const isRdf = /<rdf:RDF[\s>]/i.test(src);
  const isRss = /<rss[\s>]/i.test(src);
  if (!isAtom && !isRdf && !isRss) return null;

  if (isAtom) {
    const head = src.split(/<entry[\s>]/i)[0];
    const siteLink = (head.match(/<link\b[^>]*>/gi) ?? []).find((l) => !/rel\s*=\s*["'](self|hub)["']/i.test(l));
    const site = safeUrl(siteLink ? attr(siteLink, "href") : null);
    const items: FeedItem[] = blocks(src, "entry").slice(0, max).map((e) => {
      const links = e.match(/<link\b[^>]*>/gi) ?? [];
      const alt = links.find((l) => !/rel\s*=/i.test(l) || /rel\s*=\s*["']alternate["']/i.test(l)) ?? links[0];
      const url = safeUrl(alt ? attr(alt, "href") : null, site);
      const title = oneLine(child(e, "title"), 500);
      const published = parseDate(child(e, "published") ?? child(e, "updated"));
      const author = oneLine(child(child(e, "author") ?? "", "name"), 300) || null;
      const content = toPlainText(child(e, "summary") ?? child(e, "content") ?? "", maxContent);
      const id = oneLine(child(e, "id"), 500);
      return { key: id || url || `${title}|${published ?? ""}`, title: title || content.slice(0, 120) || "(untitled)", url, author, published_at: published, content };
    });
    return { kind: "atom", title: oneLine(child(head, "title"), 300), site_url: site, items: dedupe(items) };
  }

  const channel = child(src, "channel") ?? "";
  const chanHead = channel.split(/<item[\s>]/i)[0];
  const site = safeUrl(child(chanHead, "link"));
  const items: FeedItem[] = blocks(src, "item").slice(0, max).map((it) => {
    const url = safeUrl(child(it, "link"), site) ?? safeUrl(attr((it.match(/<item\b[^>]*>/i) ?? [""])[0], "rdf:about"));
    const rawTitle = oneLine(child(it, "title"), 500);
    const content = toPlainText(child(it, "description") ?? child(it, "content:encoded") ?? "", maxContent);
    const published = parseDate(child(it, "pubDate") ?? child(it, "dc:date"));
    const author = oneLine(child(it, "dc:creator") ?? child(it, "author"), 300) || null;
    const guid = oneLine(child(it, "guid"), 500);
    // Social feeds (e.g. Bluesky, Mastodon) often have no title: use the start of the post.
    const title = rawTitle || (content ? content.replace(/\s+/g, " ").slice(0, 120) : "(untitled)");
    return { key: guid || url || `${title}|${published ?? ""}`, title, url, author, published_at: published, content };
  });
  return { kind: isRdf ? "rdf" : "rss", title: oneLine(child(chanHead, "title"), 300), site_url: site, items: dedupe(items) };
}

function dedupe(items: FeedItem[]): FeedItem[] {
  const seen = new Set<string>();
  return items.filter((i) => (i.key && !seen.has(i.key) ? (seen.add(i.key), true) : false));
}

/** Feed addresses a web page advertises (<link rel="alternate" type="application/rss+xml">). */
export function discoverFeeds(html: string, pageUrl: string): string[] {
  const out: string[] = [];
  for (const tag of html.slice(0, 500_000).match(/<link\b[^>]*>/gi) ?? []) {
    const rel = (attr(tag, "rel") ?? "").toLowerCase();
    const type = (attr(tag, "type") ?? "").toLowerCase();
    if (!rel.split(/\s+/).includes("alternate")) continue;
    if (!/application\/(rss|atom|rdf)\+xml/.test(type)) continue;
    const u = safeUrl(attr(tag, "href"), pageUrl);
    if (u && !out.includes(u)) out.push(u);
  }
  return out;
}
