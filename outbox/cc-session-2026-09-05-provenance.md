# CC session — provenance: from 3.2% to three layers

Date: 2026-09-05
Session: https://claude.ai/code/session_017FXC1oRxRstzY2xGJBFu2k
Deploys: 891–896, all green
View: https://claude.ai/code/artifact/a1afea94-e7d5-4848-82f8-a03a4cbf00d0

## Why this happened

Five defects earlier in the session were each found by a probe pointed at
something else: five odds call sites spending unaccounted, every `us,eu` call
charged half, a fabricated Germany v Ecuador odds row served for 72 days, 48
stale `mlbRaw` entries, an F# build read as its own source.

One shape every time — **a value is served and nothing says where it came from
or how old it is.** Finding those by accident-adjacency is not a strategy, and
the user's objection was exact: *"We're going over things from three months
ago… again."*

## What shipped

| | | |
|---|---|---|
| **header layer** | 186 / 186 | every response carries route, kind, source, served-at |
| **store layer** | live | every KV write records the route or cron that made it |
| **body layer** | 7 / 186 | unchanged — the durable half, still open |

### The two choke points

Both halves collapsed to a place where one edit covers everything downstream,
and finding those was the whole job:

- **Responses** — `fetch` is the single exit. `fetch → _fetch → stampProvenance`.
  Headers, not bodies, so response bytes are identical and no consumer breaks.
  Covers the 23 proxy routes, the class that cannot be fixed in a body at all.
- **Stored values** — `fetch` and `scheduled` are the only ways in, so wrapping
  `env` there covers all 62 KV writes. It also produces *better* provenance than
  a hand-written label: the wrapper knows the request path, so a value records
  the route that caused it.

Measured before assumed: 62 KV writes serve 246 reads, a 1:4 ratio. Writers
were always the cheaper end.

### The approach that would have broken production

Wrapping stored values in `{v, _src, _at}`. **16 of the 62 writes store the bare
string `'1'`** as a warn flag or once-per-day gate, read back as
`if (await KV.get(k))`; others store a bare number. Both `'1'` and
`'{"v":"1",…}'` are truthy, so those readers would not have failed — they would
have silently stopped meaning what they mean. KV metadata leaves the value bytes
untouched, so every existing reader is unaffected structurally rather than
probably.

## Instrument defects — the actual story of this session

**Twelve of the fourteen defects were in the measuring apparatus, not the
product.** Both wrappers worked first time and have needed no correction.

| # | defect | found by |
|---|---|---|
| 1–4 | the census was wrong four times: delegation read as absence; a pattern that could not match ES6 shorthand; cross-module helpers unseen; `, source,` in a parameter list read as a response field, promoting all 23 proxies | its own spot-checks, then the flagship reading bare |
| 5 | an em-dash in a header value — `Headers.set()` throws above U+00FF, the catch swallowed it, **all 23 trigger routes would have shipped unstamped** while every store-backed test passed | the gate |
| 6 | the WebSocket test asserted object identity against a mock with mutable headers, so it passed with the guard deleted | mutation |
| 7 | the stream test counted pulls and asserted zero — measuring undici, not my code, with the function never called | running it |
| 8 | 13 prefix routes stamped `unmapped` in production while the census counted them mapped | the runtime probe; no static check could have |
| 9 | manifest sources named hosts routes never contact (`/nba-stats` → `statsapi.mlb.com`) | fixing #8 |
| 10 | the probe **passed** while its own output showed the defect | reading its JSON |
| 11 | the census reported 3.2% while production stamped 186/186 — an instrument describing a state that no longer existed, four hours after being built | comparing it to the manifest |
| 12 | the census workflow raced every push it measured; three rebase conflicts on generated files | the conflicts |

**Unresolved collapsed into empty, three separate times** — the odds provider
quota, the cost-model verdict, and the route manifest — and each time it
produced a confident falsehood. That is the recurring shape, and every fix was
the same: make the third state say its own name.

## What is now automated

- `check-route-provenance.mjs` — 25 checks, blocking, 7 mutations proven
- `check-kv-provenance.mjs` — 19 checks, blocking, 4 mutations proven
- `check-odds-calls-guarded.mjs` — blocking, 4 mutations proven
- `provenance-runtime-probe.mjs` — reads the **deployed** worker on every
  successful deploy plus daily; its load-bearing assertion is drift between the
  deployed manifest and the committed one
- `provenance-census.yml` — daily, regenerates census, manifest and view

## Late addition: the ledger over-counted, having under-counted this morning

Measured 03:26:20Z from the probe's own output: `/wc/odds-probs` reported
provider `cost: "0"` against `charged: 4`. Out of season the request returns
nothing, the provider bills nothing, and the counter recorded four credits of
spend that never happened — the mirror image of the morning's defect, where the
same counter under-counted real spend by half across five sites.

`reconcileOddsCredit` now adjusts both counters by the difference between the
estimate and the provider's `X-Requests-Last` receipt. Nine charging sites, nine
reconciled. Confirmed live at 09:47:41Z:

```
cf-cache-status: "EXPIRED"
reconciled: { estimated: 4, actual: 0, delta: -4, state: "reconciled" }
```

The cache hit was the case that would have made this worse than not doing it: a
hit replays the ORIGINAL response's headers, so the receipt describes a
different call. `cf-cache-status` separates them.

**Residual, and it is a measurement gap not a bug.** That live reading came back
`EXPIRED`, which is outside the two values I reasoned about. It fell through to
the receipt path correctly — expired means the entry was stale and the request
did reach the provider — but it shows the vocabulary is wider than `HIT`/`MISS`,
and only `HIT` is special-cased. `STALE` and `UPDATING` also serve from cache
without waiting on the origin, and would currently be charged the replayed
receipt rather than zero.

That over-charges, which is the safe direction, so it is not urgent. It is
deliberately NOT fixed from memory: adding cache statuses I have not observed
here is the exact defect this session kept finding. The probe records `cached`
on every run, so the vocabulary this worker actually produces accumulates in
`outbox/provenance-runtime-probe-*.json`. Resolve it once the observed set is
known, not before.

## Open, with unblock criteria (Rule 74)

1. **Durable Objects are not covered.** AmbientDO and GameDO hold their own
   `env` and write through their own bindings. *Unblocked by:* wrapping in each
   DO constructor. *Verify:* `/provenance/kv?prefix=` shows a `do:` writer.
2. **`unstamped` is 5 of 8 on `prefix=odds`.** Expected — keys written before
   the wrap expire on their own TTL. *Done when:* it reaches zero. Deliberately
   not asserted as `stamped > 0`, which would fail on a correct fresh deploy.
3. **The body layer is 7 of 186** and is the half that survives being saved,
   logged or cached. Not started.
4. **One route undeclared** — `/odds`, URL assembled in a helper. On a ratchet.
5. ~~**Germany v Ecuador is still live.**~~ CLOSED. Deleted in `db2540c` after
   72 days; `/wc/odds-probs` confirmed serving 0 rows at 03:26:20Z, and
   `check-no-fabricated-values.mjs` plus a permanent runtime assertion now
   guard both the source and the served response.
6. **`cf-cache-status` vocabulary is partly unmeasured.** Only `HIT` is treated
   as zero-cost. *Unblocked by:* enough probe runs to enumerate the values this
   worker really produces. *Verify:* `grep -h '"cached"'
   outbox/provenance-runtime-probe-*.json | sort -u`.

## Carry-forwards

None that lack unblock criteria. Items 1–5 above are each stated with what
unblocks them and how to verify.
