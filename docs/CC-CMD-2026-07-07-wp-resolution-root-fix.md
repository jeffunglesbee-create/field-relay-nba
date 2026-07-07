# CC-CMD: Fix win-probability resolution — it has never fired for real traffic

**Date:** 2026-07-07
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR

## THIS IS NOT AN EXTENSION OF `wp-resolution-failure-tracking.md`

That CC-CMD (executed, `66f0abd`) correctly tracks failures *within* the
relay's WP-resolution attempt block in `src/index.js`. This CC-CMD found
something more fundamental while investigating a separate, unrelated
discrepancy: **that attempt block has never executed for any real pick
resolution, ever.** Not "sometimes fails" — structurally unreachable.

**Traced precisely, not assumed:**
- The client's *only* `pick_resolved` call site sends exactly
  `{ type: 'pick_resolved', gameId, wasCorrect }` — confirmed via grep,
  one call site, `index.html:27915`. No `sport`, no `predictedWinner`.
- `_userDoRelay()` (the function that sends it) is a thin pass-through
  — confirmed by reading its full body — it injects no additional
  fields.
- The relay's fallback WP-resolution attempt
  (`src/index.js:~6867`) is gated on
  `evtBody.sport && evtBody.predictedWinner` — fields the real payload
  never contains. This condition can never be true for real traffic,
  so `resolveWinProbability()` is never called, `resolvedWP` stays
  null, and the response always falls through to the raw, WP-less
  `doResp`.
- **The data does exist — just not where the relay is looking for it.**
  `UserDO`'s `pickLedger` already stores `sport`/`predictedWinner` from
  the original `pick_made` event (`src/user-do.js:~210`:
  `pl.picks.push({ gameId, sport, predictedWinner, ... })`). When
  `pick_resolved` arrives, the DO looks up that exact record by
  `gameId` (`pl.picks.find(p => p.gameId === gameId && !p.resolved)`)
  — `pick.sport`/`pick.predictedWinner` are right there, already
  available, and currently unused for WP resolution.

**The correct fix moves the resolution attempt into the DO, where the
needed data already lives — not asking the client to redundantly
resend fields it already sent once, and not asking `src/index.js` to
guess at fields it was never going to have.**

## PROBE BLOCK
```bash
grep -n "'pick_resolved'" ../jubilant-bassoon/index.html
sed -n '6860,6895p' src/index.js
sed -n '205,236p' src/user-do.js
```
If `../jubilant-bassoon` isn't available in this session, use the
citations embedded above verbatim instead of attempting cross-repo
access — confirm they still match field-relay-nba's own two files
listed, which is all this CC-CMD actually needs to edit.

## TASK — Move WP resolution into the DO's own pick_resolved handler

**In `src/user-do.js`**, inside the `pick_resolved` handler, after the
existing `pick` lookup (`const pick = pl.picks.find(...)`) and before
setting `pick.resolved = true`, add: if `revealedProbability` wasn't
already provided in the incoming body, attempt resolution using the
pick's own stored `sport`/`predictedWinner`:
```javascript
let finalProbability = revealedProbability;
let finalSource = probabilitySource;
if (finalProbability == null && pick.sport && pick.predictedWinner && typeof resolveWinProbability === 'function') {
    try {
        const wp = await resolveWinProbability(pick.sport, { gameId: pick.gameId, predictedWinner: pick.predictedWinner }, this.env);
        if (wp) { finalProbability = wp.probability; finalSource = wp.source; }
    } catch (_) { /* non-fatal — pick still resolves without WP, same fallback as before */ }
}
pick.revealedProbability = finalProbability ?? null;
pick.probabilitySource = finalSource || null;
```
Confirm whether `resolveWinProbability()` is reachable from
`user-do.js`'s scope (it currently lives in `src/index.js`) — if not
already exported/importable, that's a real, necessary prerequisite
change, not something to work around with a duplicate copy of the
function. Confirm the DO has access to `env` (check existing patterns
in this file for how other DO methods reach bindings) before assuming
`this.env` is correct — do not guess at the DO's own internal API.

**In `src/index.js`**, the now-redundant fallback attempt (the block
gated on `evtBody.sport && evtBody.predictedWinner`, which this
CC-CMD's own investigation proved unreachable) can be removed — it
never fired and the real fix now lives in the DO. Confirm nothing else
depends on this exact block before removing it.

## VERIFICATION

- `node --check src/index.js src/user-do.js`.
- **This is the one that matters most: a real, live, end-to-end test.**
  Make a real pick via the actual client flow (or a synthetic
  equivalent that exercises the exact same code path), let it resolve,
  and confirm a real `resolvedProbability`/`probabilityLabel` actually
  comes back — report the real returned value, not a hypothetical. This
  has never worked before; do not report success without having
  actually observed it working once, live.
- Confirm existing resolved picks already in the `pickLedger` (which
  have `resolvedProbability: null` from before this fix) are not
  retroactively broken or need migration — they should simply continue
  showing no probability, which is honest given none was ever
  computed for them.
- Re-verify `wp-resolution-failure-tracking.md`'s tracking still works
  correctly now that the code path it instruments has moved — if the
  tracked failure branches moved into `user-do.js`, the tracking call
  needs to move with them, not be silently orphaned in the now-removed
  `src/index.js` block.

## DONE CONDITIONS
- [ ] Probe block confirms all three citations before editing
- [ ] WP resolution attempted in `user-do.js`, using the pick's own stored sport/predictedWinner
- [ ] `resolveWinProbability()` reachability from `user-do.js` confirmed or fixed as a real prerequisite
- [ ] Redundant, unreachable block in `src/index.js` removed, confirmed nothing else depended on it
- [ ] Real, live, end-to-end test confirms a probability actually comes back — first time ever, not assumed
- [ ] Existing already-resolved picks confirmed unaffected, not retroactively broken
- [ ] `wp-resolution-failure-tracking.md`'s tracking calls moved with the code they instrument, not orphaned
- [ ] Outbox explicitly states this fixes a feature that has never worked, not a partial-failure-rate improvement

## CONFIDENCE SCORING TABLE
+25  WP resolution correctly moved into user-do.js using the pick's own stored data
+15  resolveWinProbability() reachability correctly confirmed or fixed
+15  Redundant src/index.js block correctly removed, nothing broken
+25  Real live end-to-end test confirms a probability actually returns
+10  Existing resolved picks confirmed unaffected
+10  Failure tracking calls correctly moved, not orphaned

## ONE-LINER
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO -- this CC-CMD targets field-relay-nba"; exit 1; }
git pull. Read docs/CC-CMD-2026-07-07-wp-resolution-root-fix.md. This is
not an extension of wp-resolution-failure-tracking.md -- it fixes the
actual root cause found while investigating a separate discrepancy:
win-probability resolution has never fired for any real pick, ever,
because the relay checks evtBody.sport/predictedWinner, fields the
client never sends. The real fix moves resolution into user-do.js's
pick_resolved handler, using the pick's own already-stored sport/
predictedWinner from the earlier pick_made event. Remove the now-
redundant, unreachable block in src/index.js. The verification that
matters most: a real, live, end-to-end test proving a probability
actually comes back for the first time -- do not report success without
having actually observed it. Do not commit unless confidence >= 95. If
score < 95, report verbatim and stop.
