// Diagnose the one BSD route that failed: /bsd/events/{id}/average-positions.
//
// bsd-api-probe (2026-08-13T01:50Z) found every sibling route 200 on event
// 207955 while average-positions returned 404 in 53 bytes. That is not enough
// to act on: it is equally consistent with
//
//   (a) the upstream endpoint does not exist at all,
//   (b) it exists but is gated behind a BSD plan tier this token lacks,
//   (c) it exists and simply has no data for THAT event.
//
// (a) and (b) are route-level and need the relay changed; (c) is per-event and
// needs nothing changed. Probing ONE event cannot separate them, which is why
// the first probe's finding was reported as unresolved rather than fixed.
//
// TWO measurements, both through the relay (BSD_API_TOKEN lives only in the
// Worker, so a direct upstream call is not available here and would anyway
// measure a path no client traverses):
//
//   1. average-positions across SEVERAL played events, with the FULL upstream
//      body -- the relay passes status and body through verbatim
//      (src/index.js:9418), so a 404 here IS the upstream's 404, and its body
//      text is what distinguishes "no such endpoint" from "not subscribed".
//
//   2. whether /bsd/events/{id}/shotmap -- which proxies /stats/ -- already
//      carries `average_positions` for those same events. This is the
//      decisive one for the FIX: the relay's own R2 writer at
//      src/index.js:2374 already reads `parsed.average_positions` out of
//      /stats/ and stores it with customMetadata.source 'stats-fallback'. If
//      /stats/ carries it live too, reading it from there is correct whatever
//      the standalone endpoint's status turns out to mean.
//
// Read-only. GETs only.

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const DATE = process.env.PROBE_DATE || new Date().toISOString().slice(0, 10);
const TS = new Date().toISOString();

async function getJson(path) {
  const r = await fetch(`${RELAY}${path}`, { signal: AbortSignal.timeout(30000) });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) { /* keep raw */ }
  return { status: r.status, bytes: text.length, text, json };
}

const statusOf = (e) => String(e?.status?.type ?? e?.status ?? e?.state ?? '').toLowerCase();
const PLAYED = /finish|ft|ended|complete|inprogress|live|1st|2nd|half/;

(async () => {
  const out = { ts: TS, relay: RELAY, date: DATE, events: [] };
  try {
    // Widen the candidate pool: one day held only 2 played events out of 48,
    // and a per-event explanation cannot be ruled out from a single sample.
    const days = [DATE];
    for (let i = 1; i <= 3; i++) {
      days.push(new Date(Date.parse(DATE) - i * 86400000).toISOString().slice(0, 10));
    }
    const candidates = [];
    for (const d of days) {
      const r = await getJson(`/bsd/events/by-date?date=${d}`);
      const list = r.json?.results ?? r.json?.events ?? [];
      for (const e of (Array.isArray(list) ? list : [])) {
        if (PLAYED.test(statusOf(e)) && (e.id ?? e.event_id) != null) {
          candidates.push({ id: e.id ?? e.event_id, date: d, status: statusOf(e) });
        }
      }
      console.log(`  ${d}: ${Array.isArray(list) ? list.length : 0} events, ` +
        `${candidates.filter((c) => c.date === d).length} played`);
    }
    out.candidateCount = candidates.length;
    const probe = candidates.slice(0, 6);
    out.probedEvents = probe;
    console.log(`\ncandidates=${candidates.length}; probing ${probe.length}\n`);

    for (const c of probe) {
      const ap = await getJson(`/bsd/events/${c.id}/average-positions`);
      const sm = await getJson(`/bsd/events/${c.id}/shotmap`);
      const apInStats = sm.json?.average_positions ?? null;
      const rec = {
        ...c,
        avgPosStatus: ap.status,
        avgPosBytes: ap.bytes,
        // The full body, not a truncated head. 53 bytes is small enough to
        // quote whole, and the wording is the entire evidence for (a) vs (b).
        avgPosBody: ap.text.slice(0, 300),
        shotmapStatus: sm.status,
        statsHasAvgPositions: apInStats != null,
        statsAvgPosShape: Array.isArray(apInStats)
          ? `array[${apInStats.length}]`
          : (apInStats && typeof apInStats === 'object'
            ? `object{${Object.keys(apInStats).slice(0, 8).join(',')}}` : String(apInStats)),
        statsAvgPosCount: Array.isArray(apInStats) ? apInStats.length
          : (apInStats && typeof apInStats === 'object' ? Object.keys(apInStats).length : 0),
      };
      out.events.push(rec);
      console.log(`event ${c.id} (${c.status})  avgPos=${rec.avgPosStatus} ` +
        `statsHasAvgPositions=${rec.statsHasAvgPositions} ` +
        `(${rec.statsAvgPosShape}, n=${rec.statsAvgPosCount})`);
      console.log(`   body: ${rec.avgPosBody}`);
    }

    const n = out.events.length;
    out.summary = {
      probed: n,
      avgPosStatuses: [...new Set(out.events.map((e) => e.avgPosStatus))],
      // Route-level if EVERY event fails identically; per-event if mixed.
      allAvgPosFailed: n > 0 && out.events.every((e) => e.avgPosStatus !== 200),
      anyAvgPosOk: out.events.some((e) => e.avgPosStatus === 200),
      distinctBodies: [...new Set(out.events.map((e) => e.avgPosBody))],
      // The fix path: does /stats/ carry the data the standalone route won't?
      statsCarriesAvgPositions: out.events.filter((e) => e.statsHasAvgPositions).length,
      statsAvgPosCounts: out.events.map((e) => e.statsAvgPosCount),
    };
    console.log('\n=== SUMMARY ===');
    console.log(JSON.stringify(out.summary, null, 2));
  } catch (e) {
    out.error = String(e.stack || e.message || e);
    console.error('diagnose failed:', out.error);
  }

  const fs = await import('node:fs');
  fs.mkdirSync('outbox', { recursive: true });
  fs.writeFileSync(`outbox/bsd-avgpos-diagnose-${TS.replace(/[:.]/g, '-')}.json`,
    JSON.stringify(out, null, 2));
  process.exit(0);
})();
