// Pull images in from Google Drive or the linked treatment, then attach the ones she wants
// to the story, a character or a location as credited references.
import Link from "next/link";
import { notFound } from "next/navigation";
import { type ImportTarget, DriveImport } from "@/components/drive-import";
import { Empty } from "@/components/flash";
import { IconArrowLeft } from "@/components/icons";
import { getProjectShell, getStoryReferences } from "@/lib/data";
import { parseGoogleLink } from "@/lib/google/links";
import { TREATMENT_ATTRIBUTION } from "@/lib/intake";

export default async function ImportPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ from?: string; ref?: string; to?: string }>;
}) {
  const { projectId } = await params;
  const { from, ref, to } = await searchParams;
  const shell = await getProjectShell(projectId);
  if (!shell || !shell.caps.member) notFound();
  if (!shell.caps.can_edit) {
    return <Empty title="Bringing in images is for the creative team">You can look at references on each item&apos;s page.</Empty>;
  }
  const order = { story: 0, character: 1, location: 2 } as const;
  const targets: ImportTarget[] = shell.entities
    .map((e) => ({ id: e.id, name: e.name, kind: e.kind as ImportTarget["kind"] }))
    .sort((a, b) => order[a.kind] - order[b.kind]);
  const story = shell.entities.find((e) => e.kind === "story");
  if (!story) notFound();

  const treatments = (await getStoryReferences(projectId, story.id)).filter((r) => r.attribution === TREATMENT_ATTRIBUTION);
  const chosen = treatments.find((t) => t.id === ref) ??
    treatments.find((t) => parseGoogleLink(t.source_url)?.kind === "doc");
  const link = chosen ? parseGoogleLink(chosen.source_url) : null;
  const treatment = chosen && link?.kind === "doc" ? { docId: link.id, title: chosen.title || "your treatment" } : null;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <header className="flex flex-col gap-3">
        <Link href={`/projects/${projectId}`} className="inline-flex min-h-11 w-fit items-center gap-1.5 text-xs tracking-[0.12em] text-muted uppercase hover:text-text">
          <IconArrowLeft /> Overview
        </Link>
        <p className="eyebrow">Images from Drive</p>
        <h1 className="display text-4xl leading-none sm:text-5xl">Bring in your pictures</h1>
        <p className="max-w-2xl text-muted">Take the pictures from your treatment, or pick images in Google Drive. You choose which to keep and where they go.</p>
      </header>
      <DriveImport targets={targets} defaultTargetId={targets.some((t) => t.id === to) ? to! : story.id}
        treatment={treatment} startWithTreatment={from === "treatment"} />
    </div>
  );
}
