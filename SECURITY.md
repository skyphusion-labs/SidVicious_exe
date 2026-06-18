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
- **`X-Search-Secret` header** authenticates all requests from the roadie to the `sidvicious-search` Worker. This should be a long random string.
- **Cloudflare API token** (`CF_API_TOKEN`) authenticates all requests to `api.cloudflare.com` for chat and image generation.
- **D1 session data** is scoped per Discord channel ID. No cross-channel reads occur.
- **Image attachments** are fetched directly from Discord's CDN over HTTPS, base64-encoded for the current turn, and never persisted to disk or D1.
