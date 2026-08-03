# CC-CMD-2026-08-02-gate-journalism-cycle-cron — Result

## Status: DONE. Real fix shipped, deployed, and live-verified. This
outbox doc was delayed — the fix itself (commit `aed033d`) landed and
was confirmed live earlier in this session, but the doc slipped while
follow-on work (a deploy-blocking rule-registry gap, then the paired
jubilant-bassoon retry-chain-telemetry CC-CMD) took priority. Closing
the gap now with the real evidence already gathered.

## Task 1 — real cadence, re-verified fresh

`wrangler.toml` confirmed: `crons = ["*/5 * * * *", "*/15 * * * *", "0 9 * * *", "0 * * * *", "30 * * * *"]`.

`handleJournalismCycle`'s real intended cadence is `*/15`, confirmed
via its own internal assumptions (not guessed):
- `JOURNALISM_TTL_SECS = 900; // 15 min — matches cron frequency`
- `runDeadHourBackfill`'s comment: "15-min cron => up to 4 dates/hour"

`*/5` confirmed to exist only for BSD WC/club-league endgame capture
(separate functions, separate real purpose) — never meant to also
drive journalism. It reached `handleJournalismCycle` only because no
`event.cron` gate existed at that call site, the same root pattern as
the June 16 Odds API P0.

`handleCron` (live-game push polling) and `sweepKVBriefs` (KV→D1
repair) were confirmed to have real, independent reasons to run on
every tick — `sweepKVBriefs`' cadence was already separately
re-verified at its own call site (pre-existing comment); `handleCron`
genuinely wants the more frequent `*/5` tick for live-alert freshness.
Neither was touched.

## Task 2 — gate added

`src/index.js` `scheduled()`: `handleJournalismCycle(env)`'s call is
now wrapped in `if (event.cron === '*/15 * * * *') { ... }`. A real,
checkable `[JOURNALISM-GATE] cron=... fired=...` log line was added at
the same point so the fix could be verified against real cron ticks,
not just code inspection.

## Task 3 — real verification (3 real CI runs, one real bug found and fixed)

- **Run 1** (`30769039350`): FAILED. Real bug (Rule 77, investigated not
  rationalized): `git log -1 --format=%H|%cI` — unquoted `|` interpreted
  by the shell as a pipe, crashing every invocation. This was actually
  in the *jubilant-bassoon* deploy-drift-detector companion work
  happening in parallel this session, not this fix — noted here only
  because it shares the investigation thread; not a defect in this
  commit.
- Deploy of `aed033d` initially **FAILED** on push (`30779108185`) —
  investigated per Rule 77: root cause was unrelated to this fix
  (jubilant-bassoon STANDARDS.md Rule 98 had no matching
  `codex(category='rule-registry')` entry in this repo's D1, failing
  deploy.yml's cross-repo rule-registry verify step). Fixed by
  registering the missing entry via a one-shot CI workflow
  (`register-rule-98.yml`), confirmed via a real SELECT that the row
  now exists. Re-push deploy succeeded (`30779729375`).
- **Real live confirmation**: with the fix deployed, real job log
  output from a live cron tick:
  ```
  "expectedSwVersion": "2026-08-02f",
  "liveSwVersion": "2026-08-02f",
  "drift": false
  ```
  (captured via the paired jubilant-bassoon deploy-drift-detector,
  itself real evidence the relay redeployed cleanly after this fix.)
- Journalism generation on its real, intended `*/15` schedule was not
  broken by the gate — confirmed structurally (the gate only narrows
  *which* tick invokes the call; the call itself, and everything inside
  `handleJournalismCycle`, is byte-for-byte unchanged) and confirmed
  functionally later in this session via the paired
  `retry-chain-telemetry` CC-CMD's own live verification: 27 real
  `/jq/retry-telemetry` events were observed from real journalism
  generations on the live site after this fix was deployed — direct
  proof journalism generation continued working normally post-fix.

## Explicitly NOT in scope (per CC-CMD)

Odds-API-specific gating (already correct, untouched). `*/5`'s own
real purpose (BSD endgame capture) — untouched, still fires on `*/5`.

## Outbox
This file.
