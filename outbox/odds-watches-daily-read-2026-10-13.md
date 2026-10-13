# Odds watches — daily read, 2026-10-13

Read at 18:37Z from each watch's committed artifact. No credits, nothing dispatched.

| watch | today | artifact |
|---|---|---|
| odds-daily-vs-vendor | **RED** — `we-overcharge-ourselves`, residual `-616` (tolerance 169); `unreconciled estimate : 0` | `odds-daily-vs-vendor-2026-10-13T0642.log` |
| odds-attribution-gap | `ok` — `used 3799`, `unaccounted 0` | `odds-attribution-gap-20261013T165750Z.log` |
| odds-site-drift | `inconclusive over 2 interval(s)`, `gap 0`; 2026-10-13 `used 648` at 18:33Z, no veto | `odds-site-drift-2026-10-13T1833.log` |
| odds-pairing-rate | PASS; `UNEXPLAINED : -276` (the reconcile direction); D1 closed day 2026-10-12 `none`, 0 overloads, month-batch 0 | `odds-pairing-rate-20261013T175350Z.log` |
| silently-dead-crons | `NEW, not in the baseline : 0` | `silently-dead-crons-2026-10-12T21-17-31-167Z.log` |
| undeployed-src | `deployed` | `undeployed-src-2026-10-13T1206.log` |
| /budget/odds | 2026-10-12 closed at 3799/3800; 2026-10-13 at 648 by 18:33Z | via site-drift |

## Watch 1

Filed this morning as `docs/CC-CMD-2026-10-13-vendor-residual-window.md`. About
380 of the −616 is the watch comparing a UTC-day counter with a vendor window
offset by ~6 h. The monthly ledger, read at the vendor's instants, is over the
bill by ≥ 190 once direct CI spend is removed. The pairing watch's −276 over
its own 21.8 h interval is the same direction and a similar size.

## Closed today

- `odds-live-path-404` done condition 3: no-header 0 on 2026-10-12.
- `pairing-degrade-cross-day` done condition 3: the line rebuilt its interval
  across midnight and printed the arithmetic (`= 2026-10-12 close 0 - 0 … + 0`).
- `d1-overload-degrades`: 2026-10-12 reads `none`, which is the alert's first
  clean closed day.
- Yesterday's three new dead crons: none remain NEW.

## Waiting on the owner

`rotate-relay-secret.yml` with `confirm=ROTATE`. Steps 4 and 5 run from a
check-in at 2026-10-14T18:00Z once its log exists.
