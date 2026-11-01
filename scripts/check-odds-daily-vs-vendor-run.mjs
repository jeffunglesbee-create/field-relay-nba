#!/usr/bin/env node
// The whole run of scripts/watch-odds-daily-vs-vendor.mjs, not its pure functions: the real file, spawned, against a local stub of
// /budget/odds and /d1/execute, in a temp directory so nothing in the repo changes. The sandbox cannot reach the relay, and dispatching the
// workflow would split the next vendor window (CC-CMD-2026-10-13-vendor-residual-window.md, "Do not"), so this is how the wiring is run.
//
// WHAT IT PINS (the self-test cannot see any of it): that the verdict the run prints and exits on is the WINDOW-ALIGNED residual, that the UTC-day
// figure is printed beside it and labelled a diagnostic, that a window that cannot be measured (no D1-read ledger, CI rows unreadable) FAILS the run
// rather than falling back to the UTC-day figure or to a CI spend of 0, that the month boundary is still a refusal (exit 0), that the watch asks the
// relay for YESTERDAY by its own clock with the secret, that CI rows outside the window are not counted, and that the reading is written to the series
// (the next run's baseline) on every kind of run, red ones included. The readings are rows of outbox/odds-daily-vs-vendor-series.json, verbatim.
//
// THE STUB SPEAKS THE ROUTES' REAL SHAPES, read from the relay source: /budget/odds `{ daily: { date, is_today, used, ceiling, reconcile },
// monthly: { used, source }, provider: { requests_used } }` (the vendor figure a STRING, as measured 2026-09-19), and POST /d1/execute, which
// answers 401 `unauthorized` without the matching X-FIELD-Relay header, `{ ok: false, error }` on 400/403/500, and on success the FLAT
// `{ success: true, results: [rows], meta }`. It refuses today's date as still running, like the real route.
//
// Usage: node scripts/check-odds-daily-vs-vendor-run.mjs [path-to-watch]   (the mutation harness passes the file it has mutated)
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WATCH = path.resolve(process.argv[2] || path.join(HERE, 'watch-odds-daily-vs-vendor.mjs'));
const CLOCK = path.join(HERE, 'lib', 'fake-clock.cjs');
const H = 3600e3;
const SECRET = 'secret-for-the-stub';
const NOW = '2026-10-31T06:00:00.000Z';

