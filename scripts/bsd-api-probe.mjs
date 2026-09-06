// Probe the BSD (Bzzoiro Sports Data) API surface THROUGH the relay.
//
// Through the relay deliberately, not against sports.bzzoiro.com directly:
// BSD_API_TOKEN lives only in the Worker, the relay is what the client
// actually consumes (src/index.js:9221), and a probe against upstream would
// measure a path no user traverses. This measures the contract as served.
//
// Every route and parameter below was read from src/index.js at HEAD, not
// written from memory (Rule 87):
//
//   /bsd/contract                          9226  no token, no upstream fetch
//   /bsd/events/live                       9323
//   /bsd/events/by-date?date=YYYY-MM-DD    9458  -> date_from/date_to upstream
//   /bsd/events/{id}/shotmap               9338  -> /stats/
//   /bsd/events/{id}/momentum              9373  -> /stats/
//   /bsd/events/{id}/incidents             9396  -> /incidents/
//   /bsd/events/{id}/odds                  9406  -> /odds/comparison/
//   /bsd/events/{id}/average-positions     9416  -> /average-positions/
//   /bsd/tennis/matches/live               9426
//   /bsd/tennis/matches/{id}               9442
//   /bsd/r2/read?key=bsd/...               9507  key MUST start with 'bsd/'
//
// Read-only: GETs only. No token is sent from here -- the relay injects it,
// which is itself part of what this checks (a route answering without the
// Worker's token would mean the proxy is not doing its job).
//
// Reports STATUS + SHAPE (top-level keys, array lengths, byte counts) rather
// than prose. A 200 alone proves nothing: this repo has already had an
// endpoint return 200 with an empty body all week.

import require$fs from 'node:fs';

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const DATE = process.env.PROBE_DATE || new Date().toISOString().slice(0, 10);
const TS = new Date().toISOString();

// Rule 91's denominator, read from src/index.js rather than written here.
// Hardcoding "13 routes" would be correct today and silently wrong the first
// time a route is added -- and the reader of a PASS has no way to tell.
// Verified by mutation (Rule 90): injecting one extra `pathname === '/bsd/x'`
// into a copy of the source raises the count by exactly 1.
function bsdRoutesInSource(file = 'src/index.js') {
  let src;
  try { src = require$fs.readFileSync(file, 'utf8'); }
  catch (_) { return []; }        // run from outside the repo: coverage unknown
  const routes = new Set();
  for (const m of src.matchAll(/pathname\s*===\s*'(\/bsd\/[^']+)'/g)) routes.add(m[1]);
  for (const m of src.matchAll(/pathname\.match\(\/\^((?:\\\/|[^/\n])+)\$\//g)) {
    const lit = m[1].replace(/\\\//g, '/').replace(/\(\\d\+\)/g, '{id}');
    if (lit.startsWith('/bsd/')) routes.add(lit);
  }
  return [...routes].sort();
}

function shapeOf(v, depth = 0) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return `array[${v.length}]${v.length && depth < 1 ? ' of ' + shapeOf(v[0], depth + 1) : ''}`;
  if (typeof v === 'object') {
    const keys = Object.keys(v);
    return depth < 1
      ? `object{${keys.slice(0, 12).join(',')}${keys.length > 12 ? ',…+' + (keys.length - 12) : ''}}`
      : `object[${keys.length} keys]`;
  }
  return typeof v;
}

async function hit(label, path, expect = 200) {
  const url = `${RELAY}${path}`;
  const rec = { label, path, url, expect };
  const t0 = Date.now();
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
    rec.status = r.status;
    rec.ms = Date.now() - t0;
    rec.contentType = r.headers.get('content-type');
    rec.cacheControl = r.headers.get('cache-control');
    const text = await r.text();
    rec.bytes = text.length;
    try {
      const j = JSON.parse(text);
      rec.shape = shapeOf(j);
      rec.json = j;
      // The discriminator that matters: a 200 carrying nothing usable.
      // FIRST RUN DEFECT, fixed: this counted WRAPPER KEYS when the payload
      // was an object, so /bsd/events/{id}/momentum returning 35 bytes of
      // `{event_id, momentum: []}` reported items=2 and sailed past the
      // emptyButOk check -- the exact 200-with-nothing class this probe was
      // written to catch. Now every array found anywhere in the top level is
      // counted, and the wrapper-key count is kept separately as topLevelKeys.
      const payload = j?.results ?? j?.data ?? j?.events ?? j;
      rec.itemCount = Array.isArray(payload) ? payload.length
        : (payload && typeof payload === 'object' ? Object.keys(payload).length : null);
      if (j && typeof j === 'object' && !Array.isArray(j)) {
        rec.topLevelKeys = Object.keys(j).length;
        rec.arrayFields = Object.fromEntries(
          Object.entries(j).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, v.length]));
        const arrLens = Object.values(rec.arrayFields);
        // payloadCount is the honest "how much data came back": total elements
        // across every top-level array. A 200 whose arrays are all empty is a
        // failure to serve, whatever the key count says.
        rec.payloadCount = arrLens.length ? arrLens.reduce((a, b) => a + b, 0) : null;
      }
      if (j && typeof j === 'object' && (j.error || j.detail)) rec.upstreamError = j.error || j.detail;
    } catch (_) {
      rec.shape = 'non-JSON';
      rec.head = text.slice(0, 160);
    }
  } catch (e) {
    rec.error = String(e.message || e);
  }
  return rec;
}

