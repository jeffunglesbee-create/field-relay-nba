# Claude Code Command — /v2/games says a game is over in two words, and the client reads only one

**Date:** 2026-10-24
**Repo:** field-relay-nba (owns the contract, Rule 60); consumer in jubilant-bassoon
**Branch:** main in each repo. Commit directly; no feature branch, no PR.
**Type:** B (a contract with two values for one state)
**Confidence gate:** >= 95 before any commit
**Status:** FILED, not dispatched. **The direction is the owner's call** (below).
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
