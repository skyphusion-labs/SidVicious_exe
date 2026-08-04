# Security Policy

## Supported Versions

SidVicious_exe is pre-1.0 software under active development. Security fixes are applied to the `main` branch only.

| Version | Supported |
|---------|-----------|
| `main`  | Yes |
| older tags | No |

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Report security issues privately to:

- **Email:** crockenhaus@icloud.com
- **Subject line:** `[SECURITY] SidVicious_exe -- <brief description>`

Include:
- A description of the vulnerability and its potential impact
- Steps to reproduce or a proof-of-concept (if safe to share)
- Any suggested mitigations

You can expect an acknowledgment within 48 hours and a resolution or status update within 7 days.

## Scope

In scope:
- Secrets/credentials exposed via the roadie, Worker, or repository
- Authentication bypass on the `sidvicious-search` Worker (`X-Search-Secret` header)
- Prompt injection attacks that cause the roadie to exfiltrate secrets or take unintended actions
- D1 session data exposure or cross-channel data leakage
- Vectorize knowledge base pollution via unauthenticated writes

Out of scope:
- Denial-of-service via Discord rate limits or model quota exhaustion
- Social engineering of the roadie's conversation responses
- Issues in third-party services (Discord, Cloudflare, Anthropic, Brave, Tavily)

## Security Design Notes

- **Secrets are never committed.** The `.gitignore` excludes `stacks/.env` and all credential files. Cloudflare Worker secrets are set via `wrangler secret put`, not in `wrangler.toml`.
- **`X-Search-Secret` header** authenticates all non-health requests from the roadie to the `sidvicious-search` Worker (search, fetch, knowledge, and `@cf/*` image gen). Use a long random string.
- **Chat token** (`CF_API_TOKEN` / `CF_AIG_TOKEN`) is an AI Gateway Run (or Unified Billing) token for the Anthropic gateway path. It is **not** a full account API token: account `/ai/run` returns 401 with Run tokens alone.
- **Workers AI images** (`@cf/*`) are generated on the search Worker via the `AI` binding (not with the Run token against `api.cloudflare.com`).
- **D1 session data** is scoped per Discord channel ID. No cross-channel reads occur. D1 is only used when account, database id, and token are all configured.
- **Outbound fetches** (attachment / page helpers) use DNS-pinned SSRF guards (`ssrf-guard.mjs` on the roadie; `search-worker/src/ssrf.ts` on the Worker).
- **Image attachments** from Discord are fetched over HTTPS, base64-encoded for the current turn, and never persisted to disk or D1.
- **User-facing errors** are scrubbed of configured secrets (`sanitizeErrorMessage`).
