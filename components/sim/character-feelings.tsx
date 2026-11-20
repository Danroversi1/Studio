"use client";
// "How they're doing": a character's feelings in the story, on their own character page.
// Two separate scales (stress↔calm, sad↔happy) — writing controls for the fiction, not a
// measurement of anyone. Tracked for protagonists, antagonists and supporting characters.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { simSetState } from "@/app/projects/[projectId]/sim-actions";
import { changeWords, happinessLabel, stressLabel } from "@/lib/sim/rules";
import type { CharacterFeelings as Feelings } from "@/lib/sim/data";
import { Slider } from "./sim-desk";

function Bar({ value, left, right }: { value: number; left: string; right: string }) {
  const pct = (value + 100) / 2;
  return (
    <div className="flex items-center gap-2 text-xs text-muted">
      <span className="w-16 text-right">{left}</span>
      <div className="relative h-1.5 flex-1 bg-line" aria-hidden><span className="absolute top-[-3px] h-3 w-1.5 bg-text" style={{ left: `calc(${pct}% - 3px)` }} /></div>
      <span className="w-16">{right}</span>
    </div>
  );
}

export function CharacterFeelings({ projectId, characterId, name, canEdit, f }: { projectId: string; characterId: string; name: string; canEdit: boolean; f: Feelings }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [stress, setStress] = useState(f.now.stress);
  const [happy, setHappy] = useState(f.now.happiness);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <section className="panel flex flex-col gap-3 p-5" aria-labelledby="feel-h">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="feel-h" className="text-lg font-medium">How {name} is doing</h3>
        <span className="text-sm font-medium">{stressLabel(f.now.stress)} · {happinessLabel(f.now.happiness)}</span>
      </div>
      <p className="text-xs text-muted">
        Writing controls for your story, not a measurement of anyone. Stress and happiness are separate: someone can be both. They change when you approve events in{" "}
        <Link className="text-accent" href={`/projects/${projectId}/world#simulation`}>World &amp; Time → the world, day by day</Link>.
      </p>
      <div className="flex max-w-xl flex-col gap-2">
        <Bar value={f.now.stress} left="Calm" right="Stressed" />
        <Bar value={f.now.happiness} left="Sad" right="Happy" />
      </div>
      {f.changes.length > 0 && (
        <details className="text-xs text-muted"><summary className="cursor-pointer">What changed them</summary>
          <ul className="mt-1 flex flex-col gap-0.5">{f.changes.map((x, i) => <li key={i}>Day {x.day}: {changeWords(x.d_stress, x.d_happiness)}{x.kind === "director" ? ` (your change${x.note ? `: ${x.note}` : ""})` : " (an approved event)"}</li>)}</ul>
        </details>
      )}
      {canEdit && (open ? (
        <form className="flex flex-col gap-1.5" onSubmit={(e) => {
          e.preventDefault(); setMsg(null);
          start(async () => {
            const r = await simSetState({ projectId, characterId, stress, happiness: happy, note }).catch(() => ({ ok: false as const, error: "That didn't save. Try again." }));
            if (r.ok) { setMsg({ kind: "ok", text: r.note ?? "Saved." }); setOpen(false); router.refresh(); } else setMsg({ kind: "error", text: r.error });
          });
        }}>
          <Slider label="Stress" left="calm" right="stressed" value={stress} min={-100} max={100} onChange={setStress} />
          <Slider label="Happiness" left="sad" right="happy" value={happy} min={-100} max={100} onChange={setHappy} />
          {f.hasHistory && <input className="field min-h-8 max-w-md text-sm" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="Why? (optional)" />}
          <p className="text-[11px] text-muted">{f.hasHistory ? "Their story already has history, so this is recorded as a change today. Earlier days stay as they were." : "This sets where they start in the story."}</p>
          <div className="flex gap-2"><button className="btn-primary min-h-8 text-xs" disabled={pending}>Save</button><button type="button" className="btn min-h-8 text-xs" onClick={() => setOpen(false)}>Cancel</button></div>
        </form>
      ) : <button type="button" className="self-start text-xs text-accent underline" onClick={() => setOpen(true)}>{f.hasHistory ? "Adjust today" : "Set where they start"}</button>)}
      {msg && <p role={msg.kind === "error" ? "alert" : "status"} className={`text-xs ${msg.kind === "error" ? "text-danger" : "text-muted"}`}>{msg.text}</p>}
    </section>
  );
}
