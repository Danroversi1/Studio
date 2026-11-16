// Whether the optional cloud image provider is configured. A plain environment check:
// importing this can't call any image service.
export function cloudImageConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}
