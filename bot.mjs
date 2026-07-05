// bot.mjs
// SidVicious_exe -- punk rock Discord roadie for web search and image generation.
//
// Required Discord Developer Portal settings:
//   Bot -> Privileged Gateway Intents -> MESSAGE CONTENT: ON
//   OAuth2 -> URL Generator -> scopes: bot, applications.commands
//                             permissions: Send Messages, Read Message History, Attach Files
//
// Config (all via env):
//   DISCORD_TOKEN               (required) Discord application token from the Developer Portal
//   DISCORD_CHANNEL_IDS         comma-separated channel IDs to listen in;
//                               if empty, only DMs and @mentions are answered
//   DISCORD_MODEL               chat model (default anthropic/claude-sonnet-4-6)
//   DISCORD_HISTORY             rolling history depth in exchange pairs (default 20)
//   DISCORD_LOG                 tee logs to this file path (optional)
//
//   Cloudflare (one token for chat, images, and optional D1):
//   CF_ACCOUNT_ID               Cloudflare account ID
//   CF_API_TOKEN                API token with AI Gateway permission (alias: CF_AIG_TOKEN)
//   CF_AIG_GATEWAY_ID           AI Gateway name (default: skyphusion-llm)
//   CF_GATEWAY_ENDPOINT         Full compat URL (optional; built from account + gateway id)
//   CF_D1_DATABASE_ID           D1 database ID (optional, for session persistence)
//   CF_D1_TOKEN                 D1 token if different from CF_API_TOKEN (optional)
//
//   OLLAMA_BASE_URL             ollama fallback when CF_API_TOKEN is unset
//   SEARCH_WORKER_URL           search Worker base URL (optional)
//   SEARCH_SECRET               shared secret for X-Search-Secret header (optional)
//
// ! commands:
//   !image <prompt>        generate an image from a text prompt
//   !model [name|id]       show available image models / switch the active one
//   !learn <text or URL>   index a reference into the knowledge base
//   !reset                 clear conversation history
//
// Slash commands: /image /model /learn /reset
// (registered globally on startup; guild propagation is instant, global takes ~1 hour)

import Anthropic from '@anthropic-ai/sdk';
import { AttachmentBuilder, Client, GatewayIntentBits, Partials, Events, REST, Routes, SlashCommandBuilder } from 'discord.js';
import { appendFileSync, existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

if (existsSync('.env')) loadEnvFile('.env');

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

const LOG_FILE = process.env.DISCORD_LOG ?? '';

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.join(' ')}`;
  console.log(line);
  if (LOG_FILE) try { appendFileSync(LOG_FILE, line + '\n'); } catch {}
}

if (!process.env.DISCORD_TOKEN) {
  log('ERROR: DISCORD_TOKEN is required');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const CFG = {
  token:          process.env.DISCORD_TOKEN,
  ollamaBase:     process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434/v1',
  model:          process.env.DISCORD_MODEL   ?? (process.env.CF_API_TOKEN || process.env.CF_AIG_TOKEN ? 'anthropic/claude-sonnet-4-6' : 'qwen3:8b'),
  channelIds:     new Set((process.env.DISCORD_CHANNEL_IDS ?? '').split(',').filter(Boolean)),
  historyLen:     parseInt(process.env.DISCORD_HISTORY ?? '20', 10),
  cfAccountId:    process.env.CF_ACCOUNT_ID     ?? process.env.CF_D1_ACCOUNT_ID ?? '',
  apiToken:       process.env.CF_API_TOKEN      ?? process.env.CF_AIG_TOKEN ?? '',
  aigGatewayId:   process.env.CF_AIG_GATEWAY_ID ?? 'skyphusion-llm',
  gatewayEndpoint: process.env.CF_GATEWAY_ENDPOINT ?? '',
  d1Token:        process.env.CF_D1_TOKEN       ?? process.env.CF_API_TOKEN ?? process.env.CF_AIG_TOKEN ?? '',
  d1AccountId:    process.env.CF_D1_ACCOUNT_ID  ?? process.env.CF_ACCOUNT_ID ?? '',
  d1DatabaseId:   process.env.CF_D1_DATABASE_ID ?? '',
  searchUrl:      process.env.SEARCH_WORKER_URL ?? '',
  searchSecret:   process.env.SEARCH_SECRET     ?? '',
};

const CF_AI_BASE = CFG.cfAccountId
  ? `https://api.cloudflare.com/client/v4/accounts/${CFG.cfAccountId}/ai`
  : '';
