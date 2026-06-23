// src/context-assembler.js
// Context Assembler — priority-ordered source registry for journalism prompts.
//
// Replaces hardcoded R2 context plumbing with a generic, budget-gated,
// fail-independent pattern. Each registered source is a builder that
// takes (env, game) and returns either a context block (string) or ''.
// The assembler iterates by priority, calling each applicable builder,
// summing estimated tokens against the budget, and concatenating the
// returned blocks. A failed builder is logged and ignored — never
// blocks the cron (Rule 5).
//
// ADR-002 / Rule 47: context blocks deliver FACTS to the LLM. The LLM
// makes editorial decisions. No drama scores, no interest verdicts.
// Same pattern as the existing buildFinalsContextBlock + buildWCTeamContextBlock.

import { computeOddsStory } from './odds-story.js';
import { resolveTeamKey }   from './identity-resolver.js';

// ── R2 helpers ───────────────────────────────────────────────────────────
// Reads a JSON file from the FIELD_DATA R2 bucket. Returns null on any
// failure (missing file, parse failure, binding absent) — callers should
// treat null as "no context available" and return ''.
async function r2Json(env, key) {
    if (!env || !env.FIELD_DATA) return null;
    try {
        const obj = await env.FIELD_DATA.get(key);
        if (!obj) return null;
        return JSON.parse(await obj.text());
    } catch (_) { return null; }
}

function estimateTokens(text) {
    return Math.ceil((text || '').length / 4);
}

// Normalize a team abbreviation so R2 key lookups are case-stable. Most R2
// writers store uppercase abbrevs (LAD, NYY, BOS); incoming abbrs from
// ESPN are typically uppercase already but defensive normalization is cheap.
function _abbr(s) {
    return String(s || '').trim().toUpperCase();
}

