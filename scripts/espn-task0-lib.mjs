// PURE: imports nothing. The accounting behind Task 0 of field-laboratory
// docs/CC-CMD-2026-11-23-bsd-next-goal-independent-reference.md (the ESPN shape probe, E1, and the reach of the BSD-to-archive join, E2).
// It reads shapes and counts; it never assigns a verdict to a call. Everything it returns is a count or a field name: no id, team, player
// or ledger row is carried out of it (the runner that calls it adds the same rule at the write).
//
// Why a pure module with its own check and mutation harness (CLAUDE.md Rule 90): the first thing Task 0 found, before any of this
// was written, is that a game row can carry bsd_event_id and a NULL espn_event_id (the MLS rows of 2026-10-25). A count that cannot
// be made to fail is how that kind of premise survives, so each rule below has a mutant the harness must catch.

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string';
const proto = () => Object.create(null);                       // vendor strings are keys here: no prototype, no collisions
const bump = (t, k, n = 1) => { t[k] = (t[k] === undefined ? 0 : t[k]) + n; };
const has = (v) => v !== null && v !== undefined && String(v) !== '';
const SAFE_LABEL = /^[A-Za-z0-9][A-Za-z0-9 .'&+()_:-]{0,47}$/;
const SAFE_SLUG = /^[a-z0-9]{1,24}$/;
const SAFE_KEY = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const label = (v) => (isStr(v) && SAFE_LABEL.test(v) ? v : '(other)');

export const BOUNDARY_DAY = '2026-10-24';
export const REASONS = Object.freeze({
  eflchamp: 'eflchamp: no archive rows',
  uefa: "ucl or europa: archive rows, outside the join's sports",
  early: 'before 2026-10-24, no joined row that day',
  other: 'other unjoined',
});
export const TARGET_LABELS = Object.freeze([
  'EFL Championship', 'UEFA Champions League', 'UEFA Europa League', 'UEFA Europa Conference League',
  'UEFA Champions League Qualifying', 'UEFA Europa League Qualifying', 'UEFA Europa Conference League Qualifying',
]);

// ---------------------------------------------------------------- days
export function dayOf(s) {
  if (!isStr(s) || !/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  const d = s.slice(0, 10);
  const t = Date.parse(`${d}T00:00:00Z`);
  return Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== d ? null : d;
}
export const prevDay = (d) => new Date(Date.parse(`${d}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
/** A call's UTC day, and the day before it: the join fetches a UTC day and the next, so the archive row can be a day earlier. */
export function neededDays(callDays) {
  const s = new Set();
  for (const d of callDays) { s.add(d); s.add(prevDay(d)); }
  return [...s].sort();
}
export function daysToRead(matches) {
  const s = new Set();
  for (const m of matches) for (const d of neededDays(validDays(m.callDays))) s.add(d);
  return [...s].sort();
}
const validDays = (a) => (Array.isArray(a) ? a.filter((d) => isStr(d) && dayOf(d) === d) : []);   // isStr: dayOf(null) is null, and null === null

// ---------------------------------------------------------------- the rows of one /context/date read
/** null when the read is not the contract's shape: an unread day must never be counted as an empty one. */
export function rowsOfDay(json) {
  if (!isObj(json) || json.ok !== true || !isObj(json.games) || !Array.isArray(json.games.regular)) return null;
  const post = json.games.postseason;
  if (post !== undefined && !Array.isArray(post)) return null;
  return post === undefined ? json.games.regular : json.games.regular.concat(post);
}

/** Per sport label: rows, rows with a bsd id, rows with an espn id, rows with both. Duplicate row ids across reads count once. */
export function labelStats(dayRows) {
  const byLabel = proto();
  const seen = new Set();
  let rows = 0, noId = 0, duplicates = 0, unreadDays = 0;
  for (const rs of dayRows.values()) {
    if (rs === null) { unreadDays++; continue; }
    for (const r of rs) {
      if (!isObj(r)) continue;
      if (isStr(r.id)) { if (seen.has(r.id)) { duplicates++; continue; } seen.add(r.id); } else noId++;
      rows++;
      const l = label(r.sport);
      if (byLabel[l] === undefined) byLabel[l] = { rows: 0, withBsd: 0, withEspn: 0, withBoth: 0 };
      const e = byLabel[l];
      e.rows++;
      const b = has(r.bsd_event_id), s = has(r.espn_event_id);
      if (b) e.withBsd++;
      if (s) e.withEspn++;
      if (b && s) e.withBoth++;
    }
  }
  const targetLabelRows = proto();
  for (const t of TARGET_LABELS) targetLabelRows[t] = byLabel[t] === undefined ? 0 : byLabel[t].rows;
  return { days: dayRows.size, unreadDays, rows, noIdRows: noId, duplicateRows: duplicates, byLabel, targetLabelRows };
}

// ---------------------------------------------------------------- E2: where does each graded match land
function zeroReason(slug, firstCallDay, boundaryDay) {
  if (slug === 'eflchamp') return REASONS.eflchamp;
  if (slug === 'ucl' || slug === 'europa') return REASONS.uefa;
  if (firstCallDay < boundaryDay) return REASONS.early;
  return REASONS.other;
}

/** The archive rows that carry the match's BSD id on any of `days` (all of them read), each row once. */
function hitsFor(m, days, dayRows) {
  const seen = new Set();
  const hits = [];
  for (const d of days) {
    for (const r of dayRows.get(d)) {
      if (!isObj(r) || r.bsd_event_id === null || r.bsd_event_id === undefined) continue;
      if (String(r.bsd_event_id) !== m.key) continue;
      if (isStr(r.id)) { if (seen.has(r.id)) continue; seen.add(r.id); }
      hits.push(r);
    }
  }
  return hits;
}

/** The reasons a match has no ESPN id besides the four a missing archive row can give (REASONS). */
export const UNREACHED = Object.freeze({
  noDay: 'no valid call day',
  unread: 'a day the match needs was not read',
  noEspn: 'rows carry no ESPN id',
  conflict: 'rows conflict on the ESPN id',
});

/**
 * One entry per match, in order: { reached, reason, espnId }. A match is reached when the rows that carry its BSD id carry exactly ONE distinct
 * non-null espn_event_id between them (two rows that agree are fine). Everything else is a named reason, and an unread day is never a missing row.
 */
export function reachEach({ matches, dayRows, boundaryDay = BOUNDARY_DAY }) {
  return matches.map((m) => {
    const slug = isStr(m.slug) && SAFE_SLUG.test(m.slug) ? m.slug : '(other)';
    const callDays = validDays(m.callDays);
    if (callDays.length === 0) return { reached: false, reason: UNREACHED.noDay, espnId: null };
    const days = neededDays(callDays);
    if (days.some((d) => !dayRows.has(d) || dayRows.get(d) === null)) return { reached: false, reason: UNREACHED.unread, espnId: null };
    const hits = hitsFor(m, days, dayRows);
    if (hits.length === 0) return { reached: false, reason: zeroReason(slug, callDays.slice().sort()[0], boundaryDay), espnId: null };
    const ids = new Set(hits.filter((h) => has(h.espn_event_id)).map((h) => String(h.espn_event_id)));
    if (ids.size === 1) return { reached: true, reason: null, espnId: [...ids][0] };
    return { reached: false, reason: ids.size === 0 ? UNREACHED.noEspn : UNREACHED.conflict, espnId: null };
  });
}

/**
 * @param matches  [{ key: string (the BSD event id), slug: string, callDays: ['YYYY-MM-DD', ...] }]  one per distinct match
 * @param dayRows  Map<'YYYY-MM-DD', rows[] | null>  null = that day's read failed
 * Every match lands in exactly one of: noDay, unread, zero (with one named reason), one, many.
 */
export function reachOf({ matches, dayRows, boundaryDay = BOUNDARY_DAY }) {
  const out = { matches: matches.length, noDay: 0, unread: 0, zero: 0, one: 0, many: 0, bySlug: proto(), zeroReasons: proto(), oneRow: { withEspnId: 0, withoutEspnId: 0 }, espnIds: { one: 0, none: 0, conflict: 0 }, espnBySlug: proto(), daysNeeded: 0 };
  const allDays = new Set();
  for (const m of matches) {
    const slug = isStr(m.slug) && SAFE_SLUG.test(m.slug) ? m.slug : '(other)';
    if (out.bySlug[slug] === undefined) out.bySlug[slug] = { matches: 0, noDay: 0, unread: 0, zero: 0, one: 0, many: 0 };
    const s = out.bySlug[slug];
    s.matches++;
    const callDays = validDays(m.callDays);
    if (callDays.length === 0) { out.noDay++; s.noDay++; continue; }
    const days = neededDays(callDays);
    for (const d of days) allDays.add(d);
    if (days.some((d) => !dayRows.has(d) || dayRows.get(d) === null)) { out.unread++; s.unread++; continue; }
    const hits = hitsFor(m, days, dayRows);
    if (hits.length === 0) { out.zero++; s.zero++; bump(out.zeroReasons, zeroReason(slug, callDays.slice().sort()[0], boundaryDay)); }
    else if (hits.length === 1) { out.one++; s.one++; if (has(hits[0].espn_event_id)) out.oneRow.withEspnId++; else out.oneRow.withoutEspnId++; }
    else { out.many++; s.many++; }
    if (hits.length >= 1) {
      // what the grade needs from the rows is ONE espn id: one distinct non-null id across them (two rows that agree are fine), none at all, or a conflict
      const ids = new Set(hits.filter((h) => has(h.espn_event_id)).map((h) => String(h.espn_event_id)));
      const k = ids.size === 1 ? 'one' : ids.size === 0 ? 'none' : 'conflict';
      out.espnIds[k]++;
      if (out.espnBySlug[slug] === undefined) out.espnBySlug[slug] = { one: 0, none: 0, conflict: 0 };
      out.espnBySlug[slug][k]++;
    }
  }
  out.daysNeeded = allDays.size;
  const reasons = Object.values(out.zeroReasons).reduce((a, n) => a + n, 0);
  out.partitions = out.matches === out.noDay + out.unread + out.zero + out.one + out.many
    && out.zero === reasons && out.one === out.oneRow.withEspnId + out.oneRow.withoutEspnId
    && out.one + out.many === out.espnIds.one + out.espnIds.none + out.espnIds.conflict;
  return out;
}

// ---------------------------------------------------------------- E1: the shape of ESPN's goal rows
export const isGoalRow = (r) => isObj(r) && (r.scoringPlay === true || (isObj(r.type) && isStr(r.type.type) && /goal/i.test(r.type.type)));

export function competitorsOf(ev) {
  const c = isObj(ev) && Array.isArray(ev.competitions) && isObj(ev.competitions[0]) && Array.isArray(ev.competitions[0].competitors) ? ev.competitions[0].competitors : null;
  if (c === null) return null;
  const out = [];
  for (const x of c) {
    const id = isObj(x) && isObj(x.team) && (isStr(x.team.id) || Number.isInteger(x.team.id)) ? String(x.team.id) : null;
    if (id === null) return null;
    out.push({ id, homeAway: isStr(x.homeAway) ? x.homeAway : null, score: isStr(x.score) || Number.isInteger(x.score) ? Number(x.score) : null });
  }
  return out;
}
export function finalTotalOf(ev) {
  const c = competitorsOf(ev);
  if (c === null || c.length !== 2 || c.some((x) => x.score === null || !Number.isInteger(x.score) || x.score < 0)) return null;
  return c[0].score + c[1].score;
}
export const isCompleted = (ev) => isObj(ev) && Array.isArray(ev.competitions) && isObj(ev.competitions[0]) && isObj(ev.competitions[0].status)
  && isObj(ev.competitions[0].status.type) && ev.competitions[0].status.type.completed === true;
/** The most recent completed event with a readable score, or null. */
export function pickRecentFinished(events) {
  let best = null, bestT = -Infinity;
  for (const ev of Array.isArray(events) ? events : []) {
    if (!isCompleted(ev) || finalTotalOf(ev) === null) continue;
    const t = isObj(ev) && isStr(ev.date) ? Date.parse(ev.date) : NaN;
    if (Number.isNaN(t)) continue;
    if (t > bestT) { best = ev; bestT = t; }
  }
  return best;
}

/** Field paths (depth-capped, key names checked) that rows carry, with how many rows carry each and the value types seen. */
export function inventory(rows, { maxPaths = 120, maxDepth = 3 } = {}) {
  const paths = proto();
  let count = 0, truncated = false, unsafeKeys = 0;
  const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
  const walk = (v, p, depth) => {
    if (!isObj(v)) return;
    for (const k of Object.keys(v)) {
      if (!SAFE_KEY.test(k)) { unsafeKeys++; continue; }
      const q = p === '' ? k : `${p}.${k}`;
      if (paths[q] === undefined) {
        if (count >= maxPaths) { truncated = true; continue; }
        paths[q] = { rows: 0, types: proto() };
        count++;
      }
      paths[q].rows++;
      bump(paths[q].types, typeOf(v[k]));
      if (depth + 1 < maxDepth) walk(v[k], q, depth + 1);
    }
  };
  for (const r of rows) walk(r, '', 0);
  return { rows: rows.length, paths, truncated, unsafeKeys };
}

/** What a list of ESPN rows says about its goals: is there a scoring side, a clock, an own-goal flag, and does the count equal the score. */
export function goalShape(rows, { competitorIds, finalTotal }) {
  const o = { rows: rows.length, typeVocabulary: proto(), goalRows: 0, withTeamId: 0, teamIdIsACompetitor: 0, withClock: 0,
    ownGoalKey: 0, ownGoalTrue: 0, penaltyKickKey: 0, scoringPlayTrue: 0, finalTotal, goalRowsEqualFinalTotal: false,
    clockSamples: [], typeTexts: proto() };   // the FORMAT of a goal's clock, and the words ESPN uses for a goal's type: both are what a reader of these rows must be told
  for (const r of rows) {
    if (!isObj(r)) continue;
    bump(o.typeVocabulary, label(isObj(r.type) ? r.type.type : undefined));
    if (!isGoalRow(r)) continue;
    o.goalRows++;
    const tid = isObj(r.team) && (isStr(r.team.id) || Number.isInteger(r.team.id)) ? String(r.team.id) : null;
    if (tid !== null) { o.withTeamId++; if (competitorIds.includes(tid)) o.teamIdIsACompetitor++; }
    if (isObj(r.clock) ? isStr(r.clock.displayValue) : isStr(r.clock)) o.withClock++;
    if (o.clockSamples.length < 4) {
      const c = r.clock;
      const v = isObj(c) && typeof c.value === 'number' && Number.isFinite(c.value) ? c.value : null;
      const dsp = isObj(c) ? c.displayValue : c;
      o.clockSamples.push({ value: v, display: isStr(dsp) ? (/^[0-9+' :.]{1,16}$/.test(dsp) ? dsp : '(other)') : null });
    }
    bump(o.typeTexts, label(isObj(r.type) ? r.type.text : undefined));
    if ('ownGoal' in r) { o.ownGoalKey++; if (r.ownGoal === true) o.ownGoalTrue++; }
    if ('penaltyKick' in r) o.penaltyKickKey++;
    if (r.scoringPlay === true) o.scoringPlayTrue++;
  }
  o.goalRowsEqualFinalTotal = finalTotal !== null && o.goalRows === finalTotal;
  return o;
}

// ---------------------------------------------------------------- ESPN's summary, as the reference grade's core reads it
/**
 * { rows, competitors } from summary.header.competitions[0]: the goal-and-card rows (`details`) and the two competitors as { id: team.id, homeAway,
 * score }, or null when the payload is not that shape. Field names are the ones Task 0 recorded (2026-11-25, summary.header.competitions[0].competitors:
 * id, homeAway, score (a string), team.id (a string); details: scoringPlay, team.id, clock.displayValue, ownGoal, penaltyKick). The rows are passed on
 * untouched: the core picks what it needs and returns counts, so no name leaves it.
 */
export function summaryToEspn(json) {
  const c0 = isObj(json) && isObj(json.header) && Array.isArray(json.header.competitions) && isObj(json.header.competitions[0]) ? json.header.competitions[0] : null;
  if (c0 === null || !Array.isArray(c0.details) || !Array.isArray(c0.competitors)) return null;
  const competitors = [];
  for (const c of c0.competitors) {
    if (!isObj(c) || !isObj(c.team) || !isStr(c.team.id) || !isStr(c.score) || !/^\d{1,3}$/.test(c.score)) return null;
    competitors.push({ id: c.team.id, homeAway: c.homeAway, score: Number(c.score) });
  }
  return { rows: c0.details, competitors };
}

/**
 * The event id a summary says it is for: header.id as text, or null when it carries none. The grade asks ESPN for one event by id and compares this with the id it
 * asked for, so an answer for another event cannot be graded as the match (2026-11-25, the independent reader: nothing recorded whether header.id is present, so the
 * runner COUNTS matched, absent and differing, and refuses only a differing one).
 */
export function summaryEventId(json) {
  const id = isObj(json) && isObj(json.header) ? json.header.id : null;
  if (isStr(id) && id !== '') return id;
  return Number.isInteger(id) && id >= 0 ? String(id) : null;
}

// ---------------------------------------------------------------- the league slugs, read from the relay's own registry text
/** { slug: espnLeague } for every registry entry written as  'slug': { sport: 'soccer', espnLeague: '...' */
export function registryFromSource(text) {
  const out = proto();
  const re = /'([a-z0-9]{1,24})':\s*\{\s*sport:\s*'soccer',\s*espnLeague:\s*'([a-z0-9._]{1,40})'/g;
  let m;
  while ((m = re.exec(text)) !== null) if (out[m[1]] === undefined) out[m[1]] = m[2];
  return out;
}
