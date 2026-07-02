# Claude Code Command — Wire Probable Starter into Savant Context

**Branch:** main — commit directly, do not create a feature branch or PR.

git pull. Read CLAUDE.md.

Write findings to outbox/cc-savant-probable-starter-2026-07-02.md.

## CONTEXT

`buildSavantContext()` (`src/context-assembler.js` line 137) is a real,
live builder — registered in `assembleContext`'s pipeline
(`{ id: 'savant', priority: 7, budget: 400, builder: buildSavantContext,
sports: ['mlb'] }`, `context-assembler.js` line ~992) and runs for every
MLB game. Confirmed NOT dead code — this was checked directly before
writing this doc, not assumed from the function's existence alone.

**The real gap, verified 2026-07-02, not theoretical:** `buildSavantContext`
picks pitchers by team, not by identity:
```js
const teamPitchers = Object.entries(arsenals.data)
    .filter(([_, v]) => _abbr(v.team) === abbr && v.pitches?.length)
    .map(([name, v]) => { const best = ...top whiff rate... })
```
It surfaces the top-2-by-whiff-rate pitcher **for the whole team roster**
— which may not even be pitching tonight (could be a reliever, could be
a starter who isn't in today's game). Meanwhile, `src/index.js` (~line
4114) already computes the actual confirmed probable starter, per team,
from ESPN's own feed:
```js
const prob = team.probables?.[0];
const ath = prob?.athlete;
probables.push(`${ath.displayName} (${teamAbbr}, ...)`);
```
`ath.displayName` is a real, specific, ESPN-sourced name (e.g., "Kevin
Gausman") — exactly what `resolveEntity('player', name)` (shipped
2026-07-02, `identity-resolver.js`) needs as input to look up that
specific pitcher's real arsenal, instead of team-wide approximation.

**These two functions do not currently talk to each other.** Checked
all 4 real `assembleContext` call sites in `index.js` (~4927, ~6138,
~8804, ~9967) — **none of their `game` objects include a probable-pitcher
field.** The probables computation and the `assembleContext` calls are
in different functions entirely.

**Most likely real target, not yet confirmed — Task 1's job:** the
call site near line ~8804 builds `gamePrompt` starting with `Write a
50-70 word game brief for this ${sportLabel}... game` — this looks
like live single-game journalism, not the backfill path (~4927, R2
sport context for backfill), the multi-game batch (~6138), or the
debug/test endpoint (~9967). **Do not assume this without confirming**
— trace whether the function containing the probables computation
(~4114) and this call site's function are the same function, called
from the same place, with access to the same `team`/`game` variables,
before wiring anything.

## PRE-BUILD PROBE (Rule 87)

```bash
sed -n '4090,4135p' src/index.js   # confirm probables computation, current line numbers
sed -n '8760,8820p' src/index.js   # confirm the ~8804 assembleContext call site and its enclosing function
grep -n 'async function\|function ' src/index.js | awk -F: '$1 <= 8804' | tail -5   # find the enclosing function name for the ~8804 call site
```

Confirm the probables computation and the candidate `assembleContext`
call site are reachable from the same function scope (or can be passed
through without excessive plumbing) before writing any wiring code. If
they're in genuinely separate, hard-to-connect scopes, report that
honestly in the outbox manifest rather than forcing a fragile connection.

## TASK 1: Thread the probable starter's name into the `game` object

At the confirmed call site (likely ~8804, confirm via probe above), add
the probable starter's name(s) to the object passed to `assembleContext`,
e.g.:
```js
sportContext = await assembleContext(env, {
    sport: sportLabel, home: game.home, away: game.away,
    homeAbbr: '', awayAbbr: '',
    sourceId: game.espn_event_id || null,
    league: game.league || null,
    espnLeague: game.espn_league || null,
    probableHome: <home team's probable starter displayName, if available here>,
    probableAway: <away team's probable starter displayName, if available here>,
}, 600);
```
If the probables data genuinely isn't available at this call site (e.g.
it's computed from a different ESPN payload not fetched here), report
that as a real blocker in the outbox manifest — do not fabricate a
second, redundant ESPN fetch without confirming budget/caching impact
first.

## TASK 2: Use the probable starter in `buildSavantContext`

In `context-assembler.js`, update `buildSavantContext(env, game)` to
check `game.probableHome`/`game.probableAway` first:
```js
if (arsenals?.data) {
    for (const [probableName, abbr] of [[game.probableHome, ha], [game.probableAway, aa]]) {
        if (probableName) {
            const key = resolveEntity('player', probableName);
            const entry = Object.entries(arsenals.data)
                .find(([name, v]) => resolveEntity('player', name) === key && _abbr(v.team) === abbr);
            if (entry) {
                // use entry directly -- confirmed starter's real arsenal
                continue;
            }
        }
        // fall back to existing team-wide top-2-by-whiff-rate logic
        // for any team where a probable starter wasn't available or
        // didn't resolve to a real Savant entry
    }
}
```
Requires importing `resolveEntity` from `./identity-resolver.js` in
`context-assembler.js` — confirm this import doesn't already exist
under a different name before adding a duplicate.

**Keep the existing team-wide fallback.** ESPN's probable-pitcher feed
is explicitly noted in the existing code comment as "populated
inconsistently" — the confirmed-starter path is better when available,
not a replacement for the fallback when it isn't.

## TASK 3: Verification

```bash
node -c src/context-assembler.js
node -c src/index.js
```
Cannot fully verify end-to-end from the CC sandbox without a live game
that has both a real ESPN probable-pitcher entry and real
`pitch_arsenals.json` data for that specific pitcher. Done condition:
syntax valid, and a dry-run test using one of the 5 real players
already resolved this session (e.g. `resolveEntity('player', 'Kevin
Gausman')` → `gausman`, confirmed live in `pitch_arsenals.json` earlier
today) actually finds a matching `arsenals.data` entry when run as an
inline test — prove the lookup mechanism works against real data before
relying on a live game to prove it.

**Chat-side follow-up (not checkable by CC):** confirm against a real
live/recent MLB game journalism output that the Savant context now
names the actual confirmed starter's specific pitch mix rather than a
team-wide approximation.

## TASK 4: Outbox manifest (last task)

State explicitly: which `assembleContext` call site was actually wired
(with confirmation it's the right one, not just the guessed one), and
whether Task 1's plumbing required any new data fetch or was available
from data already in scope.
