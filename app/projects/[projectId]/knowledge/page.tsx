// KNOWLEDGE BASE: the film's research library and updating sources. Research, not story
// fact: nothing here becomes part of the story unless she decides it does.
import Link from "next/link";
import { notFound } from "next/navigation";
import { KnowledgeBase } from "@/components/knowledge/knowledge-base";
import { getProjectShell } from "@/lib/data";
import { getKnowledge } from "@/lib/knowledge/data";
import { SocietyPanel } from "@/components/society/society-panel";
import { getSociety } from "@/lib/society/data";
import { supabaseServer } from "@/lib/supabase/server";
import { aiConfigured } from "@/lib/ai/configured";
import { CharacterCertain } from "@/components/knowledge/character-certain";
import { CharacterBubblePanel } from "@/components/bubbles/bubble-panels";
import { getBubbleDesk, getCharacterBubble } from "@/lib/bubbles/data";
import { roleOf } from "@/lib/characters/roles";

export const maxDuration = 120;

export default async function KnowledgePage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ character?: string; world?: string }> }) {
  const { projectId } = await params;
  const { character, world } = await searchParams;
  const shell = await getProjectShell(projectId);
  if (!shell || !shell.caps.member) notFound();
  if (!shell.caps.can_review) notFound();
  const kb = await getKnowledge(projectId);
  const society = world === "1" ? await getSociety(await supabaseServer(), projectId) : null;
  // A character opened: their fixed knowledge, the World, and their daily coverage, together.
  const sel = world === "1" ? null : kb.characters.find((c) => c.id === character) ?? null;
  const selEnt = sel ? shell.entities.find((e) => e.id === sel.id) : undefined;
  const [prof, bubble, desk] = sel ? await Promise.all([
    supabaseServer().then((sb) => sb.from("character_profiles").select("confirmed").eq("entity_id", sel.id).maybeSingle()).then((r) => (r.data?.confirmed ?? {}) as Record<string, string>),
    getCharacterBubble(projectId, sel.id, roleOf((selEnt?.metadata ?? null) as Record<string, unknown> | null)),
    getBubbleDesk(projectId),
  ]) : [null, null, null];
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
        impressions={kb.impressions} aiReady={aiConfigured()} worldOpen={world === "1"}
        certain={sel && prof ? <CharacterCertain projectId={projectId} characterId={sel.id} name={sel.name} confirmed={prof} /> : undefined}
        bubble={sel && bubble ? (bubble.eligible
          ? <CharacterBubblePanel projectId={projectId} characterId={sel.id} name={sel.name} canEdit={!!shell.caps.can_edit} b={bubble} desk={desk!} />
          : <section className="panel p-4 text-sm text-muted">{sel.name}&apos;s daily coverage (bubble) is tracked for protagonists, antagonists and supporting characters. Choose one of those roles above to start it{bubble.history > 0 ? `; ${bubble.history} earlier day${bubble.history === 1 ? " is" : "s are"} kept` : ""}.</section>)
          : undefined} />
      {society && <SocietyPanel projectId={projectId} canEdit={!!shell.caps.can_edit} s={society} />}
    </div>
  );
}
