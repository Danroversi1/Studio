// Reads a Google Slides deck's slide list (each slide's permanent ID and its label text)
// from the deck's public embed page, the same page the thumbnails show. Works for decks
// shared "anyone with the link can view"; no sign-in, no Slides API, no AI. Pure parser.
import type { SlideInfo } from "../slide-match";

const unescapeJs = (s: string) =>
  s.replace(/\\x([0-9a-f]{2})/gi, (_, c) => String.fromCharCode(parseInt(c, 16)))
   .replace(/\\u([0-9a-f]{4})/gi, (_, c) => String.fromCharCode(parseInt(c, 16)))
   .replace(/\\\//g, "/");
const unescapeHtml = (s: string) =>
  s.replace(/&#xa;/gi, "\n").replace(/&#x([0-9a-f]+);/gi, (_, c) => String.fromCodePoint(parseInt(c, 16)))
   .replace(/&#(\d+);/g, (_, c) => String.fromCodePoint(Number(c)))
   .replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

export function parseEmbedSlides(html: string): SlideInfo[] {
  // The viewer lists slides in order as ["<id>",<index>,"",...].
  const order: string[] = [];
  for (const m of html.matchAll(/\["([A-Za-z0-9_.-]{1,100})",(\d{1,3}),""/g)) {
    if (Number(m[2]) === order.length) order.push(m[1]);
  }
  if (!order.length) return [];
  const h = unescapeJs(html);
  const starts = order.map((id) => h.indexOf(`id="${id}"`));
  return order.map((id, i) => {
    const from = starts[i];
    if (from < 0) return { id, text: "" };
    const next = starts.slice(i + 1).find((s) => s > from);
    const seg = h.slice(from, next ?? from + 60000);
    const labels = [...seg.matchAll(/aria-label="([^"]*)"/g)].map((m) => unescapeHtml(m[1]).trim())
      .filter((t) => t && !/\.(png|jpe?g|gif|webp)$/i.test(t) && !/^⌘/.test(t) && t.length > 1);
    return { id, text: [...new Set(labels)].join("\n").slice(0, 300) };
  });
}
