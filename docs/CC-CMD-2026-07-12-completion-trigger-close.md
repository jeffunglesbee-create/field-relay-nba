# Claude Code Command — Close out completion-triggered journalism (source tag + shadowing) and fix verify-pending-checks.yml

**Date:** 2026-07-12
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR.
**Scope:** src/index.js (2 targeted changes) + .github/workflows/verify-pending-checks.yml.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO — this CC-CMD targets field-relay-nba"; exit 1; }
git pull. Read CLAUDE.md.

Write findings to outbox/cc-completion-trigger-close-2026-07-12.md.

## CONTEXT — fully traced by chat this session, two real bugs confirmed live, not theorized

Commit `9a6cdf2`'s `Verify Pending Follow-Up Checks` run failed. Investigating it surfaced two real, independently-confirmed bugs, both in this repo:

1. **Source mislabeling.** The queue consumer (`async queue(batch, env, ctx)`, the `INSERT INTO briefs` for `job.type === 'game-brief'`) hardcodes `source` to the SQL literal `'cron'` for every message, regardless of what enqueued it. `/journalism/game-complete`'s handler never sets a `source` field in its enqueue payload at all. Confirmed via direct D1 query: 0 of 679 `game_recap` rows have ever had `source='completion-trigger'`; only `cron`/`kv_sweep`/`kv_capture` exist.

2. **Shadowing.** `/journalism/game-complete` skips its own enqueue if `FIELD_JOURNALISM.get('brief:game:'+gameId)` returns any existing value at all — a naive existence check, not a content/state check. Confirmed live against 7 real in-progress MLB games simultaneously (`espn:401816126` through `401816133`, all `state:'live'` at check time): every one already had a real `game_recap` brief cached from the ordinary ~15min cron, generated *while the game was still live*. By the time any of these games reaches `state:'final'`/`'post'`, that slot is already filled, so GameDO's completion-triggered enqueue attempt is skipped before it ever reaches the queue — essentially every time, for every game.

The queue consumer already has a *better* check available for exactly this situation — the `job.gameHash` content-validated cache check (added 2026-07-03, comment at the top of the `game-brief` branch) — which correctly distinguishes "state genuinely unchanged, skip" from "state changed, regenerate." `/journalism/game-complete`'s cruder existence-only check duplicates and undermines that, for no benefit: a completion event is by definition a state change, so it should never be blocked by "something was cached earlier."

## TASK 1 — Tag the source correctly

In `/journalism/game-complete`'s handler, add `source: 'completion-trigger'` to the `JOURNALISM_QUEUE.send({...})` payload. In the queue consumer's `INSERT INTO briefs`, replace the hardcoded `'cron'` literal with a bound parameter reading `job.source || 'cron'` — preserves current behavior for the other 5 enqueue sites (none of which currently set `job.source`), makes this one path distinguishable going forward. Do not touch the other 5 sites' payload construction — out of scope, they're working correctly as `'cron'`.

## TASK 2 — Remove the naive existence check, trust the gameHash cache instead

In `/journalism/game-complete`'s handler, remove the `if (!existing) { ... }` gate entirely (the `FIELD_JOURNALISM.get('brief:game:'+gameId)` call and its wrapping condition). Enqueue unconditionally on every genuine completion event — this is already rate-limited to at most once per game by GameDO's own `archived` DO-storage flag one level up, so this does not introduce a duplicate-enqueue risk. Do **not** add a `gameHash` to this specific enqueue call (the completion payload doesn't have one to compute meaningfully the way the pre-generation site does) — confirm via TASK 0 probe that omitting `gameHash` here safely falls through to normal regeneration in the consumer (per the consumer's own comment: "the other 5 leave it undefined, which never matches a real stored hash, so this check safely falls through"), not a guess.

## TASK 0 — Probe (do before TASK 1/2)

```bash
grep -n "job.gameHash\|contextHash" src/index.js | head -10
sed -n '11836,11876p' src/index.js
```

Confirm the exact current line numbers and surrounding code before editing — this doc's line numbers are from earlier this session and may have shifted with intervening commits.

## TASK 3 — Fix verify-pending-checks.yml

- Fix the crash in the "Log results to codex" step. Probe first — do not guess at the cause: add a status-code check after `urllib.request.urlopen(req)` (or wrap with a try/except that prints the real response body on failure) and re-run via `workflow_dispatch` to observe the actual failure, rather than assuming what it is.
- The `savant` check has been independently confirmed done (1115 real `change_log` rows). Remove it from this workflow — it's answered permanently, re-checking it every 6 hours forever adds no value. If a *different*, ongoing signal is wanted (e.g. "has savant gone silent recently"), that's a separate, different check — do not build it here, note it as a possible future item in the outbox only.
- After TASK 1/2 land and deploy, the `completion-trigger` check becomes meaningful for the first time. Leave the check in place, but confirm the workflow correctly reports success once a real game completes post-fix — do not assume, wait for or manually trigger a real completion if one is available within this session's time, and report the real outcome either way.

## TASK 4 — Verification

- `node --check src/index.js`.
- D1: after a real game completes post-deploy, confirm a row exists with `source='completion-trigger'` for it.
- Confirm the workflow's codex-write step succeeds (a real `auto-verify-*` entry appears, or the removed-savant-check version of the script completes without the prior crash).
- Write outbox manifest per Rule 87.

## DONE CONDITION

Source correctly threaded through for the completion-trigger path specifically, with zero behavior change to the other 5 enqueue sites. Naive existence check removed, replaced by trusting the existing gameHash-aware cache logic already in the consumer. `verify-pending-checks.yml`'s crash fixed with a confirmed real cause, not a guessed one. Savant check removed as permanently answered. If a real game completion occurs within this session, the fix is confirmed live end-to-end; if not, state plainly that it's deployed-but-not-yet-observed-firing, not "confirmed working."

**Confidence scoring:**
- TASK 0 probe confirms real current line numbers/code before editing (10 pts)
- TASK 1 source threading correct, zero change to other 5 sites (20 pts)
- TASK 2 naive check removed, reasoning for safety (gameHash fallthrough, DO-level dedup) verified not assumed (25 pts)
- TASK 3 workflow crash fixed with a confirmed real cause; savant check removed (25 pts)
- TASK 4 honest reporting of whether a live completion was actually observed post-fix, not claimed without evidence (20 pts)

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
