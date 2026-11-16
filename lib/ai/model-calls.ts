// Instrumentation: every request to a model provider passes through here and is logged as
// "[model-call] <provider> <what>", so we can verify routine actions make none.
let count = 0;
export function noteModelCall(provider: string, what: string) {
  count++;
  console.info(`[model-call] ${provider} ${what} #${count}`);
}
export const modelCallCount = () => count;

/** A fetch that records each request (used by the Anthropic client). */
export const countingFetch: typeof fetch = (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  noteModelCall("anthropic", new URL(url).pathname);
  return fetch(input, init);
};
