// USD per million tokens, from Anthropic's published pricing (checked 2026-11-14).
// Keep in sync with https://platform.claude.com/docs/en/about-claude/pricing.
export const PRICES_PER_MTOK = {
  "claude-sonnet-5-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.1 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 },
} as const;

export type PricedModel = keyof typeof PRICES_PER_MTOK;

export interface Usage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

/** Cost of one API response in USD, rounded up to the next 1/10,000 of a dollar. */
export function costUsd(model: PricedModel, usage: Usage): number {
  const p = PRICES_PER_MTOK[model];
  const micro =
    (usage.input_tokens ?? 0) * p.input +
    (usage.output_tokens ?? 0) * p.output +
    (usage.cache_creation_input_tokens ?? 0) * p.cacheWrite +
    (usage.cache_read_input_tokens ?? 0) * p.cacheRead;
  return Math.ceil(micro / 100) / 10_000; // micro = USD × 1e6; ceil to $0.0001
}
