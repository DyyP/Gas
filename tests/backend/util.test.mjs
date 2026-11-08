import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadBackend } from '../fakes/gas.mjs';

const { ctx } = loadBackend();

test('isIsoDate_: echte Kalenderdaten, Schaltjahre', () => {
  assert.equal(ctx.isIsoDate_('2026-11-08'), true);
  assert.equal(ctx.isIsoDate_('2026-02-29'), false);
  assert.equal(ctx.isIsoDate_('2028-02-29'), true);
  assert.equal(ctx.isIsoDate_('2100-02-29'), false);
  assert.equal(ctx.isIsoDate_('2000-02-29'), true);
  assert.equal(ctx.isIsoDate_('2026-13-01'), false);
  assert.equal(ctx.isIsoDate_('2026-04-31'), false);
  assert.equal(ctx.isIsoDate_('26-11-08'), false);
  assert.equal(ctx.isIsoDate_(20261108), false);
});

test('dayNumber_: Jahre < 100 nicht als 19xx, Sommerzeit egal', () => {
  assert.notEqual(ctx.dayNumber_('0099-12-31'), ctx.dayNumber_('1999-12-31'));
  assert.equal(ctx.dayNumber_('1970-01-01'), 0);
  assert.equal(ctx.dayNumber_('2026-03-30') - ctx.dayNumber_('2026-03-28'), 2); // Umstellung 29.03.
  assert.equal(ctx.dayNumber_('2026-10-26') - ctx.dayNumber_('2026-10-24'), 2); // Umstellung 25.10.
  assert.equal(ctx.isoFromDayNumber_(ctx.dayNumber_('2028-02-29')), '2028-02-29');
});

test('parseTime_ und readingT_', () => {
  assert.equal(ctx.parseTime_('21:14'), 21 * 60 + 14);
  assert.equal(ctx.parseTime_('7:05'), 7 * 60 + 5);
  assert.equal(ctx.parseTime_('07:05:30'), 7 * 60 + 5);
  assert.equal(ctx.parseTime_(''), null);
  assert.equal(ctx.parseTime_(null), null);
  assert.ok(Number.isNaN(ctx.parseTime_('24:00')));
  assert.ok(Number.isNaN(ctx.parseTime_('abc')));
  assert.equal(ctx.readingT_('1970-01-02', null), 1.5);
  assert.equal(ctx.readingT_('1970-01-02', 6 * 60), 1.25);
});

test('parseNumberDe_: Komma, Punkt, Tausenderpunkt, Unsinn', () => {
  assert.equal(ctx.parseNumberDe_('2057,01'), 2057.01);
  assert.equal(ctx.parseNumberDe_('2057.01'), 2057.01);
  assert.equal(ctx.parseNumberDe_('2.057,01'), 2057.01);
  assert.equal(ctx.parseNumberDe_(' 1865 '), 1865);
  assert.equal(ctx.parseNumberDe_(42), 42);
  assert.ok(Number.isNaN(ctx.parseNumberDe_('')));
  assert.ok(Number.isNaN(ctx.parseNumberDe_('12a')));
  assert.ok(Number.isNaN(ctx.parseNumberDe_('1,2,3')));
  assert.ok(Number.isNaN(ctx.parseNumberDe_(Infinity)));
});

test('safeEqual_ und safeText_', () => {
  assert.equal(ctx.safeEqual_('abc', 'abc'), true);
  assert.equal(ctx.safeEqual_('abc', 'abd'), false);
  assert.equal(ctx.safeEqual_('abc', 'abcd'), false);
  assert.equal(ctx.safeEqual_(undefined, 'abc'), false);
  assert.equal(ctx.safeText_('=IMPORTXML("x")'), "'=IMPORTXML(\"x\")");
  assert.equal(ctx.safeText_('-1'), "'-1");
  assert.equal(ctx.safeText_('ok'), 'ok');
});
