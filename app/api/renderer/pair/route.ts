// The companion exchanges a one-time pairing code (made in Studio by the signed-in director)
// for a device token. The token is returned once and stored only as a hash.
import { hashSecret, json, newDeviceToken, readJson } from "@/lib/local/server";
import { supabaseService } from "@/lib/supabase/server";

export async function POST(req: Request) {
  const body = await readJson<{ code?: string; name?: string; report?: unknown }>(req);
  const code = (body?.code ?? "").toUpperCase().replace(/[\s-]/g, "");
  if (!/^[A-HJ-NP-Z2-9]{10}$/.test(code)) return json({ error: "That isn't a pairing code. Copy the 10-character code from Studio." }, 400);
  const token = newDeviceToken();
  const { data, error } = await supabaseService().rpc("renderer_pair_complete", {
    p_code_hash: hashSecret(code), p_token_hash: hashSecret(token), p_name: String(body?.name ?? "").slice(0, 80), p_report: body?.report ?? {},
  });
  if (error) return json({ error: error.code === "22023" ? error.message : "Pairing failed. Make a new code in Studio and try again." }, 400);
  return json({ token, deviceId: data });
}
