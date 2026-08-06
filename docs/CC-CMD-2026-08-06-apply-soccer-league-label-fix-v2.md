# CC-CMD-2026-08-06-apply-soccer-league-label-fix-v2

**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR

One-liner:
```
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }
git pull. Read docs/CC-CMD-2026-08-06-apply-soccer-league-label-fix-v2.md. Execute all tasks.
Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
```

---

## Fully self-contained — supersedes v1

v1 of this CC-CMD pointed back to `field-playground/docs/pending-
relay-fixes/` for the real patch content and reasoning. That's a
cross-repo dependency this repo's own fix shouldn't have — the same
pattern already caught and fixed for the LaLiga/Bundesliga CC-CMDs.
This version contains everything needed on its own.

## The real, confirmed bug

`handleJournalismCycle`'s three archive-write sites relabel every
soccer game as the World Cup:

```js
sport: gm.sport === 'soccer' ? 'FIFA World Cup 2026' : gm.league,
```

`gm.sport` is ESPN's top-level sport (the literal `'soccer'`), not the
actual competition — so this relabels every non-WC soccer league.
Measured 2026-08-06: 52 of 60 checkable archived rows (86.7%)
mislabeled, all really MLS, stored as `sport = "FIFA World Cup 2026"`
with ids prefixed `FIFA World Cup 2026_`. `gm.league` already holds
the correct per-competition label from this file's own `LEAGUES` table
(EPL / MLS / La Liga / Serie A / Bundesliga / Ligue 1 / FIFA World
Cup) — the non-soccer branch of this same ternary already uses it
correctly.

## Task 1 — Re-verify from HEAD before applying anything (Rule 87)

- Find the real, current three call sites of this exact ternary inside
  `handleJournalismCycle` (approximate prior locations: catch-up
  ~line 7084, pre-game seed ~line 7170, yesterday-finals ~line 7254 —
  re-locate fresh by searching for the literal string
  `'FIFA World Cup 2026' : gm.league`, don't trust these line numbers).
- At each site, replace:
  ```diff
  -sport: gm.sport === 'soccer' ? 'FIFA World Cup 2026' : gm.league,
  +sport: gm.league,
  ```
- Replace each site's existing explanatory comment (which reasons
  about a July 2026 WC26 in-progress game and predates MLS sharing
  this branch) with one that records both the original reasoning and
  why it no longer holds — the real point being preserved: this
  literal feeds `/archive/game`'s `id` construction
  (`id = \`${sport}_${date}_...\``), and `canonicalizeWC26Sport()`
  (called after `id` is built) already normalizes the persisted
  `sport` *column* for WC26 regardless of this literal, so WC rows
  keep the same column value and only their id prefix changes.
- `node --check src/index.js` must pass before commit.

## Task 2 — The one real hazard: this is a scheduling decision, not just a code change

Changing the label changes the id prefix. Already-archived rows are
safe — all three write sites dedup on `espn_event_id`, not `id`. The
real exposure: a game seeded pre-game under the old id and finalized
*after* this deploys. The catch-up guard's `existing && existing.
home_score !== null` check won't short-circuit on a null-score seed,
so the post-deploy write goes out under the new id, misses
`ON CONFLICT`, and inserts a duplicate row instead of updating the
seed.

- Before pushing, check `/context/date/{today}` (today's real date)
  for any soccer row with a null `home_score` and a kickoff already
  passed. If one exists, this is not a safe moment — wait, or report
  the real state and stop rather than push through it.

## Task 3 — Companion data correction for already-mislabeled rows

The code change stops new bad rows; existing ones need a separate
correction. Generate the real, current scope directly rather than
trust any external file:

- Query for archived soccer rows where `sport` indicates World Cup but
  the real competition (re-derivable from each row's own
  `espn_event_id` via a fresh ESPN lookup, or from context already in
  this table) is not actually the World Cup.
- Correct the `sport` column only, scoped by `espn_event_id`, for
  exactly the real, measured affected rows — no `LIKE` on the label,
  nothing that could sweep in a genuine World Cup fixture.
- Deliberately do **not** touch `game_id` — `briefs.game_id` joins
  `games.id` in `analytics-engine.js` (real join sites around lines
  999, 1005, 1411, 1417 — re-verify current line numbers) — rewriting
  the id prefix would silently break those joins for any brief already
  referencing these rows.
- This is a label correction, not a `drama_peak` write — re-confirm
  directly against the current schema that the immutability guard
  genuinely doesn't apply here before running anything, rather than
  assume.
- Report the real row count affected.

## Task 4 — Real verification

- After both the code fix and data correction are live, directly
  query the archive for any soccer row still mislabeled as World Cup
  that isn't genuinely one — should be zero for the corrected set, and
  should stay zero for anything newly archived since.
- Confirm this repo's real quality gate passes.

---

## Explicitly NOT in scope

- Do not touch `canonicalizeWC26Sport()` or any WC26-specific logic —
  confirmed unaffected by this bug; re-verify if time allows, don't
  modify it.
- Do not rewrite `game_id` as part of the data correction.
- Do not read from or reference `field-playground` at any point in
  executing this — everything needed is above.

---

## Outbox

`outbox/cc-session-2026-08-06-apply-soccer-league-label-fix-v2.md`:
real confirmation of the three sites fixed, the real slate-safety
check before pushing, the real row count corrected, and real post-fix
verification showing zero mismatches.
