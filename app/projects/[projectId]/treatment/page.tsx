// Read the director's treatment without leaving STUDIO. Google Docs open in a sandboxed
// reader (fetched in the browser with her own Google permission); other links open in a tab.
import Link from "next/link";
import { notFound } from "next/navigation";
import { Empty } from "@/components/flash";
import { IconArrowLeft } from "@/components/icons";
import { TreatmentReader } from "@/components/treatment-reader";
import { getProjectShell, getStoryReferences } from "@/lib/data";
import { parseGoogleLink } from "@/lib/google/links";
import { TREATMENT_ATTRIBUTION } from "@/lib/intake";

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
  const treatments = story
    ? (await getStoryReferences(projectId, story.id)).filter((r) => r.attribution === TREATMENT_ATTRIBUTION)
    : [];
  const current = treatments.find((t) => t.id === ref) ?? treatments[0];
  const base = `/projects/${projectId}`;
  const link = current ? parseGoogleLink(current.source_url) : null;

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
        <Empty title="No treatment linked yet">
          {shell.caps.can_edit ? (
            <>Link it on <Link href={`${base}/add#treatment`} className="link-accent">Add to your project</Link>, then read it here.</>
          ) : "When the Director links a treatment, you can read it here."}
        </Empty>
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
          {link?.kind === "doc" ? (
            <TreatmentReader key={current.id} docId={link.id} title={current.title || "Treatment"} sourceUrl={current.source_url}
              importHref={shell.caps.can_edit ? `${base}/import?from=treatment&ref=${current.id}` : null} />
          ) : (
            <div className="panel flex flex-col gap-3 p-5">
              <p className="help">STUDIO can show Google Docs here. This treatment is a different kind of link, so it opens in a new tab.</p>
              <a href={current.source_url} target="_blank" rel="noopener noreferrer nofollow" className="btn btn-primary self-start">
                Open {current.source_domain} ↗
              </a>
            </div>
          )}
        </>
      )}
    </div>
  );
}
