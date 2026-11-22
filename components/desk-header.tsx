"use client";
// The bar above every desk: which film and desk are open, and what's waiting for her.
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Attention } from "@/lib/data";
import { ThemeToggle } from "./theme-toggle";

const DESKS: [RegExp, string][] = [
  [/\/world$/, "World & Time"], [/\/knowledge$/, "Knowledge Base"], [/\/connections$/, "Connections"], [/\/treatment$/, "Treatment"],
  [/\/script$/, "Script desk"], [/\/storyboards/, "Storyboards"], [/\/references$|\/import$/, "References"], [/\/suggestions$/, "Suggestions"],
  [/\/partners\/story$/, "Storybuilder"], [/\/partners\/world$/, "World Builder"], [/\/partners\/dialogue$/, "Dialogue partner"],
  [/\/partners\/shots$/, "Shot Builder"], [/\/partners\/design$/, "Design partner"], [/\/settings$/, "Project settings"], [/\/add$/, "Overview"],
  [/\/items\//, "Story & cast"],
];

export function DeskHeader({ projectId, film, attention }: { projectId: string; film: string; attention: Attention | null }) {
  const path = usePathname();
  const base = `/projects/${projectId}`;
  const desk = path === base ? "Overview" : DESKS.find(([re]) => re.test(path))?.[1] ?? "Overview";
  const items = attention ? [
    { n: attention.events, label: "event", href: `${base}/world#simulation`, what: "to approve" },
    { n: attention.suggestions, label: "suggestion", href: `${base}/suggestions`, what: "waiting" },
    { n: attention.dialogue, label: "dialogue draft", href: `${base}/script#develop-scenes`, what: "to review" },
    { n: attention.reassess, label: "changed outcome", href: `${base}/world#timeline`, what: "to reassess" },
  ].filter((x) => x.n > 0) : [];
  return (
    <header className="sticky top-0 z-20 flex min-h-16 flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-line bg-ink/90 px-5 py-3 backdrop-blur sm:px-8">
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-baseline gap-2 text-sm">
        <Link href="/projects" className="text-muted hover:text-text">Films</Link>
        <span className="text-line-strong" aria-hidden>/</span>
        <Link href={base} className="truncate text-soft hover:text-text">{film}</Link>
        <span className="text-line-strong" aria-hidden>/</span>
        <span className="display truncate text-2xl leading-none text-text" aria-current="page">{desk}</span>
      </nav>
      <div className="flex flex-wrap items-center gap-2 text-sm" aria-label="Waiting for you">
        {items.length ? items.map((x) => (
          <Link key={x.label} href={x.href} className="badge min-h-8 border border-ember/60 text-text hover:border-ember">
            <span className="mr-1.5 size-1.5 rounded-full bg-ember" aria-hidden />{x.n} {x.label}{x.n === 1 ? "" : "s"} {x.what}
          </Link>
        )) : <span className="text-muted">Nothing waiting for you</span>}
        <ThemeToggle className="ml-1" />
      </div>
    </header>
  );
}
