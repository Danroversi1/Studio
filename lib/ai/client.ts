// SERVER ONLY. One place to build the Anthropic client. A key that isn't scoped to a
// workspace needs the workspace id with every request (ANTHROPIC_WORKSPACE_ID).
import Anthropic from "@anthropic-ai/sdk";

export function anthropicClient() {
  const ws = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
  return new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    ...(ws ? { defaultHeaders: { "anthropic-workspace-id": ws } } : {}),
  });
}
