// Project intake: the two ways material comes into a film — a story synopsis and a link to
// the director's treatment. Both land on the shared Story item, so every module sees them.
import Link from "next/link";
import { notFound } from "next/navigation";
import { Empty, Flash } from "@/components/flash";
import { SubmitButton } from "@/components/ui";
import { aiConfigured } from "@/lib/agents/run-story-breakdown";
import { getAiBudget, getEntityWorkspace, getProjectShell } from "@/lib/data";
import { TREATMENT_ATTRIBUTION } from "@/lib/intake";
import { addTreatmentLink, deleteProject, requestBreakdown, saveSynopsis } from "./actions";

export const maxDuration = 300;

export default async function ProjectStart({
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
  const ws = story ? await getEntityWorkspace(projectId, story.id) : null;
  const budget = await getAiBudget(projectId);

  if (!story || !ws) {
    return <Empty title="Nothing approved yet">The approved story, characters and locations will appear here.</Empty>;
  }

  const latest = ws.versions[0];
  const treatments = ws.references.filter((r) => r.attribution === TREATMENT_ATTRIBUTION);
  const canAsk = caps.can_edit && aiConfigured() && budget.available && (latest?.content.body?.trim().length ?? 0) >= 50;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <header>
        <h2 className="text-3xl font-semibold tracking-tight">Bring in your film</h2>
        <p className="help mt-1">Start with a synopsis of your story, a link to your director&apos;s treatment, or both. You can change either at any time.</p>
      </header>
      <Flash error={error} notice={notice} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* ------------------------------------------------ Story synopsis */}
        <section className="panel flex flex-col gap-3 p-5" aria-labelledby="story-h">
          <h3 id="story-h" className="text-lg font-medium">Story</h3>
          <p className="help">Write or paste a synopsis: what happens, who it&apos;s about, where it takes place. A few paragraphs is plenty.</p>
          {caps.can_edit ? (
            <form action={saveSynopsis} className="flex flex-col gap-3">
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="entityId" value={story.id} />
              <input type="hidden" name="parentVersionId" value={latest?.id ?? ""} />
              <input type="hidden" name="baseVersionId" value={story.current_version_id ?? ""} />
              <label className="sr-only" htmlFor="synopsis">Synopsis</label>
              <textarea id="synopsis" name="body" rows={12} required maxLength={200000}
                defaultValue={latest?.content.body ?? ""} className="field font-serif text-lg leading-relaxed"
                placeholder="Once upon a time…" />
              <SubmitButton variant="primary" pendingText="Saving…">{latest ? "Save as a new revision" : "Save synopsis"}</SubmitButton>
              {latest && <p className="text-xs text-muted">Saving keeps every earlier version in the story&apos;s history.</p>}
            </form>
          ) : latest ? (
            <p className="font-serif whitespace-pre-wrap">{latest.content.body}</p>
          ) : (
            <Empty title="No synopsis yet" />
          )}
        </section>

        {/* ------------------------------------------------ Treatment link */}
        <section className="panel flex flex-col gap-3 p-5" aria-labelledby="treatment-h">
          <h3 id="treatment-h" className="text-lg font-medium">Director treatment (link)</h3>
          <p className="help">Link your treatment, for example a Google Doc. STUDIO keeps the link with your story; it doesn&apos;t copy or read the document yet.</p>
          {treatments.length > 0 && (
            <ul className="flex flex-col gap-2">
              {treatments.map((t) => (
                <li key={t.id} className="rounded-lg border border-line p-3">
                  <a href={t.source_url} target="_blank" rel="noopener noreferrer" className="font-medium hover:text-accent">
                    {t.title || t.source_domain}
                  </a>
                  <p className="text-xs text-muted">{t.source_domain} · added {new Date(t.created_at).toLocaleDateString("en-US", { dateStyle: "medium" })}</p>
                </li>
              ))}
            </ul>
          )}
          {caps.can_edit ? (
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
          ) : treatments.length === 0 ? (
            <Empty title="No treatment linked yet" />
          ) : null}
        </section>
      </div>

      {/* ------------------------------------------------ Next steps */}
      <section className="panel flex flex-wrap items-center justify-between gap-3 p-4">
        <p className="help">
          {latest ? "Next: let the Story Lead suggest characters and locations, or open the story workspace." : "Once your synopsis is saved, the Story Lead can suggest characters and locations from it."}
        </p>
        <div className="flex flex-wrap gap-2">
          {canAsk && (
            <form action={requestBreakdown}>
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="entityId" value={story.id} />
              <SubmitButton variant="primary" pendingText="Sending…">Suggest characters &amp; locations</SubmitButton>
            </form>
          )}
          <Link href={`/projects/${projectId}/items/${story.id}`} className="btn">Open story workspace</Link>
        </div>
        {canAsk && <p className="w-full text-xs text-muted">The Story Lead reads your saved synopsis (not the linked treatment). Your text is sent to Anthropic&apos;s Claude AI to make suggestions.</p>}
      </section>
      {caps.can_admin && caps.can_approve_creative && (
        <details className="panel p-4">
          <summary className="min-h-11 cursor-pointer py-2 text-sm text-muted">Delete this film…</summary>
          <form action={deleteProject} className="mt-3 flex flex-col gap-3">
            <input type="hidden" name="projectId" value={projectId} />
            <p className="text-sm">
              Deleting hides <strong>{project.name}</strong> from everyone on the team, including its story, characters,
              locations, artwork and history. It can be recovered for a while if you change your mind.
            </p>
            <label className="label" htmlFor="confirmName">Type the film&apos;s title to confirm</label>
            <input id="confirmName" name="confirmName" required autoComplete="off" placeholder={project.name} className="field" />
            <button type="submit" className="btn self-start border-danger text-danger hover:bg-danger/10">Delete film</button>
          </form>
        </details>
      )}
    </div>
  );
}
