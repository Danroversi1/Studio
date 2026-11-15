// Project overview: every piece of the film as a card. Content comes from the shared
// project graph; nothing here is a placeholder for an unbuilt feature.
import Link from "next/link";
import { parseIntake, isTreatmentRef } from "@/lib/intake";
import { notFound } from "next/navigation";
import { Flash } from "@/components/flash";
import { IconArrowUpRight, IconCharacter, IconLink, IconLocation, IconPlus, IconSparkle, IconStory } from "@/components/icons";
import { SubmitButton } from "@/components/ui";
import { aiConfigured } from "@/lib/agents/run-story-breakdown";
import { getAiBudget, getLatestVersions, getProjectShell, getStoryReferences, type VersionStatus } from "@/lib/data";
import { TREATMENT_ATTRIBUTION } from "@/lib/intake";
import { requestBreakdown } from "./actions";

export const maxDuration = 300;

type Tone = "draft" | "approved" | "explore";
function Badge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const cls = tone === "approved" ? "bg-ok-soft text-ok" : tone === "draft" ? "bg-warn-soft text-warn" : "bg-accent-soft text-accent";
  return <span className={`badge ${cls}`}>{children}</span>;
}

function statusBadge(approved: boolean, latest?: { status: VersionStatus }) {
  if (approved) return <Badge tone="approved">Approved</Badge>;
  if (latest) return <Badge tone="draft">Your draft</Badge>;
  return <Badge tone="explore">Start exploring</Badge>;
}

function Card({ icon, title, badge, preview, heading, sub, agent, href, openLabel = "Open" }: {
  icon: React.ReactNode; title: string; badge: React.ReactNode; preview: React.ReactNode;
  heading: string; sub: string; agent?: string; href: string; openLabel?: string;
}) {
  return (
    <article className="panel flex flex-col">
      <div className="flex items-center gap-3 border-b border-line px-5 py-4">
        <span className="flex size-10 shrink-0 items-center justify-center bg-text text-brand">{icon}</span>
        <h3 className="flex-1 truncate text-base font-semibold tracking-[0.04em] uppercase">{title}</h3>
        {badge}
      </div>
      <div className="h-44 overflow-hidden border-b border-line bg-panel-2 px-5 py-4 font-serif text-[14px] leading-7 text-text/85">{preview}</div>
      <div className="flex flex-1 flex-col gap-1 px-5 py-4">
        <p className="font-semibold">{heading}</p>
        <p className="help">{sub}</p>
      </div>
      <div className="flex items-center justify-between border-t border-line px-5">
        <span className="inline-flex items-center gap-2 text-xs tracking-[0.12em] text-muted uppercase">
          {agent && <><span className="size-2 bg-brand" aria-hidden /> {agent}</>}
        </span>
        <Link href={href} className="link-accent">{openLabel} <IconArrowUpRight /></Link>
      </div>
    </article>
  );
}

function SectionHead({ id, title, note, action }: { id?: string; title: string; note?: string; action?: React.ReactNode }) {
  return (
    <div id={id} className="flex scroll-mt-6 flex-wrap items-end justify-between gap-3 border-b border-line pb-3">
      <h2 className="flex flex-wrap items-baseline gap-x-4">
        <span className="display text-2xl">{title}</span>
        {note && <span className="text-xs tracking-[0.12em] text-muted uppercase">{note}</span>}
      </h2>
      {action}
    </div>
  );
}