// ── Team name → abbreviation resolver ────────────────────────────────────
// The backfill path stores full display names in D1 (e.g. "New York Yankees").
// R2 data keys by 3-letter abbreviation. This resolver maps common display
// names to abbreviations for MLB, NHL, and NBA.
const _NAME_TO_ABBR = {
    // MLB
    'yankees': 'NYY', 'new york yankees': 'NYY', 'mets': 'NYM', 'new york mets': 'NYM',
    'dodgers': 'LAD', 'los angeles dodgers': 'LAD', 'angels': 'LAA', 'los angeles angels': 'LAA',
    'red sox': 'BOS', 'boston red sox': 'BOS', 'astros': 'HOU', 'houston astros': 'HOU',
    'phillies': 'PHI', 'philadelphia phillies': 'PHI', 'braves': 'ATL', 'atlanta braves': 'ATL',
    'padres': 'SD', 'san diego padres': 'SD', 'giants': 'SF', 'san francisco giants': 'SF',
    'cubs': 'CHC', 'chicago cubs': 'CHC', 'white sox': 'CWS', 'chicago white sox': 'CWS',
    'cardinals': 'STL', 'st. louis cardinals': 'STL', 'brewers': 'MIL', 'milwaukee brewers': 'MIL',
    'reds': 'CIN', 'cincinnati reds': 'CIN', 'pirates': 'PIT', 'pittsburgh pirates': 'PIT',
    'guardians': 'CLE', 'cleveland guardians': 'CLE', 'tigers': 'DET', 'detroit tigers': 'DET',
    'twins': 'MIN', 'minnesota twins': 'MIN', 'royals': 'KC', 'kansas city royals': 'KC',
    'rangers': 'TEX', 'texas rangers': 'TEX', 'mariners': 'SEA', 'seattle mariners': 'SEA',
    'athletics': 'OAK', 'oakland athletics': 'OAK', 'rays': 'TB', 'tampa bay rays': 'TB',
    'blue jays': 'TOR', 'toronto blue jays': 'TOR', 'orioles': 'BAL', 'baltimore orioles': 'BAL',
    'nationals': 'WSH', 'washington nationals': 'WSH', 'marlins': 'MIA', 'miami marlins': 'MIA',
    'rockies': 'COL', 'colorado rockies': 'COL', 'diamondbacks': 'ARI', 'arizona diamondbacks': 'ARI',
    'd-backs': 'ARI',
    // NHL
    'hurricanes': 'CAR', 'carolina hurricanes': 'CAR', 'golden knights': 'VGK', 'vegas golden knights': 'VGK',
    'bruins': 'BOS', 'boston bruins': 'BOS', 'penguins': 'PIT', 'pittsburgh penguins': 'PIT',
    'oilers': 'EDM', 'edmonton oilers': 'EDM', 'panthers': 'FLA', 'florida panthers': 'FLA',
    'lightning': 'TBL', 'tampa bay lightning': 'TBL', 'capitals': 'WSH', 'washington capitals': 'WSH',
    'maple leafs': 'TOR', 'toronto maple leafs': 'TOR', 'canadiens': 'MTL', 'montreal canadiens': 'MTL',
    'senators': 'OTT', 'ottawa senators': 'OTT', 'sabres': 'BUF', 'buffalo sabres': 'BUF',
    'islanders': 'NYI', 'new york islanders': 'NYI', 'devils': 'NJD', 'new jersey devils': 'NJD',
    'flyers': 'PHI', 'philadelphia flyers': 'PHI', 'blue jackets': 'CBJ', 'columbus blue jackets': 'CBJ',
    'red wings': 'DET', 'detroit red wings': 'DET', 'blackhawks': 'CHI', 'chicago blackhawks': 'CHI',
    'predators': 'NSH', 'nashville predators': 'NSH', 'blues': 'STL', 'st. louis blues': 'STL',
    'jets': 'WPG', 'winnipeg jets': 'WPG', 'wild': 'MIN', 'minnesota wild': 'MIN',
    'avalanche': 'COL', 'colorado avalanche': 'COL', 'stars': 'DAL', 'dallas stars': 'DAL',
    'kraken': 'SEA', 'seattle kraken': 'SEA', 'sharks': 'SJS', 'san jose sharks': 'SJS',
    'flames': 'CGY', 'calgary flames': 'CGY', 'canucks': 'VAN', 'vancouver canucks': 'VAN',
    'ducks': 'ANA', 'anaheim ducks': 'ANA', 'kings': 'LAK', 'los angeles kings': 'LAK',
    // NBA
    'celtics': 'BOS', 'boston celtics': 'BOS', 'lakers': 'LAL', 'los angeles lakers': 'LAL',
    'knicks': 'NYK', 'new york knicks': 'NYK', 'nets': 'BKN', 'brooklyn nets': 'BKN',
    'warriors': 'GSW', 'golden state warriors': 'GSW', 'clippers': 'LAC', 'la clippers': 'LAC',
    'nuggets': 'DEN', 'denver nuggets': 'DEN', 'heat': 'MIA', 'miami heat': 'MIA',
    'bucks': 'MIL', 'milwaukee bucks': 'MIL', 'thunder': 'OKC', 'oklahoma city thunder': 'OKC',
    'sixers': 'PHI', 'philadelphia 76ers': 'PHI', '76ers': 'PHI',
    'suns': 'PHX', 'phoenix suns': 'PHX', 'spurs': 'SAS', 'san antonio spurs': 'SAS',
    'raptors': 'TOR', 'toronto raptors': 'TOR', 'bulls': 'CHI', 'chicago bulls': 'CHI',
    'cavaliers': 'CLE', 'cleveland cavaliers': 'CLE', 'cavs': 'CLE',
    'mavericks': 'DAL', 'dallas mavericks': 'DAL', 'mavs': 'DAL',
    'rockets': 'HOU', 'houston rockets': 'HOU', 'pacers': 'IND', 'indiana pacers': 'IND',
    'grizzlies': 'MEM', 'memphis grizzlies': 'MEM', 'timberwolves': 'MIN', 'minnesota timberwolves': 'MIN',
    'pelicans': 'NOP', 'new orleans pelicans': 'NOP', 'magic': 'ORL', 'orlando magic': 'ORL',
    'trail blazers': 'POR', 'portland trail blazers': 'POR', 'blazers': 'POR',
    'kings': 'SAC', 'sacramento kings': 'SAC', 'jazz': 'UTA', 'utah jazz': 'UTA',
    'hawks': 'ATL', 'atlanta hawks': 'ATL', 'hornets': 'CHA', 'charlotte hornets': 'CHA',
    'pistons': 'DET', 'detroit pistons': 'DET', 'wizards': 'WAS', 'washington wizards': 'WAS',
    // NFL
    'chiefs': 'KC', 'kansas city chiefs': 'KC', 'eagles': 'PHI', 'philadelphia eagles': 'PHI',
    'bills': 'BUF', 'buffalo bills': 'BUF', 'dolphins': 'MIA', 'miami dolphins': 'MIA',
    'patriots': 'NE', 'new england patriots': 'NE', 'jets': 'NYJ', 'new york jets': 'NYJ',
    'ravens': 'BAL', 'baltimore ravens': 'BAL', 'bengals': 'CIN', 'cincinnati bengals': 'CIN',
    'browns': 'CLE', 'cleveland browns': 'CLE', 'steelers': 'PIT', 'pittsburgh steelers': 'PIT',
    'texans': 'HOU', 'houston texans': 'HOU', 'colts': 'IND', 'indianapolis colts': 'IND',
    'jaguars': 'JAX', 'jacksonville jaguars': 'JAX', 'titans': 'TEN', 'tennessee titans': 'TEN',
    'broncos': 'DEN', 'denver broncos': 'DEN', 'chargers': 'LAC', 'los angeles chargers': 'LAC',
    'raiders': 'LV', 'las vegas raiders': 'LV', 'cowboys': 'DAL', 'dallas cowboys': 'DAL',
    'commanders': 'WAS', 'washington commanders': 'WAS', 'giants': 'NYG', 'new york giants': 'NYG',
    '49ers': 'SF', 'san francisco 49ers': 'SF', 'niners': 'SF',
    'seahawks': 'SEA', 'seattle seahawks': 'SEA', 'cardinals': 'ARI', 'arizona cardinals': 'ARI',
    'rams': 'LAR', 'los angeles rams': 'LAR', 'bears': 'CHI', 'chicago bears': 'CHI',
    'lions': 'DET', 'detroit lions': 'DET', 'packers': 'GB', 'green bay packers': 'GB',
    'vikings': 'MIN', 'minnesota vikings': 'MIN', 'falcons': 'ATL', 'atlanta falcons': 'ATL',
    'panthers': 'CAR', 'carolina panthers': 'CAR', 'saints': 'NO', 'new orleans saints': 'NO',
    'buccaneers': 'TB', 'tampa bay buccaneers': 'TB', 'bucs': 'TB',
};

