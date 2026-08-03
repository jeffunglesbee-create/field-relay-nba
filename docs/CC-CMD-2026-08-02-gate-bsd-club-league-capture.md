# CC-CMD-2026-08-02-gate-bsd-club-league-capture

**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR

One-liner:
```
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }
git pull. Read docs/CC-CMD-2026-08-02-gate-bsd-club-league-capture.md. Execute all tasks.
Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
```

---

## Real precedent

`outbox/cc-session-2026-08-02-cron-gate-audit-repowide.md` (Task 4,
finding #16) — the repo-wide cron-gate audit's highest-priority finding.
`runBSDClubLeagueEndgameCapture(env)` (`src/index.js`, called
unconditionally from `scheduled()`, gated only by
`env.FIELD_DATA && env.BSD_API_TOKEN`) fires on every `scheduled()`
invocation — both `*/5 * * * *` and `*/15 * * * *` — year-round. Its
first line is an unconditional `fetch('https://sports.bzzoiro.com/api/v2/events/live/', ...)`
with zero Cloudflare edge-cache (confirmed via grep — no `cf:
{cacheTtl...}` anywhere in the fetch call, unlike `handleWCOddsProbs`'s
protected Odds API call). Real exposure: up to 16 calls/hour, ~384/day,
indefinitely, since club leagues run essentially year-round (confirmed
by the function's own comment).

This is structurally the same pattern as both confirmed prior incidents
(June 16 Odds API P0, and this session's `handleJournalismCycle` fix) —
external paid API, unconditional across multiple overlapping cron
patterns, no cache, no dedup — except this one is CURRENTLY ACTIVE, not
retroactively discovered after a quota incident already happened.

## Task 1 — Re-verify from HEAD before writing anything (Rule 87)

- Re-read `runBSDClubLeagueEndgameCapture`'s current body fresh — confirm
  line numbers, gate condition, and upstream URL haven't changed since
  the audit.
- Determine the function's real intended cadence. Real candidates to
  investigate, don't assume:
  - Does BSD's live-events endpoint update meaningfully faster than
    15 min (i.e. is `*/5` genuinely needed for this data to stay
    useful), or was `*/5` coverage here purely incidental (the same way
    it was for journalism)?
  - Check `BSD_API_TOKEN`'s real plan/rate-limit if discoverable from
    existing code comments, `docs/`, or `STANDARDS.md`/`ADR-002-CONTEXT.md`
    references to BSD quota — do not invent a number if none exists;
    state "no documented limit found" if that's the real finding.
  - Check the sibling function `runBSDEndgameCapture` (WC-specific,
    same file) for any cadence reasoning that might carry over — its own
    comment ("single attempt per tick — cron fires every 5 min") assumed
    single-cron coverage, which was never true once `*/15` was added to
    `wrangler.toml`. Confirm whether that same wrong assumption applies
    here.

## Task 2 — Add the gate

Add an `event.cron` gate to `runBSDClubLeagueEndgameCapture`'s call site
in `scheduled()`, matching the pattern used for `handleJournalismCycle`
this session. Pick the cadence Task 1 establishes — if BSD's real-time
data genuinely benefits from 5-min freshness (unlike journalism), gate
to `*/5` instead of `*/15`; state the real reasoning either way, don't
default to `*/15` out of habit.

- Do NOT touch `runBSDEndgameCapture` (the WC-specific sibling) — it's a
  separate, currently-dormant finding (#15 in the audit), out of scope
  for this CC-CMD.
- Do NOT touch the `_isWCWindow` gating logic anywhere — that's unrelated
  to this fix and explicitly out of scope per the original
  `bsd-endgame-capture-generalize` CC-CMD's intent (club leagues running
  "outside the WC calendar" is correct and must be preserved).

## Task 3 — Smoke + real verification

- `node --check src/index.js` after the edit.
- Real verification: after deploy, use the same wrangler-tail technique
  as `CC-CMD-2026-08-02-gate-journalism-cycle-cron` — add a real,
  checkable log line at the gate (e.g. `[BSD-CLUB-GATE] cron=... fired=...`)
  and tail live logs across a window spanning both a cron-matching and a
  cron-non-matching real minute, confirming the gate holds.

---

## Explicitly NOT in scope

- Do not change `runBSDEndgameCapture` (WC-specific, separate finding).
- Do not change `_isWCWindow` or any other gating logic in this file.
- Do not change `wrangler.toml`'s cron list.

---

## Outbox

`outbox/cc-session-2026-08-02-gate-bsd-club-league-capture.md`: the real
intended cadence confirmed, the gate added, and real evidence the fix
holds without breaking club-league endgame capture on its intended
schedule.
