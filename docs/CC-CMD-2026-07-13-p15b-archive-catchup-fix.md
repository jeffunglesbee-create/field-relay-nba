# Claude Code Command — P15B: move archive catch-up before the WC morning-brief guard (relay)

**Date:** 2026-07-13
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO — this CC-CMD targets field-relay-nba"; exit 1; }; git pull.

Write findings to outbox/p15b-2026-07-13.md.

## CONTEXT — a real bug, confirmed live 23 days after it was first diagnosed

`handleJournalismCycle`'s archive catch-up (backfills GameDO archive rows for games that went final while no client was watching) is positioned after the WC morning-brief early return: `if (isMorningWindow && ...) { ... if (alreadyRan) return {ok:false, reason:"wc morning brief already ran today"}; ... }`. When that guard fires (11:00-13:00 UTC, after the first successful morning-brief run that day), the catch-up code never executes for that tick. Bounded impact — the next tick outside the window catches up — but it's a real, unfixed structural bug, not a design choice.

Original diagnosis (June 20) specified the fix: move the entire archive catch-up block to run independently of which brief path fires, ahead of the morning-brief guard.

## TASK 0 — Probe (map full control flow before touching anything, per the original incident's own lesson)

```bash
grep -n "return" src/index.js | awk -v s=$(grep -n "async function handleJournalismCycle" src/index.js | head -1 | cut -d: -f1) '$1>=s && $1<=s+400'
```

Confirm the exact current boundaries of the morning-brief `if` block and the catch-up block before moving anything. Line numbers will have shifted since June 20 — do not assume the old numbers still apply.

## TASK 1 — Move the catch-up block

Relocate the full archive catch-up block (`let _catchupFilled = 0` through its closing log) to execute before the WC morning-brief check, so it runs on every live-hours tick regardless of morning-brief dedup state.

## TASK 2 — Verify

- Confirm via a fresh control-flow read that the catch-up is now reachable on every live-hours tick, including during the 11:00-13:00 UTC window after the morning brief has already run today.
- Confirm the morning-brief logic itself is unaffected — same dedup behavior, same output.
- Run whatever test/lint mechanism this repo has for relay changes.

## DONE CONDITION

Archive catch-up runs on every live-hours tick, verified via control-flow trace, not just visual inspection. Morning-brief behavior unchanged. Real verification, not just "moved the code."

**Confidence scoring:**
- TASK 0 maps real current control flow, doesn't assume June 20's line numbers (25 pts)
- TASK 1 correctly relocates the block, catch-up genuinely independent of morning-brief state (45 pts)
- TASK 2 verified via control-flow trace + no regression to morning-brief behavior (30 pts)

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
