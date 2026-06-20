// ── Analytics Cron Engine (June 20 2026) ────────────────────────────────────
// Daily 5 AM ET cron (0 9 * * *) that processes yesterday's sports data into
// pre-computed journalism features written to ARCHIVE_DB.analytics_output +
// FIELD_JOURNALISM KV (status only). Phase 1 scope: foundation (self-healing,
// data collection, Night Stars, health monitoring). No AI calls.
//
// ADR-002 / Rule 47 (RELAY-IS-DUMB): Night Stars is pure arithmetic over
// existing facts (drama_peak, score margin, OT/extras, walkoff text match).
// No interest level, no editorial verdict — just a counted-and-bucketed
// summary the browser may render however it likes.

const PHASE_NAMES = ['phase0', 'phase1', 'phase2', 'phase3', 'phase5', 'phase9', 'phase11'];
const STATUS_KV_KEY = 'field:analytics:status';
const SELF_HEAL_CAP = 7;

// Mirrors the constant in src/index.js. Kept local to avoid an import cycle
// (analyticsEngine is imported by index.js). Update both if the URL changes.
const JOURNALISM_CLAUDE_PROXY = 'https://field-claude-proxy.jeffunglesbee.workers.dev';

// Pick + Morning Report TTL — 48h per spec so the next day's run can
// still read yesterday's report when comparing day-over-day.
const KV_REPORT_TTL_SECS = 60 * 60 * 48;

// Curated sport set for Phase 9 schedule sweep. Each name maps to a
// /v2/games?sport=<name> handler that already exists in the relay.
// Kept narrow to limit api-sports/ESPN spend per nightly run.
const PHASE9_SPORTS = ['nba', 'nhl', 'mlb', 'wnba', 'wc26'];

// Idempotent schema creation. Called at the top of every run so a fresh
// ARCHIVE_DB is bootstrapped without a separate migration.
export async function ensureAnalyticsTables(env) {
    if (!env.ARCHIVE_DB) throw new Error('ARCHIVE_DB not bound');
    await env.ARCHIVE_DB.batch([
        env.ARCHIVE_DB.prepare(`
            CREATE TABLE IF NOT EXISTS analytics_runs (
                date TEXT PRIMARY KEY,
                phases_completed TEXT,
                features_computed INTEGER DEFAULT 0,
                errors TEXT,
                duration_ms INTEGER,
                created_at TEXT DEFAULT (datetime('now'))
            )
        `),
        env.ARCHIVE_DB.prepare(`
            CREATE TABLE IF NOT EXISTS analytics_output (
                id TEXT PRIMARY KEY,
                date TEXT NOT NULL,
                feature TEXT NOT NULL,
                sport TEXT,
                value TEXT,
                brief_text TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            )
        `),
        env.ARCHIVE_DB.prepare(`CREATE INDEX IF NOT EXISTS idx_analytics_output_feature_date ON analytics_output(feature, date)`),
        env.ARCHIVE_DB.prepare(`CREATE INDEX IF NOT EXISTS idx_analytics_output_date ON analytics_output(date DESC)`),
    ]);
}

function isoDate(d) {
    return d.toISOString().slice(0, 10);
}
function yesterdayISO(now = new Date()) {
    const t = new Date(now.getTime() - 24 * 3600 * 1000);
    return isoDate(t);
}
function addDays(iso, n) {
    const t = new Date(`${iso}T00:00:00Z`);
    t.setUTCDate(t.getUTCDate() + n);
    return isoDate(t);
}
function sevenDaysAgo(iso) {
    return addDays(iso, -7);
}

// Phase 0: figure out which dates need processing. Returns oldest-first.
async function planDates(env, targetDate) {
    const last = await env.ARCHIVE_DB.prepare(
        `SELECT date FROM analytics_runs ORDER BY date DESC LIMIT 1`
    ).first();
    if (!last) return [targetDate];
    const lastDate = last.date;
    if (lastDate >= targetDate) return [];
    const dates = [];
    let cursor = addDays(lastDate, 1);
    while (cursor <= targetDate && dates.length < SELF_HEAL_CAP) {
        dates.push(cursor);
        cursor = addDays(cursor, 1);
    }
    return dates;
}

