// nfl-preseason-start-probe.mjs — find the real 2026 NFL preseason opener date,
// so the client's FIELD_V2_SOURCES.nfl gate can be set to a VERIFIED boundary
// (Rule 72: don't guess season dates). Walks ESPN's NFL scoreboard backward from
// today across the preseason window and reports the earliest date carrying games,
// plus each game's seasontype (1=pre, 2=reg).

const SB = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';
async function j(u){const r=await fetch(u);const t=await r.text();let b=null;try{b=JSON.parse(t);}catch{}return{status:r.status,b};}

const dates = [];
// Sweep 2026-07-25 .. 2026-08-16 (HOF game + preseason weeks 1-2 window).
const start = new Date('2026-07-25T00:00:00Z'), end = new Date('2026-08-16T00:00:00Z');
for (let d = new Date(start); d <= end; d = new Date(d.getTime() + 86400000)) {
  const ymd = d.toISOString().slice(0,10).replace(/-/g,'');
  const { status, b } = await j(`${SB}?dates=${ymd}`);
  if (status === 200 && b?.events?.length) {
    const types = [...new Set(b.events.map(e => e.season?.type ?? e.competitions?.[0]?.type?.id ?? '?'))];
    const states = [...new Set(b.events.map(e => e.status?.type?.state))];
    dates.push({ ymd, count: b.events.length, seasontypes: types, states,
      sample: b.events[0]?.name });
  }
}

console.log(`NFL scoreboard dates with games, 2026-07-25..08-16:\n`);
for (const d of dates) console.log(`  ${d.ymd}  games=${d.count}  seasontype=${JSON.stringify(d.seasontypes)}  states=${JSON.stringify(d.states)}  e.g. ${d.sample}`);
console.log(`\nEARLIEST date with games: ${dates[0]?.ymd || 'NONE FOUND'}`);
console.log(`\n== RESULT: ${dates.length} dates found ==`);
