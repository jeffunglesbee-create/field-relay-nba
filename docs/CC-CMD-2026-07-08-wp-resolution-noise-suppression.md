# CC-CMD: WP-Resolution Incident Tracker — Stop Logging Known-Unsupported Sports

**Date:** 2026-07-08
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR

**Source:** `wp-resolution-failures` (codex, category `incident`) currently
logs every null return from `resolveWinProbability()` identically,
including picks for sports `SPORT_LABEL_MAP` in `src/wp-resolver.js`
explicitly maps to `null` (Golf, Tennis, Rugby, WWE, Formula 1, NCAA
Basketball, EFL/UEFA playoffs, etc.) — sports this resolver permanently
has no data source for, by design, per that map's own comment
("correctly unsupported, not a gap"). The incident's `recent` array
(`user-do.js::_recordWpResolutionFailure`) caps at the 10 most recent
entries. Every unsupported-sport pick silently displaces a slot a genuine
future anomaly (a real MLB/NBA/etc. resolution failure) would otherwise
occupy — the tracker's whole purpose degrades over time as
unsupported-sport picks accumulate.

**Explicitly NOT in scope, and why:** a fully granular per-branch failure
reason (distinguishing "no ESPN scoreboard match in 48h window" vs "match
found but no winprobability[] data" vs "odds API returned no games" etc.
inside `resolveWinProbability`'s several branches) was originally floated
alongside this fix as a single approved item. On inspection it is a
materially larger, riskier change — it requires altering
`resolveWinProbability`'s return contract (currently bare `T|null`) to
carry a reason on every internal null path, which risks any other caller
of this function not visible from this probe alone. That is a separate,
larger task — deliberately scoped out here rather than silently
downgraded or bundled into a change pitched as small and safe.

## PROBE BLOCK

```bash
grep -n "^const SPORT_LABEL_MAP" -A 60 src/wp-resolver.js | grep -c ": *null,"
grep -n "^export async function resolveWinProbability\|^function normalizeSportCode" src/wp-resolver.js
grep -n "_recordWpResolutionFailure" src/user-do.js
```
Confirm: `SPORT_LABEL_MAP`'s exact current shape and null-valued key count
match what this doc describes (re-count, don't trust any number cited
above); `normalizeSportCode`'s exact current lookup logic (exact-match
then paren-extracted-match) is unchanged, since the new helper below must
mirror it exactly; the exact current call site and surrounding
`if (wp) {...} else {...}` block in `user-do.js` matches this doc's
citation before editing.

## TASK 1 — Add `isKnownUnsupportedSport()` to `src/wp-resolver.js`

Export a new, pure, additive-only helper next to `normalizeSportCode`.
Must reuse `SPORT_LABEL_MAP` directly (no duplicated/parallel list) and
mirror `normalizeSportCode`'s exact two-step lookup (exact key, then
paren-extracted key) so the two functions can never silently drift apart
on which raw labels they agree are "known." Returns `true` only when the
raw label matches an EXPLICIT `SPORT_LABEL_MAP` entry whose value is
`null` — must return `false` for labels absent from the map entirely
(the genuinely-unrecognized case, which the map's own existing comment
says should keep surfacing as a failure, unchanged by this fix).

Do not modify `normalizeSportCode` or any branch of `resolveWinProbability`
itself — this task is additive-only.

## TASK 2 — Guard the failure-logging call site in `src/user-do.js`

In the `if (wp) {...} else {...}` branch (NOT the `catch` block below it —
confirm via probe that an unsupported sport can only ever reach the
`else` branch, never `catch`, since `resolveWinProbability` returns
`null` synchronously for unsupported sports rather than throwing), skip
the `_recordWpResolutionFailure` call when
`isKnownUnsupportedSport(pick.sport)` is `true`. Import the new helper
from `wp-resolver.js` alongside the existing `resolveWinProbability`
import.

## VERIFICATION

Real synthetic test (Node, actual extracted committed function source —
`isKnownUnsupportedSport`, not a rewritten copy) covering:
1. `'Golf'` → `true`
2. `'golf'` (lowercase, as the client might send) → `true`
3. `'Baseball (MLB)'` → `false`
4. A genuinely unrecognized label not in the map at all (e.g. a made-up
   string) → `false` — confirms the genuinely-new-label case still
   correctly returns `false` (i.e., still gets logged), unchanged.
5. Structural grep confirming `user-do.js`'s failure branch now calls
   `isKnownUnsupportedSport` before `_recordWpResolutionFailure`, and
   that the `catch` block is untouched.

Deploy confirmed live via `session_health` (`relay_deployed` matches the
shipped commit).

## DONE CONDITIONS

- [ ] Probe block confirms current state before editing
- [ ] `isKnownUnsupportedSport()` added, additive-only, reuses
      `SPORT_LABEL_MAP` directly, mirrors `normalizeSportCode`'s exact
      lookup steps
- [ ] `user-do.js` failure branch guarded; `catch` block unmodified
- [ ] All 4 synthetic test cases pass against real committed source
- [ ] Structural grep confirms integration
- [ ] Deploy confirmed live via session_health
- [ ] Outbox explicitly notes the granular-reason item was scoped out
      and why, so it isn't silently dropped

## CONFIDENCE SCORING

- +25 — `isKnownUnsupportedSport()` correctly mirrors `SPORT_LABEL_MAP`/
  `normalizeSportCode` with zero duplication, additive-only
- +25 — `user-do.js` guard correctly placed in the `else` branch only,
  `catch` block confirmed unreachable for this case and left untouched
- +30 — all 4 synthetic test cases pass against real committed source
  (not rewritten copies)
- +10 — structural integration grep passes
- +10 — deploy confirmed live via session_health

**Do not commit unless confidence >= 95. If score < 95, report verbatim
and stop.**

## Commit

- `src/wp-resolver.js`: `isKnownUnsupportedSport()` added and exported.
- `src/user-do.js`: failure-logging call site guarded.
- Outbox manifest (this CC-CMD's execution writeup).
