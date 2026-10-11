# CC-CMD-2026-08-25-golf-slate-line

**Filed:** 2026-08-25, from the golf-sport-label work.
**Status:** DONE 2026-10-11, with the done condition **met in part** and the
remainder stated rather than closed on a green deploy — per this document's own
instruction. Session doc:
`outbox/cc-session-2026-10-11-golf-slate-line.md`.

**ASK 1 — VERDICT: SHIPS.** Measured on the live feed, run `38142889937`
(`outbox/golf-slate-line-probe-latest.json`):

```
LINE: '-15 @ -16 · Final · Golf Chnl'
```

Baycurrent Classic, 1 event, **72 competitors**, every one carrying `athlete`
and no `team` — and **`homeAway` null on all of them**, which this document did
not predict. So the fallback does not fail to find a home side; it takes the
leaderboard's **top two players** and tells the model an away side scored -15 at
a home side scoring -16. Controls on the same date, through the same function:
`Eagles (2-2) 0 @ Jaguars (3-1) 0 · Scheduled · …` and
`Mavericks (1-1) 132 @ Rockets (1-1) 115 · Final · …`.

**ASK 2 — THE GATE IS NOT AT `gameLines.push`, DELIBERATELY.** `gameMeta.push`
is in the same block and its own comment calls it *"Parallel to gameLines"*; the
odds step builds `new Array(gameLines.length)` and indexes one by the other's
position. A push-only gate would have desynchronised them and mis-attributed
every odds annotation after the golf entry — a worse defect, invisible until a
golf day with odds. `if (individual) continue;` sits at the top of the loop,
which also saves one ESPN call per tick.

**ASK 3 — ITS PREMISE IS REFUTED.** This document reads
`buildGolfCronContext`'s single grep hit as "never called" and concludes golf
would vanish from the prompt. **Golf was always in the prompt.** `buildPrompt`
has carried a `golfContext` slot all along, fed by **twenty lines of that
function's body, copied inline**. The Rule 63 defect was duplication, not a
missing feature, so the copy is deleted and the call takes its place — one
definition, one caller, one fetch, with an optional `preFetched` argument so the
slate path does not pay for a second request.

**ASK 4 — guards extended in
`scripts/check-individual-sports-not-archived.mjs`: 11 self-tests, 9 live
assertions, blocking in `deploy.yml`.** One of them, `beforeFetch`, **passed its
own mutation when first written** — it searched the whole file for a later fetch
and a second LEAGUES walk always supplied one. Now scoped to the loop head's
window, and the mutation is caught.

**DONE CONDITION — the prompt has no read path, and that was read rather than
assumed:** `/journalism/game-lines` returns per-game *brief* first sentences,
`/journalism/context-probe` carries its own five-league list with no golf in it,
and none of the four `/debug/*` routes touches `buildPrompt`. Exposing one would
publish `FIELD_VOICE_REGISTER` and `JQ_STYLE` unauthenticated, or require
extracting the slate walk out of `handleJournalismCycle`, which fires every 15
minutes and is covered by the structural-change guardrail.

**That is a decision for the owner, not a schedule.** A cron re-check would fire
against a surface that does not exist. What is proven: the measured line, the
gate in deployed source under 9 assertions, the duplication removed, and the
golf block's inputs read from the **deployed** `/v2/golf/enriched`. What is not:
the prompt string itself. Re-dispatch `golf-slate-line-probe.yml` on any golf
day to refresh the measured half.

**SECOND CC-CMD FILED (Rule 87.4):** `buildGameLine` has **two** callers and
this document discusses one. `src/index.js:9383` iterates
`for (const {sport, league, label} of LEAGUES)` — no `individual` in scope, no
downstream guard. Read from source and **not yet probed**, which is the state
this document's own headline claim was in until today. See
`docs/CC-CMD-2026-10-11-golf-reaches-the-per-game-enqueue-too.md`.

---

This is the SECOND CC-CMD required by Rule 87 §4 — the first
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

`buildGolfCronContext(espnDate, env)` — `src/index.js`, `async function buildGolfCronContext` builds exactly the
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