function resolveAbbr(teamName) {
    if (!teamName) return '';
    const t = String(teamName).trim();
    // Already an abbreviation (2-3 uppercase letters)?
    if (/^[A-Z]{2,4}$/.test(t)) return t;
    const lower = t.toLowerCase();
    if (_NAME_TO_ABBR[lower]) return _NAME_TO_ABBR[lower];
    // Try last word (e.g. "New York Yankees" → "yankees")
    const lastWord = lower.split(/\s+/).pop();
    if (lastWord && _NAME_TO_ABBR[lastWord]) return _NAME_TO_ABBR[lastWord];
    return '';
}

// ── MLB: Savant context ─────────────────────────────────────────────────
// Team ABS grades + top pitchers from pitch_arsenals (filtered by team).
// pitch_arsenals entries have { team: "NYY", pitches: [...] } — we filter
// by team abbreviation to surface the top 2 pitchers per team without
// needing a separate roster join.
async function buildSavantContext(env, game) {
    const ha = _abbr(game.homeAbbr) || resolveAbbr(game.home);
    const aa = _abbr(game.awayAbbr) || resolveAbbr(game.away);
    if (!ha && !aa) return '';

    // Savant data lives in the GitHub outbox (written by mlb-weekly-update.py),
    // NOT in R2. Fetch from raw.githubusercontent.com with a short cache.
    const ghBase = 'https://raw.githubusercontent.com/jeffunglesbee-create/jubilant-bassoon/main/outbox/mlb';
    const fetchGh = async (file) => {
        try {
            const r = await fetch(`${ghBase}/${file}`, { cf: { cacheTtl: 900 } });
            if (!r.ok) return null;
            return await r.json();
        } catch (_) { return null; }
    };

    const [teamAbs, arsenals] = await Promise.all([
        fetchGh('team_abs.json'),
        fetchGh('pitch_arsenals.json'),
    ]);

    const lines = ['', '[SAVANT CONTEXT]'];
    let hasContent = false;

    // Team ABS grades
    if (teamAbs?.data) {
        for (const abbr of [ha, aa].filter(Boolean)) {
            const t = teamAbs.data[abbr];
            if (t) {
                lines.push(`${abbr} ABS challenge: grade ${t.grade} ` +
                    `(${t.battingWon}/${t.battingAttempted} overturned, ` +
                    `${(t.battingRate * 100).toFixed(1)}% success).`);
                hasContent = true;
            }
        }
    }

    // Pitcher arsenals — top 2 pitchers per team by primary pitch whiff rate
    if (arsenals?.data) {
        for (const abbr of [ha, aa].filter(Boolean)) {
            const teamPitchers = Object.entries(arsenals.data)
                .filter(([_, v]) => _abbr(v.team) === abbr && v.pitches?.length)
                .map(([name, v]) => {
                    const best = v.pitches.reduce((a, b) => (b.whiffRate || 0) > (a.whiffRate || 0) ? b : a);
                    return { name, best, pitchCount: v.pitches.length };
                })
                .sort((a, b) => (b.best.whiffRate || 0) - (a.best.whiffRate || 0))
                .slice(0, 2);

            for (const p of teamPitchers) {
                const w = p.best.whiffRate ? `${(p.best.whiffRate * 100).toFixed(1)}% whiff` : '';
                const v = p.best.vel ? `${p.best.vel} mph` : '';
                const desc = [p.best.type, v, w].filter(Boolean).join(', ');
                lines.push(`${abbr} pitcher ${p.name}: best pitch ${desc}.`);
                hasContent = true;
            }
        }
    }

    return hasContent ? lines.join('\n') : '';
}

