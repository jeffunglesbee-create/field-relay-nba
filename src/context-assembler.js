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
import { resolveTeamKey, resolveEntity } from './identity-resolver.js';

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

    // Pitcher arsenals — confirmed starter first (game.probableHome/Away from ESPN),
    // fallback to top 2 by whiff rate if starter unavailable or not in Savant data.
    // ESPN probable-pitcher feed is inconsistently populated (see existing comment
    // above) — keep the fallback for every team where the starter path doesn't resolve.
    if (arsenals?.data) {
        for (const [probableName, abbr] of [
            [game.probableHome, ha],
            [game.probableAway, aa],
        ]) {
            if (!abbr) continue;

            let usedProbable = false;
            if (probableName) {
                const key = resolveEntity('player', probableName);
                const entry = Object.entries(arsenals.data)
                    .find(([name, v]) => resolveEntity('player', name) === key && _abbr(v.team) === abbr);
                if (entry) {
                    const [name, v] = entry;
                    if (v.pitches?.length) {
                        const best = v.pitches.reduce((a, b) => (b.whiffRate || 0) > (a.whiffRate || 0) ? b : a);
                        const w = best.whiffRate ? `${(best.whiffRate * 100).toFixed(1)}% whiff` : '';
                        const vel = best.vel ? `${best.vel} mph` : '';
                        const desc = [best.type, vel, w].filter(Boolean).join(', ');
                        lines.push(`${abbr} starter ${name}: best pitch ${desc}.`);
                        hasContent = true;
                        usedProbable = true;
                    }
                }
            }

            if (!usedProbable) {
                // Fallback: top 2 pitchers for this team by primary pitch whiff rate
                const teamPitchers = Object.entries(arsenals.data)
                    .filter(([_, v]) => _abbr(v.team) === abbr && v.pitches?.length)
                    .map(([name, v]) => {
                        const best = v.pitches.reduce((a, b) => (b.whiffRate || 0) > (a.whiffRate || 0) ? b : a);
                        return { name, best };
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
    // Derive league slug when game.espnLeague is absent (backfill path).
    // Maps unnormalized D1 sport strings → ESPN API league slugs.
    // Live cron path always passes game.espnLeague explicitly — unchanged.
    const _SOCCER_SPORT_TO_LEAGUE = {
        'wc26': 'fifa.world', 'soccer': 'fifa.world',
        'fifa world cup 2026': 'fifa.world',
        'fifa world cup': 'fifa.world',
        'world cup': 'fifa.world',
        'epl': 'eng.1',   'english premier league': 'eng.1',
        'mls': 'usa.1',   'major league soccer': 'usa.1',
        'ucl': 'uefa.champions',
        'laliga': 'esp.1', 'la liga': 'esp.1',
        'seriea': 'ita.1', 'serie a': 'ita.1',
        'bundesliga': 'ger.1',
        'ligue1': 'fra.1', 'ligue 1': 'fra.1',
    };
    const _sportRaw = (game.sport || '').toLowerCase();
    const league  = game.espnLeague
        || _SOCCER_SPORT_TO_LEAGUE[_sportRaw]
        || null;
    const eventId = game.eventId
        || game.sourceId
        || game.source_id
        || game.espnEventId
        || null;
    if (!league || !eventId) return '';
    const base = env?.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
    try {
        const resp = await fetch(`${base}/soccer/xg?league=${encodeURIComponent(league)}&event=${encodeURIComponent(eventId)}`);
        if (!resp.ok) return '';
        const d = await resp.json();
        // Gate widened 2026-06-30: dual-source CC-CMD Task 1 widened the RELAY
        // ROUTE to return _hasMatchStats alongside _hasXG, but this consumer's
        // gate was never updated to match — MLS (and any league without xG)
        // still got '' here despite the route having real data. Confirmed via
        // live check before this fix: _hasXG false, _hasMatchStats true, this
        // function still returned ''. Closing the gap the dual-source CC-CMD's
        // own background section described as the goal but didn't finish.
        if (!d?._hasXG && !d?._hasMatchStats) return '';
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
        // Match-stat fallback — fires when xG-specific fields above produced
        // nothing (MLS and any other league without xG) but the route's
        // MATCH_FIELDS extraction (dual-source Task 1) has real data.
        if (lines.length <= 2 && h.possessionPct != null && a.possessionPct != null) {
            lines.push(
                `Possession: ${h.name} ${h.possessionPct}% — ${a.name} ${a.possessionPct}%`
            );
            if (h.totalShots != null && a.totalShots != null) {
                lines.push(
                    `Shots: ${h.name} ${h.totalShots}${h.shotsOnTarget != null ? ` (${h.shotsOnTarget} on target)` : ''} ` +
                    `— ${a.name} ${a.totalShots}${a.shotsOnTarget != null ? ` (${a.shotsOnTarget} on target)` : ''}`
                );
            }
            if (h.totalPasses != null && a.totalPasses != null) {
                const hpct = h.passPct != null ? ` (${(h.passPct * 100).toFixed(0)}%)` : '';
                const apct = a.passPct != null ? ` (${(a.passPct * 100).toFixed(0)}%)` : '';
                lines.push(`Passes: ${h.name} ${h.totalPasses}${hpct} — ${a.name} ${a.totalPasses}${apct}`);
            }
            if ((h.yellowCards || h.redCards || a.yellowCards || a.redCards)) {
                lines.push(
                    `Cards: ${h.name} ${h.yellowCards ?? 0}Y${h.redCards ? `/${h.redCards}R` : ''} ` +
                    `— ${a.name} ${a.yellowCards ?? 0}Y${a.redCards ? `/${a.redCards}R` : ''}`
                );
            }
        }
        return lines.length > 2 ? lines.join('\n') : '';
    } catch (_) {
        return '';
    }
}

// ── Soccer season-form via stats-api club aggregates ──────────────────────
// Added 2026-06-30 (soccer-stats-dual-source CC-CMD). Distinct from
// buildSoccerXGContext: that's per-match, this is season-to-date. Needs
// game.homeTeamId/awayTeamId in stats-api's MLS-CLU-xxxxxx format — NOT the
// same ID space as ESPN's numeric competitor ids. If the game object doesn't
// carry stats-api club IDs, this returns '' silently (do not attempt
// name-matching here — that's a separate identity-resolver concern, see
// resolveTeamKey). KNOWN GAP: game.mlsHomeTeamId/mlsAwayTeamId almost
// certainly don't exist anywhere yet — this returns '' for every game until
// something (likely identity-resolver.js, mapping team name -> MLS-CLU-xxxxxx)
// populates them onto the game object. Documented, not solved here — needs
// its own spec.
async function buildSoccerSeasonFormContext(env, game) {
    const sportRaw = (game.sport || '').toLowerCase();
    if (sportRaw !== 'mls' && sportRaw !== 'major league soccer') return '';
    const homeId = game.mlsHomeTeamId || game.homeStatsApiId;
    const awayId = game.mlsAwayTeamId || game.awayStatsApiId;
    if (!homeId || !awayId) return '';
    const base = env?.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
    try {
        const [hResp, aResp] = await Promise.all([
            fetch(`${base}/soccer/season-form?team_id=${encodeURIComponent(homeId)}`),
            fetch(`${base}/soccer/season-form?team_id=${encodeURIComponent(awayId)}`),
        ]);
        if (!hResp.ok || !aResp.ok) return '';
        const h = await hResp.json(), a = await aResp.json();
        if (!h._hasForm || !a._hasForm) return '';
        const lines = ['', '[SOCCER SEASON FORM]'];
        lines.push(
            `${h.team_name} season: ${h.matches_played}MP, xG ${h.xG?.toFixed?.(1) ?? h.xG}, ` +
            `${(h.possession_ratio * 100).toFixed(0)}% poss avg`
        );
        lines.push(
            `${a.team_name} season: ${a.matches_played}MP, xG ${a.xG?.toFixed?.(1) ?? a.xG}, ` +
            `${(a.possession_ratio * 100).toFixed(0)}% poss avg`
        );
        return lines.join('\n');
    } catch (_) { return ''; }
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
                if (story) {
                    // Directive travels with the data — every prompt template gets it
                    // without per-template rule additions. Absent odds story → no instruction.
                    // Exemplar target: "The line opened X and drifted to Y, which tells you
                    // something about where the money was moving." (FIELD_VOICE_REGISTER Exemplar A)
                    const data = story.replace('[ODDS STORY] ', '');
                    return `[ODDS STORY — use as a supporting beat: prose this movement naturally ("the line drifted X pts toward Y, which tells you something about where the money moved"), don't lead with it, don't quote this block directly]\n${data}`;
                }
            }
        } catch (_) { /* table absent or query fail — silent per Rule 5 */ }
    }
    return '';
}

// ── buildESPNSummaryContext — per-game leaders from ESPN Summary API ─────
// Fetches /espn-summary/sports/{sport}/{league}/summary?event={sourceId} via
// the relay's existing ESPN Summary proxy route (index.js:8432). Extracts
// the top performer per leader category and emits an [ESPN GAME LEADERS]
// block so the LLM has named anchors for Dims 1/4/6.
// Returns '' on any failure (Rule 5) — missing source_id, ESPN 404, no
// leaders array yet (live games before stats populate).
const _ESPN_SPORT_SLUG = {
    mlb:        'sports/baseball/mlb',
    nba:        'sports/basketball/nba',
    wnba:       'sports/basketball/wnba',
    nhl:        'sports/hockey/nhl',
    wc26:       'sports/soccer/fifa.world',
    soccer:     'sports/soccer/fifa.world',
    // Generic ESPN sport names sent by GameDO
    baseball:   'sports/baseball/mlb',
    basketball: 'sports/basketball/nba',
    hockey:     'sports/hockey/nhl',
    golf:       'sports/golf/pga',
    pga:        'sports/golf/pga',
};

async function buildESPNSummaryContext(env, game) {
    const sourceId = game.sourceId || game.source_id || game.espnEventId || game.eventId;
    if (!sourceId) return '';

    // Normalize unnormalized D1 sport strings (e.g. "FIFA World Cup 2026")
    // to the keys used in _ESPN_SPORT_SLUG (e.g. "wc26"). assembleContext
    // normalizes for registry filtering but passes the original game object
    // to builders — builders must normalize themselves.
    const _SUMMARY_SPORT_NORMALIZE = {
        // ── World Cup (slug and display name variants) ──────────────────────
        'fifaworldcup2026': 'wc26', 'fifaworldcup': 'wc26',
        'worldcup': 'wc26',         'worldcup2026': 'wc26',
        // With spaces (D1 stores display names without stripping)
        'fifa world cup 2026': 'wc26', 'fifa world cup': 'wc26',
        'world cup 2026': 'wc26',      'world cup': 'wc26',
        // ── MLB (slug + D1 display name variants) ───────────────────────────
        'baseball': 'mlb',
        'baseball (mlb)': 'mlb',
        'major league baseball': 'mlb',
        // ── NBA / WNBA ───────────────────────────────────────────────────────
        'basketball': 'nba',          // WNBA promoted via league check below
        'basketball (nba)': 'nba',
        'national basketball association': 'nba',
        'wnba': 'wnba',
        'nba w': 'wnba',
        "women's national basketball association": 'wnba',
        'womensnationalbasketballassociation': 'wnba',
        // ── NHL ─────────────────────────────────────────────────────────────
        'hockey': 'nhl',
        'hockey (nhl)': 'nhl',
        'national hockey league': 'nhl',
        // ── NFL ─────────────────────────────────────────────────────────────
        'football': 'nfl',
        'football (nfl)': 'nfl',
        'national football league': 'nfl',
        // ── Golf ────────────────────────────────────────────────────────────
        'golf': 'golf',
        'pga': 'golf',
        'pgatour': 'golf',
        'pga tour': 'golf',
        // ── Tennis ──────────────────────────────────────────────────────────
        'tennis': 'atp',              // gender resolved via league below
        'atp tour': 'atp',
        'wta tour': 'wta',
        // ── Soccer (non-WC handled by league slug in V2_LEAGUES) ────────────
        'soccer': 'soccer',
        'football (soccer)': 'soccer',
    };
    const _sportRawKey = String(game.sport || '').toLowerCase().replace(/\s+/g, '');
    let sportKey = _SUMMARY_SPORT_NORMALIZE[_sportRawKey] || _sportRawKey;
    // If sport resolved to 'nba'/'basketball' but league signals WNBA, use WNBA slug
    if ((sportKey === 'nba' || sportKey === 'basketball') && game.league) {
        const _lgCheck = String(game.league || '').toLowerCase();
        if (/wnba|women|nba\s*w/i.test(_lgCheck)) sportKey = 'wnba';
    }
    const slug = _ESPN_SPORT_SLUG[sportKey]
        || (game.espnLeague ? _ESPN_SPORT_SLUG[String(game.espnLeague).toLowerCase()] : null)
        || null;
    if (!slug) return '';

    const base = env?.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
    try {
        const resp = await fetch(
            `${base}/espn-summary/${slug}/summary?event=${encodeURIComponent(String(sourceId))}`,
            { signal: AbortSignal.timeout(3000) }
        );
        if (!resp.ok) return '';
        const d = await resp.json().catch(() => null);
        if (!d) return '';

        const leaders = d.leaders || [];
        if (!leaders.length) return '';

        const lines = ['', '[ESPN GAME LEADERS]'];
        for (const cat of leaders.slice(0, 5)) {
            const ls = Array.isArray(cat.leaders)
                ? cat.leaders
                : (Array.isArray(cat.leaders?.leaders) ? cat.leaders.leaders : []);
            const top = ls[0];
            if (!top) continue;
            const name = top.athlete?.displayName || top.athlete?.shortName;
            const val  = top.displayValue;
            if (name && val) lines.push(`${cat.displayName}: ${name} ${val}`);
        }
        return lines.length > 2 ? lines.join('\n') + '\n' : '';
    } catch (_) { return ''; }
}

// ── findBracketImpact ────────────────────────────────────────────────────
// Reads bracket_snapshots (Phase 1) to find pre/post championship-prob delta
// per team for a specific game (keyed by triggered_by). Returns {} when no
// snapshots match. State labels (THROUGH / STRONG / ALIVE / DANGER /
// LIFE SUPPORT / ELIMINATED) bucket pR32 for human-readable transitions.
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
        // Dual-key pattern: 'pre:{key}' = before-result snapshot,
        // '{key}' = after-result snapshot. Written by BracketDO Step 10.
        const [preRows, postRows] = await Promise.all([
            env.ARCHIVE_DB.prepare(
                `SELECT team, champion_prob, r32_prob FROM bracket_snapshots
                 WHERE triggered_by = ? ORDER BY team`
            ).bind(`pre:${triggeredBy}`).all(),
            env.ARCHIVE_DB.prepare(
                `SELECT team, champion_prob, r32_prob FROM bracket_snapshots
                 WHERE triggered_by = ? ORDER BY team`
            ).bind(triggeredBy).all(),
        ]);

        const impact = {};
        for (const row of (preRows.results || [])) {
            impact[row.team] = { before: row.champion_prob, r32Before: row.r32_prob };
        }
        for (const row of (postRows.results || [])) {
            if (impact[row.team]) {
                impact[row.team].after    = row.champion_prob;
                impact[row.team].r32After = row.r32_prob;
            }
        }
        for (const [, d] of Object.entries(impact)) {
            if (d.before != null && d.after != null) {
                d.change      = Math.round((d.after - d.before) * 1000) / 1000;
                d.stateBefore = advancementState(d.r32Before ?? 0);
                d.stateAfter  = advancementState(d.r32After  ?? 0);
            }
        }
        return impact;
    } catch (_) { return {}; }
}

