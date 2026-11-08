// ─────────────────────────────────────────────────────────────────────────────
// FIELD — nflverse → R2 (NFL-A): RETIRED from the Worker 2026-11-08.
//
// This job parsed nflverse's all-seasons player_stats.csv (33.4 MB) inside the
// Worker on the Wednesday */15 cron. It hit the 128 MB memory limit on 45 ticks
// over four Wednesdays (2026-10-07..10-28; outbox/worker-cpu-read-localise-*),
// killing whatever else shared those invocations, and when it did complete
// (last on 2026-11-04T12:00Z) it published misparsed data: that file ends at the
// 2024 season, and its comma split shifted columns on 75,416 of 134,470 lines.
// Its two other sources (ngs_passing.csv, advstats_rec.csv) answer 404.
//
// nfl/{year}/player-stats.json is now built on a runner:
//   scripts/build-nfl-player-stats.mjs, .github/workflows/nfl-player-stats.yml
// (option B of docs/CC-CMD-2026-11-03-nfl-r2-player-stats-oom.md). The last
// version of this file is at commit 00c4866 (git show 00c4866:src/nfl-r2.js),
// which scripts/nfl-r2-memory-repro.mjs measures.
//
// Why a stub and not a deletion: the call in src/index.js (the Wednesday R2
// window and POST /nfl-r2-update) may not change between 2026-11-08 and 11-23
// (the CFL experiment's commit-based VOID window). Removing both callers and
// this file is docs/CC-CMD-2026-11-08-retire-nfl-r2-callers.md.
//
// ngs-passing.json is not decided here: its owner is
// docs/CC-CMD-2026-08-15-ngs-passing-two-writers.md. pfr-rec.json has no reader.
// ─────────────────────────────────────────────────────────────────────────────

export async function runNFLR2Update() {
  return {
    ok: false,
    retired: true,
    reason: 'moved to GitHub Actions (nfl-player-stats.yml); the Worker writes nothing',
    replacedBy: 'scripts/build-nfl-player-stats.mjs',
  };
}
