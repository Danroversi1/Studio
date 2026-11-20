// Shared, retried fetching for feed refreshes (no database, no model).
import { FetchError, fetchPublic } from "./fetch";

/**
 * One fetch per address per run: films and characters following the same search share it.
 * Keyed by address; conditional headers aren't used for shared fetches (they're per source).
 */
export type FetchCache = Map<string, Promise<Awaited<ReturnType<typeof fetchPublic>>>>;

type Fetcher = typeof fetchPublic;

/** Fetch with one bounded retry for network failures and server errors (5xx). */
export async function fetchRetry(url: string, opts: Parameters<Fetcher>[1], retryMs = 1500, get: Fetcher = fetchPublic) {
  try {
    const r = await get(url, opts);
    if (r.status < 500) return r;
  } catch (e) {
    if (e instanceof FetchError && e.kind === "blocked") throw e;
  }
  await new Promise((res) => setTimeout(res, retryMs));
  return get(url, opts);
}

/** The shared fetch: the first caller for an address fetches; everyone else waits for it. */
export function sharedFetch(cache: FetchCache, url: string, opts: Parameters<Fetcher>[1], get: Fetcher = fetchPublic, retryMs = 1500) {
  let p = cache.get(url);
  if (!p) { p = fetchRetry(url, opts, retryMs, get); cache.set(url, p); }
  return p;
}
