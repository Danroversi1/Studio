// One storyboard in Compose. Opening it never calls a model: it reads frames, the asset
// library and the film's characters/places, and marks frames whose script scene, character
// or location changed (deterministic text comparison; images and layers are kept).
import { notFound } from "next/navigation";
import { Empty, Flash } from "@/components/flash";
import { StoryboardStudio } from "@/components/storyboard/studio";
import { getFilmEntities, getLook } from "@/lib/look/data";
import { cleanFrameLook } from "@/lib/look/types";
import { lensFromRow, type FilmItem, type FrameRow, type JobRow, type LibItem, type StockRef } from "@/components/storyboard/types";
import { openingFor } from "@/lib/agents/partners";
import { aiConfigured } from "@/lib/ai/configured";
import { getAiBudget, getPartnerThreads, getProjectShell, getScreenplay, getThreadMessages } from "@/lib/data";
import { cleanComposition } from "@/lib/storyboard/compose";
import { imageProvider } from "@/lib/storyboard/provider";
import { reviewFor, scriptScenes } from "@/lib/storyboard/review";
import { cleanShot } from "@/lib/storyboard/shot";
import { supabaseServer } from "@/lib/supabase/server";

export default async function StoryboardPage({ params, searchParams }: {
  params: Promise<{ projectId: string; sequenceId: string }>;
  searchParams: Promise<{ frame?: string; panel?: string; error?: string; notice?: string }>;
}) {
  const { projectId, sequenceId } = await params;
  const { frame: frameParam, panel, error, notice } = await searchParams;
  const shell = await getProjectShell(projectId);
  if (!shell || !shell.caps.member) notFound();
  if (!shell.caps.can_review) return <Empty title="Storyboards are for the creative team">You can read the approved versions of this film.</Empty>;
  const sb = await supabaseServer();
  const { data: seq } = await sb.from("storyboard_sequences").select("id, entity_id, title, settings, archived_at, look_direction_id").eq("id", sequenceId).eq("project_id", projectId).maybeSingle();
  if (!seq || seq.archived_at) notFound();
  const canEdit = !!shell.caps.can_edit;
  const aspect = Number((seq.settings as { aspect?: number } | null)?.aspect) || 16 / 9;

  const [look, lookEntities] = await Promise.all([getLook(projectId), getFilmEntities(projectId)]);
  const [{ data: shotRows }, { data: libRows }, { data: jobRows }, { data: ents }, { data: stocks }, { data: lensRows }, sp, threads, budget] = await Promise.all([
    sb.from("storyboard_shots").select("*").eq("sequence_id", sequenceId).is("archived_at", null).order("position"),
    sb.from("storyboard_library").select("*").eq("project_id", projectId).is("archived_at", null).order("created_at"),
    sb.from("storyboard_jobs").select("id, shot_id, kind, status, output_asset_id, applied, error, created_at, model, usage").eq("sequence_id", sequenceId).order("created_at", { ascending: false }).limit(200),
    sb.from("entities").select("id, kind, name").eq("project_id", projectId).in("kind", ["character", "location"]).neq("status", "archived").order("created_at"),
    sb.from("storyboard_stock_profiles").select("*").order("id"),
    sb.from("storyboard_lens_shelf").select("*").eq("project_id", projectId).is("archived_at", null).order("created_at"),
    getScreenplay(projectId),
    getPartnerThreads(projectId, "shots"),
    getAiBudget(projectId),
  ]);
  const entIds = (ents ?? []).map((e) => e.id);
  const { data: art } = entIds.length
    ? await sb.from("assets").select("id, entity_id, created_at").in("entity_id", entIds).eq("upload_status", "ready").eq("kind", "image").order("created_at", { ascending: false })
    : { data: [] as { id: string; entity_id: string }[] };
  const film: FilmItem[] = (ents ?? []).map((e) => ({ id: e.id, kind: e.kind as FilmItem["kind"], name: e.name, assetId: (art ?? []).find((a) => a.entity_id === e.id)?.id ?? null }));

  const body = String((sp as { versions?: { content: { body?: string } }[] } | null)?.versions?.[0]?.content?.body ?? "");
  const scenes = scriptScenes(body);
  const frames: FrameRow[] = [];
  for (const r of shotRows ?? []) {
    const content = cleanShot(r.content);
    let review = r.review as FrameRow["review"];
    if (!review && canEdit && (content.source?.kind !== "script" || body)) {
      const note = reviewFor(content, { scenes, cast: film.filter((f) => f.kind === "character").map((f) => f.name), locations: film.filter((f) => f.kind === "location").map((f) => f.name) });
      if (note) { const { error: e } = await sb.rpc("storyboard_shot_review", { p_shot: r.id, p_review: note }); if (!e) review = note; }
    }
    frames.push({
      id: r.id, position: r.position, state: r.state, locked: r.locked, origin: r.origin, revision: r.revision, approvedRevision: r.approved_revision,
      content, composition: cleanComposition(r.composition, aspect), compositionVersion: r.composition_version, illustrationAssetId: r.illustration_asset_id,
      review, notes: r.notes ?? "", look: cleanFrameLook(r.look),
    });
  }
  const library: LibItem[] = (libRows ?? []).map((i) => ({
    id: i.id, kind: i.kind, name: i.name, assetId: i.asset_id, entityId: i.entity_id, parentId: i.parent_id, views: i.views, purpose: i.purpose, note: i.note,
    usage: i.usage, sourceUrl: i.source_url, attribution: i.attribution, permission: i.permission, origin: i.origin, version: i.version,
  }));
  const jobs: JobRow[] = (jobRows ?? []).map((j) => ({ id: j.id, shotId: j.shot_id, kind: j.kind, status: j.status, outputAssetId: j.output_asset_id, applied: j.applied, error: j.error, createdAt: j.created_at, model: j.model, usage: j.usage }));
  const current = threads[0] ?? null;
  const messages = current ? await getThreadMessages(projectId, current.id) : [];
  const provider = imageProvider();
  const textMissing = !aiConfigured() ? "The AI team isn't set up yet." : !budget.available ? "This month's AI budget is used up." : null;
  const tab = (["assets", "layers", "frame", "camera", "look", "refs"] as const).find((t) => t === panel);

  return (
    <div className="mx-auto flex max-w-[110rem] flex-col gap-3">
      <Flash error={error} notice={notice} />
      <StoryboardStudio projectId={projectId} sequenceId={sequenceId} entityId={seq.entity_id} title={seq.title} settings={{ aspect }}
        frames={frames} library={library} jobs={jobs} film={film} stocks={(stocks ?? []) as StockRef[]} lenses={(lensRows ?? []).map(lensFromRow)}
        lookRefs={look.refs} directions={look.directions} lookEntities={lookEntities} sequenceDirection={(seq.look_direction_id as string | null) ?? null} canEdit={canEdit}
        initialFrame={frameParam} initialTab={tab} scenes={scenes}
        ai={{ imageMissing: provider.missing ? "Needs an OpenAI API key (OPENAI_API_KEY) in Vercel." : null, textAvailable: textMissing,
          builder: { threadId: current?.id ?? null, messages: messages.map((m) => ({ id: m.id, role: m.role, content: m.content })), opening: openingFor("shots", { hasStory: true, runtime: null, filmTitle: shell.project.name }) } }} />
    </div>
  );
}
