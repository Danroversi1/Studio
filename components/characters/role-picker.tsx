"use client";
// Her choice of a character's role. It organizes characters across Studio (overview,
// Knowledge Base, Connections, cast lists). No model.
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setCharacterRole } from "@/app/projects/[projectId]/character-actions";
import { ROLES, ROLE_HINT, ROLE_LABEL, type CastRole } from "@/lib/characters/roles";

function useRole(projectId: string, entityId: string, role: CastRole | null) {
  const router = useRouter();
  const [value, setValue] = useState<CastRole | null>(role);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  function choose(next: CastRole | null) {
    const before = value;
    setValue(next); setErr(null);
    start(async () => {
      const r = await setCharacterRole({ projectId, entityId, role: next }).catch(() => ({ ok: false as const, error: "That didn't save. Try again." }));
      if (!r.ok) { setValue(before); setErr(r.error); } else router.refresh();
    });
  }
  return { value, choose, err, pending };
}

/** Buttons with a short hint each (character pages). Clicking the chosen role clears it. */
export function RoleButtons({ projectId, entityId, name, role }: { projectId: string; entityId: string; name: string; role: CastRole | null }) {
  const r = useRole(projectId, entityId, role);
  return (
    <div className="flex flex-col gap-1.5" role="group" aria-label={`${name}'s role`}>
      <span className="text-xs font-semibold tracking-wide text-muted">Role in the film</span>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {ROLES.map((x) => {
          const on = r.value === x;
          return (
            <button key={x} type="button" aria-pressed={on} disabled={r.pending} onClick={() => r.choose(on ? null : x)}
              className={`flex flex-col items-start border px-2.5 py-1.5 text-left transition-colors ${on ? "border-text bg-text text-panel-2" : "border-line bg-panel-2 hover:border-text"}`}>
              <span className="text-xs font-semibold">{ROLE_LABEL[x]}</span>
              <span className={`text-[11px] ${on ? "text-panel-2/80" : "text-muted"}`}>{ROLE_HINT[x]}</span>
            </button>
          );
        })}
      </div>
      {r.err && <p role="alert" className="text-xs text-danger">{r.err}</p>}
    </div>
  );
}

/** A compact menu (cards and lists). */
export function RoleSelect({ projectId, entityId, name, role }: { projectId: string; entityId: string; name: string; role: CastRole | null }) {
  const r = useRole(projectId, entityId, role);
  return (
    <span className="inline-flex items-center gap-2">
      <label className="sr-only" htmlFor={`role-${entityId}`}>{name}&apos;s role</label>
      <select id={`role-${entityId}`} value={r.value ?? ""} disabled={r.pending} onChange={(e) => r.choose((e.target.value || null) as CastRole | null)}
        className="min-h-8 border border-line bg-panel-2 px-2 text-xs">
        <option value="">Role not set</option>
        {ROLES.map((x) => <option key={x} value={x}>{ROLE_LABEL[x]}</option>)}
      </select>
      {r.err && <span role="alert" className="text-xs text-danger">{r.err}</span>}
    </span>
  );
}
