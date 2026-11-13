// M4: Daten für Live-Zähler, Heizkalender, Monate gegen Normal, Sparrechner, Heizsaison, Heizkurve.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadBackend, putReadings } from '../fakes/gas.mjs';
import { dwdHttp, seasonalTemp } from '../fakes/dwd.mjs';

const plainMarks = a => JSON.parse(JSON.stringify(a));
const near = (a, b, eps) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b} (±${eps})`);

/** Backend mit Wetter (Attrappe) und Ablesungen aus bekanntem Modell a = 0,35, θ = 13 °C. */
function setupWith({ now = '2026-11-05T17:00:00Z', to = '2026-11-03' } = {}) {
  const b = loadBackend({ http: dwdHttp(), now });
  b.ctx.setup();
  const rows = [];
  let v = 1000;
  let n = 0;
  for (const d of b.ctx.isoRange_('2025-10-26', to)) {
    if (n % 9 === 0 || d === to) rows.push({ date: d, value: Math.round(v * 1000) / 1000 });
    v += 0.35 * Math.max(0, 13 - seasonalTemp(d));
    n++;
  }
  putReadings(b.sheet('Ablesungen'), rows);
  const D = iso => b.ctx.berlinMidnight_(iso);
  b.sheet('Tarife').appendRow([D('2025-01-01'), 10, 12, 'Test']);
  b.sheet('Abschläge').appendRow([D('2025-11-01'), 50, 1]);
  b.sheet('Perioden').appendRow(['Neu', D('2026-11-01'), D('2027-10-31')]);
  const o = b.post({ v: 1, key: b.store.KEY, action: 'overview' }).data.overview;
  return { b, o, last: rows[rows.length - 1] };
}

test('Übersicht: Schema 5, Insights, Monate mit Normal-Erwartung, Zeiträume mit Temperatur', () => {
  const { o } = setupWith();
  assert.equal(o.schema, 5);
  assert.ok(o.insights);
  assert.ok(o.months.every(m => typeof m.kWhNormal === 'number'));
  // Wetter der Attrappe ist jedes Jahr gleich → Verbrauch ≈ Normal-Erwartung
  const jan = o.months.find(m => m.month === '2026-01');
  near(jan.kWh, jan.kWhNormal, 0.03 * jan.kWhNormal);
  assert.ok(o.intervals.every(i => typeof i.tmean === 'number'));
});

test('Live-Zähler: Schätzung seit der letzten Ablesung bis jetzt, mit Unsicherheit und Kosten je Tag', () => {
  const { o, last } = setupWith();
  const e = o.insights.estimate;
  assert.equal(e.since, '2026-11-03');
  near(e.hours, 2 * 24 + 6, 0.2, 'von 03.11. 12:00 bis 05.11. 18:00 (Berlin)');
  let expected = 0;
  for (const [d, f] of [['2026-11-03', 0.5], ['2026-11-04', 1], ['2026-11-05', 0.75]]) expected += f * 0.35 * Math.max(0, 13 - seasonalTemp(d));
  // Live-Zähler rechnet mit dem Heizniveau dieser Saison (hier ≈ 1, weil immer gleich geheizt wurde)
  const k = o.insights.level.factor;
  near(k, 1, 0.05);
  near(e.m3, expected * k, 0.03 * expected);
  near(e.value, last.value + e.m3, 1e-6);
  assert.ok(e.sd > 0);
  const rate = k * 0.35 * Math.max(0, 13 - seasonalTemp('2026-11-05'));
  near(e.m3PerDay, rate, 0.03 * rate);
  near(e.eurPerDay, e.kWhPerDay * 0.1 + (12 * 12) / 365, 0.01);
});

test('Tageswerte: alle Tage seit der ersten Ablesung als gleich lange Spalten, enden heute', () => {
  const { o } = setupWith();
  const d = o.insights.days;
  assert.equal(d.start, '2025-10-26');
  const n = d.kWh.length;
  assert.equal(n, 376, '26.10.2025 bis 05.11.2026');
  for (const col of ['m3', 'tm', 'covered']) assert.equal(d[col].length, n, col);
  assert.ok(d.kWh.some(x => x > 0));
  assert.equal(d.covered[n - 1], 0, 'heute noch nicht abgelesen');
  assert.equal(d.kWh[n - 1], null);
});

test('Sparrechner und Heizsaison: plausibel und konsistent', () => {
  const { o } = setupWith();
  const { savings, season, tariffNow, factorNow } = o.insights;
  // 1 °C kühler: je Tag unter der Heizgrenze 1 HGT weniger → a × Heiztage × Faktor
  let heatDays = 0;
  for (let n = 0; n < 365; n++) heatDays += seasonalTemp(new Date(Date.UTC(2025, 0, 1 + n)).toISOString().slice(0, 10)) < 12.5 ? 1 : 0;
  near(savings.kWh, 0.35 * heatDays * factorNow, 0.06 * savings.kWh);
  near(savings.eur, (savings.kWh * tariffNow.ap) / 100, 1);
  assert.ok(savings.share > 0.05 && savings.share < 0.4);
  assert.equal(season.start, '2026-08-01');
  assert.equal(season.end, '2027-07-31');
  assert.ok(season.share > 0 && season.share < 0.3, 'Anfang November ist erst ein kleiner Teil des Winters vorbei');
  assert.ok(season.remainingKWh > season.doneKWh);
  near(season.remainingEur, (season.remainingKWh * tariffNow.ap) / 100, 1);
  assert.equal(season.marks.length, 12);
  assert.deepEqual(plainMarks(season.marks.slice(0, 1)), [{ month: '2026-08', share: 0 }]);
  const jan = season.marks.find(x => x.month === '2027-01').share;
  assert.ok(jan > 0.3 && jan < 0.6, 'bis Neujahr ist etwa ein Drittel bis die Hälfte der Heizgradtage vorbei');
  assert.ok(season.marks.every((x, i, a) => !i || x.share >= a[i - 1].share), 'Skala steigt monoton');
  // Normaler Verbrauch je Monat des Heizjahres: 12 Monate, Winter > Sommer, Rest ≈ remainingKWh
  assert.deepEqual(season.months.map(x => x.month).slice(0, 2), ['2026-08', '2026-09']);
  assert.equal(season.months.length, 12);
  const n = mo => season.months.find(x => x.month === mo).kWhNormal;
  assert.ok(n('2027-01') > 5 * n('2026-10'), 'Januar braucht viel mehr als Oktober');
  const future = season.months.filter(x => x.month >= '2026-12').reduce((sum, x) => sum + x.kWhNormal, 0);
  const nov = n('2026-11');
  assert.ok(future < season.remainingKWh && future + nov > season.remainingKWh, 'Dez–Jul + Teil von Nov = was noch kommt');
});

test('Ohne Modell: nur Tarif, Faktor und Tageswerte', () => {
  const b = loadBackend({ http: dwdHttp(), now: '2026-11-05T17:00:00Z' });
  b.ctx.setup();
  putReadings(b.sheet('Ablesungen'), [{ date: '2026-11-01', value: 1 }, { date: '2026-11-03', value: 3 }]);
  const o = b.post({ v: 1, key: b.store.KEY, action: 'overview' }).data.overview;
  assert.equal(o.insights.estimate, undefined);
  assert.equal(o.insights.savings, undefined);
  assert.equal(o.insights.level, undefined);
  assert.ok(Array.isArray(o.insights.days.kWh));
});
