// One storyboard: shot list · frame · settings and Shot Builder. On each visit, shots whose
// script scene, characters or location changed are marked for review (images are kept).
import { notFound } from "next/navigation";
import { Empty, Flash } from "@/components/flash";
import { StoryboardEditor, type EditorJob, type EditorRef, type EditorShot, type Lib } from "@/components/storyboard/editor";
import { openingFor } from "@/lib/agents/partners";
import { aiConfigured } from "@/lib/agents/run-story-breakdown";
import { getAiBudget, getPartnerThreads, getProjectShell, getScreenplay, getThreadMessages } from "@/lib/data";
import { imageProvider } from "@/lib/storyboard/provider";
import { reviewFor, scriptScenes } from "@/lib/storyboard/review";
import { cleanShot } from "@/lib/storyboard/shot";
import { supabaseServer } from "@/lib/supabase/server";

export const maxDuration = 300;

export default async function StoryboardPage({ params, searchParams }: {
  params: Promise<{ projectId: string; sequenceId: string }>;
  searchParams: Promise<{ shot?: string; panel?: string; error?: string; notice?: string }>;
}) {
  const { projectId, sequenceId } = await params;
  const { shot: shotParam, panel, error, notice } = await searchParams;
  const shell = await getProjectShell(projectId);
  if (!shell || !shell.caps.member) notFound();
  if (!shell.caps.can_review) return <Empty title="Storyboards are for the creative team">You can read the approved versions of this film.</Empty>;
  const sb = await supabaseServer();
  const { data: seq } = await sb.from("storyboard_sequences").select("id, entity_id, title, brief, settings, archived_at").eq("id", sequenceId).eq("project_id", projectId).maybeSingle();
  if (!seq || seq.archived_at) notFound();
  const canEdit = !!shell.caps.can_edit;

  const [{ data: shotRows }, { data: jobRows }, { data: refRows }, { data: lenses }, { data: stocks }, { data: finishes }, { data: ents }, sp, threads, budget] = await Promise.all([
    sb.from("storyboard_shots").select("*").eq("sequence_id", sequenceId).is("archived_at", null).order("position"),
    sb.from("storyboard_jobs").select("id, shot_id, kind, mode, status, output_asset_id, applied, error, created_at, model, usage, text_only_refs, reference_assets, source_revision, params")
      .eq("sequence_id", sequenceId).order("created_at", { ascending: false }).limit(400),
    sb.from("storyboard_refs").select("*").eq("sequence_id", sequenceId).order("created_at"),
    sb.from("storyboard_lens_profiles").select("*").order("manufacturer"),
    sb.from("storyboard_stock_profiles").select("*").order("id"),
    sb.from("storyboard_finish_presets").select("*").order("id"),
    sb.from("entities").select("id, kind, name").eq("project_id", projectId).in("kind", ["character", "location"]).neq("status", "archived").order("created_at"),
    getScreenplay(projectId),
    getPartnerThreads(projectId, "shots"),
    getAiBudget(projectId),
  ]);
  const cast = (ents ?? []).filter((e) => e.kind === "character").map((e) => ({ id: e.id as string, name: e.name as string }));
  const locations = (ents ?? []).filter((e) => e.kind === "location").map((e) => ({ id: e.id as string, name: e.name as string }));

  // Mark shots for review when what they came from changed (never touches images or notes).
  const body = String((sp as { versions?: { content: { body?: string } }[] } | null)?.versions?.[0]?.content?.body ?? "");
  const scenes = scriptScenes(body);
  const shots: EditorShot[] = [];
  for (const r of shotRows ?? []) {
    const content = cleanShot(r.content);
    let review = r.review as EditorShot["review"];
    if (!review && canEdit) {
      const note = reviewFor(content, { scenes, cast: cast.map((c) => c.name), locations: locations.map((l) => l.name) });
      if (note && (content.source?.kind !== "script" || body)) {
        const { error: e } = await sb.rpc("storyboard_shot_review", { p_shot: r.id, p_review: note });
        if (!e) review = note;
      }
    }
    shots.push({
      id: r.id, position: r.position, state: r.state, locked: r.locked, origin: r.origin, revision: r.revision, approvedRevision: r.approved_revision,
      content, frameAssetId: r.frame_asset_id, lookAssetId: r.look_asset_id, review, notes: r.notes ?? "",
    });
  }
  const jobs: EditorJob[] = (jobRows ?? []).map((j) => ({
    id: j.id, shotId: j.shot_id, kind: j.kind, mode: j.mode, status: j.status, outputAssetId: j.output_asset_id, applied: j.applied, error: j.error,
    createdAt: j.created_at, model: j.model, usage: j.usage, textOnly: (j.text_only_refs ?? []).length, refs: (j.reference_assets ?? []).length,
    sourceRevision: j.source_revision, finishId: (j.params as { finish?: { id?: string } } | null)?.finish?.id ?? null,
  }));
  const refs: EditorRef[] = (refRows ?? []).map((r) => ({
    id: r.id, shotId: r.shot_id, assetId: r.asset_id, entityId: r.entity_id, url: r.url,
    title: r.title || (r.entity_id ? (ents ?? []).find((e) => e.id === r.entity_id)?.name ?? "" : ""), role: r.role,
    borrow: r.borrow, ignore: r.ignore, access: r.access, attribution: r.attribution,
  }));
  const current = threads[0] ?? null;
  const messages = current ? await getThreadMessages(projectId, current.id) : [];
  const provider = imageProvider();

  return (
    <div className="mx-auto flex max-w-[110rem] flex-col gap-4">
      <Flash error={error} notice={notice} />
      <StoryboardEditor projectId={projectId} sequenceId={sequenceId} entityId={seq.entity_id} title={seq.title} brief={seq.brief}
        settings={(seq.settings ?? {}) as { style?: string; aspect?: number; finishId?: string; stockId?: string }}
        shots={shots} jobs={jobs} refs={refs} lib={{ lenses: lenses ?? [], stocks: stocks ?? [], finishes: finishes ?? [] } as Lib}
        cast={cast} locations={locations} canEdit={canEdit} providerMissing={provider.missing}
        initialShot={shotParam} initialPanel={panel === "refs" || panel === "builder" || panel === "look" ? panel : undefined}
        builder={{
          threadId: current?.id ?? null,
          messages: messages.map((m) => ({ id: m.id, role: m.role, content: m.content })),
          unavailable: !aiConfigured() ? "The AI team isn't set up yet. Ask your Executive Producer." : !budget.available ? "This month's AI budget is used up. Ask your Executive Producer." : null,
          opening: openingFor("shots", { hasStory: true, runtime: null, filmTitle: shell.project.name }),
        }} />
    </div>
  );
}
