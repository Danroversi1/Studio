// SERVER ONLY. Image providers behind one small interface, so generation isn't hard-coded
// into the interface. OpenAI GPT Image is the live provider (key stays server-side). A mock
// exists only for automated tests and is never selected by the running app.

export interface ProviderImage { bytes: Uint8Array; mime: "image/png" | "image/jpeg" | "image/webp" }
export interface GenerateRequest {
  prompt: string;
  width: number;
  height: number;
  /** Images actually sent to the model, in order (base frame first for edits). */
  images: ProviderImage[];
  quality?: "low" | "medium" | "high";
}
export interface GenerateResult { image: ProviderImage; usage: Record<string, unknown> | null; model: string }

export interface ImageProvider {
  id: string;
  model: string;
  /** Null when ready; otherwise what's missing, in plain words. */
  missing: string | null;
  capabilities: { referenceImages: number; edit: boolean; seed: boolean; idempotency: boolean };
  generate(req: GenerateRequest): Promise<GenerateResult>;
}

export class ProviderError extends Error {
  constructor(message: string, readonly retryable = false) { super(message); }
}

const toDataUrl = (img: ProviderImage) => `data:${img.mime};base64,${Buffer.from(img.bytes).toString("base64")}`;

export function openAiProvider(env: Record<string, string | undefined> = process.env): ImageProvider {
  const key = env.OPENAI_API_KEY ?? "";
  const model = env.OPENAI_IMAGE_MODEL || "gpt-image-2";
  return {
    id: "openai",
    model,
    missing: key ? null : "Image generation needs an OpenAI API key. Add OPENAI_API_KEY in Vercel (Settings → Environment Variables, marked Sensitive), then redeploy.",
    // As documented for the Images API: up to 16 input images on edits; no seed; no idempotency key.
    capabilities: { referenceImages: 16, edit: true, seed: false, idempotency: false },
    async generate(req) {
      if (!key) throw new ProviderError("OpenAI isn't configured.");
      const size = `${req.width}x${req.height}`;
      const common = { model, prompt: req.prompt, size, quality: req.quality ?? "medium", output_format: "png", n: 1 };
      const url = req.images.length ? "https://api.openai.com/v1/images/edits" : "https://api.openai.com/v1/images/generations";
      const body = req.images.length ? { ...common, images: req.images.slice(0, 16).map((i) => ({ image_url: toDataUrl(i) })) } : common;
      let res: Response;
      try {
        res = await fetch(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(240_000),
        });
      } catch (e) {
        throw new ProviderError(e instanceof Error && e.name === "TimeoutError" ? "The image service took too long." : "Couldn't reach the image service.", true);
      }
      const json = (await res.json().catch(() => null)) as {
        data?: { b64_json?: string }[]; usage?: Record<string, unknown>; error?: { message?: string; code?: string; type?: string };
      } | null;
      if (!res.ok) {
        const msg = json?.error?.message ?? `The image service answered with an error (${res.status}).`;
        if (json?.error?.code === "moderation_blocked" || /safety|moderation/i.test(msg)) {
          throw new ProviderError("The image service declined this frame. Try describing it differently.");
        }
        throw new ProviderError(msg.slice(0, 300), res.status >= 500 || res.status === 429);
      }
      const b64 = json?.data?.[0]?.b64_json;
      if (!b64) throw new ProviderError("The image service returned no image.");
      return { image: { bytes: new Uint8Array(Buffer.from(b64, "base64")), mime: "image/png" }, usage: json?.usage ?? null, model };
    },
  };
}

/** For automated tests only: returns a fixed 1×1 PNG and records what it was asked. */
export function mockProvider(opts: { fail?: string } = {}): ImageProvider & { calls: GenerateRequest[] } {
  const calls: GenerateRequest[] = [];
  const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
  return {
    id: "mock", model: "mock-1", missing: null, calls,
    capabilities: { referenceImages: 16, edit: true, seed: false, idempotency: false },
    async generate(req) {
      calls.push(req);
      if (opts.fail) throw new ProviderError(opts.fail);
      return { image: { bytes: png, mime: "image/png" }, usage: { mock: true }, model: "mock-1" };
    },
  };
}

export function imageProvider(): ImageProvider {
  return openAiProvider();
}
