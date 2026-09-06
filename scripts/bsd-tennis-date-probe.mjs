// Can today's tennis be asked for by DATE, not just "what is live right now"?
//
// THE GAP THIS EXISTS TO CLOSE. /bsd/tennis/matches/live is match-level, so a
// tournament is present only while a ball is in play. Measured 2026-09-06:
//
//   03:23Z (23:23 ET)  US Open, Men — Round of 32 live, in the feed
//   05:55Z (01:55 ET)  US Open absent; only a Vietnamese Challenger and UTR Miami
//
// The US Open had not ended. Its day's play had. A page driven by the live feed
// alone shows nothing for a Grand Slam through roughly twelve hours of every
// tournament day, which is worse than the hardcoded tournament windows this
// replaced — those were wrong about the DATES but right about the shape.
//
// So: does the tennis matches endpoint take a date? The football events route
// takes date_from/date_to (src/index.js:10228 translates them), but tennis is a
// different product on a different base path and the parameter names are NOT
// known to be the same. Guessing one spelling and reporting its 400 as "not
// supported" is precisely how this repo's param probe read 0 dates from 50 rows
// that all carried event_date.
//
// Every candidate is tried and the vendor's own rejection is read. A 400 that
// lists accepted parameters is the most useful answer this can get.

import fs from 'node:fs';

const BASE = process.env.BSD_BASE || 'https://sports.bzzoiro.com';
const TOKEN = process.env.BSD_API_TOKEN || '';
const TS = new Date().toISOString();
const DATE = process.env.PROBE_DATE || TS.slice(0, 10);
const out = { ts: TS, date: DATE, tokenPresent: Boolean(TOKEN), attempts: [] };

let calls = 0;
async function get(qs, note) {
  if (!TOKEN) return { blocked: 'no BSD_API_TOKEN' };
  if (calls >= 20) return { blocked: 'budget' };
  calls++;
  const path = `/tennis/api/v2/matches/${qs}`;
  try {
    const r = await fetch(`${BASE}${path}`, {
      headers: { Authorization: `Token ${TOKEN}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(30000),
    });
    const text = await r.text();
    let json; try { json = JSON.parse(text); } catch {}
    const rows = Array.isArray(json) ? json : (json?.results ?? []);
    const rec = {
      note, qs, status: r.status, count: json?.count ?? null, rows: rows.length,
      // The discriminator: did the filter actually FILTER, or was it ignored?
      // A parameter the server drops returns the same unfiltered page and looks
      // like success. Dates on the returned rows are what tells the difference.
      datesSeen: [...new Set(rows.map((m) => String(m?.match_date ?? '').slice(0, 10)))].sort().slice(0, 6),
      // A rejection often names what IS accepted. That is worth more than the 400.
      errorBody: r.ok ? null : text.slice(0, 400),
    };
    out.attempts.push(rec);
    const filtered = rec.datesSeen.length === 1 && rec.datesSeen[0] === DATE;
    console.log(`  ${String(r.status).padEnd(4)} rows=${String(rows.length).padStart(3)} `
      + `dates=${rec.datesSeen.join(',') || '-'} ${filtered ? 'FILTERED' : ''}  ${note}`);
    return rec;
  } catch (e) { out.attempts.push({ note, qs, error: String(e.message) }); return { error: e.message }; }
}

(async () => {
  console.log(`=== bsd-tennis-date-probe  date=${DATE}  utc=${TS} ===\n`);
  if (!TOKEN) console.log('!! no token — every result is UNKNOWN, not false\n');

  // Control FIRST, so "no rows" can be told apart from "the filter worked".
  const control = await get('?limit=50', 'CONTROL — unfiltered');

  const candidates = [
    [`?date_from=${DATE}&date_to=${DATE}&limit=50`, 'date_from/date_to (the football spelling)'],
    [`?date=${DATE}&limit=50`,                      'date'],
    [`?match_date=${DATE}&limit=50`,                'match_date (the field name on a row)'],
    [`?start_date=${DATE}&end_date=${DATE}&limit=50`, 'start_date/end_date'],
    [`?day=${DATE}&limit=50`,                       'day'],
  ];
  for (const [qs, note] of candidates) await get(qs, note);

  const control0 = control?.rows ?? 0;
  const worked = out.attempts.filter((a) => a.status === 200 && a.note !== 'CONTROL — unfiltered'
    && a.datesSeen?.length === 1 && a.datesSeen[0] === DATE && (a.rows ?? 0) > 0);
  // A parameter the server IGNORES returns the control's rows unchanged. That is
  // not support, and counting it as support is the failure this guards against.
  const ignored = out.attempts.filter((a) => a.status === 200 && a.note !== 'CONTROL — unfiltered'
    && a.rows === control0 && (a.datesSeen?.length ?? 0) > 1);
  const rejected = out.attempts.filter((a) => a.status && a.status >= 400);

  out.summary = {
    controlRows: control0,
    controlDates: control?.datesSeen ?? [],
    supported: worked.map((a) => a.note),
    silentlyIgnored: ignored.map((a) => a.note),
    rejected: rejected.map((a) => ({ note: a.note, status: a.status, body: a.errorBody })),
    verdict: worked.length
      ? `YES — ${worked.length} spelling(s) filter to one date: ${worked.map((a) => a.qs.split('&')[0]).join(', ')}`
      : rejected.length
        ? 'NO — every candidate was rejected; read the error bodies for the accepted parameter list'
        : 'NO — no candidate filtered; the parameters were accepted and ignored, which is worse than a 400',
  };
  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(out.summary, null, 2));

  fs.mkdirSync('outbox', { recursive: true });
  const stamp = TS.replace(/[:.]/g, '-');
  const body = JSON.stringify(out, null, 2);
  fs.writeFileSync(`outbox/bsd-tennis-date-probe-${stamp}.json`, body);
  if (out.attempts.some((a) => a.status === 200)) fs.writeFileSync('outbox/bsd-tennis-date-probe-latest.json', body);
  console.log(`\nwrote outbox/bsd-tennis-date-probe-${stamp}.json`);
  process.exit(0);
})().catch((e) => { console.error('date probe failed:', e.stack); process.exit(1); });
