// Intake: the ways material comes into a film. A story synopsis and a link to the director's
// treatment both land on the shared Story item; characters and locations become their own items.
import Link from "next/link";
import { notFound } from "next/navigation";
import { Empty, Flash } from "@/components/flash";
import { IconArrowLeft, IconCharacter, IconLink, IconLocation, IconStory } from "@/components/icons";
import { SubmitButton } from "@/components/ui";
import { aiConfigured } from "@/lib/agents/run-story-breakdown";
import { getAiBudget, getEntityWorkspace, getProjectShell } from "@/lib/data";
import { parseGoogleLink } from "@/lib/google/links";
import { TREATMENT_ATTRIBUTION } from "@/lib/intake";
import { addTreatmentLink, createEntity, requestBreakdown, saveSynopsis } from "../actions";

export const maxDuration = 300;

function Section({ id, icon, title, help, children }: {
  id: string; icon: React.ReactNode; title: string; help: string; children: React.ReactNode;
}) {
  return (
    <section id={id} className="panel flex scroll-mt-6 flex-col">
      <div className="flex items-center gap-3 border-b border-line px-5 py-4">
        <span className="flex size-10 shrink-0 items-center justify-center bg-text text-brand">{icon}</span>
        <h2 className="display text-xl">{title}</h2>
      </div>
      <div className="flex flex-col gap-4 p-5">
        <p className="help">{help}</p>
        {children}
      </div>
    </section>
  );
}

export default async function AddToProject({
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
  const { caps, entities } = shell;
  if (!caps.can_edit) {
    return <Empty title="Adding is for the creative team">You can read the approved versions of this film.</Empty>;
  }
  const story = entities.find((e) => e.kind === "story");
  const ws = story ? await getEntityWorkspace(projectId, story.id) : null;
  const budget = await getAiBudget(projectId);
  if (!story || !ws) notFound();

  const latest = ws.versions[0];
  const treatments = ws.references.filter((r) => r.attribution === TREATMENT_ATTRIBUTION);
  const canAsk = aiConfigured() && budget.available && (latest?.content.body?.trim().length ?? 0) >= 50;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8">
      <header className="flex flex-col gap-3">
        <Link href={`/projects/${projectId}`} className="inline-flex min-h-11 w-fit items-center gap-1.5 text-xs tracking-[0.12em] text-muted uppercase hover:text-text">
          <IconArrowLeft /> Overview
        </Link>
        <p className="eyebrow">Add to your project</p>
        <h1 className="display text-4xl leading-none sm:text-5xl">Bring in your film</h1>
        <p className="max-w-2xl text-muted">Start with a synopsis, link your director&apos;s treatment, or add characters and locations yourself. You can change any of it later.</p>
      </header>
      <Flash error={error} notice={notice} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Section id="story" icon={<IconStory />} title="Story"
          help="Write or paste a synopsis: what happens, who it's about, where it takes place. A few paragraphs is plenty.">
          <form action={saveSynopsis} className="flex flex-col gap-3">
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="entityId" value={story.id} />
            <input type="hidden" name="parentVersionId" value={latest?.id ?? ""} />
            <input type="hidden" name="baseVersionId" value={story.current_version_id ?? ""} />
            <label className="sr-only" htmlFor="synopsis">Synopsis</label>
            <textarea id="synopsis" name="body" rows={12} required maxLength={200000}
              defaultValue={latest?.content.body ?? ""} className="field font-serif leading-7" placeholder="Once upon a time…" />
            <SubmitButton variant="primary" pendingText="Saving…">{latest ? "Save as a new revision" : "Save synopsis"}</SubmitButton>
            {latest && <p className="text-xs text-muted">Saving keeps every earlier version in the story&apos;s history.</p>}
          </form>
          {canAsk && (
            <form action={requestBreakdown} className="flex flex-col gap-2 border-t border-line pt-4">
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="entityId" value={story.id} />
              <SubmitButton pendingText="Sending…">Suggest characters &amp; locations</SubmitButton>
              <p className="text-xs text-muted">Your Story Lead reads the saved synopsis (not the linked treatment). It is sent to Anthropic&apos;s Claude AI.</p>
            </form>
          )}
        </Section>

        <Section id="treatment" icon={<IconLink />} title="Director treatment"
          help="Link your treatment, for example a Google Doc. You can then read it inside STUDIO and pull its pictures in. The Story Lead doesn't read it yet.">
          {treatments.length > 0 && (
            <ul className="flex flex-col">
              {treatments.map((t) => (
                <li key={t.id} className="border-b border-line py-3 first:border-t">
                  <a href={t.source_url} target="_blank" rel="noopener noreferrer" className="font-medium hover:text-accent">↗ {t.title || t.source_domain}</a>
                  <p className="text-xs text-muted">{t.source_domain} · added {new Date(t.created_at).toLocaleDateString("en-US", { dateStyle: "medium" })}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Link href={`/projects/${projectId}/treatment?ref=${t.id}`} className="btn">Read here</Link>
                    {parseGoogleLink(t.source_url)?.kind === "doc" && (
                      <Link href={`/projects/${projectId}/import?from=treatment&ref=${t.id}`} className="btn">Pull its images</Link>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <form action={addTreatmentLink} className="flex flex-col gap-3">
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="entityId" value={story.id} />
            <div>
              <label className="label" htmlFor="treatment-url">Link</label>
              <input id="treatment-url" name="url" type="url" required placeholder="https://docs.google.com/…" className="field" />
            </div>
            <div>
              <label className="label" htmlFor="treatment-title">Title (optional)</label>
              <input id="treatment-title" name="title" maxLength={300} placeholder="Treatment, draft 2" className="field" />
            </div>
            <SubmitButton pendingText="Adding…">{treatments.length ? "Add another link" : "Add treatment link"}</SubmitButton>
            <p className="text-xs text-muted">If the document is private, people on your team will need access to it in Google Drive too.</p>
          </form>
        </Section>

        {(["character", "location"] as const).map((kind) => (
          <Section key={kind} id={`new-${kind}s`} icon={kind === "character" ? <IconCharacter /> : <IconLocation />}
            title={kind === "character" ? "New character" : "New location"}
            help={kind === "character" ? "Give them a name. You can describe them and add artwork on their page." : "Name the place. You can describe its mood and add artwork on its page."}>
            <form action={createEntity} className="flex flex-col gap-3 sm:flex-row">
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="kind" value={kind} />
              <label className="sr-only" htmlFor={`new-${kind}`}>Name</label>
              <input id={`new-${kind}`} name="name" required maxLength={120} placeholder={kind === "character" ? "e.g. Mira" : "e.g. The lighthouse"} className="field flex-1" />
              <SubmitButton variant="primary" pendingText="Adding…">Add {kind}</SubmitButton>
            </form>
          </Section>
        ))}
      </div>
    </div>
  );
}
