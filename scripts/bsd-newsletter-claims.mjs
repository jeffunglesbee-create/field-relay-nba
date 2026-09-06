// Answer the four shape claims in Bzzoiro Sports Data's August 2026 newsletter.
//
// The newsletter is an external claim about a vendor surface, which Rule 72
// makes a hypothesis rather than a fact. This probe is how it stops being one.
// Four claims, in the newsletter's own words, and what each needs to settle it:
//
//   1. New live states -- a match at halftime or in extra time now says so, and
//      one that "never reached a confirmed result" now says exactly that.
//      -> enumerate every distinct status/period value across a full day.
//   2. Odds breadth -- BTTS went 8 -> 18 bookmakers; draw-no-bet and European
//      handicap added; opening prices published.
//      -> enumerate market keys, count distinct bookmakers per market, and look
//         for an opening-price field WITHOUT guessing its name.
//   3. Squad/player fields -- injury type and expected return added, retired
//      players removed.
//      -> find whether a squad route exists at all, then read its field names.
//   4. Managers and referees as new endpoints.
//      -> /api/v2/events/ already carries home_coach_id, away_coach_id and
//         referee_id (measured 2026-09-06). Whether anything resolves them is
//         the open question.
//
// UPSTREAM, not through the relay -- deliberately the opposite choice from
// bsd-api-probe.mjs. That probe measures the contract as FIELD serves it, so it
// must go through the Worker. These are claims about what the vendor now
// publishes, and three of the four concern endpoints the relay has no route
// for, so the relay cannot answer them. Needs BSD_API_TOKEN; a runner has it.
//
// Discovery, never assertion. Nothing here asserts the newsletter is right or
// wrong -- it reports what the surface actually returns, including UNKNOWN when
// a call is blocked. A 404 is a FINDING, not a failure, so this exits 0 unless
// the probe itself breaks (Rule 77: a red run invites re-running until green).

import fs from 'node:fs';

const BASE  = process.env.BSD_BASE || 'https://sports.bzzoiro.com';
const TOKEN = process.env.BSD_API_TOKEN || '';
const TS    = new Date().toISOString();
const DATE  = process.env.PROBE_DATE || TS.slice(0, 10);

// Rule 78: bounded. The newsletter itself advertises RateLimit headers, so the
// budget is enforced here AND the headers are reported rather than assumed.
const CALL_BUDGET = Number(process.env.CALL_BUDGET || 40);
let calls = 0;
const rateLimit = {};

const out = { ts: TS, base: BASE, date: DATE, tokenPresent: Boolean(TOKEN), claims: {}, calls: [] };

