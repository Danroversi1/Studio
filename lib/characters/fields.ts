// The character agent's profile fields (attached to the existing character record). Pure.
// Everything is optional: a character can be used for dialogue with none of it filled in.

export type FieldKey = "backstory" | "desires" | "fears" | "beliefs" | "relationships" | "expertise" | "voice" | "knows" | "misbeliefs" | "conceals" | "pressure";

export const FIELDS: { key: FieldKey; label: string; hint: string; group: "who" | "knows" }[] = [
  { key: "backstory", label: "Backstory", hint: "Where they come from, what shaped them.", group: "who" },
  { key: "desires", label: "Wants", hint: "What they're after, big and small.", group: "who" },
  { key: "fears", label: "Fears", hint: "What they're afraid of losing or facing.", group: "who" },
  { key: "beliefs", label: "Beliefs and values", hint: "What they think is true and right.", group: "who" },
  { key: "relationships", label: "Relationships", hint: "Who matters to them, and how.", group: "who" },
  { key: "expertise", label: "Professional expertise", hint: "What they know how to do; their field.", group: "who" },
  { key: "voice", label: "Speaking habits and vocabulary", hint: "How they talk: sentence length, favorite words, what they avoid saying.", group: "who" },
  { key: "pressure", label: "Under pressure", hint: "What they do when cornered, rushed or scared.", group: "who" },
  { key: "knows", label: "What they know", hint: "Facts they actually have in the story (not just research they could look up).", group: "knows" },
  { key: "misbeliefs", label: "What they get wrong", hint: "Things they misunderstand or believe incorrectly.", group: "knows" },
  { key: "conceals", label: "What they hide", hint: "What they keep from others, and from whom.", group: "knows" },
];

export const FIELD_LABEL = Object.fromEntries(FIELDS.map((f) => [f.key, f.label])) as Record<FieldKey, string>;

export interface Proposal { id: string; field: FieldKey; text: string; why: string; at: string }
export interface CharacterProfile { version: number; confirmed: Partial<Record<FieldKey, string>>; proposed: Proposal[] }
