import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkReading, latestKnown } from '../../docs/js/plausi.js';

const ctx = (over = {}) => ({ today: '2026-11-08', minDate: '2025-11-01', maxPerDay: 20, latest: { date: '2026-10-31', time: null, value: 2309 }, ...over });

test('checkReading: harte Fehler', () => {
  assert.ok(checkReading({ date: '2026-11-09', value: 2310 }, ctx()).error);
  assert.ok(checkReading({ date: '2025-10-31', value: 2310 }, ctx()).error);
  assert.ok(checkReading({ date: '2026-02-30', value: 2310 }, ctx()).error);
  assert.ok(checkReading({ date: '2026-11-08', value: NaN }, ctx()).error);
  assert.match(checkReading({ date: '2026-11-08', value: 2300 }, ctx()).error, /kleiner als zuletzt/);
});

test('checkReading: Rückfrage bei unplausiblem Verbrauch, nicht bei normalem', () => {
  assert.deepEqual(checkReading({ date: '2026-11-08', time: '20:00', value: 2312 }, ctx()), {});
  const w = checkReading({ date: '2026-11-08', time: '12:00', value: 23095 }, ctx());
  assert.match(w.warn, /m³ pro Tag/);
  assert.ok(w.perDay > 20);
  assert.deepEqual(checkReading({ date: '2026-11-08', value: 23095 }, ctx({ maxPerDay: 0 })), {});
});

test('checkReading: Nachtrag vor dem letzten Stand prüft der Server', () => {
  assert.deepEqual(checkReading({ date: '2026-10-01', value: 1 }, ctx()), {});
});

test('checkReading: ohne bekannten Stand nur Formprüfung', () => {
  assert.deepEqual(checkReading({ date: '2026-11-08', value: 5 }, ctx({ latest: null })), {});
});

test('latestKnown: berücksichtigt noch nicht gesendete Einträge, ignoriert abgelehnte', () => {
  const last = { date: '2026-10-31', time: null, value: 2309 };
  const q = [
    { date: '2026-11-05', time: '08:00', value: 2311, state: 'pending' },
    { date: '2026-11-07', time: '08:00', value: 9999, state: 'rejected' },
  ];
  assert.deepEqual(latestKnown(last, q), { date: '2026-11-05', time: '08:00', value: 2311 });
  assert.deepEqual(latestKnown(null, []), null);
});
