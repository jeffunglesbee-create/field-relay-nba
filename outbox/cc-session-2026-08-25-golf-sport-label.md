# Session doc — golf is a sport, PGA Tour is a league (Rule 67)

**Date:** 2026-08-25
**Scope:** field-relay-nba. Stop the archive catch-up writing a tour into the
`sport` column.
**Ask:** `field-laboratory docs/CC-CMD-2026-08-25-golf-sport-label.md`

## The defect, measured

Two archive rows for one ESPN event, 401811963 — the BMW Championship:

```
sport="golf"      id="golf_2026-08-24_bmwchampionship_r4"
                  league="PGA Tour"  home="BMW Championship"  away="R4"
                  home_score=-17  note="Wyndham Clark -17"
                  venue="Bellerive Country Club"  espn_event_id="golf_401811963"

sport="PGA Tour"  id="PGA Tour_2026-08-20_src401811963"
                  league="PGA Tour"  home=null  away=null
                  home_score=-6  away_score=-6  venue=null  note=null
                  espn_event_id="401811963"
```

The second is this repo's own generic ESPN walker. `src/index.js:7750`:

```js
const home = teams.find(t => t.homeAway === 'home') || teams[0];
const away = teams.find(t => t.homeAway === 'away') || teams[1];
```

The fallback exists for neutral-site fixtures where ESPN omits `homeAway`. It
cannot tell a neutral site from a leaderboard. On a golf event both `find`s miss
and `teams[0]`/`teams[1]` are the first two PLAYERS; a golf competitor carries
`athlete` and not `team`, so both names resolve to `''` and persist as null,
while `.score` survives.

**`-6, -6` is not a tie.** It is the top two players of round one with their
names stripped by a `.team` lookup golf does not have.

`src/index.js:7842` then writes `sport: gm.league`, where `gm.league` is the
LEAGUES `label`. That is correct for 20 of the 21 entries and wrong for one:
PGA Tour is a LEAGUE within golf, alongside the Korn Ferry, Champions, LPGA and
DP World tours. CC-CMD-2026-08-06 established `sport: gm.league` deliberately —
reading `gm.sport` relabelled every soccer competition as the World Cup — and
that is **not** what changed here.

## The fix

`individual:true` on the LEAGUES entry, carried into `gameMeta`, and
`if (gm.individual) continue;` at the catch-up write.

Flagged on the ENTRY rather than tested as `sport === 'golf'` at the use site,
so the next individual-competitor league added carries the fact with it instead
of needing the gate widened. Korn Ferry, Champions, LPGA and DP World would each
otherwise repeat this exactly.

**Not a coverage gap.** The golf-aware `[GOLF-BRIEF]` path (`src/index.js:8235`)
already archives these events under `sport='golf'` with the event, the round and
the named leader — verified as the source of the correct row above, which
carries `espn_event_id='golf_401811963'` matching that path's
`` `golf_${eventId}_R${roundNum}` ``. This removes a duplicate that is also
wrong.

## Guard

`scripts/check-individual-sports-not-archived.mjs`, a deploy gate, six live
assertions and five self-test mutations.

The design point: it is a **three-link chain** — flag on the table, `individual`
destructured from the row, `individual` carried into `gameMeta` — and the gate
reads `undefined` and passes everything if any one link is missing. That is the
realistic way a fix like this rots, so each link is mutated INDEPENDENTLY in the
self-test rather than all three at once.

`TEAM_SPORTS` is an allowlist, not a blocklist of known individual sports. A
blocklist silently passes the first unfamiliar sport; an allowlist makes an
unrecognised ESPN `sport` value an explicit decision at the moment it is added,
which is the only moment anyone knows the answer.

**The self-test caught its own bug.** The "removing the carry" mutation
originally inserted a character after `sport,` and left `individual,` in place,
so it reported PASS while proving nothing. It went red when run.

## Corrected while writing

The filed CC-CMD says "right for 21 of 22 entries". Parsed from HEAD: the table
has **21** entries — 20 team-sport, 1 golf. Written from an estimate rather than
a parse; corrected in that document.

## Deferred, with its own CC-CMD (Rule 87 §4)

`docs/CC-CMD-2026-08-25-golf-slate-line.md`. Two things this change deliberately
did not touch:

1. **`buildGameLine` has the same broken derivation**, one line earlier, and its
   output goes into the JOURNALISM PROMPT. The gate is at the catch-up write and
   not at `gameLines.push` because removing golf there removes golf from the
   prompt entirely.
2. **`buildGolfCronContext` (`src/index.js:6903`) has no caller.** Measured:
   `grep -an "buildGolfCronContext" src/index.js` returns one line, its own
   definition. It builds exactly the right block — event, round, top-10 with
   to-par and thru — and has never run. A Rule 63 violation sitting in the slate
   path's own file.

That CC-CMD's first task is a probe, and it says explicitly: if the probe shows
the generic golf line is harmless, close it WITHDRAWN. The defect is read from
source and has not been observed in output.

## Residual

The archive still holds the bad `sport='PGA Tour'` rows. **Deleting archive rows
is not being done without explicit human approval** — the filed CC-CMD's step 4
proposes the DELETE and waits. The count is unmeasured here: `POST /d1/execute`
is credentialled and this sandbox has no `RELAY_SHARED_SECRET`. It is reported
by field-laboratory's `cc-cmd-followup.mjs`, which runs twice daily on the drift
sentinel — the follow-up is automated rather than carried forward.
