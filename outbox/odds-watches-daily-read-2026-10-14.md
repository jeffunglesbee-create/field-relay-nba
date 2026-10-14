# Odds watches — daily read, 2026-10-14

Read at 18:37Z from each watch's committed artifact. No credits spent; one
free probe dispatched (`espn-host-parity-probe.yml`, no vendor call).

| watch | today | artifact |
|---|---|---|
| odds-daily-vs-vendor | **RED** — `we-overcharge-ourselves`, residual `-561` (tolerance 50); counter 687, vendor 286, known CI 160; `unreconciled estimate : 0` | `odds-daily-vs-vendor-2026-10-14T0446.log` |
| odds-attribution-gap | `ok` — 2026-10-13 `used 687`, `unaccounted 0` | `odds-attribution-gap-20261014T143159Z.log` |
| odds-site-drift | `inconclusive over 2 interval(s)`, gap 0; 2026-10-14 `used 42` at 16:02Z, no veto | `odds-site-drift-2026-10-14T1602.log` |
| odds-pairing-rate | PASS; `UNEXPLAINED : -12` (tolerance 50); degrade line `none — 0` with its arithmetic; D1 closed day 2026-10-13 `none`, 0 overloads, month-batch 0 | `odds-pairing-rate-20261014T154031Z.log` |
| silently-dead-crons | **RED** — `NEW, not in the baseline : 2` (both field-relay-nba, below) | `silently-dead-crons-2026-10-14T17-09-52-508Z.log` |
| undeployed-src | `deployed` (13:59Z) | `undeployed-src-2026-10-14T1359.log` |
| /budget/odds | 2026-10-13 closed at 687/3800; 2026-10-14 at 42 by 16:02Z | via site-drift |

## Watch 1

The same mechanism filed on 2026-10-13 as
`docs/CC-CMD-2026-10-13-vendor-residual-window.md` (OPEN): a UTC-day
counter compared with a vendor window from 10-13T06:42Z to 10-14T04:46Z.
Nothing new to file. Today's day was quiet (687), so the offset hours carry
a larger share of it.

## The two new dead crons

**verify-pending-checks — my regression, fixed.** `17b966d` (rotation
step 1c, 2026-10-13) wrote the JavaScript `process.env.RELAY_SHARED_SECRET`
inside this workflow's Python heredoc. Run 38602768930:
`NameError: name 'process' is not defined`. Five consecutive failures from
the first run after that commit. Fixed in `41dfb4b` (`os.environ[...]`);
reproduced red then green locally from the extracted heredoc. Not
dispatched, because the step writes a codex row to live D1; the next
scheduled run is the proof.

**espn-reachability-monitor — a live outage, re-pointed.** Since
2026-10-13T21:39Z ESPN has refused Cloudflare Worker egress on
**site.web.api**, the host the relay moved to after 2026-08-08, and lets it
in on site.api again. Every ESPN read in the relay was 403: `/v2/games`
502 for nfl and epl, `/espn-summary` 403. MLB stayed up only through its
statsapi failover, which the monitor printed as `✅ mlb: HTTP 200`.
Re-pointed in `2142bad` after a runner probe found the hosts byte-identical
(9 of 9 pairs). Verified from the relay: nfl and epl 200 with
`"source":"espn-wc"`, `/espn-summary` 200; monitor run 38619780577 green.
`docs/CC-CMD-2026-10-14-espn-host-flip.md` (Task 1 DONE; resilience, the
`sports.core.api` 403 and the monitor's failover blind spot open).

## Found on the way

- **Five shared-secret literals hidden in base64** in `deploy.yml` and
  `rule90-staleness-monitor.yml`, missed by rotation step 1c and invisible to
  the ratchet. Converted (`84b3a40`), verified live, and the ratchet now
  decodes base64 in both repos. They would all have broken at rotation.
- **The deploy's `/context/game` bridge probe** timed out at 20 s on a D1 JOIN
  that scanned the games table once per recap brief (3176 x 4044). Rewritten
  (`c6f094a`): 95.7 ms. Deploy 38620645051 green on every step.
- **`POST /archive/game` writes the archive with no auth.** Known since
  2026-08-11 as a test convenience, never filed as an exposure. Filed for the
  owner: `docs/CC-CMD-2026-10-14-archive-game-unauthenticated-write.md`.

## Noticed, not changed

The pairing watch prints `positive — the vendor billed for calls our counters
did not see` directly under `UNEXPLAINED : -12`. The sentence is keyed on
`escaped` (+88), not on UNEXPLAINED, so both are true, but the placement
reads as if it described the −12.

## Waiting on the owner

`rotate-relay-secret.yml` with `confirm=ROTATE`: 0 runs at 18:03Z.
