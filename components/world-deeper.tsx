"use client";
// "Explore deeper": optional detail beneath the World & Time overview.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveWorldSection } from "@/app/projects/[projectId]/world-actions";
import { DEEPER_KEYS, DEEPER_LABEL, type DeeperValue } from "@/lib/world";

export function WorldDeeper({ projectId, version, value, canEdit, locationCount, hasScript }: {
  projectId: string; version: number; value: DeeperValue; canEdit: boolean; locationCount: number; hasScript: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<DeeperValue>(value);
  const [msg, setMsg] = useState<{ error: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const dirty = DEEPER_KEYS.some((k) => (draft[k] ?? "") !== (value[k] ?? ""));
  const filled = DEEPER_KEYS.filter((k) => value[k]).length;
  return (
    <details className="panel group p-5" open={filled > 0 ? undefined : false}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
        <span>
          <span className="eyebrow block text-text">Explore deeper</span>
          <span className="text-sm text-muted">Places, chronology &amp; world rules{filled ? ` · ${filled} written` : " · optional"}</span>
        </span>
        <span aria-hidden className="text-accent group-open:rotate-90">›</span>
      </summary>
      <div className="mt-4 flex flex-col gap-4">
        <p className="text-sm text-muted">
          Specific places live in <Link className="text-accent" href={`/projects/${projectId}#locations`}>Locations ({locationCount})</Link>
          {hasScript ? <>; scene-by-scene time and place are in the <Link className="text-accent" href={`/projects/${projectId}/script`}>Script breakdown</Link></> : null}.
          Anything else you want to keep about your world can go here.
        </p>
        <form className="grid grid-cols-1 gap-4 md:grid-cols-2" onSubmit={(e) => {
          e.preventDefault();
          if (pending || !dirty) return;
          setMsg(null);
          start(async () => {
            try {
              const r = await saveWorldSection({ projectId, section: "deeper", value: draft, baseVersion: version });
              setMsg(r.ok ? { error: false, text: "Saved." } : { error: true, text: r.error ?? "That didn't save." });
              if (r.ok) router.refresh();
            } catch { setMsg({ error: true, text: "That didn't save. Your text is still here; try again." }); }
          });
        }}>
          {DEEPER_KEYS.map((k) => (
            <label key={k} className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{DEEPER_LABEL[k].label}</span>
              <span className="text-xs text-muted">{DEEPER_LABEL[k].help}</span>
              <textarea className="field mt-1 font-serif" rows={3} maxLength={4000} readOnly={!canEdit} value={draft[k] ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))} />
            </label>
          ))}
          {canEdit && (
            <div className="flex items-center gap-3 md:col-span-2">
              <button type="submit" className="btn-primary" disabled={pending || !dirty}>{pending ? "Saving…" : "Save"}</button>
              {dirty && <button type="button" className="btn" onClick={() => setDraft(value)} disabled={pending}>Cancel</button>}
              {msg && <p role={msg.error ? "alert" : "status"} className={`text-xs ${msg.error ? "text-danger" : "text-muted"}`}>{msg.text}</p>}
            </div>
          )}
        </form>
      </div>
    </details>
  );
}
