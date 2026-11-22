// What a character knows for certain (her confirmed profile on the character page), shown
// read-only on the Knowledge Base beside their research, the World and their daily coverage.
import Link from "next/link";
import { FIELDS, type FieldKey } from "@/lib/characters/fields";

export function CharacterCertain({ projectId, characterId, name, confirmed }: { projectId: string; characterId: string; name: string; confirmed: Partial<Record<FieldKey, string>> }) {
  const filled = FIELDS.filter((f) => (confirmed[f.key] ?? "").trim());
  const knows = filled.filter((f) => f.group === "knows");
  const who = filled.filter((f) => f.group === "who");
  const row = (f: (typeof FIELDS)[number]) => (
    <li key={f.key} className="text-sm"><b>{f.label}:</b> <span className="whitespace-pre-wrap">{confirmed[f.key]}</span></li>
  );
  return (
    <section className="panel flex flex-col gap-3 p-4" aria-labelledby="certain-h">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="certain-h" className="display text-lg">Fixed knowledge: what {name} knows for certain</h2>
        <Link href={`/projects/${projectId}/items/${characterId}`} className="text-xs text-accent">Edit on {name}&apos;s character page →</Link>
      </div>
      {filled.length ? (
        <>
          {knows.length > 0 && <ul className="flex flex-col gap-1">{knows.map(row)}</ul>}
          {who.length > 0 && (
            <details>
              <summary className="cursor-pointer text-xs text-accent">Who {name} is ({who.length})</summary>
              <ul className="mt-2 flex flex-col gap-1">{who.map(row)}</ul>
            </details>
          )}
        </>
      ) : <p className="text-sm text-muted">Nothing confirmed yet. Fill in &ldquo;What they know&rdquo; on {name}&apos;s character page.</p>}
    </section>
  );
}
