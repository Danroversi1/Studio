// Read lens details from a link she pasted (e.g. a Lens Addiction search link with
// ?lensModel=COOKE+Speed+Panchro+S2%2FS3+32mm+T2.3+TLS+Rehoused). Only the link text is read:
// nothing is fetched from the site. Pure; unit-tested.

export interface LensFromLink {
  name: string;
  focalLengths: number[];
  zoom: boolean;
  maxAperture: string;
  optical: "spherical" | "anamorphic";
  squeeze: number | null;
  source: "Lens Addiction" | null;
}

const NUM = String.raw`(\d+(?:[.,]\d+)?)`;
const toNum = (s: string) => Number(s.replace(",", "."));

/** The lens name as written in the link's lensModel (or search) parameter, if any. */
export function lensModelFromUrl(raw: string): { model: string; source: LensFromLink["source"] } | null {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== "https:") return null;
  const isLA = /(^|\.)lensaddiction\.(net|com)$/i.test(u.hostname) || /^lensaddiction\.circle\.so$/i.test(u.hostname);
  const model = (u.searchParams.get("lensModel") ?? u.searchParams.get("lensmodel") ?? u.searchParams.get("search") ?? u.searchParams.get("q") ?? "")
    .replace(/\s+/g, " ").trim();
  if (!model || model.length > 200) return null;
  return { model, source: isLA ? "Lens Addiction" : null };
}

/** Pull focal length(s), aperture and anamorphic squeeze out of a lens model name. */
export function parseLensModel(model: string): Omit<LensFromLink, "source"> {
  const name = model.replace(/\s+/g, " ").trim().slice(0, 120);
  let focalLengths: number[] = [];
  let zoom = false;
  const range = name.match(new RegExp(`${NUM}\\s*(?:-|–|—|to)\\s*${NUM}\\s*mm`, "i"));
  if (range) {
    focalLengths = [toNum(range[1]), toNum(range[2])].sort((a, b) => a - b);
    zoom = true;
  } else {
    focalLengths = [...name.matchAll(new RegExp(`${NUM}\\s*mm\\b`, "gi"))].map((m) => toNum(m[1]));
    if (/\bzoom\b/i.test(name) && focalLengths.length >= 2) zoom = true;
  }
  focalLengths = [...new Set(focalLengths.filter((f) => f >= 4 && f <= 2000))].sort((a, b) => a - b).slice(0, 20);
  const ap = name.match(new RegExp(`(?:^|[\\s(/])(T|f\\s*/?)\\s*${NUM}(?:\\s*[-–]\\s*${NUM})?(?=$|[\\s),])`, "i"));
  const maxAperture = ap ? (ap[1].toUpperCase() === "T" ? `T${ap[2].replace(",", ".")}` : `f/${ap[2].replace(",", ".")}`) : "";
  const sq = name.match(new RegExp(`(?:^|\\s)${NUM}\\s*[x×](?=$|\\s)`, "i"));
  const anamorphic = /anamorph/i.test(name) || !!sq;
  const squeeze = anamorphic ? (sq ? Math.min(2.5, Math.max(1, toNum(sq[1]))) : 2) : null;
  return { name, focalLengths, zoom, maxAperture, optical: anamorphic ? "anamorphic" : "spherical", squeeze };
}

export function lensFromLink(raw: string): LensFromLink | null {
  const m = lensModelFromUrl(raw);
  if (!m) return null;
  return { ...parseLensModel(m.model), source: m.source };
}
