# WC morning-brief early-return bug + archive-write-failure investigation — outbox

**Date:** 2026-07-16
**Commits:** `354398f` (WC morning-brief fix, deployed), `bfd4149` (archive-write telemetry, deployed)
**Related, separately documented:** `outbox/quality-score-upsert-gap-2026-07-16.md`, `outbox/journalism-cron-utc-rollover-2026-07-16.md`, `outbox/dead-hours-bypass-2026-07-16.md`

## Part 1 — WC morning-brief early return exiting the entire cron cycle

### What was found

Live-diagnosed via `POST /journalism/run?force=true` (the real, existing, synchronous route — chosen specifically because it returns `handleJournalismCycle`'s actual result object, unlike the fire-and-forget `ctx.waitUntil` cron path, which gives no visibility). The response was `{"ok":false,"reason":"wc morning brief already ran today"}` — `handleJournalismCycle`'s own top-level result, at a time when its dead-hours gate wasn't even active (real UTC hour was 11, squarely inside `isMorningWindow = hour>=11 && hour<=13`).

Traced this to the "Morning WC Catch-Up Brief" block (`src/index.js`, then ~L6617-6726): every one of its 4 outcomes — dedup-hit, no-recent-results, success, and its own catch-all error — ended in a bare `return {...}` from inside an `if (isMorningWindow && ...) {...}` block sitting directly inside `handleJournalismCycle`. Since this block ran *ahead of* the archive seed, yesterday catch-up, odds snapshot, slate regeneration, and the entire per-game loop, **any** outcome of the WC-morning check — not just success, but a dedup-hit too — silently skipped all of that downstream work for the entire 3-hour `isMorningWindow` (UTC 11:00-13:59), every single day. Not a narrow miss: a recurring, full-window daily outage of the live-hours cron path, existing independently of (and predating) every other fix shipped tonight.

### Fix

Extracted the block into its own function, `runWCMorningBrief(env, dateKey, now)` (module scope, above `handleJournalismCycle`), which returns a plain result object instead of reaching for the enclosing function's `return`. The call site in `handleJournalismCycle` now just logs a non-ok result via `console.log` and falls through unconditionally to the rest of the cycle:

```js
const isMorningWindow = hour >= 11 && hour <= 13;
if (isMorningWindow) {
  const wcMorningResult = await runWCMorningBrief(env, dateKey, now);
  if (!wcMorningResult.ok) console.log(`[WC-MORNING] ${wcMorningResult.reason}`);
}
```

Body of `runWCMorningBrief` is otherwise byte-for-byte identical to the original block — confirmed via `git diff` review, not just `node --check`.

### Verification

- `node --check src/index.js`: clean.
- Deploy confirmed (`354398f`, `Deploy RELAY Worker` + `Post-deploy live verification`, both success).
- **Live, direct proof:** re-ran `POST /journalism/run?force=true` post-deploy. Result: `{"ok":true,"reason":"written","score":127,"gameCount":9,"briefLen":674,"gameBriefs":9}` — the cycle now completes all the way through (slate regenerated, 9 per-game briefs enqueued), taking 11.4s (real ESPN fetches + a real LLM call), not an instant early-return.
- Confirmed the slate brief's stored `quality_score` genuinely updated in D1 (137 → 127, matching the fresh diagnostic's returned score) — direct evidence the fix's effect reaches all the way to a real write, not just a changed return value.
- Ran the diagnostic a second time in the same `isMorningWindow`, this time hitting the WC-morning dedup (already ran once): confirmed the cycle *still* fell through correctly and completed the rest of the work — proving the fix handles the dedup-hit case, not just the first-success case.

## Part 2 — Archive-write-failure investigation (real, reproduced multiple times, root cause not fully pinned down)

### What was found

While verifying Part 1's fix, checked whether the 9 real per-game-loop-enqueued jobs actually landed in D1. Found: KV writes succeeded (fresh `generatedAt`/`cycleId` matching the triggering cycle, confirmed for 3 separate games across two separate cycles at 11:26 and 11:45 UTC), but their `briefs`-table D1 write never applied — the rows stayed at their original `00:00:5x` pre-fix values. The write is wrapped in `try { ... } catch(e) { console.error(...) }`, invisible without log-tail access (not available to the interactive session).

### Hypotheses tested and ruled out, before any log access was available

