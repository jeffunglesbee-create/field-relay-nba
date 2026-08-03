// CC-CMD-2026-08-03-fix-drama-backfill-situational-fields TASK 1 follow-up
// probe: the first probe's sample play (a "Start Inning" play) had no
// baserunners, so onFirst/onSecond/onThird's real location is still
// unconfirmed. Scans ALL 514 real plays of event 401696639 for any key
// resembling base-runner state, and reports the real key set observed
// across every distinct play `type.text`, plus a play with actual runners
// on base if one exists.

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const MLB_EVENT_ID = '401696639';

function deepKeys(obj, prefix = '') {
  if (obj == null || typeof obj !== 'object') return [];
  let keys = [];
  for (const k of Object.keys(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    keys.push(path);
    if (obj[k] && typeof obj[k] === 'object' && !Array.isArray(obj[k])) {
      keys = keys.concat(deepKeys(obj[k], path));
    }
  }
  return keys;
}

async function main() {
  const url = `${RELAY}/espn-summary/sports/baseball/mlb/summary?event=${MLB_EVENT_ID}`;
  const res = await fetch(url);
  console.log('HTTP', res.status);
  const data = await res.json();
  const plays = data.plays || [];
  console.log('plays.length =', plays.length);

  // Union of all top-level keys across every play.
  const allTopKeys = new Set();
  plays.forEach(p => Object.keys(p).forEach(k => allTopKeys.add(k)));
  console.log('\nUnion of ALL top-level keys across all', plays.length, 'plays:', [...allTopKeys].sort());

  // Search for anything base-runner-ish anywhere in the object tree of any play.
  const baseRunnerPattern = /on(first|second|third)|base(runner)?s?\b|runner/i;
  let foundPath = null, foundPlay = null;
  for (const p of plays) {
    const keys = deepKeys(p);
    const hit = keys.find(k => baseRunnerPattern.test(k));
    if (hit) { foundPath = hit; foundPlay = p; break; }
  }
  if (foundPath) {
    console.log('\nFOUND base-runner-ish key path:', foundPath);
    console.log('Play containing it:', JSON.stringify(foundPlay, null, 2).slice(0, 3000));
  } else {
    console.log('\nNO base-runner-ish key found anywhere in any of the', plays.length, 'real play objects.');
    console.log('This means ESPN\'s real MLB summary /plays payload for this event carries NO base-runner state at all -- not top-level, not nested under any name.');
  }

  // Also show a play with type.text mentioning a hit/walk/steal, to see its real shape.
  const interesting = plays.find(p => /single|double|triple|walk|steal|hit by pitch/i.test(p.type?.text || ''));
  if (interesting) {
    console.log('\nSample "on-base-triggering" play (', interesting.type?.text, '):');
    console.log(JSON.stringify(interesting, null, 2).slice(0, 2000));
  }

  // Confirm balls/strikes real location precisely.
  const withCounts = plays.find(p => p.pitchCount || p.resultCount || p.count);
  if (withCounts) {
    console.log('\nSample play with count-ish fields:');
    console.log('pitchCount:', JSON.stringify(withCounts.pitchCount));
    console.log('resultCount:', JSON.stringify(withCounts.resultCount));
    console.log('count (if any):', JSON.stringify(withCounts.count));
  }
}

main().catch(e => { console.error('PROBE ERROR:', e); process.exit(1); });
