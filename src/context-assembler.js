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

// ── MLB: Savant context ─────────────────────────────────────────────────
// Pulls team-level ABS challenge grades for both teams. Player-level
// lookups (xBA/xSLG, pitch arsenal) are deferred until a roster join
// surface exists — without that, mapping homeAbbr→starting pitcher is
// brittle. Today's builder surfaces what's reliably keyable.
async function buildSavantContext(env, game) {
    const ha = _abbr(game.homeAbbr);
    const aa = _abbr(game.awayAbbr);
    if (!ha && !aa) return '';
    const teamAbs = await r2Json(env, 'mlb/2026/team_abs.json');
    if (!teamAbs?.data) return '';
    const h = teamAbs.data[ha];
    const a = teamAbs.data[aa];
    if (!h && !a) return '';
    const lines = ['', '[SAVANT CONTEXT]'];
    if (h) {
        lines.push(`${ha} ABS challenge: grade ${h.grade} ` +
            `(${h.battingWon}/${h.battingAttempted} overturned, ` +
            `${(h.battingRate * 100).toFixed(1)}% success).`);
    }
    if (a) {
        lines.push(`${aa} ABS challenge: grade ${a.grade} ` +
            `(${a.battingWon}/${a.battingAttempted} overturned, ` +
            `${(a.battingRate * 100).toFixed(1)}% success).`);
    }
    return lines.join('\n');
}

// ── NHL: Series special teams ────────────────────────────────────────────
// Series-adjusted PP%/PK% from the active playoff series file. Writer
// uses pre-formatted ppLabel / pkLabel strings; we surface those
// verbatim so the LLM gets the same phrasing the cron pipeline uses.
async function buildNHLSeriesContext(env, game) {
    const ha = _abbr(game.homeAbbr);
    const aa = _abbr(game.awayAbbr);
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
    const ha = _abbr(game.homeAbbr);
    const aa = _abbr(game.awayAbbr);
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

// ── Soccer: FBref stats ──────────────────────────────────────────────────
// FBref data may not be in R2 yet — the GH Actions cron only writes for
// active windows. Returns '' on missing file; we don't fail the assembler.
// League is mapped from game.league or game.sport in the caller.
const _SOCCER_LEAGUE_TO_FILE = {
    'epl': 'epl.json',
    'eng.1': 'epl.json',
    'la liga': 'laliga.json',
    'laliga': 'laliga.json',
    'esp.1': 'laliga.json',
    'serie a': 'seriea.json',
    'seriea': 'seriea.json',
    'ita.1': 'seriea.json',
    'bundesliga': 'bundesliga.json',
    'ger.1': 'bundesliga.json',
    'ligue 1': 'ligue1.json',
    'ligue1': 'ligue1.json',
    'fra.1': 'ligue1.json',
    'fifa world cup': 'wc2026.json',
    'fifa.world': 'wc2026.json',
    'wc26': 'wc2026.json',
};

async function buildSoccerFBrefContext(env, game) {
    const leagueKey = String(game.league || game.sport || '').toLowerCase();
    const file = _SOCCER_LEAGUE_TO_FILE[leagueKey];
    if (!file) return '';
    const blob = await r2Json(env, `soccer/fbref/${file}`);
    if (!blob) return '';
    // FBref shape isn't pinned by code in this repo (written by a GH Actions
    // job). Be lenient: look for common keying patterns.
    const teams = blob.teams || blob.data || blob;
    if (typeof teams !== 'object') return '';
    const home = game.home || '';
    const away = game.away || '';
    // Try common keys: by team display name, then abbr
    const h = teams[home] || teams[_abbr(game.homeAbbr)] || null;
    const a = teams[away] || teams[_abbr(game.awayAbbr)] || null;
    if (!h && !a) return '';
    const lines = ['', '[SOCCER STATS CONTEXT]'];
    const summarize = (label, t) => {
        const parts = [];
        if (Number.isFinite(t.xg) || Number.isFinite(t.xG)) parts.push(`xG ${t.xg ?? t.xG}`);
        if (Number.isFinite(t.xga) || Number.isFinite(t.xGA)) parts.push(`xGA ${t.xga ?? t.xGA}`);
        if (Number.isFinite(t.poss) || Number.isFinite(t.possession)) parts.push(`Poss ${t.poss ?? t.possession}%`);
        if (Number.isFinite(t.progPasses) || Number.isFinite(t.progressivePasses)) parts.push(`PrgP ${t.progPasses ?? t.progressivePasses}`);
        if (parts.length) lines.push(`${label}: ${parts.join(' / ')}.`);
    };
    if (h) summarize(home || 'home', h);
    if (a) summarize(away || 'away', a);
    return lines.length > 2 ? lines.join('\n') : '';
}

// ── Source registry ─────────────────────────────────────────────────────
// Lower priority numbers run first. Budget is per-source soft cap; the
// assembler sums against the overall totalBudget and stops when exhausted.
const CONTEXT_SOURCES = [
    { id: 'savant',       priority: 7, budget: 400, builder: buildSavantContext,        sports: ['mlb'] },
    { id: 'nhl_series',   priority: 7, budget: 150, builder: buildNHLSeriesContext,     sports: ['nhl'] },
    { id: 'nba_clutch',   priority: 7, budget: 120, builder: buildNBAClutchContext,     sports: ['nba'] },
    { id: 'soccer_fbref', priority: 7, budget: 180, builder: buildSoccerFBrefContext,
      sports: ['epl', 'mls', 'ucl', 'wc26', 'laliga', 'seriea', 'bundesliga', 'ligue1', 'soccer'] },
];

// Per-source token budget allowance — the spec sets soft per-source caps,
// but the assembler is a simple sum against totalBudget. We honour the
// per-source cap by skipping a block if it alone exceeds source.budget.
async function assembleContext(env, game, totalBudget = 1500) {
    if (!env || !game) return '';
    const sport = String(game.sport || '').toLowerCase();
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
    // Builders + helpers exported so the test surface can exercise them
    // independently without a full assembler run.
    buildSavantContext,
    buildNHLSeriesContext,
    buildNBAClutchContext,
    buildSoccerFBrefContext,
};
