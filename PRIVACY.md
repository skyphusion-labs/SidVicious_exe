# Privacy Policy

**Effective date:** 2026-06-14
**Service:** SidVicious_exe, a Discord application
**Operator:** Conrad Rockenhaus (SkyPhusion), the operator of the official hosted instance.

This policy explains what data SidVicious_exe processes, why, who it is shared with, and how long it is
kept. SidVicious_exe is open-source software (AGPL-3.0); anyone may run their own instance, in which case
that operator is the data controller for their instance and this policy describes the
SkyPhusion-operated instance.

## What SidVicious_exe is

SidVicious_exe is a punk-rock AI assistant that participates in a Discord channel. It follows the
conversation, answers questions (with optional live web search and deep research), generates images
on request, and keeps a knowledge base of references people feed it. To do this it uses the Discord
**Message Content** intent, which means it can read the text of messages in the channels where it is
active.

## Data SidVicious_exe processes

- **Message content** in channels SidVicious_exe is configured to listen in, plus direct messages to the bot
  and messages that @mention it. This is used as the input to the AI model.
- **Discord identifiers and display names** as they appear in conversation (so SidVicious_exe can address
  people and attribute lines), and **channel IDs** (used as the key for a channel's stored conversation state).
- **Image attachments** you post. These are fetched
  from Discord's CDN over HTTPS and passed to the AI model for the current turn only. They are
  **not** written to disk and **not** stored in the conversation history (only a text placeholder
  is stored).
- **Conversation state** that SidVicious_exe derives from the channel: a rolling window of recent
  conversation history used to keep context across messages.
- **Knowledge base entries** you add with `!learn` (text or fetched URL content), which are embedded
  and stored for later semantic recall.

## Where the data goes (subprocessors)

To provide the service, SidVicious_exe sends data to the following third parties:

| Provider | What is sent | Why |
|----------|--------------|-----|
| **Anthropic** (Claude, via Cloudflare AI Gateway) | message content, attached images | generate the assistant's responses |
| **Cloudflare** (D1, Vectorize, AI Gateway, Workers AI, Browser Rendering) | conversation state, knowledge entries, image prompts, fetched pages | storage, embeddings, model routing, image generation, headless page fetches |
| **Brave Search** and **Tavily** | search queries the model chooses to run | web search and research |

If the operator runs SidVicious_exe in its **ollama fallback** mode (no Cloudflare AI Gateway token), message
content is sent to a self-hosted model instead of Anthropic, and image attachments are reduced to a
text placeholder.

SidVicious_exe does **not** sell your data or use it for advertising.

## Storage and retention

- Conversation state (a rolling window of recent history) is stored in **Cloudflare D1**,
  scoped per Discord channel. It persists so context survives a restart.
- Knowledge base entries are stored in **Cloudflare Vectorize** until removed.
- `!reset` clears the calling channel's conversation state.
- To request deletion of a channel's stored data or knowledge entries, contact the operator (below).

## Data scoping and security

- D1 session data is scoped per Discord channel ID; SidVicious_exe does not read another channel's conversation.
- Secrets and API tokens are never stored in conversation data. See
  [SECURITY.md](SECURITY.md) for the security design and how to report a vulnerability.

## Children

SidVicious_exe is not directed to children. You must meet Discord's minimum age (at least 13, or older where
your jurisdiction requires) to use Discord and therefore SidVicious_exe.

## Changes to this policy

We may update this policy as SidVicious_exe evolves. Material changes will be reflected in the
effective date above.

## Contact

Questions or data-deletion requests: **conrad@skyphusion.org**, subject
`[PRIVACY] skyphusion-SidVicious_exe`.
