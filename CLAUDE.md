# CLAUDE.md

Guidance for Claude Code (and the crew) working in this repo.

## What this is

**SidVicious_exe: a punk rock Discord roadie for web search and image generation.** Talk to it
naturally, ask it to look things up, or have it generate visuals. Chat routes through the Cloudflare
AI Gateway native Anthropic path (Claude) with an AI Gateway **Run** token. Default `@cf/*` images
go through the search Worker **AI binding** (`POST /image` on `sidvicious-search`); do **not** send
default Workers AI image gen through account `/ai/run` with a Run token. Account `/ai/run` is only
for third-party gateway models with a real account API token. The punk personality is intentional:
direct, honest, useful, no corporate sycophancy. Version is root **`package.json`** (trust the pin +
tags); published to npm as `@skyphusion/sidvicious-exe`. Roadie runs as a Docker/GHCR stack on the
deploy host; search is a Cloudflare Worker (`sidvicious-search`).

## Structure

```
bot.mjs                  Node 24+ Discord roadie (main entry)
ssrf-guard.mjs           SSRF-safe fetch for bot-side URL pulls (must ship in Docker + npm)
lib/helpers.mjs          Pure, network-free logic (#39); unit-tested
package.json             Roadie deps; scripts: roadie, bot, test
package.test.mjs         Packaging contract (ssrf-guard in files + Dockerfile)
bot.test.ts              Vitest boot smoke
helpers.test.mjs         Vitest unit tests for lib/helpers.mjs
.env.example             Env template
Dockerfile               node:24-slim; copies bot.mjs, ssrf-guard.mjs, lib/
docs/
  BEHAVIOR.md            Behavior + failure-mode contract
  SMOKE.md               Manual Discord smoke checklist
search-worker/           Worker `sidvicious-search`
  src/index.ts           /search /fetch /image /knowledge/*
  wrangler.toml          BROWSER, AI, KNOWLEDGE (Vectorize)
stacks/
  compose.prod.yml       Bind-mount dev compose (prod prefers GHCR pin via fleet IaC)
```

## Commands

```bash
cp .env.example .env       # fill in DISCORD_TOKEN, CF_ACCOUNT_ID, CF_API_TOKEN
npm install
npm run roadie             # node --env-file-if-exists=.env bot.mjs (run the roadie locally)
node --check bot.mjs       # parse check -- the CI gate for the bot
npm test                   # vitest: helpers + package contract + boot smoke
cd search-worker && npm run typecheck && npm run deploy   # the search worker
```

`search-worker` one-time setup + secrets (via wrangler):
```bash
npx wrangler vectorize create sidvicious-knowledge --dimensions=1024 --metric=cosine
npx wrangler secret put BRAVE_API_KEY   # and TAVILY_API_KEY, SEARCH_SECRET
```

### Verifying changes

The bot is dependency-free at parse time, so `node --check bot.mjs` is the gate, and `search-worker`
typechecks (`npm run typecheck`). `npm test` runs the Vitest suite: `bot.test.ts` is a boot smoke that
imports `bot.mjs` against mocked tokens, and `helpers.test.mjs` unit-tests the pure logic in
`lib/helpers.mjs` (no mocks). CI is GitHub Actions on GitHub-hosted `ubuntu-latest` (public repo,
fork-safe): `ci.yml` lints the bot + typechecks `search-worker`; `code-coverage.yml` runs the Vitest
suite. **`deploy.yml` deploys `sidvicious-search` only on a pushed `v*` tag**, never on a bare
merge to `main` (main runs CI only). The bot itself is NOT deployed by CI: it is a deliberate
host-side Docker step on the `<deploy-host>` (`stacks/compose.prod.yml`). GHCR roadie image builds
on version tags via `image.yml` (`v*.*.*`).

## Cloudflare setup

| Feature | How it authenticates | Endpoint / binding |
|---------|----------------------|--------------------|
| Chat (Claude) | AI Gateway **Run** token (`CF_API_TOKEN` / `CF_AIG_TOKEN`) | `…/anthropic/v1/messages` |
| Images `@cf/*` | Search Worker `X-Search-Secret` + Worker **AI** binding | `POST {SEARCH_WORKER_URL}/image` |
| Images third-party | Account API token with Workers AI (not a Run token alone) | `POST …/accounts/{id}/ai/run` |
| D1 sessions | Token + `CF_D1_DATABASE_ID` + account | D1 REST `/query` |
| Search / knowledge | `SEARCH_SECRET` | Worker `/search`, `/fetch`, `/knowledge/*` |

Default gateway name is `skyphusion-llm` (`CF_AIG_GATEWAY_ID`).

## Architecture

- **Chat is Claude via the AI Gateway** (`anthropic/claude-sonnet-4-6` by default when a CF token is
  set; `DISCORD_MODEL` overrides). With no CF token it falls back to ollama (`OLLAMA_BASE_URL`, chat
  only).
- **Tool-use loop**: `web_search` (Brave), `research` (Tavily), `fetch_page` (Browser Rendering),
  `search_knowledge` (Vectorize), `generate_image` -- search tools and default images go through
  `sidvicious-search` (`X-Search-Secret`).
- **Vision input**: up to 3 image attachments per message, 4 MB each (Claude path only).
- **Image generation**: `@cf/*` models prefer Worker `/image` (AI binding). REST `/ai/run` is a
  fallback for non-`@cf` catalog entries when a capable account token is configured. `!model` switches.
- **D1** (optional): init only when account + database id + token are all set; otherwise in-memory
  history (`DISCORD_HISTORY` pairs, default 20).
- **Knowledge base**: `!learn` indexes into Vectorize `sidvicious-knowledge`, filtered by channel id.

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
  history never rewritten. On the crew host the `conrad` user is the god process and commits as
  `Mackaye <mackaye@skyphusion.org>`.)
- Cross-project operating context lives in the main auto-memory
  (`~/.claude/projects/shared auto-memory store (see global CLAUDE)`); load it before acting.

## Commits & versioning

Conventional Commits (`feat(scope):` / `fix(scope):` / `docs:` / `ci:`); the body explains the why.
SemVer-style `0.MINOR.PATCH` while pre-1.0 (PATCH for fixes / backend tweaks, MINOR for new
features); bump root `package.json` `version` in a release PR.

## Release / tagging

**TAG-GATED Worker deploy.** `.github/workflows/deploy.yml` runs on pushed `v*` tags (deploy step
guarded on the tag ref). Merge to `main` runs CI only and does **not** redeploy `sidvicious-search`.

| Tag / event | Workflow | Effect |
|-------------|----------|--------|
| `v*` | `deploy.yml` | Deploy `sidvicious-search` Worker |
| `v*.*.*` | `image.yml` | Build/push roadie image to GHCR |
| GitHub Release **published** | `publish-npm.yml` | Publish `@skyphusion/sidvicious-exe` (release tag must equal `v` + `package.json` version) |

### Cut a release

1. **Release PR on `main`:** bump `package.json` version, land the PR.
2. **Tag:**

```bash
git fetch origin main && git checkout main && git pull --ff-only
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin vX.Y.Z
```

3. Confirm `deploy.yml` (and `image.yml` if the image path matches) green.
4. For npm: `gh release create vX.Y.Z --title "vX.Y.Z" --generate-notes` so `publish-npm.yml` runs.
5. Bot stack on the deploy host remains a deliberate compose pull/redeploy, not CI.
