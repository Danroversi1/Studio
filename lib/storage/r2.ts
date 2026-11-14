// Cloudflare R2 adapter (S3-compatible API). UNVERIFIED: written against Cloudflare's
// documented AWS SDK v3 usage (region "auto", account endpoint, getSignedUrl) but never
// run against a real bucket in this repository. See docs/setup.md "Unverified integrations".
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createHash } from "node:crypto";
import { assertStorageKey, type StorageAdapter } from "./types";

export class R2Storage implements StorageAdapter {
  readonly driver = "r2" as const;
  private readonly s3: S3Client;

  constructor(
    accountId: string,
    accessKeyId: string,
    secretAccessKey: string,
    private readonly bucket: string,
  ) {
    this.s3 = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  async signUpload(key: string, contentType: string, byteSize: number, ttlSeconds: number) {
    assertStorageKey(key);
    const url = await getSignedUrl(
      this.s3,
      // IfNoneMatch "*" asks R2 to refuse overwriting an existing object (write-once).
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType, ContentLength: byteSize, IfNoneMatch: "*" }),
      { expiresIn: ttlSeconds },
    );
    return {
      url,
      method: "PUT" as const,
      headers: { "Content-Type": contentType, "If-None-Match": "*" },
      expiresAt: new Date(Date.now() + ttlSeconds * 1000),
    };
  }

  async signDownload(key: string, ttlSeconds: number) {
    assertStorageKey(key);
    const url = await getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: ttlSeconds,
    });
    return { url, method: "GET" as const, headers: {}, expiresAt: new Date(Date.now() + ttlSeconds * 1000) };
  }

  async inspect(key: string, headBytes: number) {
    assertStorageKey(key);
    try {
      const head = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      const size = Number(head.ContentLength ?? -1);
      const obj = await this.s3.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: `bytes=0-${Math.max(0, headBytes - 1)}` }),
      );
      const bytes = obj.Body ? await obj.Body.transformToByteArray() : new Uint8Array();
      return { size, head: bytes };
    } catch (e) {
      if ((e as { name?: string }).name === "NotFound" || (e as { name?: string }).name === "NoSuchKey") return null;
      throw e;
    }
  }

  async sha256(key: string) {
    assertStorageKey(key);
    const obj = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const hash = createHash("sha256");
    // Body is a Node Readable on the server runtime.
    for await (const chunk of obj.Body as AsyncIterable<Uint8Array>) hash.update(chunk);
    return hash.digest("hex");
  }
}