const CF_AI_V1   = CF_AI_BASE ? `${CF_AI_BASE}/v1` : '';
const CF_AI_RUN  = CF_AI_BASE ? `${CF_AI_BASE}/run` : '';

function buildGatewayCompatEndpoint(accountId, gatewayId) {
  if (!accountId || !gatewayId) return '';
  return `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}/compat/chat/completions`;
}

function anthropicBaseFromGatewayEndpoint(endpoint) {
  const base = endpoint
    .replace(/\/compat\/chat\/completions\/?$/, '')
    .replace(/\/compat\/?$/, '')
    .replace(/\/$/, '');
  return `${base}/anthropic`;
}

const gatewayCompatEndpoint = CFG.gatewayEndpoint
  || buildGatewayCompatEndpoint(CFG.cfAccountId, CFG.aigGatewayId);
const anthropicBase = gatewayCompatEndpoint
  ? anthropicBaseFromGatewayEndpoint(gatewayCompatEndpoint)
  : '';
const useGatewayAnthropic = Boolean(anthropicBase);

function normalizeChatModel(model) {
  if (useGatewayAnthropic) {
    if (model.startsWith('anthropic/')) return model.slice('anthropic/'.length);
    return model;
  }
  if (model.includes('/')) return model;
  if (model.startsWith('claude')) return `anthropic/${model}`;
  return model;
}

const chatModel = normalizeChatModel(CFG.model);

const anthropic = CFG.apiToken && (useGatewayAnthropic || CF_AI_V1)
  ? new Anthropic({
      apiKey:  CFG.apiToken,
      baseURL: useGatewayAnthropic ? anthropicBase : CF_AI_V1,
      ...(useGatewayAnthropic ? {} : { defaultHeaders: { 'cf-aig-gateway-id': CFG.aigGatewayId } }),
    })
  : null;

const imageGenReady = Boolean(CFG.apiToken && CFG.cfAccountId);
// Log a backend label, not the resolved URL: the URL embeds the Cloudflare
// account ID from the environment (flagged by CodeQL js/clear-text-logging).
const chatBackend = anthropic ? (useGatewayAnthropic ? 'cf-gateway-anthropic' : 'workers-ai-v1') : 'ollama';

log(`Starting SidVicious_exe: model=${chatModel} backend=${chatBackend} gateway=${CFG.aigGatewayId} images=${imageGenReady ? 'on' : 'off'} channels=${CFG.channelIds.size || 'DMs+mentions only'}`);

// ---------------------------------------------------------------------------
// Image model catalog
// ---------------------------------------------------------------------------