(async () => {
  const out = { ts: TS, relay: RELAY, date: DATE, routes: [] };
  const add = async (label, path, expect = 200) => {
    const r = await hit(label, path, expect);
    out.routes.push(r);
    console.log(
      `${String(r.status ?? 'ERR').padEnd(4)}${r.status === r.expect ? ' ' : '!'}` +
      `${String(r.ms ?? '-').padStart(5)}ms ` +
      `${String(r.bytes ?? 0).padStart(7)}B items=${String(r.itemCount ?? '-').padStart(4)} ` +
      `payload=${String(r.payloadCount ?? '-').padStart(4)}  ` +
      `${label.padEnd(24)} ${r.upstreamError || r.error || r.shape || ''}`.slice(0, 190));
    return r;
  };

  console.log(`=== bsd-api-probe  relay=${RELAY}  date=${DATE}  utc=${TS} ===\n`);

  // 1. Contract first. It needs no token and no upstream, so if THIS fails the
  //    problem is the relay itself, not BSD -- which changes what every other
  //    result below means.
  const contract = await add('contract', '/bsd/contract');

  // 2. Discovery. Live may legitimately be empty depending on the hour, so
  //    by-date is probed too -- otherwise "no events" is ambiguous between
  //    "nothing is playing" and "the feed is broken".
  const live = await add('events/live', '/bsd/events/live');
  const byDate = await add('events/by-date', `/bsd/events/by-date?date=${DATE}`);

  // 3. Per-event routes need a REAL event id. Taken from whatever discovery
  //    returned rather than hardcoded -- a hardcoded id that has aged out
  //    would produce 404s that look like route failures.
  // FIRST RUN DEFECT, fixed: /bsd/events/live returns `{count, events}` and
  // this only unwrapped `results`/`data`, so live's ids were invisible and the
  // run reported eventIdSource "events/by-date" as though live had none.
  const pickEvents = (rec) => {
    const j = rec?.json;
    const p = j?.results ?? j?.data ?? j?.events ?? j;
    return Array.isArray(p) ? p : [];
  };
  const pickIds = (rec) => pickEvents(rec).map((e) => e?.id ?? e?.event_id).filter((x) => x != null);
  // Prefer an event that has actually been PLAYED. by-date returns the whole
  // day including not-yet-kicked-off fixtures, and the first run probed
  // 223325 -- whose shotmap/momentum/incidents all came back 200 with empty
  // arrays. That is not a broken route, it is a fixture with no events yet,
  // and probing it cannot distinguish the two.
  const statusOf = (e) => String(e?.status?.type ?? e?.status ?? e?.state ?? '').toLowerCase();
  const played = [...pickEvents(live), ...pickEvents(byDate)]
    .filter((e) => /finish|ft|ended|complete|inprogress|live|1st|2nd|half/.test(statusOf(e)));
  out.playedCandidateCount = played.length;
  out.statusValuesSeen = [...new Set(pickEvents(byDate).map(statusOf))].slice(0, 12);
  const ids = [...new Set([
    ...played.map((e) => e?.id ?? e?.event_id).filter((x) => x != null),
    ...pickIds(live), ...pickIds(byDate),
  ])];
  out.discoveredEventIds = ids.slice(0, 10);
  out.eventIdSource = played.length ? 'played-filter'
    : (pickIds(live).length ? 'events/live' : (pickIds(byDate).length ? 'events/by-date' : 'none'));
  console.log(`\n-- discovered ${ids.length} event id(s) via ${out.eventIdSource}; probing per-event routes on ${ids[0] ?? 'N/A'}\n`);

  if (ids.length) {
    const id = ids[0];
    out.probedEventId = id;
    for (const [label, path] of [
      ['shotmap',           `/bsd/events/${id}/shotmap`],
      ['momentum',          `/bsd/events/${id}/momentum`],
      ['incidents',         `/bsd/events/${id}/incidents`],
      ['odds',              `/bsd/events/${id}/odds`],
      ['average-positions', `/bsd/events/${id}/average-positions`],
    ]) await add(label, path);
  } else {
    console.log('   (skipped per-event routes — no event id available; this is a',
      'discovery result, NOT a pass)');
    out.perEventSkipped = true;
  }

  // 4. Tennis is a separate BSD product (Sports Pack) on a different upstream
  //    base path, so it can fail independently of football.
  await add('tennis/live', '/bsd/tennis/matches/live');

  // 5. R2 read: two calls, because the interesting answer is whether the
  //    GUARD works, not only whether a key resolves.
  await add('r2/read (bad key)', '/bsd/r2/read?key=notbsd/x.json', 400);
  await add('r2/read (missing)', '/bsd/r2/read?key=bsd/__probe_missing__.json', 404);

  // 6. Unknown route must be rejected, not silently proxied.
  await add('unknown route', '/bsd/__definitely_not_a_route__', 404);

  const ok = (r) => r.status === 200;
  // SECOND RUN DEFECT, fixed: `nonOk` listed the three GUARD probes -- bad key
  // 400, missing key 404, unknown route 404 -- as failures, while three fields
  // below simultaneously recorded the same codes as passes. The 2026-09-06 run
  // read `http200: 9` of 12 and `nonOk: [3 entries]` on a surface with zero
  // route failures. A status equal to its declared expectation is a pass
  // whatever the number is; only an unexpected one is a finding.
  const met = (r) => r.status === r.expect;

  // The probed event's own state, needed to read `average-positions` correctly.
  const probedEvent = ids.length
    ? [...pickEvents(live), ...pickEvents(byDate)].find((e) => (e?.id ?? e?.event_id) === out.probedEventId)
    : null;
  out.probedEventStatus = probedEvent ? statusOf(probedEvent) : null;
  out.probedEventPeriod = probedEvent?.period ?? null;

  // SECOND RUN DEFECT, fixed: `average-positions` returning `{}` was reported
  // under emptyButOk with no annotation, and reads as a broken route. It is the
  // documented correct answer for a match still in play -- src/index.js:10128
  // records that BSD's own /average-positions/ URL 404s unconditionally (6
  // events measured 2026-08-13, live and finished alike), so the relay serves
  // /stats/'s embedded field, which BSD populates only after full time. An
  // empty object during play is "not yet"; absent would be 404 "never". The
  // 2026-09-06 run probed 220120 at 2nd_half minute 90 and duly got `{}`.
  // A value whose expected reading is empty, printed without saying so, reads
  // as a finding -- the same annotation field-laboratory's separation-check
  // needed for its boundary-0 the same day.
  const IN_PLAY = /inprogress|live|1st|2nd|half|extra|paused|delayed/;
  const expectedEmptyReason = (r) => (
    r.label === 'average-positions' && IN_PLAY.test(out.probedEventStatus || '')
      ? `EXPECTED — event ${out.probedEventId} is ${out.probedEventStatus}`
        + `${out.probedEventPeriod ? ' (' + out.probedEventPeriod + ')' : ''};`
        + ' BSD populates average_positions only after full time (src/index.js:10128)'
      : null);

  // Rule 91 (SAMPLE-COVERAGE-A): the denominator is derived from src/index.js
  // at run time, never hardcoded -- a hardcoded count goes stale the first time
  // a route is added and nothing says so.
  const srcRoutes = bsdRoutesInSource();
  const probedPaths = new Set(out.routes.map((r) => r.path.split('?')[0]
    .replace(/\/events\/\d+\//, '/events/{id}/')
    .replace(/\/tennis\/matches\/\d+$/, '/tennis/matches/{id}')));
  const covered = srcRoutes.filter((rt) => probedPaths.has(rt));
  const uncovered = srcRoutes.filter((rt) => !probedPaths.has(rt));
  out.coverage = { routesInSource: srcRoutes.length, covered: covered.length, uncovered };

  out.summary = {
    contractOk: ok(contract),
    coverage: `checked ${covered.length} of ${srcRoutes.length} /bsd/ routes in src/index.js`,
    uncoveredRoutes: uncovered,
    routesProbed: out.routes.length,
    metExpectation: out.routes.filter(met).length,
    http200: out.routes.filter(ok).length,
    // 200-with-nothing is tracked separately from non-200: they are different
    // failures and this repo has been bitten by conflating them.
    // Now keyed on payloadCount (elements across top-level arrays), not on
    // wrapper key count -- see the itemCount comment above.
    emptyButOk: out.routes.filter((r) => ok(r) && (r.payloadCount === 0 || r.itemCount === 0))
      .map((r) => ({ label: r.label, bytes: r.bytes, arrayFields: r.arrayFields,
                     expectedEmpty: expectedEmptyReason(r) })),
    unexpectedStatus: out.routes.filter((r) => !met(r))
      .map((r) => ({ label: r.label, expected: r.expect, got: r.status, err: r.upstreamError || r.error })),
    // Named for what it lists, not for what it hopes: this enumerates every
    // guard probe with its verdict. An earlier draft called it
    // `guardsMetExpectation` and listed them unconditionally, so a sandbox run
    // where all three returned 403 printed "guardsMetExpectation: expect 400,
    // got 403" -- a field asserting more than its contents prove.
    guards: out.routes.filter((r) => r.expect !== 200)
      .map((r) => `${r.label}: expect ${r.expect}, got ${r.status} ${r.status === r.expect ? 'MET' : 'UNEXPECTED'}`),
    discoveredEventIds: out.discoveredEventIds,
    eventIdSource: out.eventIdSource,
    playedCandidateCount: out.playedCandidateCount,
    statusValuesSeen: out.statusValuesSeen,
  };

  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(out.summary, null, 2));

  // Trim bodies before writing: the manifest is evidence, not a data cache.
  for (const r of out.routes) {
    if (r.json !== undefined) {
      r.sample = JSON.stringify(r.json).slice(0, 700);
      delete r.json;
    }
  }
  const fs = await import('node:fs');
  fs.mkdirSync('outbox', { recursive: true });
  const stamp = TS.replace(/[:.]/g, '-');
  const body = JSON.stringify(out, null, 2);
  // Do not let an unreachable run destroy the last reachable one. Measured
  // 2026-09-06: running this from an egress-blocked sandbox returned 403 on all
  // 7 routes and overwrote outbox/bsd-api-probe-latest.json -- a good CI reading
  // replaced by proxy errors, with the stable filename making it look current.
  // The stamped file is always written (a failed run is evidence too); the
  // STABLE name is only advanced by a run that actually reached the relay.
  const reachedRelay = out.routes.some((r) => r.status === r.expect);
  out.reachedRelay = reachedRelay;
  fs.writeFileSync(`outbox/bsd-api-probe-${stamp}.json`, body);
  // ALSO a stable name. Added 2026-09-06: a timestamped file can only be read
  // by someone who already knows the timestamp, and the readings that matter
  // are the ones a later session goes looking for without knowing when they
  // were taken. Same reasoning as cfb-volume-probe-latest.txt. The stamped copy
  // stays, because a series is what shows a shape CHANGING.
  if (reachedRelay) {
    fs.writeFileSync('outbox/bsd-api-probe-latest.json', body);
    console.log(`\nwrote outbox/bsd-api-probe-${stamp}.json and outbox/bsd-api-probe-latest.json`);
  } else {
    console.log(`\nwrote outbox/bsd-api-probe-${stamp}.json`);
    console.log('   NOT advancing outbox/bsd-api-probe-latest.json — no route met its'
      + ' expectation, so this run never reached the relay. The previous reading stands.');
  }
  // Exit 0 regardless: a broken route is the FINDING. A red run invites
  // re-running until green, which is the habit Rule 77 exists to break.
  process.exit(0);
})().catch((e) => { console.error('bsd-api-probe failed:', e.stack || e.message); process.exit(1); });