// Self-fetch Context Graph. Follows the existing handleJournalismCycle
// pattern at src/index.js:5227 — env.RELAY_BASE override + edge cache hint.
async function fetchContextGraph(env, date) {
    const relayBase = env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
    const r = await fetch(`${relayBase}/context/date/${date}`, {
        cf: { cacheTtl: 60, cacheEverything: true },
    });
    if (!r.ok) throw new Error(`context/date HTTP ${r.status}`);
    return r.json();
}

// Walkoff heuristic — matches recap text. Word-boundary anchored to avoid
// matching "walkover" (tennis) when we mean baseball/softball walk-off.
const WALKOFF_RE = /\bwalk[-\s]?off\b/i;

// Phase 2: Night Stars. Rates the slate 1-5 stars from drama_peak + margin +
// extras + walkoff. If drama_peak is missing for >50% of games, falls back to
// close-game count alone (degraded mode flagged in output).
function computeNightStars(games) {
    const totalGames = games.length;
    if (totalGames === 0) {
        return { stars: 1, starScore: 0, dramaGames: 0, closeGames: 0, extras: 0, walkoffs: 0, totalGames: 0, degraded: false };
    }

    const dramaMissing = games.filter(g => g.drama_peak == null).length;
    const degraded = dramaMissing > totalGames * 0.5;

    let dramaGames = 0, closeGames = 0, extras = 0, walkoffs = 0;
    for (const g of games) {
        if (typeof g.drama_peak === 'number' && g.drama_peak >= 70) dramaGames++;
        // Sport-agnostic 1-point/run/goal margin. Skip if either score is null
        // (game not yet final or score not recorded).
        if (typeof g.home_score === 'number' && typeof g.away_score === 'number') {
            const margin = Math.abs(g.home_score - g.away_score);
            if (margin <= 1) closeGames++;
        }
        const note = (g.note || '') + ' ' + (g.drama_arc || '');
        if (/\b(OT|2OT|3OT|F\/OT|extra innings|extras)\b/i.test(note)) extras++;
        if (WALKOFF_RE.test(note)) walkoffs++;
    }

    let starScore;
    if (degraded) {
        // Score-differential fallback: close games carry the rating alone.
        starScore = closeGames * 1.0;
    } else {
        starScore =
            dramaGames * 1.0 +
            closeGames * 0.5 +
            extras     * 0.75 +
            walkoffs   * 1.0;
    }

    const stars =
        starScore >= 8 ? 5 :
        starScore >= 5 ? 4 :
        starScore >= 3 ? 3 :
        starScore >= 1 ? 2 : 1;

    return { stars, starScore, dramaGames, closeGames, extras, walkoffs, totalGames, degraded };
}

async function writeAnalyticsOutput(env, { date, feature, sport, value, briefText }) {
    const id = `${feature}_${date}`;
    await env.ARCHIVE_DB.prepare(`
        INSERT OR REPLACE INTO analytics_output (id, date, feature, sport, value, brief_text, created_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `).bind(id, date, feature, sport || null, JSON.stringify(value), briefText || null).run();
}

async function writeRunStatus(env, status) {
    // KV first (fast read for /analytics/status + /health). D1 next for history.
    try {
        if (env.FIELD_JOURNALISM) {
            await env.FIELD_JOURNALISM.put(STATUS_KV_KEY, JSON.stringify(status));
        }
    } catch (e) {
        console.error('[ANALYTICS] KV status write failed:', e.message);
    }
    try {
        await env.ARCHIVE_DB.prepare(`
            INSERT OR REPLACE INTO analytics_runs
            (date, phases_completed, features_computed, errors, duration_ms, created_at)
            VALUES (?, ?, ?, ?, ?, datetime('now'))
        `).bind(
            status.date_processed,
            JSON.stringify(status.phases_completed || []),
            status.features_computed | 0,
            JSON.stringify(status.errors || []),
            status.duration_ms | 0,
        ).run();
    } catch (e) {
        console.error('[ANALYTICS] D1 run write failed:', e.message);
    }
}

