// WORLD SIMULATION: world updates → proposed events → how characters might feel and what they
// might do → the Director approves → the story moves → (optionally) dialogue.
import { notFound } from "next/navigation";
import Link from "next/link";
import { Empty } from "@/components/flash";
import { SimDesk } from "@/components/sim/sim-desk";
import { getProjectShell } from "@/lib/data";
import { getSimulation } from "@/lib/sim/data";
import { aiConfigured } from "@/lib/ai/configured";

export const maxDuration = 300;

export default async function SimulationPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const shell = await getProjectShell(projectId);
  if (!shell || !shell.caps.member) notFound();
  if (!shell.caps.can_review) return <Empty title="The simulation is for the creative team">You can read the approved versions of this film.</Empty>;
  const sim = await getSimulation(projectId);
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <header className="flex flex-col gap-2">
        <p className="eyebrow">{shell.project.name}</p>
        <h1 className="display text-4xl leading-none sm:text-5xl">World simulation</h1>
        <p className="max-w-3xl text-muted">
          Each day, what&apos;s happening in your World and in your story can suggest a few small events: how your characters might feel, and what they might do next.
          Nothing becomes part of the story until you approve it, and dialogue is only written from approved events.
        </p>
        <p className="text-xs text-muted">
          Uses your <Link className="text-accent" href={`/projects/${projectId}/knowledge?world=1`}>World and Knowledge Base</Link>, who can know what (<Link className="text-accent" href={`/projects/${projectId}/connections`}>Connections</Link>), your characters&apos; profiles, and the <Link className="text-accent" href={`/projects/${projectId}/script`}>Script desk</Link>.
        </p>
      </header>
      <SimDesk projectId={projectId} canEdit={!!shell.caps.can_edit} canApprove={!!shell.caps.can_approve_canonical} aiReady={aiConfigured()} sim={sim} />
    </div>
  );
}
