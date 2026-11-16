// BROWSER. Add an image to Look & Feel: the original plus a small browsing copy, both through
// Studio's existing private upload flow. If the same picture is already in the film, it is
// reused instead of stored again. No model is involved.
import { uploadImage } from "../storyboard/upload";

export async function sha256(file: Blob): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function loadBitmap(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { resolve(img); URL.revokeObjectURL(url); };
    img.onerror = () => { reject(new Error("This file isn't an image STUDIO can open.")); URL.revokeObjectURL(url); };
    img.src = url;
  });
}

/** A JPEG at most `max` px on its long side (white behind transparency). */
export async function makeThumbnail(file: Blob, max = 480): Promise<Blob> {
  const img = await loadBitmap(file);
  const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(img.naturalWidth * s)); c.height = Math.max(1, Math.round(img.naturalHeight * s));
  const g = c.getContext("2d")!;
  g.fillStyle = "#ffffff"; g.fillRect(0, 0, c.width, c.height);
  g.imageSmoothingQuality = "high";
  g.drawImage(img, 0, 0, c.width, c.height);
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't make a preview."))), "image/jpeg", 0.85));
}

export type Step = "checking" | "uploading" | "preview" | "done";

export async function addLookImage(opts: {
  file: File; ownerEntityId: string;
  find: (sha: string) => Promise<{ assetId: string | null; thumbAssetId: string | null }>;
  onStep?: (s: Step) => void;
}): Promise<{ assetId: string; thumbAssetId: string | null; reused: boolean }> {
  const { file } = opts;
  if (!/^image\/(png|jpeg)$/.test(file.type)) throw new Error(`${file.name}: use a PNG or JPEG image.`);
  opts.onStep?.("checking");
  const hash = await sha256(file);
  const found = await opts.find(hash);
  if (found.assetId) {
    let thumb = found.thumbAssetId;
    if (!thumb) { opts.onStep?.("preview"); thumb = await uploadImage(opts.ownerEntityId, await makeThumbnail(file), `thumb-${file.name.replace(/\.\w+$/, "")}.jpg`).catch(() => null); }
    return { assetId: found.assetId, thumbAssetId: thumb, reused: true };
  }
  opts.onStep?.("uploading");
  const assetId = await uploadImage(opts.ownerEntityId, file, file.name);
  opts.onStep?.("preview");
  const thumbAssetId = await uploadImage(opts.ownerEntityId, await makeThumbnail(file), `thumb-${file.name.replace(/\.\w+$/, "")}.jpg`).catch(() => null);
  opts.onStep?.("done");
  return { assetId, thumbAssetId, reused: false };
}

/** Pixels of an image in this film (same origin), scaled to at most `max` px. */
export function loadPixels(assetId: string, max = 320): Promise<{ data: Uint8ClampedArray; w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.naturalWidth * s)); c.height = Math.max(1, Math.round(img.naturalHeight * s));
      const g = c.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(img, 0, 0, c.width, c.height);
      try { resolve({ data: g.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height }); }
      catch { reject(new Error("This image can't be read for colors.")); }
    };
    img.onerror = () => reject(new Error("The image didn't load."));
    img.src = `/api/assets/${assetId}`;
  });
}
