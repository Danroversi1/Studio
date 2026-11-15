// What changed: every round of work, plus each developer comment and how it was resolved,
// with links to see it. Developer accounts only.
import Link from "next/link";
import { notFound } from "next/navigation";
import { CHANGELOG } from "@/lib/changelog";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const fmt = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default async function ChangesPage() {
  const sb = await supabaseServer();
  const { data: isDev } = await sb.rpc("is_studio_developer");
  if (!isDev) notFound();
  const { data } = await sb.from("dev_comments").select("id, path, body, status, resolution_note, created_at, resolved_at")
    .order("resolved_at", { ascending: false, nullsFirst: true }).limit(200);
  const comments = data ?? [];
  const open = comments.filter((c) => c.status === "open");
  const resolved = comments.filter((c) => c.status === "resolved");

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8 px-6 py-10">
      <header className="flex flex-col gap-2">
        <p className="eyebrow">For the developer</p>
        <h1 className="display text-4xl leading-none">What changed</h1>
        <p className="text-muted">Every round of work, newest first, with links to see it. Comments you left on the site are listed with how they were resolved.</p>
      </header>

      {open.length > 0 && (
        <section className="panel flex flex-col gap-2 p-5" aria-labelledby="open-h">
          <h2 id="open-h" className="eyebrow text-text">Still open ({open.length})</h2>
          <ul className="flex flex-col">
            {open.map((c) => (
              <li key={c.id} className="border-t border-line py-2 text-sm">
                <p>{c.body}</p>
                {c.resolution_note && <p className="text-xs text-muted">Progress: {c.resolution_note}</p>}
                <Link className="text-xs text-accent" href={c.path}>Open the page →</Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {CHANGELOG.map((r) => (
        <section key={r.at} className="panel flex flex-col gap-3 p-5" aria-label={r.title}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="display text-lg">{r.title}</h2>
            <p className="text-xs text-muted">{fmt(r.at)}</p>
          </div>
          <ul className="flex flex-col gap-1.5 text-sm">
            {r.items.map((i) => (
              <li key={i.text} className="flex flex-wrap gap-x-2">
                <span>{i.text}</span>
                {i.href && <Link className="text-accent" href={i.href}>See it →</Link>}
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section className="panel flex flex-col gap-2 p-5" aria-labelledby="done-h">
        <h2 id="done-h" className="eyebrow text-text">Your comments, resolved ({resolved.length})</h2>
        <ul className="flex flex-col">
          {resolved.map((c) => (
            <li key={c.id} className="border-t border-line py-2.5 text-sm">
              <p className="text-muted">“{c.body}”</p>
              <p>{c.resolution_note ?? "Resolved."}</p>
              <p className="text-xs text-muted">{c.resolved_at ? fmt(c.resolved_at) : ""} · <Link className="text-accent" href={c.path}>See it →</Link></p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
