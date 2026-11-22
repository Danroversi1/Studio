"use client";
// Script writing desk: write in plain text, see formatted screenplay pages and the
// three-act timeline update as you type. Saving creates a new revision.
import { useMemo, useRef, useState } from "react";
import { ActTimeline } from "./act-timeline";
import { SubmitButton } from "./ui";
import { type ScriptElement, pages, parseScript } from "@/lib/screenplay";
import { SCENE_HEADING_RE } from "@/lib/scene-plan";

const norm = (h: string) => h.trim().replace(/^\./, "").toUpperCase();
const isHeading = (line: string) => SCENE_HEADING_RE.test(line.trim()) || /^\.[A-Za-z0-9]/.test(line.trim());

/** The scene the caret is in: its heading and which occurrence of that heading it is. */
function sceneAt(text: string, pos: number): { heading: string; nth: number } | null {
  let off = 0; let found: string | null = null; const seen = new Map<string, number>(); let nth = 0;
  for (const line of text.split("\n")) {
    if (off > pos) break;
    if (isHeading(line)) { const h = norm(line); const n = seen.get(h) ?? 0; seen.set(h, n + 1); found = h; nth = n; }
    off += line.length + 1;
  }
  return found ? { heading: found, nth } : null;
}

/** Ask the Develop scenes desk (below) to open a scene. */
function openScene(heading: string, nth: number) {
  window.dispatchEvent(new CustomEvent("studio:open-scene", { detail: { heading: norm(heading), nth } }));
}

const STYLE: Record<ScriptElement["type"], string> = {
  scene: "mt-4 font-bold uppercase",
  action: "mt-3",
  character: "mt-3 ml-[37%] uppercase",
  parenthetical: "ml-[29%] mr-[30%]",
  dialogue: "ml-[17%] mr-[20%]",
  transition: "mt-3 text-right uppercase",
  centered: "mt-3 text-center",
  act: "",
};

const INSERTS: { label: string; text: string; hint: string }[] = [
  { label: "Scene", text: "\n\nINT. PLACE - DAY\n\n", hint: "Start a scene: INT. or EXT., the place, then DAY or NIGHT" },
  { label: "Action", text: "\n\nWhat we see happen.\n\n", hint: "What the audience sees, in present tense" },
  { label: "Character + line", text: "\n\nNAME\nWhat they say.\n\n", hint: "Name in capitals, dialogue on the next line" },
  { label: "(Parenthetical)", text: "\n(quietly)\n", hint: "How a line is said, inside dialogue" },
  { label: "Transition", text: "\n\nCUT TO:\n\n", hint: "Capitals, ending in TO:" },
  { label: "Act break", text: "\n\n# ACT TWO\n\n", hint: "Marks an act on the timeline (not printed)" },
];