// prev/cur are [vendor_month_used, ledger_month_used, day_used]. `now` is the watch's clock; the previous reading is 24 h before it unless `prevAt` says
// otherwise. ciRows are [hours relative to now, credits]: one row inside the window and two decoys outside it, one before `prevAt` on the same UTC day
// and one after now, which the watch must not count.
const WINDOW_CI = [[-3, 200], [-25, 999], [1, 777]];
const CASES = [
  { name: 'the 10-12 pair: window -190 is the verdict, UTC-day -616 is the diagnostic; CI rows outside the window are not counted',
    prev: [11690, 21635, 3800], cur: { vendor: '15073', ledger: 25008, day: 3799 }, ciRows: WINDOW_CI, exit: 1,
    has: [/residual \(window-aligned\)   : -190   tolerance 169   <- the verdict/, /diagnostic, NOT the verdict/, /residual against that       : -616   tolerance 169/,
          /known CI spend              : 200   \(1 run\(s\), 0 undated\)/, /vendor billed in the window : 3383/, /our ledger, same window     : 3373/, /our monthly ledger now : 25008/, /^  verdict: we-overcharge-ourselves$/m] },
  { name: 'the 10-23 pair: 0 against the window is health (the UTC-day +75 was the offset and would have been the breach)',
    prev: [29224, 40742, 1521], cur: { vendor: '30035', ledger: 41453, day: 636 }, ciRows: [[-3, 100]], exit: 0,
    has: [/residual \(window-aligned\)   : 0   tolerance 50   <- the verdict/, /residual against that       : 75   tolerance 50/, /^  verdict: tracks-the-bill$/m, /^OK: tracks-the-bill/m],
    not: [/counter-under-counts/] },
  { name: 'the 10-30 pair: -406 on the window, -631 on the UTC day',
    prev: [35587, 47298, 1184], cur: { vendor: '36032', ledger: 47989, day: 916 }, ciRows: [[-3, 160]], exit: 1,
    has: [/residual \(window-aligned\)   : -406/, /residual against that       : -631/, /^  verdict: we-overcharge-ourselves$/m] },
  { name: 'a breach on the window is a breach and fails the run',
    prev: [1000, 5000, 100], cur: { vendor: '4000', ledger: 6900, day: 1900 }, ciRows: [[-3, 80]], exit: 1,
    has: [/^  verdict: counter-under-counts$/m, /vendor billed 3000 in the window where our monthly ledger recorded 1900/] },
  { name: 'a ledger that is null on the new reading FAILS the run and does not fall back to the UTC-day figure',
    prev: [29224, 40742, 1521], cur: { vendor: '30035', ledger: null, day: 636 }, ciRows: [[-3, 100]], exit: 1,
    has: [/^  verdict: ledger-unreadable$/m, /UTC-day counter is NOT substituted/],
    not: [/residual \(window-aligned\)/, /tracks-the-bill/, /counter-under-counts/, /^OK:/m] },
  { name: 'a ledger the route served from KV (source kv-d1-unreadable) is stored as unreadable and FAILS the run',
    prev: [29224, 40742, 1521], cur: { vendor: '30035', ledger: 61, source: 'kv-d1-unreadable', day: 636 }, ciRows: [[-3, 100]], exit: 1,
    has: [/^  verdict: ledger-unreadable$/m, /source "kv-d1-unreadable"/], not: [/residual \(window-aligned\)/, /^OK:/m] },
  { name: 'a ledger that fell inside the month FAILS the run',
    prev: [29224, 40742, 1521], cur: { vendor: '30035', ledger: 40000, day: 636 }, ciRows: [[-3, 100]], exit: 1,
    has: [/^  verdict: ledger-went-backwards$/m, /monthly\.used fell by 742/], not: [/residual \(window-aligned\)/, /^OK:/m] },
  { name: 'CI rows the relay cannot serve (HTTP 500) FAIL the run: known CI spend is not defaulted to 0 and no verdict is printed',
    prev: [11690, 21635, 3800], cur: { vendor: '15073', ledger: 25008, day: 3799 }, d1: 'error500', exit: 1,
    has: [/^  verdict: ci-unreadable$/m, /CI rows could not be read \(HTTP 500\)/, /NOT treated as 0/], not: [/residual \(window-aligned\)/, /tracks-the-bill/, /^OK:/m] },
  { name: 'a wrong secret (HTTP 401 from /d1/execute) FAILS the run the same way',
    prev: [11690, 21635, 3800], cur: { vendor: '15073', ledger: 25008, day: 3799 }, ciRows: WINDOW_CI, secret: 'not-the-secret', exit: 1,
    has: [/^  verdict: ci-unreadable$/m, /HTTP 401/], not: [/residual \(window-aligned\)/, /^OK:/m] },
  { name: 'the real month boundary (2026-11-01) is still a refusal that exits 0 and prints no residual',
    now: '2026-11-01T05:54:31.202Z', prevAt: '2026-10-31T05:29:25.893Z', prev: [36032, 47989, 916], cur: { vendor: '171', ledger: 189, day: 1018 }, ciRows: [], exit: 0,
    has: [/^  verdict: month-boundary  2026-10 -> 2026-11$/m, /^OK: reading stored/m], not: [/residual \(window-aligned\)/] },
  { name: 'a no-header estimate is netted against the UTC-day diagnostic, never the window verdict',
    prev: [11690, 21635, 3800], cur: { vendor: '15073', ledger: 25008, day: 3799, reconcile: [{ site: 'x', state: 'no-header', n: 3, credits_kept: 50 }] }, ciRows: WINDOW_CI, exit: 1,
    has: [/residual \(window-aligned\)   : -190/, /UTC-day residual after it : -566/] },
];

function d1Answer(c, now) {
  if (c.d1 === 'error500') return { status: 500, json: { ok: false, error: 'D1 is on fire' } };
  const rows = (c.ciRows === undefined ? [] : c.ciRows).map(([hours, credits]) => ({
    completed_at: new Date(Date.parse(now) + hours * H).toISOString().replace('T', ' ').slice(0, 19), credits_used: credits }));
  return { status: 200, json: { success: true, results: rows, meta: { rows_read: rows.length } } };
}

