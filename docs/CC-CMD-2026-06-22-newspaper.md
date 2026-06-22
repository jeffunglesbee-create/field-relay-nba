# Claude Code Command — O(1) Newspaper

git pull. Read CLAUDE.md.

Write all findings to outbox/cc-newspaper-2026-06-22.md.

## CONTEXT

FIELD's Analytics Cron runs daily at 9 UTC and writes editorial
features to D1 analytics_output + KV. Morning Report, Night Stars,
Truth Is, FIELD's Pick, Circadian Preview, Streak Board — all
generated, stored, never displayed. The journalism tab exists but
is hidden and requires manual navigation.

The O(1) Newspaper makes journalism the homepage. One relay call
assembles every feature into a single bundle. One client render
paints it above the schedule. Zero per-user LLM cost.

This prompt covers BOTH repos. Execute relay tasks first (the
endpoint must exist before the client can call it), then client.

## TASK 1: RELAY — GET /analytics/newspaper/{date} endpoint

File: src/index.js

Add a DEDICATED route BEFORE the generic `/analytics/{feature}/{date}`
handler (line ~7821). The generic handler serves single features;
the newspaper endpoint bundles ALL features for a date.

```javascript
// GET /analytics/newspaper/{date} — O(1) Newspaper bundle
// Assembles all analytics_output features + KV editorial into
// one atomic response. One fetch, one render.
if (pathname.startsWith('/analytics/newspaper/') && request.method === 'GET') {
    if (!env.ARCHIVE_DB) {
        return new Response(JSON.stringify({ ok: false, error: 'ARCHIVE_DB not bound' }),
            { status: 503, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
    const date = pathname.slice('/analytics/newspaper/'.length);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return new Response(JSON.stringify({ ok: false, error: 'invalid date' }),
            { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
    try {
        // 1. Batch-read all analytics_output rows for this date
        const rows = await env.ARCHIVE_DB.prepare(
            `SELECT feature, value, brief_text FROM analytics_output WHERE date = ?`
        ).bind(date).all();

        const features = {};
        for (const row of (rows.results || [])) {
            let parsed = null;
            try { parsed = JSON.parse(row.value); } catch (_) { parsed = row.value; }
            features[row.feature] = {
                value: parsed,
                brief_text: row.brief_text || null,
            };
        }

        // 2. Assemble bundle
        const bundle = {
            date,
            generated_at: features.morning_report?.value?.generated_at || null,
            morning_report: features.morning_report?.brief_text || null,
            truth_is: features.truth_is ? {
                ...(features.truth_is.value || {}),
                brief: features.truth_is.brief_text || null,
            } : null,
            night_stars: features.night_stars?.value || null,
            pick: features.field_pick ? {
                ...(features.field_pick.value || {}),
                brief: features.field_pick.brief_text || null,
            } : null,
            preview: features.circadian_preview?.brief_text || null,
            streak_board: features.streak_board?.value || null,
            quality_feedback: features.quality_feedback?.value || null,
            // completed_games: assembled from briefs table (yesterday's finals)
            completed_games: [],
        };

        // 3. Completed games — structural facts for "What Changed"
        //    Query briefs table for yesterday's game recaps with structural flags.
        //    These come from the regular_season_games + postseason_games tables.
        try {
            const games = await env.ARCHIVE_DB.prepare(`
                SELECT g.id, g.sport, g.home_team, g.away_team,
                       g.home_score, g.away_score, g.status,
                       g.closing_odds, g.opening_odds,
                       g.went_to_ot, g.is_elimination, g.is_series_clinch
                FROM regular_season_games g
                WHERE g.date = ? AND g.status = 'post'
                UNION ALL
                SELECT g.id, g.sport, g.home_team, g.away_team,
                       g.home_score, g.away_score, g.status,
                       g.closing_odds, g.opening_odds,
                       g.went_to_ot, g.is_elimination, g.is_series_clinch
                FROM postseason_games g
                WHERE g.date = ? AND g.status = 'post'
            `).bind(date, date).all();

            bundle.completed_games = (games.results || []).map(g => {
                // Detect upset: underdog won based on closing moneyline
                let wasUpset = false;
                try {
                    if (g.closing_odds) {
                        const odds = typeof g.closing_odds === 'string'
                            ? JSON.parse(g.closing_odds) : g.closing_odds;
                        const homeML = odds?.moneyline?.home;
                        const awayML = odds?.moneyline?.away;
                        if (homeML && awayML) {
                            const homeFav = Math.abs(homeML) < Math.abs(awayML)
                                || homeML < 0;
                            const homeWon = g.home_score > g.away_score;
                            wasUpset = (homeFav && !homeWon) || (!homeFav && homeWon);
                            // Only flag large upsets (underdog ML >= +150)
                            const underdogML = homeFav ? awayML : homeML;
                            if (underdogML < 150) wasUpset = false;
                        }
                    }
                } catch (_) {}

                const margin = Math.abs((g.home_score || 0) - (g.away_score || 0));

                return {
                    id: g.id,
                    sport: g.sport,
                    home: g.home_team,
                    away: g.away_team,
                    homeScore: g.home_score,
                    awayScore: g.away_score,
                    wentToOT: !!g.went_to_ot,
                    wasUpset,
                    isSeriesClinch: !!g.is_series_clinch,
                    isElimination: !!g.is_elimination,
                    margin,
                    finalTimestamp: Date.now(), // approximate; real ts not stored
                };
            });
        } catch (_) {
            // Tables may lack these columns — degrade gracefully
            bundle.completed_games = [];
        }

        return new Response(JSON.stringify({ ok: true, ...bundle }), {
            headers: {
                ...CORS,
                'Content-Type': 'application/json',
                'Cache-Control': 'public, max-age=300',
            },
        });
    } catch (e) {
        return new Response(JSON.stringify({
            ok: false, error: e.message,
            _note: 'analytics_output table may not exist yet',
        }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
}
```

