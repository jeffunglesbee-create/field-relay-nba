#!/usr/bin/env node
// AmbientDO's closing-line capture, watched through a live window.
// docs/CC-CMD-2026-10-21-closing-capture-calls-18x-its-need.md, TASK 0.
//
// The capture writes no log line when it fetches and finds nothing to write,
// so the Worker log cannot count its calls. This reads the two things that can:
//   - /budget/odds: ambientCaptureClosingOdds's charge and its reconcile rows,
//     each minute, so calls per minute are a difference of two readings;
//   - /ambient/state: how many entries AmbientDO holds, how many read 'live',
//     and the state of each game first seen live in the window.
// Beside them, wrangler tail (JSON) keeps every event that names an alarm,
// AmbientDO, closing-odds, odds-reconcile, or carries an exception.
//
// READ-ONLY. Neither route reaches a billed vendor endpoint: /budget/odds asks
// /v4/sports for the provider reading, which costs 0 credits.
//
//   node scripts/probe-ambient-capture.mjs --minutes=75 --ts=<stamp>

import { spawn } from 'node:child_process';
import { createWriteStream, writeFileSync, mkdirSync } from 'node:fs';
import readline from 'node:readline';

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const arg = (k, d) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const MINUTES = Number(arg('minutes', '75'));
const TS = arg('ts', new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z');
if (!Number.isFinite(MINUTES) || MINUTES < 1 || MINUTES > 300) { console.log(`FAIL: --minutes must be 1..300, got ${MINUTES}`); process.exit(1); }

mkdirSync('outbox', { recursive: true });
const LOG = `outbox/ambient-capture-probe-${TS}.log`;
const TAIL = `outbox/ambient-capture-tail-${TS}.jsonl`;
const lines = [];
const say = (s) => { console.log(s); lines.push(s); };
const flush = () => writeFileSync(LOG, lines.join('\n') + '\n');

const getJson = async (path) => {
  const r = await fetch(`${RELAY}${path}`, { headers: { 'Cache-Control': 'no-cache' } });
  const text = await r.text();
  if (!r.ok) throw new Error(`${path} HTTP ${r.status}: ${text.slice(0, 200)}`);
  return { body: JSON.parse(text), bytes: text.length };
};

// ── the tail ────────────────────────────────────────────────────────────────
const KEEP = /alarm|AmbientDO|closing-odds|odds-reconcile|odds credit|Durable Object|storage|exceeded|too large/i;
const tailOut = createWriteStream(TAIL);
const tally = { events: 0, kept: 0, unparsed: 0, outcomes: {}, exceptions: 0, by: {} };
// A count that has not started is 0 here because the key is checked, not
// because an absent value is read as one.
const inc = (o, k) => { o[k] = (k in o ? o[k] : 0) + 1; };
let tail = null;
if (process.env.CLOUDFLARE_API_TOKEN) {
  tail = spawn('npx', ['--yes', 'wrangler@3.109.0', 'tail', 'field-relay-nba', '--format', 'json'], { stdio: ['ignore', 'pipe', 'pipe'] });
  // wrangler prints each event as a pretty-printed object: a line "{", the
  // body, a line "}". Lines are gathered between the two and parsed whole.
  let buf = null;
  readline.createInterface({ input: tail.stdout }).on('line', (line) => {
    if (buf === null) { if (line === '{') buf = [line]; return; }
    buf.push(line);
    if (line !== '}') return;
    const text = buf.join('\n'); buf = null;
    tally.events++;
    let ev;
    try { ev = JSON.parse(text); } catch (_) { tally.unparsed++; return; }
    const who = `${ev.entrypoint ?? 'worker'}:${Object.keys(ev.event ?? {}).join('+') || 'none'}`;
    inc(tally.by, who);
    const exc = Array.isArray(ev.exceptions) && ev.exceptions.length > 0;
    if (exc) tally.exceptions++;
    const flat = JSON.stringify(ev);
    if (!exc && ev.entrypoint !== 'AmbientDO' && !KEEP.test(flat)) return;
    tally.kept++;
    const o = ev.outcome ?? 'none';
    inc(tally.outcomes, o);
    tailOut.write(flat + '\n');
  });
  tail.stderr.on('data', d => { const s = String(d); if (/error|fail/i.test(s)) say(`  tail stderr: ${s.trim().slice(0, 300)}`); });
} else {
  say('  NOTE: no CLOUDFLARE_API_TOKEN, so no tail. The two routes are still read.');
}

// ── the clock ───────────────────────────────────────────────────────────────
say(`=== AmbientDO closing-capture probe  utc=${new Date().toISOString()}  window=${MINUTES} min ===`);
const t0 = Date.now(), end = t0 + MINUTES * 60000;
let firstLive = null;               // ids that read 'live' at the first reading
const seen = new Map();             // id first live in the window -> first/last state seen
let prevCharge = null, prevN = null, minutes = 0;
let lastInstance = null, instances = 0, warnedNoDiag = false;
const series = [];

while (Date.now() < end) {
  const at = new Date().toISOString().slice(11, 19);
  try {
    const { body: s, bytes } = await getJson('/ambient/state?diag=1');
    if (!Array.isArray(s.liveGames)) throw new Error(`no liveGames array in /ambient/state`);
    const live = s.liveGames;
    if (!firstLive) {
      firstLive = new Set(live.map(g => g.id));
      say(`  first /ambient/state: ${bytes} bytes, sportCount ${s.sportCount}, live ${live.length}, clients ${s.clientCount}`);
    }
    // The diagnostic (?diag=1, deployed in 9fcb1ac1): printed whole at the
    // first reading and at every new instance, compactly otherwise.
    const d = s.diag;
    if (d && d.instanceStartedAt !== lastInstance) {
      say(`  ${at} INSTANCE ${d.instanceStartedAt}  clients ${s.clientCount}  ${JSON.stringify(d)}`);
      lastInstance = d.instanceStartedAt; instances++;
    } else if (d) {
      say(`  ${at} diag mem ${d.memCount}/${d.memJsonBytes}B stored ${d.storedCount}/${d.storedJsonBytes}B match ${d.storedMatchesMem} gameStarts ${d.gameStartsSize} putErr ${d.lastPutError ? d.lastPutError.message.slice(0, 80) : 'none'} alarmErr ${d.lastAlarmError ? d.lastAlarmError.message.slice(0, 80) : 'none'} clients ${s.clientCount}`);
    } else if (!warnedNoDiag) { say('  NOTE: /ambient/state returned no diag field'); warnedNoDiag = true; }
    const fresh = live.filter(g => !firstLive.has(g.id));
    for (const g of fresh) {
      const e = seen.get(g.id) || { sport: g.sport, game: `${g.away} @ ${g.home}`, first: at, readings: 0 };
      e.last = at; e.readings++; e.score = `${g.awayScore}-${g.homeScore} p${g.period}`;
      seen.set(g.id, e);
    }
    series.push({ at, sportCount: s.sportCount, live: live.length, clients: s.clientCount, lastPoll: s.lastPoll, fresh: fresh.length });
  } catch (e) { say(`  ${at} /ambient/state: ${e.message}`); }

  if (minutes % 2 === 0) {     // every 60 s on a 30 s clock
    try {
      const { body: b } = await getJson('/budget/odds');
      const used = b.daily?.by_site?.ambientCaptureClosingOdds ?? null;
      const rec = b.daily?.reconcile;
      const n = Array.isArray(rec) ? rec.filter(r => r.site === 'ambientCaptureClosingOdds').reduce((x, r) => x + Number(r.n), 0) : null;
      const dUsed = prevCharge == null || used == null ? '' : used - prevCharge;
      const dN = prevN == null || n == null ? '' : n - prevN;
      say(`  ${at}  capture charged ${String(used).padStart(5)} (+${dUsed})   reconciled calls ${String(n).padStart(4)} (+${dN})   fresh-live ${series.at(-1)?.fresh ?? '?'}   sportCount ${series.at(-1)?.sportCount ?? '?'}   lastPoll ${series.at(-1)?.lastPoll?.slice(11, 19) ?? '?'}`);
      prevCharge = used; prevN = n;
    } catch (e) { say(`  ${at} /budget/odds: ${e.message}`); }
  }
  flush();
  minutes++;
  await new Promise(r => setTimeout(r, 30000));
}

if (tail) { tail.kill('SIGTERM'); await new Promise(r => setTimeout(r, 2000)); }
tailOut.end();

say(`\n── games first seen live in the window`);
if (!seen.size) say('  none');
for (const [id, e] of seen) say(`  ${id}  ${e.sport}  ${e.game}  live ${e.first}..${e.last} over ${e.readings} readings  last ${e.score}`);
const counts = series.map(x => x.sportCount);
say(`\n── AmbientDO entries: sportCount min ${Math.min(...counts)} max ${Math.max(...counts)} over ${series.length} readings; ${instances} distinct instance(s) seen`);
say(`── tail: ${tally.events} events (${tally.unparsed} unparsed), ${tally.kept} kept to ${TAIL}, ${tally.exceptions} with exceptions, outcomes ${JSON.stringify(tally.outcomes)}`);
say(`   by entrypoint:event  ${JSON.stringify(Object.entries(tally.by).sort((a, b) => b[1] - a[1]).slice(0, 12))}`);
say(`\nCOVERAGE: ${series.length} readings of /ambient/state at 30 s, ${Math.ceil(series.length / 2)} of /budget/odds at 60 s,`);
say(`over ${MINUTES} minutes. Calls per minute are differences of the reconcile count, so a minute`);
say(`straddling UTC midnight reads as a reset, not a negative. The tail keeps only events matching`);
say(`${KEEP} or carrying an exception; everything else is counted and dropped.`);
flush();
// SIGTERM reaches npx, not the wrangler it started, and that tail keeps this
// process alive: run 39714396288 sat in its Watch step past a 10-minute window
// until cancelled. The log is written, so exit; the tail's pipes close with us.
process.exit(0);
