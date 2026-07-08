# CC-CMD: Replace resolveWinProbability's AFL branch with the proven Kali+ESPN-round architecture

**Date:** 2026-07-08
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR

## CONTEXT

`resolveWinProbability`'s AFL branch (`src/wp-resolver.js`) queries Squiggle
directly with a team-name string in the `team=` parameter. Confirmed live
via Squiggle's own API docs: `team` is documented as a numeric **Team ID**
(`team=11`, `team=14`), never a name — so this branch has likely never
returned a real probability for any AFL pick, not specific to any one team.

**This is not a param patch. FIELD already built and proved a better
solution for the identical problem** — `buildAFLJournalismContext()`
(`src/index.js`, shipped 2026-06-26, live-verified via AVV tests since)
fetches Kali (`homeWinPct`, richer than raw Squiggle — already incorporates
`squiggleConsensus` plus h2h/form/stats/venue/scoring) and Squiggle
Aggregate tips **by `year`+`round` only, zero team parameter**, then
matches each result into a game via `teamNameMatch()` + a local
AFL-nickname-stripping `_norm()` helper. This CC-CMD ports that exact,
already-proven matching logic into `resolveWinProbability`'s AFL branch —
it does not reinvent it.

**`env.KALI_AFL_TOKEN` reaching `UserDO`:** not yet directly confirmed for
Kali specifically, but `resolveWinProbability`'s existing odds-api branch
already successfully reads `env.ODDS_API_KEY` through the identical
`this.env` handoff from `pick_resolved` — confirmed live (EPL/La
Liga/Bundesliga/Serie A/NFL all resolved real probabilities this session).
Same secret-propagation mechanism, so this should already work — **the
probe block below confirms it directly rather than trusting that
inference**, per Rule 89's durability radius (don't assume a secret is
reachable across a process/binding boundary without checking).

## PROBE BLOCK (Rule 87/89 — run before any edits)

```bash
git log --oneline -5
# Confirm current HEAD matches what this doc assumes.

grep -n "^async function buildAFLJournalismContext" src/index.js
sed -n '/^async function buildAFLJournalismContext/,/^}/p' src/index.js
# Re-read the exact, current, live implementation before porting it — do
# not port from this doc's paraphrase, which may already be stale.

grep -n "KALI_BASE\s*=" src/index.js src/wp-resolver.js
# Expected: defined in index.js, ABSENT from wp-resolver.js — confirms
# this CC-CMD needs to add it, matching the file's own "kept in sync with
# index.js by convention" pattern already used for SQUIGGLE_BASE/HEADERS.

grep -n "KALI_AFL_TOKEN" src/index.js src/user-do.js src/wp-resolver.js
# Expected: index.js only, confirming it's a plain Worker secret (same
# binding class as ODDS_API_KEY), not something requiring new wrangler
# config.

grep -n "if (s === 'afl')" src/wp-resolver.js
sed -n '/if (s === .afl.)/,/^        }/p' src/wp-resolver.js
# Confirm the exact current broken branch before replacing it.

grep -n "async function fetchESPNNativeWP" src/wp-resolver.js
sed -n '/async function fetchESPNNativeWP/,/^}/p' src/wp-resolver.js
# Re-read the existing scoreboard-lookup-by-team-name pattern this CC-CMD
# mirrors for AFL's round discovery — same file, already proven, reuse
# the shape rather than inventing a new one.

# Live check: is env.KALI_AFL_TOKEN actually reachable from inside UserDO
# at runtime, not just inferred from the ODDS_API_KEY precedent. If a
# relay self-probe route exists for testing UserDO env directly, use it;
# otherwise this must be confirmed via the live pick_made/pick_resolved
# round-trip in TASK 2's verification step, not assumed from this probe
# block alone.
```

If any probe contradicts this doc's assumptions — especially if
`buildAFLJournalismContext`'s actual current logic differs from what's
pasted above — STOP and report the actual state before proceeding.

## TASK 1 — Add Kali constant + AFL round-discovery helper to wp-resolver.js

Add near the top, alongside the existing `SQUIGGLE_BASE`/`SQUIGGLE_HEADERS`
constants (kept in sync with `index.js` by the same existing convention):

