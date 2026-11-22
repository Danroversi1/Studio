// Intake: the ways material comes into a film. A story synopsis and a link to the director's
// treatment both land on the shared Story item; characters and locations become their own items.
import Link from "next/link";
import { notFound } from "next/navigation";
import { Empty, Flash } from "@/components/flash";
import { IconArrowLeft, IconCharacter, IconLocation } from "@/components/icons";
import { SubmitButton } from "@/components/ui";
import { getProjectShell } from "@/lib/data";
import { createEntity } from "../actions";

export const maxDuration = 300;

function Section({ id, icon, title, help, children }: {
  id: string; icon: React.ReactNode; title: string; help: string; children: React.ReactNode;
}) {
  return (
    <section id={id} className="panel flex scroll-mt-6 flex-col">
      <div className="flex items-center gap-3 border-b border-line px-5 py-4">
        <span className="flex size-10 shrink-0 items-center justify-center bg-accent-soft text-accent">{icon}</span>
        <h2 className="display text-[26px]">{title}</h2>
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
  if (!story) notFound();

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8">
      <header className="flex flex-col gap-3">
        <Link href={`/projects/${projectId}`} className="inline-flex min-h-11 w-fit items-center gap-1.5 text-xs text-muted hover:text-text">
          <IconArrowLeft /> Overview
        </Link>
        <p className="eyebrow">Add to your project</p>
        <h1 className="display text-4xl leading-none sm:text-5xl">Characters &amp; locations</h1>
        <p className="max-w-2xl text-muted">Add the people and places in your film. You can describe them and add artwork on their pages.</p>
      </header>
      <Flash error={error} notice={notice} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
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
