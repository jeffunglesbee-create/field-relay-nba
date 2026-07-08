# CC-CMD: Fix resolveWinProbability's real root cause — sport normalization, function-wide

**Date:** 2026-07-08
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR

## THIS IS NOT THE SAME BUG AS EARLIER TONIGHT'S WP-RESOLUTION FIX

That fix (`01d9bee`/`ead70d1`) made resolution *architecturally* correct
— moved the attempt into `user-do.js`, using the pick's own stored
data. It was verified working via a real E2E test. That verification
was real, but it never checked whether a pick made through the actual
client UI would produce values `resolveWinProbability()` could use.
The `wp-resolution-failures` codex incident firing for real
(`gameId: "g28"`, genuine production data, not a test artifact) proves
it can't, for two independent, now-confirmed reasons.

## BUG 1 — `gameId`, confirmed via tracing

`resolveWinProbability()`'s ESPN-native branch builds its lookup
directly from `gameId`: `.../summary?event=${espnId}`, no name
matching. `g28` is the client's session-local sequential counter
(`g._id = "g" + (++_gid)`) — confirmed by tracing through
`makePick()`, which is called with exactly this value on every real
pick. `.../summary?event=g28` is meaningless to ESPN.

## BUG 2 — `sport`, the actual root cause, function-wide

`resolveWinProbability` lowercases `sport` and checks `s === 'mlb'`
(etc.), and `ARCHIVE_SPORT_TO_ODDS_KEY[s]` for the odds-api branch —
both expect a bare code. **The client's real `sport` value, confirmed
at the source (`sec.sport`, used throughout the file), is never a bare
code in normal use** — it's one of roughly 40 distinct values pulled
directly from the file (`"Baseball (MLB)"`, `"NBA Playoffs"`,
`"Premier League"`, `"baseball"`, `"mlb"` among them — genuinely
messy, not one clean pattern). This means **every branch of this
function has been broken for every sport**, not just MLB/NBA/WNBA —
confirmed by checking `ARCHIVE_SPORT_TO_ODDS_KEY`'s own keys (`nhl`,
`mls`, `epl`, `'la liga'`, etc. — all bare), meaning the odds-api path
covering NHL/MLS/EPL/NFL/CFL/CFB fails identically. Fixing this one
function-wide is the actual highest-leverage fix here, not a
per-branch patch.

## THE FIX FOR BUG 1 ALREADY HAS A WORKING PRECEDENT IN THIS FILE

The odds-api branch never relies on a pre-known ID — it fetches live
games for the sport and matches the right one by team name via
`teamNameMatch()` (already imported/used in this file). The
ESPN-native branch (MLB/NBA/WNBA) is the only one still trying to
construct a direct per-event URL from an ID that, as Bug 1 confirms,
is never usable. The fix is bringing this branch up to the same
pattern the rest of the function already proves works — not inventing
a new mechanism.

## PROBE BLOCK
```bash
sed -n '136,245p' src/wp-resolver.js
grep -n "sport:" ../jubilant-bassoon/index.html | grep -oE "sport:\s*[\"'][^\"']+[\"']" | sort -u
```
If `../jubilant-bassoon` isn't available in this session, use the
confirmed real list embedded above rather than re-deriving it —
building `normalizeSportCode()` against an incomplete guess is worse
than using the one already verified.

## TASK 1 — Build `normalizeSportCode()`, used at the top of the function

Build this against the real, full list of client sport values, not a
handful of assumed cases. It needs to correctly resolve every value
this function has actual logic for (`nba`, `wnba`, `mlb`, `soccer`,
plus every key already in `ARCHIVE_SPORT_TO_ODDS_KEY`) and return
something that safely falls through to `null` for anything it doesn't
recognize — do not guess at codes for sports this function has no real
branch for. Call it once, at the top of `resolveWinProbability`,
replacing the current `String(sport).toLowerCase().trim()`.

## TASK 2 — Bring the ESPN-native branch (MLB/NBA/WNBA) up to the name-matching pattern

Replace the direct `.../summary?event=${espnId}` construction with:
fetch ESPN's scoreboard for the sport/day (confirm the real endpoint
shape rather than assume one — check how the odds-api branch or
elsewhere in this file already fetches comparable live data), find the
matching game via `teamNameMatch(predictedWinner, ...)` against both
home and away, same pattern as the odds-api branch immediately below
it in this same file. Confirm whether `gameId` remains useful as a
secondary/preferred match when it *does* happen to be ESPN-native
(some callers may still provide a real ID) — don't discard it entirely
if there's a real case where it helps, but don't require it either.

## VERIFICATION

- `node --check src/wp-resolver.js`.
- Real, live test: call `resolveWinProbability` with the exact shape a
  real pick actually produces (`sport: "Baseball (MLB)"`, a
  `g`-prefixed sessionlocal-style `gameId`, a real `predictedWinner`
  for a game genuinely live or recently finished right now) — confirm
  it returns a real, non-null result. This is the specific case that
  has never worked; prove it now does, don't assert it.
- Confirm at least one non-MLB case (an odds-api sport, e.g. NHL or
  EPL, with its real client label) also now resolves — Bug 2 was
  function-wide, the proof should be too.
- Confirm a case that legitimately should return `null` (a sport this
  function has no real branch for, e.g. `"Golf"` or `"Tennis"`) still
  returns `null` cleanly, not an error.

## DONE CONDITIONS
- [ ] Probe block confirms real client sport values before building the normalizer
- [ ] `normalizeSportCode()` correctly resolves every sport this function has real logic for
- [ ] ESPN-native branch migrated to name-matching, reusing `teamNameMatch()` not inventing new logic
- [ ] Real live test proves the exact `g28`-shaped failure case now resolves
- [ ] At least one non-MLB odds-api case confirmed also fixed
- [ ] A legitimately-unsupported sport still returns `null` cleanly
- [ ] Outbox explicitly states this fixes the whole function, not just the MLB branch

## CONFIDENCE SCORING TABLE
+25  `normalizeSportCode()` correct against the real, full client value list
+25  ESPN-native branch migrated to real name-matching, verified via a real live test
+15  Confirmed function-wide (at least one non-MLB case also fixed)
+15  Legitimately-unsupported sports still return `null` cleanly
+10  The specific `g28`-shaped scenario proven fixed, not just reasoned about
+10  Outbox correctly scopes this as the real root cause, not a narrow patch

## ONE-LINER
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO -- this CC-CMD targets field-relay-nba"; exit 1; }
git pull. Read docs/CC-CMD-2026-07-08-wp-resolver-sport-normalization.md.
resolveWinProbability() has two confirmed bugs: gameId is the client's
meaningless session-local counter, and sport is never the bare code
every branch of this function expects -- the client always sends
display labels, and this second bug is function-wide, not MLB-specific
(ARCHIVE_SPORT_TO_ODDS_KEY's own keys are equally bare). Build
normalizeSportCode() against the real, full list of client sport
values (embedded in this doc), then migrate the ESPN-native branch to
name-based matching via teamNameMatch(), the same pattern the odds-api
branch in this same file already uses successfully -- do not invent a
new mechanism. Prove via a real live test that the exact g28-shaped
failure now resolves, and that at least one non-MLB sport also now
works. Do not commit unless confidence >= 95. If score < 95, report
verbatim and stop.