CRITICAL: This route MUST appear BEFORE the generic `/analytics/`
handler (~line 7821). If it appears after, the generic handler
will match `/analytics/newspaper` as feature="newspaper" and
return a single-row lookup instead of the bundle.

After the endpoint is added, verify the probe allow-list at
~line 9217 includes '/analytics' (it already does).

## TASK 2: RELAY — node --check + deploy

1. node --check src/index.js
2. Single commit: "feat: O(1) Newspaper bundle endpoint —
   /analytics/newspaper/{date} assembles all editorial features"
3. Deploy via wrangler deploy.
4. After deploy, hit /analytics/newspaper/2026-06-20 and verify
   the bundle contains morning_report, night_stars, truth_is,
   field_pick, circadian_preview, streak_board fields.

## TASK 3: CLIENT — fetchNewspaper + renderNewspaper

File: index.html (jubilant-bassoon repo — git pull this repo too)

Add the newspaper fetch and render system. Insert the code in the
main initialization block, AFTER the streak badge init (~line 20880)
and BEFORE the bootstrap fetchSchedule call (~line 38173).

### 3a. fetchNewspaper(date)

```javascript
// ── O(1) NEWSPAPER — journalism-first homepage ──────────────────
// One relay call, one render. Analytics Cron output displayed above
// the schedule. Zero per-user LLM cost.
async function fetchNewspaper(date) {
    const base = (typeof V2_RELAY_BASE !== 'undefined')
        ? V2_RELAY_BASE : 'https://field-relay-nba.jeffunglesbee.workers.dev';
    try {
        const r = await fetch(`${base}/analytics/newspaper/${date}`, {
            signal: AbortSignal.timeout(5000),
        });
        if (!r.ok) return null;
        const data = await r.json();
        return data.ok ? data : null;
    } catch (_) {
        return null;
    }
}
```

### 3b. getWhatYouMissed(completedGames)

```javascript
function getWhatYouMissed(completedGames) {
    if (!completedGames || !completedGames.length) return [];
    const lastVisit = localStorage.getItem('field_last_visit');
    if (!lastVisit) return []; // first visit ever

    // field_last_visit stores YYYY-MM-DD string (from streak init)
    // If they visited today, no catch-up needed
    const tz = 'America/New_York';
    const today = new Date().toLocaleDateString('en-CA', { timeZone: tz });
    if (lastVisit === today) return [];

    // If last visit was >24h ago, Morning Report covers it
    const yesterday = new Date(Date.now() - 86400000)
        .toLocaleDateString('en-CA', { timeZone: tz });
    if (lastVisit < yesterday) return [];

    // Filter to structurally notable games
    const notable = completedGames.filter(g =>
        g.wentToOT ||
        g.margin <= 1 ||
        g.wasUpset ||
        g.isSeriesClinch ||
        g.isElimination
    );

    // Most recent first, cap at 5
    return notable.slice(0, 5);
}
```

