// Project overview: every piece of the film as a card. Content comes from the shared
// project graph; nothing here is a placeholder for an unbuilt feature.
import { RoleSelect } from "@/components/characters/role-picker";
import { ROLES, ROLE_HINT, ROLE_LABEL, byRole, roleOf } from "@/lib/characters/roles";
import Link from "next/link";
import { parseGoogleLink, slidesEmbedUrl } from "@/lib/google/links";
import { parseIntake, isTreatmentRef } from "@/lib/intake";
import { notFound } from "next/navigation";
import { Flash } from "@/components/flash";
import { IconArrowUpRight, IconCharacter, IconLink, IconLocation, IconPlus, IconSparkle, IconStory } from "@/components/icons";
import { getAppearances, getLatestVersions, getProjectShell, getStoryReferences, getWorld, type VersionStatus } from "@/lib/data";
import { WorldLine } from "@/components/world-line";
import { ThumbView } from "@/components/thumb-view";
import { thumbOf } from "@/lib/thumb";

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

function Card({ icon, title, badge, preview, heading, sub, agent, href, openLabel = "Open", bleed = false, extra }: {
  icon: React.ReactNode; title: string; badge: React.ReactNode; preview: React.ReactNode;
  heading: string; sub: string; agent?: string; href: string; openLabel?: string; bleed?: boolean; extra?: React.ReactNode;
}) {
  return (
    <article className="panel flex flex-col">
      <div className="flex items-center gap-3 border-b border-line px-5 py-4">
        <span className="flex size-10 shrink-0 items-center justify-center bg-accent-soft text-accent">{icon}</span>
        <h3 className="flex-1 truncate text-base font-semibold">{title}</h3>
        {badge}
      </div>
      <div className={`relative h-44 overflow-hidden border-b border-line bg-panel-2 font-serif text-[14px] leading-7 text-text/85 ${bleed ? "" : "px-5 py-4"}`}>{preview}</div>
      <div className="flex flex-1 flex-col gap-1 px-5 py-4">
        <p className="font-semibold">{heading}</p>
        <p className="help">{sub}</p>
      </div>
      <div className="flex items-center justify-between border-t border-line px-5">
        {extra ?? <span className="inline-flex items-center gap-2 text-xs text-muted">
          {agent && <><span className="size-2 bg-brand" aria-hidden /> {agent}</>}
        </span>}
        <Link href={href} className="link-accent">{openLabel} <IconArrowUpRight /></Link>
      </div>
    </article>
  );
}

/** Characters are shown in sections by the role she gives them; locations stay one group. */
function groupsOf<T extends { name: string; metadata?: Record<string, unknown> | null }>(section: string, items: T[], appearances: Record<string, number>) {
  if (section !== "characters") return [{ key: "all", label: "", hint: "", items }];
  const withRole = byRole(items.map((e) => ({ ...e, role: roleOf(e.metadata) })), appearances);
  const groups = [...ROLES, null].map((r) => ({
    key: r ?? "none", label: r ? ROLE_LABEL[r] : "Role not set", hint: r ? ROLE_HINT[r] : "Choose a role on each card to organize them",
    items: withRole.filter((e) => e.role === r),
  })).filter((g) => g.items.length);
  // Nothing assigned yet: one plain group, no headings.
  return groups.length === 1 && groups[0].key === "none" ? [{ ...groups[0], label: "", hint: "" }] : groups;
}

