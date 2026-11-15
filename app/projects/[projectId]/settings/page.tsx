import { notFound } from "next/navigation";
import { Empty, Flash } from "@/components/flash";
import { getProjectShell } from "@/lib/data";
import { deleteProject } from "../actions";

export default async function ProjectSettings({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { projectId } = await params;
  const { error } = await searchParams;
  const shell = await getProjectShell(projectId);
  if (!shell || !shell.caps.member) notFound();
  const { caps, project } = shell;
  if (!(caps.can_admin && caps.can_approve_creative)) {
    return <Empty title="Settings are for the film's Director">Ask the Director if something needs changing.</Empty>;
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <header>
        <p className="eyebrow">Project settings</p>
        <h1 className="display mt-3 text-4xl leading-none">{project.name}</h1>
      </header>
      <Flash error={error} />

      <section className="panel" aria-labelledby="delete-h">
        <div className="flex items-center gap-3 border-b border-line px-5 py-4">
          <span className="size-3 bg-danger" aria-hidden />
          <h2 id="delete-h" className="display text-xl">Delete this film</h2>
        </div>
        <form action={deleteProject} className="flex flex-col gap-4 p-5">
          <input type="hidden" name="projectId" value={projectId} />
          <p className="text-sm leading-relaxed">
            Deleting hides <strong>{project.name}</strong> from everyone on the team, including its story, characters,
            locations, artwork and history. It can be recovered for a while if you change your mind.
          </p>
          <div>
            <label className="label" htmlFor="confirmName">Type the film&apos;s title to confirm</label>
            <input id="confirmName" name="confirmName" required autoComplete="off" placeholder={project.name} className="field" />
          </div>
          <button type="submit" className="btn self-start border-danger text-danger hover:bg-danger hover:text-panel-2">Delete film</button>
        </form>
      </section>
    </div>
  );
}
