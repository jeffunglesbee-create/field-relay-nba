// The authority for briefs.sport, measured rather than assembled.
//
// The canonicaliser about to be widened needs a set of labels to recover TO.
// That set is not a matter of taste: it is whatever the games tables actually
// carry, because a brief whose sport matches no games-table label is unreachable
// by every sport-filtered read — the exact defect
// `scripts/check-brief-sport-label.mjs` was written for.
//
// `scripts/brief-label-migration.mjs` records the trap this exists to avoid.
// Its first run used a HAND-WRITTEN conforming set, which lacked EFL Cup, EFL
// Trophy and the three UEFA qualifying labels, and it reported 106 correctly-
// labelled rows as non-conforming. The census's own test is "the games table
// carries this form", so this asks the games tables.
//
// READ ONLY. Every statement is a SELECT.

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const RELAY_GATE = process.env.RELAY_SHARED_SECRET;
const need = (v, n) => { if (!v) { console.error(`${n} is not set. This script will not guess it.`); process.exit(1); } return v; };

async function d1(sql, params = []) {
  const r = await fetch(`${RELAY}/d1/execute`, {
    method: 'POST',
    headers: { 'X-FIELD-Relay': need(RELAY_GATE, 'RELAY_SHARED_SECRET'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, params }),
  });
  const t = await r.text();
  let b; try { b = JSON.parse(t); } catch { return { error: t.slice(0, 300) }; }
  if (!r.ok || b.ok === false) return { error: `HTTP ${r.status} ${t.slice(0, 300)}` };
  return { rows: b.results || [] };
}

const out = { ran_at: new Date().toISOString(), relay: RELAY };

// Both tables, separately, because a label present in only one is still an
// authority label and a UNION would hide which side declares it.
out.regular_season_sports = await d1(
  `SELECT sport, COUNT(*) AS n FROM regular_season_games WHERE sport IS NOT NULL GROUP BY sport ORDER BY sport`);
out.postseason_sports = await d1(
  `SELECT sport, COUNT(*) AS n FROM postseason_games WHERE sport IS NOT NULL GROUP BY sport ORDER BY sport`);

// The full briefs distribution, so the non-conforming set is derived here rather
// than inherited from the migration script's own idea of it.
out.briefs_sports = await d1(
  `SELECT sport, COUNT(*) AS n FROM briefs WHERE sport IS NOT NULL GROUP BY sport ORDER BY n DESC`);

const names = r => (r.rows || []).map(x => x.sport);
const authority = [...new Set([...names(out.regular_season_sports), ...names(out.postseason_sports)])].sort();
const briefLabels = names(out.briefs_sports);
out.authority = authority;
out.authority_count = authority.length;
out.briefs_not_in_authority = briefLabels.filter(s => !authority.includes(s));

// Case-insensitive collisions inside the authority itself. `wnba` and `WNBA`
// both being real is what makes blind casing recovery unsafe, and the migration
// script refuses a value matching two labels for exactly this reason.
const byLower = {};
for (const a of authority) (byLower[a.toLowerCase()] ||= []).push(a);
out.authority_case_collisions = Object.entries(byLower).filter(([, v]) => v.length > 1);

const { writeFileSync } = await import('node:fs');
const stamp = out.ran_at.replace(/[:.]/g, '-');
writeFileSync(`outbox/brief-sport-authority-${stamp}.json`, JSON.stringify(out, null, 2) + '\n');

console.log(`authority (${authority.length}):`);
for (const a of authority) console.log(`  ${JSON.stringify(a)}`);
console.log(`\ncase-insensitive collisions inside the authority: ${JSON.stringify(out.authority_case_collisions)}`);
console.log(`\nbriefs labels NOT in the authority (${out.briefs_not_in_authority.length}):`);
for (const s of out.briefs_not_in_authority) {
  const n = (out.briefs_sports.rows || []).find(r => r.sport === s)?.n;
  console.log(`  ${JSON.stringify(s)}  ${n} row(s)`);
}
