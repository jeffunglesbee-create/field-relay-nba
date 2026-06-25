# BSD Event ID Enrichment — 2026-06-25

## Probes

- `bsdEventId` did not exist anywhere in `src/index.js` before this commit.
- `// Adapt all fixtures — live ones with stats attached (Gap 1+2)` anchor
  found at L2642 (unique match).
- `// Pre-fetch WC pre-game lambdas` anchor at L2645 (unique match) —
  insertion goes between these two.
- `teamNameMatch` is module-level at L974 — accessible from `handleV2Games`.
- `BSD_API_TOKEN` already in `deploy.yml` secrets list + env block from CC-CMD-A.
- `/bsd/events/live` route lives at L6097, returns `{count:0,events:[]}` right now.

## Edit (src/index.js L2645–2679)

Block inserted between the football adapt step and WC lambda pre-fetch:

- Guarded by `env.BSD_API_TOKEN` — silent skip when not configured.
- 3s `AbortSignal.timeout` — never blocks the V2 response.
- Direct fetch to `sports.bzzoiro.com/api/v2/events/live/` with `Authorization: Token ${BSD_API_TOKEN}`.
- Matches each `_g` against the BSD live events via `teamNameMatch(_bh, _g.home.name)`
  in both orientations (home/away can swap between providers).
- Sets `_g.bsdEventId = String(_bsdMatch.id)` on hit.
- `try/catch(_) {}` wrapping — any BSD outage (5xx, timeout, network) is
  swallowed; game objects ship without bsdEventId.
- All locals `_`-prefixed to avoid scope collisions.

## Commit & deploy

- `e5cddf5` feat(bsd): inject bsdEventId via live event match in handleV2Games (1 file, +35)
- Deploy: workflow 28178751984 — completed/success.

## Done conditions

- [x] `node --check src/index.js` passes
- [x] `grep -c 'bsdEventId' src/index.js` → 3 (declaration in catch-find,
      property set, prop check) — ≥ 1 required
- [x] `BSD event ID enrichment` marker present (1 hit)
- [x] `AbortSignal.timeout(3000)` present (1 hit)
- [x] Diff scope: `src/index.js` only (+35 lines)
- [x] Deploy green (28178751984)
- [x] `/v2/games?sport=wc26` returns 200 with 6 games — BSD live count = 0
      right now, so `bsdEventId` is absent on all games. **This is correct
      behavior.** Two `final` games are already done; four `pre` games kick
      off later today. None are currently in BSD's live pool.

## Probe output

```
GET /v2/games?sport=wc26 → 200, 6 games:
  Czechia 0-3 Mexico (final)         — no bsdEventId (not live)
  South Africa 1-0 South Korea (final)
  Ecuador vs Germany (pre, 20:00 UTC)
  Curaçao vs Ivory Coast (pre, 20:00 UTC)
  Japan vs Sweden (pre, 23:00 UTC)
  Tunisia vs Netherlands (pre, 23:00 UTC)
```

## What activates after the next kickoff

When Ecuador @ Germany (20:00 UTC) goes live:

1. BSD `/api/v2/events/live/` returns an event with `home_team.name = "Ecuador"`
   and `away_team.name = "Germany"` (or the swap).
2. `handleV2Games` matches via `teamNameMatch` and sets `game.bsdEventId`.
3. `buildBSDMomentumContext(env, game)` reads `game.bsdEventId`, fetches
   `/bsd/events/{id}/momentum`, injects `[BSD MOMENTUM]` block in the
   WC journalism prompt (priority 8 in CONTEXT_SOURCES).
4. Client can POST `{event_id: game.bsdEventId}` to
   `/ambient/bsd/subscribe` to receive live ball-position frames via SSE.
5. Post-game shotmap + incidents available via the routes shipped in CC-CMD-A.

The entire dormant BSD stack (CC-CMDs A → D) activates from this one field.

## Failure modes (defensive design)

- BSD token unset → block skipped, ships without bsdEventId.
- BSD API 5xx / timeout / network → caught, ships without bsdEventId.
- Team name mismatch (e.g. "USA" vs "United States") → `teamNameMatch`
  handles normalization; if it still misses, ships without bsdEventId.
- Empty `events[]` → loop runs zero times, ships without bsdEventId.

No scenario where this block blocks or breaks the existing V2 response.
The pipe is now wired end-to-end with zero added risk to non-BSD paths.
