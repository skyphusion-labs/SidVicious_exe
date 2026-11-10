// Proves the headers SDK 1.x actually sends. helpers.test.mjs checks the
// option object. This file builds a real client and reads the request.
import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { resolveChatRoute } from './lib/helpers.mjs';

function headerMap(headers) {
  const out = new Map();
  const h = headers instanceof Headers ? headers : new Headers(headers);
  for (const [name, value] of h.entries()) out.set(name.toLowerCase(), value);
  return out;
}

async function capture(route) {
  const seen = [];
  const client = new Anthropic({
    ...route.clientOptions,
    maxRetries: 0,
    fetch: async (url, init) => {
      seen.push({ url: String(url), headers: headerMap(init.headers) });
      return new Response(JSON.stringify({
        error: { type: 'error', message: 'stopped by test' },
      }), { status: 401, headers: { 'content-type': 'application/json' } });
    },
  });
  await client.messages.create({
    model: route.model,
    max_tokens: 1,
    messages: [{ role: 'user', content: 'ping' }],
  }).catch(() => {});
  expect(seen).toHaveLength(1);
  return seen[0];
}

describe('Anthropic SDK wire headers', () => {
  it('sends a bearer token to api.anthropic.com and no gateway header', async () => {
    const route = resolveChatRoute({ anthropicApiKey: 'sk-ant-direct' });
    const { url, headers } = await capture(route);
    expect(url.startsWith('https://api.anthropic.com/')).toBe(true);
    expect(headers.get('authorization')).toBe('Bearer sk-ant-direct');
    expect(headers.has('cf-aig-authorization')).toBe(false);
    expect(headers.has('x-api-key')).toBe(false);
  });

  it('authenticates a stored-key gateway call with only cf-aig-authorization', async () => {
    const route = resolveChatRoute({
      cfApiToken: 'cf-run-token',
      accountId: 'acct',
      gatewayId: 'gw',
    });
    const { url, headers } = await capture(route);
    expect(url).toBe('https://gateway.ai.cloudflare.com/v1/acct/gw/anthropic/v1/messages');
    expect(headers.get('cf-aig-authorization')).toBe('Bearer cf-run-token');
    expect(headers.has('authorization')).toBe(false);
    expect(headers.has('x-api-key')).toBe(false);
    for (const value of headers.values()) {
      expect(value).not.toContain('gateway-stored-key');
    }
  });

  it('sends the provider key as x-api-key, not as Authorization, through the gateway', async () => {
    const route = resolveChatRoute({
      anthropicApiKey: 'sk-ant-provider',
      cfApiToken: 'cf-run-token',
      accountId: 'acct',
      gatewayId: 'gw',
    });
    const { url, headers } = await capture(route);
    expect(url).toBe('https://gateway.ai.cloudflare.com/v1/acct/gw/anthropic/v1/messages');
    expect(headers.get('x-api-key')).toBe('sk-ant-provider');
    expect(headers.get('cf-aig-authorization')).toBe('Bearer cf-run-token');
    expect(headers.has('authorization')).toBe(false);
    expect(headers.get('x-api-key')).not.toBe('cf-run-token');
  });
});
