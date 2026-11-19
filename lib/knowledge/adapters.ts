// Updating-source adapters. Every adapter answers the same questions, so new integrations
// plug in the same way. Pure (unit-tested): this decides what an address IS; the network
// happens in refresh.ts.
//
// Supported today (checked against each platform's public documentation/behavior,
// 2026-11-19): standard RSS/Atom/RDF feeds, Bluesky public profile feeds
// (bsky.app/profile/<handle>/rss), and Mastodon public profile/hashtag feeds
// (<server>/@user.rss, /tags/<tag>.rss). These need no sign-in and are offered by the
// platforms for exactly this use. Anything else is reported honestly instead of scraped.

export type AdapterId = "rss" | "bluesky" | "mastodon";

export interface AdapterMatch {
  adapter: AdapterId;
  /** Addresses to try in order (a feed URL, or the page that advertises one). */
  candidates: string[];
  label: string;
}
export interface Unsupported {
  adapter: null;
  status: "needs_authorization" | "unsupported";
  service: string;
  reason: string;
}

export const ADAPTERS: Record<AdapterId, { label: string; how: string }> = {
  rss: { label: "News or blog feed (RSS/Atom)", how: "Reads the site's public feed." },
  bluesky: { label: "Bluesky profile", how: "Reads the public RSS feed Bluesky publishes for each profile (original posts, no replies)." },
  mastodon: { label: "Mastodon profile or hashtag", how: "Reads the public RSS feed Mastodon publishes (public posts only)." },
};

// Services that don't offer a public feed for this use. We never scrape them.
const CLOSED: { re: RegExp; service: string; status: Unsupported["status"]; reason: string }[] = [
  { re: /(^|\.)(x|twitter)\.com$/i, service: "X (Twitter)", status: "needs_authorization", reason: "X only offers posts through its paid, signed-in API. Studio isn't connected to it, so this is saved as a link." },
  { re: /(^|\.)instagram\.com$/i, service: "Instagram", status: "needs_authorization", reason: "Instagram doesn't offer a public feed; reading it needs a business account connection Studio doesn't have." },
  { re: /(^|\.)facebook\.com$/i, service: "Facebook", status: "needs_authorization", reason: "Facebook pages need a signed-in connection Studio doesn't have." },
  { re: /(^|\.)threads\.(net|com)$/i, service: "Threads", status: "unsupported", reason: "Threads doesn't publish a public feed." },
  { re: /(^|\.)tiktok\.com$/i, service: "TikTok", status: "unsupported", reason: "TikTok doesn't publish a public feed." },
  { re: /(^|\.)linkedin\.com$/i, service: "LinkedIn", status: "needs_authorization", reason: "LinkedIn needs a signed-in connection Studio doesn't have." },
];

export function normalizeUrl(input: string): URL | null {
  let s = input.trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (!u.hostname.includes(".")) return null;
    u.hash = "";
    return u;
  } catch { return null; }
}

/** What kind of updating source an address is, and where its feed should be. */
export function detectSource(input: string): AdapterMatch | Unsupported | null {
  const u = normalizeUrl(input);
  if (!u) return null;
  const host = u.hostname.toLowerCase();
  for (const c of CLOSED) if (c.re.test(host)) return { adapter: null, status: c.status, service: c.service, reason: c.reason };

  if (host === "bsky.app") {
    const m = /^\/profile\/([^/]+)(\/rss)?\/?$/.exec(u.pathname);
    if (m) return { adapter: "bluesky", label: `Bluesky · ${decodeURIComponent(m[1])}`, candidates: [`https://bsky.app/profile/${m[1]}/rss`] };
    return { adapter: null, status: "unsupported", service: "Bluesky", reason: "Only Bluesky profile pages have a public feed. Paste a profile address (bsky.app/profile/…)." };
  }
  // Mastodon-style addresses: /@user, /@user.rss, /tags/x, /tags/x.rss on any server.
  const masto = /^\/(@[A-Za-z0-9_]+)(?:\.rss)?\/?$/.exec(u.pathname) ?? /^\/(tags\/[^/.]+)(?:\.rss)?\/?$/.exec(u.pathname);
  if (masto) {
    return { adapter: "mastodon", label: `Mastodon · ${masto[1]}@${host}`, candidates: [`${u.origin}/${masto[1]}.rss`] };
  }
  return { adapter: "rss", label: host.replace(/^www\./, ""), candidates: [u.toString()] };
}
