# CC-CMD: Phase 13 — Record Streak Board (real win/loss streaks)

**Date:** 2026-07-21
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR
**Scope:** One new function in src/analytics-engine.js, one new wiring line
in processDate, one new PURE_PHASE_DISPATCH entry, one new recompute
endpoint in src/index.js, one new field in the /analytics/newspaper bundle.

**Why — real, confirmed bug, not a hypothetical.** The public "STREAK BOARD"
card on the client Desk view (jubilant-bassoon) currently reads
`streak_board` (Phase 7), which is FIELD's own journalism-quality streak
per team (consecutive briefs scoring >=130/  <80), NOT the team's actual
win/loss record. Confirmed live 2026-07-21 via direct read of
runPhase7StreakBoard and a live probe of /analytics/newspaper/2026-07-21
(cold:[] genuinely empty, hot[] entries are quality-score streaks, e.g.
"Brewers streak:19" = 19 consecutive well-scored briefs, not 19 wins).
Logged as Codex incident `streak-board-metric-mismatch` (status: open).
This CC-CMD does NOT touch Phase 7 — it is a legitimate internal editorial
QA signal and stays exactly as-is. This CC-CMD adds a SEPARATE feature,
`record_streak_board`, computing REAL win/loss streaks from game results,
so the client (separate CC-CMD, gated on this one) can point the existing
card at accurate data instead.

**Target time:** ~25 min

---

## Do NOT Touch

- `runPhase7StreakBoard`, the `streak_board` feature, or anything in its
  PURE_PHASE_DISPATCH entry — leave completely as-is.
- Any AI-costing phase (Phase 3, 5, 9, 10A, 6B, 6C) or `callProxy`.
- `regular_season_games` / `postseason_games` table schemas.
- The client repo (jubilant-bassoon) — this CC-CMD is relay-only.

---

## Pre-Build Probe (run FIRST — re-verify against current HEAD; this doc's
line/content references are from a read at a session earlier today and may
have drifted)

```bash
git log --oneline -5
grep -n "async function runPhase7StreakBoard" src/analytics-engine.js
grep -n "PURE_PHASE_DISPATCH = {" -A 12 src/analytics-engine.js
grep -n "Phase 7: Streak Board" -A 8 src/analytics-engine.js
grep -n "'/analytics/jinx/recompute'" -A 15 src/index.js
grep -n "streak_board: recap.streak_board" -B 2 -A 2 src/index.js
grep -n "PHASE_NAMES" src/analytics-engine.js
```
Confirm `runPhase7StreakBoard`'s real current body still matches the shape
cited below before writing anything. If it has changed materially, adapt
the new function to the real current pattern rather than the one described
here — this doc's job is to specify the real fix, not to be followed
blindly if reality has moved.

---

## TASK 1 — Add `runPhase13RecordStreakBoard` to src/analytics-engine.js

Insert immediately after `runPhase7StreakBoard`'s closing `}` (before the
`// ── Phase 8: Quality Feedback` comment):

