# CC session — 2026-10-16 — `/bsd/r2/list` scope and `/bsd/contract` frame

CC-CMD: `docs/CC-CMD-2026-10-16-bsd-list-and-contract.md`
**HEAD:** `ee4bfc9` → `234707f` · **Branch:** main

## Commits

| commit | what |
|---|---|
| `ad493f9` | `/bsd/r2/list` echoes `prefix` and `prefixSource`, honours `limit` (clamped 1..1000, echoed), returns and accepts `cursor`. Default prefix KEPT at `bsd/wc26/` (Task 0). |
| `1abd0e4` | `scripts/check-bsd-frame-contract.mjs` + `scripts/mutate-bsd-frame-contract.mjs`, wired into `guards.yml`. |
| `a183b76` | guard fix: the live mutation skipped declarations that already disagree (found by the guard's first live run). |
| `234707f` | `/bsd/contract` revision `2026-10-16-1`: `incidents[].sequence[].pos` is `shared-pitch`, `perTeam: false`; `ownGoal` named a frame discontinuity; `supersedes` records that `2026-10-10-1` was wrong; `mirrorAwayNotFor` names the path. `scripts/bsd-contract-verify.mjs` moved to the new revision. |

Deploys: `ad493f9` run 38983749792 success; `234707f` run 38984914025 success.

## Task 0 — callers of `/bsd/r2/list` (searched BEFORE the default was touched)

Searched `origin/main` of all four repos in session scope (field-relay-nba
`ee4bfc9`, jubilant-bassoon `4acb9c4f`, field-laboratory `7f6472d`,
field-playground `f0dae70`), every tracked file including `.github/workflows/`,
for `r2/list` and for URL constructions that could build it
(`r2\/list`, `/r2/`, `bsd/r2` followed by a quote or `+`).

| caller | prefix | depends on the wc26 default? |
|---|---|---|
| field-laboratory `scripts/probe-empowerment.mjs:1196` (`r2_list_mechanism`) | **none**, and `?prefix=` (empty, which also falls to the default) | **Yes.** It lists without a prefix to measure this scope, and its `reading` string is conditional on the no-prefix page starting `bsd/wc26/`. |
| field-laboratory `scripts/probe-empowerment.mjs:1189` (`listPage`) | explicit | no |
| field-relay-nba `scripts/empowerment-premises.mjs:340` | explicit | no |
| jubilant-bassoon | none found (one doc mention) | — |
| field-playground | none found | — |
| workflows (all four repos) | none call it; field-laboratory `probe-empowerment.yml` mentions it in a comment | — |
| field-relay-nba `src/index.js` | the handler only; no internal caller | — |

**Decision:** the default stays `bsd/wc26/`, deliberately. The only no-prefix
caller measures the default, so widening it would silently change what that
measurement reads. The scope is now stated in every response (`prefix`,
`prefixSource: "default"`), which is the whole fix for the defect: a page that
names its own scope cannot be mistaken for the store. Recorded in the handler's
comment and in `ad493f9`'s message.

## Verification against the DEPLOYED relay

All via `probe_relay_route` (the sandbox's CONNECT to `workers.dev` is 403).

1. `GET /bsd/r2/list` (no prefix) → `"prefix":"bsd/wc26/","prefixSource":"default","limit":5` (taken with `?limit=5`). Before the fix the same route returned `{"keys":[…100…],"truncated":true}` with no prefix and no cursor.
2. `?limit=5` → 5 keys (`8341/incidents` … `8343/incidents`). `?prefix=bsd/&limit=99999` → HTTP 200, `"limit":1000` (clamped, not an error).
3. The `?limit=5` cursor passed back → page 2 starts `bsd/wc26/8343/stats.json`, immediately after page 1's last key `bsd/wc26/8343/incidents.json`. No overlap, no gap. The guard's census also walked the whole store by cursor: 1927 keys in 3 pages of 1000.
4. `GET /bsd/contract` → `"revision": "2026-10-16-1"`; `frames["incidents[].sequence[].pos"]` = `frame: "shared-pitch", perTeam: false`, with `ownGoal` and `corrected`; top-level `supersedes.revision: "2026-10-10-1"`, `wrongAbout: ["incidents[].sequence[].pos"]`; `transformReference.mirrorAwayNotFor` names the path. `shotmap[].pos` and `shotmap[].gm` byte-unchanged. `bsd-contract-verify.yml` against the deployed route (run 38985223115, committed as `outbox/bsd-contract-verify-latest.txt`): **22/22**.
5. Guard, live: guards.yml run 38984913896 on `234707f`, step "every BSD frame the contract declares matches the captures": **PASS**, all 5 declared frames AGREE over the same coverage line as below (1927 keys, 791 non-shell captures, 1589 reads, 0 failed, 74 own goals excluded); `incidents[].sequence[].pos` declared and measured `shared-pitch perTeam false`, home 1212/1212, away 0/969. Live mutations: 5 run, 5 applied and caught. Harness: 12/12 caught. The guard read the source declaration; the deployed one is checked by item 4.

### The guard's first live run, against the WRONG declaration (run 38984129822, `1abd0e4`)

The source still declared `target-goal-relative, perTeam: true`. Output:

```
COVERAGE: 1927 keys in 3 list page(s); 892 events, 791 non-shell read; 1589 reads, 0 failed; 74 own goals excluded
AGREE        average_positions[]          own-goal-relative perTeam true   home 0/9 at x>=50, away 0/9 at x>=50
AGREE        shotmap[].pos                target-goal-relative perTeam true   home 12/11372 at x>=50, away 29/9672 at x>=50
DISAGREE     incidents[].sequence[].pos   declared target-goal-relative perTeam true
                                          measured shared-pitch perTeam false   home 1212/1212 at x>=50, away 0/969 at x>=50
AGREE        shotmap[].gm                 goal-plane   gm.x == 0 on home 11372/11372, away 9672/9672
AGREE        incidents[] goal .gm         goal-mouth-2d   matched goals home 1184 (discordant 681827/682050), away 944 (discordant 432788/432788)
```

The defect the CC-CMD describes, caught by the guard on real data before the
fix — and `shotmap[].pos` / `shotmap[].gm` re-measured as declared, untouched.

It also reported `1 mutation not caught`, which was a **guard defect**: the
in-run mutation flipped every declaration, and flipping the wrong one
(`target-goal-relative → shared-pitch`) made it right. Fixed in `a183b76` —
mutations run only over agreeing declarations, and say which they skip.

## The guard

- Declaration read from `src/index.js` (the source); `--contract=live` reads the deployed route.
- Captures read through `/bsd/r2/list` by cursor and `/bsd/r2/read`. A truncated page without a cursor, or a page answered from a prefix it was not asked for, stops the census.
- Split by side; own goals excluded (`goal_type` matching `/own/`).
- Three outcomes and exit codes: agree 0, **DISAGREE 1** (names declared and measured), **INSUFFICIENT 3** when a side has fewer than 3 records. An away-only sample is insufficient under either declaration — tested with the 223324 away goal itself.
- A declared path with no measurement, or a measured path the contract stops declaring, fails.
- Coverage printed with the result (Rule 91).
- Rule 90: `mutate-bsd-frame-contract.mjs` breaks the guard 12 ways, anchors asserted unique, file restored and compared. 12/12 caught. Two of the first draft's self-test gaps were found this way (perTeam not compared; cursor not sent) and closed before commit.

## Carry-forwards

None deferred. Notes:

- `coordinateSystem.space` / `origin` still describe per-team frames; that is
  correct for `average_positions[]` and `shotmap[].pos`, and `frames` is the
  per-path lookup the contract already tells readers to use. Not changed
  (TOUCH-ONLY).
- No jubilant-bassoon consumer reads `/bsd/contract` or `incidents[].sequence[]`
  (grep of `origin/main`, `src/legacy/field.js`, `field_utils.js`,
  `field_unit.js`), so no client change is owed (ATOMIC-A checked).
- field-laboratory's `r2_list_mechanism` keeps working: same default, and the
  response now also carries the `prefix` that explains it.
