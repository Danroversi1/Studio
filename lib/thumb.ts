// Thumbnails as crops of the treatment: a window onto part of one slide, shown live from
// Google. Nothing is copied or stored. Pure (unit-tested).
/** slide_id is the slide's permanent Google ID, so the crop stays on the same slide when
 *  slides are added, removed or reordered; slide is its number when it was chosen. */
export interface ThumbCrop { file_id: string; slide: number; slide_id?: string | null; x: number; y: number; w: number; h: number }
export type ThumbSource = { kind: "crop"; crop: ThumbCrop } | { kind: "asset"; assetId: string } | null;

/** Google Slides pages are 16:9 unless the deck says otherwise. */
export const SLIDE_ASPECT = 16 / 9;
/** Thumbnails are chosen as 4:3 windows. */
export const THUMB_ASPECT = 4 / 3;

/** A slide by permanent ID when known, otherwise by number. */
export const slideEmbedUrl = (fileId: string, slide: number, slideId?: string | null) =>
  `https://docs.google.com/presentation/d/${encodeURIComponent(fileId)}/embed?start=false&loop=false&delayms=60000&rm=minimal&slide=${
    slideId && SLIDE_ID_RE.test(slideId) ? `id.${slideId}` : slide}`;

export const SLIDE_ID_RE = /^[A-Za-z0-9_.-]{1,100}$/;

export function thumbOf(metadata: Record<string, unknown> | null | undefined): ThumbSource {
  const c = metadata?.thumbnail_crop as Partial<ThumbCrop> | undefined;
  if (c && typeof c.file_id === "string" && [c.slide, c.x, c.y, c.w, c.h].every((n) => typeof n === "number")) {
    return { kind: "crop", crop: c as ThumbCrop };
  }
  const a = metadata?.thumbnail_asset_id;
  return typeof a === "string" ? { kind: "asset", assetId: a } : null;
}

/** Where to place a slide (size and offset, in px) so the crop covers a box of cw × ch. */
export function cropPlacement(c: ThumbCrop, cw: number, ch: number) {
  const sw = Math.max(cw / c.w, (ch * SLIDE_ASPECT) / c.h);
  const sh = sw / SLIDE_ASPECT;
  const left = -c.x * sw - (c.w * sw - cw) / 2;
  const top = -c.y * sh - (c.h * sh - ch) / 2;
  return { width: sw, height: sh, left, top };
}

/** A 4:3 window (as fractions of the slide) of width w, kept inside the slide. */
export function windowOf(x: number, y: number, w: number): { x: number; y: number; w: number; h: number } {
  const ww = Math.min(1, Math.max(0.05, w));
  let hh = (ww * SLIDE_ASPECT) / THUMB_ASPECT;
  let fw = ww;
  if (hh > 1) { hh = 1; fw = (THUMB_ASPECT / SLIDE_ASPECT); }
  return { x: Math.min(Math.max(0, x), 1 - fw), y: Math.min(Math.max(0, y), 1 - hh), w: fw, h: hh };
}
