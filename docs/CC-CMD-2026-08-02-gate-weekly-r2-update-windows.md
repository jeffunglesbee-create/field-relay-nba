# CC-CMD-2026-08-02-gate-weekly-r2-update-windows

**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR

One-liner:
```
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }
git pull. Read docs/CC-CMD-2026-08-02-gate-weekly-r2-update-windows.md. Execute all tasks.
Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
```

---

## Real precedent

`outbox/cc-session-2026-08-02-cron-gate-audit-repowide.md` (Task 4,
findings #9-13) — five functions, called unconditionally within a
date/hour window from `scheduled()`, none `event.cron`-gated, none with
internal dedup, none with Cloudflare edge-cache on their upstream
`fetch()` calls (all confirmed via direct grep across their source
files — zero matches for `cf: {cacheTtl...}`, zero matches for any
run-once/cooldown check):

| Function | File | Real window | Upstream | Max real invocations vs. intended 1 |
|---|---|---|---|---|
| `runMLBSavantUpdate` | `src/mlb-savant-r2.js` | Monday, UTC 10-13 | Baseball Savant | up to 48 |
| `runNFLR2Update` | `src/nfl-r2.js` | Wednesday, UTC 12-15 | nflverse | up to 48 |
| `runNHLGSAXUpdate` | `src/nhl-gsax-r2.js` | Thursday, UTC 11 | MoneyPuck | up to 16 |
| `runNBACluichUpdate` | `src/nba-clutch-r2.js` | Mon/Wed/Fri or Wed, UTC 12 | stats.nba.com | up to 16 |
| `runNHLSeriesUpdate` | `src/nhl-series-r2.js` | April-July (no hour restriction) | NHL API | fires on every tick, ~2.5 min average, for 4 months |

Each is called from `scheduled()` in `src/index.js` (lines ~8051-8121 as
of the audit — re-confirm current line numbers per Task 1) inside a
date/time `if` guard, with no further restriction — so every real cron
tick landing inside that window/range independently re-invokes it, since
both `*/5 * * * *` and `*/15 * * * *` are live triggers in
`wrangler.toml` and Cloudflare fires `scheduled()` once per matching
cron pattern, not once per wall-clock minute.

Grouped into one CC-CMD because all five share the exact same real fix
shape (an `event.cron` gate picking ONE cron pattern to actually drive
the write, inside the existing date/time window check) — this is
mechanically repetitive across five call sites, not five different
designs.

## Task 1 — Re-verify from HEAD before writing anything (Rule 87)

- Re-read each of the five call sites in `scheduled()` fresh — confirm
  line numbers, window conditions, and function names haven't drifted
  since the audit.
- For each, confirm there's no dedup/cooldown mechanism that was added
  since the audit (re-grep each of the five source files for
  `cacheTtl`, `cacheEverything`, R2 `get`/`head` read-before-write,
  `lastRun`, `cooldown` — don't assume the audit's finding is still
  accurate at execution time).
- Each function's real intended cadence is "once per window" (weekly for
  the four hour-scoped ones, "periodically during the 4-month NHL
  playoffs+lead-in range" for `runNHLSeriesUpdate` — re-derive from each
  file's own comments/naming, don't assume "once" is right if a file's
  own comments suggest otherwise).

## Task 2 — Add gates, one per function, matching the established pattern

For the four hour-scoped functions (`runMLBSavantUpdate`,
`runNFLR2Update`, `runNHLGSAXUpdate`, `runNBACluichUpdate`): add an
`event.cron` check choosing ONE cron pattern (`*/15 * * * *` is the
natural default — matches the journalism fix's reasoning that `*/5`
exists specifically for BSD endgame capture and was never meant to
drive anything else — but confirm this against each function's own
"how fresh does this need to be" real requirement per Task 1 rather than
applying `*/15` mechanically to all five without checking).

For `runNHLSeriesUpdate` (no hour restriction, fires on literally every
tick for 4 months): this is the most exposed of the five — pick a real
cadence (e.g. once/day within the April-July window, matching the
"weekly/relatively static stat data" pattern the other four use) rather
than leaving it firing on every tick. State the real reasoning for
whatever cadence is chosen.

- Do NOT change the underlying date/hour window logic (Monday
  UTC10-13, Wednesday UTC12-15, etc.) — only add the `event.cron` layer
  on top, matching how the journalism fix left `isLiveHours`/dead-hour
  logic inside `handleJournalismCycle` completely untouched.
- Do NOT change `wrangler.toml`'s cron list.

## Task 3 — Smoke + real verification

- `node --check src/index.js` after each edit.
- Real verification for at least one of the five (the rest may cite the
  same evidence class if a full wrangler-tail campaign across all five
  real windows isn't practical in one session — but state explicitly
  which were directly observed firing correctly vs. which were verified
  by code-inspection only, per Rule 89/90: no bare "should work" claims).

---

## Explicitly NOT in scope

- Do not touch `handleCron`, `sweepKVBriefs`, `handleJournalismCycle`
  (already resolved/confirmed safe by prior CC-CMDs).
- Do not touch `runBSDClubLeagueEndgameCapture` or `runBSDEndgameCapture`
  — separate CC-CMD (`gate-bsd-club-league-capture`).
- Do not touch `runWCTournamentProjections` — audit confirmed this one
  genuinely safe (edge-cached upstream), no fix needed.
- Do not change any date/hour window boundaries — only add the
  `event.cron` layer.

---

## Outbox

`outbox/cc-session-2026-08-02-gate-weekly-r2-update-windows.md`: the
real intended cadence confirmed per function, all five gates added, and
real evidence (direct or code-inspection, stated explicitly per
function) that each fix holds without breaking its real update schedule.
