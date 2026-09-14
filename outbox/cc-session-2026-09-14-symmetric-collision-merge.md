# CC session — 2026-09-14 — symmetric collision merge and the disagreement condition

Rule 67 session doc. Repo: field-relay-nba. Branch: `main` throughout.

HEAD progression: `d30138f` → `f1504c8` → `84aa6fd` → `2f572b6` → `9488ec5`
(plus three bot commits carrying workflow logs).

## What this session was for

Category B of `CC-CMD-2026-09-13-archive-duplicate-rows`: the 32 collision pairs
where each row holds half the truth. Owner approval, 2026-09-14: *"go, symmetric
merge approved"*, against a plan stated as 32 pairs, UPDATEs only, zero DELETEs.

## Per commit

**`4238919` / `f1504c8` — the plan and its executor.**
`buildSymmetricPlan` in `scripts/collision-cleanup-plan.mjs` emits UPDATEs and
has no code path that can emit a DELETE. `scripts/run-symmetric-collision-merge.mjs`
re-derives the plan from the live census, asserts zero deletes and exactly 32
pairs, verifies each fill landed before issuing the next, writes `change_log`
at 16 rows per statement (derived from D1's 100-parameter cap), and measures its
done condition by re-censusing and re-deriving — not by the updates returning OK.
Its own workflow, `symmetric-collision-merge.yml`, separate from
`collision-cleanup.yml` because that one can delete and this one cannot.

**`84aa6fd` — the narrowing the first dry run forced.**

THE DEFECT THE DRY RUN CAUGHT. The first live dry run planned **64** updates
across the 32 pairs. Half of them wrote `espn_event_id` into the twin, because
`LOSS_BEARING` lists it as a field a delete must not destroy.

`LOSS_BEARING` answers *what disappears if this row is deleted*. Nothing is
deleted here, so that is the wrong question. The question a fill has to answer
is *what must the two rows agree on*.

`src/index.js` holds **nineteen** `WHERE espn_event_id = ? LIMIT 1` lookups.
They return one row today only because exactly one row of each pair carries the
id. The two rows disagree on team names — `Austin` against `Austin FC` — so
filling that column would have made all nineteen return whichever row SQLite
reached first. A fill that creates an ambiguity has not ended one.

Narrowed to the odds columns. 64 updates → 32, one per pair.

**`2f572b6` — the condition asks about disagreement, not presence.**

`same_slate_pair_collisions_with_odds` asked whether EITHER row carried a line.
That condition can never close: fill the 32 pairs and the hazard is gone while
both rows now carry odds, so the watch reads OPEN forever for a defect that no
longer exists. A permanently red watch is a watch nobody reads.

The harm is that the join cannot tell two rows apart and they say DIFFERENT
things. One rule now covers all three categories:

| category | n | odds state | verdict |
|---|---:|---|---|
| A — cup competitions under `sport=MLS` | 82 | neither row carries odds | agree → inert |
| B — half-truth pairs, before the merge | 32 | one row carries, one does not | **disagree → open** |
| B — after the merge | 32 | identical line on both | agree → inert |
| C — doubleheader | 1 | — | two real games, excluded |

Compared on a **digest** of the odds blob, never on `has_*_odds`. Those booleans
are a projection: two rows can both read `true` while holding different numbers,
which is exactly the false fact and is invisible to the flag.

The predicates moved out of the route body into `src/collision-reach.js`. Both
previous versions lived inline in `/identity/substitution-census` where nothing
could run them, and both shipped broken from there — a filter written against
`population`, a field these rows do not carry (vacuously true); and a narrowing
block placed above the `const` it read, a temporal dead zone that `node --check`
parses happily and that returned HTTP 500 on every request until a six-hourly
watch failed. 22 assertions, 8 mutations, gated in `deploy.yml` step 34.

The response serves `same_slate_pair_collisions_odds_disagree` and keeps the old
key as an alias for one cycle. The watch reads only the new name, so a relay
predating the deploy reads OPEN rather than silently DONE (Rule 99).

## Verification

| what | artifact |
|---|---|
| plan gates | `scripts/check-collision-cleanup-plan.mjs` — 35 assertions |
| plan mutations | `scripts/mutate-collision-cleanup-plan.mjs` — 15, all caught |
| predicate gates | `scripts/check-collision-reach.mjs` — 22 assertions |
| predicate mutations | `scripts/mutate-collision-reach.mjs` — 8, all caught |
| watch condition | `scripts/check-identity-ambiguity-conditions.py` — 8 fixtures |
| D1 parameter cap | `scripts/check-d1-batch-param-cap.mjs` — finds the new INSERT by shape |
| first dry run (64 updates, wide) | `outbox/symmetric-collision-merge-dryrun-2026-09-14T13-23-35-095Z.log` |
| second dry run (32 updates, odds only) | `outbox/symmetric-collision-merge-dryrun-2026-09-14T13-27-49-233Z.log` |

## E2E vs STAGED

E2E VERIFIED — the dry runs ran against the live archive through a GitHub Actions
runner (sandbox egress to `*.workers.dev` is blocked) and read the deployed
census.

## Carry-forwards

None from this work. Separately filed and unstarted:
`docs/CC-CMD-2026-09-14-cup-competitions-under-mls.md` (the 82 cup rows filed
under `sport=MLS`), and the 49 brief-repoint pairs among the 82 rows deleted on
2026-09-13.
