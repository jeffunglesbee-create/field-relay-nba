// One implementation of "does this summary block contradict itself", imported by
// the probe that publishes it and by the guard that tests the guard.
//
// Era 5's defect was two consumers of one CONCEPT with separate implementations,
// which diverged. Era 5's fix was one implementation with two consumers — and
// that still diverged, on the ARGUMENT. So this module takes rows and nothing
// else: there is no second place to compute a total and no input to get wrong.

// Sums only values that ARE numbers, and reports how many were not. A
// non-numeric entry is a finding about the response, never a zero. `Number(x)
// || 0` is what turned 48 nulls into a confident briefs_counted: 0.
export const total = (rows, key) => {
  const vals = rows.map((x) => x?.[key]);
  const nums = vals.filter((v) => typeof v === 'number' && Number.isFinite(v));
  return { sum: nums.reduce((a, b) => a + b, 0), n: nums.length, skipped: vals.length - nums.length };
};

// The fields /quality/report actually serves. It has never served `n` or
// `count`; guessing at those is what produced the null.
export const CONTRACT = ['brief_type', 'scored', 'total', 'avg_score', 'cleared_196',
                         'above_240', 'below_240'];

export const missingContractFields = (rows) =>
  CONTRACT.filter((k) => !rows.every((x) => Object.prototype.hasOwnProperty.call(x || {}, k)));

// Each returns { name, pass, detail }. Ordered most-diagnostic first.
export const invariants = (rows) => {
  const scored = total(rows, 'scored'), c196 = total(rows, 'cleared_196'), a240 = total(rows, 'above_240');
  return [
    { name: 'every summary row contributed a numeric count to each total',
      pass: scored.skipped === 0 && c196.skipped === 0 && a240.skipped === 0,
      detail: `skipped — scored:${scored.skipped} cleared_196:${c196.skipped} above_240:${a240.skipped} of ${rows.length} rows` },
    // The one that reds on briefs_counted: 0 beside cleared_196: 66.
    { name: 'cleared_196 <= briefs_counted',
      pass: c196.sum <= scored.sum,
      detail: `${c196.sum} cleared out of ${scored.sum} counted — a brief cannot clear a bar it was not counted in` },
    { name: 'above_240 <= cleared_196',
      pass: a240.sum <= c196.sum,
      detail: `${a240.sum} above 240 but only ${c196.sum} cleared 196, and 240 > 196` },
    // Named so it can never be read as "a quiet week".
    { name: 'a zero denominator is not published beside a non-zero numerator',
      pass: !(scored.sum === 0 && (c196.sum > 0 || a240.sum > 0)),
      detail: `briefs_counted ${scored.sum} with cleared_196 ${c196.sum} / above_240 ${a240.sum}` },
  ];
};
