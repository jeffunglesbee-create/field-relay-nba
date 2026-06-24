# CC-CMD: Bracket Traps (Elimination) + Debrief Context — Phase 2+3
**Date:** 2026-06-24  
**Repo:** field-relay-nba  
**Depends on:** CC-CMD-2026-06-24-bracket-snapshots.md MUST be complete first.  
**Rule 87:** Self-completing. All probes, edits, verification, and outbox manifest run inside this session.

---

## CONTEXT + WHAT'S ALREADY BUILT

**DO NOT REBUILD these — they already exist:**
- `detectBracketTraps` in `src/wc-tournament-projections.js` — PATH trap detection
  (teams where finishing 2nd yields higher pChamp than 1st). Live on `/wc/projections`
  as `bracketTraps[]` and `/wc/traps`. Movers brief already injects top 3.
- `/wc/traps` endpoint in `src/index.js` — reads bracketTraps from KV.

**What this CC-CMD builds:**
- Phase 2: ELIMINATION/DANGER trap detection for idle teams (different from path traps)
- Phase 3: `findBracketImpact` in context-assembler (reads bracket_snapshots from Phase 1)
- Phase 3: Per-game WC journalism context injection (trap + bracket impact)

---

## PROBE BLOCK — read before writing anything

1. In `src/wc-tournament-projections.js`, grep for `detectBracketTraps` and confirm:
   - It takes `(countsByPos, N, nameToCtx)` — path-position analysis only
   - It does NOT take `todayGames` or do `worstCaseScenario` — that's the gap

2. In `src/index.js`, confirm `/wc/traps` exists and returns `bracketTraps` from KV.
   Note the exact line number — the NEW `/wc/elimination-traps` endpoint goes nearby.

3. In `src/context-assembler.js`, grep for `findBracketImpact` and `bracket_impact` —
   confirm neither exists yet. Note the `CONTEXT_SOURCES` array line number.

4. In `src/index.js`, grep for how WC journalism prompts are assembled currently —
   look for `buildWCGamePrompt`, `wc-brief`, or any prompt builder that could receive
   trap context. This is where per-game trap injection will go.

5. Confirm `bracket_snapshots` table exists in ARCHIVE_DB (from Phase 1):
   Query `SELECT COUNT(*) FROM bracket_snapshots` — must return > 0.

---

## TASK 1 — Elimination/Danger trap detection (Phase 2)

### 1a. New function `detectEliminationTraps` in `src/wc-tournament-projections.js`

This is conceptually different from `detectBracketTraps`:
- PATH trap (existing): team's OWN group finish position matters (1st vs 2nd path)
- ELIMINATION trap (new): IDLE team's survival depends on OTHER games' results today

Add after the existing `detectBracketTraps` function:

