# Claude Code Command — Final Three Adapters

git pull. Read CLAUDE.md.

Write all findings to outbox/cc-final-three-adapters-2026-06-21.md.

This command ships THREE small adapters. Each is independent.
Build and verify sequentially. Single commit at the end.

---

## ADAPTER 12: Brief Write Integrity

### Context
The journalism cron writes briefs to KV (FIELD_JOURNALISM) as the
primary store and archives to D1 (briefs table) as secondary. The
D1 write is fire-and-forget in a try/catch. If it fails silently,
KV and D1 diverge — KV has the brief, D1 doesn't. The freshness
guard reads from D1, so a missing D1 row means the brief is
invisible to staleness checks.

### Pre-Build Probe
```bash
# Count KV briefs vs D1 briefs for recent dates
# KV keys follow pattern journalism:YYYY-MM-DD
# D1 briefs table has date + brief_type columns

# Check D1 brief counts by date (last 7 days)
# via relay /d1/execute:
# SELECT date, COUNT(*) as n FROM briefs
#   WHERE date >= date('now', '-7 days')
#   GROUP BY date ORDER BY date DESC

# Check if any KV keys exist without D1 counterparts
# (requires reading KV list — may not be possible via probe)
```

### Task
Add `GET /integrity/briefs?date=YYYY-MM-DD` endpoint:

```javascript
// 1. Read the KV brief for the date
const kvRaw = await env.FIELD_JOURNALISM.get(`journalism:${date}`);
const kvBrief = kvRaw ? JSON.parse(kvRaw) : null;

// 2. Query D1 for briefs on that date
const d1Briefs = await env.ARCHIVE_DB.prepare(
    'SELECT brief_type, date, length(brief_text) as len FROM briefs WHERE date = ?'
).bind(date).all();

// 3. Compare and report
// Response shape:
{
    "date": "2026-06-21",
    "kv": {
        "exists": true,
        "briefLen": 1277,
        "contextHash": "abc123",
        "generatedAt": "2026-06-21T23:49:47Z"
    },
    "d1": {
        "slate_count": 2,
        "game_brief_count": 3,
        "total": 5
    },
    "divergence": false  // true if KV has data but D1 slate count is 0
}
```

If divergence is detected, add an AUTO-REPAIR path:
```javascript
if (kvBrief && d1SlateCount === 0 && url.searchParams.get('repair') === 'true') {
    // Re-insert the KV brief into D1
    await env.ARCHIVE_DB.prepare(
        `INSERT OR REPLACE INTO briefs (id, date, brief_type, brief_text, quality_score, word_count, source)
         VALUES (?, ?, 'slate', ?, ?, ?, 'kv_repair')`
    ).bind(
        `slate_${date}`, date, kvBrief.prose,
        kvBrief.proseScore || null,
        kvBrief.prose?.split(/\s+/).length || 0
    ).run();
}
```

**Location**: Add in src/index.js near the /freshness handler.

---

## ADAPTER 13: Game Archive Completeness

### Context
The game archive (regular_season_games + postseason_games) is
populated when AmbientDO detects a game going final. If AmbientDO
misses a final (restart, network blip, game not polled), the game
never enters D1. Missing games mean missing odds data, missing
briefs, missing history.

### Task
Add `GET /integrity/games?date=YYYY-MM-DD` endpoint:

```javascript
// 1. Fetch ESPN scoreboard for the date (all sports)
// 2. Count completed games per sport
// 3. Query D1 for archived games on that date
// 4. Compare and report missing games

// Response shape:
{
    "date": "2026-06-21",
    "espn": {
        "MLB": { "total": 15, "completed": 14 },
        "WNBA": { "total": 3, "completed": 2 },
        "FIFA World Cup": { "total": 5, "completed": 3 }
    },
    "d1": {
        "MLB": 12,
        "WNBA": 2,
        "FIFA World Cup": 3
    },
    "gaps": {
        "MLB": 2  // 14 completed on ESPN, only 12 in D1
    }
}
```

Use the same LEAGUES config from handleJournalismCycle to iterate
sports. Only compare completed games (status.type.completed===true)
against D1 rows.

**Location**: Add in src/index.js near the /integrity/briefs handler.

---

## ADAPTER 14: Post-Deploy Verification

### Context
After deploy-gate.yml deploys the relay Worker, there's no
automated check that the deployed code matches the committed SHA.
A failed deploy could leave stale code running while CI reports
success (the deploy step succeeded but Cloudflare propagation
failed, or the Worker bundle exceeded size limits silently).

### Task
Add `GET /deploy/verify` endpoint:

```javascript
// 1. Read the current HEAD SHA from GitHub API
const ghRes = await fetch(
    'https://api.github.com/repos/jeffunglesbee-create/field-relay-nba/commits/main',
    { headers: { 'User-Agent': 'FIELD-relay' }, cf: { cacheTtl: 60 } }
);
const ghData = await ghRes.json();
const expectedSHA = ghData.sha?.slice(0, 7);

// 2. Read the deployed SHA from a build-time constant
// The relay should embed its commit SHA at build time.
// Check if DEPLOY_SHA or BUILD_SHA exists in the Worker env.
// If not, use a fallback: the last deploy timestamp from
// the GitHub Actions API.

// 3. Compare and report
{
    "expected": "d6946f9",  // GitHub HEAD
    "deployed": "d6946f9",  // Worker build SHA (if available)
    "match": true,
    "deployedAt": "2026-06-21T23:48:08Z",  // from Worker modified_on
    "checkedAt": "2026-06-22T00:50:00Z"
}
```

**Build-time SHA injection**: If the relay doesn't already embed
a build SHA, add it to the esbuild step in deploy-gate.yml:

```yaml
- name: Build
  run: |
    echo "const DEPLOY_SHA = '${GITHUB_SHA}';" > src/_build-meta.js
    npx esbuild src/index.js --bundle --outdir=dist --format=esm
```

Then import in src/index.js:
```javascript
import { DEPLOY_SHA } from './_build-meta.js';
```

If modifying deploy-gate.yml is out of scope for this command
(it's in the jubilant-bassoon repo, not field-relay-nba), use
the GitHub API fallback: compare the latest successful deploy
run's head_sha against the current HEAD.

**Location**: Add in src/index.js near the other /integrity endpoints.

---

## SCOPE BOUNDARY

DO:
- Add three GET endpoints: /integrity/briefs, /integrity/games, /deploy/verify
- All in src/index.js
- No new files needed (unless build-time SHA injection is used)
- node --check before commit

DO NOT:
- Modify journalism prompt code
- Modify BracketDO or ambient-do.js
- Modify any existing adapter
- Touch the budget system

## INSTRUCTIONS

1. Relay repo only (field-relay-nba).
2. Pre-build probes for each adapter.
3. All three endpoints in src/index.js.
4. node --check before commit.
5. Single commit: "feat: final three adapters — brief integrity,
   game archive completeness, post-deploy verification"
6. Deploy via wrangler deploy.
7. After deploy, hit all three endpoints to verify.
8. Write manifest to outbox with verification results.
