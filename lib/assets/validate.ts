// Deterministic artwork validation. No framework imports, so it is unit-testable.

export const MAX_ARTWORK_BYTES = 50 * 1024 * 1024; // keep in sync with begin_asset_upload()
export const ALLOWED_ARTWORK_TYPES = ["image/png", "image/jpeg"] as const;
// Research documents: accepted by the database only for the Knowledge Base (begin_asset_upload).
export const DOCUMENT_TYPES = ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/plain", "text/markdown"] as const;
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
export type ArtworkMime = (typeof ALLOWED_ARTWORK_TYPES)[number];
export type DocumentMime = (typeof DOCUMENT_TYPES)[number];
export type UploadMime = ArtworkMime | DocumentMime;

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Identify PNG/JPEG from the file's first bytes; ignores names and declared types. */
export function sniffImageType(head: Uint8Array): ArtworkMime | null {
  if (head.length >= 8 && PNG_SIGNATURE.every((b, i) => head[i] === b)) return "image/png";
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  return null;
}

/** PDF and .docx by signature; text by the absence of binary bytes at the start. */
export function sniffDocument(head: Uint8Array, declared: string): DocumentMime | null {
  const ascii = String.fromCharCode(...head.slice(0, 8));
  if (declared === "application/pdf") return ascii.startsWith("%PDF-") ? "application/pdf" : null;
  if (declared === DOCUMENT_TYPES[1]) return head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04 ? DOCUMENT_TYPES[1] : null;
  if (declared === "text/plain" || declared === "text/markdown") {
    if (sniffImageType(head) || ascii.startsWith("%PDF-") || (head[0] === 0x50 && head[1] === 0x4b)) return null;
    return head.every((b) => b !== 0) ? declared as DocumentMime : null;
  }
  return null;
}

export interface UploadIntent {
  entityId: string;
  fileName: string;
  mimeType: UploadMime;
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
  if (typeof mimeType !== "string" || ![...ALLOWED_ARTWORK_TYPES, ...DOCUMENT_TYPES].includes(mimeType as never))
    return { ok: false, error: "Export your artwork from Procreate as PNG or JPEG." };
  if ((DOCUMENT_TYPES as readonly string[]).includes(mimeType) && typeof byteSize === "number" && byteSize > MAX_DOCUMENT_BYTES)
    return { ok: false, error: "Documents must be 20 MB or smaller." };
  if (typeof byteSize !== "number" || !Number.isInteger(byteSize) || byteSize <= 0)
    return { ok: false, error: "The file is empty." };
  if (byteSize > MAX_ARTWORK_BYTES) return { ok: false, error: "Artwork must be 50 MB or smaller." };
  return { ok: true, value: { entityId, fileName: fileName.trim(), mimeType: mimeType as UploadMime, byteSize } };
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
): ValidationResult<{ mimeType: UploadMime; byteSize: number }> {
  if (!stored) return { ok: false, error: "The upload did not finish. Please try again." };
  if (stored.size !== declared.byteSize)
    return { ok: false, error: "The uploaded file is a different size than expected. Please try again." };
  if ((DOCUMENT_TYPES as readonly string[]).includes(declared.mimeType)) {
    const doc = sniffDocument(stored.head, declared.mimeType);
    if (!doc) return { ok: false, error: "That file isn't the kind of document it says it is." };
    return { ok: true, value: { mimeType: doc, byteSize: stored.size } };
  }
  const sniffed = sniffImageType(stored.head);
  if (!sniffed) return { ok: false, error: "That file is not a PNG or JPEG image." };
  if (sniffed !== declared.mimeType)
    return { ok: false, error: `The file is really a ${sniffed === "image/png" ? "PNG" : "JPEG"}; please re-upload it.` };
  return { ok: true, value: { mimeType: sniffed, byteSize: stored.size } };
}