```javascript
// ── detectEliminationTraps ───────────────────────────────────────────────────
// Finds teams at risk of being eliminated or dropping to LIFE SUPPORT (<15%)
// based on results in games they are NOT playing in today.
//
// todayGames: array of { home, away } for games happening today
// projections: output from computeTournamentProjections (has .teams[])
// standings: current group standings { groupLetter: [{name, pts, gd, gf, ...}] }
//
// Method: for each idle team (not in todayGames), run a lightweight sweep of
// plausible worst-case scenarios (favorable results for their rivals) and compute
// the minimum advancement probability across those scenarios.
//
// Returns: [{
//   team, group, fifaCode,
//   currentProb,     // current pR32
//   worstCaseProb,   // min pR32 across adversarial scenarios
//   type: 'ELIMINATION_TRAP' | 'DANGER_TRAP',
//   dependsOn: [{ game: 'Germany vs Ecuador', needed: 'Germany must NOT win' }]
// }]
//
// RUWT COMPLIANCE: named binary conditions only. No drama scoring.
// ADR-002: arithmetic on standings data, not composite interest.

export function detectEliminationTraps(todayGames, projections, standings) {
    if (!todayGames?.length || !projections?.teams?.length) return [];

    const playingTeams = new Set(
        todayGames.flatMap(g => [g.home, g.away])
            .map(n => (n || '').toLowerCase().trim())
    );

    const DANGER_THRESHOLD     = 0.15;  // below = LIFE SUPPORT
    const ELIM_THRESHOLD       = 0.02;  // below = effectively eliminated

    const teamMap = {};
    for (const t of projections.teams) {
        teamMap[(t.name || '').toLowerCase().trim()] = t;
    }

    const traps = [];

    // For each idle team with meaningful survival probability
    for (const t of projections.teams) {
        const key = (t.name || '').toLowerCase().trim();
        if (playingTeams.has(key)) continue;           // playing today — skip
        const currentProb = t.pR32 ?? 0;
        if (currentProb >= 0.98) continue;             // already through — skip
        if (currentProb <= 0.02) continue;             // already eliminated — skip

        // Find this team's group and rivals playing today
        const group = t.group;
        if (!group) continue;

        const groupGames = todayGames.filter(g => {
            // Games in the same group affect this team
            const hKey = (g.home || '').toLowerCase().trim();
            const aKey = (g.away || '').toLowerCase().trim();
            const hTeam = teamMap[hKey];
            const aTeam = teamMap[aKey];
            return (hTeam?.group === group) || (aTeam?.group === group);
        });

        if (!groupGames.length) continue;  // no group games today — skip

        // Worst case: rivals in group win their games (maximally bad for idle team)
        // This is a conservative approximation — not a full Monte Carlo sweep —
        // sufficient for surfacing meaningful traps without O(n^3) simulation cost.
        let worstCaseProb = currentProb;
        const dependsOn = [];

        for (const g of groupGames) {
            const hKey = (g.home || '').toLowerCase().trim();
            const aKey = (g.away || '').toLowerCase().trim();
            const hTeam = teamMap[hKey];
            const aTeam = teamMap[aKey];

            // If a rival wins, they pull ahead in standings — hurts idle team
            // Use a conservative 30% degradation per adversarial game as proxy
            // (real impact varies by points gap; this flags credible risks)
            if (hTeam?.group === group || aTeam?.group === group) {
                worstCaseProb *= 0.70;
                const rival = hTeam?.group === group ? g.home : g.away;
                const needed = hTeam?.group === group
                    ? `${g.away} must not lose`
                    : `${g.home} must not lose`;
                dependsOn.push({ game: `${g.home} vs ${g.away}`, needed });
            }
        }

        // Only surface if worst case crosses a meaningful threshold
        if (worstCaseProb < DANGER_THRESHOLD && currentProb >= DANGER_THRESHOLD) {
            traps.push({
                team:           t.name,
                group:          t.group,
                fifaCode:       t.fifaCode,
                currentProb:    Math.round(currentProb * 1000) / 1000,
                worstCaseProb:  Math.round(worstCaseProb * 1000) / 1000,
                type:           worstCaseProb < ELIM_THRESHOLD
                                    ? 'ELIMINATION_TRAP' : 'DANGER_TRAP',
                dependsOn,
            });
        }
    }

    return traps.sort((a, b) => a.worstCaseProb - b.worstCaseProb);
}
```

### 1b. New endpoint `GET /wc/elimination-traps` in `src/index.js`

Add near the existing `/wc/traps` endpoint. Accepts optional `?date=YYYY-MM-DD`
to scope "today's games" — defaults to today UTC.

```javascript
// GET /wc/elimination-traps — teams at risk from today's other games.
// Different from /wc/traps (path traps). Uses current projections + standings
// to find idle teams whose pR32 could fall below DANGER threshold today.
if (pathname === '/wc/elimination-traps') {
    try {
        const kvProj = env.FIELD_JOURNALISM
            ? await env.FIELD_JOURNALISM.get('wc:projections:current') : null;
        if (!kvProj) return new Response(
            JSON.stringify({ ok: true, traps: [], pending: true }),
            { headers: { ...CORS, 'Content-Type': 'application/json' } }
        );
        const projections = JSON.parse(kvProj);

        // Get today's WC fixtures from odds-probs (games with commence today)
        const today = (url.searchParams.get('date') ||
            new Date().toISOString().slice(0, 10));
        const oddsRes = await fetch(`${RELAY_BASE}/wc/odds-probs`, { cache: 'no-store' });
        const oddsData = oddsRes.ok ? await oddsRes.json() : { probs: [] };
        const todayGames = (oddsData.probs || [])
            .filter(g => (g.commence || '').startsWith(today))
            .map(g => ({ home: g.home_team, away: g.away_team }));

        // Get standings for group context
        const standRes = await fetch(`${RELAY_BASE}/wc/standings`, { cache: 'no-store' });
        const standings = standRes.ok ? (await standRes.json()).groups ?? {} : {};

        const { detectEliminationTraps } = await import('./wc-tournament-projections.js');
        const traps = detectEliminationTraps(todayGames, projections, standings);

        return new Response(JSON.stringify({
            ok: true,
            date: today,
            todayGameCount: todayGames.length,
            traps,
            generatedAt: new Date().toISOString(),
        }), { headers: { ...CORS, 'Content-Type': 'application/json',
                         'Cache-Control': 'public, max-age=300' } });
    } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: e.message }),
            { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
}
```

