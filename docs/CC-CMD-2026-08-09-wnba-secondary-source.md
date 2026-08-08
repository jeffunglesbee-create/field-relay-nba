# CC-CMD-2026-08-09-wnba-secondary-source

**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR

One-liner:
```
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }
git pull. Read docs/CC-CMD-2026-08-09-wnba-secondary-source.md. Execute all tasks.
Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
```

---

## Why WNBA is next, specifically

`CC-CMD-2026-08-08-espn-secondary-source-failover` shipped an MLB
secondary and named the remaining single-source sports as accepted risk.
WNBA is the sharpest of them, for a measured reason rather than a
preference: it **demonstrably lost three days of archival** (2026-08-05
through 08-07) in the same ESPN outage that motivated that CC-CMD — see
`outbox/cc-session-2026-08-08-investigate-mlb-wnba-archive-gap.md` — and
unlike MLB it still has no fallback.

This CC-CMD exists rather than a carry-forward line in that outbox
(Rule 87).

## Task 1 — find out whether a real secondary EXISTS before designing one

This is the task that can legitimately end this CC-CMD. MLB had
`statsapi.mlb.com` already wired into the relay; WNBA has no known
equivalent, and none may exist on acceptable terms.

Probe candidates and record real HTTP status + a real response excerpt
for each. Do not write an adapter against a source you have not seen
return a real game.

**Artifact:** for each candidate, the URL probed, the status, and either
a real game excerpt or the actual error. **If no candidate returns real
WNBA games, STOP** — record that plainly and do not build a partial
adapter. "No viable secondary exists as of <date>" is a legitimate,
complete outcome for this CC-CMD, and is more useful than a fallback that
cannot serve.

Probe from CF-Worker egress (`html_probe`), not from a runner: the whole
point is what the *Worker* can reach, and a runner reaching a host proves
nothing about that. This sandbox's proxy 403s many sports hosts directly.

Rule 45: do not make a legal or terms-of-service judgement about any
candidate source. If licensing looks like a question, flag it for human
review rather than deciding it.

## Task 2 — only if Task 1 found a real source

Follow `adaptMlbStatsApi` and `fetchMlbStatsApiGames` exactly — they are
the most recent proven instance of this pattern, and the WNBA path routes
through `adaptESPNBasketball`, so the target shape is that adapter's
output, not `adaptESPNMLB`'s.

- Two levels only, added to the SAME `_secondaryFetch` binding that
  already exists in `handleV2Games`. Do not create a second mechanism.
- A distinct, observable `source` value.
- Replicate the `cf:` cache options exactly (Rule 78).
- Never invent an `espnEventId`.

## Task 3 — verification

Extend `scripts/mlb-failover-verify.mjs`'s pattern to WNBA (a sibling
script or a sport parameter — do not fork the logic). The
`_forcePrimaryFail=1` switch already exists and is sport-agnostic.

**Required artifacts, all four:**
1. Forced failure: `/v2/games?sport=wnba&_forcePrimaryFail=1` with the
   `X-FIELD-Relay` header → HTTP 200, real games, the new `source`.
2. Normal path in the same run still reporting `espn-wc`.
3. Key-path parity against `adaptESPNBasketball`'s output: nothing
   missing.
4. STRUCTURAL 7 passing on the primary path, and an explicit statement of
   whether it was weakened. If the WNBA secondary carries no broadcast
   data, this is where the carve-out MLB did not need becomes real —
   make it `source`-aware, and do NOT weaken the ESPN path's assertion.

Run on a date with real WNBA games. If the slate is empty the run proves
nothing and must say so rather than exiting green.

## Explicitly NOT in scope

- Do not touch the MLB failover.
- Do not add secondaries for any other sport.
- Do not modify `adaptESPNBasketball`.

## Outbox

`outbox/cc-session-2026-08-09-wnba-secondary-source.md`: the Task 1 probe
results for every candidate (including the negative ones), and either the
four Task 3 artifacts or a clear "no viable secondary" determination.
