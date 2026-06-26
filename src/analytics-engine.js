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

const PHASE_NAMES = ['phase0', 'phase1', 'phase2', 'phase3', 'phase4', 'phase5', 'phase7', 'phase8', 'phase9', 'phase10a', 'phase10b', 'phase6a', 'phase6b', 'phase6c', 'phase6d', 'phase11', 'phase12'];
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

// ── Phase 7: Streak Board (nightly) ────────────────────────────────────────
// Detect consecutive hot (quality_score >= 130) or cold (< 80) streaks per
// team over the last 14 days of briefs. JOINs briefs.game_id against
// regular_season_games + postseason_games to recover home/away team names —
// safer than regex over brief_text. No AI call; the detection IS the feature.
async function runPhase7StreakBoard(env, date) {
    const STREAK_LOOKBACK_DAYS = 14;
    const STREAK_MIN = 3;
    const HOT_THRESHOLD  = 130;
    const COLD_THRESHOLD = 80;
    const since = addDays(date, -STREAK_LOOKBACK_DAYS);

    // Pull briefs joined to either game table for team identity. Two
    // queries (regular + postseason) UNION'd in app code so we don't have
    // to push a complex UNION into D1 prepared statements.
    const [regRes, psRes] = await Promise.allSettled([
        env.ARCHIVE_DB.prepare(`
            SELECT b.date, b.quality_score, b.sport, g.home, g.away
            FROM briefs b JOIN regular_season_games g ON b.game_id = g.id
            WHERE b.date >= ? AND b.date <= ? AND b.quality_score IS NOT NULL
            ORDER BY b.date ASC
        `).bind(since, date).all(),
        env.ARCHIVE_DB.prepare(`
            SELECT b.date, b.quality_score, b.sport, g.home, g.away
            FROM briefs b JOIN postseason_games g ON b.game_id = g.id
            WHERE b.date >= ? AND b.date <= ? AND b.quality_score IS NOT NULL
            ORDER BY b.date ASC
        `).bind(since, date).all(),
    ]);
    const rows = []
        .concat(regRes.status === 'fulfilled' ? (regRes.value.results || []) : [])
        .concat(psRes.status  === 'fulfilled' ? (psRes.value.results  || []) : []);

    if (rows.length < 3) {
        // Insufficient data — graceful degradation per spec.
        console.log(`[ANALYTICS] Phase 7 degraded: only ${rows.length} brief rows in window`);
        await writeAnalyticsOutput(env, {
            date,
            feature: 'streak_board',
            sport: null,
            value: { hot: [], cold: [], degraded: true, brief_rows: rows.length },
            briefText: null,
        });
        return {};
    }

    // Index per-team series of (date, score). A brief covers both teams
    // in its game, so each row contributes to two team timelines.
    const perTeam = new Map();
    for (const r of rows) {
        for (const team of [r.home, r.away]) {
            if (!team) continue;
            const key = `${team}|${r.sport || ''}`;
            if (!perTeam.has(key)) perTeam.set(key, []);
            perTeam.get(key).push({ date: r.date, score: r.quality_score });
        }
    }

    const hot = [], cold = [];
    for (const [key, series] of perTeam) {
        series.sort((a, b) => a.date.localeCompare(b.date));
        const [team, sport] = key.split('|');

        // Walk the series; reset both counters whenever a game breaks the
        // streak. We only emit the most recent streak per team.
        let hotRun = [], coldRun = [];
        for (const g of series) {
            if (g.score >= HOT_THRESHOLD) {
                hotRun.push(g.date);
                coldRun = [];
            } else if (g.score < COLD_THRESHOLD) {
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
        feature: 'streak_board',
        sport: null,
        value: { hot, cold, lookback_days: STREAK_LOOKBACK_DAYS, hot_threshold: HOT_THRESHOLD, cold_threshold: COLD_THRESHOLD },
        briefText: null,
    });
    return {};
}

// ── Phase 8: Quality Feedback (nightly) ────────────────────────────────────
// Snapshot per-sport p25/p50/p75 of brief quality_score over the last 30
// days into KV (field:quality_calibration) and analytics_output. Aligns
// with the existing loadQualityCalibration() / getQualityTarget() system
// in src/index.js (per Rule 62 — no parallel control loop). The journalism
// cron still reads from its own in-memory load each tick; this phase
// surfaces the same data to /analytics/* consumers + provides a daily
// audit trail of what thresholds the journalism cron will see.
const QUALITY_CALIBRATION_KV_KEY = 'field:quality_calibration';
async function runPhase8QualityFeedback(env, date) {
    const since = addDays(date, -30);
    const rowsRes = await env.ARCHIVE_DB.prepare(`
        SELECT sport, quality_score FROM briefs
        WHERE date >= ? AND date <= ?
          AND quality_score IS NOT NULL AND sport IS NOT NULL
    `).bind(since, date).all();

    const rows = rowsRes.results || [];
    if (rows.length === 0) {
        console.log('[ANALYTICS] Phase 8 skipped: no quality data');
        await writeAnalyticsOutput(env, {
            date,
            feature: 'quality_feedback',
            sport: null,
            value: { adjustments: [], degraded: true, reason: 'no quality data' },
            briefText: null,
        });
        return { skipped: true };
    }

    const bySport = {};
    for (const r of rows) {
        if (!bySport[r.sport]) bySport[r.sport] = [];
        bySport[r.sport].push(r.quality_score);
    }

    // Mirrors loadQualityCalibration() in src/index.js (sorted percentiles
    // with a 5-sample minimum). Anything under 5 samples still gets a row
    // — useful for /analytics/* visibility — but is flagged insufficient.
    const calibration = {};
    const adjustments = [];
    for (const [sport, scores] of Object.entries(bySport)) {
        scores.sort((a, b) => a - b);
        const entry = {
            p25: scores[Math.floor(scores.length * 0.25)] ?? null,
            p50: scores[Math.floor(scores.length * 0.50)] ?? null,
            p75: scores[Math.floor(scores.length * 0.75)] ?? null,
            count: scores.length,
            min: scores[0],
            max: scores[scores.length - 1],
            sufficient: scores.length >= 5,
            snapshot_date: date,
        };
        calibration[sport] = entry;
        adjustments.push({
            sport,
            threshold_p25: entry.p25,
            samples: entry.count,
            sufficient: entry.sufficient,
        });
    }

    try {
        if (env.FIELD_JOURNALISM) {
            // _last_updated lets the journalism cron's loadQualityCalibration
            // detect a stale calibration (>36h old) and fall back to a fresh
            // D1 percentile computation.
            calibration._last_updated = new Date().toISOString();
            await env.FIELD_JOURNALISM.put(QUALITY_CALIBRATION_KV_KEY, JSON.stringify(calibration));
        }
    } catch (e) {
        console.error('[ANALYTICS] quality_calibration KV put failed:', e.message);
    }

    await writeAnalyticsOutput(env, {
        date,
        feature: 'quality_feedback',
        sport: null,
        value: { adjustments, sports: Object.keys(calibration).length, total_samples: rows.length },
        briefText: null,
    });
    return { adjustments };
}

// ── Phase 6: Weekly Features (Monday gate) ─────────────────────────────────
// The cron fires Monday 5 AM ET processing yesterday (= Sunday). Sunday
// closes the FIELD week. All four sub-features run together; weekly AI
// budget is 2 calls (6B Composite + 6C Contradiction), each elided when
// data is insufficient.

// 6A — Sport of the Week: per-sport drama totals over the trailing 7 days
async function runPhase6ASportOfWeek(env, date) {
    const since = addDays(date, -6); // inclusive 7-day window ending on `date`
    const sportsRes = await env.ARCHIVE_DB.prepare(`
        SELECT sport, COUNT(*) AS games,
               SUM(CASE WHEN quality_score >= 130 THEN 1 ELSE 0 END) AS high_quality
        FROM briefs
        WHERE date >= ? AND date <= ? AND sport IS NOT NULL
        GROUP BY sport
        ORDER BY high_quality DESC, games DESC
    `).bind(since, date).all();
    const rows = sportsRes.results || [];

    if (rows.length === 0) {
        await writeAnalyticsOutput(env, {
            date,
            feature: 'sport_of_week',
            sport: null,
            value: { winner: null, runnerUp: null, dramaTotal: 0, gamesPlayed: 0, degraded: true, summary: 'No brief activity this week.' },
            briefText: null,
        });
        return { skipped: true };
    }
    const winner   = rows[0];
    const runnerUp = rows[1] || null;
    const summary  = runnerUp
        ? `${winner.sport} (${winner.high_quality}/${winner.games} high-quality) edged ${runnerUp.sport} (${runnerUp.high_quality}/${runnerUp.games}).`
        : `${winner.sport} (${winner.high_quality}/${winner.games} high-quality) was the only sport with brief activity this week.`;

    await writeAnalyticsOutput(env, {
        date,
        feature: 'sport_of_week',
        sport: winner.sport,
        value: {
            winner: winner.sport,
            dramaTotal: winner.high_quality,
            gamesPlayed: winner.games,
            runnerUp: runnerUp?.sport || null,
            runnerUpDrama: runnerUp?.high_quality || 0,
            summary,
            allSports: rows,
        },
        briefText: summary,
    });
    return {};
}

// Take the first complete sentence of a brief (stops at the first . ! or ?
// that's not part of an abbreviation). Used to seed the Composite Brief.
function firstSentence(text) {
    if (!text) return '';
    const m = text.match(/^[\s\S]+?[.!?](?:\s|$)/);
    return (m ? m[0] : text).trim();
}

// 6B — Composite Brief: top sentence per sport → AI blend → 60-80 words
async function runPhase6BCompositeBrief(env, date) {
    const since = addDays(date, -6);
    const res = await env.ARCHIVE_DB.prepare(`
        SELECT sport, brief_text, quality_score
        FROM briefs
        WHERE date >= ? AND date <= ? AND brief_text IS NOT NULL
          AND quality_score IS NOT NULL AND sport IS NOT NULL
        ORDER BY quality_score DESC
    `).bind(since, date).all();

    // Per-sport best brief — first occurrence of each sport from the DESC
    // ordering is the highest-quality entry for that sport.
    const bestPerSport = new Map();
    for (const r of (res.results || [])) {
        if (!bestPerSport.has(r.sport)) bestPerSport.set(r.sport, r);
    }
    if (bestPerSport.size < 2) {
        const fallback = 'Not enough data for a weekly composite yet.';
        await writeAnalyticsOutput(env, {
            date,
            feature: 'composite_brief',
            sport: null,
            value: { sports_used: bestPerSport.size, degraded: true },
            briefText: fallback,
        });
        return { aiCalls: 0, skipped: true };
    }

    const lines = [...bestPerSport.entries()]
        .map(([sport, row]) => `${sport}: ${firstSentence(row.brief_text)}`)
        .join('\n');
    const prompt =
        `Blend these sentences into one literary paragraph. V4 voice: warm, ` +
        `wise, uplifting. 60-80 words. The week in sports, compressed.\n\n` +
        `BEST LINES:\n${lines}`;
    const prose = await callProxy(prompt, { maxTokens: 150 });
    const briefText = prose || `Across ${bestPerSport.size} sports this week, the slate kept giving.`;

    await writeAnalyticsOutput(env, {
        date,
        feature: 'composite_brief',
        sport: null,
        value: {
            sports_used: bestPerSport.size,
            word_count: briefText.split(/\s+/).filter(Boolean).length,
            sources: [...bestPerSport.keys()],
        },
        briefText,
    });
    return { aiCalls: prose ? 1 : 0 };
}

// 6C — Contradiction Finder: same team, opposite framings within 7 days
// Team identity comes from briefs.game_id JOIN — far more reliable than
// regex over prose. Positive/negative signal lists are conservative.
const CONTRADICTION_POSITIVE = ['dominant','clicking','rolling','impressive','commanding','convincing','locked in','peaking'];
const CONTRADICTION_NEGATIVE = ['struggling','fading','shaky','sloppy','flat','lifeless','overwhelmed','outclassed'];
function classifyFraming(text) {
    if (!text) return { pos: false, neg: false };
    const lower = text.toLowerCase();
    return {
        pos: CONTRADICTION_POSITIVE.some(w => lower.includes(w)),
        neg: CONTRADICTION_NEGATIVE.some(w => lower.includes(w)),
    };
}

async function runPhase6CContradiction(env, date) {
    const since = addDays(date, -6);
    const [regRes, psRes] = await Promise.allSettled([
        env.ARCHIVE_DB.prepare(`
            SELECT b.date, b.brief_text, g.home, g.away
            FROM briefs b JOIN regular_season_games g ON b.game_id = g.id
            WHERE b.date >= ? AND b.date <= ? AND b.brief_text IS NOT NULL
            ORDER BY b.date ASC
        `).bind(since, date).all(),
        env.ARCHIVE_DB.prepare(`
            SELECT b.date, b.brief_text, g.home, g.away
            FROM briefs b JOIN postseason_games g ON b.game_id = g.id
            WHERE b.date >= ? AND b.date <= ? AND b.brief_text IS NOT NULL
            ORDER BY b.date ASC
        `).bind(since, date).all(),
    ]);
    const rows = []
        .concat(regRes.status === 'fulfilled' ? (regRes.value.results || []) : [])
        .concat(psRes.status  === 'fulfilled' ? (psRes.value.results  || []) : []);

    const perTeam = new Map(); // team -> [{date, text, pos, neg}]
    for (const r of rows) {
        const framing = classifyFraming(r.brief_text);
        if (!framing.pos && !framing.neg) continue;
        for (const team of [r.home, r.away]) {
            if (!team) continue;
            if (!perTeam.has(team)) perTeam.set(team, []);
            perTeam.get(team).push({ date: r.date, text: r.brief_text, ...framing });
        }
    }

    const contradictions = [];
    for (const [team, items] of perTeam) {
        const posItems = items.filter(i => i.pos);
        const negItems = items.filter(i => i.neg);
        if (!posItems.length || !negItems.length) continue;
        // Pick the most recent pair.
        posItems.sort((a, b) => b.date.localeCompare(a.date));
        negItems.sort((a, b) => b.date.localeCompare(a.date));
        contradictions.push({
            team,
            positive_date: posItems[0].date,
            negative_date: negItems[0].date,
            positive_quote: firstSentence(posItems[0].text),
            negative_quote: firstSentence(negItems[0].text),
        });
    }

    if (contradictions.length === 0) {
        console.log('[ANALYTICS] Phase 6C: no contradictions detected');
        await writeAnalyticsOutput(env, {
            date,
            feature: 'contradiction',
            sport: null,
            value: { contradictions: [], degraded: false },
            briefText: null,
        });
        return { aiCalls: 0, skipped: true };
    }

    // Single AI call for the top contradiction (most recent by negative_date).
    contradictions.sort((a, b) => b.negative_date.localeCompare(a.negative_date));
    const top = contradictions[0];
    const prompt =
        `FIELD said "${top.positive_quote}" on ${top.positive_date} and ` +
        `"${top.negative_quote}" on ${top.negative_date} about ${top.team}. ` +
        `Write one sentence acknowledging this with warm self-awareness. V4 voice.`;
    const line = await callProxy(prompt, { maxTokens: 80 });
    const briefText = line || `About ${top.team}: we said opposite things this week. Both were true at the time.`;

    await writeAnalyticsOutput(env, {
        date,
        feature: 'contradiction',
        sport: null,
        value: { contradictions, top },
        briefText,
    });
    return { aiCalls: line ? 1 : 0 };
}

// 6D — Broken Record: detect 4-grams repeated 3+ times for the same team
function fourGrams(text) {
    const tokens = text.toLowerCase().replace(/[^a-z0-9\s]+/g, ' ').split(/\s+/).filter(Boolean);
    const grams = [];
    for (let i = 0; i + 4 <= tokens.length; i++) {
        grams.push(tokens.slice(i, i + 4).join(' '));
    }
    return grams;
}

async function runPhase6DBrokenRecord(env, date) {
    const since = addDays(date, -13); // 14-day window per spec
    const [regRes, psRes] = await Promise.allSettled([
        env.ARCHIVE_DB.prepare(`
            SELECT b.date, b.brief_text, g.home, g.away
            FROM briefs b JOIN regular_season_games g ON b.game_id = g.id
            WHERE b.date >= ? AND b.date <= ? AND b.brief_text IS NOT NULL
        `).bind(since, date).all(),
        env.ARCHIVE_DB.prepare(`
            SELECT b.date, b.brief_text, g.home, g.away
            FROM briefs b JOIN postseason_games g ON b.game_id = g.id
            WHERE b.date >= ? AND b.date <= ? AND b.brief_text IS NOT NULL
        `).bind(since, date).all(),
    ]);
    const rows = []
        .concat(regRes.status === 'fulfilled' ? (regRes.value.results || []) : [])
        .concat(psRes.status  === 'fulfilled' ? (psRes.value.results  || []) : []);

    // teamGrams: team -> Map<gram, [dates]>
    const teamGrams = new Map();
    for (const r of rows) {
        const grams = fourGrams(r.brief_text);
        for (const team of [r.home, r.away]) {
            if (!team) continue;
            if (!teamGrams.has(team)) teamGrams.set(team, new Map());
            const m = teamGrams.get(team);
            // Dedup grams per brief — a gram repeating within one brief
            // doesn't count toward the cross-brief 3+ threshold.
            for (const g of new Set(grams)) {
                if (!m.has(g)) m.set(g, []);
                m.get(g).push(r.date);
            }
        }
    }

    const records = [];
    for (const [team, gramMap] of teamGrams) {
        for (const [gram, dates] of gramMap) {
            // Filter out common sport-domain stop-grams to keep signal high.
            if (/^(the|in the|on the|at the|to the)\b/.test(gram)) continue;
            if (dates.length >= 3) {
                records.push({ team, phrase: gram, occurrences: dates.length, dates });
            }
        }
    }
    records.sort((a, b) => b.occurrences - a.occurrences);

    await writeAnalyticsOutput(env, {
        date,
        feature: 'broken_record',
        sport: null,
        value: { records, lookback_days: 14 },
        briefText: null,
    });
    return {};
}

// ── Phase 4: Jinx Counter ──────────────────────────────────────────────────
// Looks up yesterday's FIELD's Pick (Phase 9 row for the processing date),
// matches it against the game's actual outcome in Phase 1 context, and
// tallies a running accuracy. No AI call. Skips gracefully when no pick
// exists or when the game wasn't found in the night's slate.
async function runPhase4Jinx(env, date, ctx) {
    const pickRow = await env.ARCHIVE_DB.prepare(`
        SELECT value FROM analytics_output
        WHERE feature = 'field_pick' AND date = ? LIMIT 1
    `).bind(date).first();
    if (!pickRow) {
        console.log(`[ANALYTICS] Phase 4 skipped: no pick for ${date}`);
        return { skipped: true };
    }
    let pick;
    try { pick = JSON.parse(pickRow.value); } catch (_) { pick = null; }
    if (!pick || pick.type === 'pass' || !pick.game_id) {
        // Pass-through pick or unparseable — nothing to grade.
        console.log(`[ANALYTICS] Phase 4 skipped: pass-through pick for ${date}`);
        return { skipped: true };
    }

    // Find the game in Phase 1 context. Search both regular + postseason.
    const allGames = ctx
        ? [...(ctx.games?.regular || []), ...(ctx.games?.postseason || [])]
        : [];
    const game = allGames.find(g => g.id === pick.game_id) || null;

    let pickCorrect = null;
    let finalMargin = null;
    let drama = null;
    let hasExtras = false;
    if (game) {
        if (typeof game.drama_peak === 'number') drama = game.drama_peak;
        if (typeof game.home_score === 'number' && typeof game.away_score === 'number') {
            finalMargin = Math.abs(game.home_score - game.away_score);
        }
        const note = (game.note || '') + ' ' + (game.drama_arc || '');
        hasExtras = /\b(OT|2OT|3OT|F\/OT|extra innings|extras)\b/i.test(note);
        pickCorrect = (drama != null && drama >= 65)
                   || (finalMargin != null && finalMargin <= 3)
                   || hasExtras;
    } else {
        console.log(`[ANALYTICS] Phase 4: game ${pick.game_id} not found in ctx for ${date}`);
    }

    // Market agreement — odds_history is best-effort; the table may not
    // exist yet (carry-forward from Prompt 1), so wrap in try/catch.
    let marketAgreed = null;
    try {
        const oddsRow = await env.ARCHIVE_DB.prepare(`
            SELECT * FROM odds_history WHERE game_id = ? ORDER BY snapshot_time DESC LIMIT 1
        `).bind(pick.game_id).first();
        if (oddsRow) {
            const spread = Number(oddsRow.spread ?? oddsRow.line ?? oddsRow.point_spread);
            if (!Number.isNaN(spread)) marketAgreed = Math.abs(spread) < 3.5;
        }
    } catch (_) { /* odds_history may not exist yet */ }

    // Running accuracy over the last 30 jinx rows + this one.
    let correct = pickCorrect === true ? 1 : 0;
    let total   = pickCorrect != null ? 1 : 0;
    try {
        const histRes = await env.ARCHIVE_DB.prepare(`
            SELECT value FROM analytics_output
            WHERE feature = 'jinx' AND date < ?
            ORDER BY date DESC LIMIT 30
        `).bind(date).all();
        for (const r of (histRes.results || [])) {
            try {
                const v = JSON.parse(r.value);
                if (v.pick_correct === true) correct++;
                if (v.pick_correct != null)  total++;
            } catch (_) { /* skip malformed history rows */ }
        }
    } catch (_) { /* fresh install — no history yet */ }

    const jinx       = pickCorrect === false && marketAgreed === true;
    const validation = pickCorrect === true  && marketAgreed === true;

    await writeAnalyticsOutput(env, {
        date,
        feature: 'jinx',
        sport: pick.sport || null,
        value: {
            game_id: pick.game_id,
            sport: pick.sport || null,
            pick_correct: pickCorrect,
            market_agreed: marketAgreed,
            final_margin: finalMargin,
            drama_peak: drama,
            had_extras: hasExtras,
            jinx,
            validation,
            running_accuracy: total > 0
                ? { correct, total, pct: Number((correct / total).toFixed(3)) }
                : null,
        },
        briefText: null,
    });
    return {};
}

// ── Phase 10: Circadian Pre-computation ────────────────────────────────────
// 10A: PREVIEW (today's slate, AI call) + 10B: LATE (reuses Morning Report
// prose, no AI call). Both stored in KV (24h TTL) and analytics_output.
//
// Budget note (per spec): on Mondays the engine could fire 6 AI calls
// (4 nightly + Phase 6B + Phase 6C) which exceeds the 5-call ceiling.
// Phase 10A gates itself on `aiCallsMade` already-spent; when the budget
// is exhausted it writes the fallback line.
const CIRCADIAN_KV_TTL_SECS = 60 * 60 * 24;
const AI_BUDGET_CEILING = 5;

async function runPhase10APreview(env, today, { aiCallsSoFar = 0 } = {}) {
    const relayBase = env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
    const settled = await Promise.allSettled(PHASE9_SPORTS.map(s =>
        fetch(`${relayBase}/v2/games?sport=${s}&date=${today}`, { cf: { cacheTtl: 60, cacheEverything: true } })
            .then(r => r.ok ? r.json() : null)
            .then(j => (j && Array.isArray(j.games)) ? j.games : [])));
    const candidates = [];
    for (const s of settled) {
        if (s.status === 'fulfilled' && Array.isArray(s.value)) candidates.push(...s.value);
    }
    const games = candidates;

    // Today's pick (Phase 9 wrote analytics_output(feature='field_pick',date=today))
    let pickRow = null;
    try {
        pickRow = await env.ARCHIVE_DB.prepare(`
            SELECT value, brief_text FROM analytics_output
            WHERE feature = 'field_pick' AND date = ? LIMIT 1
        `).bind(today).first();
    } catch (_) { /* analytics_output may be empty on first run */ }
    let pickSummary = 'no pick tonight';
    if (pickRow) {
        try {
            const v = JSON.parse(pickRow.value);
            if (v.type === 'pass') pickSummary = 'FIELD passed tonight';
            else pickSummary = `${v.home} vs ${v.away} (${v.sport || '?'}) — ${(v.reasons || []).join(', ') || 'top score'}`;
        } catch (_) { /* leave default */ }
    }

    if (games.length === 0) {
        const fallback = `Off night. Rest up — tomorrow's slate has more.`;
        try {
            if (env.FIELD_JOURNALISM) {
                await env.FIELD_JOURNALISM.put(`field:circadian:preview:${today}`, fallback, { expirationTtl: CIRCADIAN_KV_TTL_SECS });
            }
        } catch (e) { console.error('[ANALYTICS] circadian_preview KV put failed:', e.message); }
        await writeAnalyticsOutput(env, {
            date: today,
            feature: 'circadian_preview',
            sport: null,
            value: { games_today: 0, degraded: true },
            briefText: fallback,
        });
        return { aiCalls: 0 };
    }

    if (aiCallsSoFar >= AI_BUDGET_CEILING) {
        const fallback = `${games.length} games tonight. ${pickSummary}.`;
        try {
            if (env.FIELD_JOURNALISM) {
                await env.FIELD_JOURNALISM.put(`field:circadian:preview:${today}`, fallback, { expirationTtl: CIRCADIAN_KV_TTL_SECS });
            }
        } catch (e) { console.error('[ANALYTICS] circadian_preview KV put failed:', e.message); }
        await writeAnalyticsOutput(env, {
            date: today,
            feature: 'circadian_preview',
            sport: null,
            value: { games_today: games.length, budget_capped: true },
            briefText: fallback,
        });
        return { aiCalls: 0 };
    }

    const schedule = games
        .slice(0, 16)
        .map(g => {
            const start = g.commence || g.start || g.kickoff || g.startTime || '';
            const t = start ? new Date(start).toISOString().slice(11, 16) + ' UTC' : '';
            return `- ${g.sport || '?'}: ${g.home?.name || g.home} vs ${g.away?.name || g.away}${t ? ' @ ' + t : ''}`;
        })
        .join('\n');

    const prompt =
        `Write a 2-sentence preview of tonight's slate. V4 voice, WISE register ` +
        `leads. What should the viewer know before first pitch?\n\n` +
        `TONIGHT'S SCHEDULE:\n${schedule}\n\n` +
        `FIELD'S PICK: ${pickSummary}\n\n` +
        `Do NOT list all games. Highlight the 1-2 most interesting. ` +
        `The truth is the fun part. Let it be fun.`;
    const prose = await callProxy(prompt, { maxTokens: 120 });
    const briefText = prose || `${games.length} games on the slate. ${pickSummary}.`;

    try {
        if (env.FIELD_JOURNALISM) {
            await env.FIELD_JOURNALISM.put(`field:circadian:preview:${today}`, briefText, { expirationTtl: CIRCADIAN_KV_TTL_SECS });
        }
    } catch (e) { console.error('[ANALYTICS] circadian_preview KV put failed:', e.message); }

    await writeAnalyticsOutput(env, {
        date: today,
        feature: 'circadian_preview',
        sport: null,
        value: { games_today: games.length, word_count: briefText.split(/\s+/).filter(Boolean).length },
        briefText,
    });
    return { aiCalls: prose ? 1 : 0 };
}

// 10B: reuse Morning Report prose; no additional AI call.
async function runPhase10BLate(env, date) {
    const mr = await env.ARCHIVE_DB.prepare(`
        SELECT brief_text FROM analytics_output
        WHERE feature = 'morning_report' AND date = ? LIMIT 1
    `).bind(date).first();
    if (!mr || !mr.brief_text) {
        console.log(`[ANALYTICS] Phase 10B skipped: no morning_report for ${date}`);
        return { skipped: true };
    }
    try {
        if (env.FIELD_JOURNALISM) {
            await env.FIELD_JOURNALISM.put(`field:circadian:late:${date}`, mr.brief_text, { expirationTtl: CIRCADIAN_KV_TTL_SECS });
        }
    } catch (e) { console.error('[ANALYTICS] circadian_late KV put failed:', e.message); }
    await writeAnalyticsOutput(env, {
        date,
        feature: 'circadian_late',
        sport: null,
        value: { sourced_from: 'morning_report', word_count: mr.brief_text.split(/\s+/).filter(Boolean).length },
        briefText: mr.brief_text,
    });
    return {};
}

// Process one date end-to-end. Returns the status record for this date.
// ── Phase 12: Quality Alert ───────────────────────────────────────────────
// Daily quality snapshot: scans the 7-day briefs window, finds any types
// with avg_score < 240 (excellence threshold) or failure_pct > 20%, writes
// to analytics_output as feature='quality_alert'. The newspaper endpoint
// reads this row automatically — bundle.quality_alert is populated without
// manual intervention.
//
// Enrichment types excluded (wc_matchup, standings_snapshot, etc.) — they
// are reference data, not journalism prose. Golf excluded — structural
// ceiling, no context builder exists.
//
// Supersedes the inline Phase 8b alert (still present above; this writes
// the same analytics_output row later, so Phase 12 wins via INSERT OR
// REPLACE). Phase 8b cleanup is tracked as a separate carry-forward.
async function runPhase12QualityAlert(env, date) {
    if (!env.ARCHIVE_DB) return { skipped: true, reason: 'ARCHIVE_DB not bound' };
    const since = addDays(date, -6); // 7-day window ending at date

    const rows = await env.ARCHIVE_DB.prepare(`
        SELECT brief_type, sport,
               COUNT(*) as total,
               COUNT(quality_score) as scored,
               ROUND(AVG(quality_score), 1) as avg_score,
               MAX(quality_score) as max_score,
               SUM(CASE WHEN quality_score < 240 THEN 1 ELSE 0 END) as below_240,
               SUM(CASE WHEN quality_score >= 240 THEN 1 ELSE 0 END) as above_240
        FROM briefs WHERE date >= ? AND date <= ?
        GROUP BY brief_type, sport
        ORDER BY avg_score ASC NULLS LAST
    `).bind(since, date).all();

    const summary = rows.results || [];

    const ENRICHMENT = new Set([
        'wc_matchup', 'standings_snapshot', 'narrative_context',
        'enrichment', 'kv_harvest', 'wc_tab',
    ]);

    // Lower-tier English soccer leagues: ESPN-only, no BSD analytics layer.
    // No xG, shotmap, or momentum context available — structural quality
    // ceiling below 240. Excluded until FWP or equivalent analytics added.
    // Covers V2 slug keys, ESPN display names, and ESPN league slugs.
    const LOWER_SOCCER = new Set([
        'eflone', 'efltwo', 'natleague',
        'efl league one', 'efl league two', 'national league',
        'league one', 'league two',
        'eng.3', 'eng.4', 'eng.5',
    ]);

    const alerts = summary
        .filter(r => r.scored >= 3)
        .filter(r => {
            if (ENRICHMENT.has(r.brief_type)) return false;
            if (r.sport && LOWER_SOCCER.has(r.sport.toLowerCase())) return false;
            // Golf exclusion removed June 26 2026 — golf_leaderboard context
            // builder now exists (CONTEXT_SOURCES priority 3, 150 tokens).
            const failRate = r.below_240 / r.scored;
            return r.avg_score < 240 || failRate > 0.2;
        })
        .map(r => ({
            brief_type: r.brief_type,
            sport: r.sport || 'all',
            avg_score: r.avg_score,
            failure_pct: Math.round((r.below_240 / r.scored) * 100),
            above_240: r.above_240 || 0,
        }));

    const typesAbove240 = summary.filter(r => (r.above_240 || 0) > 0).length;
    const totalScored   = summary.reduce((n, r) => n + (r.scored || 0), 0);

    const value = {
        alert_count: alerts.length,
        alerts,
        since,
        through: date,
        types_above_240: typesAbove240,
        total_types: summary.filter(r => r.scored >= 3 && !ENRICHMENT.has(r.brief_type)).length,
        total_scored: totalScored,
        generated_at: new Date().toISOString(),
    };

    const briefText = alerts.length === 0
        ? `Quality OK — ${typesAbove240} type${typesAbove240 !== 1 ? 's' : ''} above 240/300 threshold`
        : `${alerts.length} quality alert${alerts.length !== 1 ? 's' : ''}: `
          + alerts.slice(0, 2).map(a => `${a.brief_type}/${a.sport} avg ${a.avg_score}`).join(', ')
          + (alerts.length > 2 ? ` +${alerts.length - 2} more` : '');

    await writeAnalyticsOutput(env, {
        date,
        feature: 'quality_alert',
        sport: null,
        value,
        briefText,
    });

    return { alerts: alerts.length, typesAbove240, totalScored, skipped: false };
}

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

        // Phase 4: Jinx Counter — grade yesterday's pick against the slate
        try {
            const r = await runPhase4Jinx(env, date, ctx);
            if (!r.skipped) featuresComputed++;
            phasesCompleted.push('phase4');
        } catch (e) {
            phasesFailed.push('phase4');
            errors.push(`phase4: ${e.message}`);
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
        const today = isoDate(new Date());
        try {
            const r = await runPhase9FieldPick(env, today);
            aiCallsMade += r.aiCalls;
            if (!r.skipped) featuresComputed++;
            phasesCompleted.push('phase9');
        } catch (e) {
            phasesFailed.push('phase9');
            errors.push(`phase9: ${e.message}`);
        }

        // Phase 10: Circadian Pre-computation (today's preview + late-mode)
        try {
            const r = await runPhase10APreview(env, today, { aiCallsSoFar: aiCallsMade });
            aiCallsMade += r.aiCalls;
            featuresComputed++;
            phasesCompleted.push('phase10a');
        } catch (e) {
            phasesFailed.push('phase10a');
            errors.push(`phase10a: ${e.message}`);
        }
        try {
            const r = await runPhase10BLate(env, date);
            if (!r.skipped) featuresComputed++;
            phasesCompleted.push('phase10b');
        } catch (e) {
            phasesFailed.push('phase10b');
            errors.push(`phase10b: ${e.message}`);
        }

        // Phase 7: Streak Board — hot/cold runs over last 14 days of briefs
        try {
            await runPhase7StreakBoard(env, date);
            featuresComputed++;
            phasesCompleted.push('phase7');
        } catch (e) {
            phasesFailed.push('phase7');
            errors.push(`phase7: ${e.message}`);
        }

        // Phase 8: Quality Feedback — snapshot per-sport p25/p50/p75
        try {
            const r = await runPhase8QualityFeedback(env, date);
            if (!r.skipped) featuresComputed++;
            phasesCompleted.push('phase8');
        } catch (e) {
            phasesFailed.push('phase8');
            errors.push(`phase8: ${e.message}`);
        }

        // Phase 6: Weekly features — only when processing Sunday's date
        // (i.e. the Monday-morning cron tick). UTCDay 0 = Sunday. Each of
        // 6A-D is independently try/catch wrapped.
        const processingDay = new Date(date + 'T00:00:00Z').getUTCDay();
        if (processingDay === 0) {
            try {
                const r = await runPhase6ASportOfWeek(env, date);
                if (!r.skipped) featuresComputed++;
                phasesCompleted.push('phase6a');
            } catch (e) { phasesFailed.push('phase6a'); errors.push(`phase6a: ${e.message}`); }
            try {
                const r = await runPhase6BCompositeBrief(env, date);
                aiCallsMade += r.aiCalls;
                if (!r.skipped) featuresComputed++;
                phasesCompleted.push('phase6b');
            } catch (e) { phasesFailed.push('phase6b'); errors.push(`phase6b: ${e.message}`); }
            try {
                const r = await runPhase6CContradiction(env, date);
                aiCallsMade += r.aiCalls;
                if (!r.skipped) featuresComputed++;
                phasesCompleted.push('phase6c');
            } catch (e) { phasesFailed.push('phase6c'); errors.push(`phase6c: ${e.message}`); }
            try {
                await runPhase6DBrokenRecord(env, date);
                featuresComputed++;
                phasesCompleted.push('phase6d');
            } catch (e) { phasesFailed.push('phase6d'); errors.push(`phase6d: ${e.message}`); }
        } else {
            console.log(`[ANALYTICS] Phase 6 skipped: ${date} is not Sunday (UTCDay=${processingDay})`);
        }

        // Phase 12: Quality Alert — daily quality snapshot to analytics_output.
        // Runs every day (outside the Sunday-only Phase 6 block) so the
        // newspaper's bundle.quality_alert is fresh on every cron tick.
        try {
            await runPhase12QualityAlert(env, date);
            featuresComputed++;
            phasesCompleted.push('phase12');
        } catch (e) { phasesFailed.push('phase12'); errors.push(`phase12: ${e.message}`); }

        // Touch unused locals — they exist for downstream prompts.
        void odds; void prevStars; void prevBriefs; void qualityScores;
    } finally {
        // Phase 11 ALWAYS runs — even if an earlier phase throws past its
        // try/catch, the engine still writes an observable health record.
        // Push phase11 BEFORE serializing so the stored phases_completed
        // reflects the full intended phase sequence. Phase 11 is the write
        // itself, so by the time the array is durable the phase is done.
        phasesCompleted.push('phase11');
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