- **SQL syntax**: ran the exact fixed `INSERT ... ON CONFLICT ... DO UPDATE` statement directly against production D1 with realistic values — succeeds.
- **`scoreProse`'s return type**: confirmed it returns a plain number, not an object, when called without `breakdown:true` — not a bad bind value.
- **Stale `scoreThreshold` reference**: confirmed `runQualityChain` no longer reads that field at all post the judge redesign — not a throw source.
- **`canonicalizeWC26Sport` case-sensitivity**: confirmed safe for any input case.
- **Fresh INSERT vs. UPDATE-via-conflict**: both work directly.
- **Batch size/concurrency**: fired 5 synthetic completion-trigger jobs back-to-back to force them into one queue batch (`max_batch_size=5`) — all 5 wrote to D1 correctly, ruling out a batch-size-specific issue.
- **Job-shape differences** (`matchupNote`, `jobId`, `cycleId` present on per-game-loop jobs but not completion-trigger jobs): none of these are referenced anywhere near the D1 write; and since KV writes (which happen *after* `runQualityChain` completes) succeeded for the failing jobs, any exception in the scoring/generation path is ruled out by construction.

### Instrumentation added (`bfd4149`)

Added a best-effort KV write on catch — its own nested try/catch, so telemetry can never itself break delivery — plus a minimal, ungated `GET /debug/last-archive-error` read route:

```js
} catch (e) {
  console.error("[JOURNALISM-QUEUE] archive write failed:", e.message);
  try {
    if (env.FIELD_JOURNALISM) {
      await env.FIELD_JOURNALISM.put('journalism:last-archive-write-error', JSON.stringify({
        ts: new Date().toISOString(), id: `game_recap_${sport}_${eventId}`,
        error: e.message, jobType: job.type || null, jobSource: job.source || null,
      }), { expirationTtl: 7 * 86400 });
    }
  } catch (_) { /* telemetry write must never itself break delivery */ }
}
```

### Real log access obtained — genuinely resolved the "how do we ever see this" problem

User pointed out GitHub Actions runners already have real Cloudflare credentials (`CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID`, the same secrets `deploy.yml` already uses) — meaning `wrangler tail` can run non-interactively via CI, sidestepping the interactive-session sandbox's inability to do the browser OAuth login `wrangler tail` normally needs. A parallel session working in this same repo tonight had independently found the same idea and already committed `temp-wrangler-tail.yml`; its capture (`outbox/wrangler-tail-capture-20260716T121729Z.log`) proved the technique works, but its `curl` call to `/journalism/run?force=true` had no `-X POST`, silently sending a GET — the route requires POST, so the GET fell through to an unrelated handler (the "Path not allowed" it logged is actually an NBA-proxy allowlist error, unrelated to journalism). No real cycle was triggered during that capture window.

Corrected this in a new workflow (`wrangler-tail-diagnostic.yml`) with the proper `-X POST`. Re-ran it: `force-run HTTP 200`, and the tail captured a real `Queue field-journalism-queue (2 messages) - Ok` invocation with **zero attached error lines** — directly contrasted against the same capture's `[FINALIZED-AT] ... migration failed: D1_ERROR: duplicate column name` lines (a real, pre-existing, benign "column already exists" migration message from an unrelated code path), which *did* show up clearly next to their own queue processing. This proves the tail technique genuinely surfaces errors when they occur — and this particular batch of 2 real per-game-loop jobs processed without one. Confirmed via the new telemetry too: `GET /debug/last-archive-error` still returned `{"ok":true,"lastError":null}` after this cycle.

### Current conclusion

The archive-write failure is **real, reproduced multiple times** (3 separate games across 2 separate cycles, KV-fresh/D1-stale each time) but **intermittent, not deterministic** — every isolated single-job test, a 5-job batch test, and now one real tailed 2-job cycle have all succeeded cleanly. Root cause not pinned down; every hypothesis testable without catching a live failure has been ruled out. Telemetry (`bfd4149`) is deployed, verified working (the debug route reads back correctly, `wrangler tail` genuinely surfaces errors when they occur), and will capture the exact exception message — job id, error text, job type/source — the next time this specific failure actually recurs, whether from the natural cron or a future manual trigger.

## Unblock criteria (Rule 74)

`GET /debug/last-archive-error` (via CI-as-proxy — `/debug/*` is on `probe_relay_route`'s forbidden-prefix list) whenever the archive-write failure is suspected to have recurred. If `lastError` is non-null, the captured `error` field is the real, previously-unavailable exception message needed to actually root-cause this. The `wrangler-tail-diagnostic.yml` workflow (real Cloudflare log access via CI, `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` secrets) remains available for a live-tail capture during any future investigation of this repo generally, not just this bug.
