# Claude Code Command — Proxy Datamuse through the relay, eliminate the iframe block entirely

**Date:** 2026-07-12
**Repo:** TASK 1 targets field-relay-nba. TASK 2 targets jubilant-bassoon. This identical file is pushed to both repos; execute only the task matching the repo you're running in.
**Scope:** `api.datamuse.com` is called directly from the client, which fails inside claude.ai's iframe sandbox (CSP blocks the cross-origin call), currently handled with a `fresh=83` fallback constant. That's a fallback, not a fix — this CC-CMD removes the actual block. field-relay-nba is a Cloudflare Worker with unrestricted egress; routing Datamuse calls through it makes the iframe restriction irrelevant, the same pattern already used for ESPN/Odds/MLB Stats proxying. This also lets the relay cache word-frequency lookups (near-static data), which is faster than the current direct-fetch-every-time approach, not just unblocked.

**Branch:** main — commit directly, do not create a feature branch or PR.

git pull. Read CLAUDE.md first.

Write findings to outbox/cc-datamuse-relay-proxy-2026-07-12.md.

## TASK 1 (field-relay-nba) — Add a Datamuse proxy route

Add a new route (e.g. `/datamuse/words`) that accepts the same query parameters the client currently sends directly to `api.datamuse.com` (confirm the exact current client call signature from jubilant-bassoon's index.html before building this — probe from the real caller, don't guess the parameter shape), forwards the request to the real Datamuse API server-side, and returns the response.

Add caching: word-frequency data for a given word is effectively static — use the same caching pattern already established for other relatively-static relay data (check existing routes for the established KV/cache-header convention, don't invent a new one). A reasonable TTL (e.g., 7-30 days) is appropriate given how rarely a word's frequency ranking would meaningfully change.

Rate-limit consideration: Datamuse's own limit is 100K requests/day, no key required. Confirm whether routing all client traffic through one relay IP changes the effective rate-limit exposure compared to today's per-browser-IP direct calls, and whether the new caching layer sufficiently reduces real Datamuse call volume to make this a non-issue — state the reasoning, don't skip this consideration.

## TASK 2 (jubilant-bassoon) — Switch the client to call the relay proxy instead of Datamuse directly

Find every place in index.html that currently calls `api.datamuse.com` directly (the freshness calculation in `scoreProse()`, and any other call site — grep the whole file, don't assume there's only one). Replace with a call to the new relay route from TASK 1. Remove the `fresh=83` iframe-blocked fallback constant and its associated conditional logic — it should no longer be needed once the call routes through the relay, which has no iframe restriction. If TASK 1 hasn't executed yet when this task is picked up, execute TASK 1's work first in this same session (matching the cross-repo dependency pattern already used tonight), then proceed.

## VERIFICATION

- TASK 1: real live test — call the new relay route directly, confirm it returns real Datamuse data, confirm a second call for the same word hits cache (faster, or a cache-hit header/log line).
- TASK 2: real live test from a context simulating the iframe restriction if possible (or at minimum, confirm the client code path no longer references `api.datamuse.com` at all, and no longer contains the `fresh=83` fallback branch), confirm freshness scoring in `scoreProse()` still produces real, non-fallback values end to end.
- Confirm no other relay route accidentally broke from the new addition (existing test/smoke suite for field-relay-nba, if one exists — check for it, don't assume there isn't one).
- jubilant-bassoon: `node smoke.js`, `node field_unit.js`, `node field_smoke.js` all clean.

## DONE CONDITION

Datamuse calls no longer originate from the client's own sandboxed context at all — they're proxied through the relay, which has no iframe restriction, with caching that makes this faster than the current direct-fetch approach. The `fresh=83` fallback is removed as genuinely unnecessary, not just deprioritized. Confidence ≥ 95 in each repo independently.

**Confidence scoring (field-relay-nba):**
- Proxy route correctly forwards real Datamuse requests, confirmed against actual client call signature (35 pts)
- Caching implemented using an established pattern, real cache-hit verified live (35 pts)
- Rate-limit consideration addressed explicitly (15 pts)
- No other route broken (15 pts)

**Confidence scoring (jubilant-bassoon):**
- Every direct Datamuse call site found and switched to the relay proxy (40 pts)
- `fresh=83` fallback correctly removed, not just left dead (25 pts)
- Real end-to-end freshness scoring confirmed working post-switch (20 pts)
- All three suites clean (15 pts)

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.

---

**One-liners:**

field-relay-nba (TASK 1):
```
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }
git pull. Read docs/CC-CMD-2026-07-12-datamuse-relay-proxy.md. Execute TASK 1 (this repo's portion). Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
```

jubilant-bassoon (TASK 2):
```
git remote get-url origin | grep -q jubilant-bassoon || { echo "WRONG REPO"; exit 1; }
git pull. Read docs/CC-CMD-2026-07-12-datamuse-relay-proxy.md. Execute TASK 2 (this repo's portion). Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
```