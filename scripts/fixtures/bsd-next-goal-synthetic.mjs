// SYNTHETIC payloads shaped from the vendor's documentation (https://sports.bzzoiro.com/docs/football/next-goal/)
// and, for events/live, from the field names and the status/period vocabulary of the committed real capture
// outbox/bsd-uefa-probe-20260919T161717Z.txt (finished/FT with a null current_minute; inprogress with 1st_half,
// 2nd_half, halftime). None of this is vendor data and none of it says anything about the vendor's accuracy; it
// exists so the probe's verdicts can be checked against answers we chose. Shared by
// check-bsd-next-goal-probe.mjs (the analysis) and check-bsd-next-goal-probe-run.mjs (the whole run against a stub).

export const ngRow = (o) => ({
  event: { id: o.id, status: o.estatus || '2nd_half', home_team: o.home ?? `Alpha ${o.id}`, away_team: o.away ?? `Beta ${o.id}`,
    home_team_id: o.id * 10, away_team_id: o.id * 10 + 1, league_id: o.league ?? 7, league_name: o.lname || `League ${o.league ?? 7}`,
    event_date: '2026-11-22T13:00:00Z' },
  minute: o.minute ?? 55, score: { home: 0, away: 1 },
  probabilities: o.probs || { home: 0.24, away: 0.62, no_goal: 0.14 },
  leader: o.leader || 'away', confidence: o.conf ?? 0.62,
  is_call: o.call ?? true, call_threshold: o.th ?? 0.6, call_paused: o.paused ?? false, minutes_since_goal: o.msg === undefined ? 18 : o.msg,
  evidence: { momentum_5m: o.m5 ?? -14.2, momentum_15m: o.m15 ?? -9.8, shots_home_10m: o.sh ?? 0, shots_away_10m: o.sa ?? 3, red_cards_home: 0, red_cards_away: 0 },
  track_record: o.tr || { accuracy: 0.72, base_rate: 0.51, brier_skill_score: 0.21, matches_evaluated: 3300 },
  generated_at: o.gen || '2026-11-22T14:00:55Z',
});

// an events/live row: id, league, status, period, current_minute, websocket_plus (the real field names)
export const liveRow = (o) => ({
  id: o.id, league_id: o.league ?? 7, league_name: o.lname || `League ${o.league ?? 7}`,
  home_team_id: o.tid ?? o.id * 10, home_team: o.home ?? `Alpha ${o.id}`, away_team_id: o.id * 10 + 1, away_team: o.away ?? `Beta ${o.id}`,
  event_date: '2026-11-22T13:00:00Z',
  status: o.status || 'inprogress',
  period: o.period === undefined ? ((o.minute ?? 55) < 45 ? '1st_half' : '2nd_half') : o.period,
  current_minute: o.minute === undefined ? 55 : o.minute,
  home_score: 0, away_score: 1, websocket_plus: o.wsp ?? false,
});
// the three states the real feed carries besides a match in play
export const finishedRow = (o) => liveRow({ ...o, status: 'finished', period: 'FT', minute: null });
export const notStartedRow = (o) => liveRow({ ...o, status: 'notstarted', period: null, minute: null });
export const halftimeRow = (o) => liveRow({ ...o, status: 'inprogress', period: 'halftime', minute: 45 });

export const page = (rows, extra = {}) => ({ count: rows.length, next: null, previous: null, results: rows, ...extra });
export const cnt = (n) => ({ count: n, next: null, previous: null, results: [{ minute: 10 }] });

export const THREE = [
  ngRow({ id: 1, league: 7, call: true, conf: 0.62 }),
  ngRow({ id: 2, league: 7, call: false, conf: 0.45, probs: { home: 0.45, away: 0.35, no_goal: 0.2 }, leader: 'home' }),
  ngRow({ id: 3, league: 8, call: true, conf: 0.7, probs: { home: 0.1, away: 0.7, no_goal: 0.2 } }),
];
