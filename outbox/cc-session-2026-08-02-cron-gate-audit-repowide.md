# CC-CMD-2026-08-02-cron-gate-audit-repowide — Result

## Status: DONE. Report-only per scope — no fixes applied in this session.
Two focused follow-up CC-CMDs written for the real findings (see bottom),
matching how the two confirmed prior instances (odds API, journalism)
each got their own dedicated fix.

## Task 1 — real, current cron list (re-verified fresh, not assumed)

`wrangler.toml` line 63:
```
crons = ["*/5 * * * *", "*/15 * * * *", "0 9 * * *", "0 * * * *", "30 * * * *"]
```
Unchanged from the paired CC-CMD's description.

## Task 2 + 3 — every function invoked from `scheduled()` (lines 7981-8147), gating status, real risk

### Fully isolated, `event.cron`-gated with early `return` — SAFE, no finding
| Function | Gate | Notes |
|---|---|---|
| `checkIncidentThresholds(env)` | `event.cron === '0 * * * *'` | early return, cannot double-fire |
| Game-thread-notes `DELETE` (inline) | `event.cron === '30 * * * *'` | early return, cannot double-fire |

### `event.cron`-gated, no early return (falls through to rest of function) — SAFE, no finding
| Function | Gate |
|---|---|
| `analyticsEngine(env)` | `event.cron === '0 9 * * *'` |
| `runDegradedPhaseSweep(env)` | same |
| `checkSignatureEventCalendar(env)` | same |
These three only execute on the daily `0 9` tick; falling through afterward
just means `handleCron`/journalism-gate/`sweepKVBriefs` etc. also run on
that tick, which is correct (every tick should reach those).

### Already assessed by the paired CC-CMD (`gate-journalism-cycle-cron`) — referenced, not re-investigated
| Function | Status |
|---|---|
| `handleCron(env)` | Unconditional — confirmed intentional (live-game push-alert polling genuinely wants the more frequent `*/5` tick too) |
| `handleJournalismCycle(env)` | **FIXED this session** — now gated to `event.cron === '*/15 * * * *'` |
| `sweepKVBriefs(env)` | Unconditional — confirmed intentional, cadence separately re-verified at its own call site (comment there predates this audit) |

### Time-window-gated (date/hour range), but NOT `event.cron`-gated — REAL repeat-fire risk, no dedup
None of the five functions below has any internal run-once/cooldown guard
(confirmed: no R2 `get`/`head` read-before-write, no `lastRun`/`cooldown`
check in any of the five source files) and none of their `fetch()` calls
carry Cloudflare edge-cache options (`cf: {cacheTtl, cacheEverything}}`) —
confirmed via direct grep, zero matches across all five files. Each
window is wide enough that BOTH `*/5` and `*/15` land inside it
independently, and Cloudflare fires `scheduled()` once per matching cron
pattern (not once per wall-clock minute) — confirmed by the existing
isolated-handler pattern above, which exists specifically because ticks
from different cron expressions are separate invocations.

| Function | Window (real, from code) | Upstream call | Real max invocations vs. intended 1 |
|---|---|---|---|
| `runMLBSavantUpdate(env)` | Monday, UTC 10-13 (3h) | `fetch()` → Baseball Savant | up to 48 (36 via `*/5` + 12 via `*/15`) |
| `runNFLR2Update(env)` | Wednesday, UTC 12-15 (3h) | `fetch()` → nflverse | up to 48 |
| `runNHLGSAXUpdate(env, phase)` | Thursday, UTC 11 only (1h) | `fetch()` → MoneyPuck | up to 16 |
| `runNBACluichUpdate(env)` | Mon/Wed/Fri or Wed-only, UTC 12 only (1h) | `fetch()` → stats.nba.com | up to 16 |

**Risk (Task 3): MEDIUM-HIGH for all four.** Not the same severity class
as the confirmed P0s (these are weekly/single-hour windows, not
continuous), but genuinely real: each is an unconditional external fetch
inside its window, and the actual real-world call count (16-48) is a real
multiple of the intended 1, not a theoretical edge case — every matching
cron tick inside the window independently re-fires. No cost-quota
evidence was found for any of the four upstreams (unlike the confirmed
Odds API incident), so this is flagged as a real repeat-fire /
API-hammering risk, not escalated to P0 severity without evidence.

### Broad month-range-gated, unconditional within range — REAL, highest exposure in this class
| Function | Window | Upstream | Real exposure |
|---|---|---|---|
| `runNHLSeriesUpdate(env)` | April-July (4 months) | `fetch()` → NHL API, no dedup, no CF cache | fires on **every** tick, both `*/5` and `*/15`, for 4 months straight — real average interval ~2.5 min, not the presumably-intended "update periodically" cadence |

**Risk (Task 3): HIGH.** This is the broadest unconditional-external-call
exposure of any function besides the already-fixed journalism one — a
4-month window with zero internal restriction beyond the month check, no
dedup, no CF edge cache. Real candidate for the same class of fix.