### 3c. renderNewspaper(bundle)

This creates a DOM section and inserts it as the FIRST CHILD of
`<main id="main">`, pushing the schedule cards below.

```javascript
function renderNewspaper(bundle) {
    if (!bundle) return;

    // Remove any existing newspaper
    const existing = document.getElementById('field-newspaper');
    if (existing) existing.remove();

    const el = document.createElement('section');
    el.id = 'field-newspaper';
    el.className = 'field-newspaper';
    el.setAttribute('aria-label', 'FIELD Newspaper');

    const parts = [];

    // 1. "Since You Were Last Here" — personalized catch-up
    const missed = getWhatYouMissed(bundle.completed_games);
    if (missed.length) {
        const lines = missed.map(g => {
            const winner = (g.homeScore > g.awayScore) ? g.home : g.away;
            const loser = (g.homeScore > g.awayScore) ? g.away : g.home;
            const fact = g.wentToOT ? 'won in OT'
                : g.wasUpset ? `upset ${loser}`
                : g.isSeriesClinch ? 'clinched the series'
                : g.isElimination ? 'survived elimination'
                : `won by ${g.margin}`;
            return `<li>${winner} ${fact} (${g.homeScore}-${g.awayScore})</li>`;
        }).join('');
        parts.push(`
            <div class="np-section np-missed">
                <div class="np-label">SINCE YOU WERE LAST HERE</div>
                <ul class="np-missed-list">${lines}</ul>
            </div>
        `);
    }

    // 2. Night Stars
    if (bundle.night_stars && bundle.night_stars.stars) {
        const s = bundle.night_stars;
        const filled = '★'.repeat(s.stars);
        const empty = '☆'.repeat(5 - s.stars);
        const label = s.stars >= 4 ? 'a great night'
            : s.stars === 3 ? 'a solid night'
            : s.stars === 2 ? 'a quiet night'
            : 'a slow night';
        parts.push(`
            <div class="np-section np-stars">
                <span class="np-stars-glyphs">${filled}${empty}</span>
                <span class="np-stars-label">Last night was ${label}</span>
                ${s.degraded ? '<span class="np-degraded">(limited data)</span>' : ''}
            </div>
        `);
    }

    // 3. Morning Report
    if (bundle.morning_report) {
        parts.push(`
            <div class="np-section np-report">
                <div class="np-label">THE MORNING REPORT</div>
                <p class="np-prose">${bundle.morning_report}</p>
            </div>
        `);
    }

    // 4. Truth Is
    if (bundle.truth_is && bundle.truth_is.brief) {
        parts.push(`
            <div class="np-section np-truth">
                <div class="np-label">THE TRUTH IS</div>
                <p class="np-prose">${bundle.truth_is.brief}</p>
            </div>
        `);
    }

    // 5. Tonight's Pick
    if (bundle.pick) {
        const pickText = bundle.pick.type === 'pass'
            ? (bundle.pick.brief || "Not every night has a must-watch. Tonight's one of those.")
            : (bundle.pick.brief || '');
        if (pickText) {
            parts.push(`
                <div class="np-section np-pick">
                    <div class="np-label">TONIGHT'S PICK</div>
                    <p class="np-prose">${pickText}</p>
                </div>
            `);
        }
    }

    // 6. Preview
    if (bundle.preview) {
        parts.push(`
            <div class="np-section np-preview">
                <div class="np-label">TONIGHT</div>
                <p class="np-prose">${bundle.preview}</p>
            </div>
        `);
    }

    // 7. Streak Board
    if (bundle.streak_board && !bundle.streak_board.degraded) {
        const hot = (bundle.streak_board.hot || [])
            .map(s => `<span class="np-streak-chip np-hot">🔥 ${s.team} × ${s.streak}</span>`)
            .join('');
        const cold = (bundle.streak_board.cold || [])
            .map(s => `<span class="np-streak-chip np-cold">🧊 ${s.team} × ${s.streak}</span>`)
            .join('');
        if (hot || cold) {
            parts.push(`
                <div class="np-section np-streaks">
                    <div class="np-label">STREAK BOARD</div>
                    <div class="np-streak-row">${hot}${cold}</div>
                </div>
            `);
        }
    }

    // Nothing to show — don't render empty newspaper
    if (!parts.length) return;

    // Freshness timestamp
    const genAt = bundle.generated_at;
    let freshness = '';
    if (genAt) {
        try {
            const d = new Date(genAt);
            freshness = d.toLocaleTimeString('en-US', {
                hour: 'numeric', minute: '2-digit',
                timeZone: 'America/New_York',
            });
        } catch (_) {}
    }

    el.innerHTML = `
        <div class="np-inner">
            ${parts.join('')}
            ${freshness ? `<div class="np-freshness">Updated at ${freshness} ET</div>` : ''}
        </div>
        <div class="np-divider">TODAY'S SCHEDULE</div>
    `;

    // Insert ABOVE schedule content in <main>
    const main = document.getElementById('main');
    if (main) main.prepend(el);
}
```

