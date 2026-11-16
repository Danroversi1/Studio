"use client";
// Conversation with a creative partner. Replies take a few seconds; her message shows at
// once and the partner's reply replaces the "thinking" line when it's saved.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useRef, useState, useTransition } from "react";

export interface ChatMessage { id: string; role: "user" | "assistant"; content: string }

/** Tiny, safe formatter for the partner's light markdown: paragraphs, lists, **bold**. */
function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return <>{parts.map((p, i) => (p.startsWith("**") && p.endsWith("**") && p.length > 4
    ? <strong key={i}>{p.slice(2, -2)}</strong> : <Fragment key={i}>{p}</Fragment>))}</>;
}
function Formatted({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="flex flex-col gap-2.5">
      {blocks.map((b, i) => {
        const lines = b.split("\n");
        const isList = lines.every((l) => /^\s*([-*•]|\d+[.)])\s+/.test(l));
        if (isList) {
          const ordered = /^\s*\d/.test(lines[0]);
          const items = lines.map((l, j) => <li key={j}><Inline text={l.replace(/^\s*([-*•]|\d+[.)])\s+/, "")} /></li>);
          return ordered ? <ol key={i} className="list-decimal pl-5">{items}</ol> : <ul key={i} className="list-disc pl-5">{items}</ul>;
        }
        if (/^#{1,4}\s/.test(b)) return <p key={i} className="font-semibold"><Inline text={b.replace(/^#{1,4}\s+/, "")} /></p>;
        return <p key={i} className="whitespace-pre-wrap"><Inline text={b} /></p>;
      })}
    </div>
  );
}

/** Optional answer chips at the end of a reply: a line like [[choices: A | B | C]]. */
export function splitChoices(text: string): { body: string; choices: string[] } {
  const m = /\n*\[\[choices:\s*([^\]]*)\]\]\s*$/i.exec(text);
  if (!m) return { body: text, choices: [] };
  return { body: text.slice(0, m.index).trimEnd(), choices: m[1].split("|").map((c) => c.trim()).filter(Boolean).slice(0, 4) };
}

export function PartnerChat({ projectId, agent, partnerName, opening, threadId, initial, canTalk, unavailable, prompt, basePath, focus }: {
  projectId: string; agent: string; partnerName: string; opening: string; threadId: string | null;
  initial: ChatMessage[]; canTalk: boolean; unavailable: string | null; prompt?: string;
  /** What she has open (e.g. a storyboard), sent with each message. */
  focus?: { storyboard_id: string };
  /** Where this conversation lives (defaults to the partner's own page). */
  basePath?: string;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>(initial);
  const [draft, setDraft] = useState(prompt ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => { setMessages(initial); }, [initial]);
  // Braces matter: newer browsers return a Promise from scrollIntoView, and an effect must
  // return nothing (or a cleanup function), or React crashes when the page is left.
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [messages.length, pending]);

  function send(text?: string) {
    const content = (text ?? draft).trim();
    if (!content || pending) return;
    setError(null);
    if (text === undefined) setDraft("");
    const localId = `local-${Date.now()}`;
    setMessages((m) => [...m, { id: localId, role: "user", content }]);
    start(async () => {
      let res: { threadId?: string; error?: string; unsent?: boolean };
      try {
        const r = await fetch("/api/partners/message", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, agent, threadId, content, focus: focus ?? null }),
        });
        res = await r.json();
      } catch {
        res = { error: "That didn't go through. Check your connection and try again.", unsent: true };
      }
      if (res.error) {
        setError(res.error);
        // Not saved: give her words back so nothing is lost.
        if (res.unsent) {
          setMessages((m) => m.filter((x) => x.id !== localId));
          if (text === undefined) setDraft(content);
        }
      }
      if (res.threadId && res.threadId !== threadId) {
        router.replace(`${basePath ?? `/projects/${projectId}/partners/${agent}`}?thread=${res.threadId}`, { scroll: false });
      }
      router.refresh();
    });
  }
  const last = messages[messages.length - 1];
  const chips = !pending && canTalk && !unavailable && last?.role === "assistant" ? splitChoices(last.content).choices : [];

  return (
    <div className="flex flex-col gap-4">
      <ol className="flex flex-col gap-4" aria-live="polite">
        <li className="max-w-[46rem] border border-line bg-panel-2 px-4 py-3 text-sm leading-relaxed">
          <p className="eyebrow mb-1.5">{partnerName}</p>
          <p>{opening}</p>
        </li>
        {messages.map((m) => (
          <li key={m.id} className={m.role === "user"
            ? "ml-auto max-w-[40rem] bg-text px-4 py-3 text-sm leading-relaxed text-panel-2"
            : "max-w-[46rem] border border-line bg-panel-2 px-4 py-3 text-sm leading-relaxed"}>
            <p className={`eyebrow mb-1.5 ${m.role === "user" ? "text-brand" : ""}`}>{m.role === "user" ? "You" : partnerName}</p>
            {m.role === "user" ? <p className="whitespace-pre-wrap">{m.content}</p> : <Formatted text={splitChoices(m.content).body} />}
          </li>
        ))}
        {pending && (
          <li className="max-w-[46rem] border border-dashed border-line px-4 py-3 text-sm text-muted" role="status">
            {partnerName} is thinking…
          </li>
        )}
      </ol>
      <div ref={end} />

      {chips.length > 0 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Quick answers (or write your own)">
          {[...chips, "Not sure yet"].map((c) => (
            <button key={c} type="button" className="btn min-h-9 text-xs" onClick={() => send(c)}>{c}</button>
          ))}
        </div>
      )}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {unavailable ? (
        <p className="help">{unavailable}</p>
      ) : canTalk ? (
        <form className="panel flex flex-col gap-2 p-3" onSubmit={(e) => { e.preventDefault(); send(); }} aria-busy={pending}>
          <label className="sr-only" htmlFor="msg">Message to {partnerName}</label>
          <textarea id="msg" rows={3} maxLength={6000} value={draft} disabled={pending}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }}
            placeholder="Write to your partner…" className="field min-h-24 resize-y" />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted">Sent to Anthropic&apos;s Claude AI. Each reply uses a little of the film&apos;s AI budget.</p>
            <button type="submit" className="btn btn-primary" disabled={pending || !draft.trim()}>
              {pending ? "Waiting…" : "Send"}
            </button>
          </div>
        </form>
      ) : (
        <p className="help">You can read this conversation. Only people with Edit access can talk to the partners.</p>
      )}
      {(agent === "story" || agent === "design") && <p className="text-xs text-muted">
        Characters and locations your partner suggests wait in <Link href={`/projects/${projectId}/suggestions`} className="link-accent">Suggestions</Link> for your decision.
      </p>}
    </div>
  );
}