```javascript
// ── Phase 13: Record Streak Board (nightly) ────────────────────────────────
// Detect consecutive win (hot) or loss (cold) streaks per team over the
// last 14 days of FINALIZED games — real game outcomes, computed directly
// from regular_season_games/postseason_games home_score/away_score. This
// is DISTINCT from Phase 7 (streak_board), which tracks FIELD's own
// journalism quality per team, not game results — see Codex incident
// 'streak-board-metric-mismatch' (2026-07-21). No AI call; the detection
// IS the feature. Same STREAK_MIN/lookback convention as Phase 7 and the
// identical { hot, cold } shape (each entry { team, sport, streak, dates })
// so the client can swap data sources with a minimal change.
async function runPhase13RecordStreakBoard(env, date) {
    const STREAK_LOOKBACK_DAYS = 14;
    const STREAK_MIN = 3;
    const since = addDays(date, -STREAK_LOOKBACK_DAYS);

    const [regRes, psRes] = await Promise.allSettled([
        env.ARCHIVE_DB.prepare(`
            SELECT date, sport, home, away, home_score, away_score
            FROM regular_season_games
            WHERE date >= ? AND date <= ? AND finalized_at IS NOT NULL
              AND home_score IS NOT NULL AND away_score IS NOT NULL
            ORDER BY date ASC
        `).bind(since, date).all(),
        env.ARCHIVE_DB.prepare(`
            SELECT date, sport, home, away, home_score, away_score
            FROM postseason_games
            WHERE date >= ? AND date <= ? AND finalized_at IS NOT NULL
              AND home_score IS NOT NULL AND away_score IS NOT NULL
            ORDER BY date ASC
        `).bind(since, date).all(),
    ]);
    const rows = []
        .concat(regRes.status === 'fulfilled' ? (regRes.value.results || []) : [])
        .concat(psRes.status  === 'fulfilled' ? (psRes.value.results  || []) : []);

    if (rows.length < 3) {
        console.log(`[ANALYTICS] Phase 13 degraded: only ${rows.length} finalized games in window`);
        await writeAnalyticsOutput(env, {
            date,
            feature: 'record_streak_board',
            sport: null,
            value: { hot: [], cold: [], degraded: true, games_in_window: rows.length },
            briefText: null,
        });
        return {};
    }

    // Per-team chronological series of (date, result). result: 1 = win,
    // -1 = loss, 0 = tie. A tie is a real, if rare, outcome (soccer) and
    // breaks both streaks — same convention Phase 7 uses for its neutral
    // (80-129) band, and the same tie-as-neutral convention already
    // established in the pick'em feature (2026-07-05).
    const perTeam = new Map();
    for (const r of rows) {
        if (r.home_score === r.away_score) {
            for (const team of [r.home, r.away]) {
                if (!team) continue;
                const key = `${team}|${r.sport || ''}`;
                if (!perTeam.has(key)) perTeam.set(key, []);
                perTeam.get(key).push({ date: r.date, result: 0 });
            }
            continue;
        }
        const winner = r.home_score > r.away_score ? r.home : r.away;
        const loser  = r.home_score > r.away_score ? r.away : r.home;
        if (winner) {
            const key = `${winner}|${r.sport || ''}`;
            if (!perTeam.has(key)) perTeam.set(key, []);
            perTeam.get(key).push({ date: r.date, result: 1 });
        }
        if (loser) {
            const key = `${loser}|${r.sport || ''}`;
            if (!perTeam.has(key)) perTeam.set(key, []);
            perTeam.get(key).push({ date: r.date, result: -1 });
        }
    }

    const hot = [], cold = [];
    for (const [key, series] of perTeam) {
        series.sort((a, b) => a.date.localeCompare(b.date));
        const [team, sport] = key.split('|');

        let hotRun = [], coldRun = [];
        for (const g of series) {
            if (g.result === 1) {
                hotRun.push(g.date);
                coldRun = [];
            } else if (g.result === -1) {
                coldRun.push(g.date);
                hotRun = [];
            } else {
                hotRun = [];
                coldRun = [];
            }
        }
        if (hotRun.length >= STREAK_MIN) {
            hot.push({ team, sport: sport || null, streak: hotRun.length, dates: hotRun });
        }
        if (coldRun.length >= STREAK_MIN) {
            cold.push({ team, sport: sport || null, streak: coldRun.length, dates: coldRun });
        }
    }
    hot.sort((a, b) => b.streak - a.streak);
    cold.sort((a, b) => b.streak - a.streak);

    await writeAnalyticsOutput(env, {
        date,
        feature: 'record_streak_board',
        sport: null,
        value: { hot, cold, lookback_days: STREAK_LOOKBACK_DAYS },
        briefText: null,
    });
    return {};
}
```

**Note on expected magnitude:** unlike Phase 7's quality-streaks (which can
exceed 14 because multiple brief TYPES per game each count separately),
real per-game win/loss streaks are capped by how many games a team
actually plays in the 14-day window — for a near-daily sport like MLB,
expect single-digit-to-low-teens streak values, not the 19+ seen in the
quality-based numbers. This is correct, not a regression — flag it in the
outbox so it isn't mistaken for a bug on review.

## TASK 2 — Wire into `processDate`

Immediately after the existing Phase 7 block:
```javascript
        // Phase 7: Streak Board — hot/cold runs over last 14 days of briefs
        try {
            await runPhase7StreakBoard(env, date);
            featuresComputed++;
            phasesCompleted.push('phase7');
        } catch (e) {
            phasesFailed.push('phase7');
            errors.push(`phase7: ${e.message}`);
        }
```
add:
```javascript
        // Phase 13: Record Streak Board — real win/loss runs over last 14
        // days of finalized games (distinct from Phase 7's quality streaks)
        try {
            await runPhase13RecordStreakBoard(env, date);
            featuresComputed++;
            phasesCompleted.push('phase13');
        } catch (e) {
            phasesFailed.push('phase13');
            errors.push(`phase13: ${e.message}`);
        }
```

## TASK 3 — Register in `PURE_PHASE_DISPATCH`

Add one line to the existing map (in the same file):
```javascript
    record_streak_board: async (env, date) => runPhase13RecordStreakBoard(env, date),
```

## TASK 4 — New recompute endpoint in src/index.js

