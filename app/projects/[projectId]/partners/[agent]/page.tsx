// A conversation with one of the creative partners (Story or Design). The partner's
// instructions are the parent's specs in docs/agents; see lib/agents/partners.ts.
import Link from "next/link";
import { notFound } from "next/navigation";
import { Empty } from "@/components/flash";
import { IconPlus } from "@/components/icons";
import { PartnerChat } from "@/components/partner-chat";
import { PARTNERS, isPartnerId } from "@/lib/agents/partners";
import { aiConfigured } from "@/lib/agents/run-story-breakdown";
import { getAiBudget, getPartnerThreads, getProjectShell, getThreadMessages } from "@/lib/data";

export const maxDuration = 300;

export default async function PartnerPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string; agent: string }>;
  searchParams: Promise<{ thread?: string; new?: string }>;
}) {
  const { projectId, agent } = await params;
  const { thread, new: fresh } = await searchParams;
  if (!isPartnerId(agent)) notFound();
  const shell = await getProjectShell(projectId);
  if (!shell || !shell.caps.member) notFound();
  if (!shell.caps.can_review) {
    return <Empty title="The creative partners work with the creative team">You can read the approved versions of this film.</Empty>;
  }
  const partner = PARTNERS[agent];
  const [threads, budget] = await Promise.all([getPartnerThreads(projectId, agent), getAiBudget(projectId)]);
  const current = fresh ? null : (threads.find((t) => t.id === thread) ?? threads[0] ?? null);
  const messages = current ? await getThreadMessages(projectId, current.id) : [];
  const base = `/projects/${projectId}/partners/${agent}`;
  const unavailable = !aiConfigured()
    ? "The AI team isn't set up yet. Ask your Executive Producer."
    : !budget.available ? "This month's AI budget is used up. Ask your Executive Producer." : null;

  return (
    <div className="mx-auto grid max-w-6xl grid-cols-1 gap-6 lg:grid-cols-[1fr_15rem]">
      <div className="flex min-w-0 flex-col gap-5">
        <header className="flex flex-col gap-2">
          <p className="eyebrow">Your creative partners</p>
          <h1 className="display text-4xl leading-none sm:text-5xl">{partner.name}</h1>
          <p className="max-w-2xl text-muted">{partner.blurb} You&apos;re the director: your partner offers possibilities, and you decide.</p>
          <nav aria-label="Partners" className="mt-1 flex flex-wrap gap-2">
            {(["story", "design"] as const).map((p) => (
              <Link key={p} href={`/projects/${projectId}/partners/${p}`} aria-current={p === agent ? "page" : undefined}
                className={`btn ${p === agent ? "btn-primary" : ""}`}>{PARTNERS[p].name}</Link>
            ))}
          </nav>
        </header>
        <PartnerChat key={current?.id ?? "new"} projectId={projectId} agent={agent} partnerName={partner.name}
          opening={partner.opening} threadId={current?.id ?? null}
          initial={messages.map((m) => ({ id: m.id, role: m.role, content: m.content }))}
          canTalk={!!shell.caps.can_edit} unavailable={shell.caps.can_edit ? unavailable : null} />
      </div>

      <aside className="flex flex-col gap-2 lg:sticky lg:top-6 lg:self-start" aria-label="Conversations">
        <p className="eyebrow">Conversations</p>
        {shell.caps.can_edit && (
          <Link href={`${base}?new=1`} className="btn self-start"><IconPlus className="size-4" /> New conversation</Link>
        )}
        {threads.length === 0 ? (
          <p className="help">None yet.</p>
        ) : (
          <ul className="flex flex-col border-t border-line">
            {threads.map((t) => (
              <li key={t.id}>
                <Link href={`${base}?thread=${t.id}`} aria-current={t.id === current?.id ? "page" : undefined}
                  className={`block border-b border-line px-2 py-2.5 text-sm ${t.id === current?.id ? "bg-panel-2 font-medium" : "text-muted hover:text-text"}`}>
                  <span className="line-clamp-2">{t.title ?? "New conversation"}</span>
                  <span className="text-[11px] tracking-[0.08em] uppercase">{new Date(t.last_message_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}