async function get(path, { note } = {}) {
  if (!TOKEN) return { path, status: null, blocked: 'no BSD_API_TOKEN in env' };
  if (calls >= CALL_BUDGET) return { path, status: null, blocked: `call budget ${CALL_BUDGET} exhausted` };
  calls++;
  const url = `${BASE}${path}`;
  const t0 = Date.now();
  const rec = { path, note };
  try {
    const r = await fetch(url, {
      headers: { Authorization: `Token ${TOKEN}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(30000),
    });
    rec.status = r.status;
    rec.ms = Date.now() - t0;
    for (const h of ['ratelimit-limit', 'ratelimit-remaining', 'ratelimit-reset', 'retry-after']) {
      const v = r.headers.get(h);
      if (v != null) { rec[h] = v; rateLimit[h] = v; }
    }
    const text = await r.text();
    rec.bytes = text.length;
    try { rec.json = JSON.parse(text); }
    catch { rec.nonJson = text.slice(0, 200); }
  } catch (e) { rec.error = String(e.message || e); }
  out.calls.push({ path: rec.path, status: rec.status ?? null, ms: rec.ms ?? null,
                   bytes: rec.bytes ?? null, note: rec.note, error: rec.error, blocked: rec.blocked });
  return rec;
}

// Walk every field name at any depth, so a claim about a field's EXISTENCE is
// answered by looking rather than by guessing what it might be called. Guessing
// field names is how the 2026-09-06 param probe read 0 dates from 50 rows.
function fieldNames(v, prefix = '', acc = new Set(), depth = 0) {
  if (depth > 6 || v == null || typeof v !== 'object') return acc;
  if (Array.isArray(v)) { if (v.length) fieldNames(v[0], `${prefix}[]`, acc, depth + 1); return acc; }
  for (const [k, val] of Object.entries(v)) {
    acc.add(prefix ? `${prefix}.${k}` : k);
    fieldNames(val, prefix ? `${prefix}.${k}` : k, acc, depth + 1);
  }
  return acc;
}
const matching = (names, re) => [...names].filter((n) => re.test(n)).sort();

// What FIELD already consumes, read from src/index.js rather than listed here.
// The relay's own routes are one layer up (bsd-api-probe.mjs counts those); this
// is the UPSTREAM surface -- the BSD paths the Worker actually fetches. A route
// and a fetch are not the same thing: /bsd/events/{id}/shotmap, /momentum and
// /average-positions are three relay routes served by one upstream /stats/ call.
function fieldConsumedPaths(file = 'src/index.js') {
  let src;
  try { src = fs.readFileSync(file, 'utf8'); } catch (_) { return null; }
  const set = new Set();
  for (const m of src.matchAll(/\$\{BSD_BASE\}([^`"']*)/g)) {
    const p = m[1].replace(/\$\{[^}]*\}/g, '{id}').split('?')[0];
    if (p.startsWith('/')) set.add(p);
  }
  return [...set].sort();
}

(async () => {
  console.log(`=== bsd-newsletter-claims  base=${BASE}  date=${DATE}  utc=${TS} ===`);
  if (!TOKEN) console.log('!! BSD_API_TOKEN absent — every claim below will report UNKNOWN, not FALSE.\n');

  // ---------------------------------------------------------------- CLAIM 1
  // Distinct status/period values need a WHOLE day, not the default 50 of 154.
  // The relay's by-date route does not forward limit/offset (src/index.js:10228),
  // which is one reason this probe goes upstream.
  const states = { status: {}, period: {}, pagesWalked: 0, eventsSeen: 0, truncated: false };
  let next = `/api/v2/events/?date_from=${DATE}&date_to=${DATE}&limit=100`;
  for (let page = 0; page < 6 && next; page++) {
    const r = await get(next, { note: `claim1 events page ${page}` });
    if (r.blocked) { states.blocked = r.blocked; break; }
    const rows = r.json?.results;
    if (!Array.isArray(rows)) { states.unexpectedShape = r.json ? Object.keys(r.json) : r.status; break; }
    states.pagesWalked++;
    states.eventsSeen += rows.length;
    for (const e of rows) {
      const s = String(e?.status ?? '(absent)');
      const p = String(e?.period ?? '(absent)');
      states.status[s] = (states.status[s] || 0) + 1;
      states.period[p] = (states.period[p] || 0) + 1;
    }
    if (page === 0) { states.reportedCount = r.json?.count ?? null; states.sampleFields = [...fieldNames(rows[0] ?? {})].sort(); }
    const nx = r.json?.next;
    next = nx ? nx.replace(BASE, '').replace(/^https?:\/\/[^/]+/, '') : null;
  }
  states.truncated = states.reportedCount != null && states.eventsSeen < states.reportedCount;
  // Live events carry the in-play states a day of fixtures mostly will not.
  const liveR = await get('/api/v2/events/live/', { note: 'claim1 live states' });
  const liveRows = Array.isArray(liveR.json) ? liveR.json : (liveR.json?.results ?? liveR.json?.events ?? []);
  states.liveStatus = {};
  states.livePeriod = {};
  for (const e of (Array.isArray(liveRows) ? liveRows : [])) {
    const s = String(e?.status ?? '(absent)'); const p = String(e?.period ?? '(absent)');
    states.liveStatus[s] = (states.liveStatus[s] || 0) + 1;
    states.livePeriod[p] = (states.livePeriod[p] || 0) + 1;
  }
  const allStates = [...Object.keys(states.status), ...Object.keys(states.period),
                     ...Object.keys(states.liveStatus), ...Object.keys(states.livePeriod)];
  // The newsletter names three specific new states. Look for each by meaning,
  // and record the raw vocabulary so a reader can judge the match themselves.
  states.newsletterStates = {
    halftime:   allStates.filter((s) => /half.?time|\bht\b|halftime/i.test(s)),
    extraTime:  allStates.filter((s) => /extra|\bet\b|aet|overtime/i.test(s)),
    noResult:   allStates.filter((s) => /abandon|cancel|awarded|walkover|interrupt|suspend|postpon|no.?result|removed/i.test(s)),
  };
  out.claims.liveStates = states;

  // ---------------------------------------------------------------- CLAIM 2
  // Odds need an event that HAS odds. A not-yet-kicked-off fixture and a
  // finished one both legitimately carry fewer markets, so prefer a live one
  // and record which was used — a market count without its event's state is
  // not comparable to the newsletter's numbers.
  const oddsPick = (Array.isArray(liveRows) ? liveRows : []).find((e) => e?.id != null);
  const odds = { eventId: oddsPick?.id ?? null, eventStatus: oddsPick?.status ?? null };
  if (odds.eventId) {
    const r = await get(`/api/v2/events/${odds.eventId}/odds/comparison/`, { note: 'claim2 odds' });
    if (r.blocked) odds.blocked = r.blocked;
    else if (r.status !== 200) odds.status = r.status;
    else {
      const j = r.json;
      const markets = j?.markets && typeof j.markets === 'object' ? j.markets : j;
      odds.marketKeys = markets && typeof markets === 'object' ? Object.keys(markets).sort() : null;
      odds.marketCount = odds.marketKeys?.length ?? null;
      odds.bookmakersCount = j?.bookmakers_count ?? null;
      odds.totalOdds = j?.total_odds ?? null;
      // Per-market distinct bookmakers — the newsletter's 8 -> 18 claim is
      // per-market, so a top-level bookmakers_count does not answer it.
      odds.bookmakersPerMarket = {};
      for (const [mk, mv] of Object.entries(markets || {})) {
        const books = new Set();
        for (const sel of Object.values(mv || {})) {
          for (const b of Object.keys(sel?.bookmakers || {})) books.add(b);
        }
        if (books.size) odds.bookmakersPerMarket[mk] = books.size;
      }
      const names = fieldNames(j);
      odds.newsletterFields = {
        btts:            odds.marketKeys?.filter((k) => /btts|both.?teams/i.test(k)) ?? [],
        drawNoBet:       odds.marketKeys?.filter((k) => /draw.?no.?bet|dnb/i.test(k)) ?? [],
        europeanHandicap: odds.marketKeys?.filter((k) => /european.?handicap|euro.?hcp/i.test(k)) ?? [],
        openingPriceFields: matching(names, /open(ing)?/i),
        movementFields:     matching(names, /movement|drift|shorten/i),
      };
    }
  } else odds.blocked = 'no live event available to read odds from';
  out.claims.odds = odds;

  // ---------------------------------------------------------------- CLAIM 3+4
  // Squads, managers and referees. Existence is the question, so candidates are
  // TRIED and the result recorded either way — a 404 here is the answer, not an
  // error. IDs come from a real event rather than invented, because a 404 on a
  // made-up id cannot be told apart from a 404 on a missing route.
  const anyEvent = (Array.isArray(liveRows) && liveRows[0]) || null;
  const ids = {
    eventId:  anyEvent?.id ?? null,
    teamId:   anyEvent?.home_team_id ?? null,
    coachId:  anyEvent?.home_coach_id ?? null,
    refereeId: anyEvent?.referee_id ?? null,
  };
  // by-date carries coach/referee ids that live/ may not; take them from there.
  const dayR = await get(`/api/v2/events/?date_from=${DATE}&date_to=${DATE}&limit=1`, { note: 'claim3/4 id seed' });
  const dayRow = dayR.json?.results?.[0];
  if (dayRow) {
    ids.eventId   ??= dayRow.id ?? null;
    ids.teamId    ??= dayRow.home_team_id ?? null;
    ids.coachId   = ids.coachId ?? dayRow.home_coach_id ?? null;
    ids.refereeId = ids.refereeId ?? dayRow.referee_id ?? null;
    ids.venueId   = dayRow.venue_id ?? null;
    ids.seasonId  = dayRow.season_id ?? null;
  }
  out.claims.seedIds = ids;

  // Ask the API to index itself before guessing at it. The payload shape
  // (count/next/previous/results) is Django REST Framework, which conventionally
  // serves a browsable root listing every registered endpoint, and often an
  // OpenAPI schema. If either answers, the "what else is there" question is
  // ANSWERED from the vendor rather than inferred from a candidate list -- the
  // difference between reading the source and reading a copy of it.
  const indexTries = ['/api/v2/', '/api/', '/api/schema/', '/api/v2/schema/',
                      '/api/v2/openapi.json', '/docs/', '/api/docs/'];
  const apiIndex = [];
  for (const path of indexTries) {
    const r = await get(path, { note: 'api self-description' });
    const e = { path, status: r.status ?? null, bytes: r.bytes ?? null, blocked: r.blocked };
    if (r.status === 200 && r.json && typeof r.json === 'object' && !Array.isArray(r.json)) {
      const k = Object.keys(r.json);
      e.topLevelKeys = k.slice(0, 40);
      e.keyCount = k.length;
      // A DRF root view maps name -> absolute URL. An OpenAPI doc has `paths`.
      const urlish = Object.entries(r.json).filter(([, v]) => typeof v === 'string' && /^https?:\/\//.test(v));
      if (urlish.length) e.declaredEndpoints = Object.fromEntries(urlish);
      if (r.json.paths && typeof r.json.paths === 'object') e.openApiPaths = Object.keys(r.json.paths).sort();
    } else if (r.status === 200 && r.nonJson) {
      e.nonJsonHead = r.nonJson.slice(0, 120);
    }
    apiIndex.push(e);
  }
  out.claims.apiIndex = apiIndex;

  const candidates = [
    ['squad (team)',        ids.teamId    && `/api/v2/teams/${ids.teamId}/squad/`],
    ['team',                ids.teamId    && `/api/v2/teams/${ids.teamId}/`],
    ['lineups (event)',     ids.eventId   && `/api/v2/events/${ids.eventId}/lineups/`],
    ['managers list',                        `/api/v2/managers/`],
    ['coaches list',                         `/api/v2/coaches/`],
    ['manager by id',       ids.coachId   && `/api/v2/managers/${ids.coachId}/`],
    ['coach by id',         ids.coachId   && `/api/v2/coaches/${ids.coachId}/`],
    ['referees list',                        `/api/v2/referees/`],
    ['referee by id',       ids.refereeId && `/api/v2/referees/${ids.refereeId}/`],
  ].filter(([, p]) => p);

  const surface = [];
  for (const [label, path] of candidates) {
    const r = await get(path, { note: `claim3/4 ${label}` });
    const entry = { label, path, status: r.status ?? null, bytes: r.bytes ?? null, blocked: r.blocked };
    if (r.status === 200 && r.json) {
      const names = fieldNames(r.json);
      entry.topLevelKeys = Array.isArray(r.json) ? `array[${r.json.length}]` : Object.keys(r.json).slice(0, 15);
      entry.fieldCount = names.size;
      entry.injuryFields  = matching(names, /injur|fitness|doubt|sideline/i);
      entry.returnFields  = matching(names, /return|expected|eta|available/i);
      entry.retiredFields = matching(names, /retire|active|status/i);
    }
    surface.push(entry);
  }
  out.claims.squadManagerReferee = surface;

  // ------------------------------------------------------- WHAT FIELD USES vs
  // ---------------------------------------------------------- WHAT BSD OFFERS
  // Three buckets, because "unused" and "absent" are different answers and
  // collapsing them is how a missing integration gets read as a vendor gap.
  const consumed = fieldConsumedPaths();
  const declared = new Set();
  for (const e of apiIndex) {
    for (const u of Object.values(e.declaredEndpoints || {})) {
      try { declared.add(new URL(u).pathname); } catch (_) { /* not a URL */ }
    }
    for (const p of (e.openApiPaths || [])) declared.add(p);
  }
  // Anything this run actually got a 200 from is offered, whether or not the
  // index named it -- a measured 200 outranks an index that may be incomplete.
  const proven = new Set(out.calls.filter((c) => c.status === 200)
    .map((c) => c.path.split('?')[0].replace(/\/\d+\//g, '/{id}/').replace(/\/\d+$/, '/{id}')));
  const offered = new Set([...declared, ...proven]);
  const norm = (p) => p.replace(/\/\d+\//g, '/{id}/').replace(/\/\d+$/, '/{id}');
  const consumedNorm = new Set((consumed || []).map(norm));

  out.claims.surfaceDiff = {
    fieldConsumesUpstream: consumed,
    fieldConsumesCount: consumed ? consumed.length : null,
    indexAnswered: apiIndex.some((e) => e.declaredEndpoints || e.openApiPaths),
    offeredCount: offered.size,
    // Offered by BSD, never fetched by the relay. This is the actionable list.
    availableUnused: [...offered].filter((p) => !consumedNorm.has(norm(p))).sort(),
    // Called by the relay and confirmed serving in this run.
    consumedAndProven: [...consumedNorm].filter((p) => proven.has(p)).sort(),
    // Newsletter-claimed candidates that answered 404 -- absent, not merely unused.
    claimedButAbsent: surface.filter((c) => c.status === 404).map((c) => c.path).sort(),
  };

  // ------------------------------------------------------------------ REPORT
  out.rateLimit = rateLimit;
  out.callsMade = calls;
  out.callBudget = CALL_BUDGET;

  // Rule 91: coverage in the same breath as the result. Every claim reports its
  // own verdict vocabulary — ANSWERED / UNKNOWN — never a bare pass.
  const verdict = (cond, blocked) => (blocked ? `UNKNOWN (${blocked})` : (cond ? 'ANSWERED' : 'UNKNOWN'));
  out.summary = {
    tokenPresent: out.tokenPresent,
    callsMade: calls,
    coverage: `4 newsletter claims attempted; ${surface.filter((s) => s.status === 200).length}`
      + ` of ${surface.length} candidate squad/manager/referee routes returned 200`,
    claim1_liveStates: {
      verdict: verdict(states.eventsSeen > 0, states.blocked),
      eventsSeen: states.eventsSeen,
      reportedCount: states.reportedCount,
      truncated: states.truncated,
      distinctStatus: Object.keys(states.status).length,
      statusVocabulary: states.status,
      periodVocabulary: states.period,
      liveStatusVocabulary: states.liveStatus,
      livePeriodVocabulary: states.livePeriod,
      newsletterStatesFound: states.newsletterStates,
    },
    claim2_odds: {
      verdict: verdict(odds.marketKeys != null, odds.blocked),
      eventId: odds.eventId, eventStatus: odds.eventStatus,
      marketCount: odds.marketCount, marketKeys: odds.marketKeys,
      bookmakersCount: odds.bookmakersCount, totalOdds: odds.totalOdds,
      bookmakersPerMarket: odds.bookmakersPerMarket,
      newsletterFields: odds.newsletterFields,
    },
    claim3_squadFields: surface.filter((s) => /squad|team|lineup/.test(s.label))
      .map((s) => ({ label: s.label, status: s.status, injuryFields: s.injuryFields,
                     returnFields: s.returnFields, retiredFields: s.retiredFields })),
    claim4_managersReferees: surface.filter((s) => /manager|coach|referee/.test(s.label))
      .map((s) => ({ label: s.label, status: s.status, topLevelKeys: s.topLevelKeys })),
    surfaceDiff: out.claims.surfaceDiff,
    apiIndex: apiIndex.map((e) => ({ path: e.path, status: e.status, keyCount: e.keyCount,
                                     declared: e.declaredEndpoints ? Object.keys(e.declaredEndpoints).length : 0,
                                     openApiPaths: e.openApiPaths ? e.openApiPaths.length : 0 })),
    rateLimit,
  };

  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(out.summary, null, 2));

  for (const c of out.calls) delete c.json;
  fs.mkdirSync('outbox', { recursive: true });
  const stamp = TS.replace(/[:.]/g, '-');
  const body = JSON.stringify(out, null, 2);
  fs.writeFileSync(`outbox/bsd-newsletter-claims-${stamp}.json`, body);
  // Same rule as bsd-api-probe: the stable name is only advanced by a run that
  // actually reached the vendor. A tokenless or blocked run is still written
  // under its stamp — it is evidence of the block — but it must not stand in
  // for a reading under a filename that looks current.
  const reached = out.calls.some((c) => c.status === 200);
  out.reachedVendor = reached;
  if (reached) {
    fs.writeFileSync('outbox/bsd-newsletter-claims-latest.json', body);
    console.log(`\nwrote outbox/bsd-newsletter-claims-${stamp}.json and -latest.json`);
  } else {
    console.log(`\nwrote outbox/bsd-newsletter-claims-${stamp}.json`);
    console.log('   NOT advancing -latest.json — no call returned 200, so this run never'
      + ' reached the vendor. Any previous reading stands.');
  }
  process.exit(0);
})().catch((e) => { console.error('bsd-newsletter-claims failed:', e.stack || e.message); process.exit(1); });
