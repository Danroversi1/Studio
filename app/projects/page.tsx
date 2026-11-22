import Link from "next/link";
import { Flash } from "@/components/flash";
import { IconArrowUpRight, IconFilm, Wordmark } from "@/components/icons";
import { SubmitButton } from "@/components/ui";
import { listProjects } from "@/lib/data";
import { signOut } from "../login/actions";
import { createProject } from "./actions";

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { error, notice } = await searchParams;
  const projects = await listProjects();
  return (
    <div className="min-h-dvh">
      <header className="flex min-h-16 items-center justify-between border-b border-line bg-panel px-5 sm:px-8">
        <Wordmark />
        <form action={signOut}><button className="btn">Sign out</button></form>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-10 px-5 py-10 sm:px-8">
        <section className="panel corner-marks grid-lines px-6 pt-12 pb-8 sm:px-10">
          <p className="eyebrow">Your films</p>
          <h1 className="display mt-4 text-4xl leading-[0.95] sm:text-6xl">Every film starts as a spark.</h1>
          <p className="mt-5 max-w-xl text-muted">Pick up where you left off, or start something new.</p>
        </section>

        <Flash error={error} notice={notice} />

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
          <form action={createProject} className="panel flex flex-col">
            <div className="flex items-center gap-3 border-b border-line px-5 py-4">
              <span className="size-3 bg-brand" aria-hidden />
              <h2 className="display text-[22px]">Start a new film</h2>
            </div>
            <div className="flex flex-col gap-4 p-5">
              <div>
                <label className="label" htmlFor="name">Working title</label>
                <input className="field" id="name" name="name" required maxLength={120} />
              </div>
              <div>
                <label className="label" htmlFor="description">One-line idea (optional)</label>
                <input className="field" id="description" name="description" maxLength={2000} />
              </div>
              <p className="help">You&apos;ll be the Director: you decide which versions become the approved ones.</p>
              <SubmitButton variant="primary" pendingText="Creating…">Create private film</SubmitButton>
            </div>
          </form>
          {projects.map((p) => (
            <Link key={p.id} href={`/projects/${p.id}`} className="panel group flex flex-col hover:border-text">
              <div className="flex items-center gap-3 border-b border-line px-5 py-4">
                <span className="flex size-10 shrink-0 items-center justify-center bg-accent-soft text-accent"><IconFilm /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs text-muted">In development</span>
                  <span className="display block truncate text-lg">{p.name}</span>
                </span>
              </div>
              <p className="min-h-20 flex-1 px-5 py-4 text-sm leading-relaxed text-muted">{p.description || "A film in development."}</p>
              <span className="flex items-center justify-between border-t border-line px-5">
                <span className="text-xs text-muted">
                  Updated {new Date(p.updated_at).toLocaleDateString("en-US", { dateStyle: "medium" })}
                </span>
                <span className="link-accent">Open <IconArrowUpRight /></span>
              </span>
            </Link>
          ))}

        </div>
      </main>
    </div>
  );
}
