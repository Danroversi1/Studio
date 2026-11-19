// Connections board: which cards are on it, where they sit, and the automatic strings.
// Pure (unit-tested). Her own strings and notes come from the database; automatic
// strings are worked out from the script here every time, so they can't go stale.
import { parseBreakdown, titleCase } from "./scene-plan";
import type { ThumbSource } from "./thumb";

export type NodeKind = "character" | "location" | "reference" | "note" | "scene" | "collection";
export interface BoardNode {
  key: string; kind: NodeKind; title: string; body: string;
  x: number; y: number; href?: string; imageAssetId?: string | null; thumb?: ThumbSource; color?: string;
}
export interface AutoEdge { from: string; to: string; label: string; weight: number }
export interface BoardLink { id: string; from: string; to: string; label: string | null }

export const CARD_W = 184;
export const CARD_H = 124;

export interface BoardInput {
  entities: { id: string; kind: "character" | "location"; name: string; summary: string; thumb?: ThumbSource }[];
  references: { id: string; title: string; credit: string; previewAssetId: string | null }[];
  notes: { id: string; body: string; color: string }[];
  positions: Record<string, { x: number; y: number }>;
  script: string;
  showScenes: boolean;
  /** Knowledge collections (cards placed automatically, below the cast). */
  collections?: { id: string; name: string; count: number }[];
  base: string;
}

const norm = (s: string) => titleCase(s).toLowerCase().trim();

/** Cards with saved positions keep them; new cards get a tidy spot by kind. */
export function buildNodes(inp: BoardInput): BoardNode[] {
  const out: BoardNode[] = [];
  const place = (key: string, col: number, row: number) => inp.positions[key] ?? { x: 40 + col * (CARD_W + 36), y: 40 + row * (CARD_H + 90) };
  const chars = inp.entities.filter((e) => e.kind === "character");
  const locs = inp.entities.filter((e) => e.kind === "location");
  chars.forEach((e, i) => out.push({ key: `e:${e.id}`, kind: "character", title: e.name, body: e.summary, href: `${inp.base}/items/${e.id}`, thumb: e.thumb ?? null, ...place(`e:${e.id}`, i, 0) }));
  locs.forEach((e, i) => out.push({ key: `e:${e.id}`, kind: "location", title: e.name, body: e.summary, href: `${inp.base}/items/${e.id}`, thumb: e.thumb ?? null, ...place(`e:${e.id}`, i, inp.showScenes ? 3 : 2) }));
  inp.references.filter((r) => r.previewAssetId).slice(0, 24).forEach((r, i) =>
    out.push({ key: `r:${r.id}`, kind: "reference", title: r.title || "Reference", body: r.credit, href: `${inp.base}/references`, imageAssetId: r.previewAssetId, ...place(`r:${r.id}`, Math.max(chars.length, locs.length) + 1 + (i % 2), Math.floor(i / 2)) }));
  (inp.collections ?? []).forEach((c, i) => out.push({ key: `k:${c.id}`, kind: "collection", title: c.name, body: `${c.count} item${c.count === 1 ? "" : "s"} · Knowledge Base`,
    href: `${inp.base}/knowledge`, ...place(`k:${c.id}`, i, inp.showScenes ? 5 : 4) }));
  inp.notes.forEach((n, i) => out.push({ key: `n:${n.id}`, kind: "note", title: "", body: n.body, color: n.color, ...place(`n:${n.id}`, i, inp.showScenes ? 4 : 3) }));
  if (inp.showScenes) {
    parseBreakdown(inp.script).forEach((s) => out.push({
      key: `s:${s.number}`, kind: "scene", title: `${s.number}. ${s.heading}`, body: s.characters.join(", "), href: `${inp.base}/script`,
      ...place(`s:${s.number}`, s.number - 1, 1.5),
    }));
  }
  return out;
}

/** Automatic strings from the script: who is in which scene, where scenes happen, and
 *  who shares a scene with whom. Names are matched to the film's characters and places. */
export function autoEdges(inp: Pick<BoardInput, "entities" | "script" | "showScenes">): AutoEdge[] {
  const charByName = new Map(inp.entities.filter((e) => e.kind === "character").map((e) => [norm(e.name), `e:${e.id}`]));
  const locByName = new Map(inp.entities.filter((e) => e.kind === "location").map((e) => [norm(e.name), `e:${e.id}`]));
  const edges = new Map<string, AutoEdge>();
  const add = (a: string, b: string, label: string) => {
    if (a === b) return;
    const k = [a, b].sort().join("|") + "|" + label;
    const e = edges.get(k);
    if (e) e.weight += 1; else edges.set(k, { from: a, to: b, label, weight: 1 });
  };
  for (const s of parseBreakdown(inp.script)) {
    const chars = [...new Set(s.characters.map((c) => charByName.get(norm(c))).filter((x): x is string => !!x))];
    const loc = locByName.get(norm(s.location));
    if (inp.showScenes) {
      for (const c of chars) add(`s:${s.number}`, c, "in this scene");
      if (loc) add(`s:${s.number}`, loc, "happens here");
    } else {
      if (loc) for (const c of chars) add(c, loc, "in a scene here");
      for (let i = 0; i < chars.length; i++) for (let j = i + 1; j < chars.length; j++) add(chars[i], chars[j], "share a scene");
    }
  }
  return [...edges.values()];
}

/** A hanging string: a gentle curve that sags between two pins. */
export function stringPath(ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay;
  const sag = Math.min(120, Math.hypot(dx, dy) * 0.18);
  const mx = (ax + bx) / 2, my = (ay + by) / 2 + sag;
  return { d: `M ${ax} ${ay} Q ${mx} ${my} ${bx} ${by}`, mid: { x: mx, y: (ay + by) / 2 + sag / 2 } };
}
