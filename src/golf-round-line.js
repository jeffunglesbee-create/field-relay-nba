// A golf competitor's CURRENT round from ESPN's scoreboard linescores: which round, the score for
// that round (`today`) and holes completed in it (`thru`). Pure, so scripts/check-golf-round-line.mjs
// holds it against a real read without ESPN.
//
// ESPN's scoreboard gives each competitor one linescores[] entry per round (`period`, `displayValue`,
// and the round's per-hole `linescores`); a round not begun carries displayValue null and no holes.
// The relay read `today` and `thru` from linescores[0] — round 1 — in EVERY round, so from round 2 on
// every player who had finished round 1 showed thru 18 and round 1's score as "today". The client's
// round-complete fallback (top 60 all thru >= 18) then fired the moment a new round began: the RSM
// round-2 archive row was written at 2026-11-20 15:34:46Z, before round 2's last tee (15:42Z).
// Read 2026-11-21: outbox/golf-scoreboard-rsm-after-r2-2026-11-21.json.
//
// `holesOf(entry)` returns how many holes an entry has. The real scoreboard nests them as an array;
// the fixture stores the count.
export function golfRoundLine(linescores, holesOf = (l) => (Array.isArray(l?.linescores) ? l.linescores.length : 0), regularRounds = null) {
    if (!Array.isArray(linescores)) return { round: null, today: null, thru: null };
    // Only the tournament's regular rounds count. A playoff is a later linescore (period 5 at the
    // 2026-11-23 RSM Classic, then an empty period 402) and carries no flag on the scoreboard, so
    // without the cap a playoff read as round 5 and round 4 was never archived
    // (outbox/golf-scoreboard-rsm-final-2026-11-23.json). `regularRounds` is the leaderboard's
    // tournament.numberOfRounds; null leaves every entry counted, as before.
    const cap = Number.isInteger(regularRounds) && regularRounds > 0 ? regularRounds : null;
    const rounds = cap === null ? linescores : linescores.filter(l => Number(l?.period) <= cap);
    // A round has begun when it has a score or any hole. "-" is ESPN's mark for a round with no score
    // (players listed in the RSM playoff who did not play its hole), so it is not a score.
    const begun = rounds.filter(l => hasScore(l) || holesOf(l) > 0);
    if (begun.length === 0) return { round: null, today: null, thru: null };
    const round = begun.length;
    const cur = rounds.find(l => Number(l?.period) === round) ?? null;
    const holes = cur ? holesOf(cur) : 0;
    return { round, today: hasScore(cur) ? cur.displayValue : null, thru: holes > 0 ? holes : null };
}

const hasScore = (l) => l?.displayValue !== null && l?.displayValue !== undefined && l.displayValue !== '-';

// A to-par string ("E", "-4", "+2") as a number, or null.
const parToPar = (v) => {
    if (v === 'E') return 0;
    const n = Number(v);
    return typeof v === 'string' && /^[+-]?\d+$/.test(v) && Number.isFinite(n) ? n : null;
};

// The tournament total to par over the regular rounds only, when a competitor has a scored entry
// beyond them (a playoff). ESPN's scoreboard `score` then includes the playoff holes: -17 for the
// 2026-11-23 RSM winner, whose official total is -16 (the leaderboard's scoreToPar). Null when
// there is no playoff entry, so the caller keeps ESPN's own total; null when a regular round
// cannot be read, rather than a partial sum.
export function regularToPar(linescores, regularRounds) {
    if (!Array.isArray(linescores) || !Number.isInteger(regularRounds) || regularRounds < 1) return null;
    const beyond = linescores.some(l => Number(l?.period) > regularRounds && Number(l?.period) < 100 && hasScore(l));
    if (!beyond) return null;
    let sum = 0;
    for (let p = 1; p <= regularRounds; p++) {
        const v = parToPar(linescores.find(l => Number(l?.period) === p)?.displayValue);
        if (v === null) return null;
        sum += v;
    }
    return sum === 0 ? 'E' : sum > 0 ? `+${sum}` : String(sum);
}

// A playoff, from ESPN's golf LEADERBOARD (which flags it; the scoreboard does not): the competitors
// with status.playoff true, each one's playoff linescore (isPlayoff), the earliest playoff tee time,
// and the winner (the playoff player in position "1", untied). `complete` is the event's own
// completed flag. Null when nobody is in a playoff.
export function golfPlayoffFrom(competitors, eventCompleted) {
    if (!Array.isArray(competitors)) return null;
    const players = competitors.filter(c => c?.status?.playoff === true);
    if (players.length === 0) return null;
    const tees = [];
    const rows = players.map(c => {
        const pl = (Array.isArray(c.linescores) ? c.linescores : []).filter(l => l?.isPlayoff === true);
        for (const l of pl) if (typeof l.teeTime === 'string' && !Number.isNaN(Date.parse(l.teeTime))) tees.push(Date.parse(l.teeTime));
        const scored = pl.filter(hasScore);
        return {
            athleteId: String(c.id ?? c.athlete?.id ?? ''),
            name: c.athlete?.displayName ?? c.name ?? null,
            result: scored.length ? scored.map(l => l.displayValue).join(' ') : null,
            position: c.status?.position?.displayName ?? null,
        };
    });
    const winners = rows.filter(r => r.position === '1');
    return {
        start: tees.length ? new Date(Math.min(...tees)).toISOString() : null,
        players: rows,
        winner: winners.length === 1 ? winners[0] : null,
        complete: eventCompleted === true,
    };
}