export function ScriptDesk({ projectId, entityId, initial, parentVersionId, baseVersionId, canEdit, saveAction, target, lengthLabel }: {
  projectId: string; entityId: string; initial: string; parentVersionId: string; baseVersionId: string;
  canEdit: boolean; saveAction: (fd: FormData) => void; target: number; lengthLabel: string | null;
}) {
  const [text, setText] = useState(initial);
  const [caret, setCaret] = useState<{ heading: string; nth: number } | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const parsed = useMemo(() => parseScript(text), [text]);
  const paged = useMemo(() => pages(parsed.elements), [parsed]);
  const dirty = text !== initial;

  function insert(snippet: string) {
    const el = area.current;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b } = el;
    const before = text.slice(0, a).replace(/\n*$/, "");
    const after = text.slice(b).replace(/^\n*/, "");
    const piece = before ? snippet : snippet.replace(/^\n+/, "");
    const next = before + piece + after;
    setText(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = (before + piece).length;
      el.setSelectionRange(pos, pos);
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <ActTimeline script={parsed} target={target} lengthLabel={lengthLabel} />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <form action={saveAction} className="panel flex flex-col gap-3 p-4">
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="entityId" value={entityId} />
          <input type="hidden" name="parentVersionId" value={parentVersionId} />
          <input type="hidden" name="baseVersionId" value={baseVersionId} />
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="display text-[22px]">Write</h2>
            <span className="flex flex-wrap items-center gap-2">
              {dirty && <span className="text-xs text-accent">Unsaved changes</span>}
              {canEdit && caret && (
                <button type="button" className="btn-primary min-h-8 px-2.5 text-[11px]" title={dirty ? "Save first so the draft starts from your latest text" : undefined}
                  onClick={() => openScene(caret.heading, caret.nth)}>Develop this scene: {caret.heading.slice(0, 40)} ↓</button>
              )}
            </span>
          </div>
          {canEdit && (
            <div className="flex flex-wrap gap-1.5" role="toolbar" aria-label="Insert">
              {INSERTS.map((i) => (
                <button key={i.label} type="button" title={i.hint} className="btn min-h-9 px-2.5 text-[11px]" onClick={() => insert(i.text)}>
                  {i.label}
                </button>
              ))}
            </div>
          )}
          <label className="sr-only" htmlFor="script-body">Screenplay</label>
          <textarea id="script-body" data-dirty={dirty ? "1" : "0"} ref={area} name="body" value={text} readOnly={!canEdit} maxLength={400000}
            onChange={(e) => setText(e.target.value)} spellCheck
            onSelect={(e) => setCaret(sceneAt(text, e.currentTarget.selectionStart))}
            className="field min-h-[60vh] resize-y font-mono text-[13px] leading-6"
            placeholder={"# ACT ONE\n\nEXT. OCEAN CLIFF - NIGHT\n\nWaves hit the rocks. A light turns.\n\nMIRA\n(whispering)\nIs anyone up there?"} />
          {canEdit && (
            <>
              <input name="changeSummary" maxLength={300} placeholder="What changed? (optional)" className="field" aria-label="What changed" />
              <div className="flex flex-wrap items-center gap-2">
                <SubmitButton variant="primary" pendingText="Saving…">Save revision</SubmitButton>
                <p className="text-xs text-muted">Every save is kept in history. Only the Director approves.</p>
              </div>
            </>
          )}
        </form>

        <section className="flex flex-col gap-3" aria-label="Formatted pages">
          <h2 className="display text-[22px]">Pages</h2>
          {paged.length > 0 && <p className="help -mt-2">Click a scene heading to develop that scene.</p>}
          {paged.length === 0 ? (
            <p className="help">Your formatted pages appear here as you write.</p>
          ) : (
            <div className="flex max-h-[80vh] flex-col gap-4 overflow-y-auto pr-1">
              {(() => {
                const seen = new Map<string, number>();
                return paged.map((page, i) => (
                  <article key={i} className="relative bg-paper px-[9%] py-8 font-mono text-[11.5px] leading-[1.45] text-paper-ink shadow-sm">
                    <span className="absolute top-3 right-4 text-[10px] text-paper-ink/50">{i + 1}.</span>
                    {page.map((el, j) => {
                      if (el.type !== "scene") return <p key={j} className={`whitespace-pre-wrap ${STYLE[el.type]} ${j === 0 ? "!mt-0" : ""}`}>{el.text}</p>;
                      const h = norm(el.text); const nth = seen.get(h) ?? 0; seen.set(h, nth + 1);
                      return (
                        <button key={j} type="button" onClick={() => openScene(h, nth)} title="Develop this scene (action and dialogue)"
                          className={`group block w-full text-left whitespace-pre-wrap hover:text-[#c2410c] ${STYLE.scene} ${j === 0 ? "!mt-0" : ""}`}>
                          {el.text} <span className="font-sans text-[10px] font-normal tracking-wide normal-case opacity-0 group-hover:opacity-100">Develop →</span>
                        </button>
                      );
                    })}
                  </article>
                ));
              })()}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