// ── BSD Momentum Context ──────────────────────────────────────────────────────
// Requires game.bsdEventId (BSD internal match ID from /bsd/events/live).
// Returns '' when: no bsdEventId, API unavailable, or match not in BSD database.
// Momentum index: −100 (away dominance) → +100 (home dominance), per minute.
async function buildBSDMomentumContext(env, game) {
    const bsdId = game.bsdEventId || game.bsdId;
    if (!bsdId) return '';
    try {
        const base = env?.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
        const resp = await fetch(`${base}/bsd/events/${bsdId}/momentum`,
            { headers: { 'User-Agent': 'FIELD/1.0' } });
        if (!resp.ok) return '';
        const d = await resp.json();
        const vals = (d.momentum || d.results || d.data || [])
            .filter(m => m.value != null);
        if (!vals.length) return '';

        let maxSwing = 0, shiftMinute = null;
        for (let i = 1; i < vals.length; i++) {
            const swing = Math.abs(vals[i].value - vals[i-1].value);
            if (swing > maxSwing) { maxSwing = swing; shiftMinute = vals[i].minute ?? i; }
        }

        const peakHome = Math.max(...vals.map(v => v.value));
        const peakAway = Math.min(...vals.map(v => v.value));
        const current = vals[vals.length - 1];

        const lines = ['', '[BSD MOMENTUM]'];
        if (shiftMinute && maxSwing >= 15) {
            const shiftIdx = vals.findIndex(v => (v.minute ?? 0) >= shiftMinute);
            const before = shiftIdx > 0 ? vals[shiftIdx - 1]?.value ?? 0 : 0;
            const after  = vals[shiftIdx]?.value ?? 0;
            const dir = after > 0 ? 'home dominance' : 'away dominance';
            lines.push(`Game shifted at ${shiftMinute}': pressure index ${before > 0 ? '+' : ''}${Math.round(before)} → ${after > 0 ? '+' : ''}${Math.round(after)} (${dir})`);
        }
        if (peakHome >= 30) lines.push(`Peak home pressure: +${Math.round(peakHome)}`);
        if (peakAway <= -30) lines.push(`Peak away pressure: ${Math.round(peakAway)}`);
        if (current) lines.push(`Current: ${current.value > 0 ? '+' : ''}${Math.round(current.value)} (${current.value > 15 ? 'home' : current.value < -15 ? 'away' : 'balanced'})`);

        return lines.length > 2 ? lines.join('\n') : '';
    } catch (_) { return ''; }
}