// ── NHL: Series special teams ────────────────────────────────────────────
// Series-adjusted PP%/PK% from the active playoff series file. Writer
// uses pre-formatted ppLabel / pkLabel strings; we surface those
// verbatim so the LLM gets the same phrasing the cron pipeline uses.
async function buildNHLSeriesContext(env, game) {
    const ha = _abbr(game.homeAbbr) || resolveAbbr(game.home);
    const aa = _abbr(game.awayAbbr) || resolveAbbr(game.away);
    if (!ha && !aa) return '';
    // The relay only ships SCF-series stats today; widen if more series
    // land in R2. Try the most-likely active series first.
    const candidates = ['scf-2026', 'ecf-2026', 'wcf-2026'];
    let blob = null;
    for (const series of candidates) {
        blob = await r2Json(env, `nhl/${series}/series-stats.json`);
        if (blob?.teams && (blob.teams[ha] || blob.teams[aa])) break;
        blob = null;
    }
    if (!blob?.teams) return '';
    const h = blob.teams[ha];
    const a = blob.teams[aa];
    if (!h && !a) return '';
    const lines = ['', '[NHL SERIES CONTEXT]'];
    if (h) {
        if (h.ppLabel) lines.push(`${ha} ${h.ppLabel}.`);
        if (h.pkLabel) lines.push(`${ha} ${h.pkLabel}.`);
        if (h.pdoLabel) lines.push(`${ha} ${h.pdoLabel}.`);
    }
    if (a) {
        if (a.ppLabel) lines.push(`${aa} ${a.ppLabel}.`);
        if (a.pkLabel) lines.push(`${aa} ${a.pkLabel}.`);
        if (a.pdoLabel) lines.push(`${aa} ${a.pdoLabel}.`);
    }
    return lines.length > 2 ? lines.join('\n') : '';
}

