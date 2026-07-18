// lib/helpers.mjs
// Pure, network-free logic extracted from bot.mjs (#39) so the roadie's
// critical branches are unit-testable without a live Discord/Cloudflare.
// bot.mjs imports from here; keep this file dependency-free.

// ---------------------------------------------------------------------------
// Gateway URL building + chat model normalization
// ---------------------------------------------------------------------------

export function buildGatewayCompatEndpoint(accountId, gatewayId) {
  if (!accountId || !gatewayId) return '';
  return `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}/compat/chat/completions`;
}

export function anthropicBaseFromGatewayEndpoint(endpoint) {
  const base = endpoint
    .replace(/\/compat\/chat\/completions\/?$/, '')
    .replace(/\/compat\/?$/, '')
    .replace(/\/$/, '');
  return `${base}/anthropic`;
}

export function normalizeChatModel(model, useGatewayAnthropic) {
  if (useGatewayAnthropic) {
    if (model.startsWith('anthropic/')) return model.slice('anthropic/'.length);
    return model;
  }
  if (model.includes('/')) return model;
  if (model.startsWith('claude')) return `anthropic/${model}`;
  return model;
}

// ---------------------------------------------------------------------------
// Image model catalog
// ---------------------------------------------------------------------------

export const IMAGE_MODELS = [
  { alias: 'flux-schnell',  id: '@cf/black-forest-labs/flux-1-schnell',         label: 'FLUX-1 Schnell (fast, default)' },
  { alias: 'flux2-fast',    id: '@cf/black-forest-labs/flux-2-klein-4b',         label: 'FLUX 2 Klein 4B (faster frontier)' },
  { alias: 'flux2',         id: '@cf/black-forest-labs/flux-2-klein-9b',         label: 'FLUX 2 Klein 9B (frontier quality)' },
  { alias: 'flux2-dev',     id: '@cf/black-forest-labs/flux-2-dev',              label: 'FLUX 2 Dev (multi-reference)' },
  { alias: 'phoenix',       id: '@cf/leonardo/phoenix-1.0',                      label: 'Phoenix 1.0 (Leonardo)' },
  { alias: 'lucid',         id: '@cf/leonardo/lucid-origin',                     label: 'Lucid Origin (Leonardo)' },
  { alias: 'dreamshaper',   id: '@cf/lykon/dreamshaper-8-lcm',                   label: 'Dreamshaper 8 LCM (fast SD)' },
  { alias: 'sdxl',          id: '@cf/stabilityai/stable-diffusion-xl-base-1.0',  label: 'Stable Diffusion XL' },
  { alias: 'gpt-image',     id: 'openai/gpt-image-1.5',                          label: 'GPT Image 1.5 (OpenAI)' },
  { alias: 'recraft',       id: 'recraft/recraftv4',                             label: 'Recraft V4 (art-directed)' },
  { alias: 'nano-banana',   id: 'google/nano-banana-pro',                        label: 'Nano Banana Pro (Google)' },
];

export const DEFAULT_IMAGE_MODEL = '@cf/black-forest-labs/flux-1-schnell';

// FLUX 2 models require multipart form data even for prompt-only requests.
export const MULTIPART_IMAGE_MODELS = new Set([
  '@cf/black-forest-labs/flux-2-klein-4b',
  '@cf/black-forest-labs/flux-2-klein-9b',
  '@cf/black-forest-labs/flux-2-dev',
]);

export function resolveImageModel(input) {
  const lower = input.toLowerCase().trim();
  const byAlias = IMAGE_MODELS.find(m => m.alias === lower);
  if (byAlias) return byAlias;
  const byId = IMAGE_MODELS.find(m => m.id === input);
  if (byId) return byId;
  const byPartial = IMAGE_MODELS.find(m => m.id.includes(lower));
  if (byPartial) return byPartial;
  return null;
}

export function formatModelList(currentId) {
  const lines = ['**Image Models** (`!model <name>` or `/model <name>` to switch)\n'];
  for (const m of IMAGE_MODELS) {
    const active = m.id === currentId ? ' **<-- active**' : '';
    lines.push(`  \`${m.alias}\` -- ${m.label}${active}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// LLM plumbing
// ---------------------------------------------------------------------------

export function stripThink(text) {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

export function flattenForOllama(messages) {
  return messages.map(m => {
    if (typeof m.content === 'string') return m;
    if (!Array.isArray(m.content)) return m;
    const imgCount = m.content.filter(b => b.type === 'image').length;
    const text = m.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
    const prefix = imgCount > 0 ? `[${imgCount} image(s) attached -- vision not supported in ollama mode]\n` : '';
    return { ...m, content: prefix + text };
  });
}

// ---------------------------------------------------------------------------
// Session shape
// ---------------------------------------------------------------------------

export function freshSession() {
  return { history: [], imageModel: DEFAULT_IMAGE_MODEL };
}

/** Fill missing fields on a (possibly stale/partial) persisted session in place. */
export function normalizeSession(s) {
  if (!s.imageModel) s.imageModel = DEFAULT_IMAGE_MODEL;
  if (!s.history)    s.history    = [];
  return s;
}

/** Trim rolling history to historyLen exchange PAIRS (user+assistant), oldest out. */
export function trimHistory(history, historyLen) {
  while (history.length > historyLen * 2) history.shift();
  return history;
}

// ---------------------------------------------------------------------------
// Discord message chunking (2000 char limit)
// ---------------------------------------------------------------------------

export function splitMessage(text, limit = 1990) {
  if (text.length <= limit) return [text];
  const chunks = [];
  while (text.length > 0) {
    let slice = text.slice(0, limit);
    const lastNl = slice.lastIndexOf('\n');
    if (lastNl > limit * 0.5) slice = text.slice(0, lastNl + 1);
    chunks.push(slice.trimEnd());
    text = text.slice(slice.length).trimStart();
  }
  return chunks.filter(Boolean);
}

// ---------------------------------------------------------------------------
// Error hygiene (#39 audit): errors get echoed into Discord replies, and SDK /
// fetch errors can embed request URLs that carry the Cloudflare ACCOUNT ID
// (the gateway base URL). Scrub configured identifiers before anything
// user-facing; keep the raw message for the local log.
// ---------------------------------------------------------------------------

export function sanitizeErrorMessage(message, secrets = []) {
  let out = String(message ?? '');
  for (const s of secrets) {
    if (s) out = out.split(s).join('[redacted]');
  }
  return out;
}
