# Claude Code Command — Raise Workers Paid Limits (CPU time + subrequests)

**Branch:** main — commit directly, do not create a feature branch or PR.

git pull. Read CLAUDE.md.

Write all findings to outbox/cc-wrangler-limits-2026-06-30.md.

## CONTEXT

Tonight's session added real per-cron-tick load to the relay:
`handleJournalismCycle` now does the original per-league ESPN fetch +
gameLines/gameMeta build, PLUS the existing today-catch-up loop, PLUS the
new yesterday-catch-up loop (shipped this session), PLUS (pending) the
pre-game slate-seed pass — each doing its own ESPN fetches, D1
existing-row checks, and `/archive/game` POSTs, across every league in
`LEAGUES` (12 entries), every ~15 min.

Confirmed via Cloudflare docs (current as of this session): Workers Paid
defaults are 30s CPU time and 10,000 subrequests/invocation (subrequests
had a hard 1,000 ceiling before Feb 2026 — that's gone now, replaced by a
configurable default). Both are raisable via `wrangler.toml` `[limits]` —
self-service, no Cloudflare ticket needed. `wrangler.toml` currently has
NO `[limits]` block at all (grepped, confirmed absent) — relay is running
on the unconfigured defaults right now.

This is a preventative config change, not a response to an observed
failure — there's no evidence yet the relay has actually hit either
ceiling. Frame the outbox reporting accordingly: this raises headroom,
it does not fix a confirmed incident.

## PRE-BUILD PROBE (read every symbol below from HEAD before writing anything — Rule 87)

```bash
cat wrangler.toml | head -20
grep -n "^\[" wrangler.toml
grep -c "LEAGUES" src/index.js
```

Confirm the exact TOML section structure (indentation/quoting conventions
already used in this file) before adding a new block, so the addition
matches the file's existing style rather than introducing an
inconsistent format.

## TASK 1: Add `[limits]` block to wrangler.toml

```toml
[limits]
cpu_ms = 300000
subrequests = 100000
```

`cpu_ms = 300000` is the maximum available on Workers Paid (5 minutes) —
CPU time only counts active compute, never time spent waiting on
`fetch()`/D1/KV, so there's no real cost to maxing this out defensively.

`subrequests = 100000` — 10x the new 10,000 default, well under the 10
million ceiling. Chosen deliberately conservative rather than maxed:
subrequests are the more likely of the two to actually matter given
tonight's added fetch volume, but there's no measured baseline yet for
how many subrequests a single tick actually uses. Do not set this to the
10 million max — that removes the safety-valve purpose of the limit
entirely (protects against runaway/looping code accidentally fanning out
uncontrolled requests). 100,000 gives generous headroom while still being
a real ceiling.

## TASK 2: Verification

This is a config-only change — no logic changes, so CI risk is minimal.
Confirm deploy picks up the new config: after deploy, done condition is
CI green + deploy completed. CC's egress blocks `*.workers.dev` (same
constraint as every CC-CMD this session) so live confirmation that the
new limits are actually in effect happens chat-side — mention in the
outbox doc that live confirmation is a chat-side follow-up.

## TASK 3: Outbox manifest (last task)

Write `outbox/cc-wrangler-limits-2026-06-30.md` covering: confirmed
`wrangler.toml` structure/style before the edit, the exact diff, CI/deploy
status, and explicit confirmation this was a config-only change (no
`src/` files touched).
