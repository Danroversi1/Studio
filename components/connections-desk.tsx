"use client";
// The Connections desk: the board plus knowledge → character connections, linked both ways
// (drag a character to a collection on the board, or click a blue string, to edit it below).
import { useCallback, useMemo, useState } from "react";
import { ConnectionsBoard } from "./connections-board";
import { KnowledgeConnections } from "./knowledge/knowledge-connections";
import { KnowledgeList } from "./knowledge/knowledge-list";
import { PURPOSE_LABEL } from "@/lib/knowledge/eligibility";
import type { BoardInput, BoardLink } from "@/lib/board";
import type { Beat, KnowledgeLink, LibraryItem, SceneContext } from "@/lib/knowledge/connect-data";

export function ConnectionsDesk({ projectId, canEdit, input, links, characters, collections, knowledge, beats, scenes, contexts, library }: {
  projectId: string; canEdit: boolean; input: Omit<BoardInput, "showScenes">; links: BoardLink[];
  characters: { id: string; name: string }[]; collections: { id: string; name: string; count: number; kind?: string; character_id?: string | null }[];
  library: LibraryItem[];
  knowledge: KnowledgeLink[]; beats: Beat[]; scenes: { key: string; heading: string }[]; contexts: SceneContext[];
}) {
  const [focus, setFocus] = useState<{ linkId?: string; characterId?: string; collectionId?: string } | null>(null);
  const strings = useMemo(() => knowledge.map((k) => ({ id: k.id, from: `e:${k.character_id}`, to: `k:${k.collection_id}`, label: PURPOSE_LABEL[k.purpose] })), [knowledge]);
  const done = useCallback(() => setFocus(null), []);
  return (
    <>
      <ConnectionsBoard projectId={projectId} canEdit={canEdit} links={links} input={{ ...input, collections }} knowledge={strings}
        onKnowledgePair={(c, k) => canEdit && setFocus({ characterId: c.slice(2), collectionId: k.slice(2) })}
        onKnowledgeSelect={(id) => setFocus({ linkId: id })} />
      <KnowledgeList projectId={projectId} canEdit={canEdit} characters={characters} collections={collections} links={knowledge} library={library}
        onConnect={(characterId, collectionId) => setFocus({ characterId, collectionId })} />
      <KnowledgeConnections projectId={projectId} canEdit={canEdit} characters={characters} collections={collections} links={knowledge}
        beats={beats} scenes={scenes} contexts={contexts} focus={focus} onFocusDone={done} />
    </>
  );
}
