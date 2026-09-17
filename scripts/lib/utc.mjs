// SQLite's `datetime('now')` writes `YYYY-MM-DD HH:MM:SS` with no zone marker.
// It is UTC. V8's Date.parse reads that shape as LOCAL time, so on any runner
// that is not UTC the value lands hours away and a row moves across an interval
// edge — silently included or dropped from a subtraction.
//
// ITS OWN MODULE BECAUSE THE TEST MUST RUN IN A CHILD PROCESS. The hazard only
// appears under a non-UTC TZ, which cannot be changed inside a running Node
// process for Date.parse. The self-test therefore spawns a child with
// TZ=America/New_York — and that child has to import the REAL function. When
// this lived in the watcher, the child carried an inline copy of the logic and
// mutating the watcher changed nothing: mutation M38 came back NOT CAUGHT
// against a test that was checking a copy of its subject.
export const asUtc = (t) => {
  const s = String(t || '').trim();
  if (!s) return NaN;
  return Date.parse(/[TZ]/.test(s) ? s : s.replace(' ', 'T') + 'Z');
};
