# CC session — eleven BSD fields that already arrive

**Date:** 2026-10-10
**Repo:** field-relay-nba, branch `main`
**Spec:** `docs/CC-CMD-2026-10-10-bsd-fields-already-arriving.md` — 4 tasks, 2 stop conditions
**Outcome:** all 4 executed, all 4 done conditions met. No stop condition hit.
**No new upstream call was added.** Every read is off a row already fetched.

## HEAD progression

| commit | what |
|---|---|
| `f338943` | Task 1 — the census script and its workflow |
| *(runner)* | `outbox/bsd-field-census-*.json`, run 38090820212 |
| `458c8d0` | Tasks 2-4 — the forwarder, the absence check, the harness fix |
| *(runner)* | claims re-run with the evidence block, run 38091445078 |

Deploy **38091092626** — `deploy` job success, so the forwarder is live.

## The drop site was not where the spec implied

The spec says the fields "arrive on a call we already make and nothing reads
them", which reads like a route strips them. **No route strips anything.**
`/bsd/events/live` and `/bsd/events/by-date` both forward the upstream body
verbatim.

They die at **`src/index.js:4436`**, in the WC enrichment: it fetches the full
BSD event row into `_hit`, copies exactly two fields off it — `group_name` and
`weather` — and discards the other ~38 at the point of use. Not stripped.
Never read.

That distinction decided the fix: there was nothing to un-strip, only a line to
add beside the two that were already there, on the same row from the same
fetch.

## Task 1 ran first and changed what Tasks 2-3 had to do

193 rows, 2026-10-10, with `weather` as a control — 193/193, because a census
whose control reads absent is pointed at the wrong thing and every other zero
in it is meaningless.

| field | present / 193 | note |
|---|---|---|
| `has_xg`, `is_local_derby`, `is_neutral_ground`, `round_label`, `stage`, `stage_name` | 193 (100%) | |
| `home_coach_id` / `away_coach_id` | 189 (97.9%) | |
| `round_number` | 182 (94.3%) | |
| `head_to_head` | 157 (81.3%) | 10 sub-fields, each 157/157 |
| `pitch_condition` / `travel_distance_km` | 154 (79.8%) | identical counts |
| `referee_id` | 136 (70.5%) | |
| `highlights` | 59 (30.6%) | 134 **empty arrays** |
| `round_name` | **0** | 193 **empty strings** |
| `attendance` | **0** | 193 **nulls** |
| `previous_leg_event_id` | **0** | 193 **nulls** |

**Two of the fields the spec proposed as journalism hooks are never
populated.** `attendance` is named in the spec as an upstream fact "a brief can
cite and a scorer can check against the row". Today it is 193 nulls. A brief
citing it would cite nothing.

They are forwarded anyway, under BSD's names — the forwarder's job is not to
judge what is worth having. The census is the artifact that says not to build
on them.

**The four-state count earned itself on `round_name`:** 193 empty strings. A
two-state present/absent census would have reported it present on every row.

## The 60+ that is not a shrink

The spec cites "60+ names across 198 events" from 10-03; this census found
**40**. Not a schema shrink — a counting convention. The claims harness reports
dotted sub-paths (`weather.description` and so on). 40 top-level + 10
`head_to_head` sub-fields + 4 `weather` sub-fields + `recent_matches`' own 9
reconciles with 60+.

Checked before reporting, because "the BSD schema shrank by a third" is exactly
the kind of finding that travels further than its evidence.

## Task 3 pulls in both directions, so a one-sided check cannot hold it

`is_local_derby` is present on 193/193 **and its value is often `false`**. So:

- `null`, `''`, `[]`, `{}` must NOT forward — collapse them into a value and a
  brief reports a crowd of nobody.
- `0` and `false` MUST forward — collapse them into absence and the 193 rows
  that answered the derby question read as 193 that did not.

Three mutations assert it, each applied and caught: absence collapsed to `0`,
a `false` reading treated as missing, and a field appearing in both halves of
the partition. 17/17 self-tests, and the check runs against the real census
rather than hand-written rows.

Wired blocking into `deploy.yml`, self-test first.

## Task 4 did not widen the vocabulary, and that is the finding

The re-run still reports `halftime: []`. Re-running until it got lucky would
have been the wrong move: the harness samples in-play rows at one instant and
halftime lasts about fifteen minutes per match, so it will usually miss a state
that exists. This run sampled **5 in-play rows**.

So the harness now carries its denominator beside the result:

```
rowsSampled: 193   liveRowsSampled: 5   inPlayRowsSampled: 5
meaningOfEmpty: "not observed in this sample — NOT evidence the state is absent"
observedOutOfBand.halftime: { seen: true, date: 2026-10-10, eventId: 213711,
                              evidence: 'period: "halftime", current_minute: 45' }
```

`halftime: []` beside `inPlayRowsSampled: 5` is readable as "barely searched".
The bare `[]` was not. `extraTime` stays unobserved, which is still not the
same as absent.

## Where the forwarding does NOT reach, stated rather than implied

The enrichment block is gated `if (env.BSD_API_TOKEN && sport === 'wc26')`.
**The forwarded fields therefore flow for World Cup games only.**

Widening that gate would make the BSD by-date call fire for every sport, which
is a new upstream call per sport per slate — the spec's first stop condition,
verbatim. So the gate was left exactly where it was. Widening it is a separate
CC-CMD with a cost argument attached, not a line to quietly change here.

The live census (193 rows, all competitions) is unaffected by that gate — it
calls the endpoint directly.

## Rules

- **Rule 62** — BSD's own names throughout. `is_local_derby` not renamed to
  `derby`; `head_to_head` not collapsed into a summary, because a consumer that
  wants a rate can divide.
- **Rule 47** — nothing computed. The relay forwards a row it already had.
- **Rule 99** — absence is a sibling of the value, in the type, at the boundary.
- **Rule 91** — every artifact prints its denominator where the result is read.

## One failure investigated rather than explained

Deploy 38091092626's `verify` job failed on `/pl/fixtures route smoke`. Both of
my new gate steps passed. `verify` runs `needs: deploy`, so it tested my
deployed code — which made it mine until proven otherwise, not "unrelated"
by assertion.

`/pl/fixtures` proxies `footballapi.pulselive.com`, which the diff does not
touch, and every other live smoke in the same job passed. One re-run, per the
repo's own flake rule: it passed. Transient upstream. The run is green.

## Carry-forwards

**None from this CC-CMD.**

Two measured facts for whoever picks the area up, neither a deferral:

1. **`attendance` and `previous_leg_event_id` are schema-only today** — 0 of
   193. Do not spec journalism against them without re-censusing first.
2. **The forwarding reaches wc26 only**, per the gate above. Any proposal to
   widen it is a new-upstream-call decision.
