# FIELD Relay — HANDOFF

## SESSION CLOSE-OUT — 2026-08-24 (six queue items, eras 5 and 6, nine new gates)

**HEAD:** `95bf3c0` → `555a604` · **Branch:** main throughout
**Deploys:** 869-873 all green. Live verification on 873: `quality-source=fresh`,
journalism generating, both 400 validations correct.

**Session docs (Rule 67)** — `outbox/cc-session-2026-08-24-*`:
`recap-window-generated-vs-touched`, `scale-declared-vs-implemented`,
`era-6-margin-agreement`, `scorethreshold-fossil`,
`aggregate-launders-unknowns`, `soccer-attempt-enrichment`, `name-graph`,
`negative-examples`, `style-gating`, `cite-golf-analytics`, `voice-exemplars`.

### The six-item queue, all closed

| # | item | outcome |
|---|------|---------|
| 1 | `finality-dimension` | **era 5** — Dim 11 reads game state |
| 2 | `matchup-note-starvation` | **era 6** — Dim 10 reads the result, not a note |
| 3 | `scoreThreshold` 110 → 196 | **deleted** — read by nothing for 39 days |
| 4 | `n: null` in `/quality/report` | **fixed** — it was publishing `briefs_counted: 0` beside `cleared_196: 66` |
| 5 | `soccer-near-miss-enrichment` | **built** — woodwork and attempts, labelled separately |
| 6 | `prompt-numeral-mining` | **fixed** — plus the STYLE lines the ask ruled out |

### Eras 5 and 6

```
era 5  Dim 11 finality agreement, 20 pts, funded from arc 45->33 and ctx 25->17
       LIVE_LANG gap  -14.1 (4.4x se)  ->  -0.2 (0.1x)  — one instrument, both runs

era 6  Dim 10 re-pointed from matchupNote ECHO to margin agreement, 30 pts
       rows judged  0/190  ->  17/128 (13.3%), first real defect caught
       repeated byte-identical across two runs
```

### Three recorded figures corrected

- **Era 4's `+11.5`** was a simulation, not a measurement. The live gap is
  **4.5 and is noise**. Half the SCALE table was documentation: dims 6-10 carried
  their ceilings as literals and the declared weights were read by nothing.
- **Era 5's headline `-11.1`** was taken from the AFTER run's `candidates` block
  while `-0.2` came from the same run's `rescored` block — two instruments read as
  a before/after. `DIM_TO_SCALE` still named `matchupDepth`/`matchup` and had no
  `finality` entry, so that block rebuilt a **244-point rubric and reported 294**.
- **Era 2 recorded one of its commit's two changes.** `6aed3bb` is era 2's
  boundary commit; its `change` field notes the scoring half and omits the
  retry-gate removal named in its own subject line — which is what orphaned
  `scoreThreshold`.

### Nine new deploy gates

```
check-scale-matches-implementation             declared weight = code ceiling
check-slate-caps-are-derived                   caps derived by calling the functions
check-opts-keys-are-read                       a passed key must be read by its callee
check-aggregate-launders-unknowns              no ?? / || between a missing field and a sum
check-name-graph                               every name resolves to a name that exists
check-negative-examples-are-not-instantiable   a forbidden example must not be copyable prose
check-no-foreign-league-in-prompt              no sport's prompt names another sport's league
finality-agreement-check / margin-agreement-check   the two new dimensions' 2x2s
```

All nine are unconditional `run:` steps — none can skip silently. 15 guards green.

### Contamination: the structural cause, and the number

Sport content was **universal by default and scoped by exception**, so every
addition reached every sport until someone gated it — silently. Four instances in
one day. The worst: `voiceRegisterFor` gave any sport with no segment of its own
**all** of them, live on **905 of 1322 finalized games (68.5%)**, MLB alone 830.

Closed by authoring exemplars **H (baseball), I (football), J (golf), K (tennis)**
and classifying CFL and atp/wta. Every briefed sport now has a class and its own
exemplar; the keep-everything fallback survives only for the mixed-sport slate.

Figures in H-K are `##`, unlike A-G — A-G's real numbers are precisely the
literals layer 2f exists to catch the model mining.

### The recurring defect class, named

A value whose name and measurement disagree. Eight instances this session, from
`docs/history-boundary.txt` pointing at a rebased-away sha to `scoreThreshold`
being a whole subsystem with only its consumer removed. `check-name-graph` is the
registry the six single-edge guards were each written instead of: run against
real pre-fix source it reports all three of era 6's rename breaks at once, which
took three separate days to find by hand.

### Open, with unblock criteria

- **No post-deploy EPL sample** for either the recap-context wiring or the
  attempt enrichment. Unblocks on the next EPL matchday; verify via
  `staged-verification.yml` check 4 with an EPL row carrying `generated: true`.
- **Dim 10's separation is UNDERPOWERED** — 16 agrees against 1 disagree.
  Unblocks at `margin_census.separation.n_disagrees >= 2`; the weekly cron
  (`0 6 * * 1`) reaches it or does not on its own.
- **34 rows make no closeness claim, 24 have a game row with a null
  `home_score`.** Both counted in every `rescore-quality-6b` manifest.
- **Five positive exemplars still carry real figures** (`29.0 PPG`, `48 minutes`,
  …). They are sport-gated now, so each reaches only its own sport, and 2f
  catches a leak. Neutralising them is content authoring.

### Security items still awaiting a decision

- Rotate `field-relay-cron-2026` and drop the relay's compiled-in literals
  (27 in `src/index.js`, 1 in `analytics-engine.js`, 5 workflows, 8 docs).
- Rotate/redact the `GITHUB_PAT` found in plaintext in a Drive doc — repo+workflow
  scope, can write secrets into all four repos. The value has never been
  reproduced in chat and must not be.

**Closed from the previous entry's "unchanged" list:** `scoreThreshold` 110 → 196
and `n: null` in `/quality/report`. Both turned out to be defects rather than
tuning: one inert, one publishing an arithmetic impossibility.

---

## SESSION CLOSE-OUT — 2026-08-23b (ask 6b, scoring era 4)

**HEAD:** `7c75dad` → `95bf3c0` · **Branch:** main throughout
**Session doc (Rule 67):** `outbox/cc-session-2026-08-23-ask6b-scoring-weights.md`
**Artifacts:** `outbox/rescore-quality-6b-2026-08-23T144*.json` (three runs),
`outbox/quality-scale-verify-20260823T145535Z.json` (11/11 live)

| commit | what |
|--------|------|
| `09aada2` | measure ask 6b's baseline before moving any weight |
| `91626aa` | evaluate candidate weightings on the rows already scored |
| `74dc759` | 245 is the ceiling for a slate brief, not for every brief |
| `95bf3c0` | era 4 — weight the dimensions that tell a finished game from an unfinished one |

