# Claude Code Command — eleven BSD event fields arrive on a call we already make and are dropped

**Date:** 2026-10-10
**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR
**Type:** B (gap) — no new upstream call, no new credit, no new route
**Status:** FILED, not started.

**Rule F:** nothing here is a composite or an interest level. Every field named
below is a fact BSD already states on a row this relay already fetches.
**Rule 47:** the relay forwards; it computes nothing new.

## Why this exists

`scripts/bsd-newsletter-claims.mjs` (run 2026-10-03,
`outbox/bsd-newsletter-claims-latest.json`) captured the full field census of
`/api/v2/events/`: 60+ names across 198 events. The relay fetches that endpoint
and `/api/v2/events/live/` already.

**Exactly one of the rich fields is consumed.** `src/index.js:3083`
(`const wx = game.weather`), documented at `:4403` as
*"game.weather — {description, wind_speed, temperature_c} for journalism
context"* and joined at `:4437`.

Consumer count in `src/` for the rest, measured 2026-10-10 by grep:

| field | `src/` | `scripts/` |
|---|---|---|
| `has_xg` | 0 | 0 |
| `pitch_condition` | 0 | 0 |
| `travel_distance_km` | 0 | 0 |
| `is_local_derby` | 0 | 0 |
| `is_neutral_ground` | 0 | 0 |
| `attendance` | 0 | 0 |
| `head_to_head` (and every sub-field) | 0 | 0 |
| `round_label` / `round_name` / `round_number` | 0 | 0 |
| `stage` / `stage_name` | 0 | 0 |
| `previous_leg_event_id` | 0 | 0 |
| `referee_id` | 0 | 3 (probes only) |
| `home_coach_id` / `away_coach_id` | 0 | 3 (probes only) |
| `highlights` | 0 | 2 (probes only) |

## Why it is worth doing before anything that costs a call

`src/journalism-quality.js:105` records Dim 10 scoring **zero on 128 of 128**
re-scored rows, and the reason it gives is the absence of real hooks:
`regular_season_games.note` is populated on **37 of 1,322** finalized games, and
"five are broadcast carriage and two are real editorial hooks." It also records
why populating `note` would have made the dimension WORSE — the note is injected
into the prompt, so counting note words pays points for parroting an input.

`is_local_derby`, `attendance`, `travel_distance_km` and `pitch_condition` are
not prompt echoes. They are upstream facts that a brief can cite and a scorer
can check against the row. That is the shape `marginAgreement` was rebuilt into:
"a RELATION between two numbers that is present on ~100% of finalized rows and
cannot be copied from the prompt."

## ONE CANDIDATE THIS KILLS

**Do NOT add `/api/v2/events/{id}/h2h/`.** `head_to_head` is already embedded in
the events payload, with `total_matches`, `home_wins`, `draws`, `away_wins`,
`home_win_rate`, `away_win_rate`, `home_goals`, `away_goals`,
`avg_total_goals`, and `recent_matches[]` carrying `{date, event_id, home,
away, home_score, away_score, score, home_team_id, away_team_id}`. A separate
h2h call would buy a round trip for data already in hand.

## Tasks

**Task 1 — census first, in code.** Before plumbing anything, write the field
set the relay ACTUALLY receives today into an artifact, from a live call rather
than from the 10-03 capture. The census above is seven days old and this month
has already produced one vocabulary surprise (see Task 4). One artifact,
`outbox/bsd-field-census-<ts>.json`, with the field list and a count of rows
carrying each field non-null — presence in the schema and presence in the data
are different claims.

**Task 2 — forward, do not reshape.** Pass the fields through on the existing
BSD paths under their own names. Rule 62: the public shape stays BSD's. Do not
rename `is_local_derby` to `derby`, and do not collapse `head_to_head` into a
summary — a consumer that wants the rate can divide.

**Task 3 — absence is a sibling.** Every field here is absent on some rows:
`attendance` on a closed-door or unreported match, `pitch_condition` where the
league does not report it, `head_to_head` on a first meeting. Rule 99: a
missing `attendance` must not serialize as 0, and a first meeting must not read
as 0 wins each. Distinguish "not reported" from the value, in the type, at the
boundary — the same discipline `Nested<'T> = NotPresent | Decoded | Malformed`
applies in the laboratory.

**Task 4 — extend the measured vocabulary.** The 10-03 run reported
`newsletterStatesFound.halftime: []` — searched for and not found across 198
events. On 2026-10-10 the live feed carried `"period": "halftime"` on event
213711 (Paderborn–Stuttgart, `current_minute: 45`). So the measured period
vocabulary `['', '1T', '2T', 'FT']` is incomplete and the status vocabulary
`[notstarted, postponed, cancelled, 1st_half, 2nd_half, finished]` may be too.
Re-run the claims harness and record the widened set. `extraTime` remains
unobserved, which is not the same as absent.

## Stop conditions

- If any task would add an upstream call, STOP — that is a different CC-CMD, and
  three of them are filed separately today.
- If a field's meaning is not stated by BSD's docs, forward it and say so.
  Do not infer. `n` in `average_positions` is the standing example: it behaves
  like a touch count and two players on one team share a value, so it is not a
  shirt number — and that is as far as the evidence goes.

## Done conditions

1. `outbox/bsd-field-census-<ts>.json` exists, from a live call, with per-field
   non-null counts.
2. The eleven fields are forwarded under BSD's own names.
3. A row missing a field is distinguishable from a row whose field is zero, and
   a check asserts it.
4. The claims-harness artifact records `halftime` and whatever else 10-03 missed.