// ── field-claude-proxy helper ──────────────────────────────────────────────
// Copies the exact pattern used by handleJournalismCycle / backfill
// (src/index.js: callProxy). POST with X-FIELD-Relay header, Anthropic-
// shaped request body. Proxy routes to Gemini 3.1 Flash-Lite (primary) or
// Claude Haiku 4.5 (fallback). Returns the joined text or null on failure.
async function callProxy(promptText, { maxTokens = 250 } = {}) {
    const resp = await fetch(JOURNALISM_CLAUDE_PROXY, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-FIELD-Relay': 'field-relay-cron-2026',
        },
        body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: maxTokens,
            messages: [{ role: 'user', content: promptText }],
        }),
    });
    if (!resp.ok) return null;
    const data = await resp.json().catch(() => null);
    if (!data) return null;
    return (data.content || [])
        .filter(c => c.type === 'text')
        .map(c => c.text)
        .join('')
        .trim() || null;
}

// ── Phase 3: The Truth Is ──────────────────────────────────────────────────
// Rule-based anomaly detection over yesterday's games + odds + recap text.
// Picks the single highest-rarity finding; AI delivers the v4-voiced one-
// liner. Falls back to a quiet-night line (no AI call) when nothing surfaces.

const WALKOFF_TEXT_RE = /\bwalk[-\s]?off\b/i;
const SHUTOUT_TEXT_RE = /\bshut[-\s]?out\b/i;
const HAT_TRICK_RE    = /\bhat[-\s]?trick\b/i;
const NO_HITTER_RE    = /\bno[-\s]?hit(?:ter)?\b/i;
const PERFECT_GAME_RE = /\bperfect game\b/i;

function parseOddsJSON(raw) {
    if (!raw) return null;
    try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (_) { return null; }
}

// Extract the moneyline price for the winning side, if present, so we can
// flag upsets. Returns the underdog price (positive American odds style)
// or null when odds are missing/unparseable.
function winnerMoneylinePrice(game) {
    const odds = parseOddsJSON(game.closing_odds) || parseOddsJSON(game.opening_odds);
    if (!odds) return null;
    const hWon = (game.home_score | 0) > (game.away_score | 0);
    const ml = odds.moneyline || odds.h2h || odds.ml;
    if (!ml) return null;
    const winnerPrice = hWon ? (ml.home ?? ml.h ?? ml[0]) : (ml.away ?? ml.a ?? ml[1]);
    if (winnerPrice == null) return null;
    return Number(winnerPrice);
}

// Sport-specific blowout thresholds — picked conservatively so only truly
// lopsided games surface. NBA/WNBA: 25+, MLB: 8+, NHL: 5+, soccer: 4+.
function blowoutThreshold(sport) {
    const s = (sport || '').toLowerCase();
    if (s.includes('nba') || s.includes('wnba') || s.includes('basketball')) return 25;
    if (s.includes('mlb') || s.includes('baseball'))                          return 8;
    if (s.includes('nhl') || s.includes('hockey'))                            return 5;
    if (s.includes('soccer') || s.includes('football') || s.includes('wc'))   return 4;
    return 20; // generic ceiling
}

