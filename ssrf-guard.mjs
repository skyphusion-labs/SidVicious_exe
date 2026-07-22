/**
 * SSRF guard for bot-side fetches (#53).
 */

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

async function resolveHost(hostname) {
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
  if (answers.length === 0) throw new Error('URL host could not be resolved');
  for (const ans of answers) {
    if ((ans.type === 1 || ans.type === 28) && isBlockedIp(ans.data)) {
      throw new Error('URL host is not allowed');
    }
  }
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
    await resolveHost(url.hostname);
  }
  return url;
}

export async function fetchPublicUrl(raw, init) {
  const url = await assertPublicFetchUrlResolved(raw);
  return fetch(url.toString(), { ...init, redirect: 'manual' });
}
