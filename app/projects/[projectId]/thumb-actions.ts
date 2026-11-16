"use server";
// Thumbnails chosen as crops of the treatment (nothing stored), without leaving the page.
import { revalidatePath } from "next/cache";
import { friendlyError } from "@/lib/errors";
import { supabaseServer } from "@/lib/supabase/server";
import type { ThumbCrop } from "@/lib/thumb";

type R = { ok: true } | { ok: false; error: string };

export async function setThumbnailCrop(input: { projectId: string; entityId: string; crop: ThumbCrop | null }): Promise<R> {
  const sb = await supabaseServer();
  const { error } = await sb.rpc("set_entity_thumbnail_crop", { p_entity: input.entityId, p_crop: input.crop });
  if (error) return { ok: false, error: friendlyError(error).message };
  revalidatePath(`/projects/${input.projectId}`, "layout");
  return { ok: true };
}

/** Keep the treatment's slide list (IDs and the start of each slide's text; no images). */
export async function saveTreatmentSlides(input: { projectId: string; fileId: string; slides: { id: string; text: string }[] }): Promise<R> {
  const sb = await supabaseServer();
  const { trimSlides } = await import("@/lib/slide-match");
  const { error } = await sb.rpc("save_treatment_slides", { p_project: input.projectId, p_file: input.fileId, p_slides: trimSlides(input.slides) });
  if (error) return { ok: false, error: friendlyError(error).message };
  return { ok: true };
}
