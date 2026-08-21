# field-laboratory summary — CC-CMD-2026-08-20-brief-data-quality

**Date:** 2026-08-21 · **Repos touched:** field-relay-nba, jubilant-bassoon
**Session doc:** `field-relay-nba/outbox/cc-session-2026-08-21-brief-data-quality-asks-3-4-6.md`
**Status:** asks 1, 2, 3, 4a, 4b, 6a SHIPPED and deployed. Ask 5 unblocked and
fully specified. Ask 6b needs a rescope before it can be built.

---

## 1. What shipped

| ask | change | guard |
|-----|--------|-------|
| 1 | `game_recap` vs `game_live` vs `narrative_context` classified from real finality, not from `home_score != null` | `check-game-recap-classification.mjs` |
| 2 | 41 genuinely mislabelled rows identified (not the 513 first reported — see below) | same |
| 3 | pre-game writer binds `canonicalizeWC26Sport(label)`, not `label.toLowerCase()` | `check-brief-sport-label.mjs` |
| 4a | `/archive/brief` rejects ordinal `game_id` with 400 | — |
| 4b | client sends real event ids (`_briefGameId`) and real league labels, not `inferSport()` output | smoke A-BRIEFSPORT-1/2, A-BRIEFID-1 |
| 6a | `scoring_version` written on all brief INSERTs | — |
| — | raw drama number removed from journalism prompts | `check-no-drama-number-in-prompts.mjs` |

Four guards now gate every relay deploy. Client smoke: **985 passed, 0 failed**.

---

## 2. Corrections the laboratory doc needs

These are places where the CC-CMD's stated premise did not survive measurement.
Listed so the doc stops carrying claims the data contradicts.

### Ask 5 — the container name is wrong for four of five sports

The doc scopes ask 5 on ESPN `keyEvents`. **`keyEvents` does not exist for MLB,
NBA, NHL or NFL.** Measured 2026-08-21 against real finalized events:

| sport | container | filter | prose field |
|-------|-----------|--------|-------------|
| soccer | `keyEvents` | `scoringPlay === true` | `text` |
| MLB | `plays` | `scoringPlay === true` | `text` |
| NBA | `plays` | `scoringPlay === true` | `text` |
| NHL | `plays` | `scoringPlay === true` | `text` |
| NFL | `scoringPlays` | *(all items scoring)* | `text` |

The prose is there and it is exactly what the ask promises — its own example was
"Rice's 447-ft homer":

```
MLB    "Walker homered to center (407 feet), Wetherholt scored and Herrera scored."
NBA    "Paolo Banchero makes driving layup (Anthony Black assists)"
NHL    "Cole Caufield Goal (22) Wrist Shot, assists: Noah Dobson (21)"
NFL    "Woody Marks 20 Yd Run (Ka'imi Fairbairn Kick)"
soccer "Goal! Shamrock Rovers 1, KuPS 0. Enda Stevens (Shamrock Rovers) right
        footed shot from the centre of the box to the centre of the goal."
```

This is now recorded in `CONTRACTS.md` in both repos, so the build reads it from
there rather than from the CC-CMD.

### Ask 5 — cost was never the blocker

The doc treats the ESPN fetch as a Rule 78 concern. It is not, at the right
cadence:

- **Once per game at finalization: ~28 calls/day** (14-day mean of 28 games/day).
- Per cron tick would be 2,688 calls / 790 MB/day — that is the thing to avoid,
  not the feature's cost.

Rule 78 still applies to the extent that the fetch must replicate the existing
`cacheEverything` + TTL pattern.

### Ask 5 — two stale hedges to delete

- The `**Artifact (conditional on the premise holding):**` hedge — the premise
  holds; the conditional is now misleading.
- The probe block's column-coverage query, which reproduces the misleading 17%
  MLS figure. MLS `game_recap` briefs join **83/83 (100%)**, and the 6-digit MLS
  ids *are* `espn_event_id` values. The 17% was a key-space artefact, not a
  coverage problem.

### Ask 6b — the premise is falsified, and the rescope is different work

The doc says the quality metric is **inverted**. Measured baseline says otherwise:

| brief kind | n | mean score |
|------------|---|-----------|
| in-progress language | 94 | 184.3 |
| reads as final | 1381 | 190.1 |

Finals score *higher*, not lower. The metric is not pointed the wrong way — it
**fails to penalise in-progress prose strongly enough** (a 5.8-point gap where
these should be far apart). That is a weighting change, not a sign flip, and it
needs a before/after re-score to produce a real `measuredEffect` for the
`SCORING_ERAS` entry. `scoring_version` coverage today: ver 1 = 716, ver 2 = 518,
null = 241.

