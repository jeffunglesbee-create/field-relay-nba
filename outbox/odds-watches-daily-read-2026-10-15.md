# Odds watches — daily read, 2026-10-15

Read at 18:37Z from each watch's committed artifact. No credits, nothing dispatched.

| watch | today | artifact |
|---|---|---|
| odds-daily-vs-vendor | **RED** — `we-overcharge-ourselves`, residual `-94` (tolerance 81); counter 1612, vendor 1618, known CI 100; `unreconciled estimate : 0` | `odds-daily-vs-vendor-2026-10-15T0429.log` |
| odds-attribution-gap | `ok` — 2026-10-14 `used 1612`, `unaccounted 0` | `odds-attribution-gap-20261015T141126Z.log` |
| odds-site-drift | `inconclusive over 2 interval(s)`, gap 0; 2026-10-15 `used 342` at 13:44Z, no veto | `odds-site-drift-2026-10-15T1344.log` |
| odds-pairing-rate | PASS; `UNEXPLAINED : -198` (tolerance 87), the reconcile direction; degrade line `none — 0` with its arithmetic; D1 closed day 2026-10-14 `none`, 0 overloads, month-batch 0 | `odds-pairing-rate-20261015T152803Z.log` |
| silently-dead-crons | green — `NEW, not in the baseline : 0`; field-relay-nba `FAILING 3 CONSECUTIVE RUNS : 0` | `silently-dead-crons-2026-10-15T16-58-22-406Z.log` |
| undeployed-src | `deployed`, last green `c6f094a` | `undeployed-src-2026-10-15T1718.log` |
| /budget/odds | 2026-10-14 closed at 1612/3800; 2026-10-15 at 342 by 13:44Z | via site-drift |

## Watch 1

Same mechanism as `docs/CC-CMD-2026-10-13-vendor-residual-window.md` (OPEN):
the vendor window ran 10-14T04:46Z → 10-15T04:29Z against the UTC-day
counter. The residual is the smallest of the three days read this week
(−616, −561, −94) and is in the same direction as the pairing watch's −198
over its own 23.8 h interval.

## Yesterday's reds, today

- `verify-pending-checks`: green on every scheduled run since `41dfb4b`
  (first: 38640918363, `codex write status=200`).
- `espn-reachability-monitor`: green on schedule since the `2142bad` re-point
  (latest 10-15T17:31Z).
- Both dropped off silently-dead-crons' NEW list.

## Waiting on the owner

`rotate-relay-secret.yml` with `confirm=ROTATE`: 0 runs. Decisions filed
2026-10-14: `/archive/game` auth, the `sports.core.api` sources, the push
cron's live-game loop.
