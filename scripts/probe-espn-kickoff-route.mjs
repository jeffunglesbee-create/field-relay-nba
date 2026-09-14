#!/usr/bin/env node
// READ-ONLY. Does an espn_event_id actually yield a kickoff?
//
// Task 0 recorded 476 rows as carrying "an anchor, resolvability UNTESTED".
// It is still untested, and 530 rows' status depends on it, so this tests it
// on real ids before any resolver is written.
//
// FROM A RUNNER, NOT THE WORKER. CC-CMD-2026-08-08-espn-site-api-403-p0
// measured that Akamai returns 403 to Cloudflare Worker egress IPs on
// site.api.espn.com while a bare fetch from a GitHub runner succeeds — the
// discriminator is the egress IP, not headers or slugs. The relay's mitigation
// (site.web.api) allows the summary endpoint only; there is no scoreboard path
// in the worker to reuse.
//
// ONE DATE, AND IT SAYS SO (Rule 91). A green result here proves the route for
// the slate it checked, not for 114.
import { writeFileSync } from 'node:fs';

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const GATE = process.env.RELAY_SHARED_SECRET;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const log = [];
const say = (s) => { console.log(s); log.push(s); };

// Standard ESPN slugs. NOT assumed correct — the probe prints the HTTP status
// so a wrong slug shows as a 404 rather than as "no events".
const SLUG = { MLB: 'baseball/mlb', WNBA: 'basketball/wnba', NBA: 'basketball/nba',
               NHL: 'hockey/nhl', MLS: 'soccer/usa.1', EPL: 'soccer/eng.1',
               'FIFA World Cup': 'soccer/fifa.world' };

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
  say(`=== does an espn_event_id yield a kickoff?  ${new Date().toISOString()} ===`);

  // One slate per sport that HAS ids, so a slug failure is visible per sport
  // rather than hidden behind MLB's success.
  const slates = await d1(
    `SELECT sport, date, COUNT(*) n FROM regular_season_games
      WHERE closing_odds IS NOT NULL AND start_time IS NULL AND espn_event_id IS NOT NULL
      GROUP BY sport, date ORDER BY n DESC`);
  const bySport = new Map();
  for (const s of slates) if (!bySport.has(s.sport)) bySport.set(s.sport, s);
  say(`\n${slates.length} slate(s) carry ids; probing the largest of each of ${bySport.size} sport(s).`);

  let sportsOk = 0, rowsProved = 0;
  for (const [sport, slate] of bySport) {
    const slug = SLUG[sport];
    say(`\n--- ${sport}  ${slate.date}  (${slate.n} row(s) on this slate)`);
    if (!slug) { say(`    NO SLUG MAPPED — this sport has no route and is not covered.`); continue; }
    const ymd = String(slate.date).replace(/-/g, '');
    const url = `https://site.api.espn.com/apis/site/v2/sports/${slug}/scoreboard?dates=${ymd}`;
    let r, body;
    try {
      r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
      body = await r.json().catch(() => null);
    } catch (e) { say(`    FETCH FAILED: ${e.message}`); continue; }
    if (!r.ok || !body) { say(`    HTTP ${r?.status} — no usable body. Slug or egress, not "no events".`); continue; }

    const events = body.events || [];
    say(`    HTTP ${r.status}, ${events.length} event(s) returned`);
    if (!events.length) { say(`    zero events for this date — the slug resolves but the slate does not.`); continue; }

    // The claim under test: OUR stored id appears in ESPN's response AND that
    // event carries a start time.
    const ours = await d1(
      `SELECT id, espn_event_id, home, away FROM regular_season_games
        WHERE sport = ? AND date = ? AND closing_odds IS NOT NULL
          AND start_time IS NULL AND espn_event_id IS NOT NULL`, [sport, slate.date]);
    const byId = new Map(events.map(e => [String(e.id), e]));
    let matched = 0, withDate = 0;
    for (const row of ours) {
      const ev = byId.get(String(row.espn_event_id));
      if (!ev) continue;
      matched++;
      if (ev.date) withDate++;
      if (matched <= 2)
        say(`        ${row.id}  espn=${row.espn_event_id}  ->  date=${ev.date}  (${ev.name ?? ''})`);
    }
    say(`    ${matched} of ${ours.length} stored ids found in the response; ${withDate} carry a date.`);
    if (withDate === ours.length && ours.length) { sportsOk++; rowsProved += withDate; }
    else say(`    ROUTE NOT PROVEN for ${sport} on this slate.`);
  }

  say(`\nCOVERAGE (Rule 91): probed ONE slate per sport — ${bySport.size} of ${slates.length} slates.`);
  say(`Route proven for ${sportsOk} of ${bySport.size} sport(s) probed, on ${rowsProved} row(s).`);
  say(`A green result here is a claim about the slates checked, not about all 530.`);

  const p = `outbox/espn-kickoff-route-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
  writeFileSync(p, log.join('\n') + '\n');
  console.log(`\nwrote ${p}`);
})().catch(e => {
  console.error(`\nFAILED: ${e.message}`);
  writeFileSync(`outbox/espn-kickoff-route-failed-${Date.now()}.log`, log.concat(`FAILED: ${e.message}`).join('\n') + '\n');
  process.exit(1);
});
