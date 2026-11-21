// Her computer couldn't judge this day (e.g. the local model isn't running). The day goes
// back in line; after 3 tries it's settled as a quiet day.
import { deviceFrom, json, readJson } from "@/lib/local/server";
import { supabaseService } from "@/lib/supabase/server";

export async function POST(req: Request, { params }: { params: Promise<{ dayId: string }> }) {
  const { dayId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(dayId)) return json({ error: "Not found." }, 404);
  const body = await readJson<{ message?: string }>(req);
  const who = await deviceFrom(req);
  if ("error" in who) return who.error;
  await supabaseService().rpc("mood_fail", { p_id: dayId, p_device: who.deviceId, p_error: String(body?.message ?? "Couldn't judge.").slice(0, 500) });
  return json({ ok: true });
}