function detectAnomalies(games) {
    const findings = [];
    for (const g of games) {
        if (typeof g.home_score !== 'number' || typeof g.away_score !== 'number') continue;
        const margin = Math.abs(g.home_score - g.away_score);
        const winner = g.home_score > g.away_score ? g.home : g.away;
        const loser  = g.home_score > g.away_score ? g.away : g.home;
        const score  = `${Math.max(g.home_score, g.away_score)}-${Math.min(g.home_score, g.away_score)}`;
        const note   = (g.note || '') + ' ' + (g.drama_arc || '');

        // 1. Upsets — winner closed at +200 or longer
        const ml = winnerMoneylinePrice(g);
        if (ml != null && ml >= 200) {
            findings.push({
                type: 'upset',
                game_id: g.id || null,
                sport: g.sport || null,
                headline: `${winner} beat ${loser} ${score} as a +${Math.round(ml)} underdog.`,
                rarity_score: Math.min(0.95, 0.5 + ml / 800),
            });
        }
        // 2. Blowouts — margin exceeds sport-specific threshold
        const bt = blowoutThreshold(g.sport);
        if (margin >= bt) {
            findings.push({
                type: 'blowout',
                game_id: g.id || null,
                sport: g.sport || null,
                headline: `${winner} routed ${loser} ${score} — ${margin}-point margin.`,
                rarity_score: Math.min(0.9, 0.4 + (margin - bt) / 50),
            });
        }
        // 3. Rare events — regex over recap text
        if (WALKOFF_TEXT_RE.test(note)) {
            findings.push({
                type: 'rare_event',
                game_id: g.id || null,
                sport: g.sport || null,
                headline: `${winner} walked off ${loser} ${score}.`,
                rarity_score: 0.85,
            });
        }
        if (SHUTOUT_TEXT_RE.test(note) || Math.min(g.home_score, g.away_score) === 0) {
            findings.push({
                type: 'rare_event',
                game_id: g.id || null,
                sport: g.sport || null,
                headline: `${winner} shut out ${loser} ${score}.`,
                rarity_score: 0.7,
            });
        }
        if (HAT_TRICK_RE.test(note)) {
            findings.push({
                type: 'rare_event',
                game_id: g.id || null,
                sport: g.sport || null,
                headline: `Hat trick in ${winner}'s ${score} win over ${loser}.`,
                rarity_score: 0.8,
            });
        }
        if (NO_HITTER_RE.test(note) || PERFECT_GAME_RE.test(note)) {
            findings.push({
                type: 'rare_event',
                game_id: g.id || null,
                sport: g.sport || null,
                headline: `No-hitter from ${winner} over ${loser} ${score}.`,
                rarity_score: 0.97,
            });
        }
    }

    // 5. Convergence — 3+ unusual events on one night promotes the top one.
    if (findings.length >= 3) {
        findings.sort((a, b) => b.rarity_score - a.rarity_score);
        return {
            type: 'convergence',
            game_id: findings[0].game_id,
            sport: findings[0].sport,
            headline: `${findings.length} unusual finishes — led by ${findings[0].headline.replace(/\.$/, '')}.`,
            rarity_score: Math.min(0.95, findings[0].rarity_score + 0.1),
        };
    }
    if (!findings.length) return null;
    findings.sort((a, b) => b.rarity_score - a.rarity_score);
    return findings[0];
}

async function runPhase3TruthIs(env, date, ctx) {
    const games = ctx
        ? [...(ctx.games?.regular || []), ...(ctx.games?.postseason || [])]
        : [];
    const finding = detectAnomalies(games);

    if (!finding) {
        // Graceful degradation — quiet night, no AI call.
        const fallback = {
            type: 'none',
            headline: "Quiet night. The truth is, sometimes that's the story.",
            rarity_score: 0,
        };
        await writeAnalyticsOutput(env, {
            date,
            feature: 'truth_is',
            sport: null,
            value: fallback,
            briefText: fallback.headline,
        });
        return { aiCalls: 0, finding: fallback };
    }

    const prompt =
        `Write one sentence about this fact with genuine wonder. Factual, warm. ` +
        `No hype words. The truth is the fun part.\n\nFACT: ${finding.headline}`;
    const line = await callProxy(prompt, { maxTokens: 80 });
    const briefText = line || finding.headline; // fall back to the raw fact

    await writeAnalyticsOutput(env, {
        date,
        feature: 'truth_is',
        sport: finding.sport,
        value: finding,
        briefText,
    });
    return { aiCalls: line ? 1 : 0, finding, briefText };
}