### Ask 2 — 513 was an upper bound, not a defect count

`briefs` has `created_at` and no `updated_at`, and every write site's
`ON CONFLICT DO UPDATE` refreshes `brief_text` without touching `created_at`. So
a row seeded pre-game and later refreshed with real recap prose still reads as
"written before kickoff". Intersecting with in-progress *language* gives
**41 real defects**; the other 472 are merely-updated rows.

---

## 3. New decisions adopted (in `CONTRACTS.md`, both repos)

1. **Generate from `text`, not the structured participant fields.** Soccer
   `participants[]` has no role field at all — role is positional (`[0]` scorer,
   `[1]` assister). But the assister is structurally present on only **8 of 14**
   assisted goals, while `text` carried it **14/14**. Structured names also
   disagree with the prose ("Dali" vs "Dalisson De Almeida"). Use
   `participants[0].athlete.id` for joins only.

2. **Soccer near-miss enrichment — IN.** `commentary` carries `Shot Off Target`,
   `Shot Hit Woodwork` and `Foul` events that `keyEvents` does not contain at
   all. Availability over 20 fixtures: **12 rich-tier** (98–129 commentary items,
   5–16 near-misses), **8 sparse** (18–29 items, 0 near-misses) — clean bimodal,
   nothing in between, so `commentary.length >= 60` detects tier before parsing.
   ~60% availability; recaps degrade to goals-only on sparse fixtures. The same
   tier governs whether `participants[1]` is populated.

3. **`keyEvents` and `commentary` overlap; neither is a superset.** Verified by
   per-item id join across 6 fixtures. `keyEvents` uniquely holds substitutions
   and period markers; `commentary` uniquely holds near-misses. **All goal items
   appear in both** (0 missing), so the goal read path is safe either way.

---

## 4. Known trap for the ask 5 build

**NBA volume.** Scoring items per completed game: NFL 8, NHL 8, soccer 2–4,
MLB 11, **NBA 119** — every made basket is a scoring play. A generator that
concatenates scoring items produces a usable paragraph for four sports and an
unusable wall for basketball. NBA needs selection, not enumeration.

---

## 5. Residual — needs your authorization (live D1 mutations)

None of these were executed; all are writes to production data.

| item | count | notes |
|------|-------|-------|
| non-conforming `briefs.sport` values | **601** across 20 variants | mappings below |
| ordinal `gNN` game_ids | **539** | not recoverable — see 5.4 |
| mislabelled `game_recap` rows | 41 | the real ask-2 defects — see 5.5 |

(539 is the census figure. An earlier note in this session said 535; that was
from a narrower slice and the census number is the one to use.)

### 5.1 The mappings

"Non-conforming" = the value matches no declared label, so the row is invisible
to every sport-filtered read. Census taken 2026-08-21 (`query_ok: true`).

**Class A — lowercased by the relay's pre-game writer (235 rows, 8 variants).**
This is the ask-3 bug, now fixed at source. **The correct label is recoverable
from each row's own id**, which was built separately and kept its casing:

```
id:    pre_game_La Liga_2026-08-19_atltico_mlaga
sport: la liga                       <- the defect
```

So this class needs no hand-written map — the migration reads the label out of
the id and is verifiable row by row.

| value | rows | → |
|-------|------|---|
| `mlb` | 133 | `MLB` |
| `mls` | 77 | `MLS` |
| `la liga` | 7 | `La Liga` |
| `pga tour` | 6 | `PGA Tour` |
| `nfl` | 6 | `NFL` |
| `uefa europa conference league qualifying` | 3 | `UEFA Europa Conference League Qualifying` |
| `fifa world cup` | 2 | `FIFA World Cup` |
| `uefa europa league qualifying` | 1 | `UEFA Europa League Qualifying` |

**Class B — client display strings from `inferSport()` (324 rows, 3 variants).**
These are formatted for section headings, not for storage. Mechanical:

| value | rows | → |
|-------|------|---|
| `Baseball (MLB)` | 303 | `MLB` |
| `MLS Soccer` | 14 | `MLS` |
| `Australian Football (AFL)` | 7 | `AFL` |

**Class C — case variant (10 rows).** `PGA TOUR` → `PGA Tour`. All-caps rather
than lowercase, so Class A's id-recovery does not apply; it is still unambiguous.

