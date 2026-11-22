// BROWSER. Turns a character's treatment thumbnail (a live window onto a Google Slides slide)
// into a stored picture: Google renders the slide for her own Google sign-in, her browser
// crops the same window she chose, and the crop uploads as the character's artwork. No AI.
import { GoogleAccessError, SLIDES_MIME, googleConfig, listSlides, slidePictureUrl, withFilePermission } from "./google/client";
import type { ThumbCrop } from "./thumb";

/** Crop window → pixel rectangle on a rendered slide of iw × ih. */
export function cropRect(c: Pick<ThumbCrop, "x" | "y" | "w" | "h">, iw: number, ih: number) {
  const x = Math.round(Math.max(0, Math.min(1, c.x)) * iw), y = Math.round(Math.max(0, Math.min(1, c.y)) * ih);
  return { x, y, w: Math.max(1, Math.min(iw - x, Math.round(c.w * iw))), h: Math.max(1, Math.min(ih - y, Math.round(c.h * ih))) };
}

export async function treatmentCropPicture(crop: ThumbCrop): Promise<Blob> {
  const cfg = googleConfig();
  if (!cfg) throw new Error("Google isn't set up for this Studio, so treatment pictures can't be fetched.");
  const url = await withFilePermission(cfg, crop.file_id, SLIDES_MIME, "Select your treatment so STUDIO can use its pictures", async (t) => {
    let page = crop.slide_id ?? null;
    if (!page) page = (await listSlides(t, crop.file_id))[crop.slide - 1]?.id ?? null;
    if (!page) throw new GoogleAccessError(404, "That slide isn't in the treatment any more. Choose the thumbnail again on the character's page.");
    return slidePictureUrl(t, crop.file_id, page);
  });
  const res = await fetch("/api/google/slide-picture", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "The slide picture couldn't be fetched.");
  const bmp = await createImageBitmap(await res.blob());
  const r = cropRect(crop, bmp.width, bmp.height);
  const canvas = document.createElement("canvas");
  canvas.width = r.w; canvas.height = r.h;
  canvas.getContext("2d")!.drawImage(bmp, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  return new Promise((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error("The picture couldn't be made."))), "image/png"));
}
