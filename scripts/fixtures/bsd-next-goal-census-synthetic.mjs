// SYNTHETIC ledger rows, R2 listings and incidents.json captures for the census checks. The ledger row keys are the ones the
// real /next-goal/calls/ rows carry (measured 2026-11-22: id, event{...}, minute, side, team, probability, score_at_call,
// outcome, resolved_minute, called_at, resolved_at); the capture shapes are those of the committed real examples
// data/bsd-flow-{finished,inplay}-incidents.json in field-laboratory (goal rows with minute and is_home; a `period` row
// "FT" with is_live false and the running score; a live `period` row with is_live true. A period row's minute is a nominal
// marker in the real files (HT 45, FT 90 beside a 6-minute injuryTime), so these fixtures put a DISTINCT number on the live
// row to prove the census does not read it as a clock).
// Nothing here is vendor data. Shared by check-bsd-next-goal-census.mjs and check-bsd-next-goal-census-run.mjs.

export const call = (o) => ({
  id: o.id,
  event: o.noEvent ? { league_id: o.league ?? 1 } : { id: o.ev, event_date: '2026-11-01T15:00:00Z', status: 'finished', home_team_id: 1, home_team: `Alpha ${o.ev}`, away_team_id: 2, away_team: `Beta ${o.ev}`, league_id: o.league ?? 1, league_name: 'League' },
  minute: o.minute ?? 30, side: o.side ?? 'home', team: `Alpha ${o.ev}`, probability: 0.8, score_at_call: { home: 0, away: 0 },
  outcome: o.outcome ?? 'hit', resolved_minute: o.rm === undefined ? 55 : o.rm,
  called_at: o.at ?? '2026-11-01T15:30:00Z', resolved_at: o.rm === null ? null : '2026-11-01T16:10:00Z',
});

export const goal = (minute, home = true) => ({ type: 'goal', minute, is_home: home, player: 'P', sequence: [] });
export const ftRow = (h, a, text = 'FT') => ({ type: 'period', text, minute: 90, is_live: false, home_score: h, away_score: a });
export const liveRow = (minute) => ({ type: 'period', text: 'Second half', minute, is_live: true });
export const htRow = (h = 0, a = 0) => ({ type: 'period', text: 'HT', minute: 45, is_live: false, home_score: h, away_score: a });
// a finished capture, an in-play capture with a live clock, an in-play capture with no clock marker, garbage
export const ftCapture = (goals, h, a, text) => ({ event_id: 0, incidents: [ftRow(h, a, text), { type: 'injuryTime', length: 4, minute: 90 }, ...goals] });
export const liveCapture = (minute, goals) => ({ event_id: 0, incidents: [liveRow(minute), htRow(), ...goals] });
export const htCapture = (goals) => ({ event_id: 0, incidents: [htRow(), ...goals] });

export const key = (slug, id, file = 'incidents.json') => ({ key: `bsd/${slug}/${id}/${file}`, size: 5000, uploaded: '2026-11-01T18:00:00.000Z' });
export const listPage = (keys, o = {}) => ({ prefix: o.prefix ?? 'bsd/', limit: 1000, prefixSource: 'request', keys, truncated: Boolean(o.cursor), cursor: o.cursor ?? null });
export const page = (rows, extra = {}) => ({ count: rows.length, next: null, previous: null, results: rows, ...extra });

// ---- one small world with every branch in it
export const EVENTS = {
  101: { slug: 'epl', league: 1, files: ['incidents.json', 'stats.json'] },     // finished capture, goals at 20 and 60, score 1-1
  102: { slug: 'epl', league: 1, files: ['incidents.json'] },                  // in play (live row says 70), goals at 20 and 60
  103: { slug: 'mls', league: 2, files: ['incidents.json'] },                  // half-time row only, one goal at 40
  104: { slug: 'epl', league: 1, files: ['incidents.json'] },                  // listed, read answers 404
  105: { slug: 'epl', league: 1, files: ['incidents.json'] },                  // listed, read answers 500
  106: { slug: 'epl', league: 1, files: ['incidents.json'] },                  // listed, read answers garbage
  107: { slug: 'epl', league: 1, files: ['stats.json'] },                      // no incidents.json at all
  108: { slug: 'other', league: 99, files: ['incidents.json', 'stats.json'] }, // finished capture in an untracked league, score 2-0 with 1 goal
  109: { slug: 'epl', league: 1, files: ['incidents.json'] },                  // listed, never read (cap)
};
export const worldKeys = () => {
  const ks = [];
  for (const [id, e] of Object.entries(EVENTS)) for (const f of e.files) ks.push(key(e.slug, id, f));
  ks.push({ key: 'bsd/meta.json', size: 10, uploaded: 'x' }, { key: 'bsd/odds/summary', size: 10, uploaded: 'x' });
  return ks;
};
export const worldCalls = () => [
  call({ id: 1, ev: 101, outcome: 'hit', rm: 60 }),          // full time; the goal is at 60 (distance 0)
  call({ id: 2, ev: 101, outcome: 'miss', rm: 70 }),         // full time; nearest goal 60 (distance 10)
  call({ id: 3, ev: 102, outcome: 'hit', rm: 60, at: '2026-10-20T15:30:00Z' }),  // in play; the goal is at 60 (0): covered
  call({ id: 4, ev: 102, outcome: 'hit', rm: 75 }),          // in play; no goal near 75 (the live row's 70 is not a clock)
  call({ id: 5, ev: 103, outcome: 'miss', rm: 42, league: 2 }),  // half-time row; goal at 40 is 2 away: not within 1
  call({ id: 6, ev: 103, outcome: 'hit', rm: 41, league: 2 }),   // half-time row; goal at 40 is 1 away: covered
  call({ id: 7, ev: 104, outcome: 'hit' }),
  call({ id: 8, ev: 105, outcome: 'miss' }),
  call({ id: 9, ev: 106, outcome: 'hit' }),
  call({ id: 10, ev: 107, outcome: 'hit' }),
  call({ id: 11, ev: 108, outcome: 'hit', rm: 11, league: 99 }), // full time, untracked league; goal at 10 (distance 1)
  call({ id: 12, ev: 109, outcome: 'hit' }),
  call({ id: 13, ev: 101, outcome: 'open', rm: null }),
  call({ id: 14, ev: 102, outcome: 'nogoal', rm: null }),
  call({ id: 15, ev: 101, outcome: 'hit', rm: null }),
  call({ id: 16, noEvent: true, outcome: 'hit', rm: 55 }),
];
export const worldReads = () => new Map([
  ['101', { status: 200, json: ftCapture([goal(20, true), goal(60, false)], 1, 1) }],
  ['102', { status: 200, json: liveCapture(70, [goal(20), goal(60, false)]) }],
  ['103', { status: 200, json: htCapture([goal(40)]) }],
  ['104', { status: 404 }],
  ['105', { status: 500 }],
  ['106', { status: 200, json: {} }],
  ['108', { status: 200, json: ftCapture([goal(10)], 2, 0) }],
]);
