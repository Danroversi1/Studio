import path from "node:path";
import { env } from "../env";
import type { StorageAdapter } from "./types";

let cached: Promise<StorageAdapter> | undefined;

export function getStorage(): Promise<StorageAdapter> {
  cached ??= createStorage();
  return cached;
}

async function createStorage(): Promise<StorageAdapter> {
  const driver = env.storageDriver();
  if (driver === "dev-filesystem") {
    if (process.env.NODE_ENV === "production") {
      throw new Error("The dev-filesystem storage adapter is for local development only.");
    }
    const { DevFilesystemStorage } = await import("./dev-filesystem");
    return new DevFilesystemStorage(
      path.resolve(/*turbopackIgnore: true*/ process.env.DEV_STORAGE_ROOT ?? ".dev-storage"),
      env.required("DEV_STORAGE_SECRET"),
      env.appUrl(),
    );
  }
  if (driver === "r2") {
    const { R2Storage } = await import("./r2");
    return new R2Storage(
      env.required("R2_ACCOUNT_ID"),
      env.required("R2_ACCESS_KEY_ID"),
      env.required("R2_SECRET_ACCESS_KEY"),
      env.storageBucket(),
    );
  }
  throw new Error(`Unknown STORAGE_DRIVER "${driver}".`);
}

/** Rows store bucket + key. Refuse to sign objects from a bucket this deployment does not own. */
export function assertConfiguredBucket(bucket: string) {
  if (bucket !== env.storageBucket()) throw new Error("Asset belongs to a different storage bucket.");
}