// ── buildBSDHistoryContext ────────────────────────────────────────────────
// Reads R2 BSD captures for prior WC matches involving either team and
// injects historical shot quality + momentum into the journalism prompt.
// R2 keys: bsd/wc26/{bsd_event_id}/{shotmap|momentum|incidents|average-positions}.json
// (written by writeWCResult at game-final, commit a55ebd3).
// Source: wc_results.bsd_event_id for each team's prior games (commit 0af35ca).
async function buildBSDHistoryContext(env, game) {
    if (!env?.FIELD_DATA || !env?.WC2026_DB) return '';
    if (game.sport !== 'wc26' && game.sport !== 'soccer') return '';

    const homeName = game.home?.name || game.home || '';
    const awayName = game.away?.name || game.away || '';
    if (!homeName || !awayName) return '';

    try {
        const { results: prior } = await env.WC2026_DB.prepare(`
            SELECT home, away, home_score, away_score, match_date, bsd_event_id
            FROM wc_results
            WHERE bsd_event_id IS NOT NULL
              AND (home = ? OR away = ? OR home = ? OR away = ?)
            ORDER BY match_date DESC
            LIMIT 4
        `).bind(homeName, homeName, awayName, awayName).all();

        if (!prior || !prior.length) return '';

        const sections = [];
        for (const match of prior) {
            const teamLabel = (match.home === homeName || match.home === awayName)
                ? match.home : match.away;
            const opponent = match.home === teamLabel ? match.away : match.home;

            // ── BSD data read — dual path ────────────────────────────────────────
            // WC (league_id=27): BSD exposes no separate /momentum/ or
            // /average-positions/ endpoints — both are embedded in /stats/.
            // R2 key: stats.json  Fields: stats.shotmap[], momentum[{m,v}]
            //
            // Club (EPL/MLS etc.): BSD exposes separate endpoints.
            // R2 keys: shotmap.json, momentum.json  Fields: shots[], {value,minute}
            //
            // Strategy: read stats.json first (WC primary path). If absent or
            // its shotmap/momentum are empty, fall back to club-format files.
            let _bsdStats = null;
            try {
                const _so = await env.FIELD_DATA.get(
                    `bsd/wc26/${match.bsd_event_id}/stats.json`);
                if (_so) _bsdStats = await _so.json();
            } catch (_) {}

            let shotSummary = '';
            try {
                // WC path: stats.json → shotmap[] with {xg, type, xgot} fields
                const _wcShots = _bsdStats?.shotmap;
                if (_wcShots?.length) {
                    const _xgpm  = _bsdStats?.xg_per_minute || [];
                    const _last  = _xgpm[_xgpm.length - 1];
                    const _xgH   = _last?.cum_home ?? _wcShots.filter(s => s.home).reduce((a,s)=>a+(s.xg||0),0);
                    const _xgA   = _last?.cum_away ?? _wcShots.filter(s => !s.home).reduce((a,s)=>a+(s.xg||0),0);
                    // on-target: goals + shots with xgot recorded (saved attempts)
                    const _ot    = _wcShots.filter(s => s.type==='goal' || (s.xgot||0)>0).length;
                    shotSummary  = `${_wcShots.length} shots, ${_ot} OT, xG h${_xgH.toFixed(2)} a${_xgA.toFixed(2)}`;
                } else {
                    // Club fallback: separate shotmap.json — {shots[], xg, on_target}
                    const _smO = await env.FIELD_DATA.get(
                        `bsd/wc26/${match.bsd_event_id}/shotmap.json`);
                    if (_smO) {
                        const _sm    = await _smO.json();
                        const _shots = _sm?.shots || _sm?.results || _sm?.statistics || [];
                        if (_shots.length) {
                            const _xgT  = _shots.reduce((s,sh)=>s+(sh.xg||0),0);
                            const _ot2  = _shots.filter(s=>s.on_target).length;
                            shotSummary = `${_shots.length} shots, ${_ot2} OT, xG ${_xgT.toFixed(2)}`;
                        }
                    }
                }
            } catch (_) {}

            let momentumSummary = '';
            try {
                // WC path: stats.json → momentum[{m,v}] — BSD uses 'm' and 'v', not 'minute'/'value'
                const _wcMom = _bsdStats?.momentum;
                if (_wcMom?.length) {
                    const _peak = _wcMom.reduce(
                        (b,e) => Math.abs(e.v||0) > Math.abs(b.v||0) ? e : b,
                        _wcMom[0]);
                    momentumSummary = `peak ${(_peak.v||0)>0?'+':''}${Math.round(_peak.v||0)} at ${_peak.m}'`;
                } else {
                    // Club fallback: separate momentum.json — {momentum[{minute,value}]}
                    const _momO = await env.FIELD_DATA.get(
                        `bsd/wc26/${match.bsd_event_id}/momentum.json`);
                    if (_momO) {
                        const _mom  = await _momO.json();
                        const _ents = _mom?.momentum || _mom?.results || _mom?.data || [];
                        if (_ents.length) {
                            const _peak2 = _ents.reduce(
                                (b,e) => Math.abs(e.value||0) > Math.abs(b.value||0) ? e : b,
                                _ents[0]);
                            momentumSummary = `peak ${(_peak2.value||0)>0?'+':''}${Math.round(_peak2.value||0)} at ${_peak2.minute||'?'}'`;
                        }
                    }
                }
            } catch (_) {}

            // ── Possession ratio (passes proxy) ─────────────────────────────────
            let possRatio = '';
            try {
                const _hPass = _bsdStats?.stats?.home?.passes || 0;
                const _aPass = _bsdStats?.stats?.away?.passes || 0;
                if (_hPass + _aPass > 0) {
                    const _hPct = Math.round(_hPass / (_hPass + _aPass) * 100);
                    possRatio = `poss ${_hPct}-${100 - _hPct}`;
                }
            } catch (_) {}

            // ── Game character: fouls + clearances ───────────────────────────────
            let gameChar = '';
            try {
                const _totFouls = (_bsdStats?.stats?.home?.fouls || 0)
                                + (_bsdStats?.stats?.away?.fouls || 0);
                const _totClr   = (_bsdStats?.stats?.home?.clearances || 0)
                                + (_bsdStats?.stats?.away?.clearances || 0);
                if (_totFouls > 0)
                    gameChar = `${_totFouls} fouls${_totClr > 0 ? ', ' + _totClr + ' clears' : ''}`;
            } catch (_) {}

            // ── xG phase narrative ────────────────────────────────────────────────
            // Splits incremental xg_per_minute buckets into thirds.
            // Tells which phase each team dominated, not just the final total.
            let xgPhase = '';
            try {
                const _xgpm = _bsdStats?.xg_per_minute || [];
                if (_xgpm.length >= 3) {
                    const _pSum = (from, to) => {
                        const bs = _xgpm.filter(b => b.m > from && b.m <= to);
                        return bs.length
                            ? { h: bs.reduce((s,b) => s + (b.xg_home||0), 0),
                                a: bs.reduce((s,b) => s + (b.xg_away||0), 0) }
                            : null;
                    };
                    const _phases = [
                        [_pSum(0,30),  '0-30'],
                        [_pSum(30,60), '31-60'],
                        [_pSum(60,90), '61-90'],
                    ].map(([p,l]) => p ? `${l} h${p.h.toFixed(2)}/a${p.a.toFixed(2)}` : null)
                     .filter(Boolean);
                    if (_phases.length) xgPhase = `xG phases: ${_phases.join(', ')}`;
                }
            } catch (_) {}

            // ── Substitution Momentum Shift (SMS) ────────────────────────────────
            // For each sub minute in [15,80]: compare avg momentum 10 min before/after.
            // BSD momentum {m,v}: positive v = home dominant, negative = away dominant.
            // Home sub impact: SMS > 12. Away sub impact: SMS < -12.
            // incidents.json: type='substitution', is_home, player_in, minute.
            let smsSummary = '';
            try {
                const _incR = await env.FIELD_DATA.get(
                    `bsd/wc26/${match.bsd_event_id}/incidents.json`);
                if (_incR && (_bsdStats?.momentum?.length || 0) > 10) {
                    const _incData = await _incR.json();
                    const _mom     = _bsdStats.momentum;
                    const _avgMom  = (from, to) => {
                        const sl = _mom.filter(e => e.m >= from && e.m <= to);
                        return sl.length
                            ? sl.reduce((s,e) => s + (e.v||0), 0) / sl.length
                            : null;
                    };
                    const _subMins = [...new Set(
                        (_incData.incidents || [])
                            .filter(e => e.type === 'substitution'
                                      && e.minute >= 15 && e.minute <= 80)
                            .map(e => e.minute)
                    )];
                    const _impacts = [];
                    for (const _min of _subMins) {
                        const _before = _avgMom(Math.max(1, _min - 10), _min);
                        const _after  = _avgMom(_min, Math.min(90, _min + 10));
                        if (_before == null || _after == null) continue;
                        const _sms    = _after - _before;
                        const _minSubs = (_incData.incidents||[]).filter(
                            e => e.type === 'substitution' && e.minute === _min);
                        const _isHome  = _minSubs.some(s => s.is_home);
                        if ((_isHome && _sms > 12) || (!_isHome && _sms < -12)) {
                            const _pin = _minSubs.find(s => s.is_home === _isHome)?.player_in || '';
                            _impacts.push(`${_pin} ${_min}' SMS${_sms>0?'+':''}${Math.round(_sms)}`);
                        }
                    }
                    if (_impacts.length) smsSummary = `impact subs: ${_impacts.join(', ')}`;
                }
            } catch (_) {}

            const scoreline = `${match.home_score}-${match.away_score}`;
            const parts = [`vs ${opponent} (${scoreline})`];
            if (shotSummary)     parts.push(shotSummary);
            if (momentumSummary) parts.push(momentumSummary);
            if (possRatio)       parts.push(possRatio);
            if (gameChar)        parts.push(gameChar);
            if (xgPhase)         parts.push(xgPhase);
            if (smsSummary)      parts.push(smsSummary);
            sections.push(`  ${match.match_date}: ${teamLabel} ${parts.join(' | ')}`);
        }

        if (!sections.length) return '';
        return '\n\n[BSD HISTORY]\nPrior WC match data:\n' + sections.join('\n');
    } catch (_) { return ''; }
}

