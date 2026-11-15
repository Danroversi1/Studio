"use server";
// Developer comments layer (only for accounts listed in studio_developers; the database
// enforces it, so these actions do nothing for anyone else).
import { supabaseServer } from "@/lib/supabase/server";

export interface DevComment {
  id: string; path: string; body: string; status: "open" | "resolved"; resolution_note: string | null;
  created_at: string; anchor: { x_pct?: number; y_px?: number; selector?: string; snippet?: string; vw?: number; vh?: number };
}

export async function listDevComments(): Promise<DevComment[]> {
  const sb = await supabaseServer();
  const { data } = await sb.from("dev_comments")
    .select("id, path, body, status, resolution_note, created_at, anchor")
    .order("created_at", { ascending: false }).limit(300);
  return (data ?? []) as DevComment[];
}

export async function addDevComment(input: { path: string; anchor: DevComment["anchor"]; body: string }) {
  const body = String(input?.body ?? "").trim();
  if (!body) return { error: "Write a note first." };
  const sb = await supabaseServer();
  const { error } = await sb.rpc("add_dev_comment", { p_path: String(input.path).slice(0, 500), p_anchor: input.anchor ?? {}, p_body: body.slice(0, 4000) });
  return error ? { error: error.message } : {};
}

export async function setDevCommentStatus(input: { id: string; status: "open" | "resolved" }) {
  const sb = await supabaseServer();
  const { error } = await sb.rpc("set_dev_comment_status", { p_comment: input.id, p_status: input.status, p_note: null });
  return error ? { error: error.message } : {};
}

export async function deleteDevComment(input: { id: string }) {
  const sb = await supabaseServer();
  const { error } = await sb.rpc("delete_dev_comment", { p_comment: input.id });
  return error ? { error: error.message } : {};
}