Deploys 847 and 848 green. Live verification 11/11.

**Era 4**

```
arc 45->55   ctx 25->32   temporal 20->25
voice 30->20 density 16->10 matchup 30->24      nominal total held at 300
```

Measured on the same 190 rows before and after: in-progress/final gap
**6.4 → 11.5** points, **2.8× → 4.2×** the standard error. n=95 per class.

**Two premises this session had to correct**

- A first re-score over the 160 most recent rows reported the gap REVERSED.
  That sample was 144 finals to 16 in-progress; stratified to 95/95 the
  original direction holds. The artifact from the wrong run is committed and
  the session doc says which to believe.
- `UNREACHABLE_DIMS` called `ctx` unreachable "by construction". It scored
  above zero on 181 of 190 real rows. 245 is the slate-brief ceiling; the
  game-shape ceiling is 276 and the 240 bar is 86.96% of it, not 97.96% —
  which changes what "0 of 523 cleared 240" means.

**New deploy gate:** `check-scoring-era-recorded.mjs`. A `SCALE` edit without
a `SCORING_ERAS` entry now stops the deploy, and an era entry whose
`measuredEffect` carries no number is rejected. Negative-tested.

**Carry-forwards — both filed as commands, not carried (Rule 87)**

- `CC-CMD-2026-08-23-finality-dimension` — nothing in `scoreProse` reads game
  state; reweighting's ceiling is 41.6 and costs the rest of the rubric.
- `CC-CMD-2026-08-23-matchup-note-starvation` — Dim 10 scored zero on 190/190;
  `regular_season_games.note` is populated on 36/1284 finalized games.

Unchanged from earlier sessions: `scoreThreshold` 110 → 196 (needs a retry-cost
estimate), `n: null` in `/quality/report` rows.

---

## SESSION CLOSE-OUT — 2026-08-23 (recaps now say what happened in the game)

**HEAD:** `77eff06` → `90e6c99` · **Branch:** main throughout
**Session doc (Rule 67):** `outbox/cc-session-2026-08-23-match-events.md`
**Artifacts:** `outbox/scoring-containers-2026-08-23T05-58-*.json` (pre-build
probe), `outbox/staged-verification-20260823T061855Z.json` (post-deploy)

**Shipped**

| commit | what |
|--------|------|
| `8701b6b` | the sport-key table's multi-word entries were never reachable |
| `644d7f6` | ground briefs in ESPN scoring plays (ask 5) |
| `8c7b5a6` | run this session's quality-chain guards at the deploy gate |
| `90e6c99` | check 4's column names, read from the schema this time |

Deploy 846 green, all 13 gate steps. Client `575e5d3` mirrors CONTRACTS.md
byte-identically.

**Verified vs staged**

- VERIFIED here: `scripts/match-events-check.mjs` 25/25 and
  `scripts/sport-key-check.mjs` 13/13, both blocking at the gate. The
  sport-key negative tests fail against the pre-fix lookup, which is the
  artifact that the defect was real.
- STAGED: that a live recap names a scorer. Not a note — check 4 of
  `scripts/verify-staged-items.mjs` on the daily 06:00 schedule. Run 14
  reported `PENDING — no game_recap in the six sports since match_events
  deployed`, seven minutes after the deploy, which is the correct answer and
  proves the check runs end to end. Tonight's slate answers it.

**Two things found while building, both fixed**

- Every multi-word key in the sport-normalization table had been unreachable
  since it was written, so a D1 row reading "Major League Baseball" resolved
  to no ESPN slug and `buildESPNSummaryContext` returned '' with no error.
- Four guards written on 2026-08-22 were wired into nothing and would have
  kept passing while the code they guard drifted.

**Carry-forwards**

- A third sport-key table, `_CONTEXT_LEAGUE_TO_SPORT` (`src/index.js` ~8452),
  maps league labels to the same keys in the other file. Currently correct and
  consistent, which is when a table is cheapest to consolidate. Its own commit.
- NBA and NHL scoring containers are PENDING, not assumed — both out of season
  in August. Re-probe at season open; a wrong container presents as a silently
  missing block.
- `CC-CMD-2026-08-23-soccer-near-miss-enrichment` (filed in field-laboratory):
  ask 5's `commentary` layer was not built and is a second command, not a
  follow-up line.

---

## SESSION CLOSE-OUT — 2026-08-22b (the 240 bar has never been cleared)

**HEAD:** `aca5c93` → `e128a4f` · **Branch:** main throughout
**Session doc (Rule 67):** `outbox/cc-session-2026-08-22-quality-scale-verified.md`
**Artifact:** `outbox/quality-scale-verify-20260822T234307Z.json`

Ran the DONE CONDITION that `cc-session-2026-08-16-quality-bar-scale.md` wrote
for itself and left UNVERIFIED for six days on sandbox egress —
`rule-gha-for-sandbox-egress-blocks` says that is not a stopping point. All four
of that session's own assertions **PASS** live: `reachable_ceiling === 245`, and
`cleared_196` numeric on all 47 rows.

**The finding — 523 briefs over 7 days:**

| bar | cleared | rate |
|---|---|---|
| 240 (documented "excellence") | **0** | 0% |
| 196 (`FOUR_FIFTHS_REACHABLE`) | 61 | 11.7% |

No brief has ever cleared 240. With 55 of 300 points unreachable by
construction (`ctx`, `matchup`), 240 is **97.96% of what a brief can earn** — a
near-perfect-score requirement wearing an 80% label. **196 discriminates**,
which closes the adoption question 08-16 explicitly deferred.

**`scoreThreshold: 110` is inert, not wrong.** Both sites (`src/index.js:8855`,
the path writing every EPL game brief; and `:7337` wc-morning) predate the 240
standard. EPL briefs average 141.4, so 110 is cleared by ~30 points and the
retry gate never fires. NOT changed: 240 would fail all 523 into max-retry
exhaustion, 196 would retry ~88% — a Rule 78 spend decision needing a cost
estimate first.

**Also found:** `/quality/report` returns `n: null` on every row; totals derived
from `below_240` instead. Filed, not fixed (Rule 60/69).

**Re-runnable:** dispatch `verify-quality-scale.yml`.

---

## SESSION CLOSE-OUT — 2026-08-22 (staged FAIL diagnosis: a third closing-odds writer)

**HEAD:** `5f2fabb` → `aca5c93` · **Branch:** main throughout
**Session doc (Rule 67):** `outbox/cc-session-2026-08-22-staged-fail-diagnosis.md`
**Deploy:** run 834 (`0d74e2b`), 21:13:25Z, success

