# Manual Discord smoke checklist

Run against a live guild before tagging a release (unit tests cannot reach Discord).
Every line is pass/fail; a fail blocks the tag.

Setup: roadie **v0.2.6+** with full config (CF Run token + account, D1, search worker with AI
binding) in a test channel listed in `DISCORD_CHANNEL_IDS`. Search Worker must be deployed from
the same release line so `POST /image` exists.

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
- [ ] `!image a punk flyer` returns an attachment (default FLUX Schnell via search-worker `/image`)
- [ ] Logs show `done via search-worker` (not a 401 from account `/ai/run`)
- [ ] `/image` (slash) does the same via deferred reply
- [ ] `!model` lists the catalog with the active model marked
- [ ] `!model sdxl` switches; the next `!image` uses SDXL; `!model garbage` is rejected
- [ ] A FLUX 2 model generates (e.g. `!model flux2-fast`) via the Worker path
- [ ] "draw me a ..." in plain chat triggers the `generate_image` tool + attachment

## Vision
- [ ] Paste an image + "what is this": the reply describes it
- [ ] 4 images pasted: only 3 are read (cap), no error

## Sessions (D1)
- [ ] Talk, restart the process, ask a follow-up: history survived
- [ ] `!reset`, restart: history stays empty; image model back to default

## Failure modes
- [ ] Stop the search worker: search-y questions degrade gracefully; `@cf/*` images fail without crash
- [ ] Break `CF_API_TOKEN`: chat fails; replies do NOT leak account id or token (`[redacted]`)
- [ ] Mis-set Run token only (no SEARCH_*): image path error mentions search worker / Workers AI, no secret leak

## Slash parity
- [ ] `/image`, `/model`, `/learn`, `/reset` all registered and behave like the bang commands
