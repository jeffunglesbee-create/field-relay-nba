# The relay serves per-play EPA — one EP model, not two

`GET /nfl/epa/plays?event={espnGameId}`, plus `src/nfl-epa.js` and
`scripts/nfl-epa-transcription-check.mjs`, wired blocking into `deploy.yml`.

Executes `CC-CMD-2026-08-27-relay-per-play-epa` (filed in field-laboratory
`docs/`). Step 1 of 3: relay first, client second, per Rule 70.

## Why the relay and not the laboratory

EPA is computed in the browser today — `field.js` pulls `/nflverse/epa_table.json`
and this relay's `/espn-summary`, then runs `_computeESPNPlayEPA` per play.
field-laboratory needs the same numbers for its binary frame path and **must not
build a second EP model**: a second measurement is free to disagree with the
first, which is the divergence class `CONTRACTS.md` exists to prevent. One model,
one owner, two consumers.

## ADR-002, settled before the code

Both tests independently, per the 2026-08-02 RUWT baseline audit's own words
(*"passing one doesn't clear the other"*):

- **Rule F** — nflfastR publishes EPA and the EP model is theirs. A neutral data
  vendor could serve this. Permitted.
- **Rule A** — GET, on pull. No cron, no push, nothing written to a binding.
  Permitted.

No drama score, no watch value, no volatility label.

## The probe answered five things before a line was written

1. `/nflverse/epa_table.json` — already allow-listed and served (`~line 780`).
2. `/espn-summary/*` — already proxied (`~line 688`).
3. **Rule 78** — the caching is `relayFetch(url, headers, ttl, source, ctx)`,
   `caches.default` keyed on the target URL. Both upstreams here go through it at
   the TTLs their own routes use: 25s for the live summary, 86400s for the table.
   No hand-rolled fetch, so the caching cannot drift from what it borrows.
4. The route shape is `pathname === '/x' && request.method === 'GET'` inside the
   fetch handler; `/fantasy/ownership` is the precedent for a *transform* route
   (not a passthrough) carrying its own ADR-002 paragraph.
5. `src/index.js` has embedded nulls — a plain range `grep` silently misses
   inside it. Everything above was read through `tr -d '\000'`.

## The transcription, and why it is checkable

The computation is in `src/nfl-epa.js` rather than inline in the route, for one
reason: **a transcription nothing can compare against the original is a claim,
not a fact.** `scripts/nfl-epa-transcription-check.mjs` holds
`_epLookup` and `_computeESPNPlayEPA` **verbatim** from the client as its
reference and asserts the two agree.

Offline, synthetic, no fixtures — so it runs in CI and in a sandbox alike:

```
317 synthetic play(s): 305 with an EPA, 12 correctly null

PASS  the fixture table is distinct per key, so a bucket error cannot pass
PASS  the grid actually produced EPA values
PASS  ...and exercised the null branches too
PASS  every play agrees with the client, exactly
PASS  a one-cell change to the table IS detected — this check can fail
PASS  epLookup clamps out-of-range distance and field position like the client

PASS  6/6 checks passed
```

Two of those exist because agreement alone proves nothing. The fixture table
gives every `(down, ytg, yl100)` key a **distinct** value, so a wrong bucket
cannot return the right number by accident — a flat table would have passed on a
broken lookup. And the mutation check perturbs one cell and requires the grid to
notice, because a grid that never reads that cell agrees with anything.

The grid covers every down, eight distances, nine field positions, touchdowns,
made **and missed** field goals (the miss must not take the `3` branch),
turnovers across the field, all eight skipped play types, and the four shapes
that must return `null`.

## One design choice worth naming

The route serves **every drive**, each play tagged with its drive index, plus
`currentDrive`. The client displays only the current or last drive — but that is
a display choice, and serving only that drive would put the choice in the relay
and leave a second consumer unable to make a different one. Rule 60: the relay
owns the contract, not the view.

## Rule 63 — this route has no consumer yet, on purpose

Marked `STAGED` at the route with its consumer named. Rule 70 requires the relay
to deploy first and the client to match; the window between is the correct
sequence, not dead code. It closes when `_fetchNFLGameEpa` switches and
`_computeESPNPlayEPA`, `_epLookup` and `_epTableLoad` are **deleted** — leaving
them beside the new path recreates the two-model problem this ask exists to end.

## Remaining done conditions

1. `curl "$RELAY/nfl/epa/plays?event=<id>"` returns a non-empty `plays` array,
   every entry with finite `epa`/`ep_start`/`ep_end` and a boolean `scoringPlay`.
   Needs a live NFL game with drives.
2. `grep -c "_computeESPNPlayEPA"` in jubilant-bassoon returns **0**.

Neither can run from this sandbox (no egress to ESPN or `*.workers.dev`). Both
are live-run work, and the offline check above is what carries the transcription
claim in the meantime.
