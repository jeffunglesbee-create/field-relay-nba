# ESPN WC Switch — 2026-06-25

## The story

`wc26` now sources from ESPN `fifa.world` scoreboard instead of API-Sports Football Pro
(league_id=1, season=2026). All downstream consumers preserved: BSD enrichment,
WP computation, GameDO crunch, BracketDO push, writeWCResult D1 writes.

Two specific gaps closed alongside:
- **Gap A** — `eventsContext` in WC post-match briefs now reads ESPN `/summary keyEvents`
  instead of API-Sports `/fixtures/events` (goals + yellow/red cards with displayClock + text).
- **Gap B** — `computeLiveWP` `elapsed=0` fixed: `situation.elapsed` derived from ESPN
  `status.clock` (seconds → minutes).

API-Sports renewal (June 29) is no longer required for WC coverage. `APISPORTS_KEY` still
needed for NBA, NHL, MLB, WNBA, EPL, MLS.

## Commit

- `aba0551` feat(wc26): switch v2/games from API-Sports to ESPN scoreboard
- Deploy: workflow 28210163226 — step 6 (Deploy to Cloudflare Workers) success at 00:56:20Z

## Tasks executed

**TASK 1** — `V2_LEAGUES['wc26']` gained `espnLeague: 'fifa.world'` flag at L1014.

**TASK 2** — `adaptESPNWCSoccer(ev)` added after `adaptFootball()` at L1407. Produces
the same game shape: `id: 'espn:{ev.id}'`, `espnEventId`, full `situation` block for live
games with elapsed from `status.clock / 60`, isStoppage from `displayClock.includes('+')`.

**TASK 3** — `handleV2Games` ESPN early-return inserted at L2878, before APISPORTS_KEY
gate, after tennis branch. Identical downstream pipeline: BSD `bsdEventId` enrichment,
`computeLiveWP` with pregame lambdas from Odds API, crunch detection, GameDO push,
writeWCResult D1 write. Response: `source: 'espn-wc'`, `Cache-Control: max-age=15`.

**TASK 4** — `writeWCResult` eventsContext block at L1842 swapped to ESPN
`/summary?event={espnEventId}` reading `keyEvents[].type.type` (goal, yellow-card,
red-card). Falls back to stripping `espn:` or `football:` prefix from `game.id` when
`espnEventId` is absent (defensive — should always be present for new espn-prefixed IDs).

## Done conditions

- [x] `node --check src/index.js` clean
- [x] `grep adaptESPNWCSoccer`: 2 (function def + call site)
- [x] `grep espnLeague: 'fifa.world'`: 1 (cfg)
- [x] `grep espn-wc`: 1 (response source)
- [x] `grep keyEvents`: 2 (ESPN summary parser)
- [x] No remaining `fixtures/events` fetch in writeWCResult — only 3 proxy-allowlist
      comments at L458/481/508 + 1 new comment at L1899 referencing the replacement
- [x] Bundle verified via `workers_get_worker_code`: adaptESPNWCSoccer=3,
      espnLeague=13, espn-wc=1, keyEvents=1, /fixtures/events=2 (proxy-allowlist only)
- [x] Live `/v2/games?sport=wc26&date=2026-06-26`: returns 6 games with
      `source: "espn-wc"`, `id: "espn:760475"` etc., `espnEventId` populated
- [x] Sample game: Norway vs France 2026-06-26T19:00Z at Gillette Stadium,
      `state: "pre"`, `situation: null` (correct — adapter returns null situation for
      non-live states)

## /deploy/verify note

`/deploy/verify match=false` at 00:56:46Z (26s post-deploy-step). This is CF edge
propagation lag — `/v2/games?sport=wc26` already returns the new bundle's response
shape (`source: "espn-wc"`, espn: prefix IDs), which is conclusive proof of
deployment. Per golf outbox process fix: `workers_get_worker_code` grep is the
authoritative bundle verification, not `/deploy/verify`.

## Activation gates (natural runtime)

- **Live game state**: situation.elapsed/isStoppage will populate when a wc26 game
  goes live (next: 2026-06-26T19:00Z Norway@France, Senegal@Iraq). Verify by curl
  `/v2/games?sport=wc26&date=2026-06-26` during the match — expect `situation.elapsed`
  to match `displayClock` minute (after dividing seconds by 60).
- **Game-final**: writeWCResult fires for `state === 'final'` games. Will write
  D1 row with `game_id: 'espn:{ev.id}'` (vs old `football:{fix.id}` for pre-switch
  rows). Mixed game_id space is fine — wc_results queried by team+date, not game_id.
- **eventsContext**: post-match brief (next journalism cron at xx:15/30/45/00) will
  read ESPN `/summary keyEvents` for the new espn-prefixed games. Verify by checking
  the journalism brief text contains goal/card lines with displayClock minutes.

## Scope boundary maintained

- Only `src/index.js` touched. One commit.
- Did NOT touch `src/bracket-do.js`, `src/wc-tournament-projections.js`,
  `src/context-assembler.js`, or jubilant-bassoon.
- Did NOT modify BSD enrichment logic — copied the football-branch BSD block
  verbatim into the ESPN early-return so downstream BSD R2/D1 flow is identical.
- Did NOT modify writeWCResult D1 logic — only the `eventsContext` fetch block.
- Did NOT add new env bindings.

## Compliance

- **Rule 47**: ESPN adapter is arithmetic (score normalize, clock/60, displayClock
  parse). No editorial computation.
- **Rule 60/61**: Game shape matches `adaptFootball` exactly — all downstream
  consumers continue to work without client-side changes.
- **Rule 69**: Only requested files/functions touched.
- **Rule 77**: Bundle verified via workers_get_worker_code (not just /deploy/verify).
- **Rule 80**: No credentials in agent context. ESPN endpoints are public.
