import type { FrameLook } from "@/lib/look/types";
import type { Composition } from "@/lib/storyboard/compose";
import type { ShotContent } from "@/lib/storyboard/shot";

export interface FrameRow {
  id: string; position: number; state: "proposed" | "approved"; locked: boolean; origin: "director" | "agent";
  revision: number; approvedRevision: number | null; content: ShotContent; composition: Composition; compositionVersion: number;
  illustrationAssetId: string | null; review: { reason: string; was?: string; now?: string } | null; notes: string;
  /** Look & Feel choice for this frame (null = follow the storyboard / film default). */
  look?: FrameLook | null;
}
export interface LibItem {
  id: string; kind: "character" | "pose" | "wardrobe" | "background" | "prop" | "drawing" | "reference"; name: string;
  assetId: string | null; entityId: string | null; parentId: string | null; views: string; purpose: string | null; note: string;
  usage: "composition" | "reference_only"; sourceUrl: string | null; attribution: string; permission: string; origin: string; version: number;
}
export interface JobRow { id: string; shotId: string | null; kind: string; status: string; outputAssetId: string | null; applied: boolean; error: string | null; createdAt: string; model: string; usage: Record<string, unknown> | null }
export interface FilmItem {
  id: string; kind: "character" | "location"; name: string; assetId: string | null;
  /** Its thumbnail chosen from the treatment (a live window onto a slide), if any. */
  thumb?: import("@/lib/thumb").ThumbCrop | null;
}
export interface LensPick {
  id: string; name: string; focalLengths: number[]; zoom: boolean; optical: "spherical" | "anamorphic"; squeeze: number | null;
  maxAperture: string; camera: string; seenIn: string; note: string; sourceUrl: string | null; sourceName: string;
}
export const lensFromRow = (l: Record<string, unknown>): LensPick => ({
  id: String(l.id), name: String(l.name), focalLengths: ((l.focal_lengths as (number | string)[]) ?? []).map(Number), zoom: !!l.zoom,
  optical: l.optical === "anamorphic" ? "anamorphic" : "spherical", squeeze: l.squeeze == null ? null : Number(l.squeeze),
  maxAperture: String(l.max_aperture ?? ""), camera: String(l.camera ?? ""), seenIn: String(l.seen_in ?? ""), note: String(l.note ?? ""),
  sourceUrl: (l.source_url as string | null) ?? null, sourceName: String(l.source_name ?? ""),
});
export const LENS_ADDICTION_URL = "https://www.lensaddiction.net/breakdowns";
export interface StockRef { id: string; manufacturer: string; stock: string; product_codes: string[]; balance: string | null; ei_daylight: number | null; ei_tungsten: number | null; source_urls: string[]; documented: string; editorial: string; gauges: string[] }

export const KIND_LABELS: Record<LibItem["kind"], string> = {
  character: "Characters", pose: "Poses", wardrobe: "Wardrobe", background: "Backgrounds", prop: "Props", drawing: "Drawings", reference: "References",
};
export const PURPOSES: [string, string][] = [
  ["character", "Character"], ["location", "Location"], ["prop", "Prop"], ["composition", "Composition"], ["atmosphere", "Atmosphere"], ["color", "Color"], ["illustration_style", "Illustration style"],
];
