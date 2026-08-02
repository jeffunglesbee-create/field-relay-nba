# CC Session — BSD date/season query param fix
**Date:** 2026-08-02
**Repo:** field-relay-nba
**HEAD at close:** 101d201

---

## What was found

Verifying Premier League data across BSD/ESPN/FPL surfaced a real bug:
BSD's `/api/v2/events/` endpoint silently ignores a bare `date=` param
(and `season=`) — returns an unfiltered, non-date-ordered page instead
of the requested day's matches. Confirmed live: `date=2026-08-22
&league_id=1` returned round-38 (season-final) fixtures dated
`2027-05-30`, not the requested date.

A separate, independent Playground session hit the identical symptom
around the same time (screenshots reviewed) and concluded list search
via `date=`/`season=` is unreliable — correct for those two exact param
names, and their production choice (resolve BSD data via event-ID +
team-name matching, no date/season search) is a sound, conservative
design regardless of anything below.

## Root cause, actually resolved

BSD's `/api/schema/` (its own OpenAPI spec, reachable and 200) documents
the real, working filter param names: **`date_from`+`date_to`** (both
required together, even for a single day) and **`season_id`** (not
`season`). Verified live against real EPL data:
- `date_from=2026-08-22&date_to=2026-08-22&league_id=1` → `count: 5`,
  exactly the real Round 1 fixtures, matching ESPN's schedule for the
  same date exactly.
- `season_id=1058&league_id=1` → `count: 380`, the correct full-season
  match count for a 20-team league.
- `date=`/`season=`/`start_date`/`end_date`/`event_date`/`round_number`
  all confirmed ignored (8 variants tested via
  `outbox/bsd-date-filter-probe-20260801T235659Z.txt`).

## Fixed (this commit, `101d201`)

1. `handleV2Games`'s wc26 BSD group_name+weather enrichment (~3592):
   was matching WC26 games to BSD events by team-name only against an
   unfiltered/wrong-date list — could silently inject a team's
   group_name/weather from a different matchday. Now scopes by
   `date_from=date_to=<today>` first.
2. `/bsd/events/by-date` (public route): public `date`/`season` params
   unchanged (no contract break), now translated internally to
   `date_from`/`date_to`/`season_id`.
3. `/bsd/events/season` (public route): `season=` → `season_id=`.

## Deliberately NOT touched

The BSD-endgame-capture cron's `date=` call (~line 1900) uses the same
broken param, but is self-correcting: it applies its own elapsed-time
filter (80-120min post-kickoff) against each result's real `event_date`
regardless of server-side date filtering, so it already produces correct
output today. No concrete failure mode to point to; touching a working
production cron without one is out of this fix's scope (Rule 69).

## Verification (done-condition, real artifact)

`probe_relay_route /bsd/events/by-date?date=2026-08-22&league_id=1`
against the deployed relay, post-deploy: `count: 5`, exact match to the
5 real fixtures (Brentford-Tottenham, Nottingham Forest-Leeds,
Ipswich-Sunderland, Everton-Crystal Palace, Hull-Man Utd). Previously
this same route/params returned `count: 6503` unfiltered.

## Cross-session reconciliation note

This resolves an apparent conflict between two independently-reached
conclusions about the same BSD behavior — see chat transcript for full
reconciliation. Both were correct for what each tested; this session's
`/api/schema/` discovery found the actual working param names neither
had reached. Recorded here so a third session doesn't re-litigate it.
