import type { Composition } from "@/lib/storyboard/compose";
import type { ShotContent } from "@/lib/storyboard/shot";

export interface FrameRow {
  id: string; position: number; state: "proposed" | "approved"; locked: boolean; origin: "director" | "agent";
  revision: number; approvedRevision: number | null; content: ShotContent; composition: Composition; compositionVersion: number;
  illustrationAssetId: string | null; review: { reason: string; was?: string; now?: string } | null; notes: string;
}
export interface LibItem {
  id: string; kind: "character" | "pose" | "wardrobe" | "background" | "prop" | "drawing" | "reference"; name: string;
  assetId: string | null; entityId: string | null; parentId: string | null; views: string; purpose: string | null; note: string;
  usage: "composition" | "reference_only"; sourceUrl: string | null; attribution: string; permission: string; origin: string; version: number;
}
export interface JobRow { id: string; shotId: string | null; kind: string; status: string; outputAssetId: string | null; applied: boolean; error: string | null; createdAt: string; model: string; usage: Record<string, unknown> | null }
export interface FilmItem { id: string; kind: "character" | "location"; name: string; assetId: string | null }
export interface StockRef { id: string; manufacturer: string; stock: string; product_codes: string[]; balance: string | null; ei_daylight: number | null; ei_tungsten: number | null; source_urls: string[]; documented: string; editorial: string; gauges: string[] }

export const KIND_LABELS: Record<LibItem["kind"], string> = {
  character: "Characters", pose: "Poses", wardrobe: "Wardrobe", background: "Backgrounds", prop: "Props", drawing: "Drawings", reference: "References",
};
export const PURPOSES: [string, string][] = [
  ["character", "Character"], ["location", "Location"], ["prop", "Prop"], ["composition", "Composition"], ["atmosphere", "Atmosphere"], ["color", "Color"], ["illustration_style", "Illustration style"],
];
