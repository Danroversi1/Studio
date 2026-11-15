import Link from "next/link";
import { notFound } from "next/navigation";
import { IconArrowLeft, IconFilm, Wordmark } from "@/components/icons";
import { SidebarNav } from "@/components/sidebar-nav";
import { countPendingSuggestions, currentUser, getProjectShell, type Capabilities } from "@/lib/data";
import { signOut } from "../../login/actions";

function roleLabel(c: Capabilities) {
  const role = c.project_role === "executive_producer" ? "Executive Producer" : c.project_role === "director" ? "Director" : "Collaborator";
  return c.can_edit ? role : `${role} · ${c.can_review ? "can review" : "can view"}`;
}

function initials(email?: string | null) {
  const name = (email ?? "").split("@")[0].replace(/[^a-zA-Z]+/g, " ").trim();
  const parts = name.split(" ").filter(Boolean);
  return ((parts[0]?.[0] ?? "S") + (parts[1]?.[0] ?? parts[0]?.[1] ?? "")).toUpperCase();
}

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const [shell, user] = await Promise.all([getProjectShell(projectId), currentUser()]);
  if (!shell || !shell.caps.member) notFound();
  const { project, caps, entities } = shell;
  const pending = caps.can_review ? await countPendingSuggestions(projectId) : 0;
  const story = entities.find((e) => e.kind === "story");
  const nav = (kind: string) =>
    entities.filter((e) => e.kind === kind).map((e) => ({ id: e.id, name: e.name, approved: !!e.current_version_id }));

  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <aside className="flex flex-col gap-6 border-line bg-panel px-5 py-6 lg:sticky lg:top-0 lg:h-dvh lg:w-80 lg:shrink-0 lg:overflow-y-auto lg:border-r">
        <Link href="/projects" className="px-1" aria-label="STUDIO — all films"><Wordmark /></Link>

        <Link href="/projects" className="panel flex items-center gap-3 p-3 hover:border-text/30" title="Switch film">
          <span className="flex size-12 shrink-0 items-center justify-center bg-text text-brand"><IconFilm /></span>
          <span className="min-w-0">
            <span className="display block truncate text-lg">{project.name}</span>
            <span className="block truncate text-sm text-muted">Short film · {roleLabel(caps)}</span>
          </span>
        </Link>

        <SidebarNav
          projectId={projectId}
          storyId={story?.id}
          characters={nav("character")}
          locations={nav("location")}
          pendingSuggestions={pending}
          showAgents={!!caps.can_review}
          showSettings={!!(caps.can_admin && caps.can_approve_creative)}
        />

        <div className="mt-auto flex items-center gap-3 border-t border-line pt-4">
          <span className="flex size-11 shrink-0 items-center justify-center bg-text text-sm font-semibold text-panel-2">
            {initials(user?.email)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{user?.email}</span>
            <span className="block text-xs text-muted">Your creative space</span>
          </span>
          <form action={signOut}><button className="btn min-h-9 px-3 text-xs">Sign out</button></form>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-line bg-panel px-5 py-3 sm:px-8">
          <nav aria-label="Breadcrumb" className="flex items-center gap-3 text-[15px]">
            <Link href="/projects" className="inline-flex min-h-11 items-center gap-1.5 text-muted hover:text-text">
              <IconArrowLeft /> All films
            </Link>
            <span className="text-line">/</span>
            <Link href={`/projects/${projectId}`} className="text-xs font-medium tracking-[0.12em] uppercase hover:text-accent">{project.name}</Link>
          </nav>
          <span className="inline-flex items-center gap-2 text-xs tracking-[0.12em] text-muted uppercase"><span className="size-2 bg-brand" aria-hidden /> Saved to the cloud</span>
        </header>
        <main className="min-w-0 flex-1 px-5 py-8 sm:px-8 lg:px-12">{children}</main>
      </div>
    </div>
  );
}
