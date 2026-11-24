# Claude Code Command — the tennis client split drifts every week: `tennis-tier-ladders.yml` has failed three runs in a row, and `silently-dead-crons` now fails on it

**Repo:** field-relay-nba (reading) and jubilant-bassoon (`src/legacy/field.js`, the lists that drift) · **Branch:** main — commit directly, no feature branch or PR
**Type:** B (a detector reporting a real mismatch between the relay and the client; no data is wrong) · **Filed:** 2026-11-24, by the 20:00Z daily read of the watches (0 credits, reads only)
**Status:** FILED, not dispatched. Needs the owner's choice between the options below before any client change. **Confidence gate:** >= 95 before any commit.

## What was read (2026-11-24)

- `silently-dead-crons` run 45291994927 (2026-11-23T23:48Z) concluded **failure**: `NEW, not in the baseline: 1`, `jeffunglesbee-create/field-relay-nba:.github/workflows/tennis-tier-ladders.yml`
  (`outbox/silently-dead-crons-2026-11-23T23-51-25-018Z.log`). Its ratchet fails the run on any key not in `docs/dead-cron-baseline.json`, so that watch stays red every day until this is fixed or admitted.
- `tennis-tier-ladders.yml` runs weekly (Mondays). 2026-11-02 success; **2026-11-09, 11-16 and 11-23 failure** (runs 42628510656, 43876553622, 45209954855). Each failure is the workflow's own exit 1
  on `summary.clientSplitDrift` (`scripts/tennis-tier-ladders.mjs`, the `splitDrift` block), and **the finding differs every week**:

| run | `outbox/tennis-tier-ladders-<stamp>.json` `summary.clientSplitDrift` |
|---|---|
| 2026-11-09 | WTA Finals (204) serves NO main-draw round but the client admits it — the tab would offer an empty bracket |
| 2026-11-16 | ATP Finals (209) serves NO main-draw round but the client admits it — the tab would offer an empty bracket |
| 2026-11-23 | Davis Cup (446) now serves 1 main-draw match(es) but the client excludes it by name — a real draw nobody can reach |

## What is established, and what is not (Rule 100)

- Established: the three strings above, from the committed readings; the client lists they compare against are static (`TENNIS_NAMED` at `src/legacy/field.js:9899` and `_TENNIS_DRAW_NO_BRACKET` at
  `:32719` in jubilant-bassoon, read 2026-11-24); the relay's answer changes as each event's calendar passes.
- **Not established:** (1) that the deployed client really renders an empty bracket for an event with no main draw (the detector asserts it from the lists; no browser read exists); (2) that the one Davis Cup
  match is a draw a user would want shown; (3) the hypothesis that follows, which is a hypothesis: a static name list will disagree with a calendar-driven route around the start and the end of every named event,
  so this detector will be red several weeks a year whatever the lists say.

## Options (the owner's decision; none is taken here)

1. **Decide at run time, in the client:** a named event shows its draw tab if and only if the draw route serves at least one main-draw match. Removes the class. A client behaviour change (jubilant-bassoon, `field.js`,
   its smoke and a deploy), so not a relay fix and not mine to choose. If the relay already serves the fact the client needs, nothing changes here (Rule 60); if it does not, the relay field is the first commit.
2. **Keep the static lists and edit them per event.** For the Davis Cup the file's own comment says what to do: remove it from `_TENNIS_DRAW_NO_BRACKET` AND give it a tier rank (a null rank skips it a line later).
   Recurring cost, and the Finals entries would need the reverse edit when their events end.
3. **Admit the entry in `docs/dead-cron-baseline.json`** with a `review_by` date. Quiets `silently-dead-crons`, fixes nothing, and the file's header says what that costs.

## Tasks (probe first, Rule 87)

1. **Probe:** `node scripts/tennis-tier-ladders.mjs` on a runner (`workflow_dispatch` of `tennis-tier-ladders.yml`, which commits its reading) and read `summary.clientSplitDrift`; record whether the Davis Cup finding is still there
   now the Finals are over, and whether `unread` still lists `wta_250 53 Antalya 3, Turkiye HTTP 409` (it did on 2026-11-23, and is a different problem: a 409 from the draw route).
2. Take the owner's choice among the options, then implement it with the check that holds it (mutation first, Rule 90).

## Done condition (Rule 89)

```
node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1]));console.log(j.summary.clientSplitDrift)' outbox/tennis-tier-ladders-<newest>.json   # []
grep -m1 'NEW, not in the baseline' outbox/silently-dead-crons-<newest>.log                                                                                 # NEW, not in the baseline  : 0
```
