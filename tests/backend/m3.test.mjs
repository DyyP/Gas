// M3: Modell (WLS, b ≥ 0, Heizgrenze aus Daten), Ampel, Prognose (Monte Carlo), Empfehlung, Plausibilität mit Modell.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadBackend, putReadings } from '../fakes/gas.mjs';
import { dwdHttp, seasonalTemp } from '../fakes/dwd.mjs';

const { ctx } = loadBackend();
const near = (a, b, eps) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b} (±${eps})`);
const plain = x => JSON.parse(JSON.stringify(x));

/** Jahre unterschiedlich warm (wie in echt) – sonst gäbe es keine Wetter-Unsicherheit. */
const YEAR_SHIFT = { 2020: 1.0, 2021: -1.5, 2022: 0.8, 2023: 1.2, 2024: -0.5, 2025: 0, 2026: 0.3 };
const tempOf = d => Math.round((seasonalTemp(d) + YEAR_SHIFT[d.slice(0, 4)]) * 10) / 10;

/** Synthetische Ablesungen aus einem bekannten Modell; letzte Ablesung immer am Tag `to`. */
function synth({ a = 0.35, b = 0, theta = 13, from = '2025-10-26', to = '2026-11-05', every = 9, start = 1000, shift = true } = {}) {
  const weather = {};
  for (const d of ctx.isoRange_('2020-01-01', '2026-11-07')) weather[d] = shift ? tempOf(d) : seasonalTemp(d);
  const readings = [];
  let v = start;
  let n = 0;
  const days = ctx.isoRange_(from, to);
  for (const d of days) {
    if (n % every === 0 || d === to) readings.push({ row: readings.length + 2, date: d, minutes: null, t: ctx.readingT_(d, null), value: Math.round(v * 1000) / 1000, meter: '', exclude: false });
    v += b + a * Math.max(0, theta - weather[d]);
    n++;
  }
  return { weather, readings };
}

function settings(over = {}) {
  return { Heizgrenze_C: 15, Heizgrenze_aus_Daten: 'ja', Raumtemperatur_C: 20, Grundpreis_Verteilung: 'Jahr', Wetter_ab: '2020-01-01', Unsicherheit_Umrechnung_Prozent: 3, ...over };
}

function compute(over = {}) {
  const { weather, readings } = synth(over.synth);
  return ctx.computeAll_({
    readings,
    pairs: ctx.readingPairs_(readings).pairs,
    weather,
    conversions: [],
    placeholder: { z: 1, hs: 10 },
    tariffs: [{ from: '2025-01-01', ap: 10, gp: 12 }],
    payments: [{ from: '2025-11-01', amount: 50, day: 1 }],
    periods: [{ name: 'Alt', start: '2025-11-01', end: '2026-10-31' }, { name: 'Neu', start: '2026-11-01', end: '2027-10-31' }],
    settings: settings(over.settings),
    today: '2026-11-05',
    ...over.input,
  });
}

test('wls_: rauschfreie Daten exakt zurückgewonnen; negative Grundlast → b = 0', () => {
  const obs = [{ h: 10, d: 2 }, { h: 50, d: 7 }, { h: 0, d: 30 }, { h: 120, d: 14 }].map(o => ({ ...o, y: 0.3 * o.h + 0.2 * o.d }));
  const f = ctx.wls_(obs);
  near(f.a, 0.3, 1e-9);
  near(f.b, 0.2, 1e-9);
  assert.equal(f.p, 2);
  near(f.sse, 0, 1e-12);
  const g = ctx.wls_(obs.map(o => ({ ...o, y: Math.max(0, 0.3 * o.h - 0.2 * o.d) + 0.0 })));
  assert.equal(g.b, 0);
  assert.equal(g.p, 1);
  assert.equal(ctx.wls_([{ h: 0, d: 5, y: 1 }]), null, 'ohne Heizgradtage kein Modell');
});

test('fitModel_: findet die wahre Heizgrenze, a und b; „nein“ nimmt die Einstellung', () => {
  const r = compute({ synth: { a: 0.35, b: 0.1, theta: 13 } });
  assert.equal(r.model.theta, 13);
  assert.equal(r.model.thetaSource, 'Daten');
  near(r.model.a, 0.35, 0.01);
  near(r.model.b, 0.1, 0.02);
  assert.ok(r.model.coverage > 0.9);
  assert.equal(r.rating.level, 'grün');
  const fixed = compute({ synth: { theta: 13 }, settings: { Heizgrenze_aus_Daten: 'nein', Heizgrenze_C: 15 } });
  assert.equal(fixed.model.theta, 15);
  assert.equal(fixed.model.thetaSource, 'Einstellung');
});

test('fitModel_: zu wenig Daten → kein Modell, rote Ampel; ausgeschlossene Zeiträume zählen nicht', () => {
  const { weather, readings } = synth();
  const few = readings.slice(0, 3);
  const temps = ctx.fillTemps_(weather, '2025-10-26', '2026-11-05');
  assert.equal(ctx.fitModel_(ctx.readingPairs_(few).pairs, temps, settings(), () => 1000), null);
  assert.equal(ctx.modelRating_(null).level, 'rot');
  const ex = readings.map((r, i) => ({ ...r, exclude: i === 2 }));
  const m = ctx.fitModel_(ctx.readingPairs_(ex).pairs, temps, settings(), () => 1000);
  assert.equal(m.excluded, 1);
  assert.equal(m.n, ex.length - 2);
});

test('modelRating_: Ampelgrenzen', () => {
  const base = { n: 20, coverage: 0.8, relSeA: 0.05, cv: 0.2 };
  assert.equal(ctx.modelRating_(base).level, 'grün');
  assert.equal(ctx.modelRating_({ ...base, coverage: 0.3 }).level, 'gelb');
  assert.equal(ctx.modelRating_({ ...base, relSeA: 0.2 }).level, 'gelb');
  assert.equal(ctx.modelRating_({ ...base, coverage: 0.1 }).level, 'rot');
  assert.match(ctx.modelRating_(base).text, /20 Ablesezeiträume, 80 % einer normalen Heizsaison/);
});

test('Verteilung nutzt das Modell: mit Grundlast bekommen auch warme Tage Verbrauch', () => {
  const r = compute({ synth: { a: 0.3, b: 0.2, theta: 13 } });
  const july = r.days.filter(d => d.date.startsWith('2026-07'));
  const m3 = july.reduce((s, d) => s + d.m3, 0);
  near(m3, 31 * r.model.b, 0.5);
  assert.ok(july.every(d => d.hgt === 0));
});

test('Prognose: reproduzierbar, Bänder geordnet, beendete Periode nur mit Umrechnungs-Unsicherheit', () => {
  const r1 = compute();
  const r2 = compute();
  assert.deepEqual(plain(r1.periods), plain(r2.periods), 'gleicher Tag → gleiche Zahlen');
  const [alt, neu] = r1.periods;
  for (const f of [alt.forecast, neu.forecast]) {
    for (const k of ['kWh', 'cost', 'balance']) assert.ok(f[k].p10 <= f[k].p50 && f[k].p50 <= f[k].p80 && f[k].p80 <= f[k].p90, k);
  }
  assert.equal(alt.forecast.unknownDays, 0);
  assert.equal(alt.forecast.measuredShare, 1);
  assert.equal(alt.forecast.mainUncertainty, 'Umrechnung');
  near(alt.forecast.cost.p50, alt.cost, 0.5);
  // ±3 % auf die Arbeitskosten → 80 %-Band ≈ 2 × 1,28 × 3 % × Arbeitskosten
  near(alt.forecast.cost.p90 - alt.forecast.cost.p10, 2 * 1.2816 * 0.03 * alt.costWork, 0.15 * 2 * 1.2816 * 0.03 * alt.costWork);
  assert.equal(alt.forecast.recommendation, null, 'beendete Periode: keine Empfehlung');
});

test('Prognose laufende Periode: trifft das Erwartbare, Wetter ist Hauptunsicherheit, Empfehlung rechnet richtig', () => {
  const r = compute({ synth: { a: 0.35, b: 0, theta: 13 } });
  const neu = r.periods[1];
  const f = neu.forecast;
  // Erwartung je Klimajahr 2020–2025: a × HGT(13) × 10 kWh/m³ × 0,10 €/kWh + Grundpreis. Bei nur 6 Jahren ist
  // P50 der Median dieser 6 Werte (nicht der Mittelwert).
  const perYear = [2020, 2021, 2022, 2023, 2024, 2025].map(y => {
    let hgt = 0;
    for (const d of ctx.isoRange_('2026-11-01', '2027-10-31')) hgt += Math.max(0, 13 - (Math.round((seasonalTemp(d) + YEAR_SHIFT[y]) * 10) / 10));
    return 0.35 * hgt * 10 * 0.1 + 12 * 12;
  }).sort((x, y) => x - y);
  const median = (perYear[2] + perYear[3]) / 2;
  near(f.cost.p50, median, 0.03 * median);
  assert.ok(f.cost.p10 >= perYear[0] * 0.9 && f.cost.p90 <= perYear[5] * 1.1, 'Band im Bereich der Wetterjahre');
  assert.equal(f.mainUncertainty, 'Wetter');
  assert.equal(f.paymentsCount, 12);
  near(f.paymentsTotal, 600, 1e-9);
  near(f.balance.p50, f.cost.p50 - 600, 0.01);
  const rec = f.recommendation;
  assert.equal(rec.remaining, 11);
  assert.equal(rec.current, 50);
  const paid = 50; // 01.11. schon fällig
  assert.ok(paid + rec.remaining * rec.balanced >= f.cost.p50 && paid + rec.remaining * (rec.balanced - 1) < f.cost.p50);
  assert.ok(rec.safe >= rec.balanced);
});

test('Prognose ohne Modell: nur wenn keine unbekannten Tage bleiben', () => {
  const r = compute({ input: { readings: [], pairs: [] } });
  assert.equal(r.periods.length, 0, 'ohne Ablesungen keine Rechnung');
  const { weather, readings } = synth();
  const two = [readings[0], readings[readings.length - 1]];
  const res = ctx.computeAll_({
    readings: two, pairs: ctx.readingPairs_(two).pairs, weather, conversions: [], placeholder: { z: 1, hs: 10 },
    tariffs: [{ from: '2025-01-01', ap: 10, gp: 12 }], payments: [],
    periods: [{ name: 'Alt', start: '2025-11-01', end: '2026-10-31' }, { name: 'Neu', start: '2026-11-01', end: '2027-10-31' }],
    settings: settings(), today: '2026-11-05',
  });
  assert.equal(res.model, null);
  assert.notEqual(res.periods[0].forecast, null, 'vollständig abgelesen → Band trotzdem');
  assert.equal(res.periods[1].forecast, null, 'Zukunft ohne Modell → keine Prognose');
  assert.match(res.hints.map(h => h.text).join('\n'), /Noch kein Modell/);
});

test('API: Übersicht liefert Modell, Ampel, Prognose; Plausibilität mit Modell erkennt Ausreißer', () => {
  const b = loadBackend({ http: dwdHttp(), now: '2026-11-05T19:00:00Z' });
  b.ctx.setup();
  const { readings } = synth({ to: '2026-11-03', shift: false }); // gleiches Wetter wie die DWD-Attrappe
  putReadings(b.sheet('Ablesungen'), readings.map(r => ({ date: r.date, value: r.value })));
  const D = iso => b.ctx.berlinMidnight_(iso);
  b.sheet('Tarife').appendRow([D('2025-01-01'), 10, 12]);
  b.sheet('Abschläge').appendRow([D('2025-11-01'), 50, 1]);
  b.sheet('Perioden').appendRow(['Neu', D('2026-11-01'), D('2027-10-31')]);
  const o = b.post({ v: 1, key: b.store.KEY, action: 'overview' }).data.overview;
  assert.equal(o.model.theta, 13);
  assert.equal(o.rating.level, 'grün');
  assert.ok(o.periods[0].forecast.recommendation.balanced > 0);
  const last = readings.at(-1);
  // Erwartet für 2 Novembertage ≈ 2 × 0,35 × (13 − ~8) ≈ 3,5 m³ – 12 m³ ist ein Ausreißer (aber < 20 m³/Tag)
  const send = (value, confirmed) => b.post({ v: 1, key: b.store.KEY, action: 'addReading', reading: { date: '2026-11-05', time: '12:00', value: last.value + value, confirmed } });
  const p = send(12);
  assert.equal(p.error.code, 'PLAUSIBILITY');
  assert.match(p.error.message, /wären etwa .* m³ zu erwarten, eingegeben sind 12,0 m³/);
  const ok = send(3.6);
  assert.equal(ok.data.saved, 'new', 'erwartbarer Wert geht durch');
});