Add `/wc/elimination-traps` to the probe allow-list (`ALLOWED_EXACT`).

**Verification:** `node --check src/wc-tournament-projections.js` passes.
Probe `/wc/elimination-traps` — returns `ok:true` with `traps` array (may be empty
if no games today or all teams are already through).

---

## TASK 2 — `findBracketImpact` in context-assembler (Phase 3)

### 2a. Add helper to `src/context-assembler.js`

This reads `bracket_snapshots` (built in Phase 1) to find pre/post delta for a
specific game. Add after the existing helper functions, before CONTEXT_SOURCES:

```javascript
// ── findBracketImpact ────────────────────────────────────────────────────────
// Reads bracket_snapshots to find pre/post championship probability delta
// for the teams involved in a specific WC game.
// Returns: { teamName: { before, after, change, stateBefore, stateAfter } }
// Empty object if no snapshots found for this game.

function advancementState(prob) {
    if (prob <= 0)    return 'ELIMINATED';
    if (prob < 0.15)  return 'LIFE SUPPORT';
    if (prob < 0.40)  return 'DANGER';
    if (prob < 0.70)  return 'ALIVE';
    if (prob < 0.90)  return 'STRONG';
    return                   'THROUGH';
}

async function findBracketImpact(env, triggeredBy) {
    if (!env?.ARCHIVE_DB || !triggeredBy) return {};
    try {
        const rows = await env.ARCHIVE_DB.prepare(
            `SELECT team, champion_prob, r32_prob, created_at
             FROM bracket_snapshots
             WHERE triggered_by = ?
             ORDER BY team, created_at`
        ).bind(triggeredBy).all();

        const impact = {};
        for (const row of (rows.results || [])) {
            if (!impact[row.team]) {
                impact[row.team] = { before: row.champion_prob, r32Before: row.r32_prob };
            } else {
                impact[row.team].after    = row.champion_prob;
                impact[row.team].r32After = row.r32_prob;
            }
        }
        for (const [team, d] of Object.entries(impact)) {
            if (d.before != null && d.after != null) {
                d.change       = Math.round((d.after - d.before) * 1000) / 1000;
                d.stateBefore  = advancementState(d.r32Before ?? 0);
                d.stateAfter   = advancementState(d.r32After  ?? 0);
            }
        }
        return impact;
    } catch (_) { return {}; }
}
```

### 2b. Add `bracket_impact` to WC game context assembly

In `assembleContext` (or wherever WC game context is built), add a new source
that calls `findBracketImpact` for post-game WC briefs.

Find the CONTEXT_SOURCES array. Add a new entry for bracket impact — only fires
for WC sport, only when a `triggeredBy` game ID is available:

```javascript
{ id: 'bracket_impact', priority: 4, budget: 150,
  sports: ['wc26'],
  builder: async (env, game) => {
      // Only useful post-game (when we have pre/post snapshots)
      const triggeredBy = game.triggeredBy || game.gameId || game.id;
      if (!triggeredBy) return '';
      const impact = await findBracketImpact(env, triggeredBy);
      const entries = Object.entries(impact)
          .filter(([, d]) => d.change != null && Math.abs(d.change) >= 0.002)
          .sort(([, a], [, b]) => Math.abs(b.change) - Math.abs(a.change))
          .slice(0, 6);
      if (!entries.length) return '';

      const lines = entries.map(([team, d]) => {
          const arrow = d.change > 0 ? '↑' : '↓';
          const pct   = Math.round(Math.abs(d.change) * 100);
          const state = d.stateBefore !== d.stateAfter
              ? `${d.stateBefore} → ${d.stateAfter}`
              : d.stateAfter;
          return `${team}: ${state} ${arrow}${pct}%`;
      });
      return `[BRACKET IMPACT]\n${lines.join('\n')}`;
  }
},
```