export default async function ProjectOverview({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const { projectId } = await params;
  const { error, notice } = await searchParams;
  const shell = await getProjectShell(projectId);
  if (!shell || !shell.caps.member) notFound();
  const { caps, entities, project } = shell;
  const story = entities.find((e) => e.kind === "story");
  const characters = entities.filter((e) => e.kind === "character");
  const locations = entities.filter((e) => e.kind === "location");
  const [latest, budget, refs] = await Promise.all([
    getLatestVersions(projectId),
    getAiBudget(projectId),
    story ? getStoryReferences(projectId, story.id) : Promise.resolve([]),
  ]);
  const treatments = refs.filter((r) => isTreatmentRef(r));
  const storyLatest = story ? latest.get(story.id) : undefined;
  const synopsis = storyLatest?.content.body?.trim() ?? "";
  const intake = parseIntake(synopsis);
  const preview = (intake.idea || intake.who || intake.difficulty || synopsis).trim();
  const canAsk = !!story && caps.can_edit && aiConfigured() && budget.available && synopsis.length >= 50;
  const pieces = (story ? 2 : 0) + characters.length + locations.length;
  const addHref = `/projects/${projectId}/add`;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-10">
      <header className="panel corner-marks grid-lines flex flex-wrap items-end justify-between gap-6 px-6 pt-12 pb-8 sm:px-10">
        <div className="max-w-3xl">
          <p className="eyebrow">Your creative workspace</p>
          <h1 className="display mt-4 text-4xl leading-[0.95] sm:text-6xl">Your story, taking shape.</h1>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-muted">A spark of an idea. A world of possibilities. Bring it all together here.</p>
        </div>
        {caps.can_edit && (
          <Link href={addHref} className="btn-primary min-h-12 px-6"><IconPlus /> Add to your project</Link>
        )}
      </header>

      <Flash error={error} notice={notice} />

      {caps.can_edit && story && (
        <section className="flex flex-wrap items-center gap-5 border border-text bg-text px-6 py-6 text-panel-2">
          <span className="text-brand"><IconSparkle className="size-9" /></span>
          <div className="min-w-60 flex-1">
            <p className="display text-xl">One story. Many ways forward.</p>
            <p className="mt-1 text-sm leading-relaxed text-panel-2/75">
              {synopsis.length < 50
                ? "Start by answering three questions about your story. Your Story Lead can then suggest the characters and locations in it."
                : "Your Story Lead reads your synopsis and suggests characters and locations. You decide what joins the film."}
            </p>
          </div>
          {synopsis.length < 50 ? (
            <Link href={addHref} className="btn-primary">Start your story <IconArrowUpRight /></Link>
          ) : canAsk ? (
            <form action={requestBreakdown}>
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="entityId" value={story.id} />
              <SubmitButton variant="primary" pendingText="Sending to your Story Lead…">Develop your story</SubmitButton>
            </form>
          ) : (
            <Link href={`/projects/${projectId}/suggestions`} className="btn-primary">See your agents <IconArrowUpRight /></Link>
          )}
          {canAsk && <p className="w-full text-xs text-panel-2/60">Your saved synopsis is sent to Anthropic&apos;s Claude AI to make suggestions.</p>}
        </section>
      )}

      {story && (
        <section className="flex flex-col gap-6">
          <SectionHead title="Your project" note={`${pieces} living ${pieces === 1 ? "piece" : "pieces"} · one shared vision`} />
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <Card
              icon={<IconStory />} title="Synopsis" badge={statusBadge(!!story.current_version_id, storyLatest)}
              preview={<><p className="mb-2 font-semibold tracking-[0.06em] text-text uppercase">{project.name}</p><p className="line-clamp-4">{preview || "Your first page is waiting. Open to start writing."}</p></>}
              heading="The seed of your story" sub="Your idea. Your starting point." agent="Story Lead"
              href={synopsis ? `/projects/${projectId}/items/${story.id}` : addHref}
            />
            <Card
              icon={<IconLink />} title="Treatment"
              badge={treatments.length ? <Badge tone="approved">{treatments.length} linked</Badge> : <Badge tone="explore">Start exploring</Badge>}
              preview={<><p className="mb-2 font-semibold tracking-[0.06em] text-text uppercase">{project.name}</p>{treatments.length ? (
                <ul className="flex flex-col gap-1">{treatments.slice(0, 4).map((t) => <li key={t.id} className="truncate">↗ {t.title || t.source_domain}</li>)}</ul>
              ) : <p>Your bigger picture lives here. Link your director&apos;s treatment to keep it with your story.</p>}</>}
              heading="The bigger picture, scene by scene" sub="An emerging arc. Room to discover more."
              href={treatments.length ? `/projects/${projectId}/treatment` : `${addHref}#treatment`} openLabel={treatments.length ? "Read" : "Open"}
            />
          </div>
        </section>
      )}

      {[
        { id: "characters", title: "Characters", items: characters, icon: <IconCharacter />, empty: "Who lives in your story?" },
        { id: "locations", title: "Locations", items: locations, icon: <IconLocation />, empty: "Where does your story happen?" },
      ].map((sec) => (
        <section key={sec.id} className="flex flex-col gap-6">
          <SectionHead id={sec.id} title={sec.title}
            note={sec.items.length ? `${sec.items.length} in your film` : undefined}
            action={caps.can_edit ? <Link href={`${addHref}#new-${sec.id}`} className="link-accent"><IconPlus /> Add</Link> : undefined} />
          {sec.items.length === 0 ? (
            <div className="border border-dashed border-line px-6 py-10 text-center">
              <p className="font-medium">{sec.empty}</p>
              <p className="help mt-1">Add them yourself, or let your Story Lead suggest them from your synopsis.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
              {sec.items.map((e) => {
                const v = latest.get(e.id);
                return (
                  <Card key={e.id} icon={sec.icon} title={e.name} badge={statusBadge(!!e.current_version_id, v)}
                    preview={<p className="line-clamp-5">{v?.content.summary || "Nothing written yet. Open to describe them."}</p>}
                    heading={sec.id === "characters" ? "Who they are" : "What it feels like"}
                    sub={v ? `Revision ${v.version_number}` : "No revisions yet"}
                    href={`/projects/${projectId}/items/${e.id}`} />
                );
              })}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
