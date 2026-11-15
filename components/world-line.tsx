// One line of World & Time for other desks: her confirmed setting (never a suggestion).
import Link from "next/link";
import { composeSentence, type World } from "@/lib/world";

export function WorldLine({ projectId, world }: { projectId: string; world: World }) {
  const text = world.confirmed.summary?.value.text ?? composeSentence(world.confirmed);
  return (
    <p className="text-sm">
      <span className="eyebrow mr-2">World</span>
      {text ? <span className="font-serif">{text}</span> : <span className="text-muted">Not set yet.</span>}{" "}
      <Link href={`/projects/${projectId}/world`} className="text-xs text-accent">{text ? "World & Time" : "Set where & when"}</Link>
    </p>
  );
}
