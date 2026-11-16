// STORYBOARDS: build first, generate when needed. Start from text, script scenes or images
// (any mix), then compose frames by hand. Nothing on this page calls an AI model.
import Link from "next/link";
import { notFound } from "next/navigation";
import { Empty, Flash } from "@/components/flash";
import { IconFrames } from "@/components/icons";
import { CardThumb } from "@/components/storyboard/card-thumb";
import { ASPECTS } from "@/lib/storyboard/camera";
import { cleanComposition } from "@/lib/storyboard/compose";
import { createStoryboard } from "../storyboard-actions";
import { getProjectShell, getScreenplay } from "@/lib/data";
import { scriptScenes } from "@/lib/storyboard/review";
import { cleanShot, sequenceTiming } from "@/lib/storyboard/shot";
import { supabaseServer } from "@/lib/supabase/server";

export default async function StoryboardsPage({ params, searchParams }: {
  params: Promise<{ projectId: string }>; searchParams: Promise<{ error?: string; notice?: string; new?: string }>;
}) {
  const { projectId } = await params;
  const { error, notice, new: showNew } = await searchParams;
  const shell = await getProjectShell(projectId);
  if (!shell || !shell.caps.member) notFound();
  if (!shell.caps.can_review) return <Empty title="Storyboards are for the creative team">You can read the approved versions of this film.</Empty>;
  const sb = await supabaseServer();
  const [{ data: seqs }, sp] = await Promise.all([
    sb.from("storyboard_sequences").select("id, title, brief, updated_at").eq("project_id", projectId).is("archived_at", null).order("updated_at", { ascending: false }),
    getScreenplay(projectId),
  ]);
  const ids = (seqs ?? []).map((s) => s.id);
  const { data: shots } = ids.length
    ? await sb.from("storyboard_shots").select("sequence_id, position, content, composition, state").in("sequence_id", ids).is("archived_at", null).order("position")
    : { data: [] as { sequence_id: string; position: number; content: unknown; composition: unknown; state: string }[] };
  const { data: lib } = await sb.from("storyboard_library").select("id, asset_id").eq("project_id", projectId);
  const libAsset = new Map((lib ?? []).map((i) => [i.id, i.asset_id as string | null]));
  const body = String((sp as { versions?: { content: { body?: string } }[] } | null)?.versions?.[0]?.content?.body ?? "");
  const scenes = scriptScenes(body);
  const canEdit = !!shell.caps.can_edit;
  const creating = canEdit && (showNew === "1" || !(seqs ?? []).length);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <p className="eyebrow">Storyboards</p>
          <h1 className="display text-4xl leading-none sm:text-5xl">STORYBOARDS</h1>
          <p className="max-w-2xl text-muted">Turn a moment into a shot. Arrange figures, sets and your own drawings, frame by frame.</p>
        </div>
        {canEdit && !creating && <Link href={`/projects/${projectId}/storyboards?new=1`} className="btn-primary">New storyboard</Link>}
      </header>
      <Flash error={error} notice={notice} />

      {creating && (
        <form action={createStoryboard} className="panel flex flex-col gap-5 p-5" aria-labelledby="new-sb">
          <input type="hidden" name="projectId" value={projectId} />
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="new-sb" className="font-semibold">New storyboard</h2>
            <p className="text-xs text-muted">Use any of the three, or mix them.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_14rem]">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Name this storyboard</span>
              <input name="title" className="field" placeholder="e.g. The explosion at the café" maxLength={120} required />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Frame shape</span>
              <select name="aspect" className="field" defaultValue={String(16 / 9)}>
                {ASPECTS.map((a) => <option key={a.id} value={a.ratio}>{a.label}</option>)}
                <option value={9 / 16}>9:16 (vertical)</option>
              </select>
            </label>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <fieldset className="flex flex-col gap-2 border border-line p-3">
              <legend className="px-1 text-sm font-semibold">1 · Start with text</legend>
              <p className="help">Describe a moment, or paste part of a scene.</p>
              <textarea name="brief" rows={6} className="field" maxLength={6000} placeholder="Johnny is drinking coffee when an explosion shakes the windows…" />
            </fieldset>
            <fieldset className="flex flex-col gap-2 border border-line p-3">
              <legend className="px-1 text-sm font-semibold">2 · Use your script</legend>
              {scenes.length ? (
                <>
                  <p className="help">Pick scenes. Each starts as one frame with your own words as its action.</p>
                  <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto">
                    {scenes.map((s) => (
                      <li key={s.number}>
                        <label className="flex items-start gap-2 text-sm">
                          <input type="checkbox" name="scene" value={s.number} className="mt-1" />
                          <span><b>{s.number}.</b> {s.heading}<span className="block text-xs text-muted line-clamp-2">{s.text}</span></span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </>
              ) : <p className="help">No scenes in the Script desk yet.</p>}
            </fieldset>
            <fieldset className="flex flex-col gap-2 border border-line p-3">
              <legend className="px-1 text-sm font-semibold">3 · Start with images</legend>
              <p className="help">Your drawings, backgrounds or references. You&apos;ll add them next to your asset library and say what each one is for.</p>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="images" value="1" /> I&apos;ll add images</label>
            </fieldset>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" type="submit">Start composing</button>
            {(seqs ?? []).length > 0 && <Link href={`/projects/${projectId}/storyboards`} className="btn">Cancel</Link>}
          </div>
        </form>
      )}

      {(seqs ?? []).length > 0 && (
        <section aria-labelledby="sb-list" className="flex flex-col gap-3">
          <h2 id="sb-list" className="eyebrow">Your storyboards</h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(seqs ?? []).map((s) => {
              const mine = (shots ?? []).filter((x) => x.sequence_id === s.id);
              const first = mine[0] ? cleanComposition(mine[0].composition) : null;
              const thumb = first && first.layers.length ? { ...first, layers: first.layers.map((l) => (l.libraryId && libAsset.get(l.libraryId) ? { ...l, assetId: libAsset.get(l.libraryId)! } : l)) } : null;
              const t = sequenceTiming(mine.map((x) => ({ content: cleanShot(x.content) })));
              return (
                <li key={s.id}>
                  <Link href={`/projects/${projectId}/storyboards/${s.id}`} className="panel flex h-full flex-col hover:border-text">
                    <div className="aspect-video w-full overflow-hidden bg-line/40">
                      {thumb ? <CardThumb comp={thumb} /> : <div className="flex size-full items-center justify-center text-muted"><IconFrames className="size-8" /></div>}
                    </div>
                    <div className="flex flex-col gap-1 p-3">
                      <p className="font-semibold">{s.title}</p>
                      <p className="text-xs text-muted">{mine.length} {mine.length === 1 ? "frame" : "frames"} · {mine.filter((x) => x.state === "approved").length} approved · {t.label}</p>
                      {s.brief && <p className="line-clamp-2 text-sm text-muted">{s.brief}</p>}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
