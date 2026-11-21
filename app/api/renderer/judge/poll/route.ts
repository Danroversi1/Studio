// The companion on her computer asks for the next mood day to judge: one character's rules
// and the coverage that reached them that day (titles and outlets only). It judges locally and
// sends back "in tune / at odds / unrelated" per item and rule. Nothing else is sent.
import { deviceFrom, json, readJson } from "@/lib/local/server";
import { supabaseService } from "@/lib/supabase/server";
import { JUDGE_INSTRUCTIONS } from "@/lib/mood/judge";

export async function POST(req: Request) {
  const body = await readJson<{ report?: unknown }>(req);
  const who = await deviceFrom(req, body?.report ?? null);
  if ("error" in who) return who.error;
  const sb = supabaseService();
  const { data: id, error } = await sb.rpc("mood_claim", { p_device: who.deviceId });
  if (error) return json({ error: "Studio couldn't check for moods to judge." }, 500);
  if (!id) return json({ job: null, pollSeconds: 30 });
  const { data: m } = await sb.from("mood_days").select("id, day, payload").eq("id", id).single();
  return json({ job: { id: m!.id, day: m!.day, ...(m!.payload as object), instructions: JUDGE_INSTRUCTIONS }, pollSeconds: 2 });
}