**Class D — context strings, where the label got concatenated with the round
(10 rows, 6 variants).** The declared label is the prefix:

| value | rows | → |
|-------|------|---|
| `CFL – 2026 Season · Week 7` | 2 | `CFL` |
| `CFL – 2026 Season · Week 6` | 2 | `CFL` |
| `CFL – 2026 Season · Week 5` | 1 | `CFL` |
| `CFL – 2026 Season · Week 10` | 1 | `CFL` |
| `AFL 2026 — Round 15` | 2 | `AFL` |
| `NBA Playoffs` | 2 | `NBA` *(see below)* |

`CFL` is confirmed as this project's declared label at `src/index.js:8034`
("sponsor-neutral, stable label"), so these four are determinate, not guesses.

**Totals check:** 235 (A) + 324 (B) + 10 (C) + 10 (D) + 22 (E) = **601 rows**
across 8 + 3 + 1 + 6 + 2 = **20 variants**. Matches the census exactly.

**Class E — `football` (21 rows) and `wc` (1 row) → `FIFA World Cup`.**
Determined by reading the rows, not by inference from the string. All 21
`football` rows are World Cup group-stage content — Mexico at the Azteca,
Ecuador–Germany at MetLife, Curaçao–Ivory Coast, a Group E decider — written by
`kv_sweep` on 2026-06-25/26 with 7-digit api-sports ids. `NFL` was the other
plausible reading and it is ruled out by the content.

### 5.2 The one real judgment call

**`NBA Playoffs` (2 rows).** Mapping to `NBA` makes the rows reachable but
discards the postseason distinction the string carries. That distinction is not
lost overall — postseason games live in `postseason_games` — so `NBA` is the
recommendation. Flagged rather than folded into the mechanical set because it is
the only mapping here that throws information away, and it is 2 rows, so
deferring it costs nothing.

### 5.3 Two values that look wrong but are NOT

`wnba` (34 rows) and `golf` (9 rows) are lowercase but report
`sport_known_to_games` > 0 — the games table itself carries those forms. They are
conforming. Folding them into a "fix all lowercase values" sweep would break
working joins.

Root cause of the label fragmentation is `inferSport()` in
`jubilant-bassoon/src/utils/sport-format.js:11` — it emits display strings like
`"Baseball (MLB)"`. Fixed at the call sites rather than in `inferSport` itself,
because it also feeds section headings (Rule 69).

---

## 6. Infrastructure added this session

- **`contracts-identity-check.yml`** in both repos. `CONTRACTS.md` had drifted
  **173 lines** apart, stale since 2026-06-30 — silent divergence in the file
  that exists to prevent silent divergence. Now checked on every push touching
  it, from both sides, no cron. Negative-tested three ways (identical → pass;
  missing section → fails and names the section; missing file → fails loudly).
- Four deploy-gating guards listed in §1.

---

## 7. Still unprobed (flagged, not assumed)

- Whether every `keyEvents` item appears in `commentary` **beyond goals** — the
  set comparison covered 6 fixtures; goals are confirmed, the rest is sampled.
- Soccer league-slug resolution for non-UEFA competitions: the probe hard-codes
  `uefa.europa.conf_qual` and tries a candidate list. A production build needs a
  real slug source.

---

### 5.4 The 539 ordinal `gNN` game_ids — NOT recoverable

Brief `game_id` shapes across the whole table:

| shape | n |
|-------|---|
| 9-digit espn-like | 2272 |
| 6-digit numeric | 590 |
| **ordinal `gNN`** | **539** |
| other | 1 |

These came from the client's render-order counter (`_id = "g" + (++_gid)`).
**The critical difference from the sport mappings: an ordinal carries no
information about which game it was.** `g47` means "the 47th card rendered in
that session" — it is not stable across renders, so it cannot be joined, and
unlike the Class A lowercase values there is nothing in the id to recover the
truth from.

Re-identification would have to come from the row's other columns — `date`,
`sport`, and the team names inside `brief_text` — matched back against the games
table. That is a heuristic, not a lookup, and it will not resolve every row.

Three options, in order of what I would suggest:
1. **Leave them.** They are inert: unreachable by id-based reads but harming
   nothing, and new writes are already blocked (ask 4a returns 400, ask 4b sends
   real event ids).
2. **Text-match re-identification**, accepting partial success and recording the
   match rate.
3. **Delete.** Cleanest table, permanent loss of the prose.

No action is needed to stop the bleeding — that part already shipped.

### 5.5 The 41 mislabelled `game_recap` rows

