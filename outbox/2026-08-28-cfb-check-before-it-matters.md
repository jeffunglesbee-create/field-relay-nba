# Checking CFB two days early found two defects in the checker

**2026-08-28** · `scripts/cfb-first-slate-check.mjs`,
`.github/workflows/cfb-first-slate.yml`

## The state of CFB, measured

ESPN, live, via `scripts/cfb-volume-probe.mjs`
(artifact `outbox/cfb-volume-probe-latest.txt`):

```
  date        unscoped   groups=80   delta
  20260827         0          0        0
  20260828         0          0        0
  20260829         8          8        0
  20260830         0          0        0
```

**The season opens tomorrow with one 8-game slate and nothing either side of
it.** Today's drift sentinel (13:02, probing 2026-08-28) lists
`MLB:15 NFL:10 WNBA:4 La Liga:2 Bundesliga*:1 EPL:1 golf:1 Ligue 1:1 Serie A:1`
— no CFB, which is correct and not a failure.

So there was nothing to check. What could be checked was **the checker**, and it
was wrong twice.

## Defect 1 — the cron would have gone red twice before saying anything

`cfb-first-slate-check.mjs` exited 1 on an empty slate, and its cron fires daily
at 16:00 UTC checking yesterday. Given the slate shape above:

| run | checks | result |
|---|---|---|
| 2026-08-28 16:00 | 08-27, 0 games | **red** |
| 2026-08-29 16:00 | 08-28, 0 games | **red** |
| 2026-08-30 16:00 | 08-29, 8 games | the one run that matters |

Two reds teaching the reader that this workflow's red means nothing, in the two
days before its only meaningful run.

**I wrote the rule for this yesterday and applied it to the wrong file.**
`nfl-epa-route-probe.mjs` already carries `EPA_PROBE_HEARTBEAT`, with the
argument spelled out: *"a daily red every off-season day trains people to stop
reading the red."* The CFB checker was written hours later and did not get it.
Now `CFB_SLATE_HEARTBEAT` — neutral on `schedule`, fatal on dispatch, because
asking a question on purpose and getting no answer is a failed check.

## Defect 2 — an unreachable upstream reported as a quiet day

Running it locally produced:

```
NOT OBSERVABLE — ESPN lists no CFB events for this date.
```

Which was false. The sandbox does not reach ESPN; the real state was **HTTP
403**. The script did `fetch(...).json().catch(() => null)` and then tested
`!events.length`, so a dead upstream and an empty slate took the same branch and
printed the same sentence.

That is this session's recurring defect in its fourth form — a value whose name
and measurement disagree — and it would have been invisible in CI, where ESPN
*is* reachable, until the day it wasn't. A check that silently downgrades "I
could not look" to "there was nothing to see" is worse than no check on exactly
the day something breaks.

Now three states:

```
UNREACHABLE      ESPN did not answer      exit 1 ALWAYS, heartbeat included
NOT OBSERVABLE   ESPN answered, 0 games   exit 0 on the cron, 1 on dispatch
a real slate     assertions run
```

An unreachable upstream is never neutral: **a heartbeat that cannot see is not a
quiet heartbeat.**

## What is still unverified, and cannot be until tomorrow

That the seed row actually writes CFB rows under the label `CFB`. The row is
deployed (`bad7971`, deploy run `33136950160`), the laboratory models
`Sport.CFB` (`cb1c051`), and nothing can test either until the 08-29 slate is
played and the cron has ticked through it.

First real answer: **2026-08-30 16:00 UTC.**
