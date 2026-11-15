// The script's breakdown: every scene's place (interior/exterior), time, cast and what
// the art department needs. Read straight from the script, so it is always current.
import { parseBreakdown } from "@/lib/scene-plan";

export function BreakdownPanel({ body }: { body: string }) {
  const scenes = parseBreakdown(body);
  if (!scenes.length) return null;
  const places = new Map<string, Set<string>>();
  for (const s of scenes) {
    if (!places.has(s.location)) places.set(s.location, new Set());
    if (s.intExt !== "—") places.get(s.location)!.add(s.intExt);
  }
  const chip = (label: string, xs: string[]) => xs.length ? (
    <p className="text-xs"><span className="text-muted uppercase tracking-[0.08em]">{label}: </span>{xs.join(", ")}</p>
  ) : null;
  return (
    <section className="panel flex flex-col gap-4 p-4" aria-labelledby="bd-h">
      <div>
        <h2 id="bd-h" className="display text-lg">Breakdown</h2>
        <p className="text-sm text-muted">
          {scenes.length} {scenes.length === 1 ? "scene" : "scenes"} · {places.size} {places.size === 1 ? "place" : "places"}.
          Art notes are lines like [[Props: brass key]] in the script: they never print, and you can edit them.
        </p>
      </div>
      <ul className="flex flex-wrap gap-2">
        {[...places].map(([name, kinds]) => (
          <li key={name} className="badge border border-line">{name}{kinds.size ? ` · ${[...kinds].join(" & ")}` : ""}</li>
        ))}
      </ul>
      <ol className="flex flex-col">
        {scenes.map((s) => (
          <li key={s.number} className="flex flex-col gap-1 border-t border-line py-2">
            <p className="text-sm"><span className="font-semibold">{s.number}. {s.heading}</span>
              <span className="text-muted"> · {s.intExt}{s.time ? ` · ${s.time.toLowerCase()}` : ""}</span></p>
            {chip("Cast", s.characters)}
            {chip("Set", s.set)}
            {chip("Props", s.props)}
            {chip("Wardrobe", s.wardrobe)}
            {chip("Special effects", s.sfx)}
          </li>
        ))}
      </ol>
    </section>
  );
}
