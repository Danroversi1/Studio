"use client";
// Browser-only Google Drive access. The Director signs in to Google in a popup and picks
// files in Google's own Picker. STUDIO asks only for the "drive.file" permission: it can
// open files she picks (or has picked before), nothing else in her Drive. The access token
// lives in this tab's memory for about an hour and is never sent to STUDIO's server.

import { readZip, type ZipEntry } from "@/lib/zip";

export const GOOGLE_SCOPE = "https://www.googleapis.com/auth/drive.file";

export interface GoogleConfig {
  clientId: string;
  apiKey: string;
  appId: string;
}

export function googleConfig(): GoogleConfig | null {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_API_KEY ?? "";
  const appId = process.env.NEXT_PUBLIC_GOOGLE_APP_ID ?? "";
  return clientId && apiKey && appId ? { clientId, apiKey, appId } : null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    gapi?: any;
    google?: any;
  }
}

const scripts = new Map<string, Promise<void>>();
function loadScript(src: string): Promise<void> {
  let p = scripts.get(src);
  if (!p) {
    p = new Promise<void>((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        scripts.delete(src);
        reject(new Error("Couldn't reach Google. Check the internet connection and try again."));
      };
      document.head.appendChild(s);
    });
    scripts.set(src, p);
  }
  return p;
}

let pickerReady: Promise<void> | undefined;
/** Load Google's sign-in and Picker libraries ahead of the first click. */
export function preloadGoogle(): Promise<void> {
  pickerReady ??= Promise.all([
    loadScript("https://accounts.google.com/gsi/client"),
    loadScript("https://apis.google.com/js/api.js").then(
      () => new Promise<void>((resolve) => window.gapi.load("picker", () => resolve())),
    ),
  ]).then(() => undefined);
  pickerReady.catch(() => (pickerReady = undefined));
  return pickerReady;
}

let token: { value: string; expires: number } | null = null;

/** Get a Google access token. Must be called from a click (it may open a popup). */
export async function getGoogleToken(cfg: GoogleConfig, forcePrompt = false): Promise<string> {
  if (!forcePrompt && token && token.expires > Date.now() + 60_000) return token.value;
  await preloadGoogle();
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: cfg.clientId,
      scope: GOOGLE_SCOPE,
      callback: (resp: { access_token?: string; expires_in?: number; error?: string }) => {
        if (!resp.access_token) return reject(new Error("Google sign-in didn't finish."));
        token = { value: resp.access_token, expires: Date.now() + (resp.expires_in ?? 3000) * 1000 };
        resolve(resp.access_token);
      },
      error_callback: (err: { type?: string }) =>
        reject(new Error(err?.type === "popup_closed" ? "Google sign-in was closed." : "Google sign-in was blocked. Allow pop-ups for STUDIO and try again.")),
    });
    client.requestAccessToken({ prompt: forcePrompt ? "consent" : "" });
  });
}

export interface PickedFile {
  id: string;
  name: string;
  mimeType: string;
  url: string;
}

export const DOC_MIME = "application/vnd.google-apps.document";

