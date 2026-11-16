"use server";
// Connections board edits. Each returns a result (no redirect) so the board stays put.
import { revalidatePath } from "next/cache";
import { friendlyError } from "@/lib/errors";
import { supabaseServer } from "@/lib/supabase/server";

type R<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };
const fail = (e: { message: string; code?: string } | null): R => ({ ok: false, error: friendlyError(e).message });

export async function boardMove(input: { projectId: string; moves: { key: string; x: number; y: number }[] }): Promise<R> {
  const sb = await supabaseServer();
  const moves = (input.moves ?? []).slice(0, 200).map((m) => ({ key: String(m.key), x: Math.round(m.x), y: Math.round(m.y) }));
  const { error } = await sb.rpc("board_move", { p_project: input.projectId, p_moves: moves });
  return error ? fail(error) : { ok: true };
}

export async function boardLink(input: { projectId: string; from: string; to: string; label?: string | null }): Promise<R<string>> {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("board_link", { p_project: input.projectId, p_from: input.from, p_to: input.to, p_label: input.label ?? null });
  if (error) return fail(error) as R<string>;
  revalidatePath(`/projects/${input.projectId}`, "layout");
  return { ok: true, data: data as string };
}

export async function boardLabel(input: { projectId: string; id: string; label: string }): Promise<R> {
  const sb = await supabaseServer();
  const { error } = await sb.rpc("board_link_label", { p_link: input.id, p_label: input.label });
  if (error) return fail(error);
  revalidatePath(`/projects/${input.projectId}`, "layout");
  return { ok: true };
}

export async function boardUnlink(input: { projectId: string; id: string }): Promise<R> {
  const sb = await supabaseServer();
  const { error } = await sb.rpc("board_unlink", { p_link: input.id });
  if (error) return fail(error);
  revalidatePath(`/projects/${input.projectId}`, "layout");
  return { ok: true };
}

export async function boardNote(input: { projectId: string; id?: string | null; body: string; color?: string; x?: number; y?: number }): Promise<R<string>> {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("board_note_save", {
    p_project: input.projectId, p_note: input.id ?? null, p_body: input.body, p_color: input.color ?? "yellow",
    p_x: input.x ?? null, p_y: input.y ?? null,
  });
  if (error) return fail(error) as R<string>;
  return { ok: true, data: data as string };
}

export async function boardNoteDelete(input: { projectId: string; id: string }): Promise<R> {
  const sb = await supabaseServer();
  const { error } = await sb.rpc("board_note_delete", { p_note: input.id });
  return error ? fail(error) : { ok: true };
}
