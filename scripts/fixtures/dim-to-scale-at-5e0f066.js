// VERBATIM extract from scripts/rescore-quality-6b.mjs at commit 5e0f066
// ("feat: era 6 — Dim 10 reads the result instead of echoing the prompt", 2026-08-24),
// the last commit before DIM_TO_SCALE was fixed. Kept as a file rather than read
// from git because CI checkouts are shallow and an assertion that cannot run in
// CI is not a guard. Reproduce with:
//   git show 5e0f066:scripts/rescore-quality-6b.mjs | sed -n '/const DIM_TO_SCALE/,/^};/p'

const DIM_TO_SCALE = {
    specificity: 'spec', statDepth: 'statDepth', variety: 'variety',
    density: 'density', freshness: 'fresh', arcScore: 'arc',
    contextAnchoring: 'ctx', temporalScore: 'temporal',
    voiceScore: 'voice', matchupDepth: 'matchup',
};
