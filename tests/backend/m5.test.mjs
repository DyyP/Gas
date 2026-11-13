// M5: Heizniveau dieser Saison („wenn du so weiterheizt“), zweite Prognose, Plausibilität mit dem Heizniveau.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadBackend, putReadings } from '../fakes/gas.mjs';
import { dwdHttp, seasonalTemp } from '../fakes/dwd.mjs';

const isoYesterday = now => new Date(Date.parse(now) - 86400000).toISOString().slice(0, 10);
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ? msg + ': ' : ''}${a} ≉ ${b} (±${eps})`);

/**
 * Ablesungen alle 7 Tage aus a = 0,35 m³/HGT, θ = 13 °C. Ab `change` heizt der Haushalt anders:
 * k = Faktor auf den Verbrauch, theta = neue Heizgrenze (Thermostat runter).
 */
function scenario({ k = 1, theta = 13, change = '2026-08-01', to = '2026-11-03', now = '2026-11-05T17:00:00Z' } = {}) {
  const b = loadBackend({ http: dwdHttp({ recentTo: isoYesterday(now) }), now });
  b.ctx.setup();
  const rows = [];
  let v = 1000;
  let n = 0;
  const use = d => (d >= change ? k * 0.35 * Math.max(0, theta - seasonalTemp(d)) : 0.35 * Math.max(0, 13 - seasonalTemp(d)));
  for (const d of b.ctx.isoRange_('2025-10-26', to)) {
    if (n % 7 === 0 || d === to) rows.push({ date: d, value: Math.round(v * 1000) / 1000 });
    v += use(d);
    n++;
  }
  putReadings(b.sheet('Ablesungen'), rows);
  const D = iso => b.ctx.berlinMidnight_(iso);
  b.sheet('Tarife').appendRow([D('2025-01-01'), 10, 12, 'Test']);
  b.sheet('Abschläge').appendRow([D('2025-11-01'), 50, 1]);
  b.sheet('Perioden').appendRow(['Neu', D('2026-11-01'), D('2027-10-31')]);
  const o = b.post({ v: 1, key: b.store.KEY, action: 'overview' }).data.overview;
  return { b, o, rows, use };
}

test('Anfang der Saison (wenige Zeiträume mit Heizbedarf): Faktor auf das Jahresmodell, deutlich unter 1 bei halbem Heizen', () => {
  const { o } = scenario({ k: 0.5 });
  const l = o.insights.level;
  assert.equal(l.source, 'Faktor');
  assert.equal(l.theta, o.model.theta, 'Heizgrenze bleibt');
  assert.ok(l.factor > 0.4 && l.factor < 0.7, `Faktor ${l.factor}`);
  assert.equal(l.from, '2026-08-01', 'ganze Heizsaison seit 01.08.');
  assert.equal(l.to, '2026-11-03');
  assert.ok(l.actualKWh < l.expectedKWh);
  // Ohne Änderung ≈ 1
  const same = scenario({ k: 1 }).o.insights.level;
  assert.ok(Math.abs(same.factor - 1) < 0.08, `ohne Änderung ${same.factor}`);
});

test('Im Winter (≥ 6 Zeiträume mit Heizbedarf): Saisonmodell schätzt Steigung und Heizgrenze neu', () => {
  const half = scenario({ k: 0.5, to: '2026-12-15', now: '2026-12-17T12:00:00Z' }).o;
  assert.equal(half.insights.level.source, 'Saison');
  near(half.insights.level.a, 0.175, 0.02, 'halbe Steigung');
  near(half.insights.level.theta, 13, 0.5, 'Heizgrenze gleich');
  // Thermostat 2 °C runter: Heizgrenze sinkt, Steigung bleibt – ein reiner Faktor würde das falsch fortschreiben
  const cooler = scenario({ theta: 11, to: '2026-12-15', now: '2026-12-17T12:00:00Z' }).o;
  assert.equal(cooler.insights.level.source, 'Saison');
  near(cooler.insights.level.theta, 11, 0.5, 'Heizgrenze 11 °C erkannt');
  near(cooler.insights.level.a, 0.35, 0.04, 'Steigung bleibt');
});

test('Zweite Prognose „wie diese Saison“ trifft den wahren künftigen Verbrauch (Thermostat runter)', () => {
  const { o, b, use } = scenario({ theta: 11, to: '2026-12-15', now: '2026-12-17T12:00:00Z' });
  const p = o.periods.find(x => x.status === 'läuft');
  assert.ok(p.forecast && p.forecastSeason);
  // Wahrheit: Verbrauch nach dem neuen Verhalten bis Periodenende (Wetter der Attrappe ist jedes Jahr gleich)
  let truth = 0;
  for (const d of b.ctx.isoRange_('2026-12-15', '2027-10-31')) truth += (d === '2026-12-15' ? 0.5 : 1) * use(d);
  const f = o.insights.factorNow;
  const seasonFuture = (p.forecastSeason.kWh.p50 - p.kWh) / f;
  near(seasonFuture, truth, 0.1 * truth, 'Saison-Prognose');
  assert.ok((p.forecast.kWh.p50 - p.kWh) / f > seasonFuture, 'Jahresmodell erwartet mehr');
  assert.ok(p.forecastSeason.recommendation.balanced < p.forecast.recommendation.balanced, 'kleinerer Abschlag reicht');
  assert.ok(p.forecastSeason.balance.p10 <= p.forecastSeason.balance.p50 && p.forecastSeason.balance.p50 <= p.forecastSeason.balance.p90);
  assert.ok(o.periods.filter(x => x.status !== 'läuft').every(x => x.forecastSeason === undefined), 'nur laufende Periode');
});

test('Im Sommer (zu wenig Heizbedarf) keine Saison-Aussage, keine zweite Prognose', () => {
  const { o } = scenario({ to: '2026-08-09', now: '2026-08-10T12:00:00Z' });
  assert.equal(o.insights.level, undefined);
  assert.ok(o.periods.every(x => x.forecastSeason === undefined));
});

test('Live-Zähler, Sparrechner und „kommt noch“ rechnen mit dem Saisonmodell', () => {
  const half = scenario({ k: 0.5, to: '2026-12-15', now: '2026-12-17T12:00:00Z' }).o.insights;
  const same = scenario({ k: 1, to: '2026-12-15', now: '2026-12-17T12:00:00Z' }).o.insights;
  near(half.estimate.m3PerDay / same.estimate.m3PerDay, 0.5, 0.07, 'm³ pro Tag');
  near(half.savings.kWh / same.savings.kWh, 0.5, 0.07, 'Sparrechner');
  near(half.season.remainingKWh / same.season.remainingKWh, 0.5, 0.07, 'kommt noch');
});

test('Plausibilität beim Speichern nutzt das Saisonmodell: halber Verbrauch ist normal, viel mehr fällt auf', () => {
  const { b, rows, use } = scenario({ k: 0.5, to: '2026-12-08', now: '2026-12-16T12:00:00Z' });
  const last = rows[rows.length - 1];
  let dv = 0; // 08.12. 12:00 → 15.12. 12:00 nach Saison-Verhalten
  for (const d of b.ctx.isoRange_('2026-12-08', '2026-12-15')) dv += (d === '2026-12-08' || d === '2026-12-15' ? 0.5 : 1) * use(d);
  const ok = b.post({ v: 1, key: b.store.KEY, action: 'addReading', reading: { date: '2026-12-15', value: Math.round((last.value + dv) * 1000) / 1000 } });
  assert.equal(ok.ok, true, JSON.stringify(ok.error));
  const much = b.post({ v: 1, key: b.store.KEY, action: 'addReading', reading: { date: '2026-12-16', value: Math.round((last.value + dv + 10) * 1000) / 1000 } });
  assert.equal(much.ok, false);
  assert.equal(much.error.code, 'PLAUSIBILITY');
});
