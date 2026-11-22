// WORLD & TIME: where the story lives, when it unfolds, and how much time it spans,
// with the World Builder beside it. Film length (how long the audience watches) is the
// one set on the Story desk; it isn't stored again here.
import Link from "next/link";
import { notFound } from "next/navigation";
import { Empty, Flash } from "@/components/flash";
import { LengthPicker } from "@/components/length-picker";
import { PartnerChat } from "@/components/partner-chat";
import { SubmitButton } from "@/components/ui";
import { WorldCards } from "@/components/world-cards";
import { WorldDeeper } from "@/components/world-deeper";
import { WorldReadAuto } from "@/components/world-read-auto";
import { KnowledgeBase } from "@/components/knowledge/knowledge-base";
import { getKnowledge } from "@/lib/knowledge/data";
import { SimDesk } from "@/components/sim/sim-desk";
import { KnowledgeTimeline } from "@/components/timeline/knowledge-timeline";
import { bufferFor, loadTimeline } from "@/lib/knowledge/timeline-data";
import { RulesBox } from "@/components/sim/rules-box";
import { ruleSentence } from "@/lib/sim/rules";
import { SocietyPanel } from "@/components/society/society-panel";
import { getSociety } from "@/lib/society/data";
import { supabaseServer } from "@/lib/supabase/server";
import { getSimulation } from "@/lib/sim/data";
import { PARTNERS, openingFor } from "@/lib/agents/partners";
import { aiConfigured } from "@/lib/agents/run-story-breakdown";
import { getAiBudget, getAllReferences, getLatestVersions, getNotebook, getPartnerThreads, getProjectShell, getThreadMessages, getWorld, getWorldSentenceVersions } from "@/lib/data";
import { runtimeInfo } from "@/lib/runtime";
import { composeSentence, isEmptyWorld } from "@/lib/world";
import { addReference, updateNote } from "../actions";

export const maxDuration = 300;