Two staged checks were FAILing. `soccer_opening_coverage` was the probe's fault
— it called a regression off a single fixture; over 30 days EPL rose to 66.7%
and La Liga to 22.2%, both above baseline. A 4-game floor now holds small
samples at PENDING.

`closing_after_opening` was real. The 41 failing rows came from a **third
closing_odds writer** — `/archive/game` — that wrote **no change_log row**, so
it had no attribution, and whose `start_time` gate did not test finality. It
fired pre-kickoff and pre-filled `closing_odds`, permanently defeating
AmbientDO's `WHERE closing_odds IS NULL` guard: 19 hook writes in all of
history. Second, independent cause: `captured_at` was stamped `new Date()` even
for noon-UTC historical snapshots, so the check was comparing cron execution
order, not market time. Both fixed (`f6fa820`, `a1937eb`).

**State:** `closing_after_opening` PENDING · `soccer_opening_coverage` PASS ·
`epl_brief_event_grounded` PARTIAL · **no false FAILs remain.**

**Follow-up is automated:** `staged-verification.yml` now runs daily at 06:00
UTC, reversing its own earlier "no schedule" argument — every answer so far had
required a human to remember to dispatch it.

**Standing:** the Odds API key is still unrotated, and `ODDS_API_KEY_FALLBACK`
in `src/index.js` is a hardcoded key constant in a public repo. Remove it as
part of rotation.

---

## SESSION CLOSE-OUT — 2026-08-20 (UEFA club competitions: archived at last)

**HEAD:** `8a6d05e` → `8289762` (feat) → `07b987e` (ci) · **Branch:** main throughout
**Session doc (Rule 67):** `outbox/cc-session-2026-08-20-uefa-club-competitions.md`
**Serves:** `docs/CC-CMD-2026-08-20-uefa-club-competitions.md` (filed by field-laboratory,
in that repo — not this one).

**The ask was already half-done, and its premise was stale.** `V2_LEAGUES` has
carried `ucl`/`europa`/`conference` with the exact slugs and BSD lids requested
since the June 26 migration, and `SOCCER_LEAGUE_LABELS` already declared all six
labels. Probing HEAD first (Rule 87) is what surfaced that.

**Real root cause — a third table nothing guarded.** `/context/date` reads ONLY
`ARCHIVE_DB`; the archive is written by the journalism cron iterating the
`LEAGUES` table (~L7500), which had no UEFA row. So `/v2/games?sport=ucl` worked
on demand while nothing was ever persisted — `/context/date/2026-08-19` listed 49
games with no Champions League among them, against config that reads as complete.
(Note: `/archive/query?sport=` reads the BRIEFS table, not `regular_season_games`.
The CC-CMD cited `count: 0` from it as games evidence; it is not. Its `/context/date`
measurements are the sound half.) The existing live
"Soccer league label contract check" passes either way, because an on-demand
fetch is healthy with or without a `LEAGUES` row.