// ── buildTeamFormContext ───────────────────────────────────────────────────
// Last N completed regular-season games for each team, factual W/L/score
// only — no drama computed. Rule 47/ADR-002 compliant.
const _TEAM_FORM_SPORT_MAP = {
  mlb:        'MLB',        wnba:       'WNBA',
  wc26:       'FIFA World Cup 2026',
  afl:        'AFL',        cfl:        'CFL',
  epl:        'EPL',        mls:        'MLS',
  ucl:        'UCL',        laliga:     'La Liga',
  seriea:     'Serie A',    bundesliga: 'Bundesliga',
  ligue1:     'Ligue 1',    nhl:        'NHL',
  nba:        'NBA',
};

async function buildTeamFormContext(env, game) {
  if (!env.ARCHIVE_DB) return '';

  const dbSport = _TEAM_FORM_SPORT_MAP[game.sport];
  if (!dbSport) return '';

  const home = game.home?.name || game.home;
  const away = game.away?.name || game.away;
  if (!home || !away) return '';

  const N = 5;

  try {
    const [hResult, aResult] = await Promise.all([
      env.ARCHIVE_DB.prepare(
        `SELECT home, away, home_score, away_score
         FROM regular_season_games
         WHERE sport = ? AND (home = ? OR away = ?)
           AND home_score IS NOT NULL AND away_score IS NOT NULL
         ORDER BY date DESC LIMIT ?`
      ).bind(dbSport, home, home, N).all(),

      env.ARCHIVE_DB.prepare(
        `SELECT home, away, home_score, away_score
         FROM regular_season_games
         WHERE sport = ? AND (home = ? OR away = ?)
           AND home_score IS NOT NULL AND away_score IS NOT NULL
         ORDER BY date DESC LIMIT ?`
      ).bind(dbSport, away, away, N).all()
    ]);

    const fmt = (teamName, rows) => {
      if (!rows?.length) return null;
      let gf = 0, ga = 0, w = 0;
      const segments = rows.map(r => {
        const isHome   = r.home === teamName;
        const scored   = isHome ? r.home_score : r.away_score;
        const conceded = isHome ? r.away_score : r.home_score;
        const opp      = isHome ? r.away       : r.home;
        const res      = scored > conceded ? 'W' : scored < conceded ? 'L' : 'D';
        gf += scored; ga += conceded;
        if (res === 'W') w++;
        return `${res} ${scored}-${conceded} vs ${opp}`;
      });
      const n = rows.length;
      return `${teamName} (L${n}): ${segments.join(' · ')} | ` +
             `${w}W ${(gf / n).toFixed(1)} scored ${(ga / n).toFixed(1)} conceded`;
    };

    const lines = [
      fmt(home, hResult.results),
      fmt(away, aResult.results)
    ].filter(Boolean);

    return lines.length ? `[TEAM FORM]\n${lines.join('\n')}` : '';

  } catch (_) {
    return '';
  }
}

