import Link from "next/link";
import { Empty, Flash } from "@/components/flash";
import { SubmitButton } from "@/components/ui";
import { listProjects } from "@/lib/data";
import { signOut } from "../login/actions";
import { createProject } from "./actions";

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const projects = await listProjects();
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-5 py-10">
      <header className="flex items-center justify-between">
        <h1 className="font-serif text-3xl">Your films</h1>
        <form action={signOut}><button className="btn">Sign out</button></form>
      </header>
      <Flash error={error} />

      <section className="flex flex-col gap-3">
        {projects.length === 0 ? (
          <Empty title="No films yet">Start one below. Projects are private to you until you add collaborators.</Empty>
        ) : (
          projects.map((p) => (
            <Link key={p.id} href={`/projects/${p.id}`} className="panel block min-h-11 px-5 py-4 hover:border-muted">
              <span className="font-serif text-xl">{p.name}</span>
              {p.description && <span className="help mt-1 block">{p.description}</span>}
            </Link>
          ))
        )}
      </section>

      <form action={createProject} className="panel flex flex-col gap-4 p-5">
        <h2 className="text-lg font-medium">Start a new film</h2>
        <div>
          <label className="label" htmlFor="name">Working title</label>
          <input className="field" id="name" name="name" required maxLength={120} />
        </div>
        <div>
          <label className="label" htmlFor="description">One-line idea (optional)</label>
          <input className="field" id="description" name="description" maxLength={2000} />
        </div>
        <p className="help">You'll be the Director: you decide which versions become the approved ones.</p>
        <div><SubmitButton variant="primary" pendingText="Creating…">Create private project</SubmitButton></div>
      </form>
    </main>
  );
}
