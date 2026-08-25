# CC-CMD-2026-08-25-golf-slate-line

**Filed:** 2026-08-25, from the golf-sport-label work.
**Status:** OPEN. This is the SECOND CC-CMD required by Rule 87 §4 — the first
(`field-laboratory docs/CC-CMD-2026-08-25-golf-sport-label.md`) is closed by the
archive gate, and this covers what that gate deliberately left alone.

## The same defect, one line earlier

`handleJournalismCycle`'s LEAGUES walk calls `buildGameLine(ev, label)` before
it builds `gameMeta`. `buildGameLine` derives its two sides exactly the way the
catch-up did:

```js
const home = teams.find(t => t.homeAway === 'home') || teams[0];
const away = teams.find(t => t.homeAway === 'away') || teams[1];
const homeName = home.team?.shortDisplayName || home.team?.abbreviation || '';
const awayName = away.team?.shortDisplayName || away.team?.abbreviation || '';
```

A golf competitor carries `athlete`, not `team`, so both names resolve to `''`
while `home.score`/`away.score` do not. The golf entry therefore contributes a
slate line with two empty names and two players' scores **into the journalism
prompt**.

The archive gate (`if (gm.individual) continue;`) is deliberately placed at the
catch-up write and NOT at `gameLines.push`, because removing golf from
`gameLines` removes golf from the prompt entirely — see below.

**UNVERIFIED, and it must be probed before anything is written:** the exact
string `buildGameLine` returns for a golf event. The reasoning above is read
from source, not from output. `buildGameLine` returns `null` when
`!home || !away`, and a golf scoreboard has many competitors, so it returns a
line — but what that line reads is not observed.

## And the fix has no caller

`buildGolfCronContext(espnDate, env)` at `src/index.js:6903` builds exactly the
right thing — event name, round, top-10 leaderboard with position, to-par,
today and thru:

```
PGA TOUR — FedEx St. Jude Championship · Round 2:
  1 Scottie Scheffler -11 (today -4) thru 18
  ...
```

**Measured 2026-08-25: `grep -an "buildGolfCronContext" src/index.js` returns
exactly one line — its own definition.** It has never been called. A Rule 63
violation (no dead code / every function has a caller) that has been sitting in
the slate path's own file.

So the shape of the fix is: stop emitting the broken generic line for an
`individual:true` entry, and call the golf-aware builder in its place.

## The ask

1. **Probe first, and record the output.** Do not write from this document.
   ```
   node -e "fetch('https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard')
     .then(r=>r.json()).then(d=>{const c=d.events?.[0]?.competitions?.[0];
     console.log(JSON.stringify({n:(c?.competitors||[]).length,
       first:(c?.competitors||[])[0]},null,1).slice(0,900))})"
   ```
   Then call `buildGameLine` on that event and print the literal string. That
   string is the artifact this task produces (Rule 89) — paste it into the
   outbox entry, whatever it says. If it turns out to be harmless, **say so and
   close this CC-CMD as WITHDRAWN**; the defect is read from source and has not
   been observed.

2. **Gate `gameLines.push` on the same flag**, only if step 1 shows a bad line.
   `individual` is already destructured from the LEAGUES row at that point.

3. **Call `buildGolfCronContext`** where the slate prompt is assembled, so
   removing the generic line does not remove golf. It returns `''` when no
   tournament is live, so an off-week costs nothing. Its Rule 78 exposure is
   already handled — it reuses `handleESPNGolfScoreboard`, the same fetch
   `/v2/golf/enriched` uses.

4. **Guard it.** `scripts/check-individual-sports-not-archived.mjs` already
   parses the LEAGUES table and the three-link chain; extend it, or add a
   sibling, so that (a) an `individual:true` entry cannot reach `gameLines`, and
   (b) `buildGolfCronContext` has a caller. The second assertion is the one that
   matters — it is the Rule 63 check this function needed and never had.

## Done condition

Not "deploy succeeded". A slate prompt captured after deploy, on a day a PGA
tournament is live, that contains the `PGA TOUR — <event> · Round <n>:` block
and contains no line with two empty team names. Paste both the presence and the
absence into the outbox manifest, verbatim.

If no tournament is live in the session, that is not done — say so and schedule
the re-check rather than closing on a green deploy.

## Why this was not folded into the first CC-CMD

The first one is scoped to the archive, its gate is at the archive write, and
its done condition is a D1 count. This needs a live tournament, a captured
prompt, and a decision about a dead function. Rule 87 §4: work that is out of
scope gets a second CC-CMD written before the first closes, rather than a
carry-forward line saying "worth a separate session".
