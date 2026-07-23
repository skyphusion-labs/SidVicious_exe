/**
 * SSRF guard for outbound fetches (#52, #53).
 * Validates scheme/host, resolves DNS, and rejects private/link-local targets.
 */

const BLOCKED_HOSTS = new Set([
  "localhost",
  "metadata.google.internal",
]);

function isBlockedIp(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "::1" || h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) {
    return true;
  }
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 127) return true;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 0) return true;
  return false;
}

function validateHostname(host: string): void {
  const h = host.toLowerCase();
  if (BLOCKED_HOSTS.has(h) || h.endsWith(".internal") || h.endsWith(".local")) {
    throw new Error("URL host is not allowed");
  }
  if (isBlockedIp(h)) {
    throw new Error("URL host is not allowed");
  }
}

async function resolveHostToIp(hostname: string): Promise<string> {
  if (isBlockedIp(hostname)) {
    throw new Error("URL host is not allowed");
  }
  const res = await fetch(
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=A`,
    { headers: { Accept: "application/dns-json" } },
  );
  if (!res.ok) {
    throw new Error("URL host could not be resolved");
  }
  const data = (await res.json()) as { Answer?: Array<{ type: number; data: string }> };
  for (const ans of data.Answer ?? []) {
    if (ans.type === 1 && !isBlockedIp(ans.data)) {
      return ans.data;
    }
  }
  throw new Error("URL host could not be resolved");
}

export function assertPublicFetchUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("URL must be http or https");
  }
  if (url.username || url.password) {
    throw new Error("URL must not embed credentials");
  }
  validateHostname(url.hostname);
  return url;
}

/** Sync shape check plus DNS resolution for hostnames (blocks rebinding). */
export async function assertPublicFetchUrlResolved(raw: string): Promise<URL> {
  const url = assertPublicFetchUrl(raw);
  if (!isBlockedIp(url.hostname)) {
    await resolveHostToIp(url.hostname);
  }
  return url;
}

export async function fetchPublicUrl(raw: string, init?: RequestInit): Promise<Response> {
  const url = assertPublicFetchUrl(raw);
  const ip = isBlockedIp(url.hostname) ? url.hostname : await resolveHostToIp(url.hostname);
  if (isBlockedIp(ip)) {
    throw new Error("URL host is not allowed");
  }
  const pinned = new URL(url.toString());
  pinned.hostname = ip;
  const headers = new Headers(init?.headers);
  headers.set("Host", url.hostname);
  return fetch(pinned.toString(), { ...init, headers, redirect: "manual" });
}

export function sanitizeFetchedContent(text: string, limit = 8000): string {
  return String(text).replace(/https?:\/\/[^\s<>"']+/gi, "[url]").slice(0, limit);
}