// ── NBA: Clutch DRTG ─────────────────────────────────────────────────────
// Tries playoff stats first (more relevant in May–July), falls back to
// regular-season clutch when playoff data is empty / both teams missing.
// Flags a >5 DRTG gap as "clutch mismatch" — factual observation, not
// an interest verdict.
async function buildNBAClutchContext(env, game) {
    const ha = _abbr(game.homeAbbr) || resolveAbbr(game.home);
    const aa = _abbr(game.awayAbbr) || resolveAbbr(game.away);
    if (!ha && !aa) return '';
    let blob = await r2Json(env, 'nba/2026/clutch_playoffs.json');
    if (!blob?.teams || (!blob.teams[ha] && !blob.teams[aa])) {
        blob = await r2Json(env, 'nba/2026/clutch_regular.json');
    }
    if (!blob?.teams) return '';
    const h = blob.teams[ha];
    const a = blob.teams[aa];
    if (!h && !a) return '';
    const lines = ['', '[NBA CLUTCH CONTEXT]'];
    if (h) {
        lines.push(`${ha} clutch: ORTG ${h.clutchOrtg ?? '?'} / ` +
            `DRTG ${h.clutchDrtg ?? '?'} / NetRtg ${h.clutchNetRtg ?? '?'}.`);
    }
    if (a) {
        lines.push(`${aa} clutch: ORTG ${a.clutchOrtg ?? '?'} / ` +
            `DRTG ${a.clutchDrtg ?? '?'} / NetRtg ${a.clutchNetRtg ?? '?'}.`);
    }
    if (h && a &&
        Number.isFinite(h.clutchDrtg) && Number.isFinite(a.clutchDrtg) &&
        Math.abs(h.clutchDrtg - a.clutchDrtg) > 5) {
        const tighter = h.clutchDrtg < a.clutchDrtg ? ha : aa;
        lines.push(`Clutch DRTG mismatch (${Math.abs(h.clutchDrtg - a.clutchDrtg).toFixed(1)} gap) — ${tighter} tighter.`);
    }
    return lines.join('\n');
}

// ── Soccer xG via ESPN Core API (replaces FBref pipeline) ────────────────
// Requires game.espnLeague (slug like "fifa.world") + game.eventId. Calls
// the relay's /soccer/xg route which proxies sports.core.api.espn.com.
// Returns '' when the feed lacks xG (e.g. Bundesliga ger.1 — structural
// absence per CC-CMD 2026-06-23) or when the game object doesn't carry
// the ESPN identifiers (backfill / per-game-route paths). Never throws.
async function buildSoccerXGContext(env, game) {
    const league  = game.espnLeague;
    const eventId = game.eventId;
    if (!league || !eventId) return '';
    const base = env?.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
    try {
        const resp = await fetch(`${base}/soccer/xg?league=${encodeURIComponent(league)}&event=${encodeURIComponent(eventId)}`);
        if (!resp.ok) return '';
        const d = await resp.json();
        if (!d?._hasXG) return '';
        const h = d.home, a = d.away;
        const lines = ['', '[SOCCER XG CONTEXT]'];
        const f2 = (v) => (v != null && Number.isFinite(v)) ? v.toFixed(2) : null;
        const f1 = (v) => (v != null && Number.isFinite(v)) ? v.toFixed(1) : null;

        const hxg  = f2(h.expectedGoals);
        const axg  = f2(a.expectedGoals);
        const hnp  = f2(h.expectedGoalsNonPenalty);
        const anp  = f2(a.expectedGoalsNonPenalty);
        if (hxg && axg) {
            lines.push(
                `xG: ${h.name} ${hxg}${hnp ? ` (${hnp} npxG)` : ''} ` +
                `vs ${a.name} ${axg}${anp ? ` (${anp} npxG)` : ''}`
            );
        }
        const hxa = f2(h.expectedAssists), axa = f2(a.expectedAssists);
        if (hxa && axa) lines.push(`xA: ${h.name} ${hxa} — ${a.name} ${axa}`);
        const hpp = f1(h.ppda), app = f1(a.ppda);
        if (hpp && app) lines.push(`PPDA: ${h.name} ${hpp} — ${a.name} ${app}`);
        if (h.bigChanceCreated != null && a.bigChanceCreated != null) {
            lines.push(
                `Big chances: ${h.name} created ${h.bigChanceCreated} missed ${h.bigChanceMissed ?? '-'} ` +
                `— ${a.name} created ${a.bigChanceCreated} missed ${a.bigChanceMissed ?? '-'}`
            );
        }
        return lines.length > 2 ? lines.join('\n') : '';
    } catch (_) {
        return '';
    }
}