// ── Phase 5: Morning Report ────────────────────────────────────────────────
// One paragraph (80-120 words) synthesising Night Stars + Truth Is + top
// recaps. Stored in KV under field:morning_report:{date} (48h TTL) AND in
// analytics_output for historical browsing.
async function runPhase5MorningReport(env, date, { stars, truthIs, ctx }) {
    const games = ctx
        ? [...(ctx.games?.regular || []), ...(ctx.games?.postseason || [])]
        : [];

    // One-line recap per game. Keep prompt tight — Gemini handles ~250 words
    // of context comfortably, beyond that it tends to enumerate.
    const recapLines = games
        .filter(g => g.note || (typeof g.home_score === 'number' && typeof g.away_score === 'number'))
        .slice(0, 16)
        .map(g => {
            const score = (typeof g.home_score === 'number' && typeof g.away_score === 'number')
                ? `${g.home_score}-${g.away_score}` : '';
            return `- ${g.sport || '?'}: ${g.away} at ${g.home} ${score}${g.note ? ' — ' + g.note : ''}`;
        })
        .join('\n');

    const truthLine = truthIs?.headline || 'A quiet night.';
    const starLine  = stars
        ? `${stars.stars}/5 (${stars.totalGames} games, ${stars.dramaGames} drama, ${stars.closeGames} close, ${stars.walkoffs} walkoffs)`
        : 'unrated';

    const prompt =
        `Write FIELD's Morning Report for ${date}. V4 voice: warm, wise, uplifting. ` +
        `One paragraph, 80-120 words.\n\n` +
        `STRUCTURE:\n` +
        `- Open with the night's headline truth (The Truth Is)\n` +
        `- 2-3 most important results with angle\n` +
        `- Close with what carries forward\n\n` +
        `NIGHT STARS: ${starLine}\n` +
        `THE TRUTH IS: ${truthLine}\n\n` +
        `ALL RESULTS:\n${recapLines || '(no completed games)'}\n\n` +
        `Do NOT list all results. Pick the 3-4 that matter most. ` +
        `The truth is the fun part. Let it be fun.`;

    const prose = await callProxy(prompt, { maxTokens: 250 });
    const briefText = prose || `Quiet night across the slate for ${date}. Tomorrow brings another set.`;

    // KV write — best-effort, doesn't fail the phase if KV is unavailable.
    try {
        if (env.FIELD_JOURNALISM) {
            await env.FIELD_JOURNALISM.put(
                `field:morning_report:${date}`,
                briefText,
                { expirationTtl: KV_REPORT_TTL_SECS },
            );
        }
    } catch (e) {
        console.error('[ANALYTICS] morning_report KV put failed:', e.message);
    }

    await writeAnalyticsOutput(env, {
        date,
        feature: 'morning_report',
        sport: null,
        value: { word_count: briefText.split(/\s+/).filter(Boolean).length, stars: stars?.stars || null },
        briefText,
    });
    return { aiCalls: prose ? 1 : 0, briefText };
}

