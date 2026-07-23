# Changelog

## v0.2.3

fix(security): Puppeteer fetch validates every subresource URL with DNS-pinned SSRF guard (#984 K3)

## v0.2.2

fix(security): SSRF guards on fetch/image paths and channel-scoped knowledge base (#54, #55)

- DNS-resolve SSRF guard blocks redirect navigations on outbound fetch.
- Knowledge base queries scoped to Discord `channel_id`.

## v0.2.1

Release sync bump (2026-07-21). No functional changes in this tag.

