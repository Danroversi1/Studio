import assert from "node:assert/strict";
import { test } from "node:test";
import { lensFromLink, parseLensModel } from "../../lib/storyboard/lens-link";

test("reads a Lens Addiction lensModel link", () => {
  const l = lensFromLink("https://www.lensaddiction.net/?search=COOKE+Speed+Panchro+S2%2FS3+32mm+T2.3+TLS+Rehoused&lensModel=COOKE+Speed+Panchro+S2%2FS3+32mm+T2.3+TLS+Rehoused");
  assert.ok(l);
  assert.equal(l.name, "COOKE Speed Panchro S2/S3 32mm T2.3 TLS Rehoused");
  assert.deepEqual(l.focalLengths, [32]);
  assert.equal(l.zoom, false);
  assert.equal(l.maxAperture, "T2.3");
  assert.equal(l.optical, "spherical");
  assert.equal(l.source, "Lens Addiction");
});

test("zooms, f-stops and anamorphics", () => {
  const z = parseLensModel("CANON TV Zoom 12.5–75mm f/1.8");
  assert.deepEqual(z.focalLengths, [12.5, 75]); assert.equal(z.zoom, true); assert.equal(z.maxAperture, "f/1.8");
  const a = parseLensModel("PANAVISION Ultra Panatar II 40mm T2.8");
  assert.equal(a.optical, "spherical"); assert.equal(a.maxAperture, "T2.8");
  const b = parseLensModel("ATLAS Orion Anamorphic 2x 65mm T2");
  assert.equal(b.optical, "anamorphic"); assert.equal(b.squeeze, 2); assert.deepEqual(b.focalLengths, [65]); assert.equal(b.maxAperture, "T2");
  const c = parseLensModel("Laowa Nanomorph 1.5x 35mm T2.4");
  assert.equal(c.squeeze, 1.5);
  const d = parseLensModel("ZEISS Super Speed S16 12mm T1.3");
  assert.deepEqual(d.focalLengths, [12]); assert.equal(d.maxAperture, "T1.3");
});

test("links without a lens model give nothing", () => {
  assert.equal(lensFromLink("https://www.lensaddiction.net/hunterdaly"), null);
  assert.equal(lensFromLink("not a link"), null);
  assert.equal(lensFromLink("http://www.lensaddiction.net/?lensModel=X"), null);
});
