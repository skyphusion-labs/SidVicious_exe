# Manual Discord smoke checklist

Run against a live guild before tagging a release (unit tests cannot reach Discord).
Every line is pass/fail; a fail blocks the tag.

Setup: roadie running with full config (CF token + account, D1, search worker) in a test
channel listed in `DISCORD_CHANNEL_IDS`.

## Chat + history
- [ ] Plain message in the listen channel gets an in-character reply
- [ ] DM (no mention) gets a reply; a message in an UNLISTED channel without a mention gets none
- [ ] @mention in an unlisted channel gets a reply
- [ ] Ask a follow-up that needs the previous exchange: history holds
- [ ] Reply longer than 2000 chars arrives as multiple messages, none truncated

## Tools
- [ ] A current-events question triggers `web_search` and cites something recent
- [ ] "research X in depth" triggers `research`
- [ ] "read <url>" triggers `fetch_page`
- [ ] After `!learn`, a related question surfaces the learned content (`search_knowledge`)

## Images
- [ ] `!image a punk flyer` returns an attachment (default FLUX Schnell)
- [ ] `/image` (slash) does the same via deferred reply
- [ ] `!model` lists the catalog with the active model marked
- [ ] `!model sdxl` switches; the next `!image` uses SDXL; `!model garbage` is rejected
- [ ] A FLUX 2 model (multipart path) generates (e.g. `!model flux2-fast`)
- [ ] "draw me a ..." in plain chat triggers the `generate_image` tool + attachment

## Vision
- [ ] Paste an image + "what is this": the reply describes it
- [ ] 4 images pasted: only 3 are read (cap), no error

## Sessions (D1)
- [ ] Talk, restart the process, ask a follow-up: history survived
- [ ] `!reset`, restart: history stays empty; image model back to default

## Failure modes
- [ ] Stop the search worker: search-y questions degrade gracefully (tool error text, no crash)
- [ ] Break `CF_API_TOKEN`: `!image` reports failure WITHOUT leaking the account id or token
  (check the reply text for the raw values -- must show `[redacted]`)

## Slash parity
- [ ] `/image`, `/model`, `/learn`, `/reset` all registered and behave like the bang commands
