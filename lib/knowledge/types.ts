// Knowledge Base record shapes (shared by server and browser). Pure.
export interface KSource {
  id: string; kind: "note" | "link" | "document" | "reference" | "feed"; adapter: string; status: string; title: string;
  url: string | null; feed_url: string | null; origin: string | null; asset_id: string | null; reference_id: string | null;
  director_note: string | null; paused: boolean; disconnected_at: string | null; refresh_hours: number | null;
  next_refresh_at: string | null; last_attempt_at: string | null; last_success_at: string | null; last_error: string | null;
  failures: number; created_at: string; updated_at: string;
}
export interface KItem {
  id: string; source_id: string; title: string; url: string | null; author: string | null; published_at: string | null;
  retrieved_at: string; content: string; content_status: string; version: number; director_note: string | null;
  verification: string; verification_note: string | null; updated_at: string;
}
export interface KCollection { id: string; name: string; description: string | null; character_id?: string | null }
export interface KMember { collection_id: string; source_id: string | null; item_id: string | null }

/** Collection ids an item belongs to (through its source or directly). */
export function collectionsOf(item: Pick<KItem, "id" | "source_id">, members: KMember[]): string[] {
  return [...new Set(members.filter((m) => m.source_id === item.source_id || m.item_id === item.id).map((m) => m.collection_id))];
}

export interface KCharacter { id: string; name: string; thumb: import("../thumb").ThumbSource; links: { collection_id: string; purpose: string; temporal: string }[] }
