# CLAUDE.md

Guidance for Claude Code (and the crew) working in this repo.

## What this is

**SidVicious_exe: a punk rock Discord roadie for web search and image generation.** Talk to it
naturally, ask it to look things up, or have it generate visuals. Chat routes through the Cloudflare
AI Gateway native Anthropic path (Claude); image generation uses the Cloudflare AI `run` API
(Workers AI + Gateway image models). A single `CF_API_TOKEN` (AI Gateway permission) covers both.
The punk personality is intentional: direct, honest, useful, no corporate sycophancy. Currently
**v0.1.0**. Runs as a Docker stack on `<deploy-host>`; the search backend is a Cloudflare Worker.

## Structure

```
bot.mjs                  Node 24+ Discord roadie (main entry point, ~36KB)
package.json             Roadie deps (@anthropic-ai/sdk, discord.js); scripts: roadie, bot
bot.test.ts              Vitest smoke (imports bot.mjs against mocked env)
.env.example             Env template (DISCORD_TOKEN, CF_ACCOUNT_ID, CF_API_TOKEN, ...)
Dockerfile               Self-contained image (node:24-slim, non-root)
search-worker/           Cloudflare Worker `sidvicious-search`: web search + knowledge base
  src/index.ts           Worker source
  wrangler.toml          Bindings: BROWSER, AI, KNOWLEDGE (Vectorize: sidvicious-knowledge)
stacks/
  dischord.yml           Docker Compose stack (loads stacks/.env)
```

## Commands

```bash
cp .env.example .env       # fill in DISCORD_TOKEN, CF_ACCOUNT_ID, CF_API_TOKEN
npm install
npm run roadie             # node --env-file-if-exists=.env bot.mjs (run the roadie locally)
node --check bot.mjs       # parse check -- the CI gate for the bot
npx vitest run             # the boot smoke (bot.test.ts); there is no `test` npm script
cd search-worker && npm run typecheck && npm run deploy   # the search worker
```

`search-worker` one-time setup + secrets (via wrangler):
```bash
npx wrangler vectorize create sidvicious-knowledge --dimensions=1024 --metric=cosine
npx wrangler secret put BRAVE_API_KEY   # and TAVILY_API_KEY, SEARCH_SECRET
```

### Verifying changes

The bot is dependency-free at parse time, so `node --check bot.mjs` is the gate, and `search-worker`
typechecks (`npm run typecheck`). `bot.test.ts` (Vitest) is a boot smoke that imports `bot.mjs`
against mocked tokens. CI is GitHub Actions on GitHub-hosted `ubuntu-latest` (public repo,
fork-safe): `ci.yml` lints the bot + typechecks `search-worker`; `code-coverage.yml` runs the Vitest
smoke; `deploy.yml` deploys `sidvicious-search` on a green push to `main`. The bot itself is NOT
deployed by CI: it is a deliberate host-side Docker step on `<deploy-host>` (`stacks/dischord.yml`).

## Cloudflare setup

One API token with **AI Gateway** permission covers chat and images (add D1 Edit for session
persistence).

| Feature | Endpoint |
|---------|----------|
| Chat (Claude) | `POST gateway.ai.cloudflare.com/v1/{id}/{gateway}/anthropic/v1/messages` (native Anthropic path) |
| Images | `POST api.cloudflare.com/client/v4/accounts/{id}/ai/run` |
| D1 sessions | Cloudflare REST API (optional) |

Default gateway name is `skyphusion-llm` (`CF_AIG_GATEWAY_ID`); override for a custom gateway.

## Architecture

- **Chat is Claude via the AI Gateway** (`anthropic/claude-sonnet-4-6` by default when a CF token is
  set; `DISCORD_MODEL` overrides). With no CF token it falls back to ollama (`OLLAMA_BASE_URL`, chat
  only, no images).
- **Tool-use loop**: `web_search` (Brave), `research` (Tavily, deep), `fetch_page` (CF Browser
  Rendering), `search_knowledge` (Vectorize) -- all proxied through the `sidvicious-search` worker
  (shared `SEARCH_SECRET` in the `X-Search-Secret` header).
- **Vision input**: paste images into the channel (up to 3 per message, 4 MB each); Claude reads them
  as image content blocks.
- **Image generation**: Workers AI (FLUX, Phoenix, SDXL) and AI Gateway image models (GPT Image,
  Recraft, and more) via `/ai/run`; `!model` switches the active image model.
- **D1 session state** (optional): conversation history persists across restarts when `CF_D1_*` is
  configured; otherwise it is in-memory with a rolling `DISCORD_HISTORY` depth (default 20).
- **Knowledge base**: `!learn <text|url>` indexes references into the Vectorize index
  `sidvicious-knowledge`.

## Commands (Discord)

Both a bang prefix (`!cmd`) and a registered slash command are supported.

| Command | Slash | Description |
|---------|-------|-------------|
| `!image <prompt>` | `/image prompt:<text>` | Generate an image |
| `!model [name]` | `/model [name]` | Show/switch the image model |
| `!learn <text\|url>` | `/learn content:<text\|url>` | Index a reference into the knowledge base |
| `!reset` | `/reset` | Clear the conversation |

Plain chat (and `@mention` / DM) is handled directly; the channels the roadie listens in are set by
`DISCORD_CHANNEL_IDS` (empty = DMs + @mentions only).

## Conventions

- **No em-dashes (U+2014) or en-dashes (U+2013)** in source, comments, or docs. Use commas,
  semicolons, parentheses, or `--`.
- **Handle / username is `skyphusion`** across all services.
- **Minimal dependencies**: vanilla Node.js + discord.js + the Anthropic SDK only. Justify any new
  one.
- **Mirror every `wrangler.toml` binding in the hand-authored `Env`** in `search-worker/src/index.ts`.
- **Secrets never committed**; `account_id` and tokens come from the environment (`.env` / the stack),
  never hardcoded. The brand assets in `assets/` are hand-authored, dependency-free SVG (the editable
  source); the `.png` exports are for Discord upload only.

## Crew + identity

- Crew members work as their own Unix + gh identity. The FIRST command in any op is the member's own
  login shell: `sudo -u <member> bash -lc '<ops>'` (loads their `$HOME`, their `~/dev/SidVicious_exe`
  clone, their gh/CF creds).
- Crew commits land under the member's own `skyphusion-<member>` identity, never Conrad's. (Conrad
  devs ONLY on his laptop, where his commits author as `Conrad Rockenhaus <conrad@skyphusion.org>`
  -- his real name kept, the in-house `@skyphusion.org` email; his name is never scrubbed and his
  history never rewritten. On jello the `conrad` user is the god process and commits as
  `Mackaye <mackaye@skyphusion.org>`.)
- Cross-project operating context lives in the main auto-memory
  (`~/.claude/projects/-home-conrad/memory/`); load it before acting.

## Commits & versioning

Conventional Commits (`feat(scope):` / `fix(scope):` / `docs:` / `ci:`); the body explains the why.
SemVer-style `0.MINOR.PATCH` while pre-1.0 (PATCH for fixes / backend tweaks, MINOR for new
features); bump `package.json` `version` in a release commit.
