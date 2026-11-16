// STORYBOARDS: turn a moment into a shot. Start with text, with scenes from the script, or
// with images (or any mix), then develop shots with the Shot Builder.
import Link from "next/link";
import { notFound } from "next/navigation";
import { Empty, Flash } from "@/components/flash";
import { IconFrames } from "@/components/icons";
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
    ? await sb.from("storyboard_shots").select("sequence_id, position, content, frame_asset_id, state").in("sequence_id", ids).is("archived_at", null).order("position")
    : { data: [] as { sequence_id: string; position: number; content: unknown; frame_asset_id: string | null; state: string }[] };
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
          <p className="max-w-2xl text-muted">Turn a moment into a shot.</p>
        </div>
        {canEdit && !creating && <Link href={`/projects/${projectId}/storyboards?new=1`} className="btn-primary">Create Your Frame</Link>}
      </header>
      <Flash error={error} notice={notice} />

      {creating && (
        <form action={createStoryboard} className="panel flex flex-col gap-5 p-5" aria-labelledby="new-sb">
          <input type="hidden" name="projectId" value={projectId} />
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="new-sb" className="font-semibold">Create Your Frame</h2>
            <p className="text-xs text-muted">Use any of the three, or mix them.</p>
          </div>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Name this storyboard</span>
            <input name="title" className="field" placeholder="e.g. The explosion at the café" maxLength={120} required />
          </label>
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
                  <p className="help">Pick scenes. Each starts as one shot with your own words; the Shot Builder can help break it down.</p>
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
              <p className="help">Your drawings or visual references. You&apos;ll add them next and say what each one is for (a character, a place, the drawing style…).</p>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="images" value="1" /> I&apos;ll add images</label>
            </fieldset>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" type="submit">Create Your Frame</button>
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
              const thumb = mine.find((x) => x.frame_asset_id)?.frame_asset_id;
              const t = sequenceTiming(mine.map((x) => ({ content: cleanShot(x.content) })));
              return (
                <li key={s.id}>
                  <Link href={`/projects/${projectId}/storyboards/${s.id}`} className="panel flex h-full flex-col hover:border-text">
                    <div className="aspect-video w-full bg-line/40">
                      {thumb
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={`/api/assets/${thumb}`} alt="" className="size-full object-cover" loading="lazy" />
                        : <div className="flex size-full items-center justify-center text-muted"><IconFrames className="size-8" /></div>}
                    </div>
                    <div className="flex flex-col gap-1 p-3">
                      <p className="font-semibold">{s.title}</p>
                      <p className="text-xs text-muted">{mine.length} {mine.length === 1 ? "shot" : "shots"} · {mine.filter((x) => x.state === "approved").length} approved · {t.label}</p>
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
