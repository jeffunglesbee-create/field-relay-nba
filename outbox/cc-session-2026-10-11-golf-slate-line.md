# CC session — a golf event reached the journalism prompt as "-15 @ -16"

**Date:** 2026-10-11
**Repo:** field-relay-nba, branch `main` — direct commits, no PR
**CC-CMD:** `docs/CC-CMD-2026-08-25-golf-slate-line.md`

## Ask 1 — the artifact, and the verdict is SHIPS

That document is explicit that its reasoning is read from source, has never been
observed, and closes as **WITHDRAWN** if the line turns out harmless. It does
not. Measured on the live ESPN feed, run `38142889937`
(`outbox/golf-slate-line-probe-latest.json`):

```
LINE: '-15 @ -16 · Final · Golf Chnl'
```

The surrounding measurement, which makes it readable:

```
eventName           'Baycurrent Classic'
events              1
competitors         72
firstHasTeam        False
firstHasAthlete     True
firstHomeAway       None
firstScore          '-16'
firstAthleteName    'Michael Brennan'
statusDescription   'Final'
```

**`homeAway` is null on all 72 competitors**, which the document did not
predict. So `teams.find(t => t.homeAway === 'home') || teams[0]` does not fail
to find a home side — it silently takes the **leaderboard's top two players**
and presents them to the model as an away side scoring -15 at a home side
scoring -16.

**The controls run through the same function on the same date**, which is what
separates a golf problem from a formatter problem:

```
NFL   'Eagles (2-2) 0 @ Jaguars (3-1) 0 · Scheduled · Tottenham Hotspur Stadium · NFL Net · NFL London Games · JAX: Trevor Lawrence 72/104, 843 YDS, 8 TD, 2…'
NBA   'Mavericks (1-1) 132 @ Rockets (1-1) 115 · Final · Venetian Arena [indoor] · NBA TV · NBA China Game · HOU: Marcus Smart 20 Pts, Jabari Smith Jr. 9 Re…'
```

**The probe runs the real function, not a copy.** `buildGameLine` is not
exported, and pasting it into the probe would have made this a test of the
copy. The function text is sliced out of `src/index.js` by brace balance and
evaluated with no closure, so a free identifier would throw — the
standalone-ness is checked, not assumed. 9 self-tests on the slicer; one
expectation was wrong when written (5 lines where the slice is 4) and the
self-test caught it.

## Ask 2 — the gate is NOT where the document asked, and that matters

It asks to gate `gameLines.push`. `gameMeta.push` sits in the same `if (line)`
block, and `gameMeta`'s own comment calls it *"Parallel to gameLines"* — the
odds-injection step builds `new Array(gameLines.length)` and indexes one array
by the other's position.

**A push-only gate would have desynchronised them and mis-attributed every odds
annotation after the golf entry** — a worse defect than the one being fixed, and
invisible until a golf day with odds. The gate is `if (individual) continue;` at
the top of the loop instead, which also saves one ESPN call per tick (Rule 78).
This loop's only outputs are those two arrays, which was checked before moving
it.

## Ask 3 — its premise was REFUTED, and the real defect was duplication

The document reads `grep -an buildGolfCronContext` returning one line as *"it
has never been called"*, and concludes that removing the generic line removes
golf from the prompt entirely. That is why its gate was placed where it was.

**Golf was always in the prompt.** `buildPrompt` has carried a `golfContext`
slot all along, fed by **twenty lines of `buildGolfCronContext`'s body, copied
inline** at the slate assembly. The function and the copy built the same string
from the same fetch.

So the Rule 63 defect was duplication, not a missing feature, and the fix is to
delete the copy rather than add a call beside it:

```
buildGolfCronContext   7515   defined once
                       8912   called once, from the slate assembly
```

It gained an optional `preFetched` argument because the slate path already holds
that scoreboard — it needs `golfData` again for the per-round brief — and
calling it blind would have doubled every tick's golf request (Rule 78).

## Ask 4 — the guards, and one of them was vacuous when written

