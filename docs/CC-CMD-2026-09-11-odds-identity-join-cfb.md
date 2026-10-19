# CC-CMD-2026-09-11 — the odds identity join drops every CFB and Bundesliga row

**STATUS (corrected 2026-10-19):**
- **Task 0:** DONE.
- **Tasks 1-2:** SUPERSEDED, not met as specified. `src/odds-name-match.js`
  `matchSlate` (2026-09-16) was built without Task 1's collision corpus
  (`scripts/check-odds-matcher.mjs` has no Virginia or Washington case) and
  without the leading-token constraint Task 2's mutation targets:
  `nameMatches('Virginia', 'West Virginia Mountaineers')` is true. Its
  stage 2 pairs on one side, against this document's "Match on the PAIR,
  never a single team". It is wired only to `.github/scripts/odds-backfill.js`
  and `scripts/targeted-odds-fill.mjs` (`scripts/check-odds-matcher-wiring.mjs`).
- **Task 3:** NOT MET, and not meetable as built:
  - `/identity/mismatches` still joins on exact `resolveTeamKey` keys;
  - the Saturday probe's 6 scheduled runs all dated the UTC Sunday. Its 7th
    run (dispatch 34667508348) was dated Saturday 2026-09-12 but ran at
    02:23Z, before that slate was played. CFB reads NO_ROWS in all 7
    artifacts.
- **Tasks 4-5:** NOT DONE.
- **Successors:** in production the matcher made one confirmed wrong CFB
  pair, the very collision Task 1's corpus was meant to stop:
  `docs/CC-CMD-2026-10-19-cfb-stage2-wrong-pair.md`. Task 3's route and probe
  are in `docs/CC-CMD-2026-10-19-cfb-saturday-coverage-and-join-probe.md`
  Part B.
- **Previous status line, kept:** "Task 0 DONE. Tasks 1-5 BLOCKED on
  `CC-CMD-2026-09-13-team-key-sport-blind.md`." That was stale from
  2026-09-16.

Task 0 probed a real Saturday (2026-09-12, 80 games / 24 vendor events / 0
matched) as this document instructed, and the sample did not survive:

