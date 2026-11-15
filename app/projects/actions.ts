"use server";
import { redirect } from "next/navigation";
import { friendlyError, withMessage } from "@/lib/errors";
import { supabaseServer } from "@/lib/supabase/server";

export async function createProject(formData: FormData) {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("create_project", {
    p_name: String(formData.get("name") ?? ""),
    p_description: String(formData.get("description") ?? "") || null,
  });
  if (error) redirect(withMessage("/projects", "error", friendlyError(error).message));
  // New films start at the story intake (three guided questions).
  redirect(`/projects/${data}/add`);
}
