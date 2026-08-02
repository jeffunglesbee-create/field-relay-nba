# CC-CMD-2026-08-02-resolve-dayid-date-mode — Result

## Status: SHIPPED. Real live verification, including a real bug found
and fixed via Rule 77 investigation (not rationalized).

## Task 1 — re-verified fresh, not assumed

- Confirmed `resolve-dayid`'s matchday-mode implementation unchanged:
  still requires `season` + integer `matchday` (1-40), still uses
  Browser Rendering against `matchday/{season}/{matchday}`.
- Confirmed fresh, live (`outbox/probe-bundesliga-default-matchday-view-result.json`):
  the unparametrized `/matchday` URL is **not** a usable "current
  matchday" resolver — it stays pinned to `DFL-COM-000003` (the
  Supercup), not the real league context. This ruled out the simpler
  of the two approaches the CC-CMD proposed.
- Pre-build probe (Rule 68, `outbox/probe-bundesliga-matchday-date-text-result.json`):
  confirmed a rendered matchday page's visible text contains real
  per-fixture dates (e.g. `FRIDAY\n8 May`), against a real 2025-26
  matchday page — this made the second approach (search by real
  extracted date range) buildable without inventing data.

## Task 2 — date-based resolution mode shipped

`GET /bundesliga-bapi/resolve-dayid?season=X&date=YYYY-MM-DD` — additive,
routed to only when `date` is present and `matchday` is absent. Bounded
binary search (max ~6 renders) over real matchday pages, extracting
each page's real fixture dates and narrowing toward the matchday whose
real date range contains the requested date. No hardcoded season-start
assumption anywhere — every decision is based on that render's own
real, freshly-extracted dates. Cached in a new `bundesliga_date_cache`
table (season, date) → (matchday, dayId, comId), same pattern as the
existing `bundesliga_dayid_cache`.

The existing matchday-number mode is untouched — confirmed by diff
(zero lines removed/changed in that code) and by live verification
(`matchdayModeUntouchedShape: true`).

## Real bug found and fixed (Rule 77 — investigated, not rationalized)

First live verification attempt failed: the search used `high = 40`
(copied from the matchday-mode route's own validation ceiling) but a
real Bundesliga season only has 34 matchdays (18 clubs, single
round-robin doubled — a structural fact, not season-specific).
Requesting matchday 35-40 for a real season doesn't error — the site
silently falls back to its unrelated generic-default view (the same
`DFL-DAY-004CBT`/`DFL-COM-000003` seen in the Task 1 unparametrized-URL
probe), which broke the binary search's monotonicity assumption and
produced real, reproducible wrong renders
(`outbox/verify-resolve-dayid-date-mode-result.json`, first attempt,
preserved in git history — not deleted).

Fixed by bounding the date-mode's own search to `high = 34`, scoped to
this new code path only — did not touch the matchday-mode's separate
`<= 40` validation.

## Task 3 — real, live, end-to-end verification (after the fix)

Known real triple from the pre-build probe: 2025-26 season, Matchday
33's real fixtures fell on 8-10 May 2026. Called date-mode with
`date=2026-05-09`:

- `resolvedCorrectMatchday: true` — resolved to matchday 33, exactly
  as expected.
- `dayIdMatchesCrossCheck: true`, `comIdMatchesCrossCheck: true` — the
  date-mode result (`DFL-DAY-004C9X`, `DFL-COM-000001`) exactly matches
  an **independent, direct call** to the existing matchday-mode for
  `matchday=33` — two different resolution paths agreeing on the same
  real answer.
- `dateModeCacheHitConfirmed: true`, real timing: first call 32173ms
  (5 real renders), second call 127ms (cache hit).
- `matchdayModeUntouchedShape: true` — the existing mode's response
  shape (no `date` field, `matchday` as a plain number) is unaffected.

No `smoke.js` in this repo — `deploy.yml` succeeded for both the
initial ship and the bug-fix commit.

## No unblock criteria needed

This CC-CMD is fully closed: Task 1 fresh evidence gathered, Task 2
shipped with a real bug found and fixed mid-verification (disclosed,
not hidden), Task 3 has real, cross-verified, live proof.

## Follow-up note for the jubilant-bassoon client wiring

The original blocker this unblocks (ESPN's Bundesliga games have no
matchday field) can now use `date`-mode with each game's real
`start_time` instead of needing a matchday number at all. That client
wiring is a separate, paired CC-CMD (per Rule 70) — not done here,
per this CC-CMD's own explicit scope boundary.
