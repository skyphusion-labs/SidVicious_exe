/**
 * SSRF guard for bot-side fetches (#53).
 */

const BLOCKED_HOSTS = new Set([
  'localhost',
  'metadata.google.internal',
]);

function isBlockedIp(host) {
  if (host === '::1' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) {
    return true;
  }
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
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
  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host) || host.endsWith('.internal') || host.endsWith('.local')) {
    throw new Error('URL host is not allowed');
  }
  if (isBlockedIp(host)) {
    throw new Error('URL host is not allowed');
  }
  return url;
}

export async function fetchPublicUrl(raw, init) {
  const url = assertPublicFetchUrl(raw);
  return fetch(url.toString(), init);
}
