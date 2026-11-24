# SidVicious_exe

This file is the guide for any coding agent and any contributor. Follow it.

## What this project is

SidVicious_exe is a Discord roadie for web search and image generation. Chat can use Claude directly, Claude through AI Gateway, or a local Ollama fallback. The search tools and default images go through the `sidvicious-search` Worker. The npm name is `@skyphusion/sidvicious-exe`. Read [README.md](README.md), [docs/BEHAVIOR.md](docs/BEHAVIOR.md), and [docs/SMOKE.md](docs/SMOKE.md).

The version is in `package.json`. See the latest `v*` tag.

## Layout

| Path | Role |
| --- | --- |
| `bot.mjs` | Discord roadie, Node 24 or newer |
| `ssrf-guard.mjs` | SSRF-safe fetch; ships in Docker and npm |
| `lib/helpers.mjs` | Pure helpers, no network |
| `search-worker/` | Worker `sidvicious-search` |
| `Dockerfile` | Roadie image |
| `stacks/compose.prod.yml` | Local compose file |
| `assets/` | Hand-authored SVG; PNG is for Discord upload |

## Commands

```bash
npm install
npm run roadie
node --check bot.mjs
npm test
cd search-worker && npm run typecheck
```

`node --check bot.mjs` is the bot parse gate. `npm test` runs Vitest. [`.github/workflows/ci.yml`](.github/workflows/ci.yml) checks the bot and typechecks the Worker. [`.github/workflows/coverage.yml`](.github/workflows/coverage.yml) runs the test suite.

Copy `.env.example` to `.env` for a local run. Do not commit `.env`.

One-time Worker setup is in the README. Create the Vectorize index before the first knowledge write. Set Worker secrets with `wrangler secret put`. Do not commit those values.

## How calls authenticate

| Feature | Credential | Where it goes |
| --- | --- | --- |
| Chat, direct | `ANTHROPIC_API_KEY` | `api.anthropic.com` |
| Chat, gateway | AI Gateway Run token | Gateway Anthropic path |
| Images, `@cf/*` | Search Worker secret plus the AI binding | `POST /image` on the search Worker |
| Images, third party | Account API token with Workers AI | Account `/ai/run` |
| Search and knowledge | `SEARCH_SECRET` | Worker `/search`, `/fetch`, `/knowledge/*` |

Do not send a default `@cf/*` image call through account `/ai/run` with only a Run token. Account `/ai/run` is for a third-party model when the account token can call it. The default gateway name is `skyphusion-llm`. `DISCORD_MODEL` overrides the chat model. With neither Claude path set, chat uses `OLLAMA_BASE_URL`.

Mirror every `search-worker/wrangler.toml` binding in the hand-authored `Env`. That `Env` is in `search-worker/src/index.ts`.

## Behavior

Plain chat, a mention, and a DM are handled in the roadie. `DISCORD_CHANNEL_IDS` lists channels. An empty list means DMs and mentions only. Bang commands and slash commands both exist: `image`, `model`, `learn`, and `reset`. Vision accepts up to 3 images, 4 MB each, on the Claude path. D1 history is optional. Without account, database id, and token, history stays in memory. `!learn` indexes into the Vectorize index for that channel.

Runtime dependencies stay small. Justify a new one. See `package.json`.

## Release

[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) deploys `sidvicious-search` on a `v*` tag. [`.github/workflows/image.yml`](.github/workflows/image.yml) pushes the roadie image to GHCR on a `v*.*.*` tag. No workflow in this repo starts a host for that image. A merge to `main` runs CI only. The tag commit must be on `main`.

[`.github/workflows/publish-npm.yml`](.github/workflows/publish-npm.yml) publishes when a GitHub Release is published. The release tag must equal `v` plus the `package.json` version. A version moves only in a release pull request.

## Docs

Write Simplified Technical English. Use short sentences. Use one idea per sentence. Use the active present tense. Use plain words. Use the same word every time.

Do not use an em dash (U+2014). Do not use an en dash (U+2013). Use a comma, a semicolon, parentheses, or two hyphens (`--`).

State the limit next to the capability. Do not turn a measured result into a promise.

## Safety

Do not put a secret in a tracked file, a log, or an issue. Do not hardcode an account id. The roadie must keep `ssrf-guard.mjs` on every URL fetch it makes.

## Commits

Use Conventional Commits. The body says why. The public handle is `skyphusion`.
