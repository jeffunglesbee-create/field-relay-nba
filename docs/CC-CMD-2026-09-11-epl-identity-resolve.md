# Claude Code Command — Resolve EPL team names before the forecaster

**Date:** 2026-09-11
**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR
**Type:** B (bug fix)
**Run BEFORE** `field-laboratory` `CC-CMD-2026-09-11-epl-forecaster-phase1.md`.
A bad team join fails silently and the forecaster would be built on it.

Scope is deliberately narrow: two defects, both measured. Do not extend.

## MEASURED 2026-09-11 via `/identity/mismatches?date=2026-09-12&sports=EPL`

```json
{ "probed": 1, "matched": 0, "unmatched": 1, "key_substituted": 1,
  "EPL": { "odds_events": 20, "d1_missing": 1,
    "key_substituted": [{ "name": "Ipswich", "key": "ipswichtown" }],
    "unmatched":       [{ "d1_home": "C Palace", "d1_away": "Ipswich",
                          "d1_key": "cpalace|ipswichtown" }] } }
```

The odds side is healthy — `odds_sample` shows `hullcity`, `coventrycity`,
`ipswichtown` all resolving. The 2026-08-21 promoted-club work holds.

## DEFECT 1 — `C Palace` has no CANONICAL entry

D1 holds `"C Palace"`, which strips to `cpalace`. The Odds API sends
`"Crystal Palace"` → `crystalpalace`. They never match.

Identical shape to the note already at `identity-resolver.js:376`: "D1 holds only
'Coventry', so a feed sending the full name cannot match." Different club, same
cause, and that note was written three weeks ago.

**Fix:** add the alias. Then check D1 for OTHER abbreviated home/away spellings
in EPL rows rather than fixing only the one that surfaced today — `C Palace`
appeared because that fixture happened to be probed, not because it is the only
one. Report every abbreviated spelling found; add aliases for all of them.

## DEFECT 2 — `key_substituted` conflates two different things

Its comment says it "counts rows whose resolved team key is not derived from
their own display name — a wrong row, not a naming difference."

But `Ipswich → ipswichtown` was flagged, and that is the resolver WORKING: a
known alias resolving to its canonical form. Legitimate alias resolution and a
genuinely wrong row both produce "key not derived from display name", so the
metric cannot tell them apart.

**Fix:** distinguish them. A key reached via a known `CANONICAL` entry is
RESOLVED. A key reached any other way is SUBSTITUTED. Report both counts
separately; never collapse them into one number.

This is Rule 99 (`jubilant-bassoon/STANDARDS.md:4906`) applied to a diagnostic:
if an alarm fires on correct behaviour, it trains people to ignore it.

## TASK 0 — PROBE

1. Re-run `/identity/mismatches` for at least three EPL matchdays and record real
   payloads. Note that `probed` is the denominator, NOT `odds_events` — a chat
   session misread `matched: 0` against 20 events when the denominator was 1.
2. Query D1 for distinct EPL home/away display names and list every spelling
   that does not resolve through `resolveTeamKey()`.

## TASK 1 — Fix both defects

As above. Do not restructure the resolver; add entries and split one metric.

## TASK 2 — Seasonal check

Promotion and relegation change three clubs every summer and nothing currently
verifies the alias table against the live league. Add a check comparing
`/espn-standings/soccer/eng.1/standings` (20 clubs) against resolver coverage,
and report clubs present in the league but absent from any alias path.

Note the inverse case too: the CLIENT's `FPL_SHORT_NAME_MAP`
(`jubilant-bassoon field.js:19869`) still lists `Wolves`, who are not in the
2026-27 table. Report it; do not fix it here — it is a different repo.

## DONE CONDITION

- `/identity/mismatches` re-run for three matchdays, payloads pasted verbatim.
- `C Palace` resolves; every other abbreviated D1 spelling found is listed and
  fixed.
- RESOLVED and SUBSTITUTED reported as separate counts.
- Seasonal check reports 20 of 20 clubs covered, or names the gaps.

## TASK 3 — Outbox manifest (last task)

`outbox/cc-session-2026-09-11-epl-identity-resolve.md` with the Task 0 payloads,
every spelling fixed, the two counts, and the seasonal check output.
