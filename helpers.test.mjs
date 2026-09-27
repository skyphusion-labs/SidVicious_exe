// Unit tests for the pure logic in lib/helpers.mjs (#39). No network, no
// Discord, no Cloudflare -- these cover the branches the boot smoke cannot.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IMAGE_MODEL,
  IMAGE_MODELS,
  MULTIPART_IMAGE_MODELS,
  anthropicBaseFromGatewayEndpoint,
  buildGatewayCompatEndpoint,
  createSessionStore,
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

describe('createSessionStore (a failed D1 read must never clobber saved history)', () => {
  const saved = { history: [{ role: 'user', content: 'real' }, { role: 'assistant', content: 'history' }], imageModel: 'm' };
  const row = { data: JSON.stringify(saved) };
  const isWrite = (sql) => /^\s*INSERT/i.test(sql);

  /** query fake: SELECT fails while `state.down`, otherwise returns `state.rows`; INSERTs are recorded. */
  function harness(rows = [row]) {
    const state = { down: false, rows, writes: [], reads: 0 };
    const query = async (sql, params) => {
      if (isWrite(sql)) { state.writes.push(params); return []; }
      state.reads++;
      if (state.down) throw new Error('D1 503');
      return state.rows;
    };
    const logs = [];
    const store = createSessionStore({ query, configured: () => true, log: (m) => logs.push(m) });
    return { state, store, logs };
  }

  it('loads a persisted session and writes it back on save', async () => {
    const { state, store } = harness();
    const s = await store.get('c1');
    expect(s.history).toHaveLength(2);
    await store.save('c1');
    expect(state.writes).toHaveLength(1);
  });

  it('treats a missing row as an absent session: fresh history, and save persists it', async () => {
    const { state, store } = harness([]);
    const s = await store.get('c1');
    expect(s.history).toEqual([]);
    await store.save('c1');
    expect(state.writes).toHaveLength(1);
  });

  it('serves a working in-memory session on a failed read but does not write it over the real row', async () => {
    const { state, store, logs } = harness();
    state.down = true;
    const s = await store.get('c1');
    expect(s.history).toEqual([]);
    s.history.push({ role: 'user', content: 'x' });
    await store.save('c1');
    expect(state.writes).toHaveLength(0);
    expect(logs.some((m) => /not saving/i.test(m))).toBe(true);
  });

  it('retries the read after a failure and resumes from the persisted history once D1 is back', async () => {
    const { state, store } = harness();
    state.down = true;
    await store.get('c1');
    state.down = false;
    const s = await store.get('c1');
    expect(s.history).toEqual(saved.history);
    await store.save('c1');
    expect(state.writes).toHaveLength(1);
    expect(JSON.parse(state.writes[0][1]).history).toEqual(saved.history);
  });

  it('lets an explicit reset overwrite the row even after a failed read', async () => {
    const { state, store } = harness();
    state.down = true;
    await store.get('c1');
    store.reset('c1');
    await store.save('c1');
    expect(state.writes).toHaveLength(1);
    expect(JSON.parse(state.writes[0][1]).history).toEqual([]);
  });

  it('does not query D1 for reads when it is not configured, and does not treat that as a failed read', async () => {
    const state = { reads: 0, writes: 0 };
    const query = async (sql) => { if (isWrite(sql)) state.writes++; else state.reads++; return []; };
    const store = createSessionStore({ query, configured: () => false, log: () => {} });
    await store.get('c1');
    await store.save('c1');
    expect(state.reads).toBe(0);
    expect(state.writes).toBe(1);
  });
});
