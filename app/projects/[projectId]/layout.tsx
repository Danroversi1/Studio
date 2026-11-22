import Link from "next/link";
import { runtimeInfo } from "@/lib/runtime";
import { notFound } from "next/navigation";
import { IconFilm, Wordmark } from "@/components/icons";
import { SidebarNav } from "@/components/sidebar-nav";
import { RefreshOnReturn } from "@/components/refresh-on-return";
import { currentUser, getAttention, getProjectShell, type Capabilities } from "@/lib/data";
import { DeskHeader } from "@/components/desk-header";
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
  const attention = caps.can_review ? await getAttention(projectId).catch(() => null) : null;
  const pending = attention?.suggestions ?? 0;
  const story = entities.find((e) => e.kind === "story");
  const nav = (kind: string) =>
    entities.filter((e) => e.kind === kind).map((e) => ({ id: e.id, name: e.name, approved: !!e.current_version_id }));

  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <RefreshOnReturn />
      <aside className="flex flex-col gap-6 border-line bg-ink px-5 py-6 lg:sticky lg:top-0 lg:h-dvh lg:w-80 lg:shrink-0 lg:overflow-y-auto lg:border-r">
        <Link href="/projects" className="px-1" aria-label="STUDIO — all films"><Wordmark /></Link>

        <Link href="/projects" className="panel flex items-center gap-3 p-3 hover:border-text/30" title="Switch film">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-full border border-line text-accent"><IconFilm /></span>
          <span className="min-w-0">
            <span className="display block truncate text-2xl leading-tight">{project.name}</span>
            <span className="block truncate text-sm text-muted">{runtimeInfo((project as { runtime?: string | null }).runtime)?.short ?? "Film"} · {roleLabel(caps)}</span>
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
          showImport={!!caps.can_edit}
        />

        <div className="mt-auto flex items-center gap-3 border-t border-line pt-4">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full border border-line text-sm font-medium text-soft">
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
        <DeskHeader projectId={projectId} film={project.name} attention={attention} />
        <main className="min-w-0 flex-1 px-5 py-8 sm:px-8 lg:px-12">{children}</main>
      </div>
    </div>
  );
}