// ── buildFPLPlayerContext ────────────────────────────────────────────────
// CC-CMD-2026-07-15-fpl-analytics-context. EPL-only (FPL is a Premier
// League-specific data model). Real xG/xA/ICT/form context nothing else in
// the stack provides (ESPN gives scores, BSD gives shot data, FD gives
// standings -- none give per-player underlying-numbers trend or set-piece
// taker assignments).
//
// Player selection: top-2 per team by ict_index (a single composite
// influence/creativity/threat metric FPL already computes -- more
// appropriate for "who's driving this team's attacking output" than a
// single raw stat like goals), excluding anyone FPL has explicitly ruled
// out (chance_of_playing_next_round === 0). Reasoned choice over the other
// two options the CC-CMD raised: reusing the existing goalscorer path only
// covers players who've already scored (backward-looking, not predictive
// context); set-piece-takers-only would miss a team's most involved
// non-taker (e.g. a creative midfielder). ict_index is FPL's own
// already-computed ranking, not a new metric invented here -- confirmed
// live it's NOT reset to 0 at a fresh season's start (Haaland 302.3, Salah
// 207.1), unlike form/expected_goals which genuinely are 0 for everyone
// with 0 gameweeks played.
//
// element-summary IS wired in (see below), reversing this CC-CMD's initial
// plan to allowlist it but leave it unused -- real live data changed that
// call: its history[] carries the full completed-season gameweek log,
// which bootstrap-static doesn't expose at all, and is currently more
// informative than bootstrap-static's zeroed current-season fields.
//
// Team matching: ESPN's competitor.abbreviation and FPL's team.short_name
// are NOT always the same 3-letter code -- confirmed live 2026-07-15
// against real ESPN EPL scoreboard data across 3 real matchdays (19/20
// teams observed). 18/20 matched directly; 2 real, confirmed mismatches:
// Man City (FPL short_name MCI, ESPN abbr MNC) and Man Utd (FPL MUN, ESPN
// MAN). This table is the full real, live-verified mapping, not a partial
// guess extended by pattern-matching the other 18.
const _FPL_SHORT_TO_ESPN_ABBR = {
    'ARS': 'ARS', 'AVL': 'AVL', 'BUR': 'BUR', 'BOU': 'BOU', 'BRE': 'BRE',
    'BHA': 'BHA', 'CHE': 'CHE', 'CRY': 'CRY', 'EVE': 'EVE', 'FUL': 'FUL',
    'LEE': 'LEE', 'LIV': 'LIV', 'MCI': 'MNC', 'MUN': 'MAN', 'NEW': 'NEW',
    'NFO': 'NFO', 'SUN': 'SUN', 'TOT': 'TOT', 'WHU': 'WHU', 'WOL': 'WOL',
};

