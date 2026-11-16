// SERVER ONLY. Authentication for the companion program on her computer. It sends
// "Authorization: Bearer <device token>"; only the token's SHA-256 is stored. Never log tokens.
import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { supabaseService } from "../supabase/server";

export const newDeviceToken = () => `srt_${randomBytes(32).toString("base64url")}`;
export const hashSecret = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

/** Read a small JSON body (companion requests are tiny). */
export async function readJson<T>(req: Request, max = 64_000): Promise<T | null> {
  const text = await req.text().catch(() => "");
  if (!text || text.length > max) return null;
  try { return JSON.parse(text) as T; } catch { return null; }
}

/** Who is calling? Returns the device, or a 401 response. Optionally stores its report. */
export async function deviceFrom(req: Request, report?: unknown): Promise<{ deviceId: string; userId: string } | { error: NextResponse }> {
  const h = req.headers.get("authorization") ?? "";
  const m = /^Bearer (srt_[A-Za-z0-9_-]{40,60})$/.exec(h);
  if (!m) return { error: json({ error: "Not paired. Pair this computer in Studio first." }, 401) };
  const { data } = await supabaseService().rpc("renderer_auth", { p_token_hash: hashSecret(m[1]), p_report: report ?? null });
  const row = (data as { device_id: string; user_id: string }[] | null)?.[0];
  if (!row) return { error: json({ error: "This computer isn't connected to Studio any more. Pair it again." }, 401) };
  return { deviceId: row.device_id, userId: row.user_id };
}
