# Score-Fill Schedule Trigger — 2026-07-05

## Commit

- `675766c` ci: add schedule trigger to score-fill.yml (every 4h)

## Change

```yaml
# before
on:
  workflow_dispatch:

# after
on:
  workflow_dispatch:
  schedule:
    - cron: '0 */4 * * *'   # every 4h — runs upstream of drama-backfill (2h cron)
```

One block added to `.github/workflows/score-fill.yml`. No logic changes.

## Why 4h

score-fill.mjs has no internal recency/skip logic — it fills whatever `home_score IS NULL`
on each run. The drama-backfill cron (every 2h) won't see a game until `home_score IS NOT NULL`.
4h ensures score-fill runs upstream at least once every two drama-backfill cycles, giving
session-less games a path to score visibility without manual intervention.

## Verification Gap — Honestly Reported

Session ran at ~14:10 UTC. Next scheduled fire: 16:00 UTC (~110 min away). Waiting for a
confirmed scheduled run was not feasible in-session. The YAML cron expression `0 */4 * * *`
(0:00, 4:00, 8:00, 12:00, 16:00, 20:00 UTC) is standard GitHub Actions syntax — validity
is not in doubt, only whether a real run has been observed. Check Actions history for
`score-fill.yml` at or after 16:00 UTC 2026-07-05 to confirm first scheduled fire.

## Done Conditions

- [x] Probe block confirmed: `on: workflow_dispatch:` only before edit
- [x] Schedule trigger added, workflow_dispatch preserved
- [ ] Real scheduled run confirmed — PENDING (next fire ~16:00 UTC, 110 min away at commit time)
- [x] Outbox manifest written

## Compliance

- Rule 87: self-completing on the implementation side; verification gap honestly documented
  with exact next-fire time, not hand-waved