async function run(c) {
  const now = c.now === undefined ? NOW : c.now;
  const prevAt = c.prevAt === undefined ? new Date(Date.parse(now) - 24 * H).toISOString() : c.prevAt;
  const wantDay = new Date(Date.parse(now) - 24 * H).toISOString().slice(0, 10);
  const dir = mkdtempSync(path.join(tmpdir(), 'dvv-run-'));
  const asked = [];
  try {
    mkdirSync(path.join(dir, 'outbox'));
    const prevRow = { at: prevAt, day: 'prev', day_used: c.prev[2], ceiling: 3800, vendor_month_used: c.prev[0], ledger_month_used: c.prev[1] };
    writeFileSync(path.join(dir, 'outbox/odds-daily-vs-vendor-series.json'), JSON.stringify([prevRow]));
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x');
      res.setHeader('content-type', 'application/json');
      if (u.pathname === '/budget/odds') {
        const date = u.searchParams.get('date');
        asked.push(date);
        const monthly = { month: now.slice(0, 7), used: c.cur.ledger, source: c.cur.source === undefined ? 'd1' : c.cur.source };
        res.end(JSON.stringify({ ok: true, daily: { date, is_today: date === now.slice(0, 10), used: c.cur.day, ceiling: 3800, reconcile: Array.isArray(c.cur.reconcile) ? c.cur.reconcile : [] },
                                 monthly, provider: { requests_used: c.cur.vendor } }));
      } else if (u.pathname === '/d1/execute' && req.method === 'POST') {
        if (req.headers['x-field-relay'] !== SECRET) { res.statusCode = 401; res.setHeader('content-type', 'text/plain'); res.end('unauthorized'); return; }
        const a = d1Answer(c, now);
        res.statusCode = a.status; res.end(JSON.stringify(a.json));
      } else { res.statusCode = 404; res.end('{}'); }
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const out = await new Promise((resolve) => {
      const ch = spawn(process.execPath, [WATCH], { cwd: dir, env: { ...process.env, RELAY_BASE: `http://127.0.0.1:${srv.address().port}`,
        RELAY_SHARED_SECRET: c.secret === undefined ? SECRET : c.secret, FAKE_NOW: now, NODE_OPTIONS: `--require ${CLOCK}` } });
      let t = ''; ch.stdout.on('data', (d) => { t += d; }); ch.stderr.on('data', (d) => { t += d; });
      ch.on('close', (code) => resolve({ code, t }));
    });
    srv.close();
    let series = null;
    try { series = JSON.parse(readFileSync(path.join(dir, 'outbox/odds-daily-vs-vendor-series.json'), 'utf8')); } catch (_) { /* reported below */ }
    return { ...out, asked, wantDay, now, prevRow, series, logs: readdirSync(path.join(dir, 'outbox')).filter((f) => f.endsWith('.log')).length };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

let bad = 0;
for (const c of CASES) {
  const out = await run(c);
  const problems = [];
  if (out.code !== c.exit) problems.push(`exit ${out.code}, wanted ${c.exit}`);
  for (const re of c.has) if (!re.test(out.t)) problems.push(`output lacks ${re}`);
  for (const re of c.not === undefined ? [] : c.not) if (re.test(out.t)) problems.push(`output must not contain ${re}`);
  if (out.logs !== 1) problems.push(`${out.logs} outbox log(s) written, wanted 1`);
  // The day it asks for comes from its OWN clock: yesterday, once, and never today.
  if (JSON.stringify(out.asked) !== JSON.stringify([out.wantDay])) problems.push(`asked /budget/odds for ${JSON.stringify(out.asked)}, wanted exactly [${out.wantDay}]`);
  // The reading is the next run's baseline, so it must be written on every kind of run, red ones included, with the ledger as the route gave it.
  const wantLedger = (c.cur.source === undefined || c.cur.source === 'd1') && typeof c.cur.ledger === 'number' ? c.cur.ledger : null;
  const s = out.series;
  if (!Array.isArray(s) || s.length !== 2) problems.push(`series has ${Array.isArray(s) ? s.length : 'no'} row(s), wanted 2 (the baseline and this reading)`);
  else {
    if (JSON.stringify(s[0]) !== JSON.stringify(out.prevRow)) problems.push('the baseline row was changed');
    const r = s[1];
    if (r.at !== out.now || r.day !== out.wantDay || r.day_used !== c.cur.day || r.vendor_month_used !== Number(c.cur.vendor) || r.ledger_month_used !== wantLedger) {
      problems.push(`the stored reading is wrong: ${JSON.stringify(r)}`);
    }
  }
  console.log(`  ${problems.length ? 'FAIL' : 'ok  '}  ${c.name}`);
  if (problems.length) { bad++; console.log(problems.map((p) => `        ${p}`).join('\n')); console.log(out.t.split('\n').map((l) => `        | ${l}`).join('\n')); }
}
console.log(`\nran ${CASES.length} case(s) of the whole watch against a stub relay that speaks the routes' real shapes (the sandbox cannot reach the real one): ${bad ? `${bad} FAILED` : 'all passed'}`);
console.log('NOT run here: the real /budget/odds, the real D1 read, the workflow, the series commit. The first scheduled run after this lands is that proof.');
process.exit(bad ? 1 : 0);
