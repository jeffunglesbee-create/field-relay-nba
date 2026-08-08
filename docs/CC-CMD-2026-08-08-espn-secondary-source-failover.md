# CC-CMD-2026-08-08-espn-secondary-source-failover

**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR

One-liner:
```
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }
git pull. Read docs/CC-CMD-2026-08-08-espn-secondary-source-failover.md. Execute all tasks.
Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
```

---

## Why this exists

Task 3b of `CC-CMD-2026-08-08-espn-site-api-403-p0`, split out because
that CC-CMD's own Task 3a audit changed what 3b should be. The parent
anticipated a config-level failover; the real `/v2/games` architecture
routes every ESPN sport through a **per-sport adapter**, so a genuine
secondary needs a new adapter, not a base-URL swap.

Mitigation already shipped (`214da59`): ESPN reads re-pointed to
`site.web.api.espn.com`, verified live. **That is the same Akamai edge**
— nothing prevents it being blocked next, which is what makes this
CC-CMD worth doing even though nothing is currently broken.

## Real, measured starting facts (2026-08-08 — re-verify, don't trust)

Source audit from `V2_LEAGUES` (full table in
`outbox/cc-session-2026-08-08-espn-site-api-403-p0.md`):

- **NBA and NHL are already non-ESPN** — `nbaSource:'cdn'`
  (`cdn.nba.com`) and `nhleSource:true` (`api-web.nhle.com`), migrated
  June 2026. They were unaffected by the outage. **`adaptNbaCDN()` and
  `adaptNhle()` are the working templates for this whole task** — read
  them first; the pattern is already proven twice in this file.
- Secondaries already present in the relay but unused by `/v2/games`:
  `statsapi.mlb.com` (`MLB_STATS_API_BASE`), `stats-api.mlssoccer.com`
  (`MLS_STATS_BASE`), `api.football-data.org/v4` (`/fd/*`, allow-listed),
  Squiggle + Kali (AFL).
- **True single-source exposure, no alternative present:** WNBA, NFL,
  CFB, PGA, ATP/WTA, WC26, EFL Championship/L1/L2.

## Task 1 — Probe from HEAD before writing anything

- Re-read `adaptNbaCDN()` and `adaptNhle()` and the `/v2/games` dispatch.
  Write down the exact V2 game shape they emit (every field a client
  consumer reads), because the new adapter must emit the identical shape.
- Probe `statsapi.mlb.com` for a real date with games and record its
  **actual** response shape — field names, nesting, status vocabulary.
  Do not write the adapter against assumed names (Rule 68).
- Confirm what `statsapi.mlb.com` does and does not carry. It is
  **expected not to carry broadcast data**; verify that rather than
  assume it, because it drives Task 3.

## Task 2 — MLB first, one sport only

MLB is the right first target: in-season and testable today, highest
volume, and its secondary is already wired into the relay.

- Add an `adaptMlbStatsApi()` (name to match local convention) emitting
  the **same** V2 game shape as `adaptESPNMLB()`.
- Wire a **two-level** failover for MLB only: ESPN primary →
  statsapi.mlb.com secondary. **Rule 76: two levels, declared in one
  place.** If a third level starts to look necessary, stop — that means
  the contract is wrong, not that another `||` is needed.
- The failover must be **observable**: the response's existing `source`
  field already carries `"espn-wc"`; emit a distinct value when the
  secondary served. A silent failover rebuilds exactly the invisibility
  the 2026-08-06/08 incidents were made of.
- **Rule 78:** replicate the existing `cf:{cacheTtl,cacheEverything,
  cacheKey}` pattern exactly. A per-request failover during an outage
  must not turn into an unthrottled hammer on the secondary.
- Scope boundary: **MLB only.** Do not touch NBA/NHL (already native),
  do not add FD/MLS/AFL failovers, do not change ESPN's primary status
  anywhere.

## Task 3 — Resolve the streams/STRUCTURAL-7 collision BEFORE shipping

This is the trap that makes this task non-trivial, and it must be
handled deliberately rather than discovered in CI:

`statsapi.mlb.com` carries no broadcast data, so a failover produces
games with empty `streams[]`. `STRUCTURAL 7` currently treats
"real games, none carrying streams" as a **FAILURE** — that is
deliberate; it is the exact shape of the original broadcast-chip bug.

So a naive failover trades an outage for a red deploy gate. Decide, and
state the reasoning in the outbox:

- Preferred: make `STRUCTURAL 7` aware of `source`, so "games from the
  secondary with no streams" is a **known-degraded pass with a warning**,
  while "games from ESPN with no streams" stays a hard failure. This
  keeps the original assertion intact for the case it was written for.
- **Do not** weaken `STRUCTURAL 7` into accepting empty streams
  generally. That would delete the only guard on the broadcast-chip bug.
- Whatever is chosen: state explicitly in the outbox whether
  `STRUCTURAL 7` is weaker after this change than before. The answer
  must be "no, for the ESPN path."

## Task 4 — Verification (Rule 89 — artifacts)

1. **Forced-failure proof.** Point the MLB primary at a deliberately bad
   host in a scratch/dispatch run and show `/v2/games?sport=mlb`
   returning HTTP 200 with real games and the secondary's `source` value.
   "The code has a fallback" is not an artifact.
2. Normal path unchanged: `/v2/games?sport=mlb` on a real game day →
   200, `source` still the ESPN value, `streams` populated.
3. A deploy run where `STRUCTURAL 7` passes, with the passing line
   quoted, on the **primary** path.
4. Diff scope: exact files and line counts.

## Follow-ups this CC-CMD explicitly owns (no loose ends)

- **Client measurement.** jubilant-bassoon still has 13
  `site.api.espn.com` literals and fetches from browser IPs, which were
  never blocked — so it is believed fine, but that is **reasoned, not
  measured**. Measure it. If it is failing, write a paired client CC-CMD
  (Rule 70) rather than editing jubilant-bassoon from here.
- **Sports with no secondary** (WNBA, NFL, CFB, PGA, ATP/WTA, WC26, EFL
  tiers): do not build anything for them here. Record them in the outbox
  as accepted, named single-source risk so the exposure is written down
  rather than implied.

## Outbox

`outbox/cc-session-2026-08-08-espn-secondary-source-failover.md`: the
real statsapi shape, the adapter added, the forced-failure proof, the
STRUCTURAL 7 decision and an explicit statement that the ESPN path's
assertion was not weakened, the client measurement result, and the named
list of accepted single-source sports.
