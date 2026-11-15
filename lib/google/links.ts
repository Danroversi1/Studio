// Pure helpers for Google Drive / Docs links. No browser or framework imports (unit-tested).

const ID = "[A-Za-z0-9_-]{10,200}";

export type GoogleLink =
  | { kind: "doc"; id: string }
  | { kind: "slides"; id: string }
  | { kind: "file"; id: string }
  | null;

/** Recognize a Google Doc or a Drive file link and pull out its id. Anything else → null. */
export function parseGoogleLink(raw: string): GoogleLink {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase();
  if (host === "docs.google.com") {
    const m = url.pathname.match(new RegExp(`^/document/(?:u/\\d+/)?d/(${ID})(?:/|$)`));
    if (m) return { kind: "doc", id: m[1] };
    const s = url.pathname.match(new RegExp(`^/presentation/(?:u/\\d+/)?d/(${ID})(?:/|$)`));
    return s ? { kind: "slides", id: s[1] } : null;
  }
  if (host === "drive.google.com") {
    const m = url.pathname.match(new RegExp(`^/file/(?:u/\\d+/)?d/(${ID})(?:/|$)`));
    if (m) return { kind: "file", id: m[1] };
    const open = url.searchParams.get("id");
    if (url.pathname === "/open" && open && new RegExp(`^${ID}$`).test(open)) return { kind: "file", id: open };
  }
  return null;
}

export const docUrl = (id: string) => `https://docs.google.com/document/d/${id}/edit`;
/** Google's own embeddable player for a Slides deck (no autoplay). */
export const slidesEmbedUrl = (id: string) =>
  `https://docs.google.com/presentation/d/${id}/embed?start=false&loop=false&delayms=60000`;
export const driveFileUrl = (id: string) => `https://drive.google.com/file/d/${id}/view`;

/**
 * Make a Google Docs HTML export safe to show inside STUDIO: drop anything active,
 * keep text, styles and images. Operates on a parsed Document (browser DOMParser).
 * The result is also shown in a sandboxed iframe with scripts disabled.
 */
export const BLOCKED_TAGS = ["script", "iframe", "frame", "object", "embed", "link", "meta", "base", "form", "input", "button", "textarea", "select"];

export function isSafeHref(href: string): boolean {
  return /^(https?:|mailto:|#)/i.test(href.trim());
}

/** Find the HTML file and image files in an exported Docs ZIP. */
export function splitDocExport<T extends { name: string }>(entries: T[]) {
  const html = entries.find((e) => /\.html?$/i.test(e.name) && !e.name.includes("/"));
  const images = entries.filter((e) => /^images\/[^/]+$/i.test(e.name));
  return { html, images };
}
