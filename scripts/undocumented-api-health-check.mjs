// CC-CMD-2026-08-02-undocumented-api-health-check TASK 2. Scheduled,
// real health check for the two undocumented, reverse-engineered upstream
// dependencies confirmed in that CC-CMD: apim.laliga.com (LaLiga standings,
// real fallback to FD) and wapp.bapi.bundesliga.com (Bundesliga resolve-dayid
// + broadcasts, zero real fallback). Detection only -- no remediation.
//
// Calls THIS relay's own routes (not the upstream APIs directly) so the
// check exercises the same code path real clients hit, and reuses the
// route's own real, graceful {available:false} failure handling rather
// than inventing a second way to detect failure.
//
// Bundesliga resolve-dayid uses a real, already-resolved (season, date) pair
// (outbox/verify-resolve-dayid-date-mode-result.json, 2026-08-02) that is
// cached in ARCHIVE_DB -- this avoids triggering a new Cloudflare Browser
// Rendering session (billed per browser-minute) on every scheduled run.

import { writeFileSync } from 'fs';

const RELAY = 'https://field-relay-nba.jeffunglesbee.workers.dev';
const D1_URL = `${RELAY}/d1/execute`;
const D1_AUTH = 'field-relay-cron-2026'; // real header value, confirmed at src/index.js:12424

// Real, previously-resolved, cached Bundesliga date-mode params (avoids a
// live browser render on every scheduled run).
const BUNDESLIGA_SEASON = '2025-2026';
const BUNDESLIGA_DATE = '2026-05-09';
const BUNDESLIGA_COM_ID = 'DFL-COM-000001';
const BUNDESLIGA_DAY_ID = 'DFL-DAY-004C9X';

async function d1Query(sql, params = []) {
  const r = await fetch(D1_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-FIELD-Relay': D1_AUTH },
    body: JSON.stringify({ sql, params }),
  });
  return r.json();
}

async function checkLaliga() {
  const out = { name: 'laliga-apim', route: '/laliga-apim/clasificacion', hasFallback: true, fallbackDescription: 'client falls back to FD-sourced standings on {available:false}' };
  try {
    const r = await fetch(`${RELAY}/laliga-apim/clasificacion`);
    const body = await r.json();
    out.httpStatus = r.status;
    out.available = body.available === true;
    out.upstreamStatus = body.upstreamStatus ?? null;
    out.hasExpectedShape = body.available === true
      ? (body.data != null && typeof body.data === 'object')
      : null;
    out.healthy = r.status === 200 && body.available === true && out.hasExpectedShape === true;
  } catch (e) {
    out.error = String(e).slice(0, 300);
    out.healthy = false;
  }
  return out;
}

async function checkBundesliga() {
  const out = {
    name: 'bundesliga-bapi', route: '/bundesliga-bapi/resolve-dayid + /bundesliga-bapi/broadcasts',
    hasFallback: false, fallbackDescription: 'NO real fallback exists -- if this breaks, Bundesliga broadcast enrichment silently disables itself (jubilant-bassoon _fetchBundesligaRealBroadcastStreams returns null on any failure and the client falls back to the static BUNDESLIGA bundle, which is real content but not live broadcast data)',
  };
  try {
    const dayIdUrl = `${RELAY}/bundesliga-bapi/resolve-dayid?season=${encodeURIComponent(BUNDESLIGA_SEASON)}&date=${encodeURIComponent(BUNDESLIGA_DATE)}`;
    const rDay = await fetch(dayIdUrl);
    const dayBody = await rDay.json();
    out.resolveDayId = { httpStatus: rDay.status, ok: dayBody.ok === true, cached: dayBody.cached === true, comId: dayBody.comId ?? null, dayId: dayBody.dayId ?? null };
    const dayIdMatches = dayBody.comId === BUNDESLIGA_COM_ID && dayBody.dayId === BUNDESLIGA_DAY_ID;
    out.resolveDayId.matchesKnownGoodValue = dayIdMatches;

    const bcUrl = `${RELAY}/bundesliga-bapi/broadcasts?comId=${encodeURIComponent(BUNDESLIGA_COM_ID)}&dayId=${encodeURIComponent(BUNDESLIGA_DAY_ID)}`;
    const rBc = await fetch(bcUrl);
    const bcBody = await rBc.json();
    out.broadcasts = { httpStatus: rBc.status, available: bcBody.available === true, upstreamStatus: bcBody.upstreamStatus ?? null };

    out.healthy = rDay.status === 200 && dayBody.ok === true && dayIdMatches
      && rBc.status === 200 && bcBody.available === true;
  } catch (e) {
    out.error = String(e).slice(0, 300);
    out.healthy = false;
  }
  return out;
}

async function writeIncident(results) {
  const failing = results.filter(r => !r.healthy);
  if (failing.length === 0) return { incidentWritten: false };

  const timestamp = new Date().toISOString();
  const key = `incident-undocumented-api-health-${timestamp.replace(/[:.]/g, '-')}`;
  const title = `Undocumented API health check FAILED: ${failing.map(f => f.name).join(', ')}`;
  const content = JSON.stringify({ timestamp, failing, allResults: results }, null, 2);

  await d1Query(
    `CREATE TABLE IF NOT EXISTS codex (
      key TEXT PRIMARY KEY, category TEXT, title TEXT, content TEXT,
      drive_refs TEXT, status TEXT, updated_at TEXT DEFAULT (datetime('now'))
    )`
  );
  const res = await d1Query(
    `INSERT INTO codex (key, category, title, content, status, updated_at) VALUES (?, 'incident', ?, ?, 'open', datetime('now'))`,
    [key, title, content]
  );
  return { incidentWritten: res.success === true, incidentKey: key, d1Result: res };
}

async function main() {
  const laliga = await checkLaliga();
  const bundesliga = await checkBundesliga();
  const results = [laliga, bundesliga];
  const incident = await writeIncident(results);

  const out = { timestamp: new Date().toISOString(), results, incident };
  console.log(JSON.stringify(out, null, 2));
  writeFileSync('outbox/undocumented-api-health-check-latest.json', JSON.stringify(out, null, 2));

  if (results.some(r => !r.healthy)) process.exit(1);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
