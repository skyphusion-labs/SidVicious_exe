/**
 * SSRF guard for bot-side fetches (#53, #57).
 */

import http from 'node:http';
import https from 'node:https';

const BLOCKED_HOSTS = new Set([
  'localhost',
  'metadata.google.internal',
]);

function isBlockedIp(host) {
  const h = String(host).toLowerCase();
  if (h === '::1' || h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) {
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

function validateHostname(host) {
  const h = host.toLowerCase();
  if (BLOCKED_HOSTS.has(h) || h.endsWith('.internal') || h.endsWith('.local')) {
    throw new Error('URL host is not allowed');
  }
  if (isBlockedIp(h)) {
    throw new Error('URL host is not allowed');
  }
}

async function resolveHostToIp(hostname) {
  if (isBlockedIp(hostname)) {
    throw new Error('URL host is not allowed');
  }
  const res = await fetch(
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=A`,
    { headers: { Accept: 'application/dns-json' } },
  );
  if (!res.ok) throw new Error('URL host could not be resolved');
  const data = await res.json();
  const answers = data.Answer ?? [];
  for (const ans of answers) {
    if (ans.type === 1 && !isBlockedIp(ans.data)) {
      return ans.data;
    }
  }
  throw new Error('URL host could not be resolved');
}

export function assertPublicFetchUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('invalid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('URL must be http or https');
  }
  if (url.username || url.password) {
    throw new Error('URL must not embed credentials');
  }
  validateHostname(url.hostname);
  return url;
}

export async function assertPublicFetchUrlResolved(raw) {
  const url = assertPublicFetchUrl(raw);
  if (!isBlockedIp(url.hostname)) {
    await resolveHostToIp(url.hostname);
  }
  return url;
}

function fetchPinned(url, ip, init = {}) {
  const mod = url.protocol === 'https:' ? https : http;
  const headers = { ...(init.headers ?? {}), Host: url.hostname };
  return new Promise((resolve, reject) => {
    const req = mod.request(
      {
        hostname: ip,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: init.method || 'GET',
        headers,
        servername: url.protocol === 'https:' ? url.hostname : undefined,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          resolve(new Response(Buffer.concat(chunks), {
            status: res.statusCode ?? 502,
            headers: res.headers,
          }));
        });
      },
    );
    req.on('error', reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}

export async function fetchPublicUrl(raw, init) {
  const url = assertPublicFetchUrl(raw);
  const ip = isBlockedIp(url.hostname) ? url.hostname : await resolveHostToIp(url.hostname);
  if (isBlockedIp(ip)) {
    throw new Error('URL host is not allowed');
  }
  return fetchPinned(url, ip, { ...init, redirect: 'manual' });
}

export function sanitizeFetchedContent(text, limit = 8000) {
  return String(text)
    .replace(/https?:\/\/[^\s<>"']+/gi, '[url]')
    .slice(0, limit);
}
