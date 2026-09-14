#!/usr/bin/env node
// CC-CMD-2026-09-14-closing-odds-captured-after-kickoff, Task 0 residual.
//
// 530 closing lines sit on rows with no start_time and cannot be asked whether
// they preceded kickoff. 476 carry an espn_event_id. scripts/probe-espn-kickoff-
// route.mjs proved that route on 2026-09-14: 5 of 5 sports, 33 of 33 stored ids
// found in ESPN's scoreboard, every one carrying a date.
//
// FROM A RUNNER. CC-CMD-2026-08-08-espn-site-api-403-p0 measured Akamai
// returning 403 to Cloudflare Worker egress on site.api.espn.com while a bare
// fetch from a GitHub runner succeeds. The discriminator is the egress IP.
//
// ONE CALL PER SLATE, NOT PER EVENT. The scoreboard returns a whole day, so the
// unit of work is 85 (sport, date) slates rather than 476 events.
//
// DRY RUN UNLESS --apply.
import { writeFileSync } from 'node:fs';

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const APPLY = process.argv.includes('--apply');
const GATE = process.env.RELAY_SHARED_SECRET;
const ESPN_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Proven on one slate each, 2026-09-14. A sport absent here has no route and is
// reported as uncovered rather than silently skipped.
const SLUG = { MLB: 'baseball/mlb', WNBA: 'basketball/wnba', NBA: 'basketball/nba',
               NHL: 'hockey/nhl', MLS: 'soccer/usa.1', EPL: 'soccer/eng.1',
               'FIFA World Cup': 'soccer/fifa.world' };
const TABLES = ['regular_season_games', 'postseason_games'];
const log = [];
const say = (s) => { console.log(s); log.push(s); };
const dump = (kind) => {
  const p = `outbox/start-time-resolve-${kind}-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
  writeFileSync(p, log.join('\n') + '\n');
  console.log(`\nwrote ${p}`);
};

async function d1(sql, params = []) {
  if (!GATE) throw new Error('RELAY_SHARED_SECRET is not set');
  const res = await fetch(`${RELAY}/d1/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-FIELD-Relay': GATE,
               'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36' },
    body: JSON.stringify({ sql, params }),
  });
  const b = await res.json().catch(() => ({}));
  if (!res.ok || b.success === false) throw new Error(`d1 HTTP ${res.status}: ${JSON.stringify(b).slice(0, 300)}`);
  return b.results || [];
}

