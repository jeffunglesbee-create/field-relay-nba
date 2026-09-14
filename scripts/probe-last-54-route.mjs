#!/usr/bin/env node
// READ-ONLY. Is there a route to a kickoff for the last 54 rows?
//
// 54 closing lines carry neither start_time nor an espn_event_id: 28
// dash-scheme MLS rows and 26 NBA/NHL postseason rows. This session said both
// "would need name matching" — the thing that broke the twin test earlier the
// same day (`Toronto FC` against `Toronto`). THAT CLAIM IS WRONG and this
// probe is what tests it instead of building on it.
//
// Two routes, neither comparing a string:
//
//   CARDINALITY, for the postseason rows. On a Finals date the league plays ONE
//   game. If the scoreboard returns exactly one event and the archive holds
//   exactly one row for that slate, they are the same game. Ambiguous only if
//   either side is not 1 — which this measures rather than assumes.
//
//   THE TWIN, for the MLS rows. They are collision rows; their FIFA-prefixed
//   twins carry espn ids and so gained a start_time in the resolve an hour ago.
//   Same match, so the twin's kickoff IS this row's kickoff — the route already
//   proven on the D.C. United pairs.
//
// SELECT only against D1. ESPN is read-only.
import { writeFileSync } from 'node:fs';

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const GATE = process.env.RELAY_SHARED_SECRET;
const ESPN_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const SLUG = { NBA: 'basketball/nba', NHL: 'hockey/nhl', MLS: 'soccer/usa.1' };
const TABLES = ['regular_season_games', 'postseason_games'];
const log = [];
const say = (s) => { console.log(s); log.push(s); };

async function d1(sql, params = []) {
  if (!GATE) throw new Error('RELAY_SHARED_SECRET is not set');
  if (!/^\s*SELECT\b/i.test(sql)) throw new Error('this probe issues SELECT only');
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
  say(`=== a route for the last 54?  ${new Date().toISOString()} ===`);

  const rows = [];
  for (const t of TABLES) {
    const r = await d1(
      `SELECT id, sport, date, home, away FROM ${t}
        WHERE closing_odds IS NOT NULL AND start_time IS NULL AND espn_event_id IS NULL`);
    for (const x of r) rows.push({ table: t, ...x });
  }
  say(`\n${rows.length} row(s) with neither start_time nor an espn_event_id.`);

  // ── ROUTE A: the twin, via the census's own pairing ─────────────────────
  // Asked of /identity/substitution-census, which pairs rows with the relay's
  // normaliser. Re-implementing that here is the source-versus-copy mistake
  // that made the first twin test return a structural zero.
  say(`\n--- A. twin carrying start_time (the route proven on the D.C. United pairs)`);
  const cen = await (await fetch(`${RELAY}/identity/substitution-census`,
                                 { headers: { 'User-Agent': ESPN_UA } })).json();
  let twinRoute = 0;
  if (!cen.ok || cen.same_slate_pair_detail_error) {
    say(`    CENSUS UNAVAILABLE (${cen.error || cen.same_slate_pair_detail_error}) — not measured, which is not zero.`);
  } else {
    const partner = new Map();
    for (const c of (cen.same_slate_pair_colliding || [])) {
      const [x, y] = c.games;
      if (x && y) { partner.set(x.id, y); partner.set(y.id, x); }
    }
    for (const r of rows) {
      const p = partner.get(r.id);
      if (p?.start_time) {
        twinRoute++;
        if (twinRoute <= 4) say(`    ${r.id}  <-  twin ${p.id}  start_time=${p.start_time}`);
      }
    }
    say(`    ${twinRoute} of ${rows.length} have a census-paired twin carrying start_time.`);
  }

  // ── ROUTE B: cardinality ────────────────────────────────────────────────
  // One event on the slate and one row in the archive is an unambiguous match
  // without comparing a single string. Anything else is reported as ambiguous
  // and is NOT a match.
  say(`\n--- B. one event on the slate, one row in the archive`);
  const slates = new Map();
  for (const r of rows) {
    const k = `${r.sport}|${r.date}`;
    if (!slates.has(k)) slates.set(k, { sport: r.sport, date: r.date, rows: [] });
    slates.get(k).rows.push(r);
  }
  let solo = 0, ambiguous = 0, noSlug = 0, failed = 0;
  for (const s of slates.values()) {
    const slug = SLUG[s.sport];
    if (!slug) { noSlug += s.rows.length; say(`    NO SLUG  ${s.sport} ${s.date}`); continue; }
    const url = `https://site.api.espn.com/apis/site/v2/sports/${slug}/scoreboard`
              + `?dates=${String(s.date).replace(/-/g, '')}`;
    let body = null, status = 0;
    try { const r = await fetch(url, { headers: { 'User-Agent': ESPN_UA, Accept: 'application/json' } });
          status = r.status; if (r.ok) body = await r.json().catch(() => null); }
    catch { status = -1; }
    // A failed fetch is not an empty slate (Rule 99).
    if (!body) { failed += s.rows.length; say(`    HTTP ${status}  ${s.sport} ${s.date} — not measured`); continue; }
    const events = body.events || [];
    if (events.length === 1 && s.rows.length === 1) {
      solo++;
      if (solo <= 4) say(`    ${s.rows[0].id}  <-  sole event ${events[0].id}  ${events[0].date}  (${events[0].name})`);
    } else {
      ambiguous += s.rows.length;
      say(`    AMBIGUOUS  ${s.sport} ${s.date}: ${events.length} event(s) vs ${s.rows.length} row(s)`);
    }
  }
  say(`\n    ${solo} row(s) matched by cardinality alone.`);
  say(`    ${ambiguous} ambiguous, ${noSlug} no slug, ${failed} not measured.`);
  say(`\nCOVERAGE: every one of the ${rows.length} rows was considered; `
    + `${twinRoute} have route A, ${solo} have route B. Routes may overlap and are NOT added.`);

  const p = `outbox/last-54-route-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
  writeFileSync(p, log.join('\n') + '\n');
  console.log(`\nwrote ${p}`);
})().catch(e => {
  console.error(`\nFAILED: ${e.message}`);
  writeFileSync(`outbox/last-54-route-failed-${Date.now()}.log`, log.concat(`FAILED: ${e.message}`).join('\n') + '\n');
  process.exit(1);
});
