import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { sniffImageType, validateUploadIntent, verifyStoredObject, MAX_ARTWORK_BYTES } from "../../lib/assets/validate";
import { DevFilesystemStorage, devSign, devVerify } from "../../lib/storage/dev-filesystem";
import { assertStorageKey } from "../../lib/storage/types";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
const GIF = new TextEncoder().encode("GIF89a....");
const P = "11111111-1111-1111-1111-111111111111";
const E = "22222222-2222-2222-2222-222222222222";
const A = "33333333-3333-3333-3333-333333333333";
const KEY = `projects/${P}/entities/${E}/assets/${A}/original.png`;
const SECRET = "x".repeat(40);

test("sniffs PNG and JPEG by signature bytes only", () => {
  assert.equal(sniffImageType(PNG), "image/png");
  assert.equal(sniffImageType(JPEG), "image/jpeg");
  assert.equal(sniffImageType(GIF), null);
  assert.equal(sniffImageType(new Uint8Array()), null);
});

test("upload intent validation", () => {
  const ok = validateUploadIntent({ entityId: E, fileName: " Mira.png ", mimeType: "image/png", byteSize: 10 });
  assert.deepEqual(ok, { ok: true, value: { entityId: E, fileName: "Mira.png", mimeType: "image/png", byteSize: 10 } });
  assert.equal(validateUploadIntent({ entityId: E, fileName: "a.gif", mimeType: "image/gif", byteSize: 10 }).ok, false);
  assert.equal(validateUploadIntent({ entityId: E, fileName: "a.png", mimeType: "image/png", byteSize: MAX_ARTWORK_BYTES + 1 }).ok, false);
  assert.equal(validateUploadIntent({ entityId: E, fileName: "a.png", mimeType: "image/png", byteSize: 0 }).ok, false);
  assert.equal(validateUploadIntent({ entityId: "not-a-uuid", fileName: "a.png", mimeType: "image/png", byteSize: 1 }).ok, false);
});

test("stored-object verification catches missing, truncated, disguised and mislabelled files", () => {
  const declared = { mimeType: "image/png", byteSize: 12 };
  assert.equal(verifyStoredObject(declared, null).ok, false);
  assert.equal(verifyStoredObject(declared, { size: 11, head: PNG }).ok, false);
  assert.equal(verifyStoredObject(declared, { size: 12, head: GIF }).ok, false);
  assert.equal(verifyStoredObject(declared, { size: 12, head: JPEG }).ok, false);
  assert.deepEqual(verifyStoredObject(declared, { size: 12, head: PNG }), { ok: true, value: { mimeType: "image/png", byteSize: 12 } });
});

test("only database-shaped storage keys can be signed", () => {
  assert.equal(assertStorageKey(KEY), KEY);
  for (const bad of ["../etc/passwd", `projects/${P}/x.png`, `${KEY}/../../other`, KEY.replace(".png", ".svg")])
    assert.throws(() => assertStorageKey(bad));
});

test("dev signatures are bound to method, key, type, size and expiry", () => {
  const input = { method: "PUT" as const, key: KEY, expires: 1000, contentType: "image/png", byteSize: 12 };
  const sig = devSign(SECRET, input);
  assert.equal(devVerify(SECRET, input, sig, 999), true);
  assert.equal(devVerify(SECRET, input, sig, 1001), false, "expired");
  assert.equal(devVerify(SECRET, { ...input, method: "GET" }, sig, 999), false, "method");
  assert.equal(devVerify(SECRET, { ...input, key: KEY.replace(A, P) }, sig, 999), false, "key");
  assert.equal(devVerify(SECRET, { ...input, byteSize: 13 }, sig, 999), false, "size");
  assert.equal(devVerify(SECRET, { ...input, contentType: "image/jpeg" }, sig, 999), false, "type");
  assert.equal(devVerify("y".repeat(40), input, sig, 999), false, "secret");
});

test("dev storage is write-once and inspects stored bytes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "studio-dev-storage-"));
  try {
    const s = new DevFilesystemStorage(root, SECRET, "http://localhost:3000", () => 100);
    assert.equal(await s.inspect(KEY, 16), null);
    assert.equal(await s.writeOnce(KEY, PNG), "written");
    assert.equal(await s.writeOnce(KEY, JPEG), "exists", "original is never overwritten");
    const facts = await s.inspect(KEY, 16);
    assert.equal(facts?.size, PNG.length);
    assert.equal(sniffImageType(facts!.head), "image/png");
    assert.match(await s.sha256(KEY), /^[0-9a-f]{64}$/);
    const up = await s.signUpload(KEY, "image/png", 12, 300);
    const u = new URL(up.url);
    assert.equal(u.pathname, "/api/dev-storage");
    assert.equal(u.searchParams.get("expires"), "400");
    assert.throws(() => s.resolve("projects/../../escape.png"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
