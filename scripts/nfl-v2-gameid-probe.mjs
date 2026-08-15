// nfl-v2-gameid-probe.mjs — resolve the NFL EPA game-id question.
//
// The client's V2 game object sets espnEventId:null for NFL (only MLB/NBA/NHL
// fill it) and carries the relay id only as _gameId = fg.id. So NFL EPA polling
// must key on _gameId. This probe answers: IS fg.id from /v2/games?sport=nfl the
// ESPN event id that /espn-summary?event=<id> accepts?
//
// Method (GH runner, unrestricted egress):
//   1. GET live relay /v2/games?sport=nfl → collect each game's id + teams.
//   2. For the first game with an id, GET the live relay
//      /espn-summary/sports/football/nfl/summary?event=<id> and assert it
//      returns 200 with a drives object — i.e. the SAME id round-trips.
//   3. Cross-check that id also appears in ESPN's own scoreboard event list.

const RELAY = 'https://field-relay-nba.jeffunglesbee.workers.dev';
const SB = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';

let pass = 0, fail = 0;
const A = (l, c, d = '') => { console.log(`  ${c ? 'PASS' : 'FAIL'}  ${l}${d ? ' :: ' + d : ''}`); c ? pass++ : fail++; };
async function j(u) { const r = await fetch(u); const t = await r.text(); let b = null; try { b = JSON.parse(t); } catch {} return { status: r.status, b }; }

// 1. /v2/games?sport=nfl
const v2 = await j(`${RELAY}/v2/games?sport=nfl`);
A('/v2/games?sport=nfl returns 200', v2.status === 200, `HTTP ${v2.status}`);
const games = Array.isArray(v2.b?.games) ? v2.b.games : (Array.isArray(v2.b) ? v2.b : []);
A('/v2/games?sport=nfl returned games', games.length > 0, `count=${games.length}`);
if (games.length) {
  const g0 = games[0];
  console.log(`\n  first game keys: ${Object.keys(g0).join(', ')}`);
  console.log(`  first game id=${g0.id} home=${g0.home?.name} away=${g0.away?.name} start=${g0.start}\n`);
  A('game has an id field', g0.id !== undefined && g0.id !== null, String(g0.id));

  // 2. Does that id round-trip through /espn-summary?
  const id = g0.id;
  const sum = await j(`${RELAY}/espn-summary/sports/football/nfl/summary?event=${id}`);
  A('relay /espn-summary?event=<v2 id> returns 200', sum.status === 200, `HTTP ${sum.status}`);
  A('...and that summary has a drives object (id is the ESPN event id)',
    !!sum.b?.drives, sum.b?.drives ? 'drives present' : 'NO drives — id is NOT an ESPN event id');

  // 3. Cross-check the id appears in ESPN's own scoreboard.
  const today = new Date();
  let found = false, checkedDates = [];
  for (let back = 0; back <= 10 && !found; back++) {
    const d = new Date(today.getTime() - back * 86400000);
    const ymd = d.toISOString().slice(0, 10).replace(/-/g, '');
    const sb = await j(`${SB}?dates=${ymd}`);
    if (sb.status === 200 && sb.b?.events?.length) {
      checkedDates.push(ymd);
      if (sb.b.events.some(e => String(e.id) === String(id))) { found = true; break; }
    }
  }
  A('v2 game id matches an ESPN scoreboard event id', found,
    found ? `id=${id} confirmed in ESPN scoreboard` : `id=${id} NOT in scoreboard dates ${checkedDates.join(',')}`);
}

console.log(`\n== RESULT: ${pass} passed, ${fail} failed ==`);
process.exit(fail > 0 ? 1 : 0);