**Declared labels (the laboratory's answer to ask 2)** — `sport` AND `league`
both carry the same string:
`UEFA Champions League` · `UEFA Europa League` · `UEFA Europa Conference League`
· `UEFA Champions League Qualifying` · `UEFA Europa League Qualifying` ·
`UEFA Europa Conference League Qualifying`.
The CC-CMD's suggested labels (no `UEFA` prefix) appear nowhere in this repo and
would have split each competition across two archive id namespaces.

**Qualifying slugs included deliberately.** Probed 2026-08-20 via CF-Worker
egress: `uefa.champions?dates=20260819` → `events: []`, while
`uefa.champions_qual` → real fixtures. The CC-CMD's own cited observation date is
a qualifying matchday, so the literal three-entry ask would have rendered zero
games on the very date that motivated it. Main-draw slugs stay empty until the
league phase opens 2026-09-16 per ESPN's calendar.

**Guard added (`07b987e`):** `scripts/check-leagues-label-contract.mjs`, blocking,
pre-deploy. (A) every soccer `LEAGUES` label is a declared `SOCCER_LEAGUE_LABELS`
value; (B) every `espnLeague`-routed soccer `V2_LEAGUES` key has a `LEAGUES` row,
except allowlisted `eflchamp`/`eflone`/`efltwo`. Both negative-tested — they fail
by name, and (A)'s test uses exactly the label the CC-CMD proposed.

**Integration status: VERIFIED end to end.** Deploy succeeded on `07b987e`
(13:09Z). Archive confirmed by CI-as-proxy probe (`uefa-archive-probe.yml` +
`scripts/probe-uefa-archive.mjs`, `d5a1002`) — a runner POSTs `/d1/execute`,
which binds `ARCHIVE_DB` and allows `regular_season_games`. Manifest
`outbox/uefa-archive-probe-manifest-20260820T131905Z.json`: `landed: true`,
**43 UEFA rows, 36 dated today** (Conference qual 24, Europa qual 12, UCL qual 4),
real fixtures (Shamrock v KuPS at Tallaght; Getafe v Partizan; Braga v Vienna).

The earlier `count: 0` readings were the briefs-table trap, not a missing write
path. `query_ok` is separate from `landed` in the manifest so a broken probe can
never be misread as an empty archive.

**Label fragmentation: CLOSED.** The probe found one row outside the six declared
labels — `2026-05-27-conference-crystalpalace-rayovallecano`, `sport: 'UEFA
Conference League'`, `created_at 2026-07-05`, from the early-July hand-seeded
schedule import (its id uses the legacy `{date}-{comp}-{home}-{away}` slug form, not
the cron seed's). Fixed by `6b0525f` — a dispatch-only, `APPLY`-gated, idempotent
one-shot that targets the row by primary key, asserts pre-state, and re-reads to
verify. Dry run then apply: `rows_changed: 1`, `verified: true`. Re-confirmed by
the independent archive probe: `labels_missing: []`, `nonconforming_count: 0`,
43 UEFA rows across all six declared labels.

Both one-shot workflows (`uefa-archive-probe.yml`, `uefa-label-fix.yml`) are
dispatch-only with no `schedule:` — deliberately, per the 2026-08-16 workflow
waste audit. They are inert until fired.

---

## SESSION CLOSE-OUT — 2026-08-16 (quality-bar scale: all 3 asks executed)

**HEAD:** `665c68f` (+ this) · **Branch:** main throughout
**Session doc (Rule 67):** `outbox/cc-session-2026-08-16-quality-bar-scale.md`
**Serves:** `docs/CC-CMD-2026-08-15-quality-bar-scale.md` (filed by field-laboratory).
Reporting/measurement only — **no scoring behaviour changed**.

**The finding:** 55 of the 300 rubric points are unreachable BY CONSTRUCTION in the
Worker runtime — Dims 7 (context) and 10 (matchup) have no game object and return
N/A→0. So the flat 240 bar is 80.00% of the nominal rubric but **97.96%** of what a
brief here can actually earn, and `below_240` near 100% is an arithmetic certainty,
not an editorial verdict.

**Ask 3 (derive the ceiling)** — added a `SCALE` table to `src/journalism-quality.js`
and derived `NOMINAL_TOTAL` (300), `REACHABLE_CEILING` (245), `FOUR_FIFTHS_REACHABLE`
(196) from it. `scoreProse`'s local `W` now derives from that same table instead of
holding a second copy — two parallel copies would drift, which is the exact failure
this ask exists to prevent. Verified the derivation reproduces every documented
figure: base 150 / nominal 300 / reachable 245 / four-fifths 196 / 80.00% / 97.96%.

**Ask 1 (name the scale)** — `/quality/report` now emits `quality_scale`
{nominal_total, reachable_ceiling, unreachable_dims, unreachable_points, flat_bar,
flat_bar_pct_of_nominal, flat_bar_pct_of_reachable, four_fifths_of_reachable}.
Emitted ALONGSIDE `below_240`/`above_240` rather than renaming them — the CC-CMD
offered either, and renaming breaks every current consumer (Rule 60).

**Ask 2 (cleared_196)** — the CC-CMD called this "the one thing worth running D1
for". It does not need a separate D1 session: `/quality/report`'s query is ALREADY a
`GROUP BY` over ARCHIVE_DB computing below_240/above_240 with the same
`SUM(CASE WHEN …)` shape, so this is one more line in a query that already runs. The
adoption question it deferred — is 196 discriminating or another unreachable bar —
is now answerable from the endpoint on every call, permanently. Self-completing
(Rule 87) instead of a carry-forward.

**Integration status:** code VERIFIED statically (`node --check` both files; all four
imported names resolve; derivation assertions pass). Live response UNVERIFIED from
sandbox (403s `*.workers.dev`); lands on the next push-triggered deploy.
DONE CONDITION (Rule 90): `GET /quality/report` returns
`quality_scale.reachable_ceiling === 245` and every `summary` row carries a numeric
`cleared_196` — exact curl+assert in the session doc.

**Correction:** an earlier claim in this session that the CC-CMD sat on a `claude/*`
branch was WRONG — `14ac236`/`55a3a34` are on main. Misread a coincidental
"[new branch]" line from an unrelated fetch. No branch-policy violation.

**Not executed here:** `docs/CC-CMD-2026-08-16-quality-coverage-route.md` (`be8b38f`)
— expose jq-scoring-coverage on a GET (per-day series, era3ByType, `scoring_version`
on /archive/query). Complementary but a separate CC-CMD. Also note: there is no
`/quality/coverage` route today; only `/quality/report` and `/quality/backfill-scores`.

**Companion client work (jubilant-bassoon):** NFL standings dropdown — 4 stacked
defects, 3 fixed, 1 OPEN (ESPN v2 standings returns HTTP 200 with an error body for
browser-origin requests). See that repo's HANDOFF.

## SESSION CLOSE-OUT — 2026-08-15b (ESPN fantasy ownership route)

**HEAD:** `6532d9d` (+ this) · **Branch:** main throughout
**Session doc (Rule 67):** `outbox/cc-session-2026-08-15-fantasy-ownership-route.md` — DONE, confidence 96
**Deploys:** 31853774282, 31854044681 — success. Done-condition artifact:
`outbox/verify-fantasy-ownership-*.log` 10/10 PASS (limit=400→count=400, Gibbs 99.87% owned).

`GET /fantasy/ownership` — ESPN percentOwned/percentStarted/ADP per player, reshaped to a
small `{ espnId: {name, proTeamId, percentOwned, percentStarted, adp} }` table, top-N by
ownership, zero-owned dropped, 6h edge cache. Transform not passthrough: kona_player_info is
header-driven (relayFetch keys on URL only) and the full set is ~25MB.

**ADR-002:** commodity (ESPN publishes it) + pull-only + proxy-not-compute + edge-cache-not-a-binding.
NOT a drama/watch/RUWT value. (Initial "engagement-adjacent" framing was wrong and corrected.)

**Caught + fixed live (Rule 77):** ESPN ignores the x-fantasy-filter limit (2615 rows for any
limit); the param was a no-op fragmenting the cache. `6532d9d` made it a real post-fetch cap.

**Cross-repo status (Rule 61):** relay half only. No client consumer yet — the NFL card is where
this renders, alongside the NGS/injuries chips. Client wiring is the open end-to-end step.

---

## SESSION CLOSE-OUT — 2026-08-15 (NFL data integrity, paired with jubilant-bassoon)

**HEAD:** `2e5f4d8` (+ this commit) · **Branch:** main throughout
**Session doc (Rule 67):** `jubilant-bassoon/outbox/cc-session-2026-08-15-nfl-b-pipeline-fixes.md`
— DONE, confidence 97 (the work is mostly client-side; both repos' commits are covered there)

Two relay commits, both paired with `jubilant-bassoon 317f9cb`:

1. **`680ac26`** — `ngs-passing.json` added to `NFLVERSE_OUT_ALLOWED`. It was in
   `NFL_R2_FILES` (R2-first) but not the fallback allow-list, so unlike
   `ngs-receiving`/`ngs-rushing` an R2 miss fell through to the allow-list check
   and 403'd, despite a fresh copy existing in the client's `outbox/nfl/`.
   Measured latent, not live: `outbox/nfl-route-coverage-probe-*.log` shows all
   three serving 200 from R2 today. `pfr-rec.json` / `player-stats.json`
   deliberately NOT added — they are R2-only (written by this relay's own cron)
   and would 404 rather than serve.

2. **`2e5f4d8`** — `runNFLR2Update` (`src/nfl-r2.js`): refuses zero-row writes
   (`count` was computed then ignored — same defect as MLB Savant `7588b24`), and
   stamps `season`/`targetYear` to match the client pipeline's envelope.

**Why #2 was necessary, not scope creep:** `nfl/{year}/ngs-passing.json` has TWO
independent writers — the client pipeline (Mon 07:00 UTC, nflverse **parquet**)
and this relay cron (Wed 12–15 UTC, legacy **CSV**). Wednesday runs last, so it
would have stripped the client's new season labelling off every week.

**Open, gated:** `docs/CC-CMD-2026-08-15-ngs-passing-two-writers.md` — one key,
two writers, two sources is the real defect; #2 only makes the race harmless for
the fields we know about today. That CC-CMD also covers this writer's hardcoded
`nfl/2026/` prefix, which diverges from the route's dynamically computed year
(`src/index.js` ~15797) from August 2027.

**NFL route coverage, measured today** (`outbox/nfl-route-coverage-probe-*.log`):
6/17 allow-listed files serve 200. The six nflverse Stage-1 tables
(`team_epa`, `qb_metrics`, `receiver_metrics`, `defense_metrics`, `schedule_refs`,
`team_tendencies`) all 404 — the relay half of that design was built in May and
the producing pipeline never was.

---

## SESSION CLOSE-OUT — 2026-08-14 (J-layer model provenance)

**HEAD:** `12e4018` (+ this commit)
**Branch:** main throughout
**Session doc (Rule 67):** `outbox/cc-session-2026-08-14-jlayer-model-provenance.md`
— DONE, confidence 97

**What changed:** `/test/gemini-judge` reported a hardcoded
`model: 'gemini-via-proxy'` — an assertion, never a reading. It now returns the
`X-FIELD-Model` the proxy actually sent, plus `X-FIELD-Gemini-Error`, using the same
provenance headers `src/index.js:8915` already reads at the journalism call site.

**Measured before changing (Rule 72):** CLAUDE.md's "Gemini 3.1 Flash-Lite primary,
Haiku 4.5 fallback" claim is **confirmed** — 6/6 calls across two runs answered by
`gemini-3.1-flash-lite`, header present every time, `X-FIELD-Gemini-Error` empty
every time (2026-08-14, direct POST from a GH Actions runner; fallback-under-quota
behavior NOT exercised). Artifacts:
`outbox/jlayer-model-probe-20260814T0126*.log` (before) and `...T0135*.log` (after,
live, `judgeRouteMatchesReality: true`).

**Deploy run 31760675673 attempt 1 failed and attempt 2 passed on identical code** —
a CF 1101 from field-claude-proxy in the post-deploy WOW 6 probe, not from this diff;
re-run rather than reasoned away.

**RESOLVED same day** — `docs/CC-CMD-2026-08-14-verify-test-model-override.md` executed.
Session doc: `outbox/cc-session-2026-08-14-test-model-override.md` — DONE, confidence 96.

The override **is** honored; round 1's null result was caused by sending a Claude
model name, which is outside the proxy's allow-list and falls through to the default.
But the discriminating arm found a live regression: **`gemini-3.5-flash` returns HTTP
500 from field-claude-proxy, 3/3, against 3/3 interleaved unforced controls at 200** —
deterministic, cache excluded by unique prompts. It worked on 2026-07-16.

**Production unaffected** (nothing in production sets `X-FIELD-Test-Model`; 9/9
unforced calls returned `gemini-3.1-flash-lite`). Two in-repo consumers are dead and
annotated in place, not deleted: `/debug/gemini-model-test` (`src/index.js` ~8926) and
`scripts/gemini-model-sanity-check.mjs`.

**Worth reading in that session doc:** the probe printed `VERDICT B — override
ignored, dead weight` and that verdict was **wrong**. Its predicate swept HTTP 500
into the same bucket as "answered with a different model" — opposite conclusions.
Accepting the summary line would have concluded the mechanism was dead weight while
missing the regression. Fixed at the root; non-200 is now its own class.

**J-layer impact check (asked and measured, not inferred):** a fresh `jq-health-watch`
run (`outbox/jq-health-watch-20260814T100504Z.log`) confirms the model work changed
nothing in the production journalism path — routing is unchanged and no production
call sets the override. Two real deltas vs the 08-13 baseline, neither caused by it:

1. **Era-scoped calibration ACTIVATED for `game_recap`** — the watch item from the
   08-13 provenance pass. `era_scoped=true`, era-3 n=19, and the threshold moved
   `157 → 184`. This raised `alert_count` `14 → 18`: the Dim 4 fix lifted scores, the
   era-3 p25 followed, and sports that cleared the old bar no longer clear the new
   one. Working as designed — the alert rise is the instrument re-zeroing, not a
   quality regression. `alert_count (legacy predicate)` held flat at 23 throughout.
2. **11 `pre_game` briefs never scored**, oldest 27 days — gated below. Distinct from
   the 4 unscored rows the same run showed in-window, which were in flight and scored
   within ~3h.

**RESOLVED same day** — `docs/CC-CMD-2026-08-14-unscored-pre-game-backlog.md` executed.
Session doc: `outbox/cc-session-2026-08-14-unscored-pre-game.md` — DONE, confidence 96.
Done condition artifact: `unscored rows (repo-wide, not window-scoped): 0`
(`outbox/jq-unscored-triage-2026-08-14T13-25-32-902Z.log`, post-deploy). Deploy 31804447440.

**Root cause was NOT the literal-NULL insert** the CC-CMD suspected. 105 of 116
pre_game rows come from that same writer and ARE scored. `context_hash` identified the
real mechanism: **105/105 scored rows were scored by a CLIENT round-trip** through
`/archive/brief`, whose upsert does
`quality_score = COALESCE(excluded.quality_score, briefs.quality_score)`. Where the
client never re-posted, the row stayed NULL forever — hence 4 days holding both scored
and unscored rows, which reads as intermittent because it tracks client behavior.

**Fix (`93ce859`):** bounded score-fill in the existing dead-hours block — max 5/tick,
all brief_types, Rule 5 guarded, `ORDER BY created_at ASC`. The ASC is load-bearing:
`/backfill/brief-scores` orders DESC, so any backlog past its LIMIT starves its own
tail permanently. Server-side completeness no longer depends on a client action.

**Not yet observed firing** — dead hours only (UTC 02:00–10:00) and there is currently
nothing to score. First real exercise needs a future NULL row.

**Disclosed side effect:** the 11 rows were scored under era-3 code but carry no
`scoring_version` (stamp-on-write still unbuilt), so the date-derived era will
attribute them to **era 2**. Small (11 rows, none `game_recap`) but it is this
session's recurring defect — a derived value with no stored provenance — resurfacing.
Strengthens `docs/CC-CMD-2026-08-13-stamp-scoring-version-on-write.md`; no new CC-CMD.

**Open, gated:** `docs/CC-CMD-2026-08-14-gemini-35-flash-route-500.md` — the fault is
in `workers/field-claude-proxy`, outside this repo's scope. Deliberately no relay-side
workaround (Rule 64/76). Cause unknown: the 500 body is a CF error page with no
`error code:` string, and `X-FIELD-Gemini-Error` does not populate on that path.

**Trap for the next session:** this working clone was shallow (52 commits, back to
2026-08-11 only). `git log -S` silently returns nothing for earlier history — run
`git fetch --unshallow` before any archaeology.

---

## SESSION CLOSE-OUT — 2026-08-13 (BSD average-positions + JQ scoring instrument)

**HEAD:** 47ba213 (+ this commit)
**Branch:** main throughout
**Session docs (Rule 67):**
- `outbox/cc-session-2026-08-13-bsd-avgpos.md` — DONE, confidence 95
- `outbox/cc-session-2026-08-13-jq-density-unit-fix.md` — DONE, confidence 95
- `outbox/cc-session-2026-08-13-jq-provenance-pass.md` — DONE, confidence 95 / 96
- `outbox/cc-session-2026-08-11-archive-gap-real-write-path.md` — DONE, confidence 96

### What changed, all verified against the live worker

1. **BSD average-positions served from `/stats/`** (`f6a1fd5`, `1e6b449`,
   `1f08656`). The dedicated endpoint 404s unconditionally — settled by
   probing a LIVE match (event 207955, `2nd_half`), which every prior
   investigation lacked and which CONTRACTS.md had recorded as an open
   question since 2026-07-15. Route now 200s with real player coordinates.
   The capture path's dead level-1 fallback removed, and an empty-write guard
   added: `{}` is what a match in progress returns and would otherwise
   overwrite populated positions.

2. **JQ Dim 4 measured the wrong unit** (`940e06b`). It counted
   `properNouns + numbers` while citing a rule that governs numbers, and was
   FLOORED for 91.2% of a 592-brief corpus. Now `numbers/sentence`: floored
   7.9%, mean contribution 0.35 → 9.89 of 16 points.

3. **`/quality/report` counted failures against a different number than it
   reported** (`88adb01`). Hardcoded 240 in SQL vs the calibrated p25 in the
   alert. 13 permanently-firing alerts, several reporting `failure_pct: 100`
   while exceeding their own threshold. Self-contradictory alerts now 0, and
   the same response carries the old predicate's count for comparison:
   **23 → 14**.

4. **Scoring provenance stored** (`430dfdf`, `496ea93`). `briefs.scoring_version`
   plus `SCORING_ERAS`, so calibration runs within a scoring era instead of
   across a mixture of two instruments. 3,156 historical briefs labelled
   (1941/1158/1, with 56 boundary-date rows correctly NULL).

### Method worth reusing

For a value that is a pure function of its inputs, **measure the inputs, not
the rendered output**, and compute every candidate variant over ONE dataset in
ONE run. The density census did this and its before/after is exact and
repeatable; the alert predicate did not, and its baseline was lost to elapsed
time until `alert_count_legacy_predicate` recovered it.

The session's unifying diagnosis: **a stored derived value with no stored
provenance**. Three independent instances — `pitch_arsenals` (empty R2 object
indistinguishable from never-fetched), BSD `average-positions`, and
`quality_score`.

### Open, with specs

- `docs/CC-CMD-2026-08-13-jq-dim1-unit-and-taper.md` — Dim 1's identical
  conflation (deliberately NOT changed: unlike Dim 4 it is not saturated) and
  the taper peak that docks its own exemplar 45%.
- `docs/CC-CMD-2026-08-13-stamp-scoring-version-on-write.md` — 13
  `INSERT INTO briefs` sites need enumerating before being stamped.
- `docs/CC-CMD-2026-08-10-pre-window-mls-duplicates.md` — 82 pre-window MLS
  duplicate groups, mechanism unmeasured.
- `docs/CC-CMD-2026-08-08-fa-cup-coverage.md` — blocked on ESPN rolling
  `eng.fa`; that claim is now ~5 days old and needs re-probing (Rule 72).

### Automated, not carried

`.github/workflows/jq-health-watch.yml` — daily 09:00 UTC, runs scoring
coverage + report verification and commits the artifact. Scoring measured
healthy at **312/312 over 7 days**. Era-scoped calibration is deployed but not
yet active: era 3 needs ≥5 briefs *per brief_type* (~0.3 days for
`game_recap`, ~7 for `epl_match`, possibly never for `compound`).

---

## SESSION CLOSE-OUT — 2026-08-06 (soccer-label-fix + CI honesty) — FINAL

**HEAD:** d0b9139 (+ this commit)
**Branch:** main
**Session docs:** `outbox/cc-session-2026-08-06-apply-soccer-league-label-fix-v2.md`,
`outbox/cc-session-2026-08-06-deploy-verify-commit-push-race.md`,
`outbox/cc-session-2026-08-06-close-rule-registry-carryforward.md`

### ⚠️ SUPERSEDES a carry-forward the last two close-outs both repeated

The 2026-07-25/27 and 2026-07-26/27 entries below both carry forward:

> `verify` job continues failing on pre-existing Rule-90 staleness gate
> — Rule-90/91/…/96 staleness gate — separate session, still pre-existing.

**That was accurate when written and became false on 2026-07-31.** Commit
`c2d2327` moved the staleness check out of `deploy.yml`'s blocking
`verify` job into the standalone, non-blocking
`rule90-staleness-monitor.yml` (daily). Those historical entries are left
intact above/below as the honest record of what those sessions saw — this
entry supersedes them. **Do not re-inherit "deploys are blocked by Rule
90"; they are not, and have not been since 2026-07-31.**

But do not read that as "nothing outstanding" either:

- The **staleness condition is still real and still red daily** —
  `rule90-staleness-monitor.yml` has failed every run since at least
  2026-08-02. It no longer gates deploys; it is still an honest signal.
- As of this session: `rule-92` (Watch Engine WC tier selection),
  `rule-93` (OTW momentum), `rule-94` (`_fieldDataReady` sentinel) remain
  UNEXERCISED at 25.7 days. **This is correct, not a gap to close** — no
  session has had a genuine applicable case, and Rule 90's own text calls
  an honest UNEXERCISED "the correct signal to surface… not a false alarm
  to suppress." Flipping them without a real case is fabrication (Rule 2).
- `rule-90` itself was flipped to EXERCISED this session with a real case
  (run `31117941940`): the carry-forward above is *itself* an instance of
  RULE-COMPLIANCE-FOLLOWUP-A — the mechanical artifact held the true state
  while the human-propagated HANDOFF channel went stale and wrong.
- `rule-98` (added 2026-08-03) is UNEXERCISED but only ~3 days old — not
  yet stale, no action needed.

### Commits this session
- `3235749` — fix: archived soccer games labeled by real competition, not always the World Cup
- `7f51bdd` — fix: verify job's lost push race no longer reports healthy deploys as failures
- `9078d8a`, `fa3e37c` — soccer-league mislabel scope probe (slate/scope/apply/verify) + weekly regression guard (`504b0e5`)
- `b2baf5f`, `d0b9139` — one-shot rule-registry exercise (rule-90 only)

### Result
- **Soccer label bug fixed; 52 rows mislabeled as the World Cup corrected
  to their real competition (all MLS)**, 103 genuine World Cup rows
  untouched, 0 mismatches remaining. Weekly regression detector added
  (`soccer-league-mislabel-scope-probe.yml`, Mondays).
- **Deploy runs can report `success` again.** Run `31114735011` is the
  first fully-green run; `verify`'s `Commit results` step no longer fails
  the whole run on a lost push race, while a genuine *permission* failure
  still fails loudly.

### Known-noisy, not a defect
GitHub Actions had a real platform incident during this session —
`Failed to resolve action download info. Error: Service Unavailable`
killed three runs in `Set up job` before any repo code ran
(`31115370947`, `31116882733`, `31117153055`). Unrelated to any change
here. The one-shot exercise workflow was rewritten to drop its
unnecessary `actions/checkout` dependency as a result.

### Carry-forwards
- None from this session. The Rule-90 item above is **not** a
  carry-forward — it is a standing, correct signal with no action
  available until a genuine case for rules 92/93/94 arises.

---

## SESSION CLOSE-OUT — 2026-07-26/27 (journalism-brief-history) — FINAL

**HEAD:** cff1477
**Branch:** main
**Session doc:** outbox/cc-session-2026-07-26-journalism-brief-history.md

### Commits this session
- `cff1477` — feat: add /journalism/brief/history endpoint -- browse past slate briefs from ARCHIVE_DB

### Result: /journalism/brief/history SHIPPED (relay side VERIFIED, client side STAGED)

- Root cause: `/journalism/brief` only reads FIELD_JOURNALISM KV (24h TTL) — could never show more than today's brief.
- Fix: new route reads the durable `ARCHIVE_DB.briefs` table (`brief_type='slate'`), same table `findBriefs()` already queries for `priorBrief`. No new storage, no new write path.
- `GET /journalism/brief/history?limit=N` (default 14, capped 1-30) → `{ok, count, briefs:[{date, brief, proseScore, wordCount, model, source, generatedAt}]}`.
- **Field-naming flag:** `generatedAt` here is a SQLite UTC string, NOT epoch ms like `/journalism/brief`'s `generatedAt`.
- Live verification (verbatim, `probe_relay_route`): HTTP 200, 3 real archived briefs returned across 2026-07-25 and 2026-07-26, newest first.

**CI gate note:** `verify` job continues failing on pre-existing Rule-90 staleness gate. Unrelated to this change — `deploy` job (structural probes, wrangler deploy) succeeded.

### Carry-forwards
- Client-side CC-CMD (jubilant-bassoon) needed to wire the Journalism tab to this endpoint — out of scope for this relay-only session.
- Rule-90/91/92/93/94/95/96 staleness gate — separate session, still pre-existing.

---

## SESSION CLOSE-OUT — 2026-07-25/27 (playground-secret-bootstrap) — FINAL

**HEAD:** ea2bf38
**Branch:** main
**Session doc:** outbox/cc-session-2026-07-25-playground-secret-bootstrap.md

### Commits this session
- `175e1f6` — ci: add field-playground CLOUDFLARE_API_TOKEN bootstrap step to deploy.yml
- `48873cd` — fix: correct Salsa20/HSalsa20 rotation -- >> to >>> (unsigned) in sealedBox
- `b145307` — docs: session close-out — playground-secret-bootstrap [skip ci]
- `0729094` — feat: add /delete route to Deploy Courier + one-off step to remove field-playground/wrangler.jsonc
- `ea2bf38` — ci: remove one-off wrangler.jsonc delete step (task complete, avoid permanent scope creep)

### Result: playground-secret-bootstrap COMPLETE + wrangler.jsonc cleanup COMPLETE

- Bootstrap step added to deploy.yml. Mirrors jubilant-bassoon bootstrap pattern exactly.
- Root cause of prior 422: `sealedBox()` used signed right shift `>>` in HSalsa20/Salsa20 rotations. Fixed to `>>>` throughout `hsalsa20()` and `salsa20Blk()` in `workers/field-deploy/src/index.js`.
- Courier response (verbatim): `{"ok":true,"message":"Secret CLOUDFLARE_API_TOKEN created in jeffunglesbee-create/field-playground"}`
- `deploy-playground.yml` dispatched and succeeded (GHA run `4b89406`, 2026-07-25T23:39Z). Live HTTP 200 check embedded in that workflow passed.
- Done condition met: `https://field-playground.jeffunglesbee.workers.dev/` returns HTTP 200 with no human credential entry.
- **Follow-up (2026-07-27):** `field-playground/wrangler.jsonc` duplicate deleted. Added general-purpose `/delete` route to the Courier (mirrors `/push`'s pattern — target repo is a body param, uses existing `GITHUB_PAT`, no new credential), invoked once via a temporary deploy.yml step, then removed the step. Courier response (verbatim): `{"ok":true,"message":"Deleted wrangler.jsonc from jeffunglesbee-create/field-playground","commit":"c711f18b1b224ac0166e867ecd2a478c9d959bb0"}`.

**CI gate note:** `verify` job continues failing on Rule-90 staleness (rule-90 through rule-96 entries >14 days). Pre-existing, separate session required.

### Carry-forwards
- Rule-90/91/92/93/94/95/96 staleness gate — separate session to exercise entries.

---

## SESSION CLOSE-OUT — 2026-07-25 (start-time-persistence) — FINAL

**HEAD:** c2e667e
**Branch:** main
**Session doc:** outbox/cc-session-2026-07-25-start-time-persistence.md

### Commits this session
- `c2e667e` — feat: add start_time to regular_season_games and postseason_games INSERT + ON CONFLICT

### Result: start_time persistence COMPLETE

- TASK 1: `ALTER TABLE regular_season_games ADD COLUMN start_time TEXT` + `ALTER TABLE postseason_games ADD COLUMN start_time TEXT` — both executed against field-archive D1 (cc49101c).
- TASK 2: Both INSERT statements in `src/index.js` updated with `start_time` in column list, VALUES, bind list, and `ON CONFLICT ... COALESCE`. Deployed at c2e667e (wrangler deploy job success, run 30177665738).
- TASK 3: Verified — `start_time` key present on `/context/date/2026-07-25` game objects; D1 direct insert confirmed value persists correctly. Pre-existing rows `null` as expected.

**CI gate note:** `verify` job has been failing since pre-session (fece9027) due to stale rule-90–97 registry entries (>14 days). Pre-existing, unrelated to this change. Wrangler deploy itself succeeded.

**Format:** `gm.startTime` sourced from ESPN CDN `comp.date` — UTC ISO 8601 `YYYY-MM-DDTHH:MM:SSZ`, consistent across all ESPN sports.

### Carry-forwards
- None from this session. Pre-existing rule-90/91/92/93/94/95/96 staleness gate needs a separate session.

---

## SESSION CLOSE-OUT — 2026-07-22 (add-field-playground-repo) — FINAL

**HEAD:** 0348dfd (after GHA verify result commit)
**Branch:** main
**Session doc:** outbox/cc-session-2026-07-22-add-field-playground-repo.md

### Commits this session
- `a4654ee` — docs: CC-CMD — extend FIELD Handoff MCP repo enum to include field-playground [skip ci]
- `4f64d33` — feat: field-playground as a third valid repo for FIELD Handoff MCP tools (REPO_NAMES, routing fix, schema enums)
- `8c9c15f` — ci: field-playground MCP live verification workflow + session doc [skip ci]
- `0348dfd` — chore: field-playground MCP verification result [skip ci] (GHA auto-commit)

### Result: field-playground MCP routing COMPLETE — 100/100

`REPO_NAMES` extended to include `field-playground` (line 153). Binary ternary routing bug in `trigger_workflow` fixed (line 16198 — was silently routing any non-jubilant-bassoon value to field-relay-nba; now routes through REPO_NAMES with jubilant-bassoon default). All 10 tool schema enums updated from 2-value to 3-value. Archive handler confirmed covered automatically via REPO_NAMES.

**Live verification (GHA run 29962867352, 2026-07-22T22:26:46Z):**
- `read_file README.md repo=field-playground` → HTTP 200, `{"repo":"field-playground","path":"README.md","sha":"a731811c6e244bbeb3d4e04b168fe1b6e7794fa7","size":18,"content":"# field-playground"}` — PASS
- `commit_file docs/mcp-access-confirmed.md repo=field-playground` → HTTP 200, `{"repo":"field-playground","path":"docs/mcp-access-confirmed.md","created":true,"commit":"e2f3f3e6b1bc9244823537079f1d9af78515253e"}` — PASS

Both responses reference `field-playground`. No silent fallback. `docs/mcp-access-confirmed.md` exists in field-playground at commit `e2f3f3e`.

### Carry-forwards
- None.

---

## SESSION CLOSE-OUT — 2026-07-21 (record-streak-board) — FINAL

**HEAD:** 8c5e1bf (after CI auto-commit live-verify outbox)
**Branch:** main
**Session doc:** outbox/cc-session-2026-07-21-record-streak-board.md

### Commits this session
- `11e6489` — feat: Phase 13 Record Streak Board — real win/loss streaks, separate from Phase 7's quality-based streak_board (fixes streak-board-metric-mismatch)
- `ddf9a41` — ci: add Phase 13 record-streak-board probe to verify job [skip ci]
- `8c5e1bf` — chore: post-deploy live verification [skip ci] (CI auto-commit)

### Result: Phase 13 SHIPPED — real win/loss streaks live

`runPhase13RecordStreakBoard` added to `src/analytics-engine.js`, wired into `processDate` + `PURE_PHASE_DISPATCH`. New `/analytics/record-streak/recompute` endpoint in `src/index.js`. `record_streak_board` field added to newspaper bundle.

**Live verification (deploy run 29864646895):** POST → HTTP 200, `ok: true`. Real teams: Red Sox (MLB) streak=10, Lynx (WNBA) streak=6. Phase 7 untouched: Brewers streak=19 (quality streaks, distinct). Newspaper null = SOFT-SKIP (cache timing; populates on next nightly cron). Confidence: 100/100.

### Carry-forwards
- Client (jubilant-bassoon) CC-CMD required: rewire STREAK BOARD card from `streak_board` (Phase 7 quality) to `record_streak_board` (Phase 13 win/loss). Codex incident `streak-board-metric-mismatch`: relay side RESOLVED, client side OPEN.

---

## SESSION CLOSE-OUT — 2026-07-21 (chat-closeout) — FINAL

**HEAD:** 561ab98
**Branch:** main
**Session doc:** outbox/cc-session-2026-07-21-chat-closeout.md

### What happened
Chat session close-out. Pushed the pending outbox + HANDOFF commit (`561ab98`) that
carried over from the prior context window. No src/ changes. Research only.

**Verify job:** VERIFIED and stable. Run 29843677043 (`workflow_dispatch`, HEAD
`8379f69`): `success`. All 9 probe steps green. System is clean.

### Carry-forwards
- Cancel GitHub Support ticket for workflow ID 317109373 if opened — YAML syntax
  error was the root cause, not a GitHub-side freeze. Ticket is unnecessary.

---

## SESSION CLOSE-OUT — 2026-07-21 (verify-job-deploy)

**HEAD:** bbbe4af
**Branch:** main
**Session doc:** outbox/cc-session-2026-07-21-verify-job-deploy.md

### Commits this session
- `7174db2` — ci: migrate verify job into deploy.yml; delete broken post-deploy-verify.yml
- `bbbe4af` — ci: fix YAML syntax error in verify job -- convert heredoc steps to base64

### Result: verify job wired into deploy.yml; YAML fix confirmed; run in progress

All verification steps from `post-deploy-verify.yml` are now a second job (`verify`, `needs: deploy`) inside `deploy.yml`. The broken standalone workflow is deleted.

**Root cause retrospective:** Prior sessions diagnosed the `post-deploy-verify.yml` failure as a "GitHub YAML indexing freeze." The actual cause was almost certainly a YAML syntax error — `python3 - <<'PYEOF'` heredoc content at column 1 breaks YAML literal block scalar parsing, producing identical symptoms (0 jobs queued, `name` field showing file path). The GitHub Support escalation (workflow ID 317109373) is likely unnecessary.

**YAML lint added to workflow edit protocol:** `python3 -c "import yaml; yaml.safe_load(...)"` before every push.

**Verify job status:** VERIFIED. Run 29843677043 (`workflow_dispatch`, 15:22:38Z, HEAD `8379f69`): `success`. Both deploy + verify jobs passed. All 9 probe steps green. Confidence-gate flagged two prior sub-95 docs on first run; both reviewed and acknowledged in `docs/confidence-gate-acknowledged.txt` (`8379f69`); second run clean.

### Carry-forwards
- Cancel GitHub Support ticket for workflow ID 317109373 if it was opened — root cause was YAML syntax error in the workflow file, not a GitHub-side registry freeze.

---

## Prior state (truncated for brevity — see git log for full history)

Prior sessions: 2026-07-21 (push-trigger-fix), 2026-07-21 (recreate-workflow-new-filename), 2026-07-21 (test-real-commit-reindex), 2026-07-21 (investigate-post-deploy-verify-failures), 2026-07-21 (complete-combined-judge-test), 2026-07-21 (fix-test-route-allowlist), 2026-07-21 (combined-prefilter-test), 2026-07-20 (workers-ai-judge-test), 2026-07-20 (amnesty-leaderboard-relay), 2026-07-20 (MLS novel metrics), 2026-07-20 (mls-journalism-xg-fix audit).
