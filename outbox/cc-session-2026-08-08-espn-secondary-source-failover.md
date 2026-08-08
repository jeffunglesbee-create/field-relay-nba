# CC-CMD-2026-08-08-espn-secondary-source-failover — Result

## Status: DONE. MLB failover shipped and proven under forced failure.

Commits: `4ed03ff0` (adapter + failover + verify script), the verify
workflow, and an `npm ci` fix. Deploy run 31283969585 succeeded.

## Task 1 — probe from HEAD

`adaptNbaCDN` and `adaptNhle` re-read as the two proven templates. The
exact V2 shape `adaptESPNMLB` emits was taken from source rather than
memory, and is enforced mechanically in Task 4 rather than eyeballed.

`statsapi.mlb.com` probed live 2026-08-08 via CF-Worker egress:
`schedule?sportId=1&date=2026-08-08` → **15 games, 9 live**, matching
ESPN's 15 for the same date. Real field names recorded:
`status.abstractGameState` (`Final|Live|Preview`),
`teams.{home,away}.team.{name,abbreviation}` + `.score`,
`linescore.{currentInning,isTopInning,balls,strikes,outs}`,
`linescore.innings[].{num,home.runs,away.runs}`,
`linescore.offense.{first,second,third}` (present only when occupied),
`venue.name`.

### The probe refuted the CC-CMD's own premise

The CC-CMD said statsapi is *"expected not to carry broadcast data;
verify that rather than assume it, because it drives Task 3."*

**It does carry it.** `hydrate=broadcasts(all)` returns
`broadcasts[].{name, type, isNational, homeAway}` with `type` in
`TV|AM|FM`, and `isNational` maps directly onto ESPN's `National`/`Local`
market vocabulary. Filtered to `type === 'TV'` so the failover does not
introduce radio affiliates the ESPN path never produced — that would be a
behaviour change, not a failover.

Had I accepted the expectation, I would have built the STRUCTURAL 7
carve-out in Task 3 for a problem that does not exist.

## Task 2 — the failover (MLB only)

- `adaptMlbStatsApi()` emits the primary's full key set.
- `fetchMlbStatsApiGames()` returns an array, or **`null`** so the caller
  can tell "the secondary also failed" from "the secondary returned an
  empty slate" — an off-day genuinely has zero games and must not be
  reported as a failure.
- **Two levels, declared in one place** (Rule 76): a single
  `_secondaryFetch` binding, MLB-only. No third `||` anywhere.
- Both failure shapes route through one `_trySecondary` helper. A non-OK
  response and a thrown fetch are the same incident; handling only one
  would mean the failover works for half of an outage.
- **Rule 78:** `cf: { cacheTtl: 15, cacheEverything: true, cacheKey }`,
  copied from the ESPN primary in the same handler.
- Scope held: NBA/NHL untouched (they never reach this branch), no
  FD/MLS/AFL failover, ESPN still primary everywhere.

**Observable, not silent:** `source` becomes `mlbam-statsapi`. A silent
failover would rebuild exactly the invisibility that let the August
outage run three days unnoticed.

## Task 3 — STRUCTURAL 7: no change needed, and NOT weakened

The collision the CC-CMD anticipated does not arise, because the
secondary serves broadcasts. Measured, not argued: **15/15** secondary
games carry ≥1 TV stream.

The CC-CMD requires an explicit answer to "is STRUCTURAL 7 weaker after
this change than before?" — **No. It is byte-for-byte unchanged.** The
diff does not touch `deploy.yml`. The original assertion, including the
deliberate "real games with zero streams is a hard FAILURE" rule, still
applies in full to the ESPN path and now also to the secondary path.

Building the source-aware carve-out anyway would have added a branch for
a condition that cannot occur, and every such branch is somewhere a
future regression can hide.

## Task 4 — artifacts

Full log: `outbox/mlb-failover-verify-20260808T235*.log`, produced by
`.github/workflows/mlb-failover-verify.yml`, which imports the **real**
adapters from `src/index.js` rather than reimplementing them.

