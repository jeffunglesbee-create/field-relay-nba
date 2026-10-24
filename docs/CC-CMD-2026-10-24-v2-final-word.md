# Claude Code Command — /v2/games says a game is over in two words, and the client reads only one

**Date:** 2026-10-24
**Repo:** field-relay-nba (owns the contract, Rule 60); consumer in jubilant-bassoon
**Branch:** main in each repo. Commit directly; no feature branch, no PR.
**Type:** B (a contract with two values for one state)
**Confidence gate:** >= 95 before any commit
**Status:** PARTIAL. TASK 0 done 2026-10-24 (workflow wf_4d87d314-9a8, each premise re-run by a refuter). **The direction is the owner's call** (below).
**Filed by:** the map and review of TASK 1 of
`docs/CC-CMD-2026-10-22-nba-cdn-403-in-season.md` (workflows wf_c5379dd3-9f6
and wf_b338e9b9-f0d), Rule 87.4.

---

## What was measured

**The relay's words for a finished game, by adapter** (src/index.js):

| adapter | sports | finished |
|---|---|---|
| `adaptESPNWCSoccer` | wc26 and the club soccer leagues | `'final'` |
| `adaptNhle` | NHL | `'final'` |
| `adaptESPNBasketball` | NBA (since 2026-10-24) | `'final'`, by a `sportKey === 'nba'` case |
| `adaptESPNBasketball` | WNBA, AFL | `'post'` |
| `adaptESPNMLB` | MLB | `'post'` |
| `adaptESPNFootball` | NFL, CFB | `'post'` |

**The client reads only one** (jubilant-bassoon `src/legacy/field.js`,
`mapV2ToESPN`):
`const state = fg.state==='final' ? 'post' : isActuallyLive ? 'in' : 'pre';`
Here `isActuallyLive` is true when `fg.state !== 'final'`, `periodNum > 0` and
a score is above 0.

The map extracted that function and ran it (2026-10-24):
- the relay's live MLB final for 2026-10-23 (`state 'post'`, periodNum 9,
  3-2) came out as `'in'`;
- the same object with `state 'final'` came out as `'post'`.

`refreshMLBStatus` overwrites MLB's state to `'post'` later
(`outbox/cc-mlb-stuck-inn9-never-final-2026-07-12.md`). Nothing does that for
WNBA, NFL, AFL or CFB.

**The NBA case is the workaround, not the fix.** NBA keeps `'final'` so that
moving its board off the CDN would not show every NBA final as live. It goes
when this CC-CMD lands.

## TASK 0 — premises, one command each (Rule 100)

1. **The misreading reaches the screen for each `'post'` sport.** For WNBA,
   NFL, AFL and CFB, read `FIELD_V2_SOURCES` and whether that sport's cards
   come from `fetchV2AllScores`. A sport not fed by V2 refutes it for that
   sport.
2. **Nothing reads `'post'` from /v2/games and would break on `'final'`.**
   Grep both repos for `=== 'post'` and `state === 'post'` against V2 game
   objects (AmbientDO and GameDO already accept both). A reader that requires
   `'post'` refutes option (a) as a one-file change.

## TASK 0 — results (2026-10-24)

**Premise 1 CONFIRMED for all five `'post'` sports.** The real
`mapV2ToESPN`, extracted and run on real relay finals, and each sport's card
read path:

| sport | relay finals run | client state | what else writes the card |
|---|---|---|---|
| WNBA | 5 (2026-09-20) | `'in'` ×5 | nothing; V2 is the only source |
| NFL | 12 (2026-10-18) | `'in'` ×12 | ESPN writes `'post'` every 15 min once all games are final; the 30 s V2 poll overwrites it within about 30 s |
| CFB | 4 visible (2026-10-17) | `'in'` ×4 | ESPN polls CFB once, at bootstrap, then never again |
| AFL | 1 (the 2026-09-26 Grand Final) | `'in'` | Squiggle's `'post'` goes only to the legacy store, which the card does not read |
| MLB | 1 (2026-10-23) | `'in'` | `refreshMLBStatus` sets `'post'` every 90 s; the V2 poll overwrites it within about 30 s |

The same objects with `state: 'final'` come out `'post'`. So a finished NFL,
CFB, WNBA, AFL or MLB game shows as live for most of the time, and `anyLive`
keeps the poll at 30 s. NFL and CFB are in season now.

**Premise 2 REFUTED for option (a) as a one-file change.**
- `scripts/score-fill.mjs` keeps only `state === 'post'` games from
  `/v2/games`. It runs on a live cron, `score-fill.yml` at
  `50 3,7,11,15,19,23 * * *`, with 5 green runs. Under (a) it would score
  nothing.
- `scripts/mlb-failover-verify.mjs` goes red on `'final'` (dispatch only).
- Four adapters test `state === 'post'` for their `'F'` label: football, ESPN
  MLB, the MLB statsapi secondary and the WNBA secondary. The table above also
  lacked two adapters that emit `'post'`: `adaptMlbStatsApi` and the WNBA
  secondary (`adaptWnbaCDN`).
- No relay runtime reader requires `'post'`: AmbientDO and GameDO accept
  both, and the WC writer is gated to soccer.

**Option (b) is two client lines, not one.** `mapV2ToESPN` reads only
`'final'`, and so does `fetchV2AllScores`' stale-final guard. Changing only the
first leaves the guard never engaging for `'post'` sports.

## The decision (owner)

- **(a) The relay says `'final'` everywhere.** The `'post'` adapters change, and
  so does every relay reader that requires `'post'` (premise 2). This follows
  Rule 60: the relay owns the word. No client change, and the NBA case goes.
- **(b) The client reads both.** One line in `mapV2ToESPN`, plus a SW bump and
  smoke. The relay keeps two words, and the NBA case can go. Rule 64 would call
  this a client-side compensation.

## Done condition (Rule 90 artifacts)

1. TASK 0's two outputs committed.
2. One word for a finished game on every V2 board, or a client reading that
   accepts both, chosen by the owner. In either case, `mapV2ToESPN` run on
   each adapter's real final returns `'post'`, with a check that goes red
   when the misreading is restored.
3. The `sportKey === 'nba'` case is removed, and
   `scripts/check-v2-games-nba-board.mjs` N1/N7 are changed to the chosen word.
