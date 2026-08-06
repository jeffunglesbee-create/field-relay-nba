# CC-CMD-2026-08-06-apply-soccer-league-label-fix

**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR

One-liner:
```
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }
git pull. Read docs/CC-CMD-2026-08-06-apply-soccer-league-label-fix.md. Execute all tasks.
Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
```

---

## What this is, and where it actually came from

This fix was diagnosed, written, and verified in field-playground
(`docs/pending-relay-fixes/2026-08-06-soccer-league-label.patch`, and
its `README.md` in the same directory — read both in full before
starting, they contain the real reasoning this summary only excerpts).
That session's own GitHub scope didn't include this repo, so it staged
a finished, verified patch there rather than leave it undone. This
CC-CMD is the human/session-boundary crossing the field-playground
README itself describes as deliberate: "a relay fix staged there is
finished work that has not crossed into production, and crossing that
line is a separate, human act in the relay's own repo under its own
discipline."

**The real bug:** `handleJournalismCycle`'s three archive-write sites
(`sport: gm.sport === 'soccer' ? 'FIFA World Cup 2026' : gm.league`)
relabel every non-WC soccer league as the World Cup, because
`gm.sport` is ESPN's top-level sport (`'soccer'`), not the actual
competition. Measured 2026-08-06: 52 of 60 checkable archived rows
(86.7%) mislabeled, all really MLS. `gm.league` already holds the
correct per-competition label from the `LEAGUES` table — the fix is
`sport: gm.league`.

## Task 1 — Re-verify from HEAD before applying anything (Rule 87)

**The patch is written against `7de2729`. Confirm this repo's real
current HEAD before assuming it still applies cleanly** — re-check
fresh, don't trust this doc's or the patch's own stated commit.

- Attempt `git apply` for real. If it applies cleanly, proceed to Task
  2. If it does not (real possibility, given HEAD has moved), do not
  force it — read the three real, current call sites at
  `handleJournalismCycle`'s archive-write points and apply the same,
  already-reasoned change (`gm.sport === 'soccer' ? 'FIFA World Cup
  2026' : gm.league` → `gm.league`) by hand, preserving the patch's own
  real reasoning in the replacement comment rather than dropping it.
- Either way, `node --check src/index.js` must pass before commit.

## Task 2 — The one real hazard: this is a scheduling decision, not just a code change

Changing the label changes the id prefix (`/archive/game` builds
`id = \`${sport}_${date}_...\``). Already-archived rows are safe (dedup
is on `espn_event_id`, not `id`). The real exposure: a game seeded
pre-game under the old id and finalized *after* this deploys — the
catch-up guard's `existing && existing.home_score !== null` check
won't short-circuit on a null-score seed, so the post-deploy write
goes out under the new id, misses `ON CONFLICT`, and inserts a
duplicate row instead of updating the seed.

- Before pushing, check `/context/date/{today}` (today's real date) for
  any soccer row with a null `home_score` and a kickoff already passed.
  If one exists, this is not a safe moment — wait for it to resolve
  (or report the real state and stop, rather than push through it).
- Confirm the real, current slate state fresh — do not assume based on
  time of day without checking.

## Task 3 — Companion data correction (separate from the code fix)

The code change stops new bad rows; it doesn't fix rows already
written wrong. `outbox/soccer-league-mislabel-scope-*.sql` (the newest
one — this is CI-generated from a real measured run, regenerate via
the `soccer-league-mislabel-scope-probe.yml` workflow if the existing
one is stale) corrects the `sport` column only for exactly the
measured, affected rows (scoped by `espn_event_id`) — `game_id` is
deliberately left untouched, since rewriting it would silently break
real joins in `analytics-engine.js`. This is a label correction, not a
`drama_peak` write — the immutability guard does not apply here, but
re-confirm that reasoning holds against the real, current schema
before running it.

- Re-generate the scope SQL fresh if the existing file predates this
  session's real HEAD, rather than trust a possibly-stale migration.
- Run it as its own, real, reviewable step — report the real row count
  affected.

## Task 4 — Real verification

- Re-run the scope probe (`soccer-league-mislabel-scope-probe.yml`)
  after both the code fix and the data correction are live. Mismatched
  rows should be zero for the corrected set and stay zero for any
  newly-archived game since.
- Confirm this repo's real quality gate passes.

---

## Explicitly NOT in scope

- Do not touch `canonicalizeWC26Sport()` or any WC26-specific logic —
  confirmed unaffected, per the patch's own reasoning; re-verify rather
  than re-litigate if time allows, but do not modify it.
- Do not rewrite `game_id` as part of the data correction — explicitly
  wrong per Task 3's own reasoning.

---

## Outbox

`outbox/cc-session-2026-08-06-apply-soccer-league-label-fix.md`: real
confirmation of how the patch was applied (clean apply vs. hand-applied
against moved HEAD), the real slate-safety check before pushing, the
real row count corrected by the migration, and real post-fix probe
results showing zero mismatches.
