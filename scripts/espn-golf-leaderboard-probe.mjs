#!/usr/bin/env node
// What does ESPN's golf leaderboard answer when its first event lists no competitors?
//
// The ESPN core API mirror (scripts/espn-core-mirror.mjs, golfPass) counts "event N lists no competitors" as a FAILED read and exits 1; on 2026-11-25
// every run from 10:15Z to 17:45Z (runs 611 to 639) ended red on exactly that line, 1 failed of 1 wanted. The relay's own reader of the same leaderboard
// (getGolfLeaderboardFacts, src/index.js) treats a missing competitors array as an empty list. This reads the leaderboard the way the mirror does
// (no event parameter) and the way the relay does (the first event's id), and writes the SHAPE only: counts and field names, no player, no score.
//
//   node scripts/espn-golf-leaderboard-probe.mjs        (runs on a GitHub runner: ESPN is not reachable from the sandbox)
import fs from 'node:fs';

const SITE = process.env.ESPN_SITE || 'https://site.api.espn.com/apis/site/v2/sports';
const TS = new Date().toISOString();
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const kind = (v) => (Array.isArray(v) ? `array(${v.length})` : v === null ? 'null' : typeof v);

async function read(url) {
  const out = { url: url.replace(SITE, '{SITE}'), status: null, error: null, contentType: null, bytes: null, events: null, topKeys: null };
  let json = null;
  try {
    const r = await fetch(url, { redirect: 'manual', headers: { Accept: 'application/json', 'User-Agent': 'FIELD/1.0' }, signal: AbortSignal.timeout(30000) });
    out.status = r.status;
    out.contentType = r.headers.get('content-type');
    const text = await r.text();
    out.bytes = text.length;
    try { json = JSON.parse(text); } catch (_) { out.error = 'not JSON'; }
  } catch (e) { out.error = String(e && e.message ? e.message : e).slice(0, 80); }
  if (isObj(json)) {
    out.topKeys = Object.keys(json);
    out.events = Array.isArray(json.events) ? json.events.map((ev) => {
      const comp0 = isObj(ev) && Array.isArray(ev.competitions) ? ev.competitions[0] : undefined;
      return {
        id: isObj(ev) ? ev.id : null,
        name: isObj(ev) ? ev.name : null,
        keys: isObj(ev) ? Object.keys(ev) : null,
        date: isObj(ev) ? ev.date : null,
        endDate: isObj(ev) ? ev.endDate : null,
        season: isObj(ev) && isObj(ev.season) ? ev.season.year : null,
        statusState: isObj(ev) && isObj(ev.status) && isObj(ev.status.type) ? ev.status.type.state : null,
        statusCompleted: isObj(ev) && isObj(ev.status) && isObj(ev.status.type) ? ev.status.type.completed : null,
        statusDescription: isObj(ev) && isObj(ev.status) && isObj(ev.status.type) ? ev.status.type.description : null,
        tournament: isObj(ev) && isObj(ev.tournament) ? { keys: Object.keys(ev.tournament), numberOfRounds: ev.tournament.numberOfRounds ?? null } : null,
        competitions: kind(isObj(ev) ? ev.competitions : undefined),
        competition0Keys: isObj(comp0) ? Object.keys(comp0) : null,
        competitors: isObj(comp0) ? kind(comp0.competitors) : 'no competition',
        competitor0Keys: isObj(comp0) && Array.isArray(comp0.competitors) && isObj(comp0.competitors[0]) ? Object.keys(comp0.competitors[0]) : null,
        playersInStates: isObj(comp0) && Array.isArray(comp0.competitors)
          ? comp0.competitors.reduce((t, c) => { const s = isObj(c) && isObj(c.status) && isObj(c.status.type) ? String(c.status.type.state) : 'no status'; t[s] = (t[s] || 0) + 1; return t; }, {})
          : null,
      };
    }) : kind(json.events);
  }
  return out;
}

const first = await read(`${SITE}/golf/leaderboard?league=pga`);
const firstId = Array.isArray(first.events) && first.events[0] ? first.events[0].id : null;
const byEvent = firstId !== null ? await read(`${SITE}/golf/leaderboard?league=pga&event=${encodeURIComponent(firstId)}`) : null;
const scoreboard = await read(`${SITE}/golf/pga/scoreboard`);

const manifest = {
  ts: TS,
  question: 'does the leaderboard the mirror reads list a competitors array for its first event, and does the event-specific read the relay uses differ?',
  mirrorRead: first,
  relayStyleRead: byEvent,
  scoreboardRead: scoreboard,
  firstEventListsCompetitors: Array.isArray(first.events) && first.events[0] ? /^array\(/.test(first.events[0].competitors) : null,
};
fs.mkdirSync('outbox', { recursive: true });
const file = `outbox/espn-golf-leaderboard-shape-${TS.replace(/[:.]/g, '-')}.json`;
fs.writeFileSync(file, JSON.stringify(manifest, null, 2));
console.log(`wrote ${file}`);
console.log(`mirror read: HTTP ${first.status}, ${Array.isArray(first.events) ? first.events.length : first.events} event(s); first event competitors: ${Array.isArray(first.events) && first.events[0] ? first.events[0].competitors : 'n/a'}`);
if (byEvent) console.log(`event-specific read: HTTP ${byEvent.status}, ${Array.isArray(byEvent.events) ? byEvent.events.length : byEvent.events} event(s); first event competitors: ${Array.isArray(byEvent.events) && byEvent.events[0] ? byEvent.events[0].competitors : 'n/a'}`);