1. **Six of eighty D1 rows carry another sport's team.** `Liberty →
   newyorkliberty` (WNBA); Minnesota, Colorado, Houston, Cincinnati and
   Charlotte → MLS clubs. `resolveTeamKey`'s alias map is sport-blind and those
   keys are WRITTEN INTO D1. A matcher that "succeeds" on
   `coloradorapids|weberst` would write MLS odds onto a college football game —
   the exact failure this document's own gate section warns about. Fixed first,
   separately.
2. **The prescribed rule fails on 35 of 80 rows.** *"Every D1 token must appear
   in the vendor's token list, in order, starting at its first token"* does not
   hold for `cmichigan` vs `centralmichiganchippewas`, nor for `GA Southern`,
   `Jax State`, `UT Martin`, `N Dakota St`, `ETSU`, `MTSU`, `App State`,
   `Western KY`, `Miami OH`. The five pairs below happen to contain only
   mascot-suffix and `st`→`state` cases, which the rule does handle — which is
   precisely why Task 0 said not to write the matcher against them.

`/identity/mismatches` now reports `key_substituted` so the first finding is
visible to anyone who opens this again. Verified live, deploy 934.

Session doc: `outbox/cc-session-2026-09-13-odds-join-task0-cfb.md`.

---

Second CC-CMD required by Rule 87.4. `CC-CMD-2026-09-11-odds-key-map-reconcile`
stopped at Task 0 because its causal premise — the sport-key maps — was
disproven. This one carries the real cause forward.

## What is established, and by which artifact

`outbox/odds-api-probe-20260911T200607Z.json` (run 34642392250) and
`outbox/odds-join-probe-20260911T200950Z.json` (run 34642581862).

Season to date:

| sport | rows | opening | closing |
|---|---|---|---|
| MLB | 1116 | 984 | 941 |
| MLS | 586 | 180 | 109 |
| CFB | 105 | **0** | 0 |
| NFL | 50 | **0** | 0 |
| Bundesliga | 19 | **0** | 0 |

Three hypotheses are dead, each by measurement rather than by reading:

- **Sport-key mapping.** `archiveSportToOddsKey` resolves `CFB` →
  `americanfootball_ncaaf`, `NFL` → `americanfootball_nfl`, `Bundesliga` →
  `soccer_germany_bundesliga`. All three present in
  `ARCHIVE_SPORT_TO_ODDS_KEY`.
- **H1 timing.** 2026-09-11 rows were created 10:01:13–10:01:27; `odds_api`
  wrote `opening_odds` at 10:01:39–10:01:43. The rows existed.
- **H2 quota short-circuit.** `snapshotCronOdds`' `return` on a low quota
  starves whatever falls late in D1's `DISTINCT` order, and that order varies
  by day, so it yields *partial* coverage. MLS's 180-of-586 is that signature.
  0-of-105 across a season is not.

**The vendor serves all four keys.** Same run: CFB 100 events, NFL 212,
Bundesliga 18, MLS 15. This answers Task 0.4 of the superseded CC-CMD:
`soccer_usa_mls` does return markets.

## The cause

`resolveTeamKey` (`src/identity-resolver.js:544` → `resolveEntity('team', …)`,
strip-form plus the `CANONICAL_TEAM` alias map) produces different keys for the
two sides of the same game, so `snapshotCronOdds`' `if (!og) continue` drops
every row in silence.

All five of 2026-09-11's CFB games appear on both sides. Zero matched:

| D1 key | Odds-API key |
|---|---|
| `louisville\|villanova` | `louisvillecardinals\|villanovawildcats` |
| `virginia\|norfolkst` | `virginiacavaliers\|norfolkstatespartans` |
| `ncstate\|richmond` | `ncstatewolfpack\|richmondspiders` |
| `bostoncollege\|rutgers` | `bostoncollegeeagles\|rutgersscarletknights` |
| `kansas\|missouri` | `kansasjayhawks\|missouritigers` |

Bundesliga's single row is the cleanest proof that this is per-team
normalization and not a format difference — **the home side matches exactly**
and only the away side diverges:

| D1 key | Odds-API key |
|---|---|
| `unionberlin\|schalke` | `unionberlin\|fcschalke04` |

Two distinct shapes, needing different handling:

1. **Appended mascot** (CFB, NFL): vendor is `School Mascot`, D1 is `School`.
2. **Club affixes** (Bundesliga): `FC`, `SC`, `TSG`, `VfB`, `04`.

Plus an abbreviation: `Norfolk St` vs `Norfolk State`, which defeats a plain
prefix test.

## Why this is NOT a quick relaxation, and what the gate is

Relaxing to prefix-or-contains on a single team writes **wrong odds onto real
games** — worse than no odds, and a DO NOT INVENT violation. CFB is the worst
possible place to try it: `virginia` is a prefix of `westvirginia…`, `miami` of
`miamiohio…`, `washington` of `washingtonstate…`.

The join is already on a **composite** `home|away` key, which is the safety
margin to build on rather than discard.

**Required shape of the fix:**

- Match on the PAIR, never a single team.
- Accept a row only when **exactly one** vendor event matches it. Two or more
  candidates → write nothing. Ambiguity must never resolve to a guess.
- Relation between a D1 token list and a vendor token list, after
  normalizing `st` → `state`: every D1 token must appear in the vendor's token
  list, in order, starting at its first token. Extra trailing vendor tokens (the
  mascot) are allowed; extra leading ones are not, except for a small affix set
  (`fc`, `sc`, `tsg`, `vfb`, `afc`, `cf`).

## Tasks

0. **Probe first.** Pull a full CFB Saturday slate (not a Thursday — 2026-09-11
   had 5 games against 100 vendor events; a Saturday has ~60) via
   `GET /identity/mismatches?date=…&sports=CFB`. Read the real name pairs from
   the response. Do not write the matcher against the five pairs in this
   document — they are a sample, and this repo's rule is that a copy is almost
   always locally true.

1. **Build the pair matcher with its collision corpus first.** Before the
   matcher, assemble every D1 school name that is a token-prefix of another
   (`Virginia`/`West Virginia`, `Miami`/`Miami OH`, `Washington`/`Washington
   State`, …). That corpus is the test, and it is written before the code.

2. **Mutate it (Rule 90).** At minimum: delete the uniqueness check and confirm
   a collision case goes red; delete the leading-token constraint and confirm
   `virginia` matching `westvirginiamountaineers` goes red. A matcher whose
   uniqueness check cannot be made to fail does not ship.

3. **Done condition.** Not "CFB gets odds". After deploy, a fresh
   `/identity/mismatches?sports=CFB` on a date with rows must report
   `matched > 0` AND `unmatched` containing no pair whose two names are
   demonstrably the same game. Commit that response as the artifact (Rule 89).

4. **Coverage in the probe's own output (Rule 91).** The verification names how
   many of the slate's rows it checked, not just PASS.

5. **Outbox manifest.** Commit hash, deploy run ID, the done-condition response,
   and any residual.

## Explicitly out of scope

- `ucl` / `europa` / `conference` are absent from `ARCHIVE_SPORT_TO_ODDS_KEY`.
  Real gap, separate cause, separate CC-CMD. UCL's 6 rows / 0 odds is explained
  by that absence and not by this join.
- Raising ambient coverage from 11 keys to 16. That is a budget change and needs
  the projection the superseded CC-CMD's Task 2 describes.
