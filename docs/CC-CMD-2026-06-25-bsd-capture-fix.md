# CC-CMD: BSD Endgame Capture + Score Fix
**Date:** 2026-06-25 · **Repo:** field-relay-nba · **Rule 87:** Self-completing.
**File:** `src/index.js`

---

## WHAT THIS DOES

Three patches in one commit:

**PATCH 1 — Score fix in `writeWCResult`**
`INSERT OR IGNORE` keeps the pre-kickoff 0-0 row unchanged at game-final.
Add a separate `UPDATE` to correct home_score/away_score at game-final.
Ecuador vs Germany (football:1489410) is stuck at 0-0 in D1; this fixes it
going forward and the probe block corrects the current row immediately.

**PATCH 2 — `captureWithRetry` replaces fire-and-forget R2 capture**
Current capture block in `writeWCResult` makes one attempt per endpoint and
swallows 404s. Replace with a retry loop: 7 attempts × 15s = 105s window.
Catches the brief post-final window where `incidents` and sometimes `stats`
remain accessible. Momentum + average-positions will still fail all 7 attempts
— that is expected and handled by Patch 3.

**PATCH 3 — `runBSDEndgameCapture` in existing `*/5` cron**
The relay already runs `scheduled()` every 5 minutes. During the WC window,
add a call to `runBSDEndgameCapture(env)` that polls `/bsd/events/live` and
captures all 4 BSD endpoints for any WC game at `current_minute >= 83`.
Fires at ~83' and ~88' — both while momentum and average-positions are live.
Overwrites R2 keys on each tick. Last write before game-final is preserved.
WC league_id = 27 (confirmed live 2026-06-25, Ecuador vs Germany + Curaçao).

---

## PROBE BLOCK

```bash
cd /home/claude/field-relay-nba && git pull

# 1. Confirm Ecuador score is wrong in D1 (fix in probe step below)
node --check src/index.js
# Expected: no errors

# 2. Confirm INSERT OR IGNORE anchor exists once
grep -c 'INSERT OR IGNORE INTO wc_results' src/index.js
# Expected: 1

# 3. Confirm captureWithRetry not yet present
grep -c 'captureWithRetry' src/index.js
# Expected: 0

# 4. Confirm runBSDEndgameCapture not yet present
grep -c 'runBSDEndgameCapture' src/index.js
# Expected: 0

# 5. Confirm scheduled() WC insertion anchor
grep -n 'runWCTournamentProjections' src/index.js
# Expected: 1 line at ~L6155

# 6. Fix Ecuador score immediately via CF D1 API
# (Use CF_API_TOKEN env var — do not embed credential)
python3 << 'PYEOF'
import urllib.request, json, os

CF_ACCOUNT = 'b57e9af57ab46c52ca9215804e689c29'
D1_DB      = 'f26669de-e772-4b56-a6d1-f8fdea08a4d4'
CF_TOKEN   = os.environ.get('CF_API_TOKEN', '')
if not CF_TOKEN:
    print("Set CF_API_TOKEN first"); raise SystemExit(1)

sql = "UPDATE wc_results SET home_score=2, away_score=1 WHERE game_id='football:1489410'"
req = urllib.request.Request(
    f'https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT}/d1/database/{D1_DB}/query',
    data=json.dumps({'sql': sql}).encode(), method='POST',
    headers={'Authorization': f'Bearer {CF_TOKEN}',
             'Content-Type': 'application/json'})
r = json.loads(urllib.request.urlopen(req).read())
print('Score fix:', r.get('success'), r.get('result'))
PYEOF
# Expected: success=True, Ecuador 0-0 → 2-1
```

---

## PATCH 1 — Score UPDATE in `writeWCResult` (after INSERT OR IGNORE)

**Anchor** (exact, appears once):
```
    `).bind(game.id, groupId, homeName, awayName,
            homeScore, awayScore, matchDate).run();

    // Write bsdEventId when present
```

**Replace with:**
```javascript
    `).bind(game.id, groupId, homeName, awayName,
            homeScore, awayScore, matchDate).run();

    // Correct score at game-final. INSERT OR IGNORE preserves the original
    // row unchanged if it was pre-inserted at kickoff with 0-0. This UPDATE
    // always runs at game-final to write the authoritative final score.
    await db.prepare(
        'UPDATE wc_results SET home_score = ?, away_score = ? WHERE game_id = ?'
    ).bind(homeScore, awayScore, game.id).run();

    // Write bsdEventId when present
```

---

## PATCH 2 — `captureWithRetry` + updated `writeWCResult` capture block

