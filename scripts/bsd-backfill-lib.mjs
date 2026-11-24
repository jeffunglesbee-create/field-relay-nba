// PURE: imports nothing. The accounting behind scripts/bsd-game-join-backfill.mjs, the owner-approved backfill (2026-11-24, "Backfill approved")
// of option (a) in the 2026-11-15 addendum of docs/CC-CMD-2026-10-28-bsd-join-aliases-beyond-the-fixture-dates.md: fill bsd_event_id on the
// soccer archive rows of the dates that nothing visited, through POST /admin/bsd-game-join, a few dates a day.
//
// This file decides WHICH dates, what each answer MEANS, and WHEN TO STOP. Every one of those is a rule that, if wrong, either leaves
// rows unjoined while the run reports done, or keeps writing after something said stop; each has a mutant in mutate-bsd-backfill-lib.mjs.

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string';
const proto = () => Object.create(null);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const real = (d) => DAY.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;

/** Every day from `from` to `to` inclusive, or null when either is not a real day or the range is empty or longer than `maxDays`. */
export function daysBetween(from, to, maxDays = 400) {
  if (!isStr(from) || !isStr(to) || !real(from) || !real(to) || from > to) return null;
  const out = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86400000) {
    out.push(new Date(t).toISOString().slice(0, 10));
    if (out.length > maxDays) return null;
  }
  return out;
}

/** The rows of one /context/date read, or null when it is not the contract's shape (an unread day is never an empty day). */
export function rowsOfDay(json) {
  if (!isObj(json) || json.ok !== true || !isObj(json.games) || !Array.isArray(json.games.regular)) return null;
  const post = json.games.postseason;
  if (post !== undefined && !Array.isArray(post)) return null;
  return post === undefined ? json.games.regular : json.games.regular.concat(post);
}

/** Soccer rows in `sports` that carry no bsd_event_id, by sport. A row is pending when its id is null, undefined or the empty string. */
export function pendingOf(rows, sports) {
  const bySport = proto();
  let pending = 0, soccer = 0;
  for (const r of rows) {
    if (!isObj(r) || !isStr(r.sport) || !sports.includes(r.sport)) continue;
    soccer++;
    if (r.bsd_event_id === null || r.bsd_event_id === undefined || String(r.bsd_event_id) === '') {
      pending++;
      bySport[r.sport] = (bySport[r.sport] === undefined ? 0 : bySport[r.sport]) + 1;
    }
  }
  return { soccer, pending, bySport };
}

/**
 * @param survey Map<day, {pending: number} | null>   null = that day was not read
 * Oldest first; days with nothing pending are not chosen; a day that was not read is never counted as clean.
 */
export function planDates({ survey, maxDates }) {
  const days = [...survey.keys()].sort();
  const withWork = days.filter((d) => survey.get(d) !== null && survey.get(d).pending > 0);
  const unread = days.filter((d) => survey.get(d) === null);
  const chosen = withWork.slice(0, maxDates);
  return { chosen, pendingDays: withWork.length, remainingAfter: withWork.length - chosen.length, unread, readDays: days.length - unread.length,
    pendingRows: withWork.reduce((a, d) => a + survey.get(d).pending, 0),
    complete: withWork.length === 0 && unread.length === 0 && days.length > 0 };
}

/** What one admin-route answer means. Order matters: a refusal, a throttle and a failed read are not "nothing pending". */
export function outcomeOf(resp) {
  if (!isObj(resp)) return 'failed';
  if (resp.status === 401 || resp.status === 403) return 'refused';
  if (resp.status === 429) return 'throttled';
  if (resp.ok !== true) return 'failed';
  if (resp.pending === 0) return 'nothing-pending';
  if (Number.isInteger(resp.written) && resp.written > 0) return 'joined';
  if (!(Number.isInteger(resp.eventsRead) && resp.eventsRead > 0)) return 'bsd-has-no-events';
  return 'none-matched';
}

/** Did the rows change by what the route said it wrote? Both counts come from different reads: the route's, and /context/date's. */
export function verifyOf({ pendingBefore, pendingAfter, written }) {
  if (![pendingBefore, pendingAfter, written].every((n) => Number.isInteger(n) && n >= 0)) return { verified: false, why: 'a count was not a whole number' };
  const expected = pendingBefore - written;
  return pendingAfter === expected ? { verified: true, expected } : { verified: false, expected, why: `pending went ${pendingBefore} -> ${pendingAfter}, the route said it wrote ${written} (expected ${expected})` };
}

/** After each date: should the run stop, and why. A refusal or a throttle stops at once; two failed passes in a row stop; a mismatch stops. */
export function stopAfter({ outcomes, verified, pagesUsed, pageCap }) {
  const last = outcomes[outcomes.length - 1];
  if (last === 'refused') return 'the route refused the secret';
  if (last === 'throttled') return 'the route answered 429';
  if (verified === false) return 'what the route said it wrote is not what /context/date shows';
  if (outcomes.length >= 2 && outcomes[outcomes.length - 2] === 'failed' && last === 'failed') return 'two failed passes in a row';
  if (pagesUsed >= pageCap) return `upstream pages used ${pagesUsed} reached the cap ${pageCap}`;
  return null;
}
