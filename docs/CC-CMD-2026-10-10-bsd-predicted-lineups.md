# Claude Code Command — predicted lineups, and the beta flag that makes them honest

**Date:** 2026-10-10
**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR
**Type:** C (feature) — one route; the pre-game surface soccer has never had
**Status:** DONE 2026-10-11. Five tasks, no stop condition hit.
Probe artifact: `outbox/bsd-lineups-probe-latest.json` (run 38118474339, 9
calls of 24). Task 5's deferred renderer is filed as
`docs/CC-CMD-2026-10-11-predicted-xi-render-decision.md` (Rule 87.4).

**"Route live" was written before it was true, and is now measured.** When this
status was first filed the route existed in `src/index.js` and the deployed
worker did not have it: every deploy from `3765a55` through `defc1e1` failed on
the scope-claims gate, so nothing shipped for roughly 45 minutes while four
documents were closed. The probe artifact above is real and proves nothing
about the relay — it calls BSD directly from a runner, which is why it returned
a team sheet either way. This was deployed state asserted from local reading,
the first of the five assumption classes.

Verified live on the deployed worker, `outbox/live-route-probe-latest.json`:

```
/bsd/events/220230/lineups   200
  X-Lineup-State: predicted      X-Lineup-Fill: served     X-Lineup-Beta: true
```

**TASK 3 — THE PRE-MATCH INNER SHAPE, WHICH WAS NOT MEASURED, NOW IS.** The
surface probe recorded top-level keys only and the sub-field list this document
quotes came from a FINISHED event. Measured on **8 pre-match events**, all 8
`lineup_status: predicted` with `beta: true`, and it is a real team sheet, not a
formation with gaps:

```
lineups.{home,away}.formation      lineups.{home,away}.confidence
lineups.{home,away}.team_id        lineups.{home,away}.team_name
lineups.{home,away}.players[]      id, name, short_name, jersey_number,
lineups.{home,away}.substitutes[]  position, ai_score
unavailable_players.{home,away}[]  with a reason
```

**`ai_score` strengthens this document's own argument.** The vendor admits the
row is model output twice — `beta: true` and a per-player score — which is a
second reason a predicted XI must not render with a confirmed one's authority.

**TASK 4 — the reason rate, with its denominator.** 8 events, 23 named
unavailable players, **23 carry the `reason` key and 22 are non-null: 0.9565**.
The worry this task was written against — "a hook present on a tenth of rows" —
does not apply. It also reconciles the two samples that disagreed: the
container is `{home, away}`, and the `reason` lives on the players inside it.

**TASKS 1 and 2 — the route.** Pure forward, shape verbatim, `lineup_status` and
`beta` never dropped. Two TTLs with their reason written beside them: a
predicted lineup churns as team news lands (120s), a confirmed one never changes
again (3600s), and anything absent or failed is `no-store` rather than cached as
if it were an answer. Four states on `X-Lineup-State`, and an absent
`lineup_status` defaults to neither `predicted` nor `confirmed`.
`X-Lineup-Fill: served-empty` keeps the third thing this document names —
served and empty — distinct from a 404 and from a team sheet.

**One correction to this document's framing, from the premise audit.** Its
opening says soccer "gets a scoreline and a market price" and has no pre-game
surface. The client already renders a Premier League starting XI through
`/pl/match/{id}`. What soccer lacks is a PREDICTED XI before kickoff and a
BSD-wide one beyond the PL, which is what this route adds — the gap is real and
narrower than stated.

**Rule F:** a team sheet is a fact every provider publishes. Commodity.
**Rule A:** pull only. This renders on request; nothing is pushed on change.
A lineup that changes is exactly the shape that tempts a notification, and
notification is not cleared.

## Why this exists

FIELD has a pre-game surface for baseball and nothing equivalent for soccer.
`field-laboratory/src/Schedule.fs` and `StatsView.fs` carry probable pitchers
from the MLB schedule endpoint, and `StatsView.fs:19` records what that row
reads like in production. Soccer gets a scoreline and a market price.

**Measured 2026-10-10** (`outbox/bsd-surface-probe-latest.json`,
task4_broadcastsAndLineups), `/api/v2/events/{id}/lineups/` at three match
states:

| state | event | `lineup_status` | `beta` |
|---|---|---|---|
| pre-match | 220230 | **`predicted`** | **`true`** |
| live | 207856 | `confirmed` | `false` |
| finished | 223324 | `confirmed` | `false` |