async function buildFPLPlayerContext(env, game) {
    const homeAbbr = String(game.home?.abbr || game.homeAbbr || '').toUpperCase();
    const awayAbbr = String(game.away?.abbr || game.awayAbbr || '').toUpperCase();
    if (!homeAbbr && !awayAbbr) return '';

    const base = env?.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
    let boot;
    try {
        const r = await fetch(`${base}/fpl/bootstrap-static`, { signal: AbortSignal.timeout(5000) });
        if (!r.ok) return '';
        boot = await r.json();
    } catch (_) { return ''; }

    const teams = boot?.teams || [];
    const elements = boot?.elements || [];
    if (!teams.length || !elements.length) return '';

    const teamIdFor = (espnAbbr) => {
        const t = teams.find(t => _FPL_SHORT_TO_ESPN_ABBR[t.short_name] === espnAbbr);
        return t ? t.id : null;
    };
    const homeId = homeAbbr ? teamIdFor(homeAbbr) : null;
    const awayId = awayAbbr ? teamIdFor(awayAbbr) : null;
    if (!homeId && !awayId) return '';

    const topTwo = (teamId, teamAbbr) => {
        if (!teamId) return [];
        return elements
            .filter(e => e.team === teamId && e.chance_of_playing_next_round !== 0)
            .sort((a, b) => (parseFloat(b.ict_index) || 0) - (parseFloat(a.ict_index) || 0))
            .slice(0, 2)
            .map(e => ({ ...e, _teamAbbr: teamAbbr }));
    };
    const players = [...topTwo(homeId, homeAbbr), ...topTwo(awayId, awayAbbr)];
    if (!players.length) return '';

    // element-summary: real, live-verified 2026-07-15 to add genuine value
    // beyond bootstrap-static -- its per-player history[] carries the full
    // completed-season gameweek log (goals/assists/minutes/ict per game),
    // which bootstrap-static does NOT expose at all (only season-aggregate
    // totals, which read as 0 for every player right at a fresh season's
    // start -- confirmed live: form:"0.0" for literally every sampled
    // player including Haaland/Salah, while their ict_index, a rolling/
    // price-driving metric, is NOT reset and still real -- 302.3/207.1).
    // Best-effort per player: a failure here still leaves the
    // bootstrap-static line (name/xG/xA/ICT/news) intact.
    const summaries = await Promise.all(players.map(async p => {
        try {
            const r = await fetch(`${base}/fpl/element-summary/${p.id}`, { signal: AbortSignal.timeout(4000) });
            if (!r.ok) return null;
            const d = await r.json();
            const hist = d?.history || [];
            if (!hist.length) return null;
            const last3 = hist.slice(-3);
            const pts = last3.reduce((s, h) => s + (h.total_points || 0), 0);
            const goals = last3.reduce((s, h) => s + (h.goals_scored || 0), 0);
            const assists = last3.reduce((s, h) => s + (h.assists || 0), 0);
            const avgIct = last3.reduce((s, h) => s + (parseFloat(h.ict_index) || 0), 0) / last3.length;
            return { pts, goals, assists, avgIct, games: last3.length };
        } catch (_) { return null; }
    }));

    const lines = ['', '[FPL PLAYER CONTEXT]'];
    players.forEach((p, i) => {
        const xg = parseFloat(p.expected_goals) || 0;
        const xa = parseFloat(p.expected_assists) || 0;
        const ict = parseFloat(p.ict_index) || 0;
        let line = `${p._teamAbbr} ${p.web_name}: season xG ${xg.toFixed(2)}, xA ${xa.toFixed(2)}, ICT ${ict.toFixed(1)}`;
        const s = summaries[i];
        if (s) {
            line += ` — last ${s.games}: ${s.goals}G ${s.assists}A ${s.pts}pts (ICT avg ${s.avgIct.toFixed(1)})`;
        } else {
            const form = parseFloat(p.form) || 0;
            line += `, form ${form.toFixed(1)}`;
        }
        if (p.news) line += ` — ${p.news}`;
        lines.push(line);
    });

    // set-piece-notes: real, distinctive data bootstrap-static doesn't
    // carry at all (penalty/corner/free-kick taker assignments). Best
    // effort -- a fetch failure here doesn't drop the player-analytics
    // block already built above.
    try {
        const spr = await fetch(`${base}/fpl/set-piece-notes`, { signal: AbortSignal.timeout(5000) });
        if (spr.ok) {
            const spData = await spr.json();
            const relevantTeamIds = new Set([homeId, awayId].filter(Boolean));
            const spTeams = (spData?.teams || []).filter(t => relevantTeamIds.has(t.id));
            for (const t of spTeams) {
                const teamAbbr = t.id === homeId ? homeAbbr : awayAbbr;
                for (const note of (t.notes || [])) {
                    if (note.info_message) lines.push(`${teamAbbr} set pieces: ${note.info_message}`);
                }
            }
        }
    } catch (_) { /* set-piece notes are a bonus, not required */ }

    return lines.length > 2 ? lines.join('\n') : '';
}

