// CONNECTIONS: every part of the story on one board.
import { notFound } from "next/navigation";
import { ConnectionsBoard } from "@/components/connections-board";
import { Empty } from "@/components/flash";
import { thumbOf } from "@/lib/thumb";
import { getAllReferences, getBoard, getLatestVersions, getProjectShell, getScreenplay } from "@/lib/data";

export default async function ConnectionsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const shell = await getProjectShell(projectId);
  if (!shell || !shell.caps.member) notFound();
  if (!shell.caps.can_review) return <Empty title="The board is for the creative team">You can read the approved versions of this film.</Empty>;
  const [latest, refs, board, sp] = await Promise.all([getLatestVersions(projectId), getAllReferences(projectId), getBoard(projectId), getScreenplay(projectId)]);
  const entities = shell.entities
    .filter((e) => e.kind === "character" || e.kind === "location")
    .map((e) => ({
      id: e.id, kind: e.kind as "character" | "location", name: e.name,
      summary: String(latest.get(e.id)?.content?.summary ?? ""),
      thumb: thumbOf((e as { metadata?: Record<string, unknown> | null }).metadata),
    }));
  const references = refs.filter((r) => r.preview_asset_id).map((r) => ({ id: r.id, title: r.title ?? "", credit: r.attribution ?? "", previewAssetId: r.preview_asset_id }));
  const script = String(sp?.versions?.[0]?.content?.body ?? "");

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <header className="flex flex-col gap-2">
        <p className="eyebrow">{shell.project.name}</p>
        <h1 className="display text-4xl leading-none sm:text-5xl">Connections</h1>
        <p className="max-w-2xl text-muted">Everything in your story on one board. Pin it, string it, name it.</p>
      </header>
      <ConnectionsBoard projectId={projectId} canEdit={!!shell.caps.can_edit} links={board.links}
        input={{ entities, references, notes: board.notes, positions: board.positions, script, base: `/projects/${projectId}` }} />
    </div>
  );
}
