// DEVELOPMENT ADAPTER — NOT CLOUDFLARE R2.
// Stores objects on the local disk and issues HMAC-signed, expiring URLs served by
// app/api/dev-storage/route.ts. It mimics the shape of the R2 flow (private bucket,
// server-generated keys, short-lived signed URLs, write-once objects) so the app can be
// exercised end to end without cloud credentials. It is refused in production.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertStorageKey, type SignedRequest, type StorageAdapter } from "./types";

export interface DevSignatureInput {
  method: "PUT" | "GET";
  key: string;
  expires: number; // unix seconds
  contentType?: string;
  byteSize?: number;
}

export function devSign(secret: string, input: DevSignatureInput): string {
  const payload = [input.method, input.key, input.expires, input.contentType ?? "", input.byteSize ?? ""].join("\n");
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function devVerify(secret: string, input: DevSignatureInput, signature: string, nowSeconds: number): boolean {
  if (!Number.isFinite(input.expires) || input.expires < nowSeconds) return false;
  const expected = Buffer.from(devSign(secret, input));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export class DevFilesystemStorage implements StorageAdapter {
  readonly driver = "dev-filesystem" as const;

  constructor(
    private readonly root: string,
    private readonly secret: string,
    private readonly publicBaseUrl: string,
    private readonly now: () => number = () => Math.floor(Date.now() / 1000),
  ) {
    if (secret.length < 32) throw new Error("DEV_STORAGE_SECRET must be at least 32 characters.");
  }

  resolve(key: string): string {
    assertStorageKey(key);
    const full = path.resolve(/*turbopackIgnore: true*/ this.root, key);
    if (!full.startsWith(path.resolve(/*turbopackIgnore: true*/ this.root) + path.sep)) throw new Error("Path escapes storage root.");
    return full;
  }

  private signed(input: DevSignatureInput): SignedRequest {
    const sig = devSign(this.secret, input);
    const u = new URL("/api/dev-storage", this.publicBaseUrl);
    u.searchParams.set("key", input.key);
    u.searchParams.set("expires", String(input.expires));
    if (input.contentType) u.searchParams.set("type", input.contentType);
    if (input.byteSize !== undefined) u.searchParams.set("size", String(input.byteSize));
    u.searchParams.set("sig", sig);
    return {
      url: u.toString(),
      method: input.method,
      headers: input.contentType ? { "Content-Type": input.contentType } : {},
      expiresAt: new Date(input.expires * 1000),
    };
  }

  async signUpload(key: string, contentType: string, byteSize: number, ttlSeconds: number) {
    assertStorageKey(key);
    return this.signed({ method: "PUT", key, expires: this.now() + ttlSeconds, contentType, byteSize });
  }

  async signDownload(key: string, ttlSeconds: number) {
    assertStorageKey(key);
    return this.signed({ method: "GET", key, expires: this.now() + ttlSeconds });
  }

  /** Write-once: an existing object is never overwritten (originals are preserved). */
  async writeOnce(key: string, body: Uint8Array): Promise<"written" | "exists"> {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    try {
      await writeFile(full, body, { flag: "wx" });
      return "written";
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST") return "exists";
      throw e;
    }
  }

  readStream(key: string) {
    return createReadStream(this.resolve(key));
  }

  async inspect(key: string, headBytes: number) {
    const full = this.resolve(key);
    try {
      const s = await stat(full);
      const fh = await open(full, "r");
      try {
        const buf = Buffer.alloc(Math.min(headBytes, s.size));
        await fh.read(buf, 0, buf.length, 0);
        return { size: s.size, head: new Uint8Array(buf) };
      } finally {
        await fh.close();
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }

  async sha256(key: string) {
    const hash = createHash("sha256");
    for await (const chunk of this.readStream(key)) hash.update(chunk as Buffer);
    return hash.digest("hex");
  }
}
