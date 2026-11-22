"use server";
// Which societies (US, EU) a film's story lives in. Plain data work, no model.
import { revalidatePath } from "next/cache";
import { friendlyError } from "@/lib/errors";
import { supabaseServer } from "@/lib/supabase/server";

export async function societySetRegions(input: { projectId: string; regions: ("US" | "EU")[] }): Promise<{ ok: true } | { ok: false; error: string }> {
  const sb = await supabaseServer();
  const { error } = await sb.rpc("society_set_regions", { p_project: input.projectId, p_regions: input.regions });
  if (error) return { ok: false, error: friendlyError(error).message };
  revalidatePath(`/projects/${input.projectId}`, "layout");
  return { ok: true };
}
