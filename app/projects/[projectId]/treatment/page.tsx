// Read the director's treatment without leaving STUDIO. Google Docs open in a sandboxed
// reader (fetched in the browser with her own Google permission); other links open in a tab.
import Link from "next/link";
import { notFound } from "next/navigation";
import { Empty } from "@/components/flash";
import { IconArrowLeft } from "@/components/icons";
import { TreatmentBreakdown } from "@/components/treatment-breakdown";
import { TreatmentReader } from "@/components/treatment-reader";
import { SubmitButton } from "@/components/ui";
import { addReference, addTreatmentLink } from "../actions";
import { aiConfigured } from "@/lib/agents/run-story-breakdown";
import { getAiBudget, getProjectShell, getStoryReferences } from "@/lib/data";
import { parseGoogleLink, slidesEmbedUrl } from "@/lib/google/links";
import { TREATMENT_ATTRIBUTION, isTreatmentRef } from "@/lib/intake";

export default async function TreatmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ ref?: string }>;
}) {
  const { projectId } = await params;
  const { ref } = await searchParams;
  const shell = await getProjectShell(projectId);
  if (!shell || !shell.caps.member) notFound();
  const story = shell.entities.find((e) => e.kind === "story");
  const storyRefs = story ? await getStoryReferences(projectId, story.id) : [];
  const treatments = storyRefs.filter((r) => isTreatmentRef(r));
  const extra = storyRefs.filter((r) => !isTreatmentRef(r));
  const current = treatments.find((t) => t.id === ref) ?? treatments[0];
  const base = `/projects/${projectId}`;
  const link = current ? parseGoogleLink(current.source_url) : null;
  const canBreakDown = !!(story && current && shell.caps.can_edit && aiConfigured() &&
    (link?.kind === "doc" || link?.kind === "slides") && (await getAiBudget(projectId)).available);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <header className="flex flex-col gap-3">
        <Link href={base} className="inline-flex min-h-11 w-fit items-center gap-1.5 text-xs tracking-[0.12em] text-muted uppercase hover:text-text">
          <IconArrowLeft /> Overview
        </Link>
        <p className="eyebrow">Director treatment</p>
        <h1 className="display text-4xl leading-none sm:text-5xl">{current ? current.title || "Treatment" : "Your treatment"}</h1>
      </header>

      {!current ? (
        !shell.caps.can_edit && <Empty title="No treatment linked yet">When the Director links a treatment, you can read it here.</Empty>
      ) : (
        <>
          {treatments.length > 1 && (
            <nav aria-label="Treatments" className="flex flex-wrap gap-2">
              {treatments.map((t) => (
                <Link key={t.id} href={`${base}/treatment?ref=${t.id}`} aria-current={t.id === current.id ? "page" : undefined}
                  className={`btn ${t.id === current.id ? "btn-primary" : ""}`}>{t.title || t.source_domain}</Link>
              ))}
            </nav>
          )}
          {canBreakDown && story && current && (link?.kind === "doc" || link?.kind === "slides") && (
            <section className="panel corner-marks flex flex-col gap-2 p-5" aria-labelledby="bd-h">
              <p id="bd-h" className="eyebrow">Your Story Lead</p>
              <p className="text-sm">Let the Story Lead read this treatment and suggest the characters and locations in it.</p>
              <TreatmentBreakdown key={current.id} projectId={projectId} storyId={story.id} referenceId={current.id}
                fileId={link.id} kind={link.kind} primary />
            </section>
          )}
          {link?.kind === "doc" ? (
            <TreatmentReader key={current.id} docId={link.id} title={current.title || "Treatment"} sourceUrl={current.source_url}
              importHref={shell.caps.can_edit ? `${base}/import?from=treatment&ref=${current.id}` : null} />
          ) : link?.kind === "slides" ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-2">
                <a href={current.source_url} target="_blank" rel="noopener noreferrer" className="btn">Open in Google Slides ↗</a>
              </div>
              <div className="panel relative aspect-video w-full overflow-hidden bg-text">
                <iframe
                  title={`Treatment: ${current.title || "Google Slides"}`}
                  src={slidesEmbedUrl(link.id)}
                  className="absolute inset-0 size-full"
                  allow="fullscreen"
                  allowFullScreen
                  sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation"
                  referrerPolicy="strict-origin-when-cross-origin"
                />
              </div>
              <p className="help">
                This is Google&apos;s own slide player. It shows the deck to anyone signed in to Google with access to it. If you
                see &ldquo;You need access&rdquo; or a sign-in box (common on iPad), open it in Google Slides, or share the deck
                as &ldquo;Anyone with the link can view&rdquo; in Google Slides.
              </p>
            </div>
          ) : (
            <div className="panel flex flex-col gap-3 p-5">
              <p className="help">STUDIO can show Google Docs and Google Slides here. This treatment is a different kind of link, so it opens in a new tab.</p>
              <a href={current.source_url} target="_blank" rel="noopener noreferrer nofollow" className="btn btn-primary self-start">
                Open {current.source_domain} ↗
              </a>
            </div>
          )}
        </>
      )}

      {story && shell.caps.can_edit && (
        <section className="panel flex flex-col gap-3 p-5" aria-labelledby="link-h">
          <h2 id="link-h" className="display text-lg">{current ? "Link another treatment" : "Link your treatment"}</h2>
          <p className="help">A Google Doc or Google Slides link. You can read it here, pull its pictures in, and let the Story Lead break it down.</p>
          <form action={addTreatmentLink} className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_16rem_auto]">
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="entityId" value={story.id} />
            <input type="hidden" name="back" value={`${base}/treatment`} />
            <input name="url" type="url" required placeholder="https://docs.google.com/…" className="field" aria-label="Link" />
            <input name="title" maxLength={300} placeholder="Title (optional)" className="field" aria-label="Title" />
            <SubmitButton pendingText="Adding…">Add link</SubmitButton>
          </form>
          <p className="text-xs text-muted">If the document is private, people on your team need access to it in Google Drive too.</p>
        </section>
      )}

      {story && (extra.length > 0 || shell.caps.can_edit) && (
        <section className="flex flex-col gap-3" aria-labelledby="more-refs-h">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="more-refs-h" className="display text-lg">{current ? "Additional references" : "References"}</h2>
            <Link href={`${base}/references`} className="link-accent text-sm">All references by department ↗</Link>
          </div>
          {extra.length === 0 ? <p className="help">None yet.</p> : (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {extra.map((r) => (
                <li key={r.id} className="border border-line bg-panel-2 p-3">
                  {r.preview_asset_id && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/assets/${r.preview_asset_id}`} alt={r.title ?? "Reference image"} loading="lazy" className="mb-2 max-h-48 w-full object-contain" />
                  )}
                  <a href={r.source_url} target="_blank" rel="noopener noreferrer nofollow" className="font-medium hover:text-accent">{r.title || r.source_domain}</a>
                  <p className="text-xs text-muted">By {r.attribution} · {r.source_domain}</p>
                </li>
              ))}
            </ul>
          )}
          {shell.caps.can_edit && (
            <details>
              <summary className="cursor-pointer list-none text-sm text-accent">+ Add a reference link</summary>
              <form action={addReference} className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                <input type="hidden" name="projectId" value={projectId} />
                <input type="hidden" name="entityId" value={story.id} />
                <input type="hidden" name="back" value={`${base}/treatment`} />
                <input name="url" type="url" required placeholder="https://…" className="field md:col-span-2" aria-label="Link" />
                <input name="title" placeholder="Title (optional)" className="field" aria-label="Title" />
                <input name="attribution" required placeholder="Who made it?" className="field" aria-label="Attribution" />
                <input type="hidden" name="rights" value="unknown" />
                <div className="md:col-span-2"><SubmitButton pendingText="Adding…">Add reference</SubmitButton></div>
              </form>
            </details>
          )}
        </section>
      )}
    </div>
  );
}
