'use strict';
// Preload for scripts/check-odds-daily-vs-vendor-run.mjs: `new Date()` and `Date.now()` return FAKE_NOW, so the watch's own
// clock-derived day, month and window are the test's and the run does not depend on the day it is executed.
const FIXED = Date.parse(process.env.FAKE_NOW);
if (!Number.isFinite(FIXED)) throw new Error('fake-clock: FAKE_NOW is not a date');
const RealDate = Date;
class FakeDate extends RealDate {
  constructor(...a) { if (a.length === 0) super(FIXED); else super(...a); }
  static now() { return FIXED; }
}
global.Date = FakeDate;
