"use server";
// Set a character's or location's thumbnail without leaving the page she's on.
import { revalidatePath } from "next/cache";
import { friendlyError } from "@/lib/errors";
import { supabaseServer } from "@/lib/supabase/server";

export async function setThumbnailFor(input: { projectId: string; entityId: string; assetId: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const sb = await supabaseServer();
  const { error } = await sb.rpc("set_entity_thumbnail", { p_entity: input.entityId, p_asset: input.assetId });
  if (error) return { ok: false, error: friendlyError(error).message };
  revalidatePath(`/projects/${input.projectId}`, "layout");
  return { ok: true };
}