```javascript
// ── Kali AFL Stats (keep in sync with index.js) ────────────────────────────
const KALI_BASE = 'https://kaliaflstats.com/api/afl/v1';
```

Add a new function, near `fetchESPNNativeWP` (same file, same pattern —
scoreboard lookup by team name to discover a stable identifier before the
real data fetch, exactly what that function already does for MLB/NBA/WNBA):

```javascript
// _discoverAFLRound: AFL is ESPN-native for scores (adaptESPNBasketball
// reuses the WNBA adapter — quarters map naturally), but resolveWinProbability
// has no round/year context yet at this point, unlike buildAFLJournalismContext
// which receives it from the already-fetched games array. Mirrors
// fetchESPNNativeWP's own scoreboard-lookup-by-team-name shape (same file)
// rather than inventing a new lookup pattern.
async function _discoverAFLRound(predictedWinner) {
    const now = new Date();
    const toDateStr = d => d.toISOString().slice(0, 10).replace(/-/g, '');
    const yesterday = new Date(now.getTime() - 86400000);
    for (const dateStr of [toDateStr(now), toDateStr(yesterday)]) {
        try {
            const r = await fetch(
                `${ESPN_SCOREBOARD_BASE}/sports/australian-football/afl/scoreboard?dates=${dateStr}`,
                { headers: ESPN_SUMMARY_HEADERS, signal: AbortSignal.timeout(5000) }
            );
            if (!r.ok) continue;
            const d = await r.json();
            const round = d.week?.number ?? null;
            if (!round) continue;
            for (const ev of (d.events || [])) {
                const comp = ev.competitions?.[0] || {};
                const teams = comp.competitors || [];
                const home = teams.find(t => t.homeAway === 'home');
                const away = teams.find(t => t.homeAway === 'away');
                const homeN = home?.team?.displayName || home?.team?.shortDisplayName || '';
                const awayN = away?.team?.displayName || away?.team?.shortDisplayName || '';
                if (teamNameMatch(predictedWinner, homeN) || teamNameMatch(predictedWinner, awayN)) {
                    return { round, year: now.getUTCFullYear() };
                }
            }
        } catch (_) { /* try next date */ }
    }
    return null;
}
```

## TASK 2 — Replace the AFL branch's body

Find the current AFL branch (probe-confirmed location). Replace its
contents with logic **ported from `buildAFLJournalismContext`'s actual
current implementation** (re-read via the probe step — do not paraphrase
from memory), scoped to a single team instead of a whole games array:

```javascript
if (s === 'afl') {
    const discovered = await _discoverAFLRound(predictedWinner);
    if (!discovered) return null;
    const { round, year } = discovered;
    const kaliKey = env.KALI_AFL_TOKEN;
    const _norm = str => String(str || '').toLowerCase()
        .replace(/\b(lions|swans|eagles|hawks|magpies|bombers|cats|blues|tigers|bulldogs|kangaroos|power|crows|demons|dockers|suns|giants|saints|roos)\b/g, '')
        .replace(/[^a-z]/g, '').slice(0, 6);
    const isMatch = name => teamNameMatch(predictedWinner, name) ||
        (_norm(predictedWinner) && _norm(predictedWinner) === _norm(name));

    // Kali first — richer (already incorporates Squiggle consensus + h2h/
    // form/stats/venue/scoring), matching buildAFLJournalismContext's own
    // source priority.
    if (kaliKey) {
        try {
            const r = await fetch(`${KALI_BASE}/predictions?year=${year}&round=${round}`, {
                headers: { 'Authorization': `Bearer ${kaliKey}`, 'Accept': 'application/json' },
                signal: AbortSignal.timeout(5000),
            });
            if (r.ok) {
                const kd = await r.json();
                for (const pred of (kd.data || [])) {
                    const isHome = isMatch(pred.homeTeam);
                    const isAway = isMatch(pred.awayTeam);
                    if (!isHome && !isAway) continue;
                    const prob = isHome ? pred.homeProbability : pred.awayProbability;
                    if (typeof prob !== 'number') continue;
                    return { probability: Math.round(prob * 1000) / 1000, source: 'kali', label: 'Statistical probability' };
                }
            }
        } catch (_) { /* fall through to Squiggle */ }
    }

    // Squiggle Aggregate fallback — same source, same query shape (year+round,
    // no team param) buildAFLJournalismContext already proved correct.
    try {
        const r = await fetch(`${SQUIGGLE_BASE}/?q=tips;year=${year};round=${round}`, {
            headers: SQUIGGLE_HEADERS, signal: AbortSignal.timeout(5000),
        });
        if (r.ok) {
            const sd = await r.json();
            const aggTip = (sd.tips || []).find(t => t.source === 'Aggregate' &&
                (isMatch(t.hteam) || isMatch(t.ateam)));
            if (aggTip) {
                const isHome = isMatch(aggTip.hteam);
                const conf = parseFloat(aggTip.hconfidence);
                if (!isNaN(conf)) {
                    const prob = isHome ? conf / 100 : (100 - conf) / 100;
                    return { probability: Math.round(prob * 1000) / 1000, source: 'squiggle', label: 'Statistical probability' };
                }
            }
        }
    } catch (_) { /* both sources exhausted */ }

    return null;
}
```

