# CC-CMD-2026-08-08-investigate-mlb-wnba-archive-gap

**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR

One-liner:
```
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }
git pull. Read docs/CC-CMD-2026-08-08-investigate-mlb-wnba-archive-gap.md. Execute all tasks.
Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
```

---

## This is an investigation, not a patch — do not write a fix in this CC-CMD

Real, measured symptom: `/context/date/` returns MLB on essentially
every date in a 14-day window, and zero on 2026-08-05 and 2026-08-06:
```
2026-08-07   35   MLB:15  MLS:14  WNBA:3  EFL Cup:3
2026-08-06   11   MLS:11                              <- no MLB, no WNBA
2026-08-05   12   MLS:12                              <- no MLB, no WNBA
2026-08-04   20   MLB:15  MLS:4  WNBA:1
```
MLB posts a steady ~15 rows/day either side of the gap. Already ruled
out: the client/read layer generally — the deployed site correctly
renders every sport the relay serves on every *other* date, confirmed
via a real browser against real relay data. This is specifically about
what did or didn't get archived on these two dates.

**Three real candidate causes, genuinely undistinguished:**
1. The archive cron didn't run on those dates.
2. The ESPN fetch failed specifically for the baseball/basketball slugs
   on those dates (matching the same failure class as the Aug 8 ESPN
   403 incident — worth checking whether this predates or overlaps it).
3. Rows were written but under a sport label `/context/date/`'s filter
   doesn't return — not a hypothetical: this repo has already found real
   MLS fixtures archived as `FIFA World Cup` this same week.

## Task 1 — Re-verify from HEAD before anything else (Rule 87)

Re-confirm the gap is still real on a fresh query — don't trust this
doc's snapshot. If MLB/WNBA rows now exist for 2026-08-05/06, the gap
may have self-resolved (e.g., a delayed backfill) — report that
plainly and investigate why, rather than assume the original diagnosis
still holds.

## Task 2 — Run the cheapest real discriminator first

Query the archive directly for 2026-08-05 and 2026-08-06, **without**
going through `/context/date/`'s filter — a raw query against whatever
table `/context/date/` reads from, for `sport IN ('MLB','WNBA')` (and,
given finding #3 above, also check for any row on those dates whose
`sport` column is *not* a value `/context/date/` would surface — the
same shape of check that found the soccer mislabeling).

- **If real rows exist** for those dates under an unexpected label:
  this is a read/label problem, matching the known mislabeling pattern.
  State the real label found.
- **If genuinely zero rows exist** for those dates under any label:
  this is a write problem. Check the archive cron's real run history
  (via this repo's own CI logs, not assumed) for 2026-08-05 and
  2026-08-06 specifically — did it run, and if so, what did it log for
  the MLB/WNBA fetch specifically.

## Task 3 — Report the real finding, propose (don't build) the fix

- State which of the three candidates the evidence actually supports —
  not which seems most likely without the Task 2 evidence.
- If it's a write failure, check whether this correlates with the
  ESPN-403 incident window (2026-08-06 15:22 UTC onward) or predates
  it — this determines whether it's already resolved by that fix or a
  separate, still-open problem.
- Propose a specific, scoped fix as a clear next step, but do not build
  or apply it in this CC-CMD — this task's job is closing the "three
  undistinguished candidates" gap, not shipping a repair.

---

## Explicitly NOT in scope

- Do not write or apply a fix, regardless of how clear the cause turns
  out to be.
- Do not touch the archive writer or cron configuration.

---

## Outbox

`outbox/cc-session-2026-08-08-investigate-mlb-wnba-archive-gap.md`: the
real Task 2 query results (raw, not summarized away), which of the
three candidates the evidence supports, and a specific, scoped
next-step recommendation.