function SectionHead({ id, title, note, action }: { id?: string; title: string; note?: string; action?: React.ReactNode }) {
  return (
    <div id={id} className="flex scroll-mt-6 flex-wrap items-end justify-between gap-3 border-b border-line pb-3">
      <h2 className="flex flex-wrap items-baseline gap-x-4">
        <span className="display text-3xl">{title}</span>
        {note && <span className="text-xs text-muted">{note}</span>}
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
  const [latest, refs, world, appearances] = await Promise.all([
    getLatestVersions(projectId),
    story ? getStoryReferences(projectId, story.id) : Promise.resolve([]),
    getWorld(projectId),
    getAppearances(projectId, characters.map((c) => c.name)),
  ]);
  const treatments = refs.filter((r) => isTreatmentRef(r));
  const storyLatest = story ? latest.get(story.id) : undefined;
  const synopsis = storyLatest?.content.body?.trim() ?? "";
  const intake = parseIntake(synopsis);
  const preview = (intake.idea || project.description || "").trim();
  const pieces = (story ? 2 : 0) + characters.length + locations.length;
  const addHref = `/projects/${projectId}/add`;
  const firstTreatment = treatments.map((t) => parseGoogleLink(t.source_url)).find((g) => g?.kind === "slides" || g?.kind === "doc");
  const thumbSrc = firstTreatment
    ? firstTreatment.kind === "slides" ? slidesEmbedUrl(firstTreatment.id) : `https://docs.google.com/document/d/${firstTreatment.id}/preview`
    : null;
  const thumbFor = (e: { metadata?: Record<string, unknown> | null }) => thumbOf(e.metadata);
  const storyHref = story ? `/projects/${projectId}/items/${story.id}` : addHref;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-10">
      <header className="panel corner-marks grid-lines flex flex-wrap items-end justify-between gap-6 px-6 pt-12 pb-8 sm:px-10">
        <div className="max-w-3xl">
          <p className="eyebrow">STUDIO is your creative workspace</p>
          <h1 className="display mt-4 text-4xl leading-[0.95] sm:text-6xl">Your story, taking shape.</h1>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-muted">A spark of an idea. A world of possibilities. Bring it all together here.</p>
        </div>
        {caps.can_edit && (
          <Link href={storyHref} className="btn-primary min-h-12 px-6">Let&apos;s build your story <IconArrowUpRight /></Link>
        )}
      </header>

      <Flash error={error} notice={notice} />
      <WorldLine projectId={projectId} world={world} />

      {caps.can_edit && story && (
        <section className="flex flex-wrap items-center gap-5 border border-line bg-panel px-6 py-6">
          <span className="text-accent"><IconSparkle className="size-9" /></span>
          <div className="min-w-60 flex-1">
            <p className="display text-[26px]">One story. Many ways forward.</p>
            <p className="mt-1 text-sm leading-relaxed text-soft">
              Your Storybuilder helps you find what you want to say, one question at a time. You decide what joins the film.
            </p>
          </div>
          <Link href={`/projects/${projectId}/partners/story`} className="btn-primary">Meet Your Storybuilder <IconArrowUpRight /></Link>
        </section>
      )}

      {story && (
        <section className="flex flex-col gap-6">
          <SectionHead title="Your project" note={`${pieces} living ${pieces === 1 ? "piece" : "pieces"} · one shared vision`} />
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <Card
              icon={<IconStory />} title="Synopsis" badge={statusBadge(!!story.current_version_id, storyLatest)}
              preview={<><p className="mb-2 font-semibold text-text">{project.name}</p><p className="line-clamp-4">{preview || "Your first page is waiting. Open to start writing."}</p></>}
              heading="The seed of your story" sub="Your idea. Your starting point." agent="Story Lead"
              href={storyHref}
            />
            <Card
              icon={<IconLink />} title="Treatment"
              badge={treatments.length ? <Badge tone="approved">{treatments.length} linked</Badge> : <Badge tone="explore">Start exploring</Badge>}
              bleed={!!thumbSrc}
              preview={thumbSrc ? (
                // A live miniature of the linked treatment (Google's own viewer, scaled down; not clickable).
                <iframe title="Treatment thumbnail" src={thumbSrc} tabIndex={-1} loading="lazy" aria-hidden
                  sandbox="allow-scripts allow-same-origin" referrerPolicy="strict-origin-when-cross-origin"
                  className="pointer-events-none absolute top-0 left-0 origin-top-left border-0"
                  style={{ width: "400%", height: "400%", transform: "scale(0.25)" }} />
              ) : <><p className="mb-2 font-semibold text-text">{project.name}</p>{treatments.length ? (
                <ul className="flex flex-col gap-1">{treatments.slice(0, 4).map((t) => <li key={t.id} className="truncate">↗ {t.title || t.source_domain}</li>)}</ul>
              ) : <>
                <p>Your bigger picture lives here. Link your director&apos;s treatment to keep it with your story.</p>
                {caps.can_edit && (
                  <Link href={`/projects/${projectId}/treatment`}
                    className="link-accent mt-1 min-h-0 font-sans text-xs">Or build one in the Treatment desk →</Link>
                )}
              </>}</>}
              heading="The bigger picture, scene by scene" sub="An emerging arc. Room to discover more."
              href={`/projects/${projectId}/treatment`} openLabel={treatments.length ? "Read" : "Link it"}
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
              <p className="help mt-1">Add them yourself, or let your Story Lead suggest them from your story.</p>
            </div>
          ) : (
            groupsOf(sec.id, sec.items, appearances).map((g) => (
            <div key={g.key} className="flex flex-col gap-3">
              {g.label && (
                <h3 className="flex items-baseline gap-3 text-sm font-semibold">
                  {g.label}<span className="text-xs font-normal tracking-normal text-muted normal-case">{g.hint}</span>
                </h3>
              )}
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
              {g.items.map((e) => {
                const v = latest.get(e.id);
                return (
                  <Card key={e.id} icon={sec.icon} title={e.name} badge={statusBadge(!!e.current_version_id, v)}
                    bleed={!!thumbFor(e)}
                    preview={thumbFor(e) ? (
                      <ThumbView source={thumbFor(e)} alt={`${e.name} thumbnail`} className="size-full" />
                    ) : (
                      <div className="flex h-full flex-col gap-2">
                        <p className="line-clamp-3">{v?.content.summary || "Nothing written yet. Open to describe them."}</p>
                        {caps.can_edit && (
                          <Link href={`/projects/${projectId}/items/${e.id}#thumbnail`} className="mt-auto inline-flex w-fit items-center gap-1.5 border border-dashed border-line px-3 py-1.5 font-sans text-xs text-muted hover:border-text hover:text-text">
                            <IconPlus /> Choose a thumbnail
                          </Link>
                        )}
                      </div>
                    )}
                    heading={sec.id === "characters" ? "Who they are" : "What it feels like"}
                    sub={v ? `Revision ${v.version_number}` : "No revisions yet"}
                    href={`/projects/${projectId}/items/${e.id}`}
                    extra={sec.id === "characters" ? (caps.can_edit
                      ? <RoleSelect projectId={projectId} entityId={e.id} name={e.name} role={roleOf(e.metadata)} />
                      : <span className="text-xs text-muted">{roleOf(e.metadata) ? ROLE_LABEL[roleOf(e.metadata)!] : ""}</span>) : undefined} />
                );
              })}
            </div>
            </div>
            ))
          )}
        </section>
      ))}
    </div>
  );
}
