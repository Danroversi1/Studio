"use client";
// A character's rules as one plain box of bullet points (one rule per line). Saved as versioned
// rules; changes apply from the next day.
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { simSaveBullets } from "@/app/projects/[projectId]/sim-actions";

export function RulesBox({ projectId, characterId = null, name, initial, canEdit, family = "character", title, intro, placeholder }: {
  projectId: string; characterId?: string | null; name: string; initial: string[]; canEdit: boolean;
  family?: "character" | "periphery"; title?: string; intro?: string; placeholder?: string;
}) {
  const router = useRouter();
  const start = initial.map((r) => `- ${r}`).join("\n");
  const [text, setText] = useState(start);
  const [pending, go] = useTransition();
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  return (
    <section id={family === "character" ? "rules" : "world-rules"} className="panel flex flex-col gap-2 p-5" aria-labelledby={`${family}-rules-h`}>
      <h3 id={`${family}-rules-h`} className="text-lg font-medium">{title ?? `How ${name} reacts`}</h3>
      <p className="text-xs text-muted">
        {intro ?? `Write ${name}'s rules as bullet points, one per line: how they react to the news, to what other characters tell them, and to what happens to them. Each morning the news in their coverage is checked against these to work out how ${name} is doing, and the day-by-day simulation follows them. Changes apply from the next day.`}
      </p>
      <textarea className="field text-[15px] leading-relaxed" rows={Math.max(6, text.split("\n").length + 1)} value={text} disabled={!canEdit || pending}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder ?? `- Gets anxious when AI labs hide what they've found\n- Feels hopeful when research is shared openly\n- Calms down after talking to Marie`} aria-label={title ?? `${name}'s rules`} />
      {canEdit && (
        <div className="flex items-center gap-3">
          <button type="button" className="btn-primary min-h-9 text-xs" disabled={pending || text === start}
            onClick={() => go(async () => {
              const r = await simSaveBullets({ projectId, family, characterId, text });
              setMsg(r.ok ? { kind: "ok", text: r.note } : { kind: "error", text: r.error });
              if (r.ok) router.refresh();
            })}>{pending ? "Saving…" : "Save rules"}</button>
          <span className="text-[11px] text-muted">One rule per line, as many as you like.</span>
        </div>
      )}
      {msg && <p role={msg.kind === "error" ? "alert" : "status"} className={`text-xs ${msg.kind === "error" ? "text-danger" : "text-muted"}`}>{msg.text}</p>}
    </section>
  );
}