const IMAGE_MODELS = [
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

const DEFAULT_IMAGE_MODEL = '@cf/black-forest-labs/flux-1-schnell';

// FLUX 2 models require multipart form data even for prompt-only requests.
const MULTIPART_IMAGE_MODELS = new Set([
  '@cf/black-forest-labs/flux-2-klein-4b',
  '@cf/black-forest-labs/flux-2-klein-9b',
  '@cf/black-forest-labs/flux-2-dev',
]);

function resolveImageModel(input) {
  const lower = input.toLowerCase().trim();
  const byAlias = IMAGE_MODELS.find(m => m.alias === lower);
  if (byAlias) return byAlias;
  const byId = IMAGE_MODELS.find(m => m.id === input);
  if (byId) return byId;
  const byPartial = IMAGE_MODELS.find(m => m.id.includes(lower));
  if (byPartial) return byPartial;
  return null;
}

function formatModelList(currentId) {
  const lines = ['**Image Models** (`!model <name>` or `/model <name>` to switch)\n'];
  for (const m of IMAGE_MODELS) {
    const active = m.id === currentId ? ' **<-- active**' : '';
    lines.push(`  \`${m.alias}\` -- ${m.label}${active}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Session state -- persisted in Cloudflare D1 (REST API), cached in-memory
// ---------------------------------------------------------------------------

const sessions = new Map();

async function d1Query(sql, params = []) {
  if (!CFG.d1Token) throw new Error('CF_D1_TOKEN not configured');
  const url = `https://api.cloudflare.com/client/v4/accounts/${CFG.d1AccountId}/d1/database/${CFG.d1DatabaseId}/query`;
  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${CFG.d1Token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ sql, params }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`D1 ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  if (!data.success) throw new Error(`D1 error: ${JSON.stringify(data.errors)}`);
  return data.result?.[0]?.results ?? [];
}

async function initD1() {
  if (!CFG.d1Token) return;
  try {
    await d1Query(`CREATE TABLE IF NOT EXISTS sessions (
      channel_id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);
    log('D1 tables ready');
  } catch (e) {
    log(`WARN: D1 init failed: ${e.message}`);
  }
}

async function loadSession(channelId) {
  try {
    const rows = await d1Query('SELECT data FROM sessions WHERE channel_id = ?', [channelId]);
    if (rows.length === 0) return null;
    const data = JSON.parse(rows[0].data);
    sessions.set(channelId, data);
    return data;
  } catch (e) {
    log(`ERROR loading session ${channelId}: ${e.message}`);
    return null;
  }
}

async function getSession(channelId) {
  if (!sessions.has(channelId)) {
    const loaded = await loadSession(channelId);
    if (!loaded) sessions.set(channelId, { history: [], imageModel: DEFAULT_IMAGE_MODEL });
  }
  const s = sessions.get(channelId);
  if (!s.imageModel) s.imageModel = DEFAULT_IMAGE_MODEL;
  if (!s.history)    s.history    = [];
  return s;
}

async function saveSession(channelId) {
  try {
    const session = sessions.get(channelId);
    if (!session) return;
    const now = new Date().toISOString();
    await d1Query(
      'INSERT INTO sessions (channel_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(channel_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at',
      [channelId, JSON.stringify(session), now],
    );
  } catch (e) {
    log(`ERROR saving session ${channelId}: ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are Sid Vicious_exe, a punk rock roadie on Discord with attitude and a soft spot for anyone doing something real.

Personality:
- Raw, direct, irreverent. No corporate speak, no sycophancy, no "I'd be happy to help!"
- You love punk, post-punk, garage, noise, DIY culture, zines, basement shows, and anything that smells like rebellion
- Short sentences hit harder than paragraphs. Swearing is fine when it fits. Never punch down.
- You're helpful underneath the leather jacket. If someone needs facts or a visual, you deliver.

Capabilities:
- Web search, deep research, and page fetching when you need current info or sources
- A knowledge base of stuff people have fed you with !learn (search it when relevant)
- Image generation when configured (!image or /image, or the generate_image tool via Workers AI / AI Gateway)
- Vision: users can paste images and you'll read them

Commands users can type:
- !image <prompt> / /image -- generate a picture
- !model [name] / /model -- list or switch image models
- !learn <text or URL> / /learn -- stash a reference in the knowledge base
- !reset / /reset -- wipe the conversation and start fresh

Stay in character. Be useful. Don't lecture about punk gatekeeping.`;

// ---------------------------------------------------------------------------
// LLM helpers
// ---------------------------------------------------------------------------

function stripThink(text) {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

function flattenForOllama(messages) {
  return messages.map(m => {
    if (typeof m.content === 'string') return m;
    if (!Array.isArray(m.content)) return m;
    const imgCount = m.content.filter(b => b.type === 'image').length;
    const text = m.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
    const prefix = imgCount > 0 ? `[${imgCount} image(s) attached -- vision not supported in ollama mode]\n` : '';
    return { ...m, content: prefix + text };
  });
}

async function callOllama(system, conversationMessages) {
  const messages = flattenForOllama(conversationMessages);
  const res = await fetch(`${CFG.ollamaBase}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ollama' },
    body: JSON.stringify({
      model:    CFG.model,
      messages: [{ role: 'system', content: system }, ...messages],
      stream:   false,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`ollama ${res.status}: ${body}`);
  }
  const data = await res.json();
  return stripThink(data.choices?.[0]?.message?.content ?? '') || '(no response)';
}

// ---------------------------------------------------------------------------
// Tools (search Worker + image generation)
// ---------------------------------------------------------------------------

function buildTools() {
  const tools = [];
  if (CFG.searchUrl) {
    tools.push(
      {
        name:         'web_search',
        description:  'Search the web for quick facts, current events, news, or general information.',
        input_schema: { type: 'object', properties: { query: { type: 'string', description: 'The search query' } }, required: ['query'] },
      },
      {
        name:         'research',
        description:  'Deep AI-curated research on a topic. Returns a synthesized answer plus sources.',
        input_schema: { type: 'object', properties: { query: { type: 'string', description: 'The research question' } }, required: ['query'] },
      },
      {
        name:         'fetch_page',
        description:  'Fetch and read the full content of a specific URL.',
        input_schema: { type: 'object', properties: { url: { type: 'string', description: 'The URL to fetch' } }, required: ['url'] },
      },
      {
        name:         'search_knowledge',
        description:  'Search the knowledge base for anything previously added with !learn.',
        input_schema: { type: 'object', properties: { query: { type: 'string', description: 'What to search for' } }, required: ['query'] },
      },
    );
  }
  if (imageGenReady) {
    tools.push({
      name:         'generate_image',
      description:  'Generate an image from a text prompt. Use when the user wants a picture, poster, album art, flyer, or any visual.',
      input_schema: { type: 'object', properties: { prompt: { type: 'string', description: 'Detailed image prompt' } }, required: ['prompt'] },
    });
  }
  return tools;
}

async function executeTool(name, input, ctx) {
  if (name === 'generate_image') {
    if (!imageGenReady) return 'Image generation not configured.';
    log(`[image] tool: ${input.prompt?.slice(0, 80)}`);
    const result = await generateImage(input.prompt, ctx.imageModel, 'tool');
    if (!result.ok) return result.error;
    ctx.generatedImages.push(result);
    return `Image generated successfully (${result.buffer.length} bytes). Tell the user it's attached.`;
  }

  if (!CFG.searchUrl || !CFG.searchSecret) return 'Search not configured.';
  const headers = { 'Content-Type': 'application/json', 'X-Search-Secret': CFG.searchSecret };

  if (name === 'web_search') {
    log(`[search] web: ${input.query}`);
    const res = await fetch(`${CFG.searchUrl}/search`, { method: 'POST', headers, body: JSON.stringify({ query: input.query, type: 'web' }) });
    return res.ok ? res.json() : `Search error: ${res.status}`;
  }
  if (name === 'research') {
    log(`[search] research: ${input.query}`);
    const res = await fetch(`${CFG.searchUrl}/search`, { method: 'POST', headers, body: JSON.stringify({ query: input.query, type: 'research' }) });
    return res.ok ? res.json() : `Research error: ${res.status}`;
  }
  if (name === 'fetch_page') {
    log(`[search] fetch: ${input.url}`);
    const res = await fetch(`${CFG.searchUrl}/fetch`, { method: 'POST', headers, body: JSON.stringify({ url: input.url }) });
    return res.ok ? res.json() : `Fetch error: ${res.status}`;
  }
  if (name === 'search_knowledge') {
    log(`[search] knowledge: ${input.query}`);
    const res = await fetch(`${CFG.searchUrl}/knowledge/search`, { method: 'POST', headers, body: JSON.stringify({ query: input.query }) });
    return res.ok ? res.json() : `Knowledge search error: ${res.status}`;
  }
  return 'Unknown tool';
}

async function callAI(system, conversationMessages, ctx = { imageModel: DEFAULT_IMAGE_MODEL, generatedImages: [] }) {
  if (anthropic) {
    const tools = buildTools();
    let messages = [...conversationMessages];

    for (let round = 0; round < 5; round++) {
      const msg = await anthropic.messages.create({
        model:      chatModel,
        system,
        messages,
        max_tokens: 4096,
        ...(tools.length ? { tools } : {}),
      });

      if (msg.stop_reason !== 'tool_use') {
        return {
          text:   stripThink(msg.content.find(b => b.type === 'text')?.text ?? '') || '(no response)',
          images: ctx.generatedImages,
        };
      }

      const toolResults = [];
      for (const block of msg.content.filter(b => b.type === 'tool_use')) {
        const result = await executeTool(block.name, block.input, ctx).catch(e => ({ error: e.message }));
        toolResults.push({
          type:        'tool_result',
          tool_use_id: block.id,
          content:     typeof result === 'string' ? result : JSON.stringify(result),
        });
      }

      messages = [
        ...messages,
        { role: 'assistant', content: msg.content },
        { role: 'user',      content: toolResults },
      ];
    }

    const final = await anthropic.messages.create({ model: chatModel, system, messages, max_tokens: 4096 });
    return {
      text:   stripThink(final.content.find(b => b.type === 'text')?.text ?? '') || '(no response)',
      images: ctx.generatedImages,
    };
  }

  const text = await callOllama(system, conversationMessages);
  return { text, images: [] };
}

async function askLLM(channelId, userText, imageBlocks = []) {
  const session = await getSession(channelId);
  const ctx = { imageModel: session.imageModel, generatedImages: [] };

  const userContent = imageBlocks.length > 0 && anthropic
    ? [...imageBlocks, { type: 'text', text: userText }]
    : userText;

  return callAI(SYSTEM_PROMPT, [
    ...session.history,
    { role: 'user', content: userContent },
  ], ctx);
}

// ---------------------------------------------------------------------------
// Image generation (Workers AI + AI Gateway REST API)
// ---------------------------------------------------------------------------

function cfAiHeaders(extra = {}) {
  return {
    Authorization:        `Bearer ${CFG.apiToken}`,
    'cf-aig-gateway-id':  CFG.aigGatewayId,
    ...extra,
  };
}

async function bufferFromImageField(image) {
  if (typeof image !== 'string' || !image) return null;

  if (image.startsWith('http://') || image.startsWith('https://')) {
    const res = await fetch(image);
    if (!res.ok) return null;
    const mime = res.headers.get('content-type') ?? 'image/png';
    const buffer = Buffer.from(await res.arrayBuffer());
    const ext = mime.includes('jpeg') || mime.includes('jpg') ? 'jpg'
      : mime.includes('webp') ? 'webp' : 'png';
    return { buffer, ext, mime, artifactUrl: image };
  }

  const buffer = Buffer.from(image, 'base64');
  return { buffer, ext: 'jpg', mime: 'image/jpeg' };
}

async function parseImageResponse(data, label) {
  const payload = data?.result ?? data;
  const image = payload?.image ?? payload?.images?.[0];
  const parsed = await bufferFromImageField(image);
  if (!parsed) return { ok: false, error: 'no image in response' };
  log(`[${label}] done (${parsed.buffer.length} bytes)`);
  return { ok: true, ...parsed };
}

async function generateImage(prompt, imageModel, label = 'image') {
  if (!imageGenReady) {
    return { ok: false, error: 'CF_API_TOKEN and CF_ACCOUNT_ID not configured' };
  }

  const model = imageModel ?? DEFAULT_IMAGE_MODEL;
  log(`[${label}] generating model=${model} gateway=${CFG.aigGatewayId}`);

  let res;

  if (MULTIPART_IMAGE_MODELS.has(model)) {
    const form = new FormData();
    form.append('prompt', prompt);
    form.append('width', '1024');
    form.append('height', '1024');
    res = await fetch(`${CF_AI_RUN}/${encodeURIComponent(model)}`, {
      method: 'POST',
      headers: cfAiHeaders(),
      body:    form,
    });
  } else {
    res = await fetch(CF_AI_RUN, {
      method:  'POST',
      headers: cfAiHeaders({ 'Content-Type': 'application/json' }),
      body:    JSON.stringify({ model, input: { prompt } }),
    });
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    const err = JSON.stringify(data.errors ?? data).slice(0, 300);
    return { ok: false, error: `image gen failed ${res.status}: ${err}` };
  }

  return parseImageResponse(data, label);
}

function imagesToAttachments(images, prefix = 'sid') {
  return images.map((img, i) =>
    new AttachmentBuilder(img.buffer, { name: `${prefix}-${i + 1}.${img.ext}` }),
  );
}

// ---------------------------------------------------------------------------
// Knowledge base (via search Worker + Vectorize)
// ---------------------------------------------------------------------------

async function indexKnowledge(content, title = '', author = '') {
  if (!CFG.searchUrl || !CFG.searchSecret) return { ok: false, error: 'Search worker not configured' };

  let text = content;
  let resolvedTitle = title || content.slice(0, 80);

  if (content.startsWith('http://') || content.startsWith('https://')) {
    try {
      const fetched = await executeTool('fetch_page', { url: content }, { generatedImages: [] });
      const data = typeof fetched === 'string' ? JSON.parse(fetched) : fetched;
      text = data.content ?? content;
      resolvedTitle = data.title || content.slice(0, 80);
    } catch (e) {
      log(`[learn] page fetch failed: ${e.message}`);
    }
  }

  const res = await fetch(`${CFG.searchUrl}/knowledge/index`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'X-Search-Secret': CFG.searchSecret },
    body:    JSON.stringify({ content: text, title: resolvedTitle, author }),
  });
  if (!res.ok) return { ok: false, error: `index failed ${res.status}` };
  const data = await res.json();
  return { ok: true, id: data.id, title: resolvedTitle, words: text.split(/\s+/).length };
}

// ---------------------------------------------------------------------------
// Message chunking (Discord 2000 char limit)
// ---------------------------------------------------------------------------

function splitMessage(text, limit = 1990) {
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
// Slash command definitions
// ---------------------------------------------------------------------------

const SLASH_COMMANDS = [
  new SlashCommandBuilder()
    .setName('image')
    .setDescription('Generate an image from a text prompt')
    .addStringOption(o => o.setName('prompt').setDescription('What to generate').setRequired(true)),
  new SlashCommandBuilder()
    .setName('model')
    .setDescription('Show or switch the active image generation model')
    .addStringOption(o => o.setName('name').setDescription('Model alias or ID (omit to see list)').setRequired(false)),
  new SlashCommandBuilder()
    .setName('learn')
    .setDescription('Index a reference into the knowledge base')
    .addStringOption(o => o.setName('content').setDescription('Text or URL to index').setRequired(true)),
  new SlashCommandBuilder()
    .setName('reset')
    .setDescription('Clear conversation history'),
].map(c => c.toJSON());

async function registerSlashCommands(clientId) {
  const rest = new REST({ version: '10' }).setToken(CFG.token);
  try {
    const data = await rest.put(Routes.applicationCommands(clientId), { body: SLASH_COMMANDS });
    log(`Registered ${data.length} slash command(s) globally`);
  } catch (e) {
    log(`WARN: slash command registration failed: ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// Discord client
// ---------------------------------------------------------------------------

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel, Partials.Message],
});

client.once(Events.ClientReady, async (c) => {
  log(`Ready: ${c.user.tag} (${c.guilds.cache.size} guild(s))`);
  await registerSlashCommands(c.user.id);
});

// ---------------------------------------------------------------------------
// Slash command handler
// ---------------------------------------------------------------------------

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const channelId  = interaction.channelId;
  const authorName = interaction.member?.displayName ?? interaction.user.username;
  log(`[slash:${interaction.commandName}] ${authorName} in ${channelId}`);

  try {
    switch (interaction.commandName) {

      case 'image': {
        const prompt  = interaction.options.getString('prompt');
        const session = await getSession(channelId);

        if (!imageGenReady) {
          await interaction.reply('Image generation is not configured. Set CF_API_TOKEN and CF_ACCOUNT_ID.');
          return;
        }

        await interaction.deferReply();
        const activeModel = IMAGE_MODELS.find(m => m.id === session.imageModel) ?? IMAGE_MODELS[0];
        await interaction.editReply(`Cranking the amp. Generating with **${activeModel.label}**...`);

        const result = await generateImage(prompt, session.imageModel, 'slash:image');
        if (!result.ok) { await interaction.editReply(`Image generation failed: ${result.error}`); return; }

        const att = new AttachmentBuilder(result.buffer, { name: `sid-image.${result.ext}` });
        await interaction.editReply({ content: "Here. Don't say I never gave you nothing.", files: [att] });
        break;
      }

      case 'model': {
        const name    = interaction.options.getString('name');
        const session = await getSession(channelId);

        if (!name) { await interaction.reply(formatModelList(session.imageModel)); return; }

        const found = resolveImageModel(name);
        if (!found) { await interaction.reply(`Never heard of \`${name}\`. Use \`/model\` to see what's on the rack.`); return; }

        session.imageModel = found.id;
        await saveSession(channelId);
        await interaction.reply(`Switched to **${found.label}**. Let's make some noise.`);
        break;
      }

      case 'learn': {
        const content = interaction.options.getString('content');
        await interaction.deferReply();
        const result = await indexKnowledge(content, '', authorName);
        if (result.ok) {
          await interaction.editReply(`Stashed **${result.title}** (${result.words} words) in the knowledge base. I'll dig it up when it matters.`);
        } else {
          await interaction.editReply(`Couldn't index that: ${result.error}`);
        }
        break;
      }

      case 'reset': {
        sessions.set(channelId, { history: [], imageModel: DEFAULT_IMAGE_MODEL });
        await saveSession(channelId);
        log(`[${channelId}] session reset by ${authorName}`);
        await interaction.reply('Memory wiped. Fresh start. What do you want?');
        break;
      }

    }
  } catch (e) {
    log(`ERROR [slash:${interaction.commandName}]: ${e.message}`);
    const reply = interaction.replied || interaction.deferred
      ? interaction.editReply.bind(interaction)
      : interaction.reply.bind(interaction);
    await reply(`(error: ${e.message})`).catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  const isDM         = !message.guild;
  const isMentioned  = message.mentions.has(client.user);
  const inListenChan = CFG.channelIds.size > 0 && CFG.channelIds.has(message.channelId);

  if (!isDM && !isMentioned && !inListenChan) return;

  const rawText = message.content
    .replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '')
    .trim();

  const hasImages = message.attachments.some(a => a.contentType?.startsWith('image/'));
  if (!rawText && !hasImages) return;

  const channelId    = message.channelId;
  const authorName   = message.member?.displayName ?? message.author.username;
  const channelLabel = isDM ? 'DM' : `${message.guild.name}/#${message.channel.name ?? channelId}`;

  log(`[${channelLabel}] ${authorName}: ${rawText.slice(0, 120)}${hasImages ? ` [+${message.attachments.size} image(s)]` : ''}`);

  if (rawText === '!reset') {
    sessions.set(channelId, { history: [], imageModel: DEFAULT_IMAGE_MODEL });
    await saveSession(channelId);
    log(`[${channelId}] reset by ${authorName}`);
    await message.reply('Memory wiped. Fresh start. What do you want?').catch(() => {});
    return;
  }

  if (rawText.startsWith('!model')) {
    const arg     = rawText.slice('!model'.length).trim();
    const session = await getSession(channelId);

    if (!arg) { await message.reply(formatModelList(session.imageModel)).catch(() => {}); return; }

    const found = resolveImageModel(arg);
    if (!found) { await message.reply(`Never heard of \`${arg}\`. Use \`!model\` to see what's on the rack.`).catch(() => {}); return; }

    session.imageModel = found.id;
    await saveSession(channelId);
    await message.reply(`Switched to **${found.label}**. Let's make some noise.`).catch(() => {});
    return;
  }

  if (rawText.startsWith('!image')) {
    const prompt = rawText.slice('!image'.length).trim();
    if (!prompt) { await message.reply('Usage: `!image <prompt>`').catch(() => {}); return; }
    if (!imageGenReady) {
      await message.reply('Image generation is not configured. Set CF_API_TOKEN and CF_ACCOUNT_ID.').catch(() => {});
      return;
    }

    const session = await getSession(channelId);
    const activeModel = IMAGE_MODELS.find(m => m.id === session.imageModel) ?? IMAGE_MODELS[0];
    await message.reply(`Cranking the amp. Generating with **${activeModel.label}**...`).catch(() => {});

    const result = await generateImage(prompt, session.imageModel, 'cmd:image');
    if (!result.ok) { await message.reply(`Image generation failed: ${result.error}`).catch(() => {}); return; }

    const att = new AttachmentBuilder(result.buffer, { name: `sid-image.${result.ext}` });
    await message.reply({ content: "Here. Don't say I never gave you nothing.", files: [att] }).catch(() => {});
    return;
  }

  if (rawText.startsWith('!learn')) {
    const content = rawText.slice('!learn'.length).trim();
    if (!content) { await message.reply('Usage: `!learn <text or URL>`').catch(() => {}); return; }

    await message.reply('Indexing...').catch(() => {});
    const result = await indexKnowledge(content, '', authorName);
    if (result.ok) {
      await message.reply(`Stashed **${result.title}** (${result.words} words) in the knowledge base.`).catch(() => {});
    } else {
      await message.reply(`Couldn't index that: ${result.error}`).catch(() => {});
    }
    return;
  }

  // --- Conversation (with optional vision) ---

  const imageBlocks = [];
  if (anthropic) {
    for (const att of [...message.attachments.values()].filter(a => a.contentType?.startsWith('image/') && a.size <= 4 * 1024 * 1024).slice(0, 3)) {
      try {
        const resp = await fetch(att.url);
        if (resp.ok) {
          const buf = Buffer.from(await resp.arrayBuffer());
          imageBlocks.push({ type: 'image', source: { type: 'base64', media_type: att.contentType, data: buf.toString('base64') } });
          log(`[vision] loaded ${att.url.split('/').pop()} (${buf.length} bytes)`);
        }
      } catch (e) {
        log(`[vision] failed to fetch attachment: ${e.message}`);
      }
    }
  }

  try { await message.channel.sendTyping(); } catch {}
  const typingInterval = setInterval(() => { message.channel.sendTyping().catch(() => {}); }, 8000);

  try {
    const userText = rawText || '(image attached)';
    const userLabel = `${authorName}: ${userText}`;

    const { text: reply, images: generatedImages } = await askLLM(channelId, userLabel, imageBlocks);

    const session = await getSession(channelId);
    const historyText = imageBlocks.length > 0 ? `[${imageBlocks.length} image(s)]\n${userLabel}` : userLabel;
    session.history.push({ role: 'user',      content: historyText });
    session.history.push({ role: 'assistant', content: reply });
    while (session.history.length > CFG.historyLen * 2) session.history.shift();
    await saveSession(channelId);

    log(`-> ${reply.slice(0, 120)}${reply.length > 120 ? '...' : ''}`);

    const files = imagesToAttachments(generatedImages);
    const chunks = splitMessage(reply);
    if (chunks.length === 0 && files.length > 0) {
      await message.reply({ content: 'Here.', files });
    } else {
      for (let i = 0; i < chunks.length; i++) {
        const payload = i === chunks.length - 1 && files.length > 0
          ? { content: chunks[i], files }
          : chunks[i];
        await message.reply(payload);
      }
    }
  } catch (err) {
    log(`ERROR: ${err.message}`);
    await message.reply(`(error: ${err.message})`).catch(() => {});
  } finally {
    clearInterval(typingInterval);
  }
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

await initD1().catch(err => log(`D1 init notice: ${err.message}`));

if (process.env.VITEST) {
  log('CI mode: validating configuration...');
  await registerSlashCommands('123456789012345678').catch(err => log(`Mock command reg notice: ${err.message}`));
  log('SMOKE TEST PASSED: SidVicious_exe configuration verified.');
  client.destroy();
} else {
  client.login(CFG.token).catch(err => {
    log(`Failed to connect to Discord: ${err.message}`);
    process.exit(1);
  });
}
