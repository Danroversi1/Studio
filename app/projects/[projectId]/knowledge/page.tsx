// KNOWLEDGE BASE: the film's research library and updating sources. Research, not story
// fact: nothing here becomes part of the story unless she decides it does.
import Link from "next/link";
import { notFound } from "next/navigation";
import { KnowledgeBase } from "@/components/knowledge/knowledge-base";
import { getProjectShell } from "@/lib/data";
import { getKnowledge } from "@/lib/knowledge/data";
import { aiConfigured } from "@/lib/ai/configured";

export const maxDuration = 120;

export default async function KnowledgePage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ character?: string; world?: string }> }) {
  const { projectId } = await params;
  const { character, world } = await searchParams;
  const shell = await getProjectShell(projectId);
  if (!shell || !shell.caps.member) notFound();
  if (!shell.caps.can_review) notFound();
  const kb = await getKnowledge(projectId);
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="eyebrow">{shell.project.name}</p>
        <h1 className="display text-4xl leading-none sm:text-5xl">Knowledge Base</h1>
        <p className="max-w-3xl text-muted">
          Your film&apos;s research library. Notes, links, documents and updating sources live here, organized in collections.
          It&apos;s research, not story fact: nothing here becomes part of your story unless you decide it does.
        </p>
        <p className="text-sm"><Link className="text-accent" href={`/projects/${projectId}/connections`}>Give characters access to a collection on the Connections desk →</Link></p>
      </header>
      <KnowledgeBase projectId={projectId} canEdit={!!shell.caps.can_edit} sources={kb.sources} items={kb.items}
        collections={kb.collections} members={kb.members} references={kb.references} used={kb.usedByCharacters}
        characters={kb.characters} selectedCharacter={kb.characters.some((c) => c.id === character) ? character! : null}
        impressions={kb.impressions} aiReady={aiConfigured()} worldOpen={world === "1"} />
    </div>
  );
}
