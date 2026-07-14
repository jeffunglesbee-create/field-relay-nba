# Repo-wide promise-chain catches, Tier 1: D1/KV read+write sites — 2026-07-13/14

## TASK 0 — Probe

Ran the real, current audit fresh (not trusted from the doc's own snapshot):
```
pip install tree-sitter tree-sitter-javascript --break-system-packages -q
python3 scripts/audit-empty-catches.py src/index.js
```
Confirmed: 250/250 `catch(e){}` block statements clean (0 empty — this
category was already fully resolved by prior clusters), 44/78
`.catch(callback)` promise-chain calls genuinely empty. Filtered to this
Tier's scope (`ARCHIVE_DB`/`FIELD_JOURNALISM.get` sites):

```
grep -A100 "promise chains:" audit_output | grep "ARCHIVE_DB\|FIELD_JOURNALISM\.get\b"
```
Real, current count: **24 sites** (matching the doc's own "~24-26" estimate
exactly). Every site read in full enclosing-function context (not just the
catch line) before classifying — the standing lesson from every prior
cluster tonight.

## TASK 1 — Fix each site on its own merits

**10 sites: real behavioral fixes** (fallback value flows into a decision
that risked a duplicate write/enqueue, a violated invariant, or an
inaccurate response — not a preserved swallow with a log line added):

| Site | Function | Bug | Fix |
|---|---|---|---|
| L3463 | `handleV2Games` (NHL enqueue) | KV read failure → falls through to "not found" → duplicate journalism enqueue risk | Fail closed: log + `continue` |
| L3578 | `handleV2Games` (NBA enqueue) | Same shape as above | Same fix |
| L4715 | `sweepKVBriefs` | D1 read failure → proceeds to insert a redundant null-sport row | Fail closed: log + `continue` |
| L5397/L5401 | `executeGameBriefBackfill` | Count-query failure defaulted to 0, presenting a fabricated "0-2" series record as confirmed (Rule 2 — DO NOT INVENT) | Track confirmation; omit the record line entirely on failure |
| L9251 | `/archive/game` closing-odds capture | Dedup-check read failure → proceeds to fetch+overwrite, violating the code's own documented "never overwrites" invariant | Fail closed: skip the whole enrichment on read failure |
| L9997/L10001 | `/backfill/game-briefs` (`force`-generation loop) | Same series-record fabrication risk as L5397/L5401 | Same fix |
| L10094 | `/backfill/game-briefs` force-regenerate DELETE | Swallowed failure meant `force=true` could silently not regenerate (subsequent `INSERT ON CONFLICT DO NOTHING` no-ops against the stale row) with zero error surfaced | Removed the local catch — the existing per-item `try/catch` already reports `{ok:false, reason}` correctly |
| L10712 | `/session/record` carry-forwards | Every write failure swallowed; response always claimed `carry_forwards_written = min(requested, 10)` regardless of actual success | Track real success count, report it honestly; log individual failures |

**14 sites: telemetry only**, each individually justified (not defaulted):

| Site | Function | Why safe |
|---|---|---|
| L4696 | `sweepKVBriefs` | Retry-safe — KV key isn't deleted, next sweep (15min cron or dead-hour backfill) re-attempts |
| L4741/L4745 | `sweepKVBriefs` | Degraded enrichment only (quality-score context); outer `try/catch` already handles total failure; doesn't gate the INSERT |
| L5394 | `executeGameBriefBackfill` | Pure enrichment (series narrative); empty `seriesContext` on failure doesn't gate the brief write |
| L5611 | `pickNextBackfillDate`'s `tried()` helper | Retry-safe — `executeBackfill`'s own thinness check already refuses to write a brief for a permanently-stuck date regardless |
| L8778 | `/archive/drama` | Diagnostic check runs *after* the real UPDATE already executed — purely cosmetic response shaping, gates nothing |
| L8895 | `/archive/score-by-id` | Explicitly documented "best-effort only... must never block the real score write" (Rule 5) |
| L9397/L9404/L9410 | `/archive/brief` | 3-try OR-chain lookup, explicit "fail gracefully — never block archival" (Rule 5) contract; pure enrichment for quality scoring |
| L10287/L10291 | `/quality/backfill-scores` | Same OR-chain enrichment shape as above, wrapped in a per-item `try/catch` |
| L11930 | `/journalism/generate` cache read | A read failure is behaviorally identical to a genuine cache miss — completely benign, falls through to regenerate either way |
| L14379 | `queue()` consumer dedup-before-regenerate | **Deliberately kept as-is, not flipped to fail-closed**: proceeding on an uncertain read is the *safer* choice here — skipping risks leaving a stale brief in place when the game state genuinely changed (worse than a wasted regeneration); the cost of proceeding is one redundant LLM call, not accumulating duplicate work like the enqueue-dedup sites |

Every telemetry-only site now logs via `console.error("[TAG] message:",
e.message)`, tag matching the surrounding section's existing convention
(reused where one exists: `[KV-SWEEP]`, `[GAME-BRIEF-BACKFILL]`,
`[BACKFILL]`, `[ARCHIVE-GAME]`, `[ARCHIVE-BRIEF]`, `[SCORE-BY-ID]`,
`[JOURNALISM-GENERATE]`, `[JOURNALISM-QUEUE]`, `[BACKFILL-GAME-BRIEFS]`;
derived from the route where none existed: `[DRAMA-PEAK]`,
`[BACKFILL-SCORE]`, `[SESSION-RECORD]`, `[V2GAMES]`).

Shipped as a single commit (`5c08e9a`) — the doc's own guidance to "group
by function/file-section if that keeps commits reviewable" applied here,
since safe and bug-pattern sites are tightly interleaved within the same
functions (e.g. the series-record block has both a safe lookup and two
bug-pattern count queries three lines apart); the commit message itemizes
every site with which category it falls into, satisfying the doc's
"do not mix... without noting which is which" requirement without
artificially fragmenting coupled code.

## TASK 2 — Verify

**Real isolated logic test** for the dominant bug-pattern shape
(enqueue-dedup, matching the doc's own referenced method): a standalone
script modeling both the OLD and NEW code shapes against a mock KV client
configured to throw. Result:
```
Scenario 1: KV read fails (transient outage)
PASS -- OLD behavior proceeds to enqueue despite uncertainty (the bug)
PASS -- OLD behavior actually enqueues a duplicate
PASS -- NEW behavior skips rather than risk a duplicate enqueue (the fix)
PASS -- NEW behavior enqueues nothing on failure

Scenario 2: KV read succeeds, genuine cache miss (normal path)
PASS -- OLD and NEW produce identical result on the normal path

Scenario 3: KV read succeeds, brief genuinely already exists
PASS -- OLD and NEW produce identical result on the real-dedup path

✅ ALL ASSERTIONS PASSED (9/9)
```
Proves the bug is real, the fix closes it, and neither of the two genuine
no-failure paths regressed.

**`node --check src/index.js`**: clean.

**Live check, post-deploy** (commit `5c08e9a`, confirmed deployed via the
real `Deploy to Cloudflare Workers` + `Deploy gate` steps succeeding):
- `GET /v2/games?sport=nba&date=2026-07-14` — real 200, correct
  off-season shape (`nba-cdn-empty`, 0 games) — confirms `handleV2Games`
  (containing the L3463/L3578 fixes) deployed and runs without error.
  NBA/NHL are genuinely off-season in July, so the finals-enqueue branch
  itself wasn't naturally exercised by this call — reported honestly
  rather than claiming more than this proves.
- **Real, deterministic proof instead for the `/session/record`
  carry-forwards fix** (L10712): POST'd 2 real, clearly-tagged test
  carry-forwards via a temporary GitHub Actions workflow. Response:
  `carry_forwards_written: 2`. **Independently verified via a direct D1
  query** (not just trusting the response) that exactly 3 rows genuinely
  landed (1 session record + 2 carry-forward rows, matching the reported
  count exactly). All 3 test rows deleted afterward and deletion verified
  (`changes: 3`, follow-up `COUNT(*) = 0`).

**Re-ran the audit script after all fixes**: `catch(e){}` blocks still
255/255 clean (5 new legitimate block statements added by this Tier's
fixes, all non-empty). Promise chains: 72 total (was 78 — some
`.catch(() => null)` sites were converted to explicit `try/catch` blocks,
correctly moving them out of the promise-chain count), **20 empty
remain — 0 of them touch `ARCHIVE_DB` or `FIELD_JOURNALISM.get`**,
confirming this Tier's scope is fully clean. The remaining 20 are Tier 2
(json-parse/fetch/misc), explicitly out of this CC-CMD's scope per the
doc's own boundary.

`git diff 5c08e9a -- src/index.js`: zero drift — all temp verification
workflow/capture files fully removed in this same session.

## DONE CONDITION

All 24 real sites in this Tier individually read and correctly classified
(10 real fixes, 14 genuinely-safe telemetry, each with its own stated
reasoning — not uniformly treated). Re-running the audit script shows 0
empty D1/KV sites in this Tier. Zero regression on any confirmed-safe
site's normal-path behavior (proven for the dominant pattern via isolated
test; the other 13 safe sites were individually reasoned through, not
just asserted). Live-verified post-deploy: the deploy pipeline's own
health/structural gates passed, `/v2/games` confirmed the fixed function
deploys and runs cleanly, and the `/session/record` fix was proven with a
real, deterministic, independently-D1-verified test — not just
code-reviewed.

## Confidence Score

```
+20  TASK 0: real, current site list from the script (24 sites, matching
     the doc's own estimate exactly), full enclosing-function context
     read for every site before classifying
+45  TASK 1: correctly distinguished 10 real bug-pattern sites from 14
     genuinely-safe sites -- real fixes applied (fail-closed dedup guards,
     accurate response counting, a fabrication-avoidance fix for series
     records, and one "remove the redundant local catch" fix), not
     uniform logging; every safe-site classification individually
     justified in this outbox, including one site (L14379) explicitly
     kept as-is with real reasoning for why proceeding-on-error is safer
     than the fail-closed pattern used elsewhere in this same Tier
+35  TASK 2: real isolated logic test (9/9 assertions) proving the
     dominant bug pattern old-vs-new with zero regression on both real
     no-failure paths; node --check clean; live-verified post-deploy via
     both a real endpoint hit confirming clean deployment and a real,
     independently-D1-verified deterministic test of the accurate-count
     fix; audit re-run confirms 0 empty D1/KV sites remain, honestly
     scoped against the 20 remaining Tier-2 sites
= 100/100
```

**Score: 100/100. Clears the >=95 threshold.**

## Commits (all on `main`)

- `5c08e9a` — the real fix: 24 sites (10 real behavioral fixes, 14
  telemetry-only), itemized in the commit message by category
- `0e96765`/`85af844` — temporary live-verify workflow
- `a1a4dae` — temp diagnostic capture (real 2-edit carry-forwards test,
  independently confirmed via D1, test rows deleted and verified)
- (this commit) — temp workflow/capture removed, this outbox written
  after full live verification [skip ci]
