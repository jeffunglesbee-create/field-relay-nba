// One-shot CI probe. Critical follow-up: the CC-CMD's classify step checks
// "position ON" (resolved via the core athlete endpoint) against a
// GRANULAR defensive set {D, LB, RB, CB, DM} -- same vocabulary as the
// roster's position.abbreviation field. But the one core-athlete example
// probed so far (Harbor Miller) returned abbreviation "D" / name
// "Defender", which looks like a COARSE 4-category vocabulary (G/D/M/F),
// not the granular roster vocabulary (LB/RB/CB/DM/CM/RM/LF/RF/AM/F/D).
// Test every incoming sub from the real test game to confirm which
// vocabulary the core endpoint actually uses before writing classify logic
// against the wrong abbreviation set.

const CORE_ATHLETE_URL = (id) => `https://sports.core.api.espn.com/v2/sports/soccer/leagues/usa.1/athletes/${id}`;

// All 10 incoming-sub athlete IDs from event 761664 (index 0 of each
// participants[] pair, confirmed ON in the prior probe run).
const INCOMING_SUB_IDS = [
    '366047', '297050', '237823', '133963', '115713',
    '319023', '179237', '321370', '398302', '251805',
];

async function main() {
    console.log('=== probe-mls-sub-impact-coreposition-vocab ===\n');
    for (const id of INCOMING_SUB_IDS) {
        const r = await fetch(CORE_ATHLETE_URL(id), { headers: { 'User-Agent': 'FIELD/1.0' } });
        if (!r.ok) { console.log(`athlete ${id}: HTTP ${r.status}`); continue; }
        const d = await r.json();
        console.log(JSON.stringify({
            id, displayName: d.displayName,
            positionName: d.position?.name, positionAbbr: d.position?.abbreviation,
        }));
    }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
