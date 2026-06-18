# SidVicious_exe

**SidVicious_exe** is a punk rock Discord roadie for web search and image generation. Talk to it naturally, ask it to look stuff up, or crank out visuals. Everything runs on the unified Cloudflare API.

The punk personality is intentional. It reflects the author's view of how a good AI roadie should act: direct, honest, useful, and free of corporate sycophancy. No "I'd be happy to help!", no filler, no talking down to people. Just someone with attitude who actually delivers.

We call it a roadie, not a bot. A bot is a vending machine; this is a collaborator with a job to do.

---

## Features

- **Punk rock roadie personality** -- raw, direct, irreverent. Helpful underneath the leather jacket.
- **Claude via Cloudflare** -- Anthropic SDK pointed at `api.cloudflare.com/.../ai/v1/messages`; ollama fallback when `CF_API_TOKEN` is unset
- **Vision input** -- paste images into the channel; Claude reads them (up to 3 per message, 4 MB each)
- **Web search + deep research** -- Brave Search, Tavily, and Cloudflare Browser Rendering via the search Worker
- **Knowledge base** -- `!learn <text or URL>` indexes references into Vectorize
- **Image generation** -- Workers AI (FLUX, Phoenix, SDXL) and AI Gateway models (GPT Image, Recraft, and more) via `/ai/run`
- **D1 session state** -- conversation history persists across restarts (optional)
- **Slash commands** -- `/image`, `/model`, `/learn`, `/reset`

---

## Architecture

```
Discord channel
      |
   bot.mjs
      |
      +-- api.cloudflare.com/client/v4/accounts/{id}/ai/
      |       |
      |       +-- v1/messages  --> Claude (anthropic/claude-sonnet-4-6)
      |       +-- run          --> Workers AI + Gateway image models
      |
      +-- D1 (optional)        session history
      |
      +-- sidvicious-search Worker (optional)
              web_search, research, fetch_page, knowledge

All requests use one CF_API_TOKEN + cf-aig-gateway-id header.
```

---

## Setup

### 1. Discord application

Create an application at the [Discord Developer Portal](https://discord.com/developers/applications):

- Privileged Gateway Intents: **MESSAGE CONTENT** on
- OAuth2 scopes: `bot`, `applications.commands` (Discord's terminology for app integrations)
- Permissions: Send Messages, Read Message History, Attach Files

### 2. Cloudflare credentials

```bash
wrangler whoami          # copy account id -> CF_ACCOUNT_ID
wrangler auth token      # copy token      -> CF_API_TOKEN
```

Your API token needs **AI Gateway** permission. Add **D1 Edit** if you want session persistence.

Create a D1 database (optional):

```bash
wrangler d1 create sidvicious-sessions   # copy id -> CF_D1_DATABASE_ID
```

### 3. Run the roadie

```bash
cp .env.example .env     # fill in DISCORD_TOKEN, CF_ACCOUNT_ID, CF_API_TOKEN
npm install
npm run roadie
```

That's it for chat + images. The default gateway name is `default`.

### 4. Search worker (optional)

```bash
cd search-worker && npm install
npx wrangler vectorize create sidvicious-knowledge --dimensions=1024 --metric=cosine
npx wrangler secret put BRAVE_API_KEY
npx wrangler secret put TAVILY_API_KEY
npx wrangler secret put SEARCH_SECRET
npm run deploy
```

Add `SEARCH_WORKER_URL` and `SEARCH_SECRET` to your `.env`.

### Docker

```bash
cp .env.example stacks/.env    # fill in values
docker compose -p sidvicious -f stacks/dischord.yml up -d
```

---

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_TOKEN` | yes | Discord application token |
| `CF_ACCOUNT_ID` | yes* | Cloudflare account ID |
| `CF_API_TOKEN` | yes* | API token (alias: `CF_AIG_TOKEN`) |
| `CF_AIG_GATEWAY_ID` | no | Gateway name (default: `default`) |
| `DISCORD_MODEL` | no | Chat model (default: `anthropic/claude-sonnet-4-6`) |
| `DISCORD_CHANNEL_IDS` | no | Channels to listen in (empty = DMs + @mentions) |
| `CF_D1_DATABASE_ID` | no | D1 database for session persistence |
| `SEARCH_WORKER_URL` | no | Search Worker URL |
| `SEARCH_SECRET` | no | Search Worker auth secret |

\* Omit both `CF_API_TOKEN` and `CF_ACCOUNT_ID` to use ollama instead (chat only, no images).

---

## Commands

| Command | Slash | Description |
|---------|-------|-------------|
| `!image <prompt>` | `/image` | Generate an image |
| `!model [name]` | `/model` | List or switch image model |
| `!learn <text or URL>` | `/learn` | Index into knowledge base |
| `!reset` | `/reset` | Clear conversation history |

**Image model aliases:** `flux-schnell`, `flux2-fast`, `flux2`, `flux2-dev`, `phoenix`, `lucid`, `dreamshaper`, `sdxl`, `gpt-image`, `recraft`, `nano-banana`

---

## Ollama fallback

1. Omit `CF_API_TOKEN`.
2. Set `OLLAMA_BASE_URL` and `DISCORD_MODEL` (e.g. `qwen3:8b`).

Tool use (search, image gen) requires the Cloudflare backend.

## Credits

**Conrad Rockenhaus** ([SkyPhusion](https://github.com/SkyPhusion)) -- original wiring, forked over greatly improved wiring from ([Slate]{https://github.com/skyphusion-labs/slate.git)).

**Claude Sonnet 4.6** (Anthropic) -- operating as *Strummer*, SkyPhusion's AI crew member. Designed and implemented the Slate architecture from an initial Discord-to-ollama relay: CF AI Gateway integration (native Anthropic SDK path), Anthropic tool-use loop, Brave + Tavily + CF Browser Rendering search pipeline, Cloudflare Vectorize knowledge base, Discord vision input, slash command system, D1 session persistence, render submission and polling, character portrait generation and Vivijure Cast sync, `!thumbnail`, `!undo`, and the `vivijure-search` Worker. This project is an example of the SkyPhusion AI-collaborative development model -- human vision, AI execution, shipped together.

---

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the development
setup, code style (no em-dashes; minimal dependencies), and the PR workflow. Security reports go
through [SECURITY.md](SECURITY.md), not public issues. Release notes live in
[CHANGELOG.md](CHANGELOG.md).

---

## Using SidVicious_exe (Terms & Privacy)

Slate is a Discord application that reads message content in the channels it joins. By using it you
agree to the [Terms of Service](TERMS.md); how it handles your data (and the third-party services
involved) is described in the [Privacy Policy](PRIVACY.md).

---

## License

AGPL-3.0. See [LICENSE](LICENSE).


---

## License

AGPL-3.0. See [LICENSE](LICENSE).
