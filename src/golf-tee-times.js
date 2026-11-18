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