Current `brief_type` distribution: `game_recap` 1475, `narrative_context` 171,
`game_live` 24.

The 41 are rows typed `game_recap` whose `created_at` precedes kickoff **and**
whose prose uses in-progress language ("scoreless", "at halftime", "through 40
minutes"). Both conditions are required — timestamp alone gave 513, which is an
upper bound, not a defect count, for the `updated_at` reason in §2.

Remediation is a reclassification, not a rewrite: these are correctly-written
*live* briefs wearing the wrong type. Retyping them to `game_live` makes the
label true and leaves the prose intact. Regenerating as real recaps is also
possible but needs a finalized-game fetch per row.

### 5.6 A separate gap the join rate exposes

`game_recap` join rate is **1196 / 1452 (82%)**, both game tables unioned and
golf excluded. The remaining 18% is not one problem:

- **Missing game rows.** Sampled unjoinable ids are well-formed 9-digit MLB
  values (`401873710`, `401816308`, `401901849`…) whose game rows simply are not
  in D1. That is a seeding gap, not a label or id defect.
- **A prefix format.** `game_recap_wc26_espn:760516` stores `espn:760516` — the
  `espn:` prefix means it will never match a bare numeric column.

Neither is in scope for the three items above; both are listed so the 82% is not
mistaken for evidence about them.

---

## 8. Verification of rev 4 (probed 2026-08-21 15:13–15:16 UTC)

Rev 4 folds in this session's corrections accurately. Three of its figures were
re-checked rather than inherited (Rule 72), and one of them moved.

### 8.1 The gNN guard IS holding — verified non-vacuously

Rev 4 says 535 ordinal ids; the census said 539. Four more rows looks like a
shipped guard that does not guard, so it was checked properly.

- Newest ordinal row: **04:26:12**. Client fix `7eb5d388`: **04:40:50**. Every
  gNN row predates the fix.
- **Positive control** — "no new bad rows" proves nothing if the client wrote
  nothing since. Client-source briefs after 04:41: **6 writes, `still_ordinal: 0`**,
  carrying real event ids (`823746`, `823420`, `823510`, `824721`).

The guard works. 535 → 539 was measurement drift between two probe runs, not
leakage. **Use 539.**

### 8.2 EPL is still NOT being carried — opens tomorrow

Rev 4's EPL-readiness claim was a day old with a deadline of 2026-08-22.
Re-checked against the relay's own served view (the thing the client renders,
not ESPN, which answers a different question):

```
/context/date/2026-08-22   -> 15 games, {"MLS": 15}, has_epl: false
/archive/query?date=2026-08-22 -> count 1  (a single MLB row)
```

**Unchanged. The 2026-27 Premier League opens tomorrow and FIELD carries none of
it.** This is the most time-critical item in the document and it is not one of
the shipped asks — ask 3 gave EPL a *label contract*, not an *archive seed*.

### 8.3 The residual is 601, not 784 — my query, not the data

A `NOT EXISTS` recount returned **784 rows / 20 variants** against the census's
601. Resolved: the gap is **183 rows with `sport IS NULL`**, which the census
grouped separately.

Those are **not defects**. They are overwhelmingly `brief_type: 'slate'` —
cross-sport daily briefs that legitimately have no single sport and no
`game_id` (`slate_2026-08-21_cron`, `slate_2026-08-20_all`, …). They run back to
**2026-06-15** across 4 sources at a steady 2–3/day.

Also checked, because the timing implicated it: **ask 3's fix did not create
this class.** The old bind was `label.toLowerCase()`, which *throws* on null,
while `canonicalizeWC26Sport` opens `if (!sport) return sport` and would pass
null through — so a new NULL class dated 2026-08-21 would have been my
regression. It dates to two months before the fix. Not a regression.

**§5's 601 figure stands.** Ignore 784.

### 8.4 One row that does look wrong

`epl_match_2026-08-21_all` — `brief_type: epl_match`, `sport: null`,
`game_id: null`, `source: client`. A competition-specific brief should carry a
competition label. One row, but it is an *EPL* row the day before EPL opens, so
it is worth a look alongside 8.2.

### 8.5 Two rev-4 items to amend

- **CFL is not ambiguous.** Rev 4 item 5 still lists `CFL … Week 7` as ambiguous
  alongside `NBA Playoffs`. `'CFL'` is this project's declared sponsor-neutral
  label (`src/index.js:8034`), so all four CFL variants map determinately.
  `NBA Playoffs` (2 rows) is the only genuine judgment call.
- **Ordinal count 535 → 539**, per 8.1.
