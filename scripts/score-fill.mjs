// One-shot score-fill for field-relay-nba.
// Fetches null-score past games (date < today) from /archive/score-missing,
// matches each against /v2/games by team name, writes real home_score/away_score
// and espn_event_id (where newly acquired) via /archive/score-by-id.
//
// Sport coverage via v2/games: MLB, WNBA, FIFA World Cup 2026 (wc26).
// CFL: not in v2/games — those rows remain genuinely unresolvable.

import { setTimeout as sleep } from 'node:timers/promises';

const RELAY    = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const DELAY_MS = 150;

// D1 sport string → v2/games sport param
const SPORT_MAP = {
    'MLB':                  'mlb',
    'WNBA':                 'wnba',
    'FIFA World Cup 2026':  'wc26',
};

function norm(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function main() {
    console.log('=== Score Fill ===');
    console.log(`Relay: ${RELAY}\n`);

    // 1. Fetch all null-score past games
    const listRes = await fetch(`${RELAY}/archive/score-missing`);
    if (!listRes.ok) throw new Error(`score-missing HTTP ${listRes.status}`);
    const { games, count } = await listRes.json();
    console.log(`Found ${count ?? games.length} null-score past games\n`);

    if (!games || games.length === 0) {
        console.log('Nothing to fill.');
        return;
    }

    // 2. Split into supported (can try v2/games) vs unsupported (no v2 coverage)
    const supported = [];
    const unsupported = [];
    for (const g of games) {
        if (SPORT_MAP[g.sport]) supported.push(g);
        else unsupported.push(g);
    }
    if (unsupported.length) {
        console.log(`No v2/games coverage for ${unsupported.length} rows (sports: ${[...new Set(unsupported.map(u => u.sport))].join(', ')})\n`);
    }

    // 3. Group supported rows by v2sport + date
    const groups = new Map();
    for (const g of supported) {
        const key = `${SPORT_MAP[g.sport]}|${g.date}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(g);
    }

    let scoresFilled = 0, idsFilled = 0;
    const unresolved = [...unsupported.map(u => ({ ...u, reason: 'sport not in v2/games' }))];

    // 4. For each sport+date group, fetch v2/games and match
    for (const [key, groupGames] of groups) {
        const [v2sport, date] = key.split('|');
        let v2games = [];
        try {
            const v2res = await fetch(`${RELAY}/v2/games?date=${date}&sport=${v2sport}`);
            if (v2res.ok) {
                const data = await v2res.json();
                v2games = (data.games || []).filter(g => g.state === 'post');
            } else {
                console.warn(`  v2/games ${v2res.status} for ${v2sport} ${date}`);
            }
        } catch (e) {
            console.error(`  v2/games fetch failed ${v2sport} ${date}: ${e.message}`);
        }
        await sleep(DELAY_MS);

        for (const game of groupGames) {
            const homeNorm = norm(game.home);
            const awayNorm = norm(game.away);

            const match = v2games.find(g =>
                norm(g.home?.name) === homeNorm && norm(g.away?.name) === awayNorm
            );

            if (!match) {
                unresolved.push({ ...game, reason: 'no v2/games match' });
                continue;
            }

            const homeScore = match.home?.score ?? null;
            const awayScore = match.away?.score ?? null;
            if (homeScore === null || awayScore === null) {
                unresolved.push({ ...game, reason: 'matched but score null' });
                continue;
            }

            // Only pass espn_event_id if the row doesn't already have one
            const newEspnId = (!game.espn_event_id && match.espnEventId) ? match.espnEventId : null;

            try {
                const writeRes = await fetch(`${RELAY}/archive/score-by-id`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: game.id, home_score: homeScore, away_score: awayScore, espn_event_id: newEspnId }),
                });
                if (!writeRes.ok) {
                    const txt = await writeRes.text();
                    throw new Error(`score-by-id ${writeRes.status}: ${txt.slice(0, 120)}`);
                }
                const result = await writeRes.json();
                if (!result.ok) throw new Error(`score-by-id error: ${result.error}`);

                scoresFilled++;
                if (newEspnId) idsFilled++;
                console.log(`  [ok] ${game.sport} | ${game.home} vs ${game.away} (${game.date}) → ${homeScore}-${awayScore}${newEspnId ? ` espnId=${newEspnId}` : ''}`);
            } catch (e) {
                unresolved.push({ ...game, reason: `write-error: ${e.message}` });
                console.error(`  [error] ${game.id}: ${e.message}`);
            }

            await sleep(DELAY_MS);
        }
    }

    // 5. Report
    console.log('\n=== Score Fill Results ===');
    console.log(`Scores filled:     ${scoresFilled}`);
    console.log(`ESPN IDs gained:   ${idsFilled}`);
    console.log(`Unresolved total:  ${unresolved.length}`);

    if (unresolved.length > 0) {
        const byReason = {};
        for (const u of unresolved) {
            byReason[u.reason] = byReason[u.reason] || [];
            byReason[u.reason].push(`${u.sport} | ${u.home} vs ${u.away} (${u.date})`);
        }
        console.log('\nUnresolved breakdown:');
        for (const [reason, items] of Object.entries(byReason)) {
            console.log(`  [${reason}] (${items.length}):`);
            for (const item of items.slice(0, 10)) console.log(`    ${item}`);
            if (items.length > 10) console.log(`    ... and ${items.length - 10} more`);
        }
    }

    // Exit 1 only on write errors, not on genuinely unresolvable rows
    const writeErrors = unresolved.filter(u => u.reason.startsWith('write-error'));
    if (writeErrors.length > 0) {
        console.error(`\n${writeErrors.length} write errors — exiting 1`);
        process.exit(1);
    }
}

main().catch(err => { console.error(err); process.exit(1); });
