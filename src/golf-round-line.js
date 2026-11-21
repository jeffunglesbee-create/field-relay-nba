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
export function golfRoundLine(linescores, holesOf = (l) => (Array.isArray(l?.linescores) ? l.linescores.length : 0)) {
    if (!Array.isArray(linescores)) return { round: null, today: null, thru: null };
    // A round has begun when it has a score or any hole (the rule the relay already used for `round`).
    const begun = linescores.filter(l => (l?.displayValue !== null && l?.displayValue !== undefined) || holesOf(l) > 0);
    if (begun.length === 0) return { round: null, today: null, thru: null };
    const round = begun.length;
    const cur = linescores.find(l => Number(l?.period) === round) ?? null;
    const holes = cur ? holesOf(cur) : 0;
    return { round, today: cur?.displayValue ?? null, thru: holes > 0 ? holes : null };
}
