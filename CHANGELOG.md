# Changelog

## v0.2.5

PATCH (packaging + D1 gate + undici):

- **Ship `ssrf-guard.mjs`** in the Docker image and npm package (`files` + Dockerfile). `bot.mjs` imports it; without this, `npx` and GHCR images fail at module load.
- **D1 init guard:** only open D1 when token **and** `CF_D1_DATABASE_ID` (and account) are set. Stops noisy `D1 405` when chat uses `CF_API_TOKEN` without a sessions database.
- **undici** override `6.27.0` → `6.28.0` (npm audit clean).
- Packaging contract tests (`package.test.mjs`).

Tag deploys search Worker + GHCR roadie image. Bump fleet pin to `0.2.5`.

## v0.2.4

PATCH: dependency updates (postcss, ip-address, etc.) and security CI follow-through on main since v0.2.3. Tag deploys sidvicious-search Worker.

## v0.2.3

fix(security): Puppeteer fetch validates every subresource URL with DNS-pinned SSRF guard (#984 K3)

## v0.2.2

fix(security): SSRF guards on fetch/image paths and channel-scoped knowledge base (#54, #55)

- DNS-resolve SSRF guard blocks redirect navigations on outbound fetch.
- Knowledge base queries scoped to Discord `channel_id`.

## v0.2.1

Release sync bump (2026-07-21). No functional changes in this tag.

