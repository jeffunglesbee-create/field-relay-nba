# CC session — 2026-11-03 — the live-version check of /cfl/odds-probs

**State:** one `GET /cfl/odds-probs` was made at 2026-11-03T11:57:20Z on the owner's reply "Next approved" and answered HTTP 200 on the live version `ad8f5cc7`. It was a cache-`EXPIRED` call: the vendor billed 6 credits, the handler reconciled them (`delta` 0), and the day's ledger rose by exactly one `handleCFLOddsProbs` step. Cloudflare still listed `ad8f5cc7` as the newest deployment 24 s after the response. 6 Odds API credits were spent, once. No Worker code changed, so there is no deploy.

## Why

It was the one item of the owner's 2026-11-02 could-not-verify list ("/cfl/odds-probs answering 200 on the new code") that the earlier session left unmeasured on the live version. The live `ad8f5cc7` holds the same code as `daf274f8`, which answered 9 of 9 (`outbox/cc-session-2026-11-03-could-not-verify-list.md`), but no call had been made on `ad8f5cc7`; that session stopped at the cost (6 credits on a cache miss) and the missing approval.

## The approval, as it was given

The previous message ended: "Next: send `APPROVED: up to 6 Odds API credits for one /cfl/odds-probs check on version ad8f5cc7` (1 minute). I make the one call and record the status in about 5 minutes." The owner replied "Next approved" (Tuesday 06:54 ET, 11:54Z). The canonical text was not typed. I took the reply as approval of that one named step and its cap, because it answered a message that named exactly one next step with its cost; I did not ask for the text again. That is a reading and not a proof. If it was not what the owner meant, the cost was 6 credits, once, and this record says so.

## The call

`GET /cfl/odds-probs` through the relay's `probe_relay_route` (a self-fetch from the Worker), once.

| field | value |
|---|---|
| HTTP status | 200 |
| `ok` | true |
| `probs` | 2 games, both on 2026-11-07: Montreal Alouettes v Winnipeg Blue Bombers (20:00Z), Edmonton Elks v BC Lions (23:30Z) |
| `cost` (the provider's `x-requests-last`) | "6" |
| `charged` | 6 |
| `reconciled` | `{site: "handleCFLOddsProbs", estimated: 6, actual: 6, delta: 0, state: "reconciled"}` |
| `cached` (`cf-cache-status`) | "EXPIRED" |
| `ts` | 1793707040769 = 2026-11-03T11:57:20.769Z |
| `remaining` | "98382" |

## The ledger

`/budget/odds?date=2026-11-03`, read before the call (the provider's `checked_at` 11:56:25Z) and after it (11:57:33Z):

| field | before | after |
|---|---|---|
| `daily.used` | 153 | 159 |
| `by_site.handleCFLOddsProbs` | 66 | 72 |
| `handleCFLOddsProbs` `reconciled`/`EXPIRED` n | 9 | 10 |
| ... credits kept | 54 | 60 |
| all `handleCFLOddsProbs` reconcile rows, steps | 473 | 474 |
| `monthly.used` | 1252 | 1258 |
| `unaccounted` | 0 | 0 |
| provider `requests_remaining` | 98388 | 98382 |
| provider `requests_used` | 1612 | 1618 |

Every other reconcile row is unchanged. The route had taken 4 steps between the 08:25Z read (469) and the 11:56Z read (473), so the one added step is attributed to this call. Nothing in the tally labels its caller; the response's own fields are the stronger evidence.

## The version

There is no version header (`/version` answers 403), so the version is tied to the call by Cloudflare's own list.

- Before the call: `deploy.yml` on the relay has no run after 41555964661 (created 2026-11-03T00:52:46Z, finished 01:04:21Z), and the laboratory's probe read the same newest deployment at 08:16Z.
- After the call: the laboratory's `worker-deployments-probe` (run 41631708022, dispatched with `version_ids` set to the live id; `outbox/worker-deployments-probe-20261103T115745Z.md` in field-laboratory) read Cloudflare at 11:57:45Z, 24 s after the response. The newest deployment, `96127882-4aa3-4e98-bc4b-a7e1ac76c54f` at 2026-11-03T01:03:04.657296Z, is version `ad8f5cc7-54f6-4c7e-8381-71de0be92967` at 100%; the one before it is its upload version `604f4f8c`; before that, `daf274f8`. Version number 2030, script etag `be651ac1...` (the same as on the earlier reads), handlers `scheduled, fetch, _fetch, queue`, 38 bindings with hash `4e3f3cbce931a706`.
- A deployment made between the response and that read would be newer than `ad8f5cc7`. None is.

## What it does not show, and what is not known

- One call, on a cache-`EXPIRED` path. The 0-credit `HIT` path of this version, the 502 and 503 branches and a request abandoned by its client were not exercised. The abandoned request is the Task 2b repeat, measured on `daf274f8`.
- A self-fetch from the Worker is not a client's request.
- I do not know why the day's single `error` row (a `HIT` whose reconcile threw, kept at the estimate of 6) threw; it is unchanged and still unread.
- I do not know who calls the route in the hours the tally shows traffic.

## Docs changed

- `docs/CC-CMD-2026-10-13-vendor-residual-window.md`, Data points: a new bullet for this check, and three dated brackets on the 08:45Z bullet whose "no call was made" and "needs the approval" sentences this check overtakes.
- `outbox/cc-session-2026-11-03-could-not-verify-list.md`: dated brackets on the lines that said the route was not called (the State paragraph, the result row, "Not changed", "Open").
- `HANDOFF.md`: a new close-out entry, and a bracket on the 08:45Z entry's two lines about this check.

## Not changed

- No second call to the route. No dispatch of `cfl-abort-experiment.yml` or `odds-daily-vs-vendor.yml`. No `POST /analytics/morning-report/recompute`.
- Nothing the calendar experiment's VOID window (2026-11-08 to 2026-11-23) lists: `chargeOdds`, `consumeOddsCredit`, `reconcileOddsCredit`, `handleCFLOddsProbs` and `docs/CC-CMD-2026-10-18-odds-charge-survives-cancellation.md` were not touched, and the call lies before the window.
- The only other action was one read-only dispatch of the laboratory's `worker-deployments-probe`, which writes nothing to Cloudflare.
