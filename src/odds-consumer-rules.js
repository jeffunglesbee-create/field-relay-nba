// src/odds-consumer-rules.js
// WHICH PRICE A CONSUMER SHOULD READ, and why it is not always `closing_odds`.
//
// MEASURED 2026-09-14: of the archive rows whose closing line could be checked
// against kickoff, 219 were captured AFTER the match started. Those are not
// closing lines; they are in-play lines sitting in a column named closing. The
// capture is real and the value is real -- what is wrong is only the label, and
// `src/odds-kickoff.js` already writes the correction onto every askable row as
// `_kickoff: { at, verified, late_minutes }`.
//
// Nothing read that mark. Five sites read `closing_odds` blind:
//
//   analytics-engine.js  winnerMoneylinePrice   upset detection (>= +200)
//   analytics-engine.js  scoreGame              tight line (|spread| < 3)
//   index.js 5637/9259   debrief prompt         prints "closed home X / away Y"
//   odds-story.js        computeOddsStory       narrates opening -> closing
//
// Each wants the same thing -- THE LAST PRICE BEFORE KICKOFF -- and each was
// asking for it by column name instead of by that property. An in-play price
// has already absorbed the result: a leader's moneyline collapses, a spread
// widens toward whoever is ahead. So the error is directional, not noise.
//
// THE SELECTION RULE. Skip a blob KNOWN to be post-kickoff; take the first one
// that is not. An unmarked blob is `unknown`, not `verified` (Rule 99: absence
// is not zero) -- it is still used, because two of the three writers never
// stamped `opening_odds` at all and excluding unknowns would blank almost every
// row. `verified` vs `unknown` is returned so a caller that must not print an
// unproven number (the debrief prose) can demand the stronger grade.
//
// PURE. No I/O, no D1, no clock.

/** Parse an odds column that may arrive as JSON text or an object. */
export function parseOddsJSON(raw) {
    if (!raw) return null;
    try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (_) { return null; }
}

/**
 * Is this blob known to have been captured after kickoff?
 * True ONLY on an explicit `verified: false` mark. No mark => not known late.
 */
export function knownPostKickoff(odds) {
    return odds?._kickoff?.verified === false;
}

/** Minutes after kickoff this blob was captured, or null when unknown. */
export function lateMinutes(odds) {
    const n = odds?._kickoff?.late_minutes;
    return Number.isFinite(n) ? n : null;
}

/**
 * Pick the price a consumer should read.
 *
 * @param {object} game row carrying opening_odds / closing_odds
 * @param {{requirePreKickoff?: boolean}} opts
 *   requirePreKickoff true  — skip any blob marked post-kickoff (the rule)
 *   requirePreKickoff false — `closing || opening`, the behaviour before
 *                             2026-09-14, kept callable so the flip between
 *                             the two can be counted rather than asserted.
 * @returns {{odds: object|null, source: 'closing'|'opening'|null,
 *            confidence: 'verified'|'unknown'|'none', skipped: string[]}}
 */
export function selectLineOdds(game, { requirePreKickoff = true } = {}) {
    const skipped = [];
    for (const source of ['closing', 'opening']) {
        const odds = parseOddsJSON(game?.[`${source}_odds`]);
        if (!odds) continue;
        if (requirePreKickoff && knownPostKickoff(odds)) { skipped.push(source); continue; }
        const confidence = odds?._kickoff?.verified === true ? 'verified' : 'unknown';
        return { odds, source, confidence, skipped };
    }
    return { odds: null, source: null, confidence: 'none', skipped };
}

/**
 * Moneyline price for the side that won, or null when unavailable.
 * Callers flag an upset at >= +200; see detectAnomalies.
 */
export function winnerMoneylinePrice(game, opts) {
    const { odds } = selectLineOdds(game, opts);
    if (!odds) return null;
    const hWon = (game.home_score | 0) > (game.away_score | 0);
    const ml = odds.moneyline || odds.h2h || odds.ml;
    if (!ml) return null;
    const winnerPrice = hWon ? (ml.home ?? ml.h ?? ml[0]) : (ml.away ?? ml.a ?? ml[1]);
    if (winnerPrice == null) return null;
    return Number(winnerPrice);
}

/** Point spread for the pre-kickoff line, or null. Callers test |spread| < 3. */
export function lineSpread(game, opts) {
    const { odds } = selectLineOdds(game, opts);
    if (!odds) return null;
    const spread = odds.spread?.home ?? odds.spread?.away ?? odds.line ?? null;
    if (spread == null) return null;
    const n = Number(spread);
    return Number.isFinite(n) ? n : null;
}
