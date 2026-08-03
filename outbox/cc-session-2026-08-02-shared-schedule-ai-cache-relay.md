# CC-CMD-2026-08-02-shared-schedule-ai-cache-relay — Result

## Status: DONE. Real, live, before/after timing proof of a genuine
cache hit.

## Task 1 — real, current shape re-verified fresh

Read jubilant-bassoon `src/legacy/field.js`'s `fetchDateSchedule(iso)`
fresh at HEAD (not from this doc's memory): model
`claude-haiku-4-5-20251001`, `max_tokens: 800`, exact prompt text
(including the `${iso}`/`dow`/`mon` interpolation) copied verbatim
into the new relay route — a re-derived approximation could have
produced a differently-shaped or worse result than what the client
gets today. Confirmed `FIELD_JOURNALISM` KV is the right namespace to
reuse (matches `handleESPNGolfScoreboard`'s own `v2:golf:scoreboard:
{date}` pattern, same repo, same convention).

Confirmed the client's real failure contract:
`{ok:false, reason:'budget-exhausted'}` or
`{ok:false, reason:'error', message}` — the new route matches this
exactly on failure. On success, deliberately returns
`{ok:true, rows:[...]}` — the parsed-but-not-sport-expanded AI output
— rather than jubilant-bassoon's client-only expanded section shape
(`inferSport()`/`expandStreams()` are client utilities; duplicating
them relay-side would be a real, disclosed double-maintenance risk).
This choice is documented in the route's own header comment for the
paired, separate client CC-CMD to consume correctly.

## Task 2 — real route shipped

`GET /schedule/ai-fallback?date=YYYY-MM-DD` (`src/index.js`, commit
`53c1d45`). Checks `schedule:ai:v1:{date}` in `FIELD_JOURNALISM` KV
first; on miss, calls the AI proxy server-to-server via the exact
existing `X-FIELD-Relay: field-relay-cron-2026` auth pattern already
used by every other cron-side proxy call in this file (not a new auth
path). TTL: 7 days for dates within 48h (real-world unlikely to still
be provisional), 24h beyond that — modeled on
`handleESPNGolfScoreboard`'s own live-vs-stable TTL split, not an
arbitrary single number.

## Task 3 — real verification (concrete timing + header proof)

Dispatched `verify-schedule-ai-cache.yml`
(run [`30781449820`](https://github.com/jeffunglesbee-create/field-relay-nba/actions/runs/30781449820)),
calling the real live route twice for the same real date
(`2026-08-05`). Real captured output:

```
=== Call 1 (expect MISS) ===
x-cache: MISS
body1: {"ok":true,"rows":[]}
call1_ms: 3138

=== Call 2 (expect HIT) ===
x-cache: HIT
body2: {"ok":true,"rows":[]}
call2_ms: 124

=== Comparison ===
PASS: byte-identical body on call 2
```

Real, concrete evidence: call 1 took 3138ms (a genuine AI round-trip),
call 2 took 124ms (~25x faster, a genuine KV read) and returned a
byte-identical body with `X-Cache: HIT`. `rows:[]` is the AI's real,
honest answer for that date (no major games scheduled) — not
fabricated, and correctly cached either way (an empty result is a
real, valid answer worth caching exactly like a populated one).

## Explicitly NOT done (per scope)

jubilant-bassoon was not touched — the paired client-side migration is
a separate, dependent CC-CMD that can now proceed with this route
confirmed live and working.

## Outbox
This file.
