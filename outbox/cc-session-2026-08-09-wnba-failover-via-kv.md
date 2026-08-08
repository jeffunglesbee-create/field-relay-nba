# CC-CMD-2026-08-09-wnba-failover-via-kv — Result

## Status: DONE. Producer, consumer, and STRUCTURAL 7 carve-out all shipped and proven end to end.

**Confidence: 96.** Artifact: `outbox/wnba-failover-verify-20260808T235551Z.log`.

## Task 1 — the gate, re-run before any code

The CC-CMD said to STOP if the block had lifted. It has not. Re-probed
through `/web-fetch` on the deployed relay:
```
cdn.wnba.com scoreboard  upstream=200 bytes=3839 parsedGames=null <- HTML error page
cdn.wnba.com schedule    upstream=200 bytes=3839 parsedGames=null <- HTML error page
stats.wnba.com sbv2      HTTP 502 (timeout from the Worker)
```
So the in-Worker failover remains impossible and this architecture stands.

Target shape recorded from `adaptESPNBasketball`, **not** `adaptNbaCDN` —
they differ in three ways that would have broken consumers silently: the
NBA adapter emits `state: 'final'` where ESPN emits `'post'`, has **no**
`streams` field, and has no `round`.

## Tasks 2–3 — what shipped

- **`adaptWnbaCDN`, exported**, living beside the other adapters so there
  is exactly ONE definition of the WNBA V2 shape. The producer imports
  this same function; a copy in the workflow would drift and produce
  precisely the silent field mismatch CONTRACTS.md exists to prevent.
- **`POST /wnba/slate`** — authenticated, and deliberately **not** a
  general KV-write route. A generic KV write on a public hostname makes
  every cache this relay trusts attacker-writable if the token leaks.
  Validates shape, writes one key namespace, and **refuses to overwrite a
  non-empty stored slate with an empty one** so an upstream blip cannot
  erase good data. Registered in the POST allow-list — without which it
  would have 405'd, which I checked rather than assumed.
- **Consumer extends the SAME `_secondaryFetch` binding** MLB introduced,
  not a second mechanism. Still two levels (Rule 76).
- **Staleness surfaced, not hidden:** `fetchedAt` + `staleSeconds` on the
  response. KV holds whatever was last written, and rendering a
  20-minute-old score as current is worse than showing the outage.

## Task 4 — every artifact

**5. Producer → KV, real data:**
```
adapted 3 game(s) for 2026-08-08
   LVA @ MIN  87-98  post/F
   IND @ CHI  90-86  post/F
   SEA @ PDX  0-0    pre/NS
KV write: HTTP 200 {"ok":true,"key":"wnba:slate:2026-08-08","count":3}
```

**1. Forced failure through the deployed relay:**
```
HTTP 200 source=wnba-kv count=3 staleSeconds=1
sample: wnba:1022600236 LVA@MIN 87-98 post/F streams=0
```

**2. Normal path unchanged, same run:** `source=espn-wc`, no staleness
fields. The failover is not the default.

**3. Key parity:** `missing from KV adapter: []`, and `streams` is an
empty **array** rather than undefined — the shape holds even with no
broadcast data.

**4. STRUCTURAL 7 carve-out.** The WNBA CDN carries no broadcast data, so
unlike MLB this failover really does produce games with zero streams, and
the check pools mlb+wnba — a WNBA-only day on the KV path would have
hard-failed the deploy gate. Now partitions by `source`: degraded sources
are excluded from the streams assertion with a visible `::warning::`, and
an all-degraded slate passes while printing "Passing WITHOUT verification
— not a green light."

**Was the ESPN path weakened? No.** ESPN-sourced games with zero streams
remain a hard failure. Proven on four synthetic cases before pushing:
```
espn mlb w/ streams + wnba-kv streamless : PASS-verified
WNBA-ONLY day on KV (the new case)       : PASS-unverified
espn games, NONE with streams (the bug)  : HARD-FAIL   <- unchanged
real off-day                             : skip-offday
```

## The real staleness bound, not the configured one

Observed `staleSeconds` was **0 and 1** — but that is because the verifier
runs the producer immediately before reading. The honest bound is the
**5-minute cron**, and during an ESPN outage a served slate can be up to
that old. **This is not parity with the MLB failover**, which reads live.
It is better than the nothing it replaces, and it says how stale it is.

## Two defects of mine en route

1. **`npm ci` missing from the generic probe workflow — my SECOND
   occurrence of this exact error today.** I hit it in
   `mlb-failover-verify.yml`, fixed it there, and did not generalise the
   fix, so this verifier died with `ERR_MODULE_NOT_FOUND` before running a
   single assertion. Now installed unconditionally so the next probe that
   imports `src/index.js` does not rediscover it.
2. **A parity filter that matched the wrong path format.** The run
   reported `missing: streams.[]label, ...` and failed. Those are element
   keys inside an array that is empty *by design*; my exclusion used the
   prefix `streams[`, which does not match the `streams.[]label` format
   the path walker emits. The adapter was correct; the assertion was
   wrong. Fixed and re-run to a clean pass.

Both are the same shape as my earlier ones: a check that returns a
confident answer without testing what it claims to test.
