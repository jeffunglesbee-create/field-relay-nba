# CC session — stage 2's wrong pairs, and a pair priced backwards, 2026-10-19

`docs/CC-CMD-2026-10-19-cfb-stage2-wrong-pair.md`, dispatched by the owner, who
ruled TASK 3 during the session.

**HEAD:** `300eb6c2` → `87e9235d`..`7eac47c4` plus this docs commit, rebased over upstream bot commits `1784eaaa` and `2cd60265` and its two parents (outbox only; trees identical). Branch main throughout.
**Proof:** `outbox/odds-stage2-wrong-pair-2026-10-19.log`
**Data:** `outbox/fixture-odds-pairs-2026-10-19.json` holds all 776 odds_history
rows created since `014b82ad`, joined to their archive rows. Its `meta` has the
SELECT and the 7 aggregates rechecked in D1.

## TASK 0 — premises, one command each (Rule 100)

| premise | command | result |
|---|---|---|
| the CFB wrong pair is the only one | census over all 776 rows, every sport | **false.** 11 of 49 one-sided pairs are another team's game: CFB 1, MLB 7, NHL 3. All have kickoff gaps over 7 h |
| "a kickoff gap over 90 min" finds the wrong pairs | the same census | **only partly.** It also flags right pairs (GA Southern @ Clemson, −120) and 17 MLB stage-1 pairs that are wrong for another reason |
| the WVU/Virginia swap is the only backwards sync | `reversed orientation` in 34 backfill + 17 targeted job logs; census BACKWARDS; D1 change_log | **true.** 1 log line. The census's second candidate (Red Sox @ Rangers) was another writer's blob, filled 28 h before its history row existed |
| stage 2 is the only path to a wrong pair | the pre-fix matcher (`300eb6c2`) on each pair's reduced slate | **false.** Stage 2 produced all 49 one-sided pairs. Stage 1 paired 17 MLB games with the same teams' next game or a doubleheader twin |
| a name rule can refuse the 11 without the kickoff | `scripts/measure-stage2-side-rule.mjs` | **true:** 11 of 11 refused, 37 of 38 right kept |
| every odds_history row is decimal | the census UNITS section, then a split by writer | **false.** All 210 targeted-fill rows are American (`oddsFormat=american`), and the sync converted them again: `275` → `+27400` |

## What landed

| commit | task | what |
|---|---|---|
| `87e9235d` | 1 | `couldAbbreviate`, checked in stage 2 after the collision test; check sections F and H; the M17 isolating case; M47-M52; the refusal count on both pairing lines |
| `2824eb5d` | 2 | `pairOrientation`, `pricesByTeam`; the sync re-keys prices by team and skips what it cannot orient; section G; the wiring check; M53-M57; M12 re-anchored; the attribution check follows the new variable |
| `148e1c00` | 0 | `scripts/census-odds-pairs.mjs` and the proof log |
| `7d7372dd` | 3 | `scripts/repair-odds-wrong-pairs.mjs`: dry run, preview, three modes |
| `7f8867bc` | 3 | the repair SQL quotes its prose; the self-test runs every mode in SQLite; mutations R1-R8, 8 of 8; the owner's SQL committed as `outbox/odds-stage2-repair-sync-2026-10-19.sql` |

## Done conditions (Rule 89)

1. **Census committed with its denominator:** 776 of 980 rows (proof log §1).
2. **Red before, green after, with mutations** (§3, §5, §6):
   - the pre-fix matcher pairs all 11 wrong rows; the new check fails 4
     assertions without the rule and 1 with positional prices;
   - `mutate-odds-matcher` 57 of 57; `mutate-odds-backfill-attribution` 12 of 12;
   - repair self-test 5 of 5.