Add `captureWithRetry` as a standalone async function near `writeWCResult`
(before or after the function, not inside it).

**New function — add before `async function writeWCResult`:**
```javascript
// BSD R2 capture with retry. Attempts up to maxAttempts times with
// intervalMs delay. Returns true on first success, false if all fail.
// Used by writeWCResult (post-final) and runBSDEndgameCapture (pre-final).
async function captureWithRetry(url, r2Key, env, meta,
                                maxAttempts = 7, intervalMs = 15000) {
    const bsdHdrs = {
        'Authorization': `Token ${env.BSD_API_TOKEN}`,
        'User-Agent': 'FIELD/1.0',
        'Accept': 'application/json',
    };
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            const r = await fetch(url, {
                headers: bsdHdrs,
                signal: AbortSignal.timeout(6000),
            });
            if (r.ok) {
                await env.FIELD_DATA.put(r2Key, await r.arrayBuffer(), {
                    httpMetadata: { contentType: 'application/json' },
                    customMetadata: { ...meta, attempt: String(attempt + 1) },
                });
                return true;
            }
        } catch (_) {}
        if (attempt < maxAttempts - 1)
            await new Promise(res => setTimeout(res, intervalMs));
    }
    return false;
}
```

**Replace the existing capture block in `writeWCResult`**

**Old anchor** (exact):
```
        // Capture all four endpoints in parallel — fire-and-forget via waitUntil
            const captures = ['momentum', 'stats', 'incidents', 'average-positions'].map(async type => {
                try {
                    const bsdPath = type === 'stats'
                        ? `/api/v2/events/${bsdId}/stats/`
                        : type === 'average-positions'
                            ? `/api/v2/events/${bsdId}/average-positions/`
                            : `/api/v2/events/${bsdId}/${type}/`;
                    const r = await fetch(`${bsdBase}${bsdPath}`, {
                        headers: bsdHdrs,
                        signal: AbortSignal.timeout(8000),
                    });
                    if (r.ok) {
                        const body = await r.arrayBuffer();
                        const key  = `${r2Prefix}/${type}.json`;
                        await env.FIELD_DATA.put(key, body, {
                            httpMetadata: { contentType: 'application/json' },
                            customMetadata: {
                                game_id:   game.id,
                                home:      homeName,
                                away:      awayName,
                                captured:  new Date().toISOString(),
                            },
                        });
                    }
                } catch (_) {} // Non-blocking — R2 capture never breaks D1 write
            });
```

**Replace with:**
```javascript
        // Post-final capture with retry. Momentum + average-positions typically
        // 404 immediately at game-final; captureWithRetry handles that gracefully.
        // Primary coverage is via runBSDEndgameCapture (cron at 83'+88').
        // This is the defensive backstop for incidents + stats post-final window.
        const meta = {
            game_id: game.id,
            home:    homeName,
            away:    awayName,
            source:  'write-wc-result',
        };
        const bsdBase = 'https://sports.bzzoiro.com';
        const captures = ['momentum', 'stats', 'incidents', 'average-positions'].map(
            async type => captureWithRetry(
                `${bsdBase}/api/v2/events/${bsdId}/${type}/`,
                `${r2Prefix}/${type}.json`,
                env,
                { ...meta, type },
                7,    // 7 attempts
                15000 // 15s apart = 105s total window
            )
        );
```

---

## PATCH 3 — `runBSDEndgameCapture` function + scheduled() hook

**Add `runBSDEndgameCapture` as a standalone function** near the other
WC helper functions (near `backfillWCBsdEventIds` or `runWCTournamentProjections`):

