// Look & Feel: references (how the film should look) and visual directions. Pure data shapes
// shared by the Treatment desk and the Storyboard desk. No model calls anywhere in lib/look.
import type { ThumbCrop } from "../thumb";

export const LOOK_TAGS = [
  ["colors", "The colors"], ["lighting", "The lighting"], ["atmosphere", "The atmosphere"], ["contrast", "Contrast & tones"],
  ["texture", "The texture / grain"], ["drawing", "The drawing style"], ["composition", "The composition"], ["overall", "The overall look"],
  ["other", "Something else"],
] as const;
export type LookTag = (typeof LOOK_TAGS)[number][0];
export const tagLabel = (t: string) => LOOK_TAGS.find(([k]) => k === t)?.[1] ?? t;

export interface PaletteColor { hex: string; label?: string; source: "manual" | "sampled" | "suggested" }
export interface Applies { film?: boolean; entities?: string[]; scenes?: number[] }

export interface LookRef {
  id: string; assetId: string | null; thumbAssetId: string | null; crop: ThumbCrop | null; sourceUrl: string | null; sourceEntityId: string | null;
  title: string; tags: LookTag[]; reason: string; useFor: string; leaveOut: string; applies: Applies; status: "proposed" | "approved";
  palette: PaletteColor[]; attribution: string; permission: string; position: number;
}
export interface LookDirection {
  id: string; name: string; intention: string; notes: string; palette: PaletteColor[]; scope: Applies;
  status: "draft" | "approved" | "archived"; isDefault: boolean; version: number; position: number; referenceIds: string[];
}

/** What can be shown for a reference. A link stays a link until an image is attached. */
export type Access = "image" | "treatment" | "link" | "missing";
export function accessOf(r: Pick<LookRef, "assetId" | "crop" | "sourceUrl">): Access {
  return r.assetId ? "image" : r.crop ? "treatment" : r.sourceUrl ? "link" : "missing";
}

const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
export function cleanApplies(v: unknown): Applies {
  const a = (v ?? {}) as Applies;
  if (a.film || (!arr(a.entities).length && !arr(a.scenes).length)) return { film: true };
  return { entities: arr<string>(a.entities).filter((x) => typeof x === "string"), scenes: arr<number>(a.scenes).filter((n) => Number.isInteger(n)) };
}
export const cleanPalette = (v: unknown): PaletteColor[] =>
  arr<PaletteColor>(v).filter((c) => c && /^#[0-9a-f]{6}$/i.test(c.hex)).map((c) => ({ hex: c.hex.toLowerCase(), label: c.label || undefined, source: c.source ?? "manual" }));

export function refFromRow(r: Record<string, unknown>): LookRef {
  return {
    id: String(r.id), assetId: (r.asset_id as string) ?? null, thumbAssetId: (r.thumb_asset_id as string) ?? null,
    crop: (r.crop as ThumbCrop | null) ?? null, sourceUrl: (r.source_url as string) ?? null, sourceEntityId: (r.source_entity_id as string) ?? null,
    title: String(r.title ?? "Reference"), tags: arr<LookTag>(r.tags), reason: String(r.reason ?? ""), useFor: String(r.use_for ?? ""),
    leaveOut: String(r.leave_out ?? ""), applies: cleanApplies(r.applies), status: r.status === "approved" ? "approved" : "proposed",
    palette: cleanPalette(r.palette), attribution: String(r.attribution ?? ""), permission: String(r.permission ?? ""), position: Number(r.position ?? 0),
  };
}
export function directionFromRow(d: Record<string, unknown>, refs: { direction_id: string; reference_id: string; position: number }[]): LookDirection {
  return {
    id: String(d.id), name: String(d.name), intention: String(d.intention ?? ""), notes: String(d.notes ?? ""), palette: cleanPalette(d.palette),
    scope: cleanApplies(d.scope), status: (["draft", "approved", "archived"] as const).find((s) => s === d.status) ?? "draft",
    isDefault: !!d.is_default, version: Number(d.version ?? 1), position: Number(d.position ?? 0),
    referenceIds: refs.filter((x) => x.direction_id === d.id).sort((a, b) => a.position - b.position).map((x) => x.reference_id),
  };
}

/** A storyboard frame's Look & Feel choice. */
export interface FrameLook { mode: "default" | "direction" | "references"; direction_id?: string; version?: number; reference_ids?: string[] }
export function cleanFrameLook(v: unknown): FrameLook | null {
  const l = v as FrameLook | null;
  if (!l || typeof l !== "object" || !["default", "direction", "references"].includes(l.mode)) return null;
  return { mode: l.mode, direction_id: l.direction_id, version: typeof l.version === "number" ? l.version : undefined, reference_ids: arr<string>(l.reference_ids) };
}