// ── buildFPLMatchEventsContext ───────────────────────────────────────────
// CC-CMD-2026-08-21-fpl-event-grounding-epl. EPL briefs were season-stat
// templates ("both sides holding 0 points through 0 matches") because nothing
// fed them what actually happened. This reads the per-player gameweek payload
// and names the scorers, assisters, cards and saves for THIS fixture.
//
// SEPARATE from buildFPLPlayerContext deliberately (Rule 69). That one is
// pre-game — who is dangerous coming in, by ICT/xG. This one is what occurred.
// Merging them would restructure a working builder for no benefit.
//
// SCOPING IS THE WHOLE PROBLEM. /fpl/event/{gw}/live/ returns every player in
// the gameweek — 600 elements, of which 62 touched fixture 1 (measured
// 2026-08-22). `stats` on the element is the GAMEWEEK aggregate, so in a double
// gameweek a team plays twice and a team-id filter would silently merge two
// matches into one recap. The per-fixture breakdown lives in
// `explain[] = [{fixture, stats:[{identifier, value, points}]}]`, shape read
// from the live payload rather than written from memory. Every number below
// comes from the explain entry for this fixture only.
//
// WHAT FPL CANNOT GIVE. There is no goal MINUTE anywhere in this payload —
// `minutes` is minutes played, not when a goal went in. The CC-CMD's example
// prose ("Saka opened the scoring in the 34th") is therefore NOT satisfiable
// from FPL, and this builder does not pretend otherwise: it emits who and how
// many, never a timestamp. Minutes are ESPN keyEvents' job, which CONTRACTS.md
// already makes authoritative for match narrative.
//
// Team join uses _FPL_SHORT_TO_ESPN_ABBR — a scoped closed dictionary, never
// the cross-sport resolveTeamKey, where FPL's Sunderland short code "SUN"
// resolves to the WNBA Connecticut Sun (see CONTRACTS.md, short-code rule).
async function buildFPLMatchEventsContext(env, game) {
    const homeAbbr = String(game.home?.abbr || game.homeAbbr || '').toUpperCase();
    const awayAbbr = String(game.away?.abbr || game.awayAbbr || '').toUpperCase();
    if (!homeAbbr && !awayAbbr) return '';

    const base = env?.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
    const fetchJson = async (path, ms = 5000) => {
        const r = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(ms) });
        if (!r.ok) return null;
        return r.json();
    };

    try {
        const boot = await fetchJson('/fpl/bootstrap-static');
        const teams = boot?.teams || [];
        const roster = boot?.elements || [];
        if (!teams.length || !roster.length) return '';

        // Gameweek: exactly one event carries is_current (verified 2026-08-22,
        // 1 of 38). is_next is the fallback for the window after a gameweek
        // closes and before the next opens; without it a naive find() returns
        // undefined and the whole builder silently no-ops.
        const events = boot?.events || [];
        const gw = events.find(e => e.is_current)?.id ?? events.find(e => e.is_next)?.id;
        if (!gw) return '';

        const teamIdFor = (espnAbbr) => {
            const t = teams.find(t => _FPL_SHORT_TO_ESPN_ABBR[t.short_name] === espnAbbr);
            return t ? t.id : null;
        };
        const homeId = homeAbbr ? teamIdFor(homeAbbr) : null;
        const awayId = awayAbbr ? teamIdFor(awayAbbr) : null;
        if (!homeId || !awayId) return '';   // both sides needed to identify one fixture

        const fixtures = await fetchJson(`/fpl/fixtures?event=${gw}`);
        const fixture = (Array.isArray(fixtures) ? fixtures : []).find(f =>
            (f.team_h === homeId && f.team_a === awayId) ||
            (f.team_h === awayId && f.team_a === homeId));
        if (!fixture) return '';

        // Gate on `started`, NOT on `finished`. Measured 2026-08-22: Arsenal v
        // Coventry read finished:false while already carrying a 3-0 score and 11
        // stat blocks, because FPL only flips `finished` once bonus points are
        // finalised hours later. Gating on it would mean recaps never fire.
        if (!fixture.started) return '';

        const live = await fetchJson(`/fpl/event/${gw}/live/`);
        const elements = live?.elements || [];
        if (!elements.length) return '';

        const rosterById = new Map(roster.map(p => [p.id, p]));
        const abbrForTeam = (id) => (id === homeId ? homeAbbr : awayAbbr);

        // Pull this fixture's numbers out of explain[], by identifier.
        const perPlayer = [];
        for (const el of elements) {
            const entry = (el.explain || []).find(x => x.fixture === fixture.id);
            if (!entry) continue;
            const p = rosterById.get(el.id);
            if (!p || (p.team !== homeId && p.team !== awayId)) continue;
            const v = {};
            for (const s of (entry.stats || [])) v[s.identifier] = s.value;
            perPlayer.push({
                name: p.web_name,
                abbr: abbrForTeam(p.team),
                goals: v.goals_scored || 0,
                assists: v.assists || 0,
                ownGoals: v.own_goals || 0,
                yellow: v.yellow_cards || 0,
                red: v.red_cards || 0,
                saves: v.saves || 0,
                pensSaved: v.penalties_saved || 0,
                pensMissed: v.penalties_missed || 0,
                bonus: v.bonus || 0,
                minutes: v.minutes || 0,
            });
        }
        if (!perPlayer.length) return '';

        const lines = ['', '[FPL MATCH EVENTS]'];
        const say = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

        const scorers = perPlayer.filter(p => p.goals > 0)
            .sort((a, b) => b.goals - a.goals);
        if (scorers.length) {
            lines.push(`Goals: ${scorers.map(p =>
                `${p.name} (${p.abbr})${p.goals > 1 ? ` ${p.goals}` : ''}`).join(', ')}`);
        }
        const assisters = perPlayer.filter(p => p.assists > 0)
            .sort((a, b) => b.assists - a.assists);
        if (assisters.length) {
            lines.push(`Assists: ${assisters.map(p =>
                `${p.name} (${p.abbr})${p.assists > 1 ? ` ${p.assists}` : ''}`).join(', ')}`);
        }
        const owns = perPlayer.filter(p => p.ownGoals > 0);
        if (owns.length) lines.push(`Own goals: ${owns.map(p => `${p.name} (${p.abbr})`).join(', ')}`);

        const reds = perPlayer.filter(p => p.red > 0);
        if (reds.length) lines.push(`Red cards: ${reds.map(p => `${p.name} (${p.abbr})`).join(', ')}`);
        const yellows = perPlayer.filter(p => p.yellow > 0);
        if (yellows.length) lines.push(`Yellow cards: ${yellows.length} — ${yellows.map(p => `${p.name} (${p.abbr})`).join(', ')}`);

        const pensSaved = perPlayer.filter(p => p.pensSaved > 0);
        if (pensSaved.length) lines.push(`Penalties saved: ${pensSaved.map(p => `${p.name} (${p.abbr})`).join(', ')}`);
        const pensMissed = perPlayer.filter(p => p.pensMissed > 0);
        if (pensMissed.length) lines.push(`Penalties missed: ${pensMissed.map(p => `${p.name} (${p.abbr})`).join(', ')}`);

        // Keepers: only worth a line when the workload was real.
        const keepers = perPlayer.filter(p => p.saves >= 3).sort((a, b) => b.saves - a.saves);
        if (keepers.length) {
            lines.push(`Saves: ${keepers.map(p => `${p.name} (${p.abbr}) ${say(p.saves, 'save')}`).join(', ')}`);
        }

        // The fantasy layer ESPN does not carry — CONTRACTS.md makes FPL
        // authoritative for bonus, so this is the half that is FPL's to state.
        const bonus = perPlayer.filter(p => p.bonus > 0).sort((a, b) => b.bonus - a.bonus);
        if (bonus.length) {
            lines.push(`FPL bonus: ${bonus.map(p => `${p.name} (${p.abbr}) +${p.bonus}`).join(', ')}`);
        }

        // Stated so a generator cannot infer a minute it was never given.
        if (lines.length > 2) lines.push('(FPL carries no goal timings — do not state minutes from this block.)');

        return lines.length > 3 ? lines.join('\n') : '';
    } catch (_) {
        // Rule 5: a context-source failure must never break brief generation.
        return '';
    }
}