## TASK 3 — Verification (Rule 87 — inside this session, not deferred)

1. **No CI coverage exists for this code path — confirmed by reading
   `.github/workflows/deploy.yml` directly, not assumed.** The 8 hard
   STRUCTURAL checks (health, NBA/NHL/FPL/FD whitelist, CORS, journalism
   e2e, BSD R2) and 6 informational PROBEs (NBA CDN, NHL, FPL, FD) never
   touch Squiggle, Kali, or AFL — the health check's own string-match list
   doesn't even include `kali`. Passing deploy.yml's gate proves nothing
   about this change; do not report it as verification. The root-level
   `test-*.js` files (plain `node`, no `npm test` script — `package.json`
   has no `scripts` key) are the only static coverage; run any that exist
   for this file, but they don't substitute for step 2 below.
2. **Live end-to-end**, not just code-presence: make a real
   `pick_made`/`pick_resolved` round-trip against a real, current AFL
   fixture with real odds/tips data (the Fremantle v Sydney game
   confirmed earlier this session, gameid 38646, or whatever is live/
   near-term at execution time — do not reuse stale data, re-probe).
   Confirm a real `source: 'kali'` or `source: 'squiggle'` probability
   is returned, not null. This is the actual done condition — a code
   diff alone does not prove the `env.KALI_AFL_TOKEN` inference held.
3. Confirm the `wp-resolution-failures` and `wp-sport-label-drift` codex
   entries are unaffected by this change (AFL is a real, supported sport
   in `SPORT_LABEL_MAP` — this fix doesn't touch that classification).

## DONE CONDITIONS

- [x] Probe block confirms current state, including re-reading
      `buildAFLJournalismContext`'s actual live logic (not paraphrased)
- [x] `KALI_BASE` added, matching the file's existing sync-with-index.js
      convention
- [x] `_discoverAFLRound` mirrors `fetchESPNNativeWP`'s existing shape,
      not a new pattern
- [x] AFL branch tries Kali first, Squiggle Aggregate as fallback — same
      priority `buildAFLJournalismContext` already uses
- [x] Zero team-name string passed into any external API's own query
      params — matching, not fetching, is the source of team narrowing
- [x] Live E2E test against a real current AFL fixture returns a real,
      non-null probability
- [x] Outbox manifest written

## CONFIDENCE SCORING

- +25 — `buildAFLJournalismContext`'s actual current logic re-read and
  correctly ported (not from this doc's paraphrase): **met if true**
- +20 — `_discoverAFLRound` correctly mirrors the existing
  `fetchESPNNativeWP` pattern already proven in this file: **met if true**
- +25 — live E2E test against a real fixture returns a real non-null
  probability, source `kali` or `squiggle`: **met if true**
- +15 — `env.KALI_AFL_TOKEN` reachability confirmed live, not left as an
  inference from the `ODDS_API_KEY` precedent: **met if true**
- +15 — `wp-resolution-failures`/`wp-sport-label-drift` codex entries
  confirmed unaffected: **met if true**

**Do not commit unless confidence >= 95. If score < 95, report verbatim
and stop.**

## ONE-LINER

```
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }
git pull. Read docs/CC-CMD-2026-07-08-afl-wp-kali-integration.md. Execute all tasks. Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
```
