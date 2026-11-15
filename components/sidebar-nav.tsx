"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconCharacter, IconLocation, IconOverview, IconSettings, IconSparkle, IconStory } from "./icons";

export interface NavEntity { id: string; name: string; approved: boolean }

function Item({ href, active, icon, children, badge }: {
  href: string; active: boolean; icon: React.ReactNode; children: React.ReactNode; badge?: number;
}) {
  return (
    <Link href={href} aria-current={active ? "page" : undefined}
      className={`flex min-h-11 items-center gap-3 border px-3 text-sm tracking-[0.04em] transition-colors ${
        active ? "border-text bg-text font-medium text-panel-2" : "border-transparent text-text/80 hover:border-line hover:bg-panel-2 hover:text-text"}`}>
      <span className={active ? "text-brand" : "text-muted"}>{icon}</span>
      <span className="flex-1 truncate">{children}</span>
      {badge ? <span className="badge bg-brand font-semibold text-text">{badge}</span> : null}
    </Link>
  );
}

function SubList({ projectId, items, path }: { projectId: string; items: NavEntity[]; path: string }) {
  if (!items.length) return null;
  return (
    <ul className="ml-11 flex flex-col border-l border-line pl-2">
      {items.map((e) => {
        const href = `/projects/${projectId}/items/${e.id}`;
        return (
          <li key={e.id}>
            <Link href={href} className={`flex min-h-10 items-center justify-between gap-2 rounded-lg px-2 text-sm ${
              path === href ? "font-medium text-text underline decoration-brand decoration-2 underline-offset-4" : "text-muted hover:text-text"}`}>
              <span className="truncate">{e.name}</span>
              {!e.approved && <span className="size-1.5 shrink-0 bg-brand" title="Not approved yet" />}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function SidebarNav({ projectId, storyId, characters, locations, pendingSuggestions, showAgents, showSettings }: {
  projectId: string; storyId?: string; characters: NavEntity[]; locations: NavEntity[];
  pendingSuggestions: number; showAgents: boolean; showSettings: boolean;
}) {
  const path = usePathname();
  const base = `/projects/${projectId}`;
  return (
    <nav aria-label="Project" className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <p className="eyebrow mb-2 px-3">Workspace</p>
        <Item href={base} active={path === base || path === `${base}/add`} icon={<IconOverview />}>Overview</Item>
        {storyId && (
          <Item href={`${base}/items/${storyId}`} active={path === `${base}/items/${storyId}`} icon={<IconStory />}>
            Story &amp; treatment
          </Item>
        )}
        {showAgents && (
          <Item href={`${base}/suggestions`} active={path === `${base}/suggestions`} icon={<IconSparkle />} badge={pendingSuggestions}>
            Your agents
          </Item>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <p className="eyebrow mb-2 px-3">Develop</p>
        <Item href={`${base}#characters`} active={false} icon={<IconCharacter />}>Characters</Item>
        <SubList projectId={projectId} items={characters} path={path} />
        <Item href={`${base}#locations`} active={false} icon={<IconLocation />}>Locations</Item>
        <SubList projectId={projectId} items={locations} path={path} />
      </div>
      {showSettings && (
        <div className="flex flex-col gap-1">
          <Item href={`${base}/settings`} active={path === `${base}/settings`} icon={<IconSettings />}>Project settings</Item>
        </div>
      )}
    </nav>
  );
}