Mirror `/analytics/jinx/recompute` exactly (same auth header check, same
shape), placed alongside the existing per-feature recompute routes:
```javascript
        // POST /analytics/record-streak/recompute?date=YYYY-MM-DD — manual,
        // single-purpose recompute for the PURE record_streak_board feature.
        // Exists so this new phase can be verified same-session against a
        // real date without waiting for tomorrow's 0 9 * * * cron. Same
        // auth pattern as /analytics/jinx/recompute.
        if (pathname === '/analytics/record-streak/recompute' && request.method === 'POST') {
            const authHeader = request.headers.get('X-FIELD-Relay');
            if (authHeader !== 'field-relay-cron-2026') {
                return new Response('unauthorized', { status: 401, headers: CORS });
            }
            const date = url.searchParams.get('date');
            if (!date) {
                return new Response(JSON.stringify({ ok: false, error: 'date query param required (YYYY-MM-DD)' }),
                    { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
            }
            const result = await recomputePhase(env, 'record_streak_board', date);
            return new Response(JSON.stringify({ ok: true, date, ...result }),
                { headers: { ...CORS, 'Content-Type': 'application/json' } });
        }
```
Also add `'/analytics/record-streak/recompute'` to the same auth-bypass
guard list that already includes `/analytics/jinx/recompute` (grep for that
exact list — the routing guard checked in the probe block above).

## TASK 5 — Add to the newspaper bundle

In the `/analytics/newspaper/{date}` bundle assembly, immediately after:
```javascript
                    streak_board: recap.streak_board?.value || null,
```
add:
```javascript
                    record_streak_board: recap.record_streak_board?.value || null,
```

## TASK 6 — Real behavioral verification (in-session, not deferred)

```bash
# 1. Trigger the new phase for today's date (auth header required):
curl -s -X POST "https://field-relay-nba.jeffunglesbee.workers.dev/analytics/record-streak/recompute?date=2026-07-21" \
  -H "X-FIELD-Relay: field-relay-cron-2026" | python3 -m json.tool

# 2. Confirm the newspaper bundle now carries it:
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/analytics/newspaper/2026-07-21" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(json.dumps(d.get('record_streak_board'), indent=2))"
```
Confirm the response has real team names with plausible small-integer
streak values (not empty, not an error, not suspiciously identical to
Phase 7's `streak_board` output — if the numbers match Phase 7's
quality-streak numbers exactly, something is wired wrong).

## TASK 7 — Smoke / build

```bash
node --check src/index.js
node --check src/analytics-engine.js
```
(No smoke.js in this repo — see field-relay-nba's own quality gate, a
syntax check, not smoke assertions.)

## TASK 8 — Commit + deploy + outbox manifest

```bash
git add src/analytics-engine.js src/index.js
git commit -m "feat: Phase 13 Record Streak Board — real win/loss streaks, separate from Phase 7's quality-based streak_board (fixes streak-board-metric-mismatch)"
git push -u origin main
```
Wait for deploy-gate CI, then re-run TASK 6's curl commands against the
LIVE deployed URL (not just locally) to confirm the deployed version
behaves identically. Write manifest to outbox/ per Rule 67, including:
commit hash, deploy run ID/status, both TASK 6 outputs verbatim, and
explicit confirmation Phase 7 / streak_board was not modified.

---

## Done Condition

`POST /analytics/record-streak/recompute?date=2026-07-21` (against the
LIVE deployed URL) returns real team names with plausible small-integer
win/loss streak values, distinct from Phase 7's `streak_board` output for
the same date. `record_streak_board` appears in the `/analytics/newspaper/
2026-07-21` bundle. Phase 7 unchanged (diff-confirmed). Both files pass
`node --check`.

**Confidence scoring:**
- T1 (25 pts): Phase 13 function correct — real win/loss logic against the
  real schema (finalized_at, home_score, away_score), same STREAK_MIN/
  lookback/shape convention as Phase 7
- T2+T3 (15 pts): wired into processDate and PURE_PHASE_DISPATCH correctly
- T4 (20 pts): new recompute endpoint mirrors the jinx pattern exactly,
  including the auth-bypass guard list addition
- T5 (10 pts): newspaper bundle carries the new field
- T6 (25 pts): real behavioral verification against the LIVE deployed URL —
  real data, not empty/error, not accidentally identical to Phase 7
- T7+T8 (5 pts): clean syntax check, clean commit, honest outbox manifest

Automate follow-ups. No fallbacks, only fixes — if `finalized_at` turns out
not to be reliably populated, or home/away team-name strings don't match
Phase 7's naming convention 1:1, investigate and fix the real cause (do not
add a client-side reconciliation layer or silently swap to a different,
unverified data source).

Do not commit unless confidence >= 95. If score < 95, report verbatim and
stop.

---

## ONE-LINER

git pull. Read docs/CC-CMD-2026-07-21-record-streak-board.md.
Add Phase 13 (runPhase13RecordStreakBoard) computing REAL win/loss streaks
from regular_season_games/postseason_games home_score/away_score --
completely separate from Phase 7's streak_board, which tracks journalism
quality and must not be touched. Wire into processDate, PURE_PHASE_DISPATCH,
the newspaper bundle, and a new /analytics/record-streak/recompute endpoint
mirroring /analytics/jinx/recompute. Verify against the LIVE deployed URL
with a real date, not just local logic. Automate follow-ups. No fallbacks,
only fixes.
Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
