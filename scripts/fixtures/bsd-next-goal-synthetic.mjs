// SYNTHETIC payloads shaped from the vendor's documentation (https://sports.bzzoiro.com/docs/football/next-goal/).
// None of this is vendor data and none of it says anything about the vendor's accuracy; it exists so the
// probe's verdicts can be checked against answers we chose. Shared by check-bsd-next-goal-probe.mjs (the
// analysis) and check-bsd-next-goal-probe-run.mjs (the whole run against a stub server).

export const ngRow = (o) => ({
  event: { id: o.id, status: '2nd_half', home_team: o.home || `Alpha ${o.id}`, away_team: o.away || `Beta ${o.id}`,
    home_team_id: o.id * 10, away_team_id: o.id * 10 + 1, league_id: o.league ?? 7, league_name: o.lname || `League ${o.league ?? 7}`,
    event_date: '2026-11-22T13:00:00Z' },
  minute: o.minute ?? 55, score: { home: 0, away: 1 },
  probabilities: o.probs || { home: 0.24, away: 0.62, no_goal: 0.14 },
  leader: o.leader || 'away', confidence: o.conf ?? 0.62,
  is_call: o.call ?? true, call_threshold: o.th ?? 0.6, call_paused: false, minutes_since_goal: o.msg === undefined ? 18 : o.msg,
  evidence: { momentum_5m: o.m5 ?? -14.2, momentum_15m: -9.8, shots_home_10m: 0, shots_away_10m: 3, red_cards_home: 0, red_cards_away: 0 },
  track_record: o.tr || { accuracy: 0.72, base_rate: 0.51, brier_skill_score: 0.21, matches_evaluated: 3300 },
  generated_at: '2026-11-22T14:00:55Z',
});
export const liveRow = (o) => ({ id: o.id, home_team: o.home || `Alpha ${o.id}`, away_team: o.away || `Beta ${o.id}`, home_team_id: o.tid ?? o.id * 10,
  league_id: o.league ?? 7, league_name: `League ${o.league ?? 7}`, status: 'inprogress', current_minute: o.minute ?? 55, websocket_plus: o.wsp ?? false });
export const page = (rows) => ({ count: rows.length, next: null, previous: null, results: rows });
export const cnt = (n) => ({ count: n, next: null, previous: null, results: [{ minute: 10 }] });

export const THREE = [
  ngRow({ id: 1, league: 7, call: true, conf: 0.62 }),
  ngRow({ id: 2, league: 7, call: false, conf: 0.45, probs: { home: 0.45, away: 0.35, no_goal: 0.2 }, leader: 'home' }),
  ngRow({ id: 3, league: 8, call: true, conf: 0.7, probs: { home: 0.1, away: 0.7, no_goal: 0.2 } }),
];
