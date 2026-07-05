# CC-CMD: Pick 'em backend — cumulative, non-resetting ledger (no streaks)

**Date:** 2026-07-05
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main
**Scope:** `src/user-do.js` only. Backend data mechanism first — no client UI in this CC-CMD.

**Why this design, specifically:** Rule 33's own ethos audit left streak
gamification explicitly unresolved ("HOLD until decided") for a related
feature, distinguishing "streak as honest signal of consistent use" from
"streak as engagement mechanic." The structural fix agreed on: a ledger
that never resets removes the mechanism causing the problem (loss-
aversion from a breakable chain), not just the label. Concretely: no
consecutive-day tracking anywhere in this design. Milestones are tied
only to cumulative volume/accuracy (e.g. "100 picks made," "62% lifetime
accuracy"), never to consecutive participation.

**Real, existing infrastructure this builds on** — confirmed directly,
not assumed: `UserDO` (`src/user-do.js`) already exists, keyed by
`userId`, with `/user/init`, `/user/state`, `/user/event` routes.
`watchHistory` explicitly purges to a rolling 30 days — wrong pattern
for this feature, which must never purge. This CC-CMD adds a genuinely
new, separate field rather than reusing that one.

**Target time:** ~35 min

## CONFIDENCE GATE
Do not commit unless confidence ≥ 95.

## PROBE BLOCK
```bash
sed -n '1,120p' src/user-do.js
grep -n "_handleEvent" src/user-do.js
```
Re-confirm the current UserDO structure and event-handling pattern
before adding to it.

## TASK 1 — Add a pickLedger field, seeded alongside existing fields

In `_handleInit`, add `pickLedger` to the first-visit seed:
```javascript
await this.state.storage.put('pickLedger', { picks: [], totalMade: 0, totalCorrect: 0 });
```
`picks` is a permanent, append-only array — never pruned, never reset,
regardless of age or outcome. This is a deliberate deviation from
`watchHistory`'s rolling-purge pattern, not an oversight — confirm this
distinction is preserved, don't default to the existing purge pattern
out of habit.

## TASK 2 — Extend _handleEvent for two new event types

`pick_made`: `{ gameId, sport, predictedWinner, timestamp }` — append to
`picks`, increment `totalMade`. Do not compute or store anything
resembling a consecutive streak at this or any layer.

`pick_resolved`: `{ gameId, wasCorrect, revealedProbability,
probabilitySource }` — find the matching pick by `gameId`, mark it
resolved, increment `totalCorrect` if correct. Store `revealedProbability`
and `probabilitySource` on the resolved pick itself — this is for the
reveal UI to later show what the real number was and where it came
from, honoring the source-specific labeling requirement (never a bare
"win probability" — the source field lets the display layer apply
"Market estimate" or "Statistical probability" correctly later; this
CC-CMD does not build that display logic, only stores what it needs).

## TASK 3 — Expose cumulative stats via /user/state

Add to `_handleState`'s response: `pickLedger.totalMade`,
`pickLedger.totalCorrect`, and a computed `accuracyRate` — cumulative
only, never a rolling window, never a "current streak" field of any
kind.

## TASK 4 — Verify real behavior

Via a real test sequence against a live UserDO instance (init → several
pick_made/pick_resolved events → state check): confirm cumulative counts
are correct, confirm nothing resets between calls, confirm no
streak-like field exists anywhere in the response shape.

## SCOPE BOUNDARY

DO:
- Add pickLedger as a genuinely permanent, non-purging field
- Track only cumulative totals (made, correct, accuracy)
- Store the probability source per resolved pick for later correct labeling

DO NOT:
- Add any consecutive-day, streak, or "current run" field anywhere
- Reuse watchHistory's purge pattern for this data
- Build client UI or reveal-timing logic — backend data mechanism only, this is a first slice

## DONE CONDITIONS
- [ ] Probe block re-run, current UserDO structure confirmed
- [ ] pickLedger added, permanent/non-purging confirmed
- [ ] pick_made and pick_resolved event types implemented correctly
- [ ] /user/state exposes cumulative stats only, no streak field
- [ ] Real live test sequence verified, not just code review
- [ ] Outbox manifest written

## CONFIDENCE SCORING TABLE
+25  pickLedger correctly added as permanent, non-purging
+30  Both event types correctly implemented, no streak logic anywhere
+20  /user/state correctly exposes cumulative-only stats
+25  Real live test sequence verified against an actual UserDO instance

## ONE-LINER
git pull. Read docs/CC-CMD-2026-07-05-pick-ledger-backend.md. Add a
pickLedger field to UserDO (src/user-do.js) — permanent, append-only,
never purged, unlike watchHistory's rolling-30-day pattern. Extend
_handleEvent for pick_made and pick_resolved events, tracking only
cumulative totalMade/totalCorrect/accuracyRate. Do not add any
consecutive-day or streak field anywhere -- this is deliberate, per
Rule 33's unresolved gamification question, resolved here by removing
the resettable-chain mechanism entirely, not renaming it. Store
probability source per resolved pick for later correct labeling. Verify
against a real live UserDO test sequence. Do not commit unless
confidence ≥ 95. If score < 95 report verbatim and stop.
