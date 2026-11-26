# Session 2026-11-25 — the UEFA labels and the EFL Championship on the BSD game join (owner: "build both next")

**Owner orders this session:** `/i-have-adhd build both next`, then "Any other outstanding decisions, go with Claude's best recommendations and state what they are". Spec: `docs/CC-CMD-2026-10-27-bsd-event-id-on-game-rows.md`, "Addendum 2026-11-25" (decisions and done conditions); consumer: field-laboratory `docs/CC-CMD-2026-11-23-bsd-next-goal-independent-reference.md`, "UEFA and EFL Championship result". Branch: main throughout; no PR.

**HEAD progression (relay):** `328ce1b` -> `c3255db` (archive reader) -> `a8f2b9c` (probe) -> `70b5805` (fixture capture takes `--labels`) -> `05e4c0a` (UEFA fixture) -> `10132ab` (UEFA labels + 64 aliases) -> `79ca2d6` (seed EFL Championship, `eng.2`) -> `551b461` (history backfill workflow) -> `b932b8e`/`a0a9649` (backfill artifacts: 200 rows written, 0 failed) -> `3e409f6` (probe) -> `3386b08` (EFL fixture) -> `4858568` (empty-catch fix) -> `4816483` (EFL label + 13 aliases + check + harness) -> `a3daf52` (backfill `isStuck`) -> `e0b7721` (probe) -> `23d729d` (CC-CMD addendum) -> this doc.

## What was built, per commit

| commit | what |
|---|---|
| `10132ab` | six UEFA labels on `BSD_SOCCER_SPORTS`; 64 club aliases in `src/identity-resolver.js` (BSD form -> archive form); `scripts/check-bsd-uefa-join.mjs` (20 checks, 302 of 302 pinned per label); `scripts/mutate-bsd-uefa-join.mjs` (74 of 74) |
| `79ca2d6` | `{sport:'soccer', league:'eng.2', label:'EFL Championship'}` in the cron's `LEAGUES`; `src/seed-manifest.js` (eflchamp out of UNDECIDED); `check-individual-sports-not-archived.mjs` EXPECTED 23 -> 24 |
| `551b461` | `scripts/run-archive-league-history-backfill.mjs` (+ self-test 27, harness 29 of 29) and `archive-league-history-backfill.yml`, dry-run by default |
| `4858568` | the empty-catch gate counted 114 against 112: two `.catch(() => null)` in the backfill script (the gate counts them as bare) became explicit try/catch |
| `4816483` | `'EFL Championship'` on the join list; 13 aliases; `check-bsd-eflchamp-join.mjs` (12 checks, 200 of 200); the UEFA harness now covers both alias blocks (92 of 92 caught); deploy wiring |
| `a3daf52` | `isStuck` in `scripts/bsd-backfill-lib.mjs`: 29 of the 56 UEFA/EFL dates were already in the backfill's state (answered for six labels) and would have been called stuck forever; also repairs the check's two assertions pinned to five in-scope sports (red since the labels went on the list) |
| `23d729d` | the CC-CMD addendum |

## Verified end to end (Rule 61)

- **Deploy:** run `45720223494` on `4816483`, success. (`45716990214` on `551b461` failed at the empty-catch gate, fixed by `4858568`; guards run `45716990207` on the same SHA failed at the same gate for the same reason.)
- **Production join:** dry run `45722117944` (188 of 188 days read, 54 days / 476 rows planned), real runs `45722809883`, `45723395679`, `45723991256`, `45724579421`, `45725166942`, `45725759174`: 54 of 54 dates verified by a cache-busted re-read, 476 rows written, 214 upstream pages, no stop.
- **Archive (run `45726381021`, `outbox/archive-label-dates-2026-11-26T00-07-11-213Z.json`):** UEFA 302 of 302 joined across the six labels; EFL Championship 204 of 204 (200 + 4 rows of 2026-11-25).
- **Laboratory reach probe (run `45726587782`, `outbox/bsd-e2-reach-2026-11-26T00-10-03-036Z.json`):** 250 matches, 387 gradeable calls; `eflchamp` 19 of 19 matches reached (was 0 of 19); `ucl` 36 of 39 and `europa` 21 of 22 (were 0 of 34 and 0 of 22); the matches with no archive row carrying their BSD id fell from 75 to 4.

## STAGED / open (Rule 74), each with its unblock

- **The ESPN reference grade re-run** (`espn-reference-grade.yml` run `45726584274`, lab `b1f6bcad9785bb7d6e976c8191d298f898de7619`): result recorded in the laboratory's CC-CMD when it lands.
- **4 matches still unreached** (3 `ucl`, 1 `europa`): the artifact is counts-only, so the cause is not read from it; the census still labels them "outside the join's sports", which is no longer true for them. Unblocked by: a per-match listing from the census for exactly those slugs (counts-only rule: identify by date and slug, never by BSD data). Verify: the reach probe's `reach.bySlug.ucl.zero` and `europa.zero` fall to 0.
- **`EFL Cup` (81 rows) and `EFL Trophy` (98) are in the archive with no `bsd_event_id`** and not on the join: nobody has asked; recorded in the addendum, decision 8.
- **A club without an alias in a later UEFA round** will be `unmatched` (counted, not guessed). Unblocked by: the next fixture capture + `scripts/measure-bsd-game-join.mjs` and one more alias block.
- **`/archive/game` is still unauthenticated** (ruled to be gated, blocked on secret rotation, `docs/CC-CMD-2026-10-14-archive-game-unauthenticated-write.md`); the history backfill sends `X-FIELD-Relay` already and is listed there as a caller.

## Decisions I took on the owner's "go with your best recommendations" (all in the CC-CMD addendum, repeated here)

1. Seed `EFL Championship` only; `eflone`/`efltwo` stay UNDECIDED. 2. All six UEFA labels on the join. 3. Per-club aliases derived from unmatched rows, never a fuzzy matcher, never a kickoff. 4. The measure script's STOP (>40 distinct unmatched clubs) passed once, because the cause was structural and the check pins the outcome. 5. History backfill of the Championship season so far. 6. `isStuck` corrected rather than clearing the state file. 7. Production join backfill over 2026-05-20 to 2026-11-23, not the schedule's default end. 8. `EFL Cup`/`EFL Trophy` left off.

## Rule 90 (mutation) and Rule 91 (coverage), as run

- `mutate-bsd-uefa-join.mjs` 92 of 92 (74 UEFA block, 18 EFL block), controls ok; `mutate-bsd-game-join-backfill.mjs` 39 of 39 (4 new: `isStuck` ignored, whole-attempt stuck, sports not recorded, in-scope-only sports recorded); `mutate-bsd-backfill-lib.mjs` 47 of 47 (8 new on `isStuck` and `LEGACY_ATTEMPT_SPORTS`).
- Coverage: the UEFA check reads 302 rows of 24 dates; the EFL check 200 rows of 40 dates; the production reader names every label it counted; a PASS here is a claim about those rows only.

## Errors found and fixed this session, matter-of-fact

- Deploy `551b461` red at the empty-catch gate (114 > 112): fixed `4858568`.
- The backfill check's scope assertions pinned five sports: red since the UEFA labels, found by running it before dispatching the workflow whose verify job runs it; fixed `a3daf52`.
- `isStuck`: the state file would have hidden 29 dates; found by comparing the state's attempted dates with the dates the new labels live on before the first real run.
