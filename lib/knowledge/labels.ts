// Plain-language labels for Knowledge Base states. "Live" is never claimed: the label says
// what actually happens. Pure.

export const STATUS: Record<string, { label: string; tone: "ok" | "warn" | "muted" | "danger" }> = {
  link_saved: { label: "Link saved", tone: "muted" },
  imported: { label: "Content imported", tone: "ok" },
  stored: { label: "File saved · text not imported", tone: "muted" },
  pending: { label: "Not checked yet", tone: "warn" },
  connected: { label: "Connected and updating", tone: "ok" },
  error: { label: "Refresh failed", tone: "danger" },
  needs_authorization: { label: "Requires authorization", tone: "warn" },
  unsupported: { label: "Unsupported or unavailable", tone: "danger" },
};

export const CONTENT_STATUS: Record<string, string> = {
  full_text: "Full text (yours or imported)",
  excerpt: "Your excerpt",
  summary: "Summary from the feed",
  metadata_only: "Title and details only",
};

export const VERIFICATION: Record<string, string> = {
  unverified: "Not checked",
  checked: "Checked",
  uncertain: "Uncertain",
  disputed: "Disputed",
};

export const KIND_LABEL: Record<string, string> = { note: "Note", link: "Link", document: "Document", reference: "Reference", feed: "Feed" };

export const REFRESH_CHOICES = [
  { hours: 6, label: "About every 6 hours" },
  { hours: 12, label: "About every 12 hours" },
  { hours: 24, label: "About once a day" },
  { hours: 72, label: "Every 3 days" },
  { hours: 168, label: "Once a week" },
];

export interface FeedState { label: string; tone: "ok" | "warn" | "muted" | "danger"; stale: boolean }

/** A feed's actual state: paused/disconnected first, then its last result and staleness. */
export function feedState(s: { status: string; paused: boolean; disconnected_at: string | null; last_success_at: string | null; refresh_hours: number | null }, now = Date.now()): FeedState {
  const staleAfter = (s.refresh_hours ?? 24) * 2 * 3_600_000 + 26 * 3_600_000; // allow for the once-a-day server check
  const stale = !!s.last_success_at && now - Date.parse(s.last_success_at) > staleAfter;
  if (s.disconnected_at) return { label: "Disconnected · saved items kept", tone: "muted", stale: false };
  if (s.paused) return { label: "Paused · saved items kept", tone: "muted", stale };
  const base = STATUS[s.status] ?? { label: s.status, tone: "muted" as const };
  if (s.status === "connected" && stale) return { label: "Connected · overdue for a refresh", tone: "warn", stale };
  return { ...base, stale };
}

export function ago(iso: string | null, now = Date.now()): string {
  if (!iso) return "never";
  const m = Math.round((now - Date.parse(iso)) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}