// ── Phase 9: FIELD's Pick (TODAY) ──────────────────────────────────────────
// Self-fetches /v2/games?sport=<X>&date=<today> for the curated sport set,
// scores each by playoff/rivalry/line tightness/primetime/national-broadcast,
// and asks the proxy for the one-line recommendation. Stored in KV under
// field:pick:{today} (48h TTL) AND analytics_output (date=TODAY).
function scoreCandidatePick(game) {
    let score = 0;
    const reasons = [];
    const note  = (game.note || '').toLowerCase();
    const round = (game.round || game.series_round || '').toLowerCase();

    if (round.includes('final') || round.includes('elim') || /\bg(?:ame)?\s*7\b/i.test(note)) {
        score += 3; reasons.push('postseason/elimination');
    }
    if (note.includes('rivalry') || note.includes('rival')) {
        score += 1; reasons.push('rivalry');
    }
    // Tight closing line (spread < 3) — closing_odds may be embedded or absent
    const odds = parseOddsJSON(game.closing_odds) || parseOddsJSON(game.opening_odds);
    const spread = odds && (odds.spread?.home ?? odds.spread?.away ?? odds.line ?? null);
    if (spread != null && Math.abs(Number(spread)) < 3) {
        score += 2; reasons.push(`tight line (${Math.abs(Number(spread)).toFixed(1)})`);
    }
    // Prime time — game.commence or game.kickoff (ISO) between 19-22 ET (23-02 UTC)
    const startISO = game.commence || game.start || game.kickoff || game.startTime || null;
    if (startISO) {
        const h = new Date(startISO).getUTCHours();
        if (h >= 23 || h <= 2) { score += 1; reasons.push('prime time'); }
    }
    // National broadcast hint — streams field includes ABC/ESPN/TNT/FOX/NBC etc.
    const streams = (game.streams || '') + '';
    if (/\b(ESPN|ABC|TNT|FOX|NBC|CBS|TBS|Apple TV|Amazon)\b/i.test(streams)) {
        score += 0.5; reasons.push('national broadcast');
    }
    return { score, reasons };
}

async function runPhase9FieldPick(env, today) {
    const relayBase = env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
    const settled = await Promise.allSettled(PHASE9_SPORTS.map(s =>
        fetch(`${relayBase}/v2/games?sport=${s}&date=${today}`, { cf: { cacheTtl: 60, cacheEverything: true } })
            .then(r => r.ok ? r.json() : null)
            .then(j => (j && Array.isArray(j.games)) ? j.games : [])));

    const candidates = [];
    for (const s of settled) {
        if (s.status === 'fulfilled' && Array.isArray(s.value)) candidates.push(...s.value);
    }

    if (candidates.length === 0) {
        // No schedule — skip entirely per spec. Don't write an output row.
        console.log(`[ANALYTICS] Phase 9 skipped: no games today (${today})`);
        return { aiCalls: 0, skipped: true };
    }

    let best = null;
    for (const g of candidates) {
        const { score, reasons } = scoreCandidatePick(g);
        if (!best || score > best.score) best = { game: g, score, reasons };
    }

    if (!best || best.score <= 3) {
        const pass = {
            type: 'pass',
            score: best?.score || 0,
            reason: best ? `top game scored ${best.score.toFixed(1)} — under the 3.0 watch-bar` : 'no candidates',
        };
        const passLine = "Not every night has a must-watch. Tonight's one of those.";
        try {
            if (env.FIELD_JOURNALISM) {
                await env.FIELD_JOURNALISM.put(`field:pick:${today}`, passLine, { expirationTtl: KV_REPORT_TTL_SECS });
            }
        } catch (e) { console.error('[ANALYTICS] field_pick pass KV put failed:', e.message); }
        await writeAnalyticsOutput(env, {
            date: today,
            feature: 'field_pick',
            sport: null,
            value: pass,
            briefText: passLine,
        });
        return { aiCalls: 0, pass: true };
    }

    const g = best.game;
    const context = best.reasons.join(', ') || 'tonight';
    const prompt =
        `Write one sentence recommending this game. V4 voice. Warm, like a friend's ` +
        `recommendation. "Watch this one. Trust me."\n` +
        `GAME: ${g.home?.name || g.home} vs ${g.away?.name || g.away}, ${g.sport || ''}, ${context}`;
    const line = await callProxy(prompt, { maxTokens: 60 });
    const briefText = line || `Watch ${g.home?.name || g.home} vs ${g.away?.name || g.away} — ${context}.`;

    const value = {
        game_id: g.id || null,
        sport:   g.sport || null,
        home:    g.home?.name || g.home || null,
        away:    g.away?.name || g.away || null,
        score:   best.score,
        reasons: best.reasons,
    };
    try {
        if (env.FIELD_JOURNALISM) {
            await env.FIELD_JOURNALISM.put(`field:pick:${today}`, briefText, { expirationTtl: KV_REPORT_TTL_SECS });
        }
    } catch (e) { console.error('[ANALYTICS] field_pick KV put failed:', e.message); }

    await writeAnalyticsOutput(env, {
        date: today,
        feature: 'field_pick',
        sport: value.sport,
        value,
        briefText,
    });
    return { aiCalls: line ? 1 : 0, pick: value };
}

