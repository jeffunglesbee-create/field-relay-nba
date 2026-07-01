# Outbox — Raise Workers Paid Limits (cpu_ms + subrequests)

**Date:** 2026-07-01
**Relay HEAD:** ea1dd30
**CC-CMD:** docs/CC-CMD-2026-06-30-wrangler-limits.md
**Status:** SHIPPED

---

## Pre-Build Probe Results

| Probe | Finding |
|-------|---------|
| `[limits]` block exists? | `grep -c "limits" wrangler.toml` → 0. Confirmed absent. |
| TOML style | Singleton sections: `[section]` with no quotes around values. Arrays: `[[section]]`. Values use `= "string"` or `= number`. Alignment with spaces (e.g. `binding       = "..."`). |
| Section structure | `[[kv_namespaces]]`, `[triggers]`, `[[durable_objects.bindings]]`, `[[migrations]]`, `[[analytics_engine_datasets]]`, `[[queues.producers]]`, `[[queues.consumers]]`, `[[r2_buckets]]`, `[[d1_databases]]`, `[browser]`, `[vars]`, `[[d1_databases]]` (×2 more). |
| `LEAGUES` count | 12 entries in `handleJournalismCycle`'s local LEAGUES array. |

---

## What Was Built

Config-only change — no `src/` files touched.

Added `[limits]` block at end of `wrangler.toml`:

```toml
[limits]
cpu_ms      = 300000
subrequests = 100000
```

**Diff:** 9 lines added to `wrangler.toml` (comment block + 2 config values). Zero source changes.

**Rationale:**
- `cpu_ms = 300000`: Workers Paid maximum (5 min). CPU-only — fetch/D1/KV await time is excluded, so this is pure compute headroom. Maxing it out has no cost tradeoff.
- `subrequests = 100000`: 10× the 10,000 default. Conservative vs. 10M ceiling: preserves the safety-valve purpose (catches runaway request fans) while giving generous headroom for the new per-tick fan-out pattern (3 archive loops × 12 leagues + journalism fetches).
- Preventative: no measured incident observed. The session added `[ARCHIVE-CATCHUP]` + `[ARCHIVE-YDAY]` + `[ARCHIVE-SEED]` loops all within a single cron tick, each making D1 reads + `/archive/game` POSTs per league. The added load is real; the risk window is narrow but not zero.

---

## Deploy

- Commit: `ea1dd30`
- Workflow run: `28487874430`
- CI conclusion: `success`
- `deploy/verify` match: `true` at 2026-07-01T01:48:30Z

**Chat-side follow-up:** Live confirmation that the new limits are in effect requires checking Cloudflare dashboard Worker metrics (CPU time / subrequest counts per invocation) — not verifiable from this sandbox. The deploy itself picking up the new `wrangler.toml` is confirmed by CI green + deploy/verify match.
