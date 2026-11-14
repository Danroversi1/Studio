// DEVELOPMENT ONLY: serves the dev-filesystem storage adapter's signed URLs.
// Returns 404 unless STORAGE_DRIVER=dev-filesystem and NODE_ENV is not production.
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { DevFilesystemStorage, devVerify } from "@/lib/storage/dev-filesystem";
import { getStorage } from "@/lib/storage";
import { env } from "@/lib/env";

async function devStorage(): Promise<DevFilesystemStorage | null> {
  if (process.env.NODE_ENV === "production" || env.storageDriver() !== "dev-filesystem") return null;
  return (await getStorage()) as DevFilesystemStorage;
}

function params(request: Request) {
  const q = new URL(request.url).searchParams;
  return {
    key: q.get("key") ?? "",
    expires: Number(q.get("expires")),
    type: q.get("type") ?? undefined,
    size: q.get("size") ? Number(q.get("size")) : undefined,
    sig: q.get("sig") ?? "",
  };
}

const now = () => Math.floor(Date.now() / 1000);

export async function PUT(request: Request) {
  const storage = await devStorage();
  if (!storage) return new NextResponse("Not found", { status: 404 });
  const p = params(request);
  const secret = env.required("DEV_STORAGE_SECRET");
  if (!devVerify(secret, { method: "PUT", key: p.key, expires: p.expires, contentType: p.type, byteSize: p.size }, p.sig, now()))
    return new NextResponse("Signature invalid or expired", { status: 403 });
  if (request.headers.get("content-type") !== p.type) return new NextResponse("Content-Type mismatch", { status: 400 });
  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength !== p.size) return new NextResponse("Size mismatch", { status: 400 });
  const result = await storage.writeOnce(p.key, body);
  if (result === "exists") return new NextResponse("Object already exists", { status: 412 });
  return new NextResponse(null, { status: 200 });
}

export async function GET(request: Request) {
  const storage = await devStorage();
  if (!storage) return new NextResponse("Not found", { status: 404 });
  const p = params(request);
  if (!devVerify(env.required("DEV_STORAGE_SECRET"), { method: "GET", key: p.key, expires: p.expires }, p.sig, now()))
    return new NextResponse("Signature invalid or expired", { status: 403 });
  const facts = await storage.inspect(p.key, 0);
  if (!facts) return new NextResponse("Not found", { status: 404 });
  const stream = Readable.toWeb(storage.readStream(p.key)) as ReadableStream;
  return new NextResponse(stream, {
    headers: {
      "Content-Type": p.key.endsWith(".png") ? "image/png" : "image/jpeg",
      "Content-Length": String(facts.size),
      "Cache-Control": "private, max-age=60",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