// Process one date end-to-end. Returns the status record for this date.
// Phase 11 (writeRunStatus) runs in a finally so an unexpected throw in any
// other phase still surfaces an observable health record — fix for the
// Prompt 1 carry-forward bug where /analytics/status returned null even
// after the engine had run.
async function processDate(env, date, { selfHealed }) {
    const t0 = Date.now();
    const phasesCompleted = [];
    const phasesFailed = [];
    const errors = [];
    let featuresComputed = 0;
    let aiCallsMade = 0;

    phasesCompleted.push('phase0'); // already past Phase 0 by definition

    let status;
    try {
        // Phase 1: data collection
        let ctx = null, odds = null, prevStars = null, prevBriefs = null, qualityScores = null;
        try {
            const settled = await Promise.allSettled([
                fetchContextGraph(env, date),
                env.ARCHIVE_DB.prepare(`SELECT * FROM odds_history WHERE date = ?`).bind(date).all().catch(e => { throw new Error(`odds_history: ${e.message}`); }),
                env.ARCHIVE_DB.prepare(`SELECT * FROM analytics_output WHERE feature = 'night_stars' ORDER BY date DESC LIMIT 14`).all(),
                env.ARCHIVE_DB.prepare(`SELECT * FROM briefs WHERE date >= ? ORDER BY date DESC`).bind(sevenDaysAgo(date)).all(),
                env.ARCHIVE_DB.prepare(`SELECT sport, AVG(quality_score) AS avg_q, COUNT(*) AS n FROM briefs WHERE date >= ? AND quality_score IS NOT NULL GROUP BY sport`).bind(sevenDaysAgo(date)).all(),
            ]);
            const [s1, s2, s3, s4, s5] = settled;
            ctx           = s1.status === 'fulfilled' ? s1.value : null;
            odds          = s2.status === 'fulfilled' ? s2.value : null;
            prevStars     = s3.status === 'fulfilled' ? s3.value : null;
            prevBriefs    = s4.status === 'fulfilled' ? s4.value : null;
            qualityScores = s5.status === 'fulfilled' ? s5.value : null;
            settled.forEach((s, i) => { if (s.status === 'rejected') errors.push(`phase1[${i}]: ${s.reason?.message || s.reason}`); });
            phasesCompleted.push('phase1');
        } catch (e) {
            phasesFailed.push('phase1');
            errors.push(`phase1 fatal: ${e.message}`);
        }

        // Phase 2: Night Stars (needs Context Graph; skip if Phase 1 produced nothing)
        let starsOut = null;
        try {
            const allGames = ctx
                ? [...(ctx.games?.regular || []), ...(ctx.games?.postseason || [])]
                : [];
            starsOut = computeNightStars(allGames);
            await writeAnalyticsOutput(env, {
                date,
                feature: 'night_stars',
                sport:   null,
                value:   starsOut,
                briefText: null,
            });
            featuresComputed++;
            phasesCompleted.push('phase2');
        } catch (e) {
            phasesFailed.push('phase2');
            errors.push(`phase2: ${e.message}`);
        }

        // Phase 3: The Truth Is — anomaly detection + AI delivery
        let truthOut = null;
        try {
            const r = await runPhase3TruthIs(env, date, ctx);
            truthOut = r.finding;
            aiCallsMade += r.aiCalls;
            featuresComputed++;
            phasesCompleted.push('phase3');
        } catch (e) {
            phasesFailed.push('phase3');
            errors.push(`phase3: ${e.message}`);
        }

        // Phase 5: Morning Report — synthesis paragraph
        try {
            const r = await runPhase5MorningReport(env, date, { stars: starsOut, truthIs: truthOut, ctx });
            aiCallsMade += r.aiCalls;
            featuresComputed++;
            phasesCompleted.push('phase5');
        } catch (e) {
            phasesFailed.push('phase5');
            errors.push(`phase5: ${e.message}`);
        }

        // Phase 9: FIELD's Pick — TODAY's recommended game
        // Uses today's schedule (not the `date` we're processing — which is
        // yesterday by default). Independent from Phases 1-5.
        try {
            const today = isoDate(new Date());
            const r = await runPhase9FieldPick(env, today);
            aiCallsMade += r.aiCalls;
            if (!r.skipped) featuresComputed++;
            phasesCompleted.push('phase9');
        } catch (e) {
            phasesFailed.push('phase9');
            errors.push(`phase9: ${e.message}`);
        }

        // Touch unused locals — they exist for downstream prompts.
        void odds; void prevStars; void prevBriefs; void qualityScores;
    } finally {
        // Phase 11 ALWAYS runs — even if an earlier phase throws past its
        // try/catch, the engine still writes an observable health record.
        status = {
            last_run: new Date().toISOString(),
            date_processed: date,
            phases_completed: phasesCompleted,
            phases_failed: phasesFailed,
            features_computed: featuresComputed,
            ai_calls_made: aiCallsMade,
            duration_ms: Date.now() - t0,
            self_healed: selfHealed ? 1 : 0,
            errors,
        };
        try {
            await writeRunStatus(env, status);
            phasesCompleted.push('phase11');
        } catch (e) {
            // writeRunStatus already swallows individual KV/D1 failures; this
            // outer catch protects against an unexpected throw so the finally
            // never blocks the caller's loop.
            console.error('[ANALYTICS] phase11 status write failed:', e.message);
        }
    }

    return status;
}