// ── Odds story builder ──────────────────────────────────────────────────
// Looks up today's archive row for THIS game (matched by resolved team
// keys, same pattern as snapshotCronOdds at index.js:4001) and returns a
// pre-computed line-movement narrative. Returns '' when either opening or
// closing odds are missing, or when movement is below significance.
async function buildOddsStoryContext(env, game) {
    if (!env?.ARCHIVE_DB || !game?.home || !game?.away) return '';
    const today = new Date().toISOString().slice(0, 10);
    const homeKey = resolveTeamKey(game.home);
    const awayKey = resolveTeamKey(game.away);
    if (!homeKey || !awayKey) return '';

    for (const table of ['regular_season_games', 'postseason_games']) {
        try {
            const rows = await env.ARCHIVE_DB.prepare(
                `SELECT home, away, opening_odds, closing_odds FROM ${table}
                 WHERE date = ? AND opening_odds IS NOT NULL AND closing_odds IS NOT NULL`
            ).bind(today).all();
            for (const row of (rows.results || [])) {
                if (resolveTeamKey(row.home) !== homeKey) continue;
                if (resolveTeamKey(row.away) !== awayKey) continue;
                const story = computeOddsStory(row.opening_odds, row.closing_odds);
                if (story) return story;
            }
        } catch (_) { /* table absent or query fail — silent per Rule 5 */ }
    }
    return '';
}

// ── Source registry ─────────────────────────────────────────────────────
// Lower priority numbers run first. Budget is per-source soft cap; the
// assembler sums against the overall totalBudget and stops when exhausted.
const CONTEXT_SOURCES = [
    { id: 'odds_story',   priority: 5, budget: 100, builder: buildOddsStoryContext,
      sports: ['mlb', 'nba', 'nhl', 'nfl', 'wnba', 'epl', 'mls',
               'wc26', 'laliga', 'seriea', 'bundesliga', 'ligue1'] },
    { id: 'savant',       priority: 7, budget: 400, builder: buildSavantContext,        sports: ['mlb'] },
    { id: 'nhl_series',   priority: 7, budget: 150, builder: buildNHLSeriesContext,     sports: ['nhl'] },
    { id: 'nba_clutch',   priority: 7, budget: 120, builder: buildNBAClutchContext,     sports: ['nba'] },
    { id: 'soccer_xg',    priority: 7, budget: 150, builder: buildSoccerXGContext,
      sports: ['epl', 'mls', 'ucl', 'wc26', 'laliga', 'seriea', 'bundesliga', 'ligue1', 'soccer'] },
];

// Per-source token budget allowance — the spec sets soft per-source caps,
// but the assembler is a simple sum against totalBudget. We honour the
// per-source cap by skipping a block if it alone exceeds source.budget.
const _SPORT_NORMALIZE = {
    'fifa world cup 2026': 'wc26',
    'fifa world cup': 'wc26',
    'world cup': 'wc26',
};
async function assembleContext(env, game, totalBudget = 1500) {
    if (!env || !game) return '';
    const _raw = String(game.sport || '').toLowerCase();
    const sport = _SPORT_NORMALIZE[_raw] || _raw;
    const applicable = CONTEXT_SOURCES.filter(s =>
        !s.sports || s.sports.includes(sport));
    applicable.sort((a, b) => a.priority - b.priority);

    let remaining = totalBudget;
    const blocks = [];
    for (const source of applicable) {
        if (remaining <= 0) break;
        try {
            const block = await source.builder(env, game);
            if (!block) continue;
            const tokens = estimateTokens(block);
            // Per-source ceiling: if a builder over-produces, skip rather
            // than starve subsequent sources of the overall budget.
            if (source.budget && tokens > source.budget * 1.5) continue;
            if (tokens > remaining + 50) continue;
            blocks.push(block);
            remaining -= tokens;
        } catch (e) {
            console.error(`[context-assembler] source ${source.id} failed:`, e.message);
        }
    }
    return blocks.join('\n');
}

export {
    assembleContext,
    r2Json,
    resolveAbbr,
    // Builders + helpers exported so the test surface can exercise them
    // independently without a full assembler run.
    buildSavantContext,
    buildNHLSeriesContext,
    buildNBAClutchContext,
    buildSoccerXGContext,
};
