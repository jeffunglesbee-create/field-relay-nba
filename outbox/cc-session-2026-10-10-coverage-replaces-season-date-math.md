# CC session — a token-free vendor endpoint replaces season date arithmetic (relay half)

**Date:** 2026-10-10
**Repo:** field-relay-nba, branch `main`
**Spec:** `docs/CC-CMD-2026-10-10-coverage-replaces-season-date-math.md`
**Outcome:** Tasks 1, 2, 4 here; Task 3 in jubilant-bassoon. No stop condition hit.

## The route

`/bsd/coverage` → `/api/v2/coverage/`, pure forward, **no token**, sitting
ABOVE the 503 `BSD_API_TOKEN` guard. Verified against the DEPLOYED worker:

```
HTTP 200  1957B   X-Coverage-State: vendor   Cache-Control: public, max-age=600
X-FIELD-Source: sports.bzzoiro.com
top-level keys: generated_at, sports     football row via: sports[] array
6/6 checks, from a runner holding no BSD token
```

TTL 600s, reasoned from the payload: `status`, `events_next_7d` and
`priced_next_7d` all describe a 7- or 30-day window. `live_now` rides along and
WILL be up to ten minutes stale — stated in the comment, not overlooked; a
caller wanting liveness wants `/bsd/events/live` at 25s.

No allow-list edit needed: `ALLOWED_PREFIX` already carries `/bsd` and matches
on `startsWith(p + '/')`.

## Three states, and the third is real today

`X-Coverage-State: vendor | upstream-failed`, with `status` and
`priced_next_7d` carrying the rest. Darts and csgo read `in_season` with
`priced_next_7d: 0` — fixtures, no prices, and **not** off-season. The check
asserts the vendor reports that state today rather than asserting it could.

## Two measurements that changed the work

**The endpoint is not reachable from this sandbox.** `CONNECT tunnel failed,
response 403`. That is an egress policy, not evidence about the token, and not
the stop condition. Re-measured from a runner both ways: 200 and 200.

**Task 4 answered YES, against the spec's expectation.**
`/api/v2/leagues/1/seasons/` → 35 rows carrying `is_current`.
`/api/v2/leagues/1/season/` → `{league_id, season}`, no flag. So
per-competition season state DOES have a vendor source. Not plumbed: one call
per competition is a cost decision with its own CC-CMD, and Task 3 asked for
coverage `status`. Artifact: `outbox/bsd-coverage-probe-latest.json`.

## Four defects shipped and caught, all by running rather than reading

1. Importing the probe for one pure helper **ran** it, from a sandbox with no
   egress, and overwrote the runner's good artifact with a failed reading. The
   check then reported the STOP CONDITION against an artifact it had just
   destroyed. Entry-guarded; artifact restored from git.
2. The `--self-test` dispatch sat **above** that guard, so an importer carrying
   `--self-test` ran the probe's self-test and exited — the check printed 11/11
   without running one of its own 13.
3. The check's branch slice ran past the route into the guard's own
   `const bsdToken`, failing the credential check on the guard rather than the
   route.
4. The route verifier guessed the payload shape from the probe's **normalised**
   output rather than the raw payload. It now searches the plausible envelopes
   and prints which matched.

## Two blocking gates hit, both legitimate

**Route provenance.** Adding a route makes the committed manifest stale by
construction; 188 → 189, regenerated, `/bsd/coverage` declared.

**The citation ratchet**, 10 against a budget of 9. The tenth was mine, from the
previous CC-CMD's closing note — a line number with nothing quoted. It landed in
a docs-only commit, and deploy does not trigger on docs, so the gate first ran
against it when a src change rode alongside.

That ratchet **could not be acted on**: it reported the count and named none of
them. Finding the offender meant deleting docs one at a time and re-running —
which this session did three times before adding the listing. A count without
its members is a measurement nobody can check, the same objection this repo
files against a probe that prints PASS without its denominator. It now names
every bare citation.

## Carry-forwards

**None.** One measured fact: per-league season state exists upstream
(`is_current`), so the football-wide limitation is removable at one call per
competition.