// ── Source registry ─────────────────────────────────────────────────────
// Lower priority numbers run first. Budget is per-source soft cap; the
// assembler sums against the overall totalBudget and stops when exhausted.
const CONTEXT_SOURCES = [
    { id: 'espn_summary', priority: 3, budget: 200, builder: buildESPNSummaryContext,
      sports: ['mlb', 'nba', 'wnba', 'nhl', 'wc26', 'soccer', 'atp', 'wta'] },
    { id: 'path_traps', priority: 4, budget: 120, sports: ['wc26'],
      builder: async (env, game) => {
          if (!env?.FIELD_JOURNALISM) return '';
          // Match across display name, ESPN shortDisplayName, FIFA code —
          // ESPN scoreboard yields short codes ("BIH"); bracketTraps carry
          // full names ("Bosnia and Herzegovina") + fifaCode. Match either.
          const hForms = new Set([game.home, game.homeAbbr].filter(Boolean));
          const aForms = new Set([game.away, game.awayAbbr].filter(Boolean));
          if (!hForms.size && !aForms.size) return '';
          try {
              const raw = await env.FIELD_JOURNALISM.get('wc:projections:current');
              if (!raw) return '';
              const proj = JSON.parse(raw);
              const traps = (proj.bracketTraps || []).filter(t =>
                  hForms.has(t.team) || aForms.has(t.team) ||
                  hForms.has(t.fifaCode) || aForms.has(t.fifaCode)
              );
              if (!traps.length) return '';
              const lines = traps.map(t => {
                  const delta1 = Math.round((t.pChampIf1st ?? 0) * 100);
                  const delta2 = Math.round((t.pChampIf2nd ?? 0) * 100);
                  const swing  = Math.round((t.delta ?? 0) * 100);
                  return `PATH TRAP — ${t.team}: finishing 2nd yields +${swing}% pChamp (as 1st: ${delta1}%, as 2nd: ${delta2}%)`;
              });
              return `[TRAP CONTEXT]\n${lines.join('\n')}`;
          } catch (_) { return ''; }
      },
    },
    { id: 'bracket_impact', priority: 4, budget: 150, sports: ['wc26'],
      builder: async (env, game) => {
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
      },
    },
    { id: 'odds_story',   priority: 5, budget: 100, builder: buildOddsStoryContext,
      sports: ['mlb', 'nba', 'nhl', 'nfl', 'wnba', 'epl', 'mls',
               'wc26', 'laliga', 'seriea', 'bundesliga', 'ligue1',
               'afl', 'cfl'] },
    { id: 'savant',       priority: 7, budget: 400, builder: buildSavantContext,        sports: ['mlb'] },
    { id: 'nhl_series',   priority: 7, budget: 150, builder: buildNHLSeriesContext,     sports: ['nhl'] },
    { id: 'nba_clutch',   priority: 7, budget: 120, builder: buildNBAClutchContext,     sports: ['nba'] },
    { id: 'soccer_xg',    priority: 7, budget: 150, builder: buildSoccerXGContext,
      sports: ['epl', 'mls', 'ucl', 'wc26', 'laliga', 'seriea', 'bundesliga', 'ligue1', 'soccer'] },
    { id: 'soccer_season_form', priority: 8, budget: 100, builder: buildSoccerSeasonFormContext,
      sports: ['mls'] },
    // BSD momentum: minute-by-minute pressure index. Requires game.bsdEventId.
    // Provides the "when the game shifted" signal ESPN lacks.
    { id: 'bsd_momentum', priority: 8, budget: 120, builder: buildBSDMomentumContext,
      sports: ['epl', 'mls', 'ucl', 'wc26', 'laliga', 'seriea', 'bundesliga', 'ligue1', 'soccer', 'atp', 'wta'] },
    // BSD history: prior WC match shot quality + momentum from R2 captures.
    // Activates when wc_results rows have bsd_event_id (backfill via CC-CMD-H Task 1).
    { id: 'bsd_history', priority: 7, budget: 200, builder: buildBSDHistoryContext,
      sports: ['wc26'] },
    // FPL player analytics: xG/xA/ICT/form for each team's top-2 by
    // ict_index, plus set-piece taker assignments. EPL-only -- FPL's data
    // model is Premier League-specific (CC-CMD-2026-07-15-fpl-analytics-context).
    { id: 'fpl_player_context', priority: 8, budget: 150, builder: buildFPLPlayerContext,
      sports: ['epl'] },
    // FPL match events: who actually scored/assisted/was carded in THIS
    // fixture, scoped via explain[].fixture. Priority 5 — above the pre-game
    // player analytics, because what happened outranks who was dangerous.
    // EPL-only; FPL's data model is Premier League-specific.
    { id: 'fpl_match_events', priority: 5, budget: 200, builder: buildFPLMatchEventsContext,
      sports: ['epl'] },
    // Team form: last 5 completed games per team from regular_season_games.
    // Factual W/L/score history only — no drama values (Rule 47/ADR-002).
    { id: 'team_form', priority: 9, budget: 200, builder: buildTeamFormContext,
      sports: ['mlb', 'wnba', 'wc26', 'afl', 'cfl',
               'epl', 'mls', 'ucl', 'laliga', 'seriea', 'bundesliga', 'ligue1'] },
    // Golf leaderboard: tournament header + top-5 from /v2/golf/enriched.
    { id: 'golf_leaderboard', priority: 3, budget: 150, sports: ['golf'],
      builder: async (env, game) => {
          try {
              const base = env?.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
              const r = await fetch(`${base}/v2/golf/enriched`,
                  { signal: AbortSignal.timeout(3000) });
              if (!r.ok) return '';
              const d = await r.json().catch(() => null);
              if (!d?.active || !d?.leaderboard?.length) return '';
              const header = [
                  d.name || 'PGA Tour',
                  d.round ? `Round ${d.round}` : '',
                  d.roundStatus || d.status || '',
                  d.venue || '',
              ].filter(Boolean).join(' · ');
              const rows = d.leaderboard.slice(0, 5).map((p, idx) => {
                  const pos   = p.position || String(idx + 1);
                  const name  = p.name || ((p.firstName || '') + ' ' + (p.lastName || '')).trim();
                  const score = p.toPar != null ? p.toPar : (p.score || 'E');
                  const thru  = p.thru  != null ? ' (thru ' + p.thru + ')' : '';
                  return '  ' + pos + '. ' + name + ' ' + score + thru;
              }).join('\n');
              return '[GOLF CONTEXT]\n' + header + '\n' + rows;
          } catch (_) { return ''; }
      },
    },
];

// Per-source token budget allowance — the spec sets soft per-source caps,
// but the assembler is a simple sum against totalBudget. We honour the
// per-source cap by skipping a block if it alone exceeds source.budget.
const _SPORT_NORMALIZE = {
    'fifa world cup 2026': 'wc26',
    'fifa world cup': 'wc26',
    'world cup': 'wc26',
    'pga tour': 'golf',
    'pga':       'golf',
};
async function assembleContext(env, game, totalBudget = 1500) {
    if (!env || !game) return '';
    const _raw = String(game.sport || '').toLowerCase();
    let sport = _SPORT_NORMALIZE[_raw] || _raw;
    // Secondary: promote 'soccer' → 'wc26' when league signals WC.
    // ESPN API returns game.sport='soccer' for all soccer including WC;
    // _SPORT_NORMALIZE only matches full 'fifa world cup' strings.
    // Without this, path_traps + bracket_impact (sports:['wc26']) drop silently.
    if (sport === 'soccer') {
        const _league = String(game.league || game.espnLeague || '').toLowerCase();
        if (/world.cup|fifa|wc26/i.test(_league)) sport = 'wc26';
    }
    // Promote 'nba' → 'wnba' when league signals Women's Basketball
    if (sport === 'nba') {
        const _lg = String(game.league || game.espnLeague || game.league_name || '').toLowerCase();
        if (/wnba|women|nba\s*w/i.test(_lg)) sport = 'wnba';
    }
    // Promote 'atp' → 'wta' when league signals women's tennis
    if (sport === 'atp') {
        const _lg = String(game.league || game.espnLeague || '').toLowerCase();
        if (/wta|women/i.test(_lg)) sport = 'wta';
    }
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
    findBracketImpact,
    advancementState,
    // Builders + helpers exported so the test surface can exercise them
    // independently without a full assembler run.
    buildSavantContext,
    buildNHLSeriesContext,
    buildNBAClutchContext,
    buildSoccerXGContext,
    buildSoccerSeasonFormContext,
    buildESPNSummaryContext,
    buildBSDMomentumContext,
    buildBSDHistoryContext,
    buildTeamFormContext,
    buildFPLPlayerContext,
    buildFPLMatchEventsContext,
};
