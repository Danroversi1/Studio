// Minimal ZIP reader for Google Docs "Web page (zipped)" exports. Runs in the browser
// (and Node 18+ for tests) using DecompressionStream; no dependencies. Supports the two
// methods Google uses: stored (0) and deflate (8). Refuses anything unusual.

export interface ZipEntry {
  name: string;
  bytes: Uint8Array;
}

const MAX_ENTRIES = 500;
const MAX_ENTRY_BYTES = 60 * 1024 * 1024;

async function inflateRaw(data: Uint8Array, expected: number): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const out = new Uint8Array(await new Response(stream).arrayBuffer());
  if (out.length !== expected) throw new Error("ZIP entry has the wrong size.");
  return out;
}

export async function readZip(buf: Uint8Array): Promise<ZipEntry[]> {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // Find the end-of-central-directory record (last 22..65557 bytes).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Not a ZIP file.");
  const count = view.getUint16(eocd + 10, true);
  let ptr = view.getUint32(eocd + 16, true);
  if (count > MAX_ENTRIES) throw new Error("ZIP has too many files.");

  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (ptr + 46 > buf.length || view.getUint32(ptr, true) !== 0x02014b50) throw new Error("Damaged ZIP directory.");
    const flags = view.getUint16(ptr + 8, true);
    const method = view.getUint16(ptr + 10, true);
    const compSize = view.getUint32(ptr + 20, true);
    const size = view.getUint32(ptr + 24, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const local = view.getUint32(ptr + 42, true);
    const name = decoder.decode(buf.subarray(ptr + 46, ptr + 46 + nameLen));
    ptr += 46 + nameLen + extraLen + commentLen;

    if (flags & 0x1) throw new Error("Encrypted ZIP files are not supported.");
    if (name.endsWith("/")) continue;
    if (size > MAX_ENTRY_BYTES || compSize > MAX_ENTRY_BYTES) throw new Error("A file inside the ZIP is too large.");
    if (local + 30 > buf.length || view.getUint32(local, true) !== 0x04034b50) throw new Error("Damaged ZIP entry.");
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    if (start + compSize > buf.length) throw new Error("Damaged ZIP entry.");
    const raw = buf.subarray(start, start + compSize);

    let bytes: Uint8Array;
    if (method === 0) {
      if (compSize !== size) throw new Error("ZIP entry has the wrong size.");
      bytes = raw.slice();
    } else if (method === 8) {
      bytes = await inflateRaw(raw, size);
    } else {
      throw new Error("Unsupported ZIP compression.");
    }
    entries.push({ name, bytes });
  }
  return entries;
}
