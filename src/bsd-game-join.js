// Join an archived soccer game row to a BSD event, so a game can find its lineup
// (docs/CC-CMD-2026-10-27-bsd-event-id-on-game-rows.md, Task 2). PURE: no env, no fetch, no D1.
//
// WHAT IT IS NOT. It is not a matcher of its own. `resolveTeamKey` is the one team-name resolver this
// repo has, and every comparison here goes through it, so an alias added there reaches this join and
// nothing is copied. The odds join's token-prefix matcher (odds-name-match.js) is for the vendor that
// appends a mascot to a college name; BSD names clubs, and `resolveTeamKey` already knows them.
//
// THE RULE, in order, and nothing else:
//   1. Only a soccer row. A baseball row named "Tigers" must never reach an English club.
//   2. A candidate is an event whose home AND away resolve to the row's home AND away, SAME orientation.
//      The live enrichment block in handleV2Games matches either orientation; this does not copy that.
//   3. Exactly one candidate. Two or more is ambiguous, none is unmatched. Never the first of several.
//   4. The kickoff instant may REFUSE and never chooses (owner ruling 2026-10-19, odds-name-match.js):
//      a pair more than BSD_KICKOFF_REFUSE_MINUTES apart is refused. A row with no start_time refuses
//      nothing and is reported as `unjudged`, so a caller counts it rather than reading it as a pass.
//
// Measured basis, so the numbers are not folklore (field-laboratory outbox/cc-session-2026-10-26-bsd-join-probe.md,
// two committed dates, 93 games): among joined games that carried a start_time the gap to the BSD event was 0
// minutes at the median and at the maximum, so 180 refuses a real mismatch and clips nothing measured.

import { resolveTeamKey } from './identity-resolver.js';

export const BSD_SOCCER_SPORTS = ['MLS', 'EPL', 'La Liga', 'Serie A', 'Bundesliga', 'Ligue 1'];
export const BSD_KICKOFF_REFUSE_MINUTES = 180;

/** The BSD events to fetch for an archive date: that UTC day AND the next. BSD's `date` is a UTC day, and a late US
 *  game (00:30Z to 02:30Z) is on the following one; the context date alone never returns it (14 of 93 measured). */
export function eventDaysFor(isoDate) {
  const next = new Date(Date.parse(`${isoDate}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  return [isoDate, next];
}

const nameOf = t => (t && typeof t === 'object' ? t.name : t);

function minutesApart(row, event) {
  const a = Date.parse(row.start_time);
  const b = Date.parse(event.event_date);
  return Number.isNaN(a) || Number.isNaN(b) ? null : Math.abs(a - b) / 60000;
}

/**
 * @param {{sport?: string, home?: string, away?: string, start_time?: string|null}} row
 * @param {Array<{id: number|string, home_team: any, away_team: any, event_date?: string}>} events
 * @returns {{bsd_event_id: string|null, how: string, kickoff?: 'ok'|'unjudged', candidates?: number}}
 */
export function joinGameToBsd(row, events) {
  if (!BSD_SOCCER_SPORTS.includes(row?.sport)) return { bsd_event_id: null, how: 'not-soccer' };
  const h = resolveTeamKey(row.home);
  const a = resolveTeamKey(row.away);
  if (!h || !a) return { bsd_event_id: null, how: 'unmatched', candidates: 0 };
  const candidates = (events || []).filter(e =>
    resolveTeamKey(nameOf(e.home_team)) === h && resolveTeamKey(nameOf(e.away_team)) === a);
  if (candidates.length === 0) return { bsd_event_id: null, how: 'unmatched', candidates: 0 };
  if (candidates.length > 1) return { bsd_event_id: null, how: 'ambiguous', candidates: candidates.length };
  const e = candidates[0];
  const gap = minutesApart(row, e);
  if (gap !== null && gap > BSD_KICKOFF_REFUSE_MINUTES) return { bsd_event_id: null, how: 'refused-kickoff', candidates: 1 };
  return { bsd_event_id: String(e.id), how: 'joined', kickoff: gap === null ? 'unjudged' : 'ok', candidates: 1 };
}

/** The whole batch: one result per row, and the counts a caller prints beside the verdict. */
export function joinBatch(rows, events) {
  const results = rows.map(r => ({ id: r.id, ...joinGameToBsd(r, events) }));
  const counts = { rows: rows.length, joined: 0, ambiguous: 0, unmatched: 0, refusedKickoff: 0, notSoccer: 0, unjudgedKickoff: 0 };
  for (const r of results) {
    if (r.how === 'joined') { counts.joined++; if (r.kickoff === 'unjudged') counts.unjudgedKickoff++; }
    else if (r.how === 'ambiguous') counts.ambiguous++;
    else if (r.how === 'unmatched') counts.unmatched++;
    else if (r.how === 'refused-kickoff') counts.refusedKickoff++;
    else if (r.how === 'not-soccer') counts.notSoccer++;
  }
  return { results, counts };
}