```javascript
// BSD WC endgame capture — called from scheduled() every 5 min during WC window.
// Polls BSD live events for WC games (league_id 27) at current_minute >= 83.
// Captures all 4 endpoints to R2, overwriting on each tick.
// Primary mechanism for preserving momentum + average-positions before game-final.
// WC league_id = 27 confirmed 2026-06-25 (Ecuador vs Germany + Curaçao group).
async function runBSDEndgameCapture(env) {
    if (!env?.FIELD_DATA || !env?.BSD_API_TOKEN) return;
    const BSD_WC_LEAGUE_ID = 27;

    const liveResp = await fetch('https://sports.bzzoiro.com/api/v2/events/live/', {
        headers: {
            'Authorization': `Token ${env.BSD_API_TOKEN}`,
            'User-Agent': 'FIELD/1.0',
            'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(6000),
    });
    if (!liveResp.ok) return;

    const liveData = await liveResp.json();
    const targets  = (liveData.results || liveData.events || []).filter(e =>
        e.league_id === BSD_WC_LEAGUE_ID &&
        e.status    !== 'finished'        &&
        (e.current_minute || 0) >= 83
    );
    if (!targets.length) return;

    await Promise.allSettled(targets.map(async game => {
        const bsdId  = String(game.id);
        const prefix = `bsd/wc26/${bsdId}`;
        const meta   = {
            bsd_event_id: bsdId,
            minute:       String(game.current_minute),
            home:         game.home_team,
            away:         game.away_team,
            source:       'endgame-cron',
            captured:     new Date().toISOString(),
        };
        const bsdBase = 'https://sports.bzzoiro.com';
        await Promise.allSettled(
            ['momentum', 'stats', 'incidents', 'average-positions'].map(
                async type => captureWithRetry(
                    `${bsdBase}/api/v2/events/${bsdId}/${type}/`,
                    `${prefix}/${type}.json`,
                    env,
                    { ...meta, type },
                    1,   // single attempt — data is live, no retry needed
                    0
                )
            )
        );
        console.log(`[BSD-ENDGAME] captured bsdId=${bsdId} at ${game.current_minute}'`);
    }));
}
```

**Add to `scheduled()` after the existing WC projections block:**

**Anchor** (exact):
```
        if (_isWCWindow && env.FIELD_JOURNALISM) {
            ctx.waitUntil(runWCTournamentProjections(env).catch(e =>
                console.error('[WC-PROJ]', e.message)));
        }
    },
```

**Replace with:**
```javascript
        if (_isWCWindow && env.FIELD_JOURNALISM) {
            ctx.waitUntil(runWCTournamentProjections(env).catch(e =>
                console.error('[WC-PROJ]', e.message)));
        }
        // BSD WC endgame capture — every 5-min tick when WC window is open.
        // Captures momentum + average-positions at 83'+ while endpoints are live.
        if (_isWCWindow && env.FIELD_DATA && env.BSD_API_TOKEN) {
            ctx.waitUntil(runBSDEndgameCapture(env).catch(e =>
                console.error('[BSD-ENDGAME]', e.message)));
        }
    },
```

---

## DONE CONDITIONS

```bash
# 1. Syntax clean
node --check src/index.js
# Expected: no output (no errors)

# 2. All three patches present
grep -c 'captureWithRetry' src/index.js
# Expected: ≥ 4 (function def + 2 call sites)
grep -c 'runBSDEndgameCapture' src/index.js
# Expected: 2 (function def + scheduled hook)
grep -c 'UPDATE wc_results SET home_score' src/index.js
# Expected: 1

# 3. Score fix verified
curl -s https://field-relay-nba.jeffunglesbee.workers.dev/wc/results?group=C | \
  python3 -c "
import json,sys
r=json.load(sys.stdin).get('results',[])
for x in r:
    if 'Ecuador' in (x.get('home','') + x.get('away','')):
        print(f'{x[\"home\"]} {x[\"home_score\"]}-{x[\"away_score\"]} {x[\"away\"]}')
"
# Expected: Ecuador 2-1 Germany

# 4. Endgame cron logic — verify it would fire for a game at 85'
# (dry-run simulation — no live game needed)
node -e "
const targets = [{league_id:27, status:'inprogress', current_minute:85, id:9999, home_team:'A', away_team:'B'}];
const filtered = targets.filter(e => e.league_id===27 && e.status!=='finished' && (e.current_minute||0)>=83);
console.log('Would capture:', filtered.length, 'game(s)');
"
# Expected: Would capture: 1 game(s)

# 5. R2 list — verify existing captures preserved
curl -s https://field-relay-nba.jeffunglesbee.workers.dev/bsd/r2/list?prefix=bsd/wc26/ | \
  python3 -c "import json,sys; d=json.load(sys.stdin); [print(k['key'],k['size']) for k in d['keys']]"
# Expected: 8341 incidents + stats still present

# 6. Smoke
node smoke.js 2>&1 | tail -3
# Expected: N passed, 0 failed

# 7. Deploy verify after CI
curl -s https://field-relay-nba.jeffunglesbee.workers.dev/deploy/verify | \
  python3 -c "import json,sys; d=json.load(sys.stdin); print(f'match={d[\"match\"]}')"
# NOTE: also verify via workers_get_worker_code — check bundle contains
# 'runBSDEndgameCapture' and 'captureWithRetry'
```

---

## COMMIT

```bash
node --check src/index.js   # must pass before commit
git add src/index.js
git commit -m "feat(bsd): endgame cron capture + retry + score fix at game-final"
git push origin main
```
