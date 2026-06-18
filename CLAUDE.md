# CLAUDE.md

**SidVicious_exe** -- punk rock Discord roadie for web search and image generation. All AI goes through the unified Cloudflare API (`api.cloudflare.com`).

## Structure

```
bot.mjs                  Node 24+ Discord roadie (main entry point)
.env.example             Minimal env template
package.json             Roadie dependencies (@anthropic-ai/sdk, discord.js)
search-worker/           Cloudflare Worker: web search + knowledge base
stacks/
  dischord.yml           Docker Compose (loads stacks/.env)
```

## Quick start

```bash
cp .env.example .env          # fill in DISCORD_TOKEN, CF_ACCOUNT_ID, CF_API_TOKEN
npm install && npm run roadie
```

## Cloudflare setup

One API token with **AI Gateway** permission covers chat and images.

```bash
wrangler whoami               # CF_ACCOUNT_ID
wrangler auth token           # CF_API_TOKEN
```

Endpoints used by the roadie (all on `api.cloudflare.com`):

| Feature | Endpoint |
|---------|----------|
| Chat (Claude) | `POST /client/v4/accounts/{id}/ai/v1/messages` |
| Images | `POST /client/v4/accounts/{id}/ai/run` |
| D1 sessions | Cloudflare REST API (optional) |

Default gateway name is `default` (`CF_AIG_GATEWAY_ID`). Override if you use a custom gateway.

## search-worker deploy

```bash
cd search-worker && npm ci && npm run deploy
npx wrangler vectorize create sidvicious-knowledge --dimensions=1024 --metric=cosine
npx wrangler secret put BRAVE_API_KEY
npx wrangler secret put TAVILY_API_KEY
npx wrangler secret put SEARCH_SECRET
```

## Commands

| Command | Slash | Description |
|---------|-------|-------------|
| `!image <prompt>` | `/image` | Generate an image |
| `!model [name]` | `/model` | Show/switch image model |
| `!learn <text\|url>` | `/learn` | Index into knowledge base |
| `!reset` | `/reset` | Clear conversation |

## Conventions

- No em-dashes or en-dashes in source, comments, or docs.
- Minimal dependencies; vanilla Node.js + discord.js + Anthropic SDK.
- Secrets never committed.
