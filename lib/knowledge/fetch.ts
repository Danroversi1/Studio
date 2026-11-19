// SERVER ONLY. Fetches a public web address for the Knowledge Base, safely:
// * http(s) on the standard ports only;
// * every connection is pinned to an address checked at connect time, so private,
//   loopback, link-local and cloud-metadata addresses can't be reached (also not through
//   redirects or DNS tricks);
// * size, time and redirect limits.
// What comes back is untrusted data. It is parsed as text, never executed or obeyed.
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import zlib from "node:zlib";

export class FetchError extends Error {
  constructor(message: string, readonly status: number | null = null, readonly kind: "blocked" | "http" | "network" | "too_large" | "timeout" = "network") { super(message); }
}

const UA = "STUDIO-Knowledge/1.0 (+https://studio-one-omega-46.vercel.app; research reader for a film project)";

function v4Private(ip: string) {
  const [a, b] = ip.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
}
export function isBlockedAddress(ip: string): boolean {
  const fam = isIP(ip);
  if (fam === 4) return v4Private(ip);
  if (fam === 6) {
    const x = ip.toLowerCase();
    if (x === "::" || x === "::1") return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(x);
    if (mapped) return v4Private(mapped[1]);
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(x) || x.startsWith("64:ff9b:") || x.startsWith("2001:db8");
  }
  return true;
}

function safeLookup(hostname: string, options: object, cb: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void) {
  dnsLookup(hostname, { all: true }, (err, addresses) => {
    if (err) return cb(err, "", 4);
    const list = (addresses as LookupAddress[]).filter((a) => !isBlockedAddress(a.address));
    if (!list.length || list.length !== (addresses as LookupAddress[]).length) {
      const e = new Error("That address points to a private network.") as NodeJS.ErrnoException;
      e.code = "EBLOCKED";
      return cb(e, "", 4);
    }
    if ((options as { all?: boolean }).all) return cb(null, list);
    cb(null, list[0].address, list[0].family);
  });
}

function check(u: URL) {
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new FetchError("Only web addresses (http/https) can be read.", null, "blocked");
  if (u.port && u.port !== "443" && u.port !== "80") throw new FetchError("Only standard web ports can be read.", null, "blocked");
  if (u.username || u.password) throw new FetchError("Addresses with sign-in details can't be read.", null, "blocked");
  if (isIP(u.hostname.replace(/^\[|\]$/g, "")) && isBlockedAddress(u.hostname.replace(/^\[|\]$/g, ""))) throw new FetchError("That address points to a private network.", null, "blocked");
  if (/^(localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i.test(u.hostname)) throw new FetchError("That address points to a private network.", null, "blocked");
}

export interface Fetched { url: string; status: number; contentType: string; body: string; etag: string | null; lastModified: string | null }

function once(u: URL, opts: { accept: string; headers: Record<string, string>; maxBytes: number; timeoutMs: number }): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const mod = u.protocol === "https:" ? https : http;
    const req = mod.request(u, {
      method: "GET", lookup: safeLookup as never, timeout: opts.timeoutMs,
      headers: { "User-Agent": UA, Accept: opts.accept, "Accept-Encoding": "gzip, deflate, br", ...opts.headers },
    }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400) { res.resume(); return resolve({ status, headers: res.headers, body: Buffer.alloc(0) }); }
      const enc = String(res.headers["content-encoding"] ?? "").toLowerCase();
      const stream = enc.includes("gzip") ? res.pipe(zlib.createGunzip()) : enc.includes("br") ? res.pipe(zlib.createBrotliDecompress())
        : enc.includes("deflate") ? res.pipe(zlib.createInflate()) : res;
      const chunks: Buffer[] = []; let n = 0;
      stream.on("data", (c: Buffer) => {
        n += c.length;
        if (n > opts.maxBytes) { req.destroy(new FetchError("The page is too large to read.", status, "too_large")); return; }
        chunks.push(c);
      });
      stream.on("end", () => resolve({ status, headers: res.headers, body: Buffer.concat(chunks) }));
      stream.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new FetchError("The site took too long to answer.", null, "timeout")));
    req.on("error", (e: NodeJS.ErrnoException) => reject(e instanceof FetchError ? e
      : new FetchError(e.code === "EBLOCKED" ? e.message : e.code === "ENOTFOUND" ? "That site couldn't be found." : "The site couldn't be reached.", null, e.code === "EBLOCKED" ? "blocked" : "network")));
    req.end();
  });
}

export async function fetchPublic(raw: string, opts: { accept?: string; headers?: Record<string, string>; maxBytes?: number; timeoutMs?: number } = {}): Promise<Fetched> {
  let u: URL;
  try { u = new URL(raw); } catch { throw new FetchError("That isn't a web address.", null, "blocked"); }
  const o = { accept: opts.accept ?? "*/*", headers: opts.headers ?? {}, maxBytes: opts.maxBytes ?? 3_000_000, timeoutMs: opts.timeoutMs ?? 10_000 };
  for (let hop = 0; hop <= 4; hop++) {
    check(u);
    const r = await once(u, o);
    if (r.status >= 300 && r.status < 400 && r.status !== 304) {
      const loc = r.headers.location;
      if (!loc) throw new FetchError("The site redirected without an address.", r.status, "http");
      u = new URL(String(loc), u);
      continue;
    }
    return {
      url: u.toString(), status: r.status, contentType: String(r.headers["content-type"] ?? ""),
      body: r.body.toString("utf8"), etag: r.headers.etag ? String(r.headers.etag) : null,
      lastModified: r.headers["last-modified"] ? String(r.headers["last-modified"]) : null,
    };
  }
  throw new FetchError("Too many redirects.", null, "http");
}
