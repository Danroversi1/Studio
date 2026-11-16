// Whether the text model is configured. A plain check: importing this can't call a model.
export function aiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}
