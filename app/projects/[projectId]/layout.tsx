import Link from "next/link";
import { notFound } from "next/navigation";
import { SubmitButton } from "@/components/ui";
import { getProjectShell, type Capabilities, type EntityRow } from "@/lib/data";
import { createEntity } from "./actions";

function accessSummary(c: Capabilities) {
  const role = c.project_role === "executive_producer" ? "Executive Producer" : c.project_role === "director" ? "Director" : "Collaborator";
  const parts = [role, `${c.access_level?.[0].toUpperCase()}${c.access_level?.slice(1)} access`];
  if (c.can_admin) parts.push("Admin");
  if (c.can_approve_canonical) parts.push("Can approve");
  return parts.join(" · ");
}

function NavGroup({ title, items, projectId }: { title: string; items: EntityRow[]; projectId: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="px-2 text-xs font-semibold tracking-wide text-muted uppercase">{title}</h3>
      {items.length === 0 && <p className="help px-2">None yet.</p>}
      {items.map((e) => (
        <Link key={e.id} href={`/projects/${projectId}/items/${e.id}`}
          className="flex min-h-11 items-center justify-between rounded-lg px-2 hover:bg-panel-2">
          <span className="truncate">{e.name}</span>
          {!e.current_version_id && <span className="text-xs text-warn">not approved</span>}
        </Link>
      ))}
    </div>
  );
}

function NewItemForm({ projectId, kind, label }: { projectId: string; kind: "character" | "location"; label: string }) {
  return (
    <form action={createEntity} className="flex gap-2">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="kind" value={kind} />
      <label className="sr-only" htmlFor={`new-${kind}`}>{label}</label>
      <input id={`new-${kind}`} name="name" required maxLength={120} placeholder={label} className="field min-w-0 flex-1" />
      <SubmitButton pendingText="…">Add</SubmitButton>
    </form>
  );
}

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const shell = await getProjectShell(projectId);
  if (!shell || !shell.caps.member) notFound();
  const { project, caps, entities } = shell;
  const stories = entities.filter((e) => e.kind === "story");
  const characters = entities.filter((e) => e.kind === "character");
  const locations = entities.filter((e) => e.kind === "location");

  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <aside className="flex flex-col gap-5 border-line bg-panel p-4 lg:sticky lg:top-0 lg:h-dvh lg:w-72 lg:shrink-0 lg:overflow-y-auto lg:border-r">
        <div>
          <Link href="/projects" className="help hover:text-text">← All films</Link>
          <h1 className="mt-1 font-serif text-2xl leading-tight">{project.name}</h1>
          <p className="mt-1 text-xs text-muted">{accessSummary(caps)}</p>
        </div>
        {/* On iPad portrait the groups sit side by side; on desktop they stack in the sidebar. */}
        <nav className="grid grid-cols-1 gap-5 sm:grid-cols-3 lg:grid-cols-1" aria-label="Project">
          <NavGroup title="Write" items={stories} projectId={projectId} />
          <div className="flex flex-col gap-2">
            <NavGroup title="Characters" items={characters} projectId={projectId} />
            {caps.can_edit && <NewItemForm projectId={projectId} kind="character" label="New character" />}
          </div>
          <div className="flex flex-col gap-2">
            <NavGroup title="Locations" items={locations} projectId={projectId} />
            {caps.can_edit && <NewItemForm projectId={projectId} kind="location" label="New location" />}
          </div>
        </nav>
        {!caps.can_edit && (
          <p className="help rounded-lg border border-line p-3">
            {caps.can_review
              ? "You can read all work in progress and leave comments, but not change it."
              : "You can read the approved versions of this film."}
          </p>
        )}
      </aside>
      <main className="min-w-0 flex-1 p-4 sm:p-6">{children}</main>
    </div>
  );
}