3. **TASK 3, owner ruling "WVU via tomorrow's sync":**
   - **Applied** 2026-10-19 between 22:14Z and 22:16Z (the SQL file was written at 22:14:07Z; the check-in was scheduled after the verify read, at 22:16:18Z), after the fixed code was on main.
     `outbox/odds-stage2-repair-sync-2026-10-19.sql` (sha256 `2e8ee695…`) was
     sent as ONE D1 call. 70 of 70 statements succeeded, change_log ids 22914 to
     22936.
   - **change_log, 23 rows:** 12 NULLed columns and 11 deleted history rows.
   - **Read right before the write:** the guard predicate still matched 12
     columns on 24 rows, unchanged from the dry run.
   - **D1 SELECT after the apply,** 12 games (`opening/closing` moneyline,
     history rows, repair change_log rows):

     | game | opening | closing | history | logs |
     |---|---|---|---|---|
     | CFB e401856686 (Georgia @ Arkansas) | NULL | NULL | 0 | 3 |
     | CFB e401856802 (WVU / Virginia) | NULL | NULL | **1, kept for the sync** | 2 |
     | MLB e401816961 | −127/105 (other writer) | −127/105 | 0 | 1 |
     | MLB e401816975 | 119/−143 (other writer) | 119/−144 | 0 | 1 |
     | MLB e401817020 | −163/135 (other writer) | NULL | 0 | 2 |
     | MLB e401817021 | −149/123 (other writer) | NULL | 0 | 2 |
     | MLB e401817063 | −163/134 | −163/134 | 0 | 1 |
     | MLB e401817065 | 104/−125 | 104/−125 | 0 | 1 |
     | MLB e401817067 | −131/109 | −131/109 | 0 | 1 |
     | NHL e401892442 | NULL | NULL | 0 | 3 |
     | NHL e401892470 | NULL | NULL | 0 | 3 |
     | NHL e401892485 | NULL | NULL | 0 | 3 |

   - **Left by design: one scheduled read.** The 2026-10-20 10:00Z backfill
     must write `e401856802` by team: home (Virginia) −1667, away (West Virginia)
     +870. A check-in for 10:45Z reads it (see below).
4. **Deploy:** run 39333288089 (Deploy RELAY Worker) on `7d7372dd`, success,
   which carries both code changes. Repo guards run 39333288118 also success.
   Before the push, every `run:` step of deploy.yml (up to the Cloudflare deploy)
   and of guards.yml was run on a clean copy of the commit:
   - **HEAD:** 125 of 130 pass;
   - **base `300eb6c2`:** 124 of 130;
   - **failing only at HEAD:** 0.

   The 5 failures common to both are Cloudflare KV bootstrap (credentials) and
   two guards that reach the network (`HTTP 0`).

## What this session got wrong, and the cost

- **The new rule silently weakened an old test.** M17 ("take the first
  candidate") went NOT CAUGHT, because the new rule also refused that fixture.
  The old case is unchanged, and a new case isolates the count rule again.
- **One line of code had no test.** Stripping a leading "the" was never needed:
  containment already reads "The Citadel", and M51 could not be caught. The
  strip was removed rather than given a test it did not need.
- **The census tripped a deploy gate.** `check-aggregate-launders-unknowns`
  flagged two `reduce` tallies with `|| 0`. It was caught before the push by
  running every step, and rewritten. A first check of whether the failure
  predated this work was contaminated: checking out the base left the new files
  in the tree. It was redone in a clean worktree.
- **One repair mutation went red for the wrong reason.** R3's replacement
  deleted the UPDATE instead of reordering it. R3b reorders only, and is the
  result recorded.
- **The first repair SQL would not have parsed.** Its prose literal read
  "another game's event", inside single quotes. It was printed and read before
  sending, so it never reached D1; had it been sent, the one-transaction call
  would have failed whole. The self-test had only inspected the SQL as text.
  It now runs the SQL in SQLite, and R6 restores the bug and goes red on the
  syntax error.
- **One commit message said "stage 1 is not the only safe path".** It meant
  stage 2 is not the only path to a wrong pair, and was amended before the push.

## Limits, printed with the result (Rule 91)

- **The stage-2 rule is measured on 49 real one-sided pairs,** each on its own
  reduced slate. It was not run against a full live payload.
- **About 5% of wrong-team names share the first letter and pass,** per
  `measure-stage2-side-rule.mjs`. Kickoff proximity would catch those, and it
  needs the owner's ruling. It is the open question in the stage-1 CC-CMD.
- **The census covers rows created since 2026-09-16.** Earlier rows came from the
  pre-matcher equality code.

## Filed, not dispatched (Rule 87.4)

- `docs/CC-CMD-2026-10-19-odds-stage1-wrong-game.md`: the next-day series and
  doubleheaders at stage 1. Owner ruling on the kickoff instant first.
- `docs/CC-CMD-2026-10-19-odds-history-american-converted-twice.md`: the 210
  American-odds rows and the 206 game rows they damaged.

## Integration state (Rule 65)

- **Relay contract:** unchanged.
- **Client consumers:** unaffected.
- **Behaviour changes, both in CI-run scripts:**
  - **the odds-backfill workflow:** stage 2 refuses more, and the sync keys
    prices by team;
  - **targeted-odds-fill:** the same matcher change. Its pairing line now
    carries the refusal count; the seed parser's regex still matches it, tested.
- **`src/odds-name-match.js` is not imported by `src/index.js`.** The deploy
  runs on `src/**`, but the worker's behaviour is unchanged.
