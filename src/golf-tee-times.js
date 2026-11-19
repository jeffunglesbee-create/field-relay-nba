// docs/CC-CMD-2026-11-16-golf-tee-times.md, Task 2. Pure, so it is held by
// scripts/check-golf-tee-times.mjs without ESPN or a Worker.
//
// Earliest and latest teeTime among the
// competitors whose `period` is the round, and how many carried one.
export function summariseGolfTeeTimes(statuses, roundNum) {
    let first = null, last = null, inRound = 0, withTeeTime = 0;
    for (const st of statuses) {
        if (Number(st?.period) !== roundNum) continue;
        inRound++;
        const t = Date.parse(st?.teeTime);
        if (!st?.teeTime || Number.isNaN(t)) continue;
        withTeeTime++;
        if (first === null || t < first) first = t;
        if (last === null || t > last) last = t;
    }
    return {
        round: roundNum,
        roundStart:   first === null ? null : new Date(first).toISOString(),
        roundLastTee: last  === null ? null : new Date(last).toISOString(),
        inRound,
        withTeeTime,
    };
}


// Which round's tee times to summarise. The scoreboard's round, when it has one; before
// a tournament's first shot it has none (linescores are empty: /v2/golf/enriched served
// `round: null` for the RSM Classic on 2026-11-19 00:40Z), while every competitor's status
// already names the round it is teed up for (147 of 147 at `period` 1, the leaderboard read
// in outbox/golf-leaderboard-rsm-r1-2026-11-19.json). The highest such period is the
// current round: players cut stay on the cut round's period while the field moves on.
export function teeTimeRound(scoreboardRound, statuses) {
    const sb = Number(scoreboardRound);
    if (scoreboardRound != null && Number.isInteger(sb) && sb >= 1) return sb;
    let max = null;
    for (const st of statuses) {
        const p = Number(st?.period);
        if (Number.isInteger(p) && p >= 1 && (max === null || p > max)) max = p;
    }
    return max;
}