### WC-window-gated (June 11 – July 20 2026) — window now CLOSED (2026 WC already finished); structurally real, currently dormant
| Function | Real cost exposure |
|---|---|
| `runWCTournamentProjections(env)` | Calls this relay's OWN `/wc/standings`, `/wc/odds-probs`, `/wc/results`, `/v2/games` routes (internal, not a direct external vendor call). Traced `/wc/odds-probs` → `handleWCOddsProbs` → the one function that DOES hit a real paid vendor (`api.the-odds-api.com`) directly, but that call carries `cf: {cacheTtl:300, cacheEverything:true}` — a real 5-min edge cache. **Genuinely safe**: unconditional firing on both crons does not multiply real paid-API cost, because the cache absorbs it. Flagging this explicitly as SAFE per Task 3's instruction to say so plainly rather than over-flag. |
| `runBSDEndgameCapture(env)` | Direct external paid call (`sports.bzzoiro.com`, `BSD_API_TOKEN`), **zero CF cache**. The function's own comment ("single attempt per tick — cron fires every 5 min") is a broken assumption: `*/15` also lands on the same real minutes during the WC window, so at every `:00/:15/:30/:45` there are genuinely TWO separate `scheduled()` invocations both reaching this call near-simultaneously. **Risk: MEDIUM, but currently DORMANT** — the 2026 WC window has already closed (today is 2026-08-03, window was through 2026-07-20), so this is not an active cost leak right now. Real structural bug that will recur unchanged if/when this code path is reused for a future tournament. |

### Year-round, unconditional, external paid API — REAL, CURRENTLY ACTIVE, highest-urgency finding
| Function | Real exposure |
|---|---|
| `runBSDClubLeagueEndgameCapture(env)` | `if (env.FIELD_DATA && env.BSD_API_TOKEN)` is the ONLY gate — fires on **every** `scheduled()` invocation, both `*/5` and `*/15`, year-round, unconditionally. First line of the function body is an unconditional `fetch('https://sports.bzzoiro.com/api/v2/events/live/', ...)` — a real, paid, external call with **zero CF cache** (confirmed via grep, same as the WC sibling). Real call volume: up to 16/hour (12 via `*/5` + 4 via `*/15`), ~384/day, every day, indefinitely — club leagues run essentially year-round (confirmed by the function's own comment: "club leagues run outside the WC calendar"). This is CURRENTLY LIVE, unlike the WC-gated sibling. |

**Risk (Task 3): HIGH — real urgency, matching the threshold Task 3 asks
for.** This is structurally the closest match in this entire audit to
both confirmed prior incidents: external paid API, unconditional on every
cron tick, no cache, no dedup, currently active (not dormant like the WC
sibling). The existing comment at this call site ("every cron tick,
year-round... NOT gated by `_isWCWindow`") only establishes that WC-window
scoping was deliberately excluded — it does NOT establish that firing on
BOTH `*/5` and `*/15` (as opposed to one or the other) was a deliberate
choice, and no comment anywhere addresses that specific question.

## Task 4 — structured summary

| # | Function | Gated? | Real risk | Candidate for cron-gate fix? |
|---|---|---|---|---|
| 1 | `checkIncidentThresholds` | Yes (isolated) | None | No — already safe |
| 2 | thread-notes cleanup | Yes (isolated) | None | No — already safe |
| 3 | `analyticsEngine` | Yes | None | No — already safe |
| 4 | `runDegradedPhaseSweep` | Yes | None | No — already safe |
| 5 | `checkSignatureEventCalendar` | Yes | None | No — already safe |
| 6 | `handleCron` | No | None (confirmed intentional, prior CC-CMD) | No |
| 7 | `handleJournalismCycle` | Yes (fixed this session) | Resolved | Done |
| 8 | `sweepKVBriefs` | No | None (confirmed intentional, prior CC-CMD) | No |
| 9 | `runMLBSavantUpdate` | No (time-window only) | MEDIUM-HIGH | **Yes** |
| 10 | `runNFLR2Update` | No (time-window only) | MEDIUM-HIGH | **Yes** |
| 11 | `runNHLGSAXUpdate` | No (time-window only) | MEDIUM-HIGH | **Yes** |
| 12 | `runNBACluichUpdate` | No (time-window only) | MEDIUM-HIGH | **Yes** |
| 13 | `runNHLSeriesUpdate` | No (month-range only) | **HIGH** | **Yes** |
| 14 | `runWCTournamentProjections` | No (WC-window only) | LOW (edge-cached) | No — genuinely safe |
| 15 | `runBSDEndgameCapture` | No (WC-window only) | MEDIUM, dormant | Yes (low urgency — window closed) |
| 16 | `runBSDClubLeagueEndgameCapture` | No (always-on) | **HIGH, currently active** | **Yes — highest priority** |

## Task 5 — quality gate

`node --check src/index.js` — no changes made in this CC-CMD (report-only,
per explicit scope), so this is a true no-op confirmation: HEAD's syntax
is unaffected by this session (this repo has no test suite in
`package.json`; the real gate is the pre-commit hook's branch+syntax
check plus `deploy.yml`'s own inline steps, neither of which this
report-only session touches).

## Explicitly NOT done (per scope)

No gates added. No code changed. This file and the two follow-up CC-CMDs
below are the only artifacts from this session.

## Automated follow-ups (per "automate follow-ups, no fallbacks, only
fixes" instruction — each real finding gets its own focused CC-CMD,
matching how the journalism fix was scoped separately from this audit)

1. `docs/CC-CMD-2026-08-02-gate-bsd-club-league-capture.md` — the
   highest-priority, currently-active finding (#16).
2. `docs/CC-CMD-2026-08-02-gate-weekly-r2-update-windows.md` — the four
   time-window functions (#9-12) plus `runNHLSeriesUpdate` (#13), grouped
   because they share the same real structural fix (an `event.cron` gate
   picking one cron pattern per window, eliminating the double-coverage
   from both `*/5` and `*/15` landing inside the same window/range).