Top-level keys on all three: `event_id`, `lineup_status`, `beta`, `lineups`,
`unavailable_players`, `updated_at`. The 10-03 claims run
(`outbox/bsd-newsletter-claims-latest.json`) additionally measured
`unavailable_players` carrying `home`, `away`, `id`, `name`, `short_name`,
`status`, `reason`, and team squads at `/api/v2/teams/{id}/squad/` carrying
`injury_type` and `injury_expected_return`.

**This is the question that took three and a half months to answer for
`average_positions`** — which 404s live, serves `{}` during play, and populates
only post-final *and* only when `websocket_plus` is true. Asking it up front was
Task 4 of the probe, and the answer came back good: a predicted XI before
kickoff, a confirmed one after, and the vendor labels which is which.

## THE FLAG IS THE FEATURE

`beta: true` on a predicted lineup is the vendor saying "this is a guess." A
predicted XI rendered identically to a confirmed one is a fabrication with a
team sheet's authority — and `src/journalism-quality.js` exists in large part
because this project has shipped confident prose over soft inputs before.

So `lineup_status` and `beta` are not metadata to drop on the way through. They
are the two fields that decide whether the row can be rendered at all, and
**four states, never collapsed**: `predicted`+`beta` / `confirmed` / neither
present / the call failed.

## Tasks

**Task 1 — the route.** `/bsd/events/{id}/lineups` → `/api/v2/events/{id}/lineups/`,
pure forward, BSD's shape verbatim including `lineup_status` and `beta`
(Rule 62). Two TTLs are defensible and the choice needs its reason written
beside it: a predicted lineup churns as team news lands and a confirmed one
never changes. `updated_at` is in the payload, so the route can state its own
freshness rather than having a caller infer it.

**Task 2 — four states at the boundary.** Measured above for three; the fourth
is the call failing. A missing `lineup_status` must NOT default to `predicted`
or to `confirmed`. Rule 99: absence is a sibling of the value.

**Task 3 — the inner shape, which is NOT measured.** The probe recorded
top-level keys only. `lineups` and `unavailable_players` contents at
**pre-match** are unknown — the 10-03 sub-field list came from a FINISHED
event, and this document's whole premise is that pre-match differs from
finished. Probe one pre-match event, record the inner keys, and say whether a
predicted XI carries eleven named players or a formation with gaps. **Do not
assume the finished shape holds.** The odds measurement in the same artifact is
the standing warning: pre-match and live differed in exactly the field that
mattered.

**Task 4 — `unavailable_players.reason` is the editorial hook, and it is the one
that survived.** The field census corrected two of the hooks this project was
counting on: **`attendance` is null on 193 of 193 rows** and **`round_name` is
an empty string on 193 of 193.** What holds is `is_local_derby` (100%),
`pitch_condition` (79.8%), `travel_distance_km` (79.8%) — and now a named
unavailable player with a stated reason, which is a fact a brief can cite and a
scorer can check against the row rather than echo from its prompt. That is the
property `journalism-quality.js`'s `marginAgreement` rebuild settled on.
Report the non-null rate for `reason` with a denominator. A hook present on a
tenth of rows is worth knowing about before anything is built on it.

**Task 5 — nothing renders from this document.** The relay serves; whether the
laboratory or the client draws a predicted XI is a separate decision with its
own CC-CMD, and the `beta` flag's display treatment is part of that decision,
not this one.

## Stop conditions

- Do not drop or rename `lineup_status` or `beta`. Rule 62, and they are the
  reason the feature is honest.
- Do not add a cron, a watch or a diff-on-change. Rule A is not cleared, and
  `field-laboratory/docs/CC-CMD-2026-09-11-epl-forecaster-phase1.md` carries the
  standing instruction: *"If the design drifts toward notification or
  badge-on-change, stop and report."*
- If a pre-match lineup returns 200 with an empty `lineups`, that is a THIRD
  thing — served and empty, like `attendance` — not a 404 and not a team sheet.
  Report it; do not smooth it.

## Done conditions

1. `/bsd/events/{id}/lineups` forwards BSD's shape, `lineup_status` and `beta`
   intact, with a reasoned TTL.
2. The four states are distinguishable, with a check, and absence defaults to
   neither.
3. An artifact records the pre-match inner shape of `lineups` and
   `unavailable_players`, measured on a pre-match event.
4. The non-null rate for `unavailable_players[].reason` is reported with a
   denominator.
5. No renderer is written and no scheduled job is added.
