// Optional AI image actions, only when she asks: "Illustrate This Frame" (her composition
// render goes in; a separate illustration comes out, linked to the frame) and "Create
// Missing Asset" (a reusable library picture). Same idempotency key never runs twice.
import { NextResponse } from "next/server";
import { friendlyError } from "@/lib/errors";
import { cleanComposition, libraryUse } from "@/lib/storyboard/compose";
import { assetPrompt, illustratePrompt, isStyle, outputSize, PROMPT_VERSION } from "@/lib/storyboard/prompt";
import { imageProvider } from "@/lib/storyboard/provider";
import { runStoryboardJob } from "@/lib/storyboard/run-job";
import { cleanShot } from "@/lib/storyboard/shot";
import { supabaseServer } from "@/lib/supabase/server";

export const maxDuration = 300;

export async function POST(req: Request, { params }: { params: Promise<{ sequenceId: string }> }) {
  const { sequenceId } = await params;
  const body = (await req.json().catch(() => null)) as {
    kind?: string; shotId?: string; baseAssetId?: string; idempotencyKey?: string; style?: string;
    library?: { kind?: string; name?: string; description?: string; views?: string; entity_id?: string | null };
  } | null;
  const no = (status: number, error: string, extra: Record<string, unknown> = {}) => NextResponse.json({ error, ...extra }, { status, headers: { "Cache-Control": "no-store" } });
  if (!body || (body.kind !== "illustrate" && body.kind !== "asset") || !/^[A-Za-z0-9_-]{8,120}$/.test(body.idempotencyKey ?? "")) return no(400, "That request was incomplete.");
  const provider = imageProvider();
  if (provider.missing) return no(503, provider.missing, { configRequired: true });
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return no(401, "Please sign in again.");
  const { data: seq } = await sb.from("storyboard_sequences").select("id, project_id, settings").eq("id", sequenceId).maybeSingle();
  if (!seq) return no(404, "Storyboard not found.");
  const style = isStyle(body.style) ? body.style : "pencil";

  let prompt: string, refs: { asset_id: string; role: string }[] = [], output = outputSize(16 / 9), library: Record<string, unknown> | null = null;
  if (body.kind === "illustrate") {
    const { data: shot } = await sb.from("storyboard_shots").select("id, content, composition").eq("id", body.shotId ?? "").eq("sequence_id", sequenceId).maybeSingle();
    if (!shot) return no(404, "Frame not found.");
    if (!body.baseAssetId) return no(400, "The frame's composition is missing.");
    const comp = cleanComposition(shot.composition);
    output = outputSize(comp.aspect);
    // Library images used in the frame go along as appearance references (up to the limit).
    const ids = libraryUse(comp);
    const { data: items } = ids.length ? await sb.from("storyboard_library").select("id, name, kind, asset_id").in("id", ids) : { data: [] as { id: string; name: string; kind: string; asset_id: string | null }[] };
    const withImg = (items ?? []).filter((i) => i.asset_id).slice(0, provider.capabilities.referenceImages - 1);
    refs = withImg.map((i) => ({ asset_id: i.asset_id as string, role: i.kind }));
    prompt = illustratePrompt(cleanShot(shot.content), style, withImg.map((i) => ({ name: i.name, kind: i.kind })));
  } else {
    const L = body.library ?? {};
    if (!L.name?.trim() || !L.description?.trim()) return no(400, "Give the asset a name and a description.");
    library = { kind: L.kind, name: L.name.slice(0, 120), description: L.description.slice(0, 1200), views: (L.views ?? "").slice(0, 300), entity_id: L.entity_id ?? null, sequence_id: sequenceId };
    output = L.kind === "background" ? outputSize(16 / 9) : outputSize(1);
    prompt = assetPrompt({ kind: String(L.kind), name: L.name, description: L.description, views: L.views ?? "" }, style);
  }

  const { data: rows, error } = await sb.rpc("storyboard_job_request", {
    p_project: seq.project_id, p_kind: body.kind, p_shot: body.kind === "illustrate" ? body.shotId : null, p_library: library,
    p_provider: provider.id, p_model: provider.model, p_prompt_version: PROMPT_VERSION, p_prompt: prompt,
    p_params: { style, output, provider: { id: provider.id, capabilities: provider.capabilities } },
    p_reference_assets: refs, p_base_asset: body.kind === "illustrate" ? body.baseAssetId : null, p_idempotency_key: body.idempotencyKey,
  });
  if (error || !rows?.[0]) return no(400, friendlyError(error).message);
  const { job_id: jobId, existing } = rows[0] as { job_id: string; existing: boolean };
  if (existing) {
    const { data: j } = await sb.from("storyboard_jobs").select("status, output_asset_id, error").eq("id", jobId).single();
    if (j?.status !== "queued") return NextResponse.json({ jobId, status: j?.status, assetId: j?.output_asset_id, error: j?.error, existing: true });
  }
  const res = await runStoryboardJob(sb, jobId, { provider });
  return NextResponse.json({ jobId, status: res.error ? "failed" : "succeeded", assetId: res.assetId, error: res.error }, { headers: { "Cache-Control": "no-store" } });
}