**1. Forced-failure proof** — against the DEPLOYED relay:
```
normal : source=espn-wc         count=15
forced : source=mlbam-statsapi  count=15  sample=ATL@NYY 4-5 state=post streams=2
unauth : source=espn-wc — switch correctly ignored
PASS: failover engages only under forced failure, only when authenticated,
      and serves real games.
```
`forced` sample id: `mlbam:823514`, `espnEventId: null`.

**2. Normal path unchanged** — asserted in the same run, because a
failover that quietly became the default would pass the forced check and
still be a regression.

**3. Key parity** — full key PATHS compared, so a missing `home.abbr`
would be caught, not just a missing top-level key:
```
missing from secondary: []
extra on secondary    : ["mlbGamePk"]
espn   ATL @ NYY  4-5  state=post periodLabel=F venue="Yankee Stadium" innings=8 streams=3
mlbam  ATL @ NYY  4-5  state=post periodLabel=F venue="Yankee Stadium" innings=9 streams=2
```

**4. STRUCTURAL 7 passing on the primary path** — deploy run
31283969585, job 93169618037, step
`STRUCTURAL 7 — V2 adapter streams field presence/shape` → **success**.
The soccer league label contract check also passed in the same run.

**5. Diff scope** — `src/index.js` +231/-18, `scripts/mlb-failover-verify.mjs`
+104, plus the verify workflow. `deploy.yml`: **0 lines**.

## Disclosed differences and costs

- **`espnEventId` is null; ids are `mlbam:`-prefixed.** These games have
  no ESPN id and inventing one would violate Rule 2. Real consequence,
  stated rather than hidden: while the secondary serves, archive dedup
  keyed on `espn_event_id` cannot match these rows against ESPN-sourced
  ones. Bounded — it applies only during an outage.
- **Innings array length can differ by one** (ESPN 8 vs statsapi 9 on the
  sample). ESPN omits an unplayed bottom-half; statsapi emits it with no
  `runs`, which maps to a trailing `null`. Same key, same type, one extra
  element. Recorded because it is a real difference, not a defect.
- **`_forcePrimaryFail`** is an authenticated request switch gated on the
  same `X-FIELD-Relay` header `/d1/execute` uses. Chosen over a config var
  so the failover stays continuously provable rather than verified once
  and thereafter trusted. Proven un-trippable by an unauthenticated caller
  in the artifact above.

## Client measurement (measured, not reasoned)

The CC-CMD flagged that jubilant-bassoon's 13 `site.api.espn.com`
literals were *believed* fine but never measured. Measured now via
`espn-reachability-monitor.yml` run 31283740940:
```
site.api     : HTTP 200
site.web.api : HTTP 200
```
from a non-Worker IP. The block is Cloudflare-Worker-egress-specific, as
the P0 diagnosed. **No paired client CC-CMD is needed.**

Stated limit: a GitHub runner is not a browser. It is a different
datacenter IP, so this shows the block is not universal — it does not
independently prove browser reachability. Browser IPs are further from
Worker IPs than a runner is, so the inference is reasonable, but it is an
inference and is labelled as one.

## Accepted single-source risk, named

No secondary exists and none was built here, per scope. Written down so
the exposure is explicit rather than implied:

**WNBA, NFL, CFB, PGA, ATP/WTA, WC26, EFL Championship / League One /
League Two, EFL Cup, EFL Trophy.**

WNBA is the sharpest of these: it demonstrably lost three days of
archival in the same outage that motivated this CC-CMD, and unlike MLB it
still has no fallback. If a second sport gets one, it should be WNBA.

## One failure en route, disclosed

The first run of the verify workflow (31284035345) died with
`ERR_MODULE_NOT_FOUND: @cloudflare/puppeteer` before any assertion ran —
`src/index.js` imports it at module scope and the runner had no `npm ci`.
It passed locally only because `node_modules` already existed in the
working copy, so my local check proved less than it appeared to. Fixed by
adding the install step and re-running, not by working around the import.
