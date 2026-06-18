# Contributing to SidVicious_exe

External contributions are welcome. Please read this first.

## How to Contribute

1. **Open an issue before writing code.** Describe the bug or feature. This avoids duplicate work and lets us discuss the right approach.
2. **Fork the repo and create a branch** from `main`. Branch names: `fix/<thing>`, `feat/<thing>`, `ci/<thing>`.
3. **Write your changes.** See the development setup below.
4. **Open a pull request** against `main`. Fill in the PR template: what changed, why, and how you tested it.

## Development Setup

### Discord roadie

```bash
npm install
# reference stacks/dischord.yml for required env vars
# create a local .env with your Discord token + channel IDs
node bot.mjs
```

Run the smoke test with vitest:

```bash
npx vitest run
```

Verify behavioral changes by running against a test channel manually.

### sidvicious-search Worker

```bash
cd search-worker
npm install
npm run typecheck    # must pass before any PR
npm run dev          # local wrangler dev server
npm run deploy       # deploy to Cloudflare
```

**`npm run typecheck` is the CI gate.** TypeScript errors are not caught by `wrangler dev`, so always run it before pushing.

## Code Style

- **No em-dashes (U+2014) or en-dashes (U+2013).** Use commas, semicolons, or parentheses instead.
- Minimal dependencies. The roadie uses only `discord.js` and `@anthropic-ai/sdk`. Do not add framework dependencies.
- No build step (`bot.mjs` is plain ESM, runs directly with `node`).
- Secrets never in source. All runtime config via environment variables.

## Conventional Commits

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
fix(scope): short description of what was fixed
feat(scope): short description of what was added
ci(scope): CI or deployment changes
docs: documentation only
chore: dependency updates, housekeeping
```

## What We're Looking For

Good contributions:
- Bug fixes with a clear reproduction case
- New image model entries in the `IMAGE_MODELS` catalog (alias + full ID + label)
- Improvements to the `SYSTEM_PROMPT` that fit the punk rock personality
- Additional search tool integrations in the `sidvicious-search` Worker
- Documentation improvements

Less likely to merge:
- Large refactors without prior discussion
- New runtime dependencies
- Features that duplicate existing commands or Claude's autonomous capabilities
- Changes that break the ollama fallback path

## Licensing

By contributing, you agree that your contributions are licensed under AGPL-3.0, the same license as this project. See [LICENSE](LICENSE).