/** Open Google's Picker. Resolves with the chosen files ([] if she cancels). */
export async function pickFromDrive(
  cfg: GoogleConfig,
  accessToken: string,
  opts: { mimeTypes: string[]; multiselect: boolean; fileIds?: string[]; title: string },
): Promise<PickedFile[]> {
  await preloadGoogle();
  const gp = window.google.picker;
  return new Promise((resolve) => {
    const view = new gp.DocsView(gp.ViewId.DOCS)
      .setMimeTypes(opts.mimeTypes.join(","))
      .setIncludeFolders(true)
      .setSelectFolderEnabled(false)
      .setMode(gp.DocsViewMode.GRID);
    if (opts.fileIds?.length && typeof view.setFileIds === "function") view.setFileIds(opts.fileIds.join(","));
    let builder = new gp.PickerBuilder()
      .addView(view)
      .setTitle(opts.title)
      .setOAuthToken(accessToken)
      .setDeveloperKey(cfg.apiKey)
      .setAppId(cfg.appId)
      .setOrigin(window.location.origin)
      .setCallback((data: any) => {
        if (data.action === gp.Action.PICKED) {
          resolve((data.docs ?? []).map((d: any) => ({ id: d.id, name: d.name, mimeType: d.mimeType, url: d.url })));
        } else if (data.action === gp.Action.CANCEL) {
          resolve([]);
        }
      });
    if (opts.multiselect) builder = builder.enableFeature(gp.Feature.MULTISELECT_ENABLED);
    builder.build().setVisible(true);
  });
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export class GoogleAccessError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

async function driveFetch(accessToken: string, path: string): Promise<Response> {
  const res = await fetch(`https://www.googleapis.com/drive/v3/${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.ok) return res;
  let reason = "";
  try {
    reason = ((await res.json()) as { error?: { errors?: { reason?: string }[] } }).error?.errors?.[0]?.reason ?? "";
  } catch {}
  if (res.status === 401) token = null;
  if (reason === "exportSizeLimitExceeded")
    throw new GoogleAccessError(res.status, "This treatment is too big for Google to export in one go (over 10 MB).");
  if (res.status === 404 || res.status === 403)
    throw new GoogleAccessError(res.status, "STUDIO doesn't have permission to open that file yet.");
  throw new GoogleAccessError(res.status, `Google Drive answered with an error (${res.status}).`);
}

/** Download an image file's bytes. */
export async function downloadDriveFile(accessToken: string, id: string): Promise<Uint8Array> {
  const res = await driveFetch(accessToken, `files/${encodeURIComponent(id)}?alt=media`);
  return new Uint8Array(await res.arrayBuffer());
}

export async function getDriveFileName(accessToken: string, id: string): Promise<string> {
  const res = await driveFetch(accessToken, `files/${encodeURIComponent(id)}?fields=name`);
  return ((await res.json()) as { name?: string }).name ?? "Treatment";
}

/** Export a Google Doc as "Web page (zipped)": its HTML plus an images/ folder. */
export async function exportDocZip(accessToken: string, id: string): Promise<ZipEntry[]> {
  const res = await driveFetch(accessToken, `files/${encodeURIComponent(id)}/export?mimeType=application%2Fzip`);
  return readZip(new Uint8Array(await res.arrayBuffer()));
}

export const SLIDES_MIME = "application/vnd.google-apps.presentation";

/** Export a Google Slides deck as PowerPoint: a zip whose ppt/media/ folder holds every picture. */
export async function exportSlidesZip(accessToken: string, id: string): Promise<ZipEntry[]> {
  const res = await driveFetch(accessToken, `files/${encodeURIComponent(id)}/export?mimeType=${encodeURIComponent("application/vnd.openxmlformats-officedocument.presentationml.presentation")}`);
  return readZip(new Uint8Array(await res.arrayBuffer()));
}

/** Open the treatment (a Doc or a Slides deck), asking her to pick it the first time. */
export async function openTreatmentWithPermission(cfg: GoogleConfig, fileId: string, kind: "doc" | "slides"): Promise<{ entries: ZipEntry[]; name: string }> {
  return withFilePermission(cfg, fileId, kind === "doc" ? DOC_MIME : SLIDES_MIME, "Select your treatment so STUDIO can open it", async (t) => ({
    entries: kind === "doc" ? await exportDocZip(t, fileId) : await exportSlidesZip(t, fileId),
    name: await getDriveFileName(t, fileId),
  }));
}

/** Plain text of a Google Doc or Slides deck (Google's own text export). */
export async function exportText(accessToken: string, id: string): Promise<string> {
  const res = await driveFetch(accessToken, `files/${encodeURIComponent(id)}/export?mimeType=text%2Fplain`);
  return (await res.text()).replace(/^\uFEFF/, "");
}

/**
 * Run fn with a Google token that can open this file. Under drive.file, STUDIO may only
 * open files she has picked, so the first time we ask her to select it in the Picker.
 */
export async function withFilePermission<T>(
  cfg: GoogleConfig, fileId: string, mimeType: string, title: string, fn: (token: string) => Promise<T>,
): Promise<T> {
  let t = await getGoogleToken(cfg);
  try {
    return await fn(t);
  } catch (e) {
    if (!(e instanceof GoogleAccessError) || (e.status !== 403 && e.status !== 404 && e.status !== 401)) throw e;
    if (e.message.includes("too big")) throw e;
  }
  if (!token) t = await getGoogleToken(cfg);
  const picked = await pickFromDrive(cfg, t, { mimeTypes: [mimeType], multiselect: false, fileIds: [fileId], title });
  if (!picked.length) throw new Error("Pick your treatment in Google Drive to let STUDIO open it.");
  if (picked[0].id !== fileId) throw new Error("That's a different file from the linked treatment. Please pick the treatment.");
  return fn(t);
}

/**
 * Open a Google Doc, asking her to pick it in the Picker the first time (that is what
 * gives STUDIO permission under drive.file). Returns the export.
 */
export async function openDocWithPermission(cfg: GoogleConfig, docId: string): Promise<{ entries: ZipEntry[]; name: string }> {
  return withFilePermission(cfg, docId, DOC_MIME, "Select your treatment so STUDIO can open it", async (t) => ({
    entries: await exportDocZip(t, docId),
    name: await getDriveFileName(t, docId),
  }));
}
