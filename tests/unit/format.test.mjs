import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReading, formatNumber, formatDate, localIsoDate, isIsoDate, daysBetween, relativeDays, readingT } from '../../docs/js/format.js';

test('parseReading: deutsche Eingaben', () => {
  assert.equal(parseReading('2309,567'), 2309.567);
  assert.equal(parseReading('2309.567'), 2309.567);
  assert.equal(parseReading(' 2.309,567 '), 2309.567);
  assert.equal(parseReading('2309'), 2309);
  assert.equal(parseReading('02309,5'), 2309.5);
  assert.ok(Number.isNaN(parseReading('')));
  assert.ok(Number.isNaN(parseReading('-5')));
  assert.ok(Number.isNaN(parseReading('12,3,4')));
  assert.ok(Number.isNaN(parseReading('1e5')));
  assert.ok(Number.isNaN(parseReading(undefined)));
});

test('formatNumber / formatDate', () => {
  assert.equal(formatNumber(2309.5, 3), '2.309,500');
  assert.equal(formatNumber(0.4736, 2), '0,47');
  assert.equal(formatNumber(NaN, 2), '–');
  assert.equal(formatNumber(null, 2), '–');
  assert.equal(formatDate('2026-11-08'), '08.11.2026');
});

test('localIsoDate nutzt lokale Zeit, nicht UTC', () => {
  const d = new Date(2026, 10, 8, 0, 30); // 00:30 lokal
  assert.equal(localIsoDate(d), '2026-11-08');
});

test('isIsoDate, daysBetween, relativeDays, readingT', () => {
  assert.equal(isIsoDate('2028-02-29'), true);
  assert.equal(isIsoDate('2026-02-29'), false);
  assert.equal(isIsoDate('0099-01-01'), true);
  assert.equal(daysBetween('2026-10-31', '2026-11-08'), 8);
  assert.equal(daysBetween('2026-03-28', '2026-03-30'), 2);
  assert.equal(relativeDays(0), 'heute');
  assert.equal(relativeDays(1), 'gestern');
  assert.equal(relativeDays(5), 'vor 5 Tagen');
  assert.equal(readingT('1970-01-02', null), 1.5);
  assert.equal(readingT('1970-01-02', '06:00'), 1.25);
});

test('isoWeek: Kalenderwoche nach ISO 8601, auch an Jahresgrenzen', async () => {
  const { isoWeek } = await import('../../docs/js/format.js');
  for (const [d, w] of [['2026-11-13', 46], ['2026-01-01', 1], ['2025-12-29', 1], ['2026-12-31', 53], ['2027-01-03', 53], ['2021-01-03', 53], ['2021-01-04', 1], ['2024-12-30', 1]]) {
    assert.equal(isoWeek(d), w, d);
  }
});

test('expandDays: kompakte Spalten → Tage mit Datum (über Monats- und Schaltjahresgrenzen)', async () => {
  const { expandDays } = await import('../../docs/js/format.js');
  const d = expandDays({ start: '2028-02-28', m3: [1, 2, null], kWh: [10, 20, null], tm: [1, 2, 3], covered: [1, 1, 0] });
  assert.deepEqual(d.map(x => x.date), ['2028-02-28', '2028-02-29', '2028-03-01']);
  assert.equal(d[2].kWh, null);
  assert.deepEqual(expandDays(null), []);
});
