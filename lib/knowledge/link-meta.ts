// Public metadata of a saved link (title, site, author, date, description) read from the
// page's own <meta> tags. Pure (unit-tested). Only metadata is kept unless she chooses an
// excerpt she is allowed to store.
import { decodeEntities, parseDate, toPlainText } from "./feed";

export interface LinkMeta { title: string | null; site: string | null; author: string | null; published_at: string | null; description: string | null }

function meta(html: string, keys: string[]): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const k = /\s(?:property|name|itemprop)\s*=\s*("([^"]*)"|'([^']*)')/i.exec(tag);
    const key = (k?.[2] ?? k?.[3] ?? "").toLowerCase();
    if (!keys.includes(key)) continue;
    const c = /\scontent\s*=\s*("([^"]*)"|'([^']*)')/i.exec(tag);
    const v = decodeEntities(c?.[2] ?? c?.[3] ?? "").trim();
    if (v) return v;
  }
  return null;
}

export function readLinkMeta(html: string): LinkMeta {
  const head = html.slice(0, 400_000);
  const title = meta(head, ["og:title", "twitter:title"]) ?? (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1] ?? null);
  const clean = (s: string | null, max: number) => (s ? toPlainText(s, max).replace(/\s+/g, " ").trim() || null : null);
  return {
    title: clean(title, 300),
    site: clean(meta(head, ["og:site_name", "application-name"]), 200),
    author: clean(meta(head, ["author", "article:author", "parsely-author", "dc.creator"]), 300),
    published_at: parseDate(meta(head, ["article:published_time", "datepublished", "date", "dc.date", "pubdate", "parsely-pub-date"])),
    description: clean(meta(head, ["og:description", "description", "twitter:description"]), 600),
  };
}