Extended `scripts/check-individual-sports-not-archived.mjs` rather than adding a
sibling, so all three gates live beside each other. **11 self-tests, 9 live
assertions**, blocking in `deploy.yml`.

`slateGateState` carries three links, each breakable on its own: the gate, the
destructure, and the gate's **position above the fetch**.

**`beforeFetch` passed its own mutation on the first attempt.** It searched the
whole file for a fetch occurring after the gate — and there is a *second*
LEAGUES walk further down with its own identical fetch, so every gate position
had one to point at. The mutation that moves the gate below `gameLines.push`
reported `beforeFetch: true`. It is now scoped to a window from the loop head,
and the mutation is caught. An assertion satisfiable without testing its claim
is the thing Rule 90 exists for, and it was caught by writing the mutation
rather than by reading.

`golfBuilderState` asserts the function is defined once, called at least once,
and that the inline copy has not returned — keyed on the copy's own give-away
line, `Use leaderboard positions and scores only`, which must appear exactly
once in the file.

## Done condition — MET IN PART, and the gap is stated rather than papered over

The condition is a **slate prompt captured after deploy** containing the
`PGA TOUR — <event> · Round <n>:` block and no line with two empty team names.

**Nothing exposes the assembled prompt.** Each candidate was read, not assumed:

| route | what it actually returns |
|---|---|
| `/journalism/game-lines` | per-game **brief** first sentences from KV |
| `/journalism/context-probe` | its own hardcoded five-league list, **no golf in it** |
| `/debug/*` (4 routes) | gemini model test, last archive error, odds budget latency, recent requests |

Adding one would mean either publishing `FIELD_VOICE_REGISTER` and `JQ_STYLE`
on an unauthenticated route, or extracting the slate walk out of
`handleJournalismCycle` — which fires every 15 minutes and is covered by this
repo's structural-change guardrail. **Neither is a call to make inside this
task**, so neither was made.

**What IS proven:**

1. The bad line, measured live and committed (`38142889937`).
2. The gate present in the deployed source, with 9 live assertions and a
   mutation that catches a misplaced gate.
3. The duplication removed: one definition, one caller, one fetch.
4. The golf block's inputs read from the **deployed** `/v2/golf/enriched`
   after the deploy, run `38143603883`:

```
status             200
active             True
eventName          'Baycurrent Classic'
round              4
leaderboardRows    72
firstRowFields     {pos: '1', name: 'Michael Brennan', toPar: '-16', today: '-3', thru: 18}
wouldRender        True
```

   All five fields `buildGolfCronContext` reads are populated on row one, so the
   block renders `PGA TOUR — Baycurrent Classic · Round 4:` followed by
   `1 Michael Brennan -16 (today -3) thru 18`. That is the **presence** half of
   the done condition, derived from the deployed worker's own data rather than
   from reasoning about it.

**Read the artifact carefully on one point:** it still reports
`LINE: '-15 @ -16 · Final · Golf Chnl'`. That is correct and not a regression —
the probe calls `buildGameLine` directly, which is what it is for. What changed
is that the slate walk no longer calls it for an `individual` league.

**What is NOT proven:** that the deployed prompt string contains the block and
no empty-name line. Per the document's own instruction — *"If no tournament is
live in the session, that is not done — say so and schedule the re-check rather
than closing on a green deploy"* — this is said rather than closed.

## Second CC-CMD filed, not carried forward (Rule 87.4)

`buildGameLine` has **two** callers and the document discusses one.
`src/index.js:9383`, the per-game brief enqueue, iterates
`for (const {sport, league, label} of LEAGUES)` — **no `individual` in scope**,
and the 50 lines after it carry no guard. On a golf day it would enqueue a brief
about two nameless sides beside the correct `[GOLF-BRIEF]` one: the same
double-row shape the first golf CC-CMD fixed in the archive, one layer up.

Read from source and **not yet probed**, which is exactly the state this
document's own headline claim was in this morning. Filed as
`docs/CC-CMD-2026-10-11-golf-reaches-the-per-game-enqueue-too.md`, whose Task 1
probes it before anything is written — and `/journalism/game-lines`, found while
looking for the prompt, is the surface that probe needs.