### 3d. CSS

Add in the `<style>` block (near other section styles, ~line 440):

```css
.field-newspaper{margin-bottom:1.2rem}
.np-inner{background:var(--c-card,#1a1a2e);border-radius:12px;padding:1.2rem 1rem;border:1px solid rgba(255,255,255,.06)}
.np-section{margin-bottom:.8rem}
.np-section:last-child{margin-bottom:0}
.np-label{font-size:.65rem;letter-spacing:.12em;text-transform:uppercase;color:var(--c-muted,#888);margin-bottom:.35rem;font-weight:600}
.np-prose{font-size:.82rem;line-height:1.65;color:var(--c-text,#e0e0e0);margin:0}
.np-stars{display:flex;align-items:center;gap:.5rem;padding:.4rem 0}
.np-stars-glyphs{font-size:1.1rem;letter-spacing:2px;color:#fbbf24}
.np-stars-label{font-size:.78rem;color:var(--c-muted,#888)}
.np-degraded{font-size:.65rem;color:var(--c-muted,#666);font-style:italic}
.np-missed-list{list-style:none;padding:0;margin:.2rem 0 0}
.np-missed-list li{font-size:.78rem;line-height:1.5;color:var(--c-text,#e0e0e0);padding:.15rem 0}
.np-missed-list li::before{content:'• ';color:var(--c-muted,#888)}
.np-streak-row{display:flex;flex-wrap:wrap;gap:.4rem}
.np-streak-chip{font-size:.7rem;padding:.2rem .5rem;border-radius:6px;background:rgba(255,255,255,.05);white-space:nowrap}
.np-freshness{font-size:.6rem;color:var(--c-muted,#666);text-align:right;margin-top:.6rem}
.np-divider{text-align:center;font-size:.6rem;letter-spacing:.15em;color:var(--c-muted,#666);padding:.8rem 0 .2rem;position:relative}
.np-divider::before,.np-divider::after{content:'';position:absolute;top:50%;width:calc(50% - 5rem);height:1px;background:rgba(255,255,255,.08)}
.np-divider::before{left:0}
.np-divider::after{right:0}
.np-pick .np-prose{font-style:italic}
@media(max-width:600px){
  .np-inner{padding:.9rem .75rem}
  .np-prose{font-size:.78rem}
}
```

### 3e. Wire into boot sequence

Find the bootstrap section (~line 38173, comment says
"fetchSchedule() populates allData"). Add the newspaper
fetch BEFORE fetchSchedule so it renders first:

```javascript
// O(1) Newspaper — fetch and render above schedule
(async function bootNewspaper() {
    const tz = 'America/New_York';
    // Yesterday's date for analytics (cron processes yesterday)
    const yesterday = new Date(Date.now() - 86400000)
        .toLocaleDateString('en-CA', { timeZone: tz });
    const bundle = await fetchNewspaper(yesterday);
    if (bundle) renderNewspaper(bundle);
})();
```

