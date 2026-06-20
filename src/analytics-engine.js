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

const PHASE_NAMES = ['phase0', 'phase1', 'phase2', 'phase11'];
const STATUS_KV_KEY = 'field:analytics:status';
const SELF_HEAL_CAP = 7;

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
        try {
            const allGames = ctx
                ? [...(ctx.games?.regular || []), ...(ctx.games?.postseason || [])]
                : [];
            const stars = computeNightStars(allGames);
            await writeAnalyticsOutput(env, {
                date,
                feature: 'night_stars',
                sport:   null,
                value:   stars,
                briefText: null,
            });
            featuresComputed++;
            phasesCompleted.push('phase2');
        } catch (e) {
            phasesFailed.push('phase2');
            errors.push(`phase2: ${e.message}`);
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
