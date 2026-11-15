import assert from "node:assert/strict";
import { test } from "node:test";
import { deflateRawSync } from "node:zlib";
import { isSafeHref, parseGoogleLink, splitDocExport } from "../../lib/google/links";
import { readZip } from "../../lib/zip";

function crcless(name: string, data: Buffer, method: 0 | 8) {
  const body = method === 8 ? deflateRawSync(data) : data;
  return { name: Buffer.from(name), body, size: data.length, method };
}

/** Build a small ZIP by hand (CRC left 0; the reader doesn't check it). */
function makeZip(files: { name: string; data: string; method: 0 | 8 }[]) {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files.map((f) => crcless(f.name, Buffer.from(f.data), f.method))) {
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(f.method, 8);
    local.writeUInt32LE(f.body.length, 18);
    local.writeUInt32LE(f.size, 22);
    local.writeUInt16LE(f.name.length, 26);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(f.method, 10);
    cen.writeUInt32LE(f.body.length, 20);
    cen.writeUInt32LE(f.size, 24);
    cen.writeUInt16LE(f.name.length, 28);
    cen.writeUInt32LE(offset, 42);
    parts.push(local, f.name, f.body);
    central.push(cen, f.name);
    offset += 30 + f.name.length + f.body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...parts, cd, end]));
}

test("reads stored and deflated entries from a Docs export", async () => {
  const zip = makeZip([
    { name: "Treatment.html", data: "<html><body><img src=\"images/image1.png\"></body></html>", method: 8 },
    { name: "images/image1.png", data: "PNGDATA".repeat(50), method: 8 },
    { name: "images/image2.jpg", data: "JPG", method: 0 },
  ]);
  const entries = await readZip(zip);
  assert.deepEqual(entries.map((e) => e.name), ["Treatment.html", "images/image1.png", "images/image2.jpg"]);
  assert.equal(new TextDecoder().decode(entries[1].bytes), "PNGDATA".repeat(50));
  const { html, images } = splitDocExport(entries);
  assert.equal(html?.name, "Treatment.html");
  assert.equal(images.length, 2);
});

test("rejects things that are not ZIP files", async () => {
  await assert.rejects(readZip(new Uint8Array(100)), /Not a ZIP/);
});

test("recognizes Google Docs and Drive links only", () => {
  assert.deepEqual(parseGoogleLink("https://docs.google.com/document/d/1AbCdEfGhIjKlMnOp/edit?usp=sharing"), { kind: "doc", id: "1AbCdEfGhIjKlMnOp" });
  assert.deepEqual(parseGoogleLink("https://docs.google.com/document/u/0/d/1AbCdEfGhIjKlMnOp/"), { kind: "doc", id: "1AbCdEfGhIjKlMnOp" });
  assert.deepEqual(parseGoogleLink("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view"), { kind: "file", id: "1AbCdEfGhIjKlMnOp" });
  assert.deepEqual(parseGoogleLink("https://drive.google.com/open?id=1AbCdEfGhIjKlMnOp"), { kind: "file", id: "1AbCdEfGhIjKlMnOp" });
  assert.deepEqual(parseGoogleLink("https://docs.google.com/presentation/d/1AbCdEfGhIjKlMnOp/edit#slide=id.p"), { kind: "slides", id: "1AbCdEfGhIjKlMnOp" });
  assert.equal(parseGoogleLink("http://docs.google.com/document/d/1AbCdEfGhIjKlMnOp/edit"), null);
  assert.equal(parseGoogleLink("https://docs.google.com.evil.com/document/d/1AbCdEfGhIjKlMnOp/edit"), null);
  assert.equal(parseGoogleLink("https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOp/edit"), null);
  assert.equal(parseGoogleLink("not a url"), null);
});

test("only plain links survive in the treatment reader", () => {
  assert.ok(isSafeHref("https://example.com"));
  assert.ok(isSafeHref("#heading"));
  assert.ok(!isSafeHref("javascript:alert(1)"));
  assert.ok(!isSafeHref("data:text/html,x"));
});
