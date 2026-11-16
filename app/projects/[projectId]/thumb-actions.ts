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
