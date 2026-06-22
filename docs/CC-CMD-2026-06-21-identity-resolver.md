# Claude Code Command — Identity Resolver

git pull. Read CLAUDE.md.

Write all findings to outbox/cc-identity-resolver-2026-06-21.md.

## CONTEXT

152 games across 11 sports have NULL opening_odds in D1 because
team names don't match between The Odds API and ESPN/FIELD. The
archive odds sync (snapshotCronOdds, line ~3930) uses `_normTeam`
— a simple strip-non-alphanum normalizer. It builds a Map keyed
by `{_normTeam(home)}|{_normTeam(away)}` and tries to match D1
rows against it. No alias resolution, no fuzzy matching.

Meanwhile, `teamNameMatch` (line 963) has a full ALIASES table
and bidirectional substring matching — but it's only used for
live WP matching in AmbientDO, NOT the archive odds sync.

The result: "Brighton & Hove Albion" (ESPN) never matches
"Brighton and Hove Albion" (Odds API) because & → stripped
vs "and" → "and". "Athletics" (ESPN short name) never matches
"Oakland Athletics" (Odds API). Etc.

## CURRENT MISMATCH COUNTS (D1 probe, June 21)

```
EPL:               20/26 missing (77%)
WNBA:              34/49 missing (69%)
MLB:               47/129 missing (36%)
MLS:               8/10 missing (80%)
FIFA World Cup:    5/5 missing (100%)
La Liga:           10/10 missing (100%)
Ligue 1:           2/2 missing (100%)
AFL/CFL/IPL/golf:  all missing (no Odds API coverage — expected)
```

## PRE-BUILD PROBE (Rule 68)

```bash
# 1. Read the existing teamNameMatch function (line ~960)
sed -n '960,1050p' src/index.js

# 2. Read _normTeam used by odds archive sync
sed -n '3785,3800p' src/index.js

# 3. Read the archive odds matching loop
sed -n '3930,3970p' src/index.js

# 4. Read the backfill odds matching loop (similar pattern)
sed -n '4050,4080p' src/index.js

# 5. Sample mismatched names — helps build the alias table
# Run these D1 queries via the relay:
# SELECT DISTINCT home, away, sport FROM regular_season_games
#   WHERE opening_odds IS NULL AND sport IN ('MLB','WNBA','EPL','MLS')
#   LIMIT 30
```

Write probe results to outbox BEFORE writing any code.

## TASK 1: Centralize team identity resolution

Create `src/identity-resolver.js` with a single export:

```javascript
export function resolveTeamKey(name) {
    // 1. NFD normalize + strip diacritics + lowercase
    // 2. Check canonical alias table
    // 3. Return normalized key for Map lookup
}
```

The ALIASES table should be migrated from `teamNameMatch` (line
~975) and EXPANDED with all known mismatches. Build the full table
by comparing:
- D1 team names (from ESPN via archive)
- Odds API team names (from the odds fetch response)

Key aliases to include (probe D1 for exact names):

**EPL:**
- "Brighton & Hove Albion" ↔ "Brighton and Hove Albion"
- "AFC Bournemouth" ↔ "Bournemouth"
- "Sunderland AFC" ↔ "Sunderland"
- "Wolverhampton Wanderers" ↔ "Wolverhampton" / "Wolves"
- "Nottingham Forest" ↔ "Nott'm Forest"
- "Newcastle United" ↔ "Newcastle"
- "Manchester United" ↔ "Man United"
- "Manchester City" ↔ "Man City"

**MLS:**
- "Inter Miami CF" ↔ "Inter Miami"
- "LA Galaxy" ↔ "Los Angeles Galaxy"
- "New York Red Bulls" ↔ "NY Red Bulls"
- "New York City FC" ↔ "NYCFC" / "New York City"
- "Charlotte FC" ↔ "Charlotte"
- "Austin FC" ↔ "Austin"
- "St. Louis City SC" ↔ "St Louis City" / "St. Louis City"
- "Nashville SC" ↔ "Nashville"
- "FC Cincinnati" ↔ "Cincinnati"

**WNBA:**
- "Connecticut Sun" ↔ "Sun"
- "Las Vegas Aces" ↔ "Aces"
- "New York Liberty" ↔ "Liberty"
- "Minnesota Lynx" ↔ "Lynx"
- "Seattle Storm" ↔ "Storm"
- "Indiana Fever" ↔ "Fever"
- "Chicago Sky" ↔ "Sky"
- "Los Angeles Sparks" ↔ "Sparks"
- "Phoenix Mercury" ↔ "Mercury"
- "Atlanta Dream" ↔ "Dream"
- "Washington Mystics" ↔ "Mystics"
- "Dallas Wings" ↔ "Wings"
- "Golden State Valkyries" ↔ "Valkyries"

