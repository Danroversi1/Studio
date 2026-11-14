// Deterministic artwork validation. No framework imports, so it is unit-testable.

export const MAX_ARTWORK_BYTES = 50 * 1024 * 1024; // keep in sync with begin_asset_upload()
export const ALLOWED_ARTWORK_TYPES = ["image/png", "image/jpeg"] as const;
export type ArtworkMime = (typeof ALLOWED_ARTWORK_TYPES)[number];

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Identify PNG/JPEG from the file's first bytes; ignores names and declared types. */
export function sniffImageType(head: Uint8Array): ArtworkMime | null {
  if (head.length >= 8 && PNG_SIGNATURE.every((b, i) => head[i] === b)) return "image/png";
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  return null;
}

export interface UploadIntent {
  entityId: string;
  fileName: string;
  mimeType: ArtworkMime;
  byteSize: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validate what the browser says it is about to upload (first, cheap check). */
export function validateUploadIntent(input: unknown): ValidationResult<UploadIntent> {
  if (typeof input !== "object" || input === null) return { ok: false, error: "Missing upload details." };
  const { entityId, fileName, mimeType, byteSize } = input as Record<string, unknown>;
  if (typeof entityId !== "string" || !UUID.test(entityId)) return { ok: false, error: "Unknown item." };
  if (typeof fileName !== "string" || fileName.trim().length === 0 || fileName.length > 255)
    return { ok: false, error: "The file needs a name." };
  if (typeof mimeType !== "string" || !(ALLOWED_ARTWORK_TYPES as readonly string[]).includes(mimeType))
    return { ok: false, error: "Export your artwork from Procreate as PNG or JPEG." };
  if (typeof byteSize !== "number" || !Number.isInteger(byteSize) || byteSize <= 0)
    return { ok: false, error: "The file is empty." };
  if (byteSize > MAX_ARTWORK_BYTES) return { ok: false, error: "Artwork must be 50 MB or smaller." };
  return { ok: true, value: { entityId, fileName: fileName.trim(), mimeType: mimeType as ArtworkMime, byteSize } };
}

export interface StoredObjectFacts {
  size: number;
  head: Uint8Array;
}

/**
 * Second, authoritative check against the object actually stored. Run server-side
 * before calling complete_asset_upload().
 */
export function verifyStoredObject(
  declared: { mimeType: string; byteSize: number },
  stored: StoredObjectFacts | null,
): ValidationResult<{ mimeType: ArtworkMime; byteSize: number }> {
  if (!stored) return { ok: false, error: "The upload did not finish. Please try again." };
  if (stored.size !== declared.byteSize)
    return { ok: false, error: "The uploaded file is a different size than expected. Please try again." };
  const sniffed = sniffImageType(stored.head);
  if (!sniffed) return { ok: false, error: "That file is not a PNG or JPEG image." };
  if (sniffed !== declared.mimeType)
    return { ok: false, error: `The file is really a ${sniffed === "image/png" ? "PNG" : "JPEG"}; please re-upload it.` };
  return { ok: true, value: { mimeType: sniffed, byteSize: stored.size } };
}
