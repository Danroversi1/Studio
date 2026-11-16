// Generate one storyboard frame, variation, edit or look preview for a shot. The prompt is
// built here from the saved shot (so what's stored is exactly what was sent), every setting
// is snapshotted on the job, and the same idempotency key never makes a second job.
import { NextResponse } from "next/server";
import { distanceForFraming, fieldOfView, usedArea } from "@/lib/storyboard/camera";
import { buildPrompt, outputSize, PROMPT_VERSION, type PromptRef } from "@/lib/storyboard/prompt";
import { imageProvider } from "@/lib/storyboard/provider";
import { runStoryboardJob } from "@/lib/storyboard/run-job";
import { cleanShot, STYLES, type Style } from "@/lib/storyboard/shot";
import { composeSentence, toWorld } from "@/lib/world";
import { friendlyError } from "@/lib/errors";
import { supabaseServer } from "@/lib/supabase/server";

export const maxDuration = 300;

const KINDS = ["frame", "variation", "edit", "look"] as const;

export async function POST(req: Request, { params }: { params: Promise<{ sequenceId: string }> }) {
  const { sequenceId } = await params;
  const body = (await req.json().catch(() => null)) as {
    shotId?: string; kind?: string; style?: string; finishId?: string; stockId?: string; editInstruction?: string; idempotencyKey?: string;
  } | null;
  const no = (status: number, error: string, extra: Record<string, unknown> = {}) =>
    NextResponse.json({ error, ...extra }, { status, headers: { "Cache-Control": "no-store" } });
  if (!body?.shotId || !KINDS.includes(body.kind as never) || !/^[A-Za-z0-9_-]{8,120}$/.test(body.idempotencyKey ?? "")) return no(400, "That request was incomplete.");
  const kind = body.kind as (typeof KINDS)[number];
  const mode = kind === "look" ? "look" : "storyboard";

  const provider = imageProvider();
  if (provider.missing) return no(503, provider.missing, { configRequired: true });

  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return no(401, "Please sign in again.");
  const { data: seq } = await sb.from("storyboard_sequences").select("id, project_id, settings").eq("id", sequenceId).maybeSingle();
  const { data: shot } = await sb.from("storyboard_shots").select("id, content, frame_asset_id, look_asset_id, locked").eq("id", body.shotId).eq("sequence_id", sequenceId).is("archived_at", null).maybeSingle();
  if (!seq || !shot) return no(404, "Shot not found.");
  const projectId = seq.project_id as string;
  const content = cleanShot(shot.content);
  const settings = (seq.settings ?? {}) as { style?: string; aspect?: number; finishId?: string; stockId?: string };

  // Base frame: a look preview keeps the storyboard's composition; variations and edits start from the current frame.
  const base: string | null = kind === "frame" ? null : (shot.frame_asset_id as string | null);
  if ((kind === "variation" || kind === "edit") && !base) return no(400, "Make a frame first, then you can vary or edit it.");
  if (kind === "edit" && !(body.editInstruction ?? "").trim()) return no(400, "Say what to change.");

  const [{ data: refs }, { data: ents }, { data: worldRow }] = await Promise.all([
    sb.from("storyboard_refs").select("id, shot_id, asset_id, entity_id, url, title, role, borrow, ignore, access").eq("sequence_id", sequenceId),
    sb.from("entities").select("id, kind, name, current_version_id").eq("project_id", projectId).in("kind", ["character", "location"]).neq("status", "archived"),
    sb.from("story_world").select("data, version").eq("project_id", projectId).maybeSingle(),
  ]);
  const entIds = (ents ?? []).map((e) => e.id);
  const { data: vers } = entIds.length
    ? await sb.from("versions").select("entity_id, version_number, content").in("entity_id", entIds).order("version_number", { ascending: false })
    : { data: [] as { entity_id: string; content: { summary?: string } }[] };
  const summary = new Map<string, string>();
  for (const v of vers ?? []) if (!summary.has(v.entity_id)) summary.set(v.entity_id, String(v.content?.summary ?? ""));
  const cast = (ents ?? []).filter((e) => e.kind === "character").map((e) => ({ name: e.name as string, summary: summary.get(e.id) ?? "" }));
  const locations = (ents ?? []).filter((e) => e.kind === "location").map((e) => ({ name: e.name as string, summary: summary.get(e.id) ?? "" }));

  // References for this shot: the sequence's continuity references plus the shot's own.
  const mine = (refs ?? []).filter((r) => !r.shot_id || r.shot_id === shot.id);
  const room = provider.capabilities.referenceImages - (base ? 1 : 0);
  const attached: { asset_id: string; role: string }[] = [];
  const promptRefs: PromptRef[] = [];
  const textOnly: { ref_id: string; role: string; reason: string }[] = [];
  for (const r of mine) {
    let assetId: string | null = r.asset_id;
    if (!assetId && r.entity_id) {
      const { data: a } = await sb.from("assets").select("id").eq("entity_id", r.entity_id).eq("upload_status", "ready").eq("kind", "image")
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      assetId = a?.id ?? null;
    }
    const ent = r.entity_id ? (ents ?? []).find((e) => e.id === r.entity_id) : null;
    const title = r.title || ent?.name || "";
    if (assetId && attached.length < room) {
      attached.push({ asset_id: assetId, role: r.role });
      promptRefs.push({ role: r.role, title, borrow: r.borrow, ignore: r.ignore, attached: true });
    } else {
      const why = r.url ? "a link nobody has imported (not checked or licensed)" : assetId ? "over the image limit" : "described in words only";
      textOnly.push({ ref_id: r.id, role: r.role, reason: why });
      promptRefs.push({ role: r.role, title: `${title}${ent && summary.get(ent.id) ? ` — ${summary.get(ent.id)!.slice(0, 160)}` : ""}`, borrow: r.borrow, ignore: r.ignore, attached: false });
    }
  }

  const libs = await Promise.all([
    content.lensId ? sb.from("storyboard_lens_profiles").select("*").eq("id", content.lensId).maybeSingle() : Promise.resolve({ data: null }),
    mode === "look" ? sb.from("storyboard_stock_profiles").select("*").eq("id", body.stockId || settings.stockId || "").maybeSingle() : Promise.resolve({ data: null }),
    mode === "look" ? sb.from("storyboard_finish_presets").select("*").eq("id", body.finishId || settings.finishId || "none").maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const [lens, stock, finish] = libs.map((x) => x.data as Record<string, unknown> | null);
  const style = (STYLES.some(([k]) => k === body.style) ? body.style : STYLES.some(([k]) => k === settings.style) ? settings.style : "pencil") as Style;
  const aspect = content.camera?.aspect ?? settings.aspect ?? 16 / 9;
  const output = outputSize(aspect);
  const world = toWorld(worldRow);
  const prompt = buildPrompt({
    shot: content, mode, kind, style, aspect, cast, locations,
    world: world ? (world.confirmed.summary?.value.text ?? composeSentence(world.confirmed)) : null,
    refs: promptRefs, lens: lens as never, stock: stock as never, finish: finish as never,
    editInstruction: body.editInstruction?.slice(0, 600), baseIsStoryboard: mode === "look" && !!base,
  });
  const cam = content.camera ?? {};
  const snapshot = {
    mode, kind, style, aspect, output, shot: content,
    geometry: cam.focalMm ? { fov: fieldOfView(cam), used_area_mm: usedArea(cam), framing_distance_m: content.size ? distanceForFraming(cam, content.size) : null, note: "creative guidance; the image model interprets it approximately" } : null,
    lens, stock, finish, provider: { id: provider.id, capabilities: provider.capabilities },
    edit_instruction: kind === "edit" ? body.editInstruction?.slice(0, 600) : undefined,
  };

  const { data: reqRows, error } = await sb.rpc("storyboard_job_request", {
    p_shot: shot.id, p_kind: kind, p_mode: mode, p_provider: provider.id, p_model: provider.model, p_prompt_version: PROMPT_VERSION,
    p_prompt: prompt, p_params: JSON.parse(JSON.stringify(snapshot)), p_reference_assets: attached, p_text_only_refs: textOnly,
    p_base_asset: base, p_idempotency_key: body.idempotencyKey,
  });
  if (error || !reqRows?.[0]) return no(400, friendlyError(error).message);
  const { job_id: jobId, existing } = reqRows[0] as { job_id: string; existing: boolean };
  if (existing) {
    const { data: j } = await sb.from("storyboard_jobs").select("status, output_asset_id, error").eq("id", jobId).single();
    if (j?.status !== "queued") return NextResponse.json({ jobId, status: j?.status, assetId: j?.output_asset_id, error: j?.error, existing: true });
  }
  const res = await runStoryboardJob(sb, jobId, { provider });
  return NextResponse.json({ jobId, status: res.error ? "failed" : "succeeded", assetId: res.assetId, error: res.error, textOnly: textOnly.length },
    { headers: { "Cache-Control": "no-store" } });
}