// Public entry point. Runs Phase 0 self-heal planning, then iterates dates
// oldest-first. Always returns a summary (never throws past the catch).
export async function analyticsEngine(env, opts = {}) {
    const startedAt = Date.now();
    const target = opts.date || yesterdayISO(opts.now ? new Date(opts.now) : new Date());
    try {
        await ensureAnalyticsTables(env);
    } catch (e) {
        console.error('[ANALYTICS] table bootstrap failed:', e.message);
        return { ok: false, error: e.message, target };
    }

    const dates = await planDates(env, target);
    if (dates.length === 0) {
        console.log(`[ANALYTICS] nothing to do — last_run already covers ${target}`);
        // Refresh KV status so /analytics/status reflects this invocation
        // rather than the previous run's stale state.
        try {
            await writeRunStatus(env, {
                last_run: new Date().toISOString(),
                date_processed: target,
                phases_completed: ['phase0', 'phase11'],
                phases_failed: [],
                features_computed: 0,
                ai_calls_made: 0,
                duration_ms: Date.now() - startedAt,
                self_healed: 0,
                errors: [],
                skipped: 'up-to-date',
            });
        } catch (e) {
            console.error('[ANALYTICS] up-to-date status write failed:', e.message);
        }
        return { ok: true, target, processed: [], skipped: 'up-to-date' };
    }
    if (dates.length > 1) {
        console.log(`[ANALYTICS] self-healing: processing ${dates.length} missed dates (${dates[0]} → ${dates[dates.length-1]})`);
    }

    const processed = [];
    for (const d of dates) {
        try {
            const status = await processDate(env, d, { selfHealed: dates.length > 1 });
            processed.push({ date: d, ok: true, features: status.features_computed, ms: status.duration_ms });
        } catch (e) {
            console.error(`[ANALYTICS] ${d} failed:`, e.message);
            processed.push({ date: d, ok: false, error: e.message });
        }
    }

    return {
        ok: true,
        target,
        processed,
        total_ms: Date.now() - startedAt,
    };
}