NOTE: The newspaper renders independently of the schedule.
fetchSchedule() continues to run in parallel. The newspaper
appears immediately; schedule cards appear below when ready.
If newspaper fetch fails, schedule renders as today (zero
degradation).

### 3f. FIELD's Pick badge on game card

When FIELD's Pick selects a game (pick.type !== 'pass'), mark
that game card with a badge. In the card rendering section of
buildTodaySchedule, after the card DOM is built:

```javascript
// After all cards are rendered, apply FIELD's Pick badge
// (runs after renderAll completes)
if (window._newspaperBundle?.pick?.game_id) {
    const pickId = window._newspaperBundle.pick.game_id;
    const pickCard = document.querySelector(
        `[data-game-id="${pickId}"], [data-espn-id="${pickId}"]`
    );
    if (pickCard) {
        const badge = document.createElement('div');
        badge.className = 'field-pick-badge';
        badge.textContent = '⭐ FIELD\'s Pick';
        pickCard.prepend(badge);
    }
}
```

CSS for pick badge:
```css
.field-pick-badge{font-size:.6rem;letter-spacing:.08em;color:#fbbf24;padding:.15rem .4rem;opacity:.8}
```

Store the bundle globally so the pick badge can reference it:
In renderNewspaper, add `window._newspaperBundle = bundle;`
before the DOM insertion.

## TASK 4: SMOKE ASSERTIONS

Add these assertions in the smoke test section:

```javascript
// A692: Newspaper — fetchNewspaper function exists
smoke.assert(typeof fetchNewspaper === 'function',
    'A692: fetchNewspaper function exists');

// A693: Newspaper — renderNewspaper function exists
smoke.assert(typeof renderNewspaper === 'function',
    'A693: renderNewspaper function exists');

// A694: Newspaper — getWhatYouMissed function exists
smoke.assert(typeof getWhatYouMissed === 'function',
    'A694: getWhatYouMissed function exists');

// A695: Newspaper — getWhatYouMissed returns empty for null input
smoke.assert(getWhatYouMissed(null).length === 0,
    'A695: getWhatYouMissed gracefully handles null');

// A696: Newspaper — CSS class exists in stylesheet
smoke.assert(
    [...document.styleSheets].some(s => {
        try { return [...s.cssRules].some(r =>
            r.selectorText && r.selectorText.includes('.field-newspaper')
        ); } catch(_) { return false; }
    }),
    'A696: .field-newspaper CSS class present');
```

## SCOPE BOUNDARY

DO:
- Create /analytics/newspaper/{date} endpoint in relay
- Create fetchNewspaper, renderNewspaper, getWhatYouMissed in client
- Add CSS for newspaper sections
- Wire into boot sequence
- Add FIELD's Pick badge on game cards
- Add 5 smoke assertions
- Store bundle as window._newspaperBundle

DO NOT:
- Modify existing journalism tab or journalism-mode
- Modify buildTodaySchedule internals
- Add Circadian mode switching (separate spec)
- Modify Analytics Cron phases
- Change any existing relay endpoints
- Add new D1 tables or columns

## INSTRUCTIONS

1. Relay repo first (field-relay-nba).
2. git pull. Read CLAUDE.md.
3. Add /analytics/newspaper/{date} route BEFORE generic handler.
4. node --check src/index.js.
5. Single commit: "feat: O(1) Newspaper bundle endpoint"
6. wrangler deploy.
7. Verify: curl /analytics/newspaper/2026-06-20

8. Client repo (jubilant-bassoon).
9. git pull. Read CLAUDE.md.
10. Add CSS in <style> block.
11. Add fetchNewspaper, getWhatYouMissed, renderNewspaper functions.
12. Wire bootNewspaper into bootstrap.
13. Add pick badge logic.
14. Add smoke assertions.
15. node --check is not applicable (single HTML file).
16. Bump SW_VERSION to 2026-06-22a.
17. Single commit: "feat: O(1) Newspaper — journalism-first homepage
    with What Changed, Night Stars, Morning Report, Pick badge"
18. Push to main (deploy-gate.yml handles deploy).
19. Write manifest to outbox.
