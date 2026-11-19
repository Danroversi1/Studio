// SERVER ONLY. Builds everything one scene's dialogue proposal is based on, deterministically
// (no model): the scene and its outline beat, the characters in it with their confirmed
// profiles and objectives, story canon, and ONLY the research each character may draw on in
// this scene (retrieved by keyword, then filtered by the purpose/time rules). The request's
// fingerprint makes an unchanged request reuse its existing draft instead of drafting again.
import { createHash } from "node:crypto";
import { parseIntake } from "../intake";
import { eligibility, type LinkRule, type Use } from "../knowledge/eligibility";
import { latestScript, outlineBeats } from "../knowledge/connect-data";
import { renderWorld, toWorld } from "../world";
import { runtimeInfo } from "../runtime";
import { titleCase } from "../scene-plan";
import { supabaseServer } from "../supabase/server";
import { currentDialogue, sceneFrame, sceneSignature, splitScenes } from "./scenes";

export const WORKFLOW_VERSION = "scene-dialogue-v1";
type Sb = Awaited<ReturnType<typeof supabaseServer>>;

export interface ResearchRef { item_id: string; version: number; title: string; source: string; date: string | null; excerpt: string; use: Use; reason: string; collection: string }
export interface Perspective {
  id: string; name: string; description: string; profile_version: number;
  confirmed: Record<string, string>; objective: string; research: ResearchRef[];
}
export interface DialogueRequest {
  scene_key: string; heading: string; beat: { id: string; part: string; index: number; text: string; hash: string } | null;
  scene_text: string; kept_text: string; current_dialogue: string; previous_scene: string;
  story_date: string | null; story_date_note: string | null; runtime_seconds: number; tone: string | null;
  characters: Perspective[]; unknown_speakers: string[]; canon: { synopsis: string; world: string; decisions: string[]; relationships: string[] };
  director_note: string | null; parent: { id: string; elements: unknown } | null;
  pinned_snapshot_id: string | null; script_version_id: string | null; scene_signature: string;
}

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const words = (s: string) => [...new Set((s.toLowerCase().match(/[a-z0-9][a-z0-9'-]{2,}/g) ?? []))];
const STOP = new Set("the and for with that this from they them their there what when where which while will would into about after before because been being have has had was were are his her him she you your our out over just than then very also only some more most other such like".split(" "));

export async function buildRequest(sb: Sb, projectId: string, sceneKey: string, opts: { directorNote?: string | null; parentId?: string | null } = {}): Promise<
  { ok: true; request: DialogueRequest; hash: string; snapshot: ResearchRef[] } | { ok: false; error: string }> {
  const script = await latestScript(sb, projectId);
  const scenes = splitScenes(script.body);
  const idx = scenes.findIndex((s) => s.key === sceneKey);
  if (idx < 0) return { ok: false, error: "That scene is no longer in the script." };
  const scene = scenes[idx];

  const [beats, { data: ctx }, { data: chars }, { data: project }, { data: notes }, { data: world }, { data: board }] = await Promise.all([
    outlineBeats(sb, projectId),
    sb.from("scene_contexts").select("story_date, story_date_note, objectives, runtime_seconds, tone, pinned_snapshot_id").eq("project_id", projectId).eq("scene_key", sceneKey).maybeSingle(),
    sb.from("entities").select("id, name").eq("project_id", projectId).eq("kind", "character").is("archived_at", null),
    sb.from("projects").select("runtime:settings->>runtime").eq("id", projectId).single(),
    sb.from("story_notebook").select("kind, body, status").eq("project_id", projectId).eq("kind", "decision").neq("status", "archived").limit(40),
    sb.from("story_world").select("data, version").eq("project_id", projectId).maybeSingle(),
    sb.from("story_board_links").select("from_key, to_key, label").eq("project_id", projectId).limit(200),
  ]);

  const bi = scene.beatId ? beats.findIndex((b) => b.id === scene.beatId) : -1;
  const beat = bi >= 0 ? { id: beats[bi].id, part: beats[bi].part, index: bi + 1, text: beats[bi].text, hash: hash(beats[bi].text) } : null;
  const nameKey = (n: string) => titleCase(n).toLowerCase().trim();
  const cast = (chars ?? []) as { id: string; name: string }[];
  const byName = new Map(cast.map((c) => [nameKey(c.name), c]));
  // Who is in the scene: speakers in the script, plus cast named in the beat or the scene.
  const hay = `${beat?.text ?? ""}\n${scene.text}`.toLowerCase();
  const inScene = new Map<string, { id: string; name: string }>();
  for (const sp of scene.characters) { const c = byName.get(nameKey(sp)); if (c) inScene.set(c.id, c); }
  for (const c of cast) if (new RegExp(`\\b${c.name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(hay)) inScene.set(c.id, c);
  const unknownSpeakers = scene.characters.filter((sp) => !byName.has(nameKey(sp)));
  const people = [...inScene.values()].slice(0, 8);

  const latest = async (id: string) => (await sb.from("versions").select("content").eq("entity_id", id).order("version_number", { ascending: false }).limit(1).maybeSingle()).data;
  const ids = people.map((p) => p.id);
  const [{ data: profiles }, { data: links }] = await Promise.all([
    ids.length ? sb.from("character_profiles").select("entity_id, version, confirmed").in("entity_id", ids) : Promise.resolve({ data: [] }),
    ids.length ? sb.from("character_knowledge").select("character_id, collection_id, purpose, temporal, scope_terms, from_beat, knowledge_collections(name)")
      .eq("project_id", projectId).in("character_id", ids).is("archived_at", null) : Promise.resolve({ data: [] }),
  ]);
  const objectives = ((ctx?.objectives ?? {}) as Record<string, string>);
  const storyDate = (ctx?.story_date as string | null) ?? null;
  const order = beats.map((b) => b.id);
  const sceneTime = { story_date: storyDate, beat_id: beat?.id ?? null };

  // Research: a pinned snapshot fixes exactly which item versions are used; otherwise
  // retrieve by keyword within each character's connected collections, then apply the rules.
  type PinRow = { item_id: string; version: number; character_id?: string; use?: Use; reason?: string; collection?: string };
  let pinned: PinRow[] | null = null;
  if (ctx?.pinned_snapshot_id) {
    const { data: snap } = await sb.from("knowledge_snapshots").select("items").eq("id", ctx.pinned_snapshot_id).maybeSingle();
    pinned = (snap?.items ?? null) as PinRow[] | null;
  }
  const perspectives: Perspective[] = [];
  const allRefs: ResearchRef[] = [];
  for (const p of people) {
    const prof = ((profiles ?? []) as { entity_id: string; version: number; confirmed: Record<string, string> }[]).find((x) => x.entity_id === p.id);
    const desc = String((await latest(p.id))?.content?.summary ?? "");
    const mine = ((links ?? []) as unknown as (LinkRule & { character_id: string; collection_id: string; knowledge_collections: { name: string } | null })[])
      .filter((l) => l.character_id === p.id && l.purpose !== "director_only");
    let research: ResearchRef[] = [];
    if (pinned) {
      const rows = pinned.filter((x) => x.character_id === p.id);
      if (rows.length) {
        const { data: vers } = await sb.from("knowledge_item_versions").select("item_id, version, title, content, published_at")
          .in("item_id", rows.map((r) => r.item_id));
        research = rows.flatMap((r) => {
          const v = ((vers ?? []) as { item_id: string; version: number; title: string; content: string; published_at: string | null }[]).find((x) => x.item_id === r.item_id && x.version === r.version);
          return v ? [{ item_id: r.item_id, version: r.version, title: v.title, source: "", date: v.published_at, excerpt: v.content.slice(0, 700), use: r.use ?? "background", reason: r.reason ?? "Pinned for this scene.", collection: r.collection ?? "" }] : [];
        });
      }
    } else if (mine.length) {
      const terms = words([beat?.text ?? "", scene.text, objectives[p.id] ?? "", prof?.confirmed?.expertise ?? "", prof?.confirmed?.desires ?? ""].join(" "))
        .filter((w) => !STOP.has(w)).slice(0, 40);
      for (const l of mine) {
        const { data: hits } = await sb.rpc("kb_search", { p_project: projectId, p_collections: [l.collection_id], p_terms: terms, p_limit: 12 });
        const hitIds = ((hits ?? []) as { item_id: string }[]).map((h) => h.item_id);
        if (!hitIds.length) continue;
        const { data: items } = await sb.from("knowledge_items").select("id, version, title, content, published_at, knowledge_sources(title)").in("id", hitIds);
        const ranked = hitIds.map((id) => ((items ?? []) as unknown as { id: string; version: number; title: string; content: string; published_at: string | null; knowledge_sources: { title: string } | null }[]).find((i) => i.id === id)).filter(Boolean) as { id: string; version: number; title: string; content: string; published_at: string | null; knowledge_sources: { title: string } | null }[];
        for (const i of ranked) {
          const e = eligibility(l, i, sceneTime, order);
          if (e.use === "excluded") continue;
          research.push({ item_id: i.id, version: i.version, title: i.title, source: i.knowledge_sources?.title ?? "", date: i.published_at, excerpt: i.content.slice(0, 700), use: e.use, reason: e.reason, collection: l.knowledge_collections?.name ?? "" });
        }
      }
      // Only the most relevant few per character: never whole feeds or libraries.
      const seen = new Set<string>();
      research = research.filter((r) => (seen.has(r.item_id) ? false : (seen.add(r.item_id), true)));
      research = [...research.filter((r) => r.use !== "adaptation").slice(0, 4), ...research.filter((r) => r.use === "adaptation").slice(0, 2)];
    }
    allRefs.push(...research);
    perspectives.push({ id: p.id, name: p.name, description: desc.slice(0, 1500), profile_version: prof?.version ?? 0,
      confirmed: prof?.confirmed ?? {}, objective: objectives[p.id] ?? "", research });
  }

  const { data: storyEnt } = await sb.from("entities").select("id").eq("project_id", projectId).eq("kind", "story").limit(1).maybeSingle();
  const synopsis = storyEnt ? parseIntake(String((await latest(storyEnt.id))?.content?.body ?? "")).idea : "";
  const nameOfKey = (k: string) => cast.find((c) => `e:${c.id}` === k)?.name;
  const relationships = ((board ?? []) as { from_key: string; to_key: string; label: string | null }[])
    .filter((l) => l.label && nameOfKey(l.from_key) && nameOfKey(l.to_key) && (inScene.has(l.from_key.slice(2)) || inScene.has(l.to_key.slice(2))))
    .map((l) => `${nameOfKey(l.from_key)} — ${l.label} — ${nameOfKey(l.to_key)}`).slice(0, 20);

  let parent: DialogueRequest["parent"] = null;
  if (opts.parentId) {
    const { data: par } = await sb.from("dialogue_proposals").select("id, result").eq("id", opts.parentId).eq("project_id", projectId).maybeSingle();
    if (par?.result) parent = { id: par.id, elements: (par.result as { elements?: unknown }).elements ?? [] };
  }
  const filmMinutes = runtimeInfo((project as { runtime?: string | null } | null)?.runtime ?? null)?.pages ?? null;
  const runtimeSec = (ctx?.runtime_seconds as number | null) ?? Math.max(20, Math.min(180, filmMinutes ? Math.round((filmMinutes * 60) / Math.max(scenes.length, 1)) : 60));

  const request: DialogueRequest = {
    scene_key: sceneKey, heading: scene.heading, beat,
    scene_text: scene.text.slice(0, 6000), kept_text: sceneFrame(scene).kept.join("\n\n").slice(0, 4000), current_dialogue: currentDialogue(scene).slice(0, 4000),
    previous_scene: idx > 0 ? scenes[idx - 1].text.slice(0, 1500) : "",
    story_date: storyDate, story_date_note: (ctx?.story_date_note as string | null) ?? null, runtime_seconds: runtimeSec, tone: (ctx?.tone as string | null) ?? null,
    characters: perspectives, unknown_speakers: unknownSpeakers,
    canon: { synopsis: synopsis.slice(0, 3000), world: renderWorld(toWorld(world)).slice(0, 2500), decisions: ((notes ?? []) as { body: string }[]).map((n) => n.body.slice(0, 300)), relationships },
    director_note: opts.directorNote?.trim() || null, parent,
    pinned_snapshot_id: (ctx?.pinned_snapshot_id as string | null) ?? null, script_version_id: script.versionId, scene_signature: hash(sceneSignature(scene)),
  };
  const fingerprint = hash(JSON.stringify({
    w: WORKFLOW_VERSION, s: request.scene_signature, b: beat?.hash ?? null, d: storyDate, ctx: [objectives, request.runtime_seconds, request.tone, request.story_date_note],
    c: perspectives.map((p) => [p.id, p.profile_version, p.objective, p.research.map((r) => [r.item_id, r.version, r.use])]),
    canon: hash(JSON.stringify(request.canon)), n: request.director_note, p: parent?.id ?? null,
  }));
  const snapshot = perspectives.flatMap((p) => p.research.map((r) => ({ ...r, character_id: p.id })));
  return { ok: true, request, hash: fingerprint, snapshot };
}