(async () => {
  say(`=== start_time resolve  apply=${APPLY}  utc=${new Date().toISOString()} ===`);

  // ── 0. The rows, grouped into the unit of work ──────────────────────────
  const rows = [];
  for (const t of TABLES) {
    const r = await d1(
      `SELECT id, sport, date, espn_event_id FROM ${t}
        WHERE closing_odds IS NOT NULL AND start_time IS NULL AND espn_event_id IS NOT NULL`);
    for (const x of r) rows.push({ table: t, ...x });
  }
  const slates = new Map();
  for (const r of rows) {
    const k = `${r.sport}|${r.date}`;
    if (!slates.has(k)) slates.set(k, { sport: r.sport, date: r.date, rows: [] });
    slates.get(k).rows.push(r);
  }
  const noSlug = [...slates.values()].filter(s => !SLUG[s.sport]);
  say(`\n--- 0. ${rows.length} row(s) across ${slates.size} slate(s)`);
  for (const s of noSlug)
    say(`    NO SLUG: ${s.sport} ${s.date} (${s.rows.length} row(s)) — no route, not attempted`);

  // ── 1. One scoreboard per slate ─────────────────────────────────────────
  const found = [], missing = [], failedSlates = [];
  for (const s of slates.values()) {
    const slug = SLUG[s.sport];
    if (!slug) continue;
    const url = `https://site.api.espn.com/apis/site/v2/sports/${slug}/scoreboard`
              + `?dates=${String(s.date).replace(/-/g, '')}`;
    let body = null, status = 0;
    try {
      const r = await fetch(url, { headers: { 'User-Agent': ESPN_UA, Accept: 'application/json' } });
      status = r.status;
      if (r.ok) body = await r.json().catch(() => null);
    } catch (e) { status = -1; }
    // A SLATE THAT FAILED IS NOT A SLATE WITH NO EVENTS (Rule 99). It is
    // recorded and skipped, never folded into "not found".
    if (!body) { failedSlates.push({ ...s, status }); continue; }
    const byId = new Map((body.events || []).map(e => [String(e.id), e]));
    for (const row of s.rows) {
      const ev = byId.get(String(row.espn_event_id));
      // THE EVENT'S OWN DATE, NEVER THE QUERIED ONE. The probe caught a FIFA
      // slate queried as 2026-07-02 returning an event dated 2026-07-03T03:00Z
      // — a late kickoff crossing UTC midnight. Taking the query date would
      // have written the wrong day for every such game.
      if (ev?.date) found.push({ ...row, start_time: ev.date, name: ev.name });
      else missing.push({ ...row, why: ev ? 'event carries no date' : 'id not in scoreboard' });
    }
  }

  say(`\n--- 1. scoreboard`);
  say(`    resolved ${found.length}, unresolved ${missing.length}, `
    + `failed slates ${failedSlates.length} (${failedSlates.reduce((n, s) => n + s.rows.length, 0)} row(s) not attempted)`);
  for (const s of failedSlates.slice(0, 5)) say(`        HTTP ${s.status}  ${s.sport} ${s.date}`);
  const byWhy = {};
  for (const m of missing) byWhy[m.why] = (byWhy[m.why] || 0) + 1;
  for (const [w, n] of Object.entries(byWhy)) say(`        ${n}  ${w}`);
  for (const f of found.slice(0, 3)) say(`    e.g. ${f.id}  ->  ${f.start_time}  (${f.name})`);

  if (!APPLY) { say(`\nDRY RUN. Nothing was written. Re-run with --apply.`); dump('dryrun'); process.exit(0); }

  // ── 2. Write, guarded ───────────────────────────────────────────────────
  say(`\n--- 2. writing start_time`);
  let done = 0;
  for (const f of found) {
    await d1(`UPDATE ${f.table} SET start_time = ? WHERE id = ? AND start_time IS NULL`,
             [f.start_time, f.id]);
    if (++done % 100 === 0) say(`    ${done}/${found.length}`);
  }
  say(`    ${done} written`);

  const D1_MAX_BOUND_PARAMS = 100, CHANGELOG_COLUMNS = 6;
  const CHUNK = Math.floor(D1_MAX_BOUND_PARAMS / CHANGELOG_COLUMNS);
  say(`\n--- 3. change_log`);
  for (let i = 0; i < found.length; i += CHUNK) {
    const c = found.slice(i, i + CHUNK), params = [];
    for (const f of c)
      params.push(f.id, 'espn_start_time_resolve', 'start_time', null, f.start_time, new Date().toISOString());
    await d1(`INSERT INTO change_log (game_id, source, field, old_value, new_value, ts) VALUES `
           + c.map(() => '(?, ?, ?, ?, ?, ?)').join(', '), params);
  }
  say(`    ${found.length} entries`);

  // ── 4. Done condition, re-read ──────────────────────────────────────────
  say(`\n--- 4. re-read`);
  let stillNull = 0;
  for (const t of TABLES) {
    const r = (await d1(
      `SELECT COUNT(*) n FROM ${t}
        WHERE closing_odds IS NOT NULL AND start_time IS NULL AND espn_event_id IS NOT NULL`))[0] || {};
    say(`    ${t}: ${r.n} row(s) still have an espn id and no start_time`);
    stillNull += r.n ?? 0;
  }
  const expected = missing.length + failedSlates.reduce((n, s) => n + s.rows.length, 0);
  const ok = stillNull === expected;
  say(ok ? `\nOK: ${stillNull} unresolved, which is exactly the ${expected} this run could not resolve.`
         : `\nMISMATCH: ${stillNull} unresolved, expected ${expected}. Investigate before any further write.`);
  dump(ok ? 'applied' : 'mismatch');
  process.exit(ok ? 0 : 1);
})().catch(e => {
  console.error(`\nFAILED: ${e.message}`);
  log.push(`FAILED: ${e.message}`);
  dump('failed');
  process.exit(1);
});
