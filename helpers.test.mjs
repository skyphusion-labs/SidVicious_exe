// Unit tests for the pure logic in lib/helpers.mjs (#39). No network, no
// Discord, no Cloudflare -- these cover the branches the boot smoke cannot.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IMAGE_MODEL,
  IMAGE_MODELS,
  MULTIPART_IMAGE_MODELS,
  anthropicBaseFromGatewayEndpoint,
  buildGatewayCompatEndpoint,
  flattenForOllama,
  formatModelList,
  freshSession,
  normalizeChatModel,
  normalizeSession,
  resolveImageModel,
  sanitizeErrorMessage,
  splitMessage,
  stripThink,
  trimHistory,
} from './lib/helpers.mjs';

describe('gateway endpoint building', () => {
  it('builds the compat endpoint from account + gateway id', () => {
    expect(buildGatewayCompatEndpoint('acct', 'gw'))
      .toBe('https://gateway.ai.cloudflare.com/v1/acct/gw/compat/chat/completions');
    expect(buildGatewayCompatEndpoint('', 'gw')).toBe('');
    expect(buildGatewayCompatEndpoint('acct', '')).toBe('');
  });

  it('derives the native anthropic base from any compat endpoint shape', () => {
    for (const suffix of ['/compat/chat/completions', '/compat/chat/completions/', '/compat', '/compat/', '']) {
      expect(anthropicBaseFromGatewayEndpoint(`https://gw.test/v1/a/g${suffix}`))
        .toBe('https://gw.test/v1/a/g/anthropic');
    }
  });
});

describe('normalizeChatModel', () => {
  it('strips the anthropic/ prefix on the gateway-native path', () => {
    expect(normalizeChatModel('anthropic/claude-sonnet-4-6', true)).toBe('claude-sonnet-4-6');
    expect(normalizeChatModel('claude-sonnet-4-6', true)).toBe('claude-sonnet-4-6');
  });

  it('adds the anthropic/ prefix for bare claude models on the compat path', () => {
    expect(normalizeChatModel('claude-sonnet-4-6', false)).toBe('anthropic/claude-sonnet-4-6');
    expect(normalizeChatModel('anthropic/claude-sonnet-4-6', false)).toBe('anthropic/claude-sonnet-4-6');
    expect(normalizeChatModel('qwen3:8b', false)).toBe('qwen3:8b');
  });
});

describe('image model catalog', () => {
  it('resolves by alias, exact id, and partial id; null on unknown', () => {
    expect(resolveImageModel('flux-schnell')?.id).toBe(DEFAULT_IMAGE_MODEL);
    expect(resolveImageModel('FLUX-SCHNELL')?.id).toBe(DEFAULT_IMAGE_MODEL);
    expect(resolveImageModel('@cf/stabilityai/stable-diffusion-xl-base-1.0')?.alias).toBe('sdxl');
    expect(resolveImageModel('leonardo/phoenix')?.alias).toBe('phoenix');
    expect(resolveImageModel('does-not-exist')).toBeNull();
  });

  it('keeps the multipart set inside the catalog', () => {
    const ids = new Set(IMAGE_MODELS.map(m => m.id));
    for (const id of MULTIPART_IMAGE_MODELS) expect(ids.has(id)).toBe(true);
  });

  it('marks the active model in the formatted list', () => {
    const list = formatModelList(DEFAULT_IMAGE_MODEL);
    expect(list).toContain('flux-schnell');
    expect(list).toContain('<-- active');
  });
});

describe('LLM plumbing', () => {
  it('stripThink removes think blocks and trims', () => {
    expect(stripThink('<think>internal</think>  answer ')).toBe('answer');
    expect(stripThink('a<THINK>x</THINK>b')).toBe('ab');
  });

  it('flattenForOllama collapses content blocks and annotates images', () => {
    const out = flattenForOllama([
      { role: 'user', content: 'plain' },
      { role: 'user', content: [{ type: 'image' }, { type: 'text', text: 'look' }] },
    ]);
    expect(out[0].content).toBe('plain');
    expect(out[1].content).toContain('vision not supported');
    expect(out[1].content).toContain('look');
  });
});

describe('session shape', () => {
  it('freshSession + normalizeSession repair partial persisted sessions', () => {
    expect(freshSession()).toEqual({ history: [], imageModel: DEFAULT_IMAGE_MODEL });
    const stale = normalizeSession({});
    expect(stale.imageModel).toBe(DEFAULT_IMAGE_MODEL);
    expect(stale.history).toEqual([]);
    const kept = normalizeSession({ history: [{ role: 'user', content: 'x' }], imageModel: 'custom' });
    expect(kept.imageModel).toBe('custom');
    expect(kept.history).toHaveLength(1);
  });

  it('trimHistory keeps at most historyLen exchange pairs, oldest out', () => {
    const h = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: String(i) }));
    trimHistory(h, 2);
    expect(h).toHaveLength(4);
    expect(h[0].content).toBe('6');
  });
});

describe('splitMessage', () => {
  it('returns short text unchanged', () => {
    expect(splitMessage('short')).toEqual(['short']);
  });

  it('splits long text under the limit, preferring newline boundaries', () => {
    const text = `${'a'.repeat(1500)}\n${'b'.repeat(1500)}`;
    const chunks = splitMessage(text);
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toBe('a'.repeat(1500));
    expect(chunks.every(c => c.length <= 1990)).toBe(true);
  });

  it('hard-cuts when no usable newline exists and never loops', () => {
    const chunks = splitMessage('x'.repeat(5000));
    expect(chunks.length).toBe(3);
    expect(chunks.join('').length).toBe(5000);
  });
});

describe('sanitizeErrorMessage (#39: no account id / secrets into Discord replies)', () => {
  it('redacts every configured value and tolerates empties', () => {
    const msg = 'fetch failed: https://gateway.ai.cloudflare.com/v1/acct123/gw: 401 token tok456';
    expect(sanitizeErrorMessage(msg, ['acct123', 'tok456', '']))
      .toBe('fetch failed: https://gateway.ai.cloudflare.com/v1/[redacted]/gw: 401 token [redacted]');
    expect(sanitizeErrorMessage(undefined, ['x'])).toBe('');
    expect(sanitizeErrorMessage('clean', [])).toBe('clean');
  });
});
