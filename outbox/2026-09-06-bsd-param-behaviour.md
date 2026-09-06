# BSD parameter behaviour, probed — and one call site fixed

**Date:** 2026-09-06
**Probe:** `.github/workflows/bsd-param-probe.yml` → `outbox/bsd-param-probe-latest.txt`
**Trigger:** BSD's August newsletter, which states the API now "rejects
parameters it doesn't understand instead of quietly ignoring them".

## What was contradictory before probing

`src/index.js` carried a comment, confirmed live 2026-08-01:

> Uses date_from/date_to, not date= — confirmed live 2026-08-01 that BSD's
> `/api/v2/events/` silently ignores a bare `date=` param (returns an
> unfiltered, non-date-ordered page instead), which would have matched teams'
> games from the wrong date via the team-name-only lookup below.

Roughly 1850 lines earlier, `runBSDEndgameCapture` sent exactly that parameter.
One call site knew, the other did not, and nothing connected them.

## Measured

```
control page carries 21 date(s) in field 'event_date'; probing 2026-06-25

bare date=          HTTP 200   6 rows, 1 distinct date   → 2026-06-25
date_from/date_to   HTTP 200   6 rows, 1 distinct date   → 2026-06-25
bogus param         HTTP 400
league_id only      HTTP 200  50 rows, 21 distinct dates
```

```json
{"detail": "Unknown query parameter(s): field_nonsense_param.",
 "accepted_parameters": ["date_from","date_to","league_id","limit","offset",
                         "round","season_id","stage","status","team_id","team_name"]}
```

**Three findings.**

1. **`date=` filters now.** The 2026-08-01 comment recorded real behaviour; BSD's
   August overhaul changed it. The claim was stale rather than wrong, which is
   why it needed re-probing rather than re-reasoning.
2. **`date` is not in the accepted set** — yet it returns 200 while an
   undocumented parameter returns 400. Nothing is broken today. It is one
   tightening pass from a 400 on a cron path, resting on a parameter the server
   does not document.
3. **No RateLimit headers**, on any of the four calls. The newsletter's claim
   does not hold on this endpoint.

## Fixed

`runBSDEndgameCapture`, two changes, both measured rather than reasoned:

- `?date=` → `?date_from=&date_to=`. Safe because the equivalence was measured:
  both shapes returned the SAME 6 rows on the same date, in the run above.
- `new Date().toISOString().slice(0,10)` → `getFieldDateKey()`. UTC midnight is
  not the FIELD day, and that function's own comment records the failure: naive
  UTC advanced "today" at 8pm ET mid-primetime, before that evening's games had
  finished. This is an endgame capture keyed on today's slate, which is exactly
  what the helper is for.

## The follow-up, so this cannot recur

`scripts/bsd-param-guard.mjs`, wired into `deploy.yml`. Every parameter sent to
`sports.bzzoiro.com` must be in the accepted set — taken from the server's own
400 payload, not transcribed from documentation, because the server is the thing
doing the rejecting.

Current reading: `date_from, date_to, league_id`. All accepted.

Its self-test uses the REAL line that was there as the positive case, so the
guard is proven to catch the thing it was written for rather than only proven to
run. It also skips a parameter whose NAME is interpolated, since a name built at
runtime cannot be checked statically and must not be reported as a violation.

**What it does not do, stated plainly:** it cannot know when BSD changes the
accepted set. That is a fact about someone else's server and belongs to the
probe, which asks. The guard enforces the list as last measured, so a call site
cannot drift from it unnoticed.

## Two defects in the probe itself, both caught by reading its output

The first run reported four verdicts and three were unsupported.

Its date extractor guessed `date | start_time | starts_at | datetime`. BSD uses
`event_date`. So it read ZERO dates from a 50-row control page, and the verdict
logic — testing `distinctDates <= 1` — read "could not see any dates" as
"filtered to one date", concluding a bare `date=` now filters. **An extractor
that cannot see is indistinguishable from a filter that works.** The probe was
written to catch that substitution in someone else's API and committed it in its
own reader.

And `league_id=27` is the World Cup, which had no fixtures on the probed date,
so both filtered calls returned empty. With nothing to filter, filtering and
ignoring produce the same page. The question was unanswerable and the probe
answered anyway.

Both fixed: the date field is discovered and the key printed; a non-empty page
yielding no dates reports CANNOT READ DATES with the row's keys; the verdicts
return UNKNOWN and name the blocker; and the control now runs FIRST so the date
under test is taken from a row that exists.
