// M2: Wetter (DWD), Tagesrechnung, Kosten, Abschläge, Perioden, täglicher Lauf.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadBackend, putReadings, zonedToUtc } from '../fakes/gas.mjs';
import { dwdHttp, dwdText, seasonalTemp } from '../fakes/dwd.mjs';

const { ctx } = loadBackend();
const plain = x => JSON.parse(JSON.stringify(x)); // Objekte aus der vm-Umgebung vergleichbar machen
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);
const BASE = 'https://opendata.dwd.de/climate_environment/CDC/observations_germany/climate/daily/kl/';

test('berlinMidnight_ stimmt für jeden Tag 2019–2030 mit der echten Zeitzone überein', () => {
  for (let n = ctx.dayNumber_('2019-01-01'); n <= ctx.dayNumber_('2030-12-31'); n++) {
    const iso = ctx.isoFromDayNumber_(n);
    const [y, m, d] = iso.split('-').map(Number);
    assert.equal(ctx.berlinMidnight_(iso).getTime(), zonedToUtc(y, m, d, 0, 0, 'Europe/Berlin').getTime(), iso);
  }
});

test('parseDwdKl_: echter DWD-Auszug (CRLF), Startdatum-Filter, -999 übersprungen', () => {
  const text = fs.readFileSync(new URL('../fixtures/dwd_produkt_auszug.txt', import.meta.url), 'latin1');
  const rows = ctx.parseDwdKl_(text, '2026-11-02');
  assert.deepEqual(plain(rows.map(r => r.date)), ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06']);
  assert.equal(rows.at(-1).tm, 3.5);
  const gap = ctx.parseDwdKl_(dwdText('2026-01-01', '2026-01-03', () => 1, { missing: ['2026-01-02'] }), '');
  assert.deepEqual(plain(gap.map(r => r.date)), ['2026-01-01', '2026-01-03']);
  assert.throws(() => ctx.parseDwdKl_('A;B\n1;2', ''), /unerwartetes Format/);
});

test('findDwdHistFile_: neueste Datei der richtigen Station', () => {
  const html = '<a href="tageswerte_KL_05906_17810101_20241231_hist.zip"></a><a href="tageswerte_KL_05906_17810101_20251231_hist.zip"></a><a href="tageswerte_KL_59060_x"></a><a href="tageswerte_KL_05692_19360101_20261231_hist.zip"></a>';
  assert.equal(ctx.findDwdHistFile_(html, '05906'), 'tageswerte_KL_05906_17810101_20251231_hist.zip');
  assert.equal(ctx.findDwdHistFile_(html, '01234'), null);
  assert.equal(ctx.dwdStation_(5906), '05906');
  assert.equal(ctx.dwdStation_(''), '05906');
});

test('fillTemps_: interpoliert Lücken, schreibt das Ende fort (max. 5 Tage)', () => {
  const w = { '2026-01-01': 0, '2026-01-04': 3, '2026-01-10': 6 };
  const t = ctx.fillTemps_(w, '2026-01-01', '2026-01-16');
  assert.deepEqual(plain(t['2026-01-02']), { tm: 1, src: 'interpoliert' });
  assert.deepEqual(plain(t['2026-01-04']), { tm: 3, src: 'DWD' });
  assert.equal(t['2026-01-07'].tm, 4.5);
  assert.deepEqual(plain(t['2026-01-15']), { tm: 6, src: 'fortgeschrieben' });
  assert.deepEqual(plain(t['2026-01-16']), { tm: null, src: null });
  const big = ctx.fillTemps_({ '2026-01-01': 0, '2026-01-20': 5 }, '2026-01-01', '2026-01-20');
  assert.equal(big['2026-01-10'].tm, null, 'Lücke > 10 Tage wird nicht erfunden');
});

test('distributeReadings_: Summe exakt, kalte Tage bekommen mehr, Sommer gleichmäßig, Uhrzeit anteilig', () => {
  const r = (date, value, minutes = null) => ({ date, value, minutes, t: ctx.readingT_(date, minutes), meter: '' });
  const temps = ctx.fillTemps_({ '2026-01-01': 0, '2026-01-02': 10, '2026-01-03': 5, '2026-07-01': 20, '2026-07-02': 22, '2026-07-03': 25 }, '2026-01-01', '2026-07-03');
  const d = ctx.distributeReadings_([r('2026-01-01', 100), r('2026-01-03', 110)], temps, 15);
  near(d.m3['2026-01-01'] + d.m3['2026-01-02'] + d.m3['2026-01-03'], 10);
  // Gewichte: 0,5·15 : 1·5 : 0,5·10 → 7,5 : 5 : 5
  near(d.m3['2026-01-01'], 10 * 7.5 / 17.5);
  near(d.m3['2026-01-02'], 10 * 5 / 17.5);
  assert.equal(d.covered['2026-01-01'], 0.5);
  assert.equal(d.covered['2026-01-02'], 1);
  const s = ctx.distributeReadings_([r('2026-07-01', 200, 0), r('2026-07-03', 201, 0)], temps, 15);
  near(s.m3['2026-07-01'], 0.5);
  near(s.m3['2026-07-02'], 0.5);
  assert.equal(s.m3['2026-07-03'], undefined);
  const miss = ctx.distributeReadings_([r('2026-03-01', 1), r('2026-03-03', 3)], {}, 15);
  near(miss.m3['2026-03-02'], 1);
  assert.match(miss.hints[0].text, /1 Zeitraum\/Zeiträume ohne vollständige Temperatur \(01\.03\.2026–03\.03\.2026\)/);
  assert.equal(miss.hints.length, 1);
});

test('paymentSchedule_: Octopus 12 × 66,09 € am 14., Wechsel, Pause, Monatsende', () => {
  const rows = [
    { from: '2025-11-01', amount: 66.09, day: 14 },
    { from: '2026-11-01', amount: 30, day: 1 },
  ];
  const oct = ctx.paymentSchedule_(rows, '2025-11-01', '2026-10-31');
  assert.equal(oct.length, 12);
  assert.equal(oct[0].date, '2025-11-14');
  assert.equal(oct.at(-1).date, '2026-10-14');
  near(oct.reduce((s, p) => s + p.amount, 0), 793.08, 1e-9);
  assert.deepEqual(plain(ctx.paymentSchedule_(rows, '2026-11-01', '2026-12-31').map(p => p.date)), ['2026-11-01', '2026-12-01']);
  const clamp = ctx.paymentSchedule_([{ from: '2026-01-01', amount: 10, day: 31 }], '2026-01-01', '2026-03-31');
  assert.deepEqual(plain(clamp.map(p => p.date)), ['2026-01-31', '2026-02-28', '2026-03-31']);
  const pause = ctx.paymentSchedule_([{ from: '2026-01-01', amount: 10, day: 1 }, { from: '2026-02-01', amount: 0, day: 1 }, { from: '2026-03-01', amount: 12, day: 1 }], '2026-01-01', '2026-03-31');
  assert.deepEqual(plain(pause.map(p => p.amount)), [10, 12]);
  assert.equal(ctx.paymentSchedule_([{ from: '2026-01-15', amount: 5, day: 1 }], '2026-01-01', '2026-02-28')[0].date, '2026-02-01', 'kein Abschlag vor Gültig_ab');
});

test('basePerDay_: „Jahr“ = 12/365, „Kalendermonat“ = Monatspreis / Monatstage', () => {
  near(ctx.basePerDay_(14.49, '2026-02-10', 'Jahr'), (14.49 * 12) / 365);
  near(ctx.basePerDay_(14.49, '2026-02-10', 'Kalendermonat'), 14.49 / 28);
  let year = 0;
  for (const d of ctx.isoRange_('2026-01-01', '2026-12-31')) year += ctx.basePerDay_(10, d, 'Kalendermonat');
  near(year, 120, 1e-9);
});

/** Rechnung mit festem Wetter: Tarifwechsel mitten im Intervall wird taggenau aufgeteilt. */
test('computeAll_: Tarifwechsel mitten im Ableseintervall, Perioden-Saldo, Monate', () => {
  const weather = {};
  for (const d of ctx.isoRange_('2025-10-20', '2026-11-10')) weather[d] = 5; // jeder Tag HGT 10
  const r = (date, value) => ({ date, value, minutes: null, t: ctx.readingT_(date, null), meter: '' });
  const res = ctx.computeAll_({
    readings: [r('2026-10-30', 1000), r('2026-11-03', 1040)], // 4 Tage, 10 m³/Tag
    weather,
    conversions: [],
    placeholder: { z: 1, hs: 10 },
    tariffs: [{ from: '2025-11-01', ap: 10, gp: 15 }, { from: '2026-11-01', ap: 20, gp: 30 }],
    payments: [{ from: '2025-11-01', amount: 50, day: 14 }],
    periods: [{ name: 'Alt', start: '2025-11-01', end: '2026-10-31' }, { name: 'Neu', start: '2026-11-01', end: '2027-10-31' }],
    settings: { Heizgrenze_C: 15, Raumtemperatur_C: 20, Grundpreis_Verteilung: 'Jahr', Wetter_ab: '2025-01-01' },
    today: '2026-11-05',
  });
  const day = d => res.days.find(x => x.date === d);
  near(day('2026-10-31').m3, 10);
  near(day('2026-10-30').m3, 5); // halber Tag ab 12:00
  near(day('2026-10-31').costWork, 10 * 10 * 10 / 100); // 100 kWh × 10 ct
  near(day('2026-11-01').costWork, 100 * 20 / 100);
  const [alt, neu] = res.periods;
  assert.equal(alt.status, 'beendet');
  assert.equal(alt.complete, false, 'vor dem 30.10. keine Ablesung');
  near(alt.kWh, 150);
  assert.equal(alt.paymentsCount, 12);
  near(alt.paymentsPaid, 600, 0.006);
  near(alt.costBase, 180, 0.006);
  assert.equal(neu.status, 'läuft');
  near(neu.kWh, 250); // 01.11. bis 03.11. 12:00
  assert.equal(neu.measuredUntil, '2026-11-02');
  assert.equal(neu.elapsedDays, 5);
  near(neu.costBase, 5 * (30 * 12) / 365, 0.006);
  near(neu.balance, neu.cost, 0.006);
  assert.match(res.hints.map(h => h.text).join('\n'), /Periode „Alt“: .* ohne Ablesung/);
  const nov = res.months.find(m => m.month === '2026-11');
  assert.equal(nov.days, 5);
  assert.equal(nov.hgt, 50);
  assert.equal(res.months[0].month, '2025-11', 'Tage ab Periodenbeginn, auch ohne Ablesung');
  assert.equal(res.months[0].m3, 0);
});

test('computeAll_: ohne Tarif keine Kosten (statt falscher Null) und Hinweis', () => {
  const weather = {};
  for (const d of ctx.isoRange_('2026-01-01', '2026-02-28')) weather[d] = 0;
  const r = (date, value) => ({ date, value, minutes: null, t: ctx.readingT_(date, null), meter: '' });
  const res = ctx.computeAll_({
    readings: [r('2026-01-01', 0), r('2026-02-28', 100)],
    weather, conversions: [], placeholder: { z: 1, hs: 10 },
    tariffs: [{ from: '2026-02-01', ap: 10, gp: 10 }], payments: [],
    periods: [{ name: 'P', start: '2026-01-01', end: '2026-12-31' }],
    settings: { Heizgrenze_C: 15, Raumtemperatur_C: 20, Grundpreis_Verteilung: 'Jahr', Wetter_ab: '2026-01-01' },
    today: '2026-02-28',
  });
  assert.equal(res.months[0].cost, null);
  assert.notEqual(res.months[1].cost, null);
  assert.equal(res.periods[0].tariffMissing, true);
  const text = res.hints.map(h => h.text).join('\n');
  assert.match(text, /fehlt ein Tarif/);
  assert.match(text, /keine Abschläge/);
});

test('Wetter-Cache: kompakt kodiert, Lücken bleiben Lücken, bleibt < 100 KB bis 2040', () => {
  const map = { '2026-01-01': -1.5, '2026-01-03': 2 };
  assert.deepEqual(plain(ctx.decodeWeather_(ctx.encodeWeather_(map))), { map, last: '2026-01-03' });
  const big = {};
  for (const d of ctx.isoRange_('2020-01-01', '2040-12-31')) big[d] = -12.3;
  assert.ok(ctx.encodeWeather_(big).length < 100 * 1024);
});

test('setup: holt DWD-Historie ab 2020 + laufende Daten, legt Trigger einmal an, schreibt Tage/Monate', () => {
  const b = loadBackend({ http: dwdHttp() });
  b.ctx.setup();
  const w = b.sheet('Wetter');
  assert.equal(w.getLastRow() - 1, b.ctx.dayNumber_('2026-11-07') - b.ctx.dayNumber_('2020-01-01') + 1, 'lückenlos 2020 bis gestern');
  assert.ok(w.getMaxRows() >= w.getLastRow(), 'Tab wurde vergrößert');
  assert.equal(b.state.triggers.length, 1);
  assert.deepEqual(plain([b.state.triggers[0].fn, b.state.triggers[0].hour, b.state.triggers[0].everyDays, b.state.triggers[0].tz]), ['taeglich', 13, 1, 'Europe/Berlin']);
  const fetchedFirst = b.state.fetched.slice();
  assert.ok(fetchedFirst.some(u => u.endsWith('_hist.zip')));
  b.ctx.setup();
  assert.equal(b.state.triggers.length, 1, 'Trigger nicht doppelt');
  const second = b.state.fetched.slice(fetchedFirst.length);
  assert.ok(!second.some(u => u.includes('historical')), 'Historie nur beim ersten Mal');
  const log = b.sheet('Protokoll').rows().map(r => r[2]);
  assert.ok(log.includes('täglich'));
});

test('täglicher Lauf: DWD kurz weg → keine Fehler-Mail; tagelang weg → Fehler (Mail)', () => {
  const http = dwdHttp();
  const b = loadBackend({ http });
  b.ctx.setup();
  for (const k of Object.keys(http)) delete http[k];
  http[`${BASE}recent/tageswerte_KL_05906_akt.zip`] = { code: 503, body: 'down' };
  b.setNow('2026-11-09T12:00:00Z');
  b.ctx.taeglich(); // Daten bis 07.11. → 2 Tage alt: kein Fehler
  assert.equal(b.state.sleeps.length, 3, '3 Wiederholungen mit Wartezeit');
  assert.deepEqual(b.state.sleeps, [2000, 4000, 8000]);
  b.setNow('2026-11-12T12:00:00Z');
  assert.throws(() => b.ctx.taeglich(), /HTTP 503/);
  const log = b.sheet('Protokoll').rows();
  assert.ok(log.some(r => r[1] === 'WARN' && r[2] === 'wetter'));
});

test('Übersicht mit deinen Startdaten: Perioden, Abschläge, Saldo, Monate, Wetter', () => {
  const b = loadBackend({ http: dwdHttp(), now: '2026-11-08T18:00:00Z' });
  b.ctx.setup();
  const readings = [
    ['2025-10-26', 1872.29], ['2025-11-03', 1879.5], ['2025-11-09', 1891.88], ['2025-11-17', 1904.33], ['2025-11-27', 1944.759],
    ['2025-12-06', 1975.02], ['2025-12-08', 1978.7], ['2025-12-12', 1980.8], ['2026-01-03', 2064.23], ['2026-01-06', 2079.15],
    ['2026-01-11', 2097.36], ['2026-01-20', 2120.76], ['2026-01-30', 2165.58], ['2026-02-05', 2188.7], ['2026-02-10', 2205],
    ['2026-03-08', 2240.91], ['2026-03-22', 2267.9], ['2026-03-30', 2278.61], ['2026-04-16', 2294.95], ['2026-07-02', 2300.11],
    ['2026-08-14', 2300.14], ['2026-10-12', 2300.48], ['2026-10-21', 2302.169], ['2026-10-30', 2305.47], ['2026-11-08', 2314.89],
  ];
  putReadings(b.sheet('Ablesungen'), readings.map(([date, value]) => ({ date, value })));
  const put = (tab, rows) => rows.forEach(r => b.sheet(tab).appendRow(r));
  const D = iso => b.ctx.berlinMidnight_(iso);
  put('Tarife', [[D('2025-11-01'), 9.98, 14.49, 'Octopus'], [D('2026-11-01'), 14.1, 14.88, 'MVV Energie']]);
  put('Abschläge', [[D('2025-11-01'), 66.09, 14], [D('2026-11-01'), 30, 1]]);
  put('Perioden', [['Octopus 2025/26', D('2025-11-01'), D('2026-10-31')], ['MVV 2026/27', D('2026-11-01'), D('2027-10-31')]]);
  const o = b.post({ v: 1, key: b.store.KEY, action: 'overview' }).data.overview;
  const [octo, mvv] = o.periods;
  assert.equal(octo.name, 'Octopus 2025/26');
  assert.equal(octo.complete, true);
  assert.equal(octo.paymentsCount, 12);
  near(octo.paymentsPaid, 793.08, 1e-9);
  near(octo.m3, 2305.47 - 1872.29 + 0, 15); // grob: Großteil des Jahres; genaue Aufteilung an den Rändern
  near(octo.costBase, 14.49 * 12, 0.006);
  near(octo.balance, octo.cost - 793.08, 0.006);
  assert.ok(octo.balance < 0, 'Guthaben erwartet');
  assert.equal(mvv.status, 'läuft');
  assert.equal(mvv.paymentsCount, 1);
  assert.equal(o.weather.last, '2026-11-07');
  assert.equal(o.weather.station, '05906');
  assert.ok(o.months.length > 10);
  assert.ok(o.months.every(m => m.hgtNormal !== null), 'Normalwerte aus 2020–2025');
  // Summe der verteilten m³ = Ablesedifferenz
  const sumM3 = b.ctx.computeFromSheet_(b.ss).result.days.reduce((s, d) => s + (d.m3 || 0), 0);
  near(sumM3, 2314.89 - 1872.29, 1e-6);
  b.ctx.runDaily_(b.ss);
  assert.ok(b.sheet('Tage').getLastRow() > 370);
  assert.ok(b.sheet('Monate').rows().some(r => r[0] === '2026-01'));
});