**Verification:** grep `context-assembler.js` for `bracket_impact` — must appear.
grep for `findBracketImpact` — must appear exactly once as definition, once as call.

---

## TASK 3 — Per-game trap context injection into WC journalism prompts

### 3a. Find the WC game journalism prompt builder

Grep `src/index.js` for where WC per-game briefs are generated — likely near
`wc-brief`, `JOURNALISM_QUEUE`, or `buildWCGamePrompt`. Read that section.

### 3b. Inject TRAP CONTEXT block

Before the Claude API call that generates a WC game brief, fetch active
elimination traps and path traps for the teams in this game and inject:

```javascript
// Build trap context for journalism prompt
async function buildTrapContext(env, homeTeam, awayTeam) {
    const lines = [];
    try {
        const kvProj = env.FIELD_JOURNALISM
            ? await env.FIELD_JOURNALISM.get('wc:projections:current') : null;
        if (kvProj) {
            const proj = JSON.parse(kvProj);
            // Path traps involving either team
            const pathTraps = (proj.bracketTraps || [])
                .filter(t => t.team === homeTeam || t.team === awayTeam);
            for (const t of pathTraps) {
                lines.push(
                    `PATH TRAP — ${t.team}: finishing 2nd yields +${Math.round(t.delta*100)}% pChamp` +
                    ` (as 1st: ${Math.round(t.pChampIf1st*100)}%, as 2nd: ${Math.round(t.pChampIf2nd*100)}%)`
                );
            }
        }
    } catch (_) {}
    if (!lines.length) return '';
    return `\nTRAP CONTEXT:\n${lines.join('\n')}`;
}
```

Find the exact location in the WC brief generation flow where prompt context
is assembled (search for `matchupNote` or `buildWCTeamContext` near the Claude
call). Inject `buildTrapContext` output there.

If the prompt builder already has a dedicated context block section, add
TRAP CONTEXT as the last block before the journalism instruction.

**Verification:** After deploy, probe `/journalism/context-probe?sport=wc26` —
confirm `contextLength` has increased for WC games (trap context adds chars).

---

## TASK 4 — Smoke + commit + deploy

1. `node --check src/wc-tournament-projections.js src/context-assembler.js src/index.js`
   — all three must pass.

2. Commit:
   ```
   feat: bracket elimination traps + debrief bracket impact context
   
   Phase 2:
   - detectEliminationTraps(): idle team vulnerability from today's other games
     (ELIMINATION_TRAP / DANGER_TRAP — distinct from existing path traps)
   - GET /wc/elimination-traps: live trap scan using today's odds-probs fixtures
   
   Phase 3:
   - findBracketImpact(env, triggeredBy): reads bracket_snapshots pre/post delta
   - bracket_impact CONTEXT_SOURCE: injects state transitions into WC journalism
   - buildTrapContext(): PATH TRAP context injected into per-game WC briefs
   
   Path trap detection (detectBracketTraps / /wc/traps) unchanged — already live.
   ```

3. Push — deploy triggers automatically.

---

## TASK 5 — Verification probes

After deploy:
1. `GET /wc/elimination-traps` → `ok:true`, `traps` array, `todayGameCount` > 0
2. `GET /wc/traps` → still works (unchanged path trap endpoint)
3. `GET /journalism/context-probe?sport=wc26` → contextLength has bracket_impact slot
4. `node --check` all three files

---

## TASK 6 — Outbox manifest

Write `outbox/cc-bracket-traps-debrief-2026-06-24.md` with:
- What was already built (path traps) vs what this session adds
- detectEliminationTraps method summary (proxy-based approximation, not full MC)
- findBracketImpact: depends on bracket_snapshots from Phase 1
- Probe results from Task 5
- Commit hash + deploy status

Commit `[skip ci]` and push.

---

## DONE CONDITIONS

- [ ] grep `wc-tournament-projections.js` for `detectEliminationTraps` → 1 match
- [ ] `GET /wc/elimination-traps` → HTTP 200, `ok:true`
- [ ] `GET /wc/traps` → still HTTP 200 (unchanged)
- [ ] grep `context-assembler.js` for `bracket_impact` → ≥1 match
- [ ] grep `context-assembler.js` for `findBracketImpact` → ≥2 matches (def + call)
- [ ] `node --check` all three source files pass
- [ ] Deploy green
- [ ] Outbox manifest committed
