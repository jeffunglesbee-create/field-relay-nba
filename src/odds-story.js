// src/odds-story.js
// Odds Story Materializer — pre-computed line movement narrative for the
// journalism prompt. Pure arithmetic on opening_odds vs closing_odds JSON,
// emitted as a one-line "[ODDS STORY] ..." block. ADR-002 / Rule 47 clean:
// factual transformation of published betting lines, no drama scoring,
// no named binary conditions (RUWT US 9,421,446 B2). Same category as
// reporting a stock price change.
//
// Odds JSON shape (per pre-build probe against ARCHIVE_DB):
//   { source, captured_at, moneyline:{home,away}, total:{over,under}, spread?:{home,away} }
// `spread` is present on DraftKings rows but absent on FanDuel — null-guard
// every nested field. Opening and closing may come from different sources;
// that's expected and fine for movement computation.

export function computeOddsStory(openingOdds, closingOdds) {
    if (!openingOdds || !closingOdds) return '';

    let open, close;
    try {
        open  = typeof openingOdds === 'string' ? JSON.parse(openingOdds) : openingOdds;
        close = typeof closingOdds === 'string' ? JSON.parse(closingOdds) : closingOdds;
    } catch {
        return '';
    }
    if (!open || !close) return '';

    const parts = [];

    const oML = open.moneyline;
    const cML = close.moneyline;
    if (oML?.home != null && cML?.home != null) {
        const diff = cML.home - oML.home;
        if (Math.abs(diff) >= 10) {
            const direction = diff < 0 ? 'favorite-ward' : 'underdog-ward';
            parts.push(
                `ML moved ${Math.abs(diff)} pts ${direction}` +
                ` (opened ${oML.home > 0 ? '+' : ''}${oML.home},` +
                ` closed ${cML.home > 0 ? '+' : ''}${cML.home})`
            );
        }
    }

    const oSP = open.spread;
    const cSP = close.spread;
    if (oSP?.home != null && cSP?.home != null) {
        const diff = cSP.home - oSP.home;
        if (Math.abs(diff) >= 0.5) {
            const direction = diff < 0 ? 'toward home' : 'toward away';
            parts.push(
                `Spread moved ${Math.abs(diff).toFixed(1)} ${direction}` +
                ` (opened ${oSP.home > 0 ? '+' : ''}${oSP.home},` +
                ` closed ${cSP.home > 0 ? '+' : ''}${cSP.home})`
            );
        }
    }

    const oTO = open.total;
    const cTO = close.total;
    if (oTO?.over != null && cTO?.over != null) {
        const diff = cTO.over - oTO.over;
        if (Math.abs(diff) >= 0.5) {
            const direction = diff > 0 ? 'over pressure' : 'under pressure';
            parts.push(
                `Total moved ${Math.abs(diff).toFixed(1)}` +
                ` (opened ${oTO.over}, closed ${cTO.over})` +
                ` — ${direction}`
            );
        }
    }

    if (!parts.length) return '';
    return '[ODDS STORY] ' + parts.join('. ') + '.';
}
