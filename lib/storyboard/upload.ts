// BROWSER. Upload an image (file or a rendered canvas) through Studio's existing private
// upload flow: reserve → PUT to a signed URL → server verifies the stored bytes. Storage is
// in the cloud (R2); this is not a model call.
async function readError(res: Response) {
  try { return ((await res.json()) as { error?: string }).error ?? `Upload failed (${res.status}).`; } catch { return `Upload failed (${res.status}).`; }
}

export async function uploadImage(entityId: string, file: Blob, fileName: string): Promise<string> {
  const mimeType = file.type === "image/jpeg" ? "image/jpeg" : file.type === "image/png" ? "image/png" : "";
  if (!mimeType) throw new Error(`${fileName}: use a PNG or JPEG image (PNG keeps transparency).`);
  const reserve = await fetch("/api/assets", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entityId, fileName, mimeType, byteSize: file.size }),
  });
  if (!reserve.ok) throw new Error(await readError(reserve));
  const { assetId, upload } = (await reserve.json()) as { assetId: string; upload: { url: string; method: string; headers: Record<string, string> } };
  const put = await fetch(upload.url, { method: upload.method, headers: upload.headers, body: file });
  if (!put.ok) throw new Error(`${fileName}: the upload was interrupted. Please try again.`);
  const fin = await fetch(`/api/assets/${assetId}/complete`, { method: "POST" });
  if (!fin.ok) throw new Error(`${fileName}: ${await readError(fin)}`);
  return assetId;
}

/** Natural size of an image file, to place it with the right proportions. */
export function imageSize(file: Blob): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { resolve({ w: img.naturalWidth, h: img.naturalHeight }); URL.revokeObjectURL(url); };
    img.onerror = () => { resolve({ w: 1, h: 1 }); URL.revokeObjectURL(url); };
    img.src = url;
  });
}
