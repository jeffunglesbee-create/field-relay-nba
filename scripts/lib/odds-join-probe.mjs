// The Saturday identity-join probe's reading of /identity/mismatches, as pure functions so a check can run
// them and a mutation can break them (docs/CC-CMD-2026-10-19-cfb-saturday-coverage-and-join-probe.md, B2).
//
// WHY THE VERDICTS CHANGED (2026-10-29). The old classifier read `d1_missing === 0` as NO_ROWS and exited 0,
// and CFB read NO_ROWS in all 7 scheduled artifacts. But the opening-line cron prices a game the morning it is
// played, so a join that WORKS leaves no unpriced rows: "all priced" and "no rows at all" looked identical,
// and a probe that can only say "green" for both measures nothing. The route now reports d1_rows and d1_priced,
// and the two cases are told apart.
//
// WHAT THE LEFTOVER ROWS CAN AND CANNOT SAY. An unpriced row is joined against the vendor's LIVE feed, which drops
// a game some time after it ends. So a row that has started or finished says nothing about the join when it is
// absent from the feed; only an unfinalized row that has NOT started should be in it. The classifier therefore
// counts those (Q below) and lets only them decide between "the join fails" (C2_JOIN) and "no evidence"
// (NO_JOIN_EVIDENCE). The route reports start_time and finalized on every unmatched row for exactly this.
export const SPORTS = ['CFB', 'NFL', 'Bundesliga', 'MLS'];
// The sport this probe exists for. A verdict that fails the run for it fails the run; the other three are
// context, and NFL legitimately has no Saturday slate.
export const REQUIRED = ['CFB'];

// Verdicts that measured nothing.
const REFUSALS = ['ABSENT_FROM_REPORT', 'SHAPE_UNEXPECTED', 'DENOMINATOR_UNREADABLE', 'DENOMINATOR_INCONSISTENT',
  'NO_ROWS_AT_ALL', 'C0_GUARDED', 'C1_VENDOR'];
// Verdicts that measured the property the probe exists for, and found it failing.
const FINDINGS = ['C2_JOIN'];

/** The leading code of a verdict: everything before the first colon. */
export const codeOf = (verdict) => String(verdict).split(':')[0];

/** A refusal measured nothing: the run must not read as a green one. */
export const isRefusal = (verdict) => REFUSALS.includes(codeOf(verdict));

/** What fails the run for a required sport: a refusal, or a measured failure of the join. */
export const failsRun = (verdict) => isRefusal(verdict) || FINDINGS.includes(codeOf(verdict));

/** The weekday of a calendar date label (0 = Sunday), independent of any timezone. */
export function weekdayOf(date) {
  const t = Date.parse(`${date}T12:00:00Z`);
  return Number.isFinite(t) ? new Date(t).getUTCDay() : null;
}

const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * One sport's entry of the route's report -> a verdict string "CODE: detail".
 * `nowMs` is the probe's own clock, used to tell an unmatched row whose game has not started (it SHOULD be in the
 * vendor feed, so it is a join suspect) from one already played (the feed may no longer list it).
 */
export function classify(e, date, nowMs) {
  if (!e) return 'ABSENT_FROM_REPORT';
  // Our own guard declining the call (the route's cap, the day or the month) is not the vendor failing to
  // serve, and C1 would send the reader after a cause that is ours.
  if (e.guarded === true) return `C0_GUARDED: ${e.error}`;
  if (e.error) return `C1_VENDOR: ${e.error}`;
  const mt = finite(e.matched), ev = finite(e.odds_events), miss = finite(e.d1_missing);
  const un = Array.isArray(e.unmatched) ? e.unmatched : null;
  if (mt === null || un === null || ev === null || miss === null)
    return `SHAPE_UNEXPECTED: ${JSON.stringify(Object.keys(e))}`;
  // Fields the route only sends since 2026-10-29. A denominator the route could not send is absent, never 0: it
  // must not be read as an empty slate.
  const rows = finite(e.d1_rows), priced = finite(e.d1_priced), late = finite(e.d1_priced_late);
  const win = finite(e.odds_events_in_window), pr = finite(e.priceable), sm = finite(e.slate_matched);
  const absent = Object.entries({ d1_rows: rows, d1_priced: priced, d1_priced_late: late, odds_events_in_window: win,
    priceable: pr, slate_matched: sm }).filter(([, v]) => v === null).map(([k]) => k);
  if (absent.length) return `DENOMINATOR_UNREADABLE: missing or not a number: ${absent.join(', ')}`;
  // The route builds these from one set of rows, so they are counts and must add up. A report that does not is not
  // read. (More priced than rows needs no clause of its own: it makes rows - priced negative, and d1_missing is not.)
  const counts = [rows, priced, late, win, pr, sm, mt, miss];
  if (counts.some(v => !Number.isInteger(v) || v < 0) || rows - priced !== miss || mt + un.length !== miss || late > priced || pr > mt)
    return `DENOMINATOR_INCONSISTENT: d1_rows ${rows}, d1_priced ${priced} (late ${late}), d1_missing ${miss}, matched ${mt} (priceable ${pr}), unmatched ${un.length}`;
  if (rows === 0) {
    return win > 0
      ? `NO_ROWS_AT_ALL: the archive holds no ${e.sport_key} rows on ${date}, and the vendor lists ${win} events for it`
      : `NO_SLATE: no ${e.sport_key} rows on ${date} and the feed lists none for it (vendor had ${ev} events in all)`;
  }
  if (miss === 0) {
    return late === 0
      ? `ALL_PRICED: ${priced} of ${rows} rows carry an opening line (vendor had ${ev} events)`
      : `PRICED_LATE: ${priced} of ${rows} rows carry an opening line, ${late} of them captured after kickoff (vendor had ${ev} events)`;
  }
  if (ev === 0) return `C1_VENDOR: fetch ok but 0 events served for ${e.sport_key}`;
  // Q: unmatched rows the feed SHOULD still list: not finalized, and kicking off after now.
  const q = un.filter(u => u && u.finalized === false && Number.isFinite(Date.parse(u.start_time ?? '')) && Date.parse(u.start_time) > nowMs).length;
  const tail = `${priced} of ${rows} rows already priced (${late} after kickoff); slate matcher ${sm}`;
  if (mt === 0 && q === 0)
    return `NO_JOIN_EVIDENCE: ${miss} unpriced rows, all finished or under way, so the live feed cannot say whether the join solves them; ${tail}`;
  if (mt === 0)
    return `C2_JOIN: ${q} unpriced rows have not started and none of the ${miss} unpriced rows joined; ${tail}`;
  return `COVERED: ${mt} of ${miss} unpriced rows join now (${pr} the cron would write); ${un.length} do not, ${q} of them not yet started; ${tail}`;
}