export default async function WorldPage({ params, searchParams }: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ thread?: string; new?: string; error?: string; notice?: string }>;
}) {
  const { projectId } = await params;
  const { thread, new: fresh, error, notice } = await searchParams;
  const shell = await getProjectShell(projectId);
  if (!shell || !shell.caps.member) notFound();
  if (!shell.caps.can_review) return <Empty title="World & Time is for the creative team">You can read the approved versions of this film.</Empty>;
  const caps = shell.caps;
  const base = `/projects/${projectId}/world`;

  const [world, threads, budget, notebook, refs, latest, kb, sentenceVersions, sim, society, tl] = await Promise.all([
    getWorld(projectId), getPartnerThreads(projectId, "world"), getAiBudget(projectId), getNotebook(projectId),
    getAllReferences(projectId), getLatestVersions(projectId), getKnowledge(projectId), getWorldSentenceVersions(projectId), getSimulation(projectId), supabaseServer().then((sb) => getSociety(sb, projectId)),
    supabaseServer().then((sb) => loadTimeline(sb, projectId)),
  ]);
  const buffers = Object.fromEntries(tl.characters.filter((c) => c.tier === "ahead").map((c) => [c.id, bufferFor(tl, c.id)]));
  const current = fresh ? null : (threads.find((t) => t.id === thread) ?? threads[0] ?? null);
  const messages = current ? await getThreadMessages(projectId, current.id) : [];
  const story = shell.entities.find((e) => e.kind === "story");
  const storyText = story ? String(latest.get(story.id)?.content?.body ?? "") : "";
  const hasScript = true;
  const locations = shell.entities.filter((e) => e.kind === "location").map((e) => ({ id: e.id, name: e.name }));
  const runtime = (shell.project as { runtime?: string | null }).runtime ?? null;
  const rt = runtimeInfo(runtime);
  const reviews = notebook.filter((n) => n.kind === "question" && n.status === "open" && n.body.startsWith("Review after"));
  const worldRefs = refs.filter((r) => (r.observations ?? "").startsWith("World & Time"));
  const unavailable = !aiConfigured()
    ? "The AI team isn't set up yet. Ask your Executive Producer."
    : !budget.available ? "This month's AI budget is used up. Ask your Executive Producer." : null;
  const sentence = world.confirmed.summary?.value.text ?? composeSentence(world.confirmed);
  const autoRead = caps.can_edit && !unavailable && isEmptyWorld(world) && !!(storyText.trim() || shell.project.description);

  return (
    <div className="mx-auto grid max-w-7xl grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1fr)_22rem] 2xl:grid-cols-[minmax(0,1fr)_26rem]">
      <div className="flex min-w-0 flex-col gap-5">
        <header className="flex flex-col gap-2">
          <p className="eyebrow">{shell.project.name}</p>
          <h1 className="display text-4xl leading-none sm:text-5xl">World &amp; Time</h1>
          <p className="max-w-2xl text-muted">Where your story lives. When it unfolds. How it moves, day by day.</p>
        </header>
        <Flash error={error} notice={notice} />

        {rt ? (
          <p className="text-sm text-muted">
            Film length: <span className="text-text">{rt.label.toLowerCase()}</span>: how long the audience watches.
            The story itself can span much more. {story && <Link className="text-accent" href={`/projects/${projectId}/items/${story.id}`}>Change on the Story desk</Link>}
          </p>
        ) : caps.can_edit ? (
          <div className="max-w-xl">
            <LengthPicker projectId={projectId} back={base} runtime={null} canEdit helpHref={`${base}#builder`} />
          </div>
        ) : null}

        {autoRead && <WorldReadAuto projectId={projectId} />}
        <WorldCards projectId={projectId} world={world} canEdit={!!caps.can_edit} locations={locations} sentenceVersions={sentenceVersions} />

        {reviews.length > 0 && (
          <section className="panel flex flex-col gap-2 p-5" aria-labelledby="review-h">
            <h2 id="review-h" className="eyebrow text-text">May need review</h2>
            <p className="text-xs text-muted">Your setting changed. Nothing else was changed for you: these are things to look at when you&apos;re ready.</p>
            <ul className="flex flex-col">
              {reviews.map((n) => (
                <li key={n.id} className="flex flex-wrap items-start justify-between gap-2 border-t border-line py-2 text-sm">
                  <span className="max-w-2xl">{n.body}</span>
                  {caps.can_edit && (
                    <form action={updateNote}>
                      <input type="hidden" name="projectId" value={projectId} />
                      <input type="hidden" name="itemId" value={n.id} />
                      <input type="hidden" name="status" value="done" />
                      <input type="hidden" name="back" value={base} />
                      <SubmitButton pendingText="…">Done</SubmitButton>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        <WorldDeeper projectId={projectId} version={world.version} value={world.confirmed.deeper?.value ?? {}} canEdit={!!caps.can_edit}
          locationCount={locations.length} hasScript={hasScript} />

        <section id="world-knowledge" className="flex scroll-mt-6 flex-col gap-3" aria-labelledby="wk-h">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-2">
            <h2 id="wk-h" className="display text-3xl">World knowledge base</h2>
            <Link className="text-sm text-accent" href={`/projects/${projectId}/knowledge?world=1`}>Also in the Knowledge Base →</Link>
          </div>
          <KnowledgeBase projectId={projectId} canEdit={!!caps.can_edit} sources={kb.sources} items={kb.items}
            collections={kb.collections} members={kb.members} references={kb.references} used={kb.usedByCharacters}
            characters={kb.characters} selectedCharacter={null} impressions={kb.impressions} aiReady={aiConfigured()} worldOpen worldOnly />
          <SocietyPanel projectId={projectId} canEdit={!!caps.can_edit} s={society} />
          <RulesBox projectId={projectId} family="periphery" name="the world" canEdit={!!caps.can_edit}
            key={sim.rules.filter((r) => r.family === "periphery").map((r) => `${r.id}:${r.version}`).join(",")}
            initial={sim.rules.filter((r) => r.family === "periphery").map((r) => ruleSentence(r, null))}
            title="How the world works"
            intro="Your rules for the world around the story, as bullet points, one per line: how news spreads, what reaches whom, how people and institutions respond. The day-by-day simulation follows them when it suggests events. They never set anyone's feelings (that's each character's own rules). Changes apply from the next day."
            placeholder={"- Big tech news from San Francisco reaches Washington by the next morning\n- Governments respond to AI breakthroughs within days\n- Ordinary people hear about research papers only through the news"} />
        </section>

        <section id="simulation" className="flex scroll-mt-6 flex-col gap-3" aria-labelledby="sim-h">
          <div className="flex flex-col gap-1 border-b border-line pb-2">
            <h2 id="sim-h" className="display text-3xl">The world, day by day</h2>
            <p className="max-w-3xl text-sm text-muted">
              Each day, what&apos;s happening in your World and in your story can suggest a few small events: how your characters might feel, and what they might do next.
              Nothing becomes part of the story until you approve it, and dialogue is only written from approved events.
            </p>
          </div>
          <SimDesk projectId={projectId} canEdit={!!caps.can_edit} canApprove={!!caps.can_approve_canonical} aiReady={aiConfigured()} sim={sim} />
        </section>

        <KnowledgeTimeline projectId={projectId} canEdit={!!caps.can_edit} tl={tl} buffers={buffers} />

        <details className="panel p-5">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
            <span>
              <span className="eyebrow block text-text">Visual reference</span>
              <span className="text-sm text-muted">Optional: an image, drawing or mood board for your world{worldRefs.length ? ` · ${worldRefs.length}` : ""}</span>
            </span>
            <span aria-hidden className="text-accent">›</span>
          </summary>
          <div className="mt-4 flex flex-col gap-3">
            {worldRefs.length > 0 && (
              <ul className="flex flex-col">
                {worldRefs.map((r) => (
                  <li key={r.id} className="border-t border-line py-2 text-sm">
                    <a href={r.source_url ?? "#"} target="_blank" rel="noreferrer" className="font-medium text-accent">{r.title || r.source_domain}</a>
                    <span className="text-muted"> · {r.attribution}</span>
                    {r.observations && <p className="text-xs text-muted">{r.observations.replace(/^World & Time( — )?/, "")}</p>}
                  </li>
                ))}
              </ul>
            )}
            {caps.can_edit && story && (
              <form action={addReference} className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <input type="hidden" name="projectId" value={projectId} />
                <input type="hidden" name="entityId" value={story.id} />
                <input type="hidden" name="back" value={base} />
                <input type="hidden" name="tag" value="world" />
                <input type="hidden" name="department" value="inspiration" />
                <input type="hidden" name="rights" value="unknown" />
                <input name="url" type="url" required placeholder="Paste a link: https://…" className="field md:col-span-2" aria-label="Link" />
                <input name="title" placeholder="Title (optional)" className="field" aria-label="Title" />
                <input name="attribution" required placeholder="Who made it? (you, an artist, a site)" className="field" aria-label="Who made it" />
                <textarea name="notes" rows={2} placeholder="What do you like about it?" className="field md:col-span-2" aria-label="Notes" />
                <label className="flex items-center gap-2 text-sm md:col-span-2"><input type="checkbox" name="imagined" value="1" /> This is imagined (not a real place or a prediction)</label>
                <div className="md:col-span-2"><SubmitButton pendingText="Adding…">Add reference</SubmitButton></div>
              </form>
            )}
            <p className="text-xs text-muted">STUDIO keeps the link and your notes; the partners can&apos;t see the image itself. It also shows under Inspiration in References.</p>
          </div>
        </details>
      </div>

      <aside id="builder" className="flex flex-col gap-4 xl:sticky xl:top-6 xl:max-h-[calc(100vh-3rem)] xl:self-start xl:overflow-y-auto" aria-label="World Builder">
        <header className="flex flex-col gap-1 border-b border-line pb-3">
          <p className="eyebrow">Your partner</p>
          <h2 className="display text-3xl">{PARTNERS.world.name}</h2>
          <p className="text-sm text-muted">Let&apos;s give your story a home.</p>
          <div className="flex flex-wrap gap-3 text-xs">
            {current && caps.can_edit && <Link className="text-accent" href={`${base}?new=1#builder`}>New conversation</Link>}
            {threads.length > 1 && <Link className="text-accent" href={`/projects/${projectId}/partners/world`}>All conversations</Link>}
          </div>
        </header>
        <PartnerChat key={current?.id ?? "new"} projectId={projectId} agent="world" partnerName={PARTNERS.world.name} basePath={base}
          opening={openingFor("world", { hasStory: !!storyText.trim(), runtime, filmTitle: shell.project.name, worldSentence: sentence })}
          threadId={current?.id ?? null}
          initial={messages.map((m) => ({ id: m.id, role: m.role, content: m.content }))}
          canTalk={!!caps.can_edit} unavailable={caps.can_edit ? unavailable : null} />
      </aside>
    </div>
  );
}
