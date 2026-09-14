#!/usr/bin/env node
// CC-CMD-2026-09-14-closing-odds-captured-after-kickoff, the last 54.
//
// Resolves ONLY the rows with a route proven on 2026-09-14:
//
//   TWIN (18)  a census-paired twin carrying start_time. Same match, so the
//              twin's kickoff IS this row's kickoff — proven on the D.C. United
//              pairs. No string compared; the census owns the pairing.
//   SOLE (7)   the slate returned exactly one event and the archive holds
//              exactly one row. Unambiguous without comparing a name.
//
// IT RESOLVES NOTHING ELSE, AND THE 19 IT LEAVES ARE THE POINT.
// NBA/NHL Finals rows whose slate returns zero events were chased through three
// hypotheses, all refuted by measurement:
//   - season/seasontype parameters: 12 calls, 4 empty slates, 0 events.
//   - "May works, June does not": the empty slates are May dates.
//   - a day shift: day -1 AND day +1 each return exactly one event, which in a
//     playoff series is two real games and no discriminator. Worse than zero —
//     zero was honest.
// Our date is already the local date (nba-ecf-2026-g1 on slate 2026-05-20
// matched an event at 2026-05-21T00:30Z, a 20:30 ET tip-off), so the UTC
// explanation is dead too. Either the archive's date is wrong for those rows or
// something else is, and nothing measured separates them.
//
// DRY RUN UNLESS --apply.
import { writeFileSync } from 'node:fs';

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const APPLY = process.argv.includes('--apply');
const GATE = process.env.RELAY_SHARED_SECRET;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const SLUG = { NBA: 'basketball/nba', NHL: 'hockey/nhl', MLS: 'soccer/usa.1' };
const TABLES = ['regular_season_games', 'postseason_games'];
const log = [];
const say = (s) => { console.log(s); log.push(s); };
const dump = (k) => {
  const p = `outbox/last-54-resolve-${k}-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
  writeFileSync(p, log.join('\n') + '\n'); console.log(`\nwrote ${p}`);
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
  say(`=== last-54 resolve  apply=${APPLY}  utc=${new Date().toISOString()} ===`);
  const rows = [];
  for (const t of TABLES) {
    const r = await d1(`SELECT id, sport, date FROM ${t}
        WHERE closing_odds IS NOT NULL AND start_time IS NULL AND espn_event_id IS NULL`);
    for (const x of r) rows.push({ table: t, ...x });
  }
  say(`\n--- 0. ${rows.length} row(s) with neither field`);

  // ── Route A: the twin ───────────────────────────────────────────────────
  const cen = await (await fetch(`${RELAY}/identity/substitution-census`, { headers: { 'User-Agent': UA } })).json();
  if (!cen.ok || cen.same_slate_pair_detail_error)
    throw new Error(`census unusable: ${cen.error || cen.same_slate_pair_detail_error}`);
  const partner = new Map();
  for (const c of (cen.same_slate_pair_colliding || [])) {
    const [x, y] = c.games;
    if (x && y) { partner.set(x.id, y); partner.set(y.id, x); }
  }
  const plan = [];
  for (const r of rows) {
    const p = partner.get(r.id);
    if (p?.start_time) plan.push({ ...r, start_time: p.start_time, via: `twin ${p.id}` });
  }
  say(`--- 1. twin route: ${plan.length}`);

  // ── Route B: sole event on the slate ────────────────────────────────────
  const claimed = new Set(plan.map(p => p.id));
  const slates = new Map();
  for (const r of rows) {
    if (claimed.has(r.id)) continue;
    const k = `${r.sport}|${r.date}`;
    if (!slates.has(k)) slates.set(k, { sport: r.sport, date: r.date, rows: [] });
    slates.get(k).rows.push(r);
  }
  let ambiguous = 0, unmeasured = 0;
  for (const s of slates.values()) {
    if (!SLUG[s.sport]) { ambiguous += s.rows.length; continue; }
    const url = `https://site.api.espn.com/apis/site/v2/sports/${SLUG[s.sport]}/scoreboard`
              + `?dates=${String(s.date).replace(/-/g, '')}`;
    let body = null;
    try { const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
          if (r.ok) body = await r.json().catch(() => null); } catch { /* below */ }
    if (!body) { unmeasured += s.rows.length; continue; }   // Rule 99
    const ev = body.events || [];
    // ONE AND ONE. Anything else is left alone: a shifted-day match would be a
    // coin flip between two games of the same series.
    if (ev.length === 1 && s.rows.length === 1 && ev[0].date)
      plan.push({ ...s.rows[0], start_time: ev[0].date, via: `sole event ${ev[0].id}` });
    else ambiguous += s.rows.length;
  }
  say(`--- 2. sole-event route: ${plan.length - [...claimed].length}`);
  say(`    plan ${plan.length}; ${ambiguous} ambiguous, ${unmeasured} not measured, `
    + `${rows.length - plan.length - ambiguous - unmeasured} otherwise unaccounted`);
  for (const p of plan.slice(0, 5)) say(`    ${p.id}  ->  ${p.start_time}  via ${p.via}`);

  if (!APPLY) { say(`\nDRY RUN. Nothing written.`); dump('dryrun'); process.exit(0); }

  say(`\n--- 3. writing`);
  for (const p of plan)
    await d1(`UPDATE ${p.table} SET start_time = ? WHERE id = ? AND start_time IS NULL`, [p.start_time, p.id]);
  say(`    ${plan.length} written`);

  // Derived, not chosen. D1 caps bound parameters at 100 per statement and this
  // binds one per column; the 2026-09-13 cleanup picked 40 by hand, bound 240,
  // and died after its deletes had committed.
  const D1_MAX_BOUND_PARAMS = 100;
  const CHANGELOG_COLUMNS = 6;
  const CHUNK = Math.floor(D1_MAX_BOUND_PARAMS / CHANGELOG_COLUMNS);
  for (let i = 0; i < plan.length; i += CHUNK) {
    const c = plan.slice(i, i + CHUNK), params = [];
    for (const p of c) params.push(p.id, 'last54_start_time_resolve', 'start_time', null,
                                   `${p.start_time} (${p.via})`, new Date().toISOString());
    await d1(`INSERT INTO change_log (game_id, source, field, old_value, new_value, ts) VALUES `
           + c.map(() => '(?, ?, ?, ?, ?, ?)').join(', '), params);
  }
  say(`    ${plan.length} change_log entries`);

  say(`\n--- 4. re-read`);
  let left = 0;
  for (const t of TABLES) {
    const r = (await d1(`SELECT COUNT(*) n FROM ${t}
        WHERE closing_odds IS NOT NULL AND start_time IS NULL AND espn_event_id IS NULL`))[0] || {};
    say(`    ${t}: ${r.n} still unrouted`); left += r.n ?? 0;
  }
  const expected = rows.length - plan.length;
  const ok = left === expected;
  say(ok ? `\nOK: ${left} unrouted, exactly the ${expected} this run had no proven route for.`
         : `\nMISMATCH: ${left} unrouted, expected ${expected}.`);
  dump(ok ? 'applied' : 'mismatch');
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(`\nFAILED: ${e.message}`); log.push(`FAILED: ${e.message}`); dump('failed'); process.exit(1); });