**WC / International:**
- Migrate all from existing ALIASES in teamNameMatch

**MLB:**
- "Athletics" ↔ "Oakland Athletics" / "Sacramento Athletics"

**La Liga / Serie A / Bundesliga / Ligue 1:**
- Probe D1 for exact names and cross-reference with Odds API names
- Common: "Atletico Madrid" ↔ "Atlético Madrid" (diacritics)

The resolver should be BIDIRECTIONAL: given EITHER the Odds API
name OR the ESPN name, it returns the same canonical key.

## TASK 2: Wire into archive odds sync

In `src/index.js`, replace `_normTeam` usage in the archive
odds matching (line ~3937) with `resolveTeamKey`:

```javascript
import { resolveTeamKey } from './identity-resolver.js';

// In snapshotCronOdds:
const byPair = new Map();
for (const g of games) {
    byPair.set(`${resolveTeamKey(g.home_team)}|${resolveTeamKey(g.away_team)}`, g);
}
// ... matching loop:
const og = byPair.get(`${resolveTeamKey(row.home)}|${resolveTeamKey(row.away)}`);
```

Do the same for the backfill matching loop (~line 4055).

## TASK 3: Wire into closing odds capture

In `src/ambient-do.js`, the `_captureClosingOdds` method
(just shipped) uses NFD norm + bidirectional substring for
event matching. Replace with `resolveTeamKey` for consistency.

## TASK 4: Wire into teamNameMatch

Replace the inline ALIASES in `teamNameMatch` (line ~975)
with `resolveTeamKey`. This unifies all team identity
resolution into one shared table.

## TASK 5: Mismatch probe endpoint

Add `GET /identity/mismatches` endpoint:

```javascript
// For each sport with Odds API coverage:
// 1. Fetch current odds from The Odds API
// 2. Query D1 for today's games with NULL opening_odds
// 3. Try resolveTeamKey matching
// 4. Return unmatched pairs for diagnosis

// Response shape:
{
    "date": "2026-06-21",
    "matched": 14,
    "unmatched": 3,
    "mismatches": [
        {
            "d1_home": "Brighton & Hove Albion",
            "d1_away": "Manchester United",
            "d1_key": "brightonhovealbion|manchesterunited",
            "closest_odds": "Brighton and Hove Albion vs Manchester Utd",
            "odds_key": "brightonandhovealbion|manchesterutd"
        }
    ]
}
```

This endpoint costs 1 Odds API credit per sport probed.
Cap at 5 sports per call. Useful for maintaining the alias
table over time.

## TASK 6: Backfill existing NULL odds

After the resolver is deployed, run a one-time backfill:

```javascript
// For each sport with games where opening_odds IS NULL:
// 1. Query the Odds API historical endpoint for that date
// 2. Match using resolveTeamKey
// 3. Write opening_odds via reconcile()
```

NOTE: The Odds API historical endpoint may cost more credits.
Check the /v4/historical/sports/{sport}/odds endpoint
documentation. If cost is prohibitive, skip this task and
let the resolver handle future games only.

Actually — SKIP this task entirely. Historical odds fetch
costs 10 credits per request (vs 1 for current). Not worth
it for 152 games. The resolver will catch all future games.

## SCOPE BOUNDARY (Rule 69 — TOUCH-ONLY-A)

DO:
- Create src/identity-resolver.js (new file)
- Modify src/index.js: replace _normTeam with resolveTeamKey
  in snapshotCronOdds and backfill matching
- Modify src/index.js: replace inline ALIASES in teamNameMatch
- Modify src/ambient-do.js: use resolveTeamKey in _captureClosingOdds
- Add /identity/mismatches probe endpoint in src/index.js
- node --check all modified files

DO NOT:
- Modify the journalism prompt builder
- Touch BracketDO or wc-tournament-projections.js
- Touch the Context Assembler
- Modify any D1 schema
- Fetch historical odds (too expensive)

## INSTRUCTIONS

1. Relay repo only (field-relay-nba).
2. Pre-build probes FIRST. Write probe results to outbox.
3. src/identity-resolver.js is the new file; keep it focused.
4. node --check all modified files before commit.
5. Single commit: "feat: identity resolver — centralized team name
   matching for odds sync (+77 games)"
6. Deploy via wrangler deploy.
7. After deploy, hit /identity/mismatches to verify improvement.
8. Write full manifest to outbox.
