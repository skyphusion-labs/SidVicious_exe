# Behavior + failure-mode contract

The audited user-facing surface (#39, 2026-07-18). Every path below states what happens on
success AND on failure; anything the code does that this file does not say is a bug in one
of the two.

## Configuration + fail-closed rules

| Var | Required? | Missing/invalid behavior |
|-----|-----------|--------------------------|
| `DISCORD_TOKEN` | **required** | process exits 1 at startup (fail closed) |
| `CF_ACCOUNT_ID` + `CF_API_TOKEN` | for Claude + images | chat falls back to ollama (`OLLAMA_BASE_URL`, default localhost); image commands reply "not configured" |
| `CF_AIG_GATEWAY_ID` | optional | defaults to `skyphusion-llm` |
| `CF_D1_DATABASE_ID` | optional | sessions are in-memory only (lost on restart); D1 errors NEVER break a reply (load/save catch + log) |
| `SEARCH_WORKER_URL` + `SEARCH_SECRET` | optional | search/research/fetch/knowledge tools are not offered to the model; `!learn` replies "not configured" |
| `DISCORD_CHANNEL_IDS` | optional | empty = the roadie answers ONLY DMs and @mentions |
| `DISCORD_HISTORY` | optional | rolling depth in exchange pairs, default 20 |

## Chat (plain message / DM / @mention)

- Trigger: DM, @mention, or a message in a listed channel. Bots are ignored; empty
  text with no image attachments is ignored.
- History: rolling window of `DISCORD_HISTORY` exchange pairs per channel, persisted to D1
  when configured. User lines are stored as `author: text` so multi-user channels stay
  attributed.
- Tool loop: up to 5 rounds of tool_use (web_search, research, fetch_page,
  search_knowledge, generate_image), then one final forced completion. Tool errors are
  returned to the model as text, not thrown.
- Replies over 2000 chars are split on newline boundaries (hard cut when none) and sent in
  order; generated images attach to the final chunk.
- Failure: any thrown error is logged raw and replied as `(error: ...)` with configured
  identifiers (account id, tokens, search secret) REDACTED (`sanitizeErrorMessage`).
  The typing indicator always stops (finally).

## Vision

- Up to 3 image attachments per message, 4 MB each, only on the Claude path (ollama mode
  annotates `[N image(s) attached -- vision not supported]`).
- A failed attachment fetch is logged and skipped; the message still goes through.

## Commands (bang + slash are equivalent)

| Command | Success | Failure |
|---------|---------|---------|
| `!image <prompt>` / `/image` | progress line, then image attachment | "not configured" without CF creds; upstream error text (redacted) on API failure |
| `!model` / `/model` | catalog with the active model marked | -- |
| `!model <name>` | switches (alias, exact id, or partial id match) + persists | "Never heard of ..." on no match |
| `!learn <text\|url>` / `/learn` | URL is fetched via the search worker first, then indexed to Vectorize; replies with title + word count | "not configured" without the search worker; index/fetch errors reported |
| `!reset` / `/reset` | wipes history + image model back to default, persists | -- |

## Session persistence (D1, optional)

One row per channel (`sessions(channel_id, data, updated_at)`), created on first use
(`CREATE TABLE IF NOT EXISTS` at startup). In-memory cache is authoritative during a
process lifetime; D1 is the restart survivor. Any D1 error degrades to in-memory,
logged, never user-visible. Partial/stale rows are repaired on load (`normalizeSession`).

## Security posture

- The only secrets the process holds: Discord token, one CF token (optionally a second
  for D1), the search-worker shared secret. None are ever echoed to Discord: user-facing
  error text is scrubbed of every configured identifier value.
- The search worker authenticates via `X-Search-Secret`; without both URL + secret no
  search tool is exposed to the model at all.
- Prompt injection via fetched pages/search results is possible in principle (the model
  reads tool output); blast radius is bounded to what the tools can do: search, fetch,
  index text, generate images. No shell, no file system, no message-sending tools beyond
  the reply itself.
- CI smoke mode (`VITEST=1`) performs NO network I/O (it previously called the live
  Discord REST API with a mock token; removed in #39).
- Logging: message text is logged (first 120 chars) to stdout/`DISCORD_LOG` -- treat the
  log destination as sensitive; see PRIVACY.md.

## npm distribution (`@skyphusion/sidvicious-exe`)

`npx @skyphusion/sidvicious-exe` (bin: `sidvicious`) runs the roadie with env config --
no clone needed. The search worker is NOT on npm: deploy it from this repo with wrangler
(`search-worker/`), then point `SEARCH_WORKER_URL` at it. Docker remains the recommended
long-running deployment (`stacks/compose.prod.yml`).
