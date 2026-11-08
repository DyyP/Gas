// Browser-Test der App mit simuliertem Apps-Script-Server (Playwright, Chromium, iPhone-Größe).
//   node --test tests/e2e/app.e2e.mjs        (Screenshots: E2E_SHOTS=Ordner)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { startServer } from '../../tools/serve.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const API = 'https://script.google.com/macros/s/TEST/exec';
const KEY = 'test-schluessel';
const SHOTS = process.env.E2E_SHOTS;

let server;
let base;
let browser;

before(async () => {
  server = await startServer(0, { apiUrl: API });
  base = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch();
});
after(async () => {
  await browser.close();
  await new Promise(r => server.close(r));
});

/** Simulierter Server mit echten Regeln (vereinfacht): Schlüssel, Duplikate per ID, Plausibilität. */
function mockServer() {
  const m = { offline: false, readings: [], calls: [], forceError: null, estimate: false };
  m.overview = () => {
    const sorted = m.readings.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
    const last = sorted.at(-1) || null;
    const intervals = [];
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1];
      const b = sorted[i];
      const days = (Date.parse(b.date) - Date.parse(a.date)) / 864e5;
      const m3 = b.value - a.value;
      intervals.unshift({ from: a.date, to: b.date, days, m3, m3PerDay: m3 / days, kWh: m3 * 10.8, kWhPerDay: (m3 * 10.8) / days, meter: '', excluded: false, conversion: 'Platzhalter', tmean: 12.5 - (m3 * 10.8) / days / 3.855 });
    }
    return {
      generatedAt: new Date().toISOString(), today: new Date().toISOString().slice(0, 10), api: 1, schema: 4,
      settings: { minDate: '2025-11-01', maxPerDay: 20, meter: '' },
      last: last && { date: last.date, time: last.time, value: last.value, meter: '' },
      readingsCount: m.readings.length, intervals,
      months: [
        { month: '2025-12', days: 31, hgt: 338.3, hgtNormal: 325.4, m3: 99.183, kWh: 1075.9, kWhNormal: 1254.4, cost: 122.15, coverage: 1 },
        { month: '2026-11', days: 8, hgt: 72.6, hgtNormal: 49.3, m3: 8.105, kWh: 87.9, kWhNormal: 190.1, cost: 16.31, coverage: 0.938 },
      ],
      periods: [
        {
          name: 'Octopus 2025/26', start: '2025-11-01', end: '2026-10-31', status: 'beendet', complete: true, totalDays: 365, elapsedDays: 365, measuredUntil: '2026-10-31',
          m3: 429.403, kWh: 4658.2, costWork: 464.88, costBase: 173.88, cost: 638.76, paymentsCount: 12, paymentsPaid: 793.08, paymentsCountTotal: 12, balance: -154.32,
          forecast: { kWh: { p10: 4474, p50: 4652, p80: 4766, p90: 4833 }, cost: { p10: 620.39, p50: 638.19, p80: 649.57, p90: 656.2 }, balance: { p10: -172.69, p50: -154.89, p80: -143.51, p90: -136.88 }, paymentsTotal: 793.08, paymentsCount: 12, measuredShare: 1, unknownDays: 0, climateYears: 6, mainUncertainty: 'Umrechnung', recommendation: null,
            measuredUntil: '2026-10-31', actual: [{ date: '2025-11-01', cost: 1.2 }, { date: '2026-02-01', cost: 330 }, { date: '2026-10-31', cost: 638.29 }],
            trajectory: [{ date: '2026-10-31', p10: 620.39, p50: 638.19, p90: 656.2 }],
            paymentSteps: Array.from({ length: 12 }, (_, i) => ({ date: new Date(Date.UTC(2025, 10 + i, 14)).toISOString().slice(0, 10), sum: Math.round(66.09 * (i + 1) * 100) / 100 })) },
        },
        {
          name: 'MVV 2026/27', start: '2026-11-01', end: '2027-10-31', status: 'läuft', complete: false, totalDays: 365, elapsedDays: 8, measuredUntil: '2026-11-07',
          m3: 8.105, kWh: 87.9, costWork: 12.4, costBase: 3.91, cost: 16.31, paymentsCount: 1, paymentsPaid: 30, paymentsCountTotal: 12, balance: -13.69,
          forecast: { kWh: { p10: 3764, p50: 4345, p80: 4920, p90: 5348 }, cost: { p10: 709.28, p50: 791.26, p80: 872.32, p90: 932.59 }, balance: { p10: 349.28, p50: 431.26, p80: 512.32, p90: 572.59 }, paymentsTotal: 360, paymentsCount: 12, measuredShare: 0.02, unknownDays: 357.5, climateYears: 6, mainUncertainty: 'Wetter', recommendation: { remaining: 11, current: 30, balanced: 70, safe: 77 },
            measuredUntil: '2026-11-07', actual: [{ date: '2026-11-01', cost: 2 }, { date: '2026-11-07', cost: 16.47 }],
            trajectory: [{ date: '2026-11-07', p10: 16.4, p50: 16.5, p90: 16.6 }, { date: '2027-01-31', p10: 250, p50: 290, p90: 330 }, { date: '2027-10-31', p10: 709.28, p50: 791.26, p90: 932.59 }],
            paymentSteps: Array.from({ length: 12 }, (_, i) => ({ date: new Date(Date.UTC(2026, 10 + i, 1)).toISOString().slice(0, 10), sum: 30 * (i + 1) })) },
        },
      ],
      weather: { last: '2026-11-07', station: '05906' },
      model: { a: 0.3554, aKWh: 3.855, b: 0, theta: 12.5, thetaSource: 'Daten', n: 24, excluded: 0, coverage: 1.091, cv: 0.291, relSeA: 0.039 },
      rating: { level: 'grün', text: 'Belastbar: 24 Ablesezeiträume, mehr als eine ganze Heizsaison. Streuung um das Modell 29 %, Unsicherheit des Verbrauchs je Heizgradtag ±4 %.' },
      hints: [{ level: 'info', text: 'kWh mit Platzhalter' }],
      insights: {
        tariffNow: { ap: 14.1, gp: 14.88, name: 'MVV', basePerDay: 0.4892 },
        factorNow: 10.848,
        daily: Array.from({ length: 60 }, (_, i) => ({
          date: new Date(Date.now() - (59 - i) * 864e5).toISOString().slice(0, 10),
          kWh: i < 5 ? null : 10 + (i % 7) * 4, tm: 5 - (i % 7), covered: i < 5 ? 0 : 1,
        })),
        ...(m.estimate && last
          ? { estimate: { since: last.date, sinceTime: last.time, hours: 8, lastValue: last.value, m3: 1.066, sd: 0.799, value: last.value + 1.066, tmToday: 3.5, m3PerDay: 3.198, kWhPerDay: 34.7, eurPerDay: 5.38 } }
          : {}),
        savings: { kWh: 708, eur: 100, share: 0.159 },
        season: {
          start: '2026-08-01', end: '2027-07-31', share: 0.064, doneKWh: 160, remainingKWh: 4169, remainingEur: 588,
          marks: [['08', 0], ['09', 0], ['10', 0.005], ['11', 0.038], ['12', 0.187], ['01', 0.402], ['02', 0.639], ['03', 0.801], ['04', 0.926], ['05', 0.992], ['06', 1], ['07', 1]]
            .map(([mo, share]) => ({ month: `${mo >= '08' ? 2026 : 2027}-${mo}`, share })),
        },
      },
    };
  };
  m.handle = body => {
    m.calls.push(body);
    if (m.forceError) return { ok: false, v: 1, error: m.forceError };
    if (body.key !== KEY) return { ok: false, v: 1, error: { code: 'AUTH', message: 'Falscher Schlüssel' } };
    if (body.action === 'overview') return { ok: true, v: 1, data: { overview: m.overview() } };
    const r = body.reading;
    if (m.readings.some(x => x.date === r.date && x.value === r.value)) return { ok: true, v: 1, data: { saved: 'duplicate', overview: m.overview() } };
    const last = m.readings.at(-1);
    if (last && !r.confirmed && r.value - last.value > 1000) {
      return { ok: false, v: 1, error: { code: 'PLAUSIBILITY', message: 'Server: ungewöhnlich viel – stimmt der Wert?' } };
    }
    m.readings.push(r);
    return { ok: true, v: 1, data: { saved: 'new', overview: m.overview() } };
  };
  return m;
}

async function openApp({ key = KEY, serviceWorkers = 'block' } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, serviceWorkers, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
  const mock = mockServer();
  const problems = [];
  await context.route('https://script.google.com/**', async route => {
    if (mock.offline) return route.abort('internetdisconnected');
    const body = JSON.parse(route.request().postData() || '{}');
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(mock.handle(body)) });
  });
  if (key) await context.addInitScript(k => localStorage.setItem('gas.key', JSON.stringify(k)), key);
  const page = await context.newPage();
  page.on('console', msg => {
    if (msg.type() === 'error' && !/internetdisconnected|ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(msg.text())) problems.push(msg.text());
  });
  page.on('pageerror', err => problems.push(String(err)));
  await page.goto(base);
  return { context, page, mock, problems };
}

const msg = page => page.locator('#msg');

test('Ersteinrichtung: Schlüssel abfragen, falscher wird abgelehnt, richtiger verbindet', async () => {
  const { context, page, problems } = await openApp({ key: null });
  await page.locator('#keyForm').waitFor();
  await page.fill('#keyInput', 'falsch');
  await page.click('#keyForm button[type=submit]');
  await page.locator('#keyMsg', { hasText: 'falsch' }).waitFor();
  assert.equal(await page.isVisible('#keyForm'), true);
  await page.fill('#keyInput', KEY);
  await page.click('#keyForm button[type=submit]');
  await msg(page).filter({ hasText: 'Verbunden' }).waitFor();
  assert.equal(await page.isVisible('#keyForm'), false);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, '1-erfassen.png'), fullPage: true });
  assert.deepEqual(problems, []);
  await context.close();
});

test('Online speichern: Komma-Eingabe, Uhrzeit heute, Anzeige aktualisiert', async () => {
  const { context, page, mock, problems } = await openApp();
  await page.fill('#value', '2309,5');
  await page.click('#saveBtn');
  await msg(page).filter({ hasText: 'Gespeichert ✓' }).waitFor();
  const add = mock.calls.find(c => c.action === 'addReading');
  assert.equal(add.reading.value, 2309.5);
  assert.match(add.reading.time, /^\d{2}:\d{2}$/);
  assert.equal(add.reading.id, undefined, 'keine ID an den Server');
  assert.equal(mock.calls.filter(c => c.action === 'overview').length, 1, 'nach dem Speichern keine zweite Übersichtsanfrage');
  assert.equal(add.v, 1);
  assert.match(await page.textContent('#lastText'), /2\.309,500 m³/);
  assert.equal(await page.inputValue('#value'), '');
  assert.deepEqual(problems, []);
  await context.close();
});

test('Offline speichern: wartet lokal, wird bei Verbindung genau einmal gesendet', async () => {
  const { context, page, mock, problems } = await openApp();
  await msg(page).filter({ hasText: '' }).waitFor();
  mock.offline = true;
  await page.fill('#value', '2310');
  await page.click('#saveBtn');
  await msg(page).filter({ hasText: 'Offline gespeichert' }).waitFor();
  await page.locator('#queueTitle', { hasText: '1 Ablesung warten' }).waitFor();
  assert.match(await page.textContent('#lastSub'), /noch nicht gesendet/);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, '2-offline.png'), fullPage: true });
  // Neu laden (App wurde geschlossen) – Eintrag ist noch da
  await page.reload();
  await page.locator('#queueTitle', { hasText: '1 Ablesung warten' }).waitFor();
  mock.offline = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.locator('#queueCard').waitFor({ state: 'hidden' });
  assert.equal(mock.readings.length, 1);
  assert.equal(mock.calls.filter(c => c.action === 'addReading').length, 1);
  assert.deepEqual(problems, []);
  await context.close();
});

test('Plausibilität: Rückfrage in der App, Bestätigen sendet confirmed', async () => {
  const { context, page, mock } = await openApp();
  mock.readings.push({ id: 'x0000001', date: '2026-10-31', time: null, value: 2309 });
  await page.reload();
  await page.fill('#value', '230950');
  await page.click('#saveBtn');
  await page.locator('#confirmDialog[open]').waitFor();
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, '3-rueckfrage.png') });
  await page.click('#confirmCancel');
  assert.equal(mock.calls.filter(c => c.action === 'addReading').length, 0, 'Korrigieren sendet nichts');
  await page.click('#saveBtn');
  await page.click('#confirmOk');
  await msg(page).filter({ hasText: 'Gespeichert ✓' }).waitFor();
  assert.equal(mock.calls.find(c => c.action === 'addReading').reading.confirmed, true);
  await context.close();
});

test('Server-Rückfrage (Client kannte den Stand nicht) und Ablehnung', async () => {
  const { context, page, mock } = await openApp();
  await msg(page).filter({ hasText: '' }).waitFor();
  mock.readings.push({ id: 'x0000001', date: '2026-10-31', time: null, value: 2309 }); // App weiß davon noch nichts
  await page.fill('#value', '9999');
  await page.click('#saveBtn');
  await page.locator('#confirmText', { hasText: 'Server: ungewöhnlich viel' }).waitFor();
  await page.click('#confirmOk');
  await msg(page).filter({ hasText: 'Gespeichert ✓' }).waitFor();
  mock.forceError = { code: 'VALIDATION', message: 'Stand ist kleiner als am 31.10.2026' };
  await page.fill('#value', '10000');
  await page.click('#saveBtn');
  await msg(page).filter({ hasText: 'Nicht gespeichert: Stand ist kleiner' }).waitFor();
  assert.equal(await page.isVisible('#queueCard'), false, 'abgelehnter Eintrag hängt nicht in der Warteschlange');
  await context.close();
});

test('Eingabefehler werden ohne Server-Anfrage gemeldet', async () => {
  const { context, page, mock } = await openApp();
  await msg(page).filter({ hasText: '' }).waitFor();
  const before = mock.calls.length;
  await page.fill('#value', 'abc');
  await page.click('#saveBtn');
  await msg(page).filter({ hasText: 'Bitte eine Zahl' }).waitFor();
  await page.fill('#date', '2099-01-01');
  await page.fill('#value', '2310');
  await page.click('#saveBtn');
  await msg(page).filter({ hasText: 'Zukunft' }).waitFor();
  assert.equal(mock.calls.length, before);
  await context.close();
});

test('Prognose und Einstellungen', async () => {
  const { context, page, mock } = await openApp();
  mock.readings.push({ id: 'a0000001', date: '2025-11-01', time: null, value: 1865 }, { id: 'a0000002', date: '2025-11-03', time: null, value: 1879 });
  await page.reload();
  await page.click('#tab-prognose');
  await page.locator('.pchart-svg').first().waitFor();
  assert.equal(await page.getAttribute('#tab-prognose', 'aria-current'), 'page');
  const periods = await page.textContent('#periodList');
  assert.match(periods, /MVV 2026\/27.*läuft\s*Tag 8\/365/s);
  assert.match(periods, /80 % sicher: 137–173 €/);
  assert.match(periods, /Prognose · 31\.10\.2027\s*431 €\s*▲ Nachzahlung/);
  assert.match(periods, /80 % sicher: 349–573 €/);
  assert.match(periods, /Ergebnis · 31\.10\.2026\s*155 €\s*▼ Guthaben/);
  assert.equal(await page.locator('.pchart-svg').count(), 2, 'je Periode ein Diagramm');
  assert.match(await page.getAttribute('.pchart-svg >> nth=0', 'aria-label'), /MVV 2026\/27: Nachzahlung etwa 431 €/);
  assert.equal(await page.locator('.gap.bad').count(), 1, 'Lücke Nachzahlung weinrot');
  assert.equal(await page.locator('.gap.good').count(), 1, 'Lücke Guthaben grün');
  assert.match(periods, /Abschlag 70 € statt 30 € pro Monat → etwa ausgeglichen \(mit Puffer: 77 €\)/);
  assert.match(periods, /Größte Unsicherheit: das Wetter bis zum Periodenende/);
  assert.match(periods, /Schätzung der Schlussrechnung/);
  assert.match(await page.textContent('#ratingText'), /Belastbar: 24 Ablesezeiträume/);
  assert.match(await page.getAttribute('#ratingText', 'class'), /green/);
  assert.match(await page.textContent('#modelFacts'), /3,9 kWh .*12,5 °C \(aus deinen Ablesungen\).*keine \(nur Heizung\)/s);
  assert.ok(periods.indexOf('MVV') < periods.indexOf('Octopus'), 'laufende Periode zuerst');
  assert.equal(await page.isVisible('#hintsCard'), true);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, '4-prognose.png'), fullPage: true });
  await page.click('#tab-einstellungen');
  await page.click('#testBtn');
  await page.locator('#testMsg', { hasText: 'Verbindung ok – 2 Ablesung(en)' }).waitFor();
  assert.match(await page.textContent('#keyState'), /…ssel/);
  assert.match(await page.textContent('#weatherState'), /05906.*07\.11\.2026.*Deutscher Wetterdienst/);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, '6-einstellungen.png'), fullPage: true });
  await context.close();
});

test('Live-Zähler: geschätzter Stand jetzt mit Zählwerk, Unsicherheit und Kosten je Tag', async () => {
  const { context, page, mock, problems } = await openApp();
  mock.estimate = true;
  mock.readings.push({ id: 'a0000001', date: '2026-10-31', time: null, value: 2309 });
  await page.reload();
  await page.locator('#odo').waitFor();
  assert.equal((await page.textContent('#odo')).replace(/\s/g, ''), '02310,066m³');
  assert.equal(await page.getAttribute('#odo', 'aria-label'), 'geschätzt 2.310,066 m³');
  assert.equal(await page.locator('#odo span.dec').count(), 3);
  assert.equal(await page.isVisible('#lastText'), false);
  assert.match(await page.textContent('#meterLabel'), /geschätzt/);
  assert.match(await page.textContent('#lastSub'), /± 0,8 m³ · zuletzt abgelesen 31\.10\.2026 .*2\.309,000 m³/);
  assert.match(await page.textContent('#meterTiles'), /3,2 m³pro Tag bei 3,5\s°C.*5,38 €pro Tag \(MVV\)/);
  // Offline erfasster, neuerer Stand verdrängt die Schätzung
  mock.offline = true;
  await page.fill('#value', '2311');
  await page.click('#saveBtn');
  await msg(page).filter({ hasText: 'Offline gespeichert' }).waitFor();
  assert.equal(await page.isVisible('#odo'), false);
  assert.match(await page.textContent('#lastText'), /2\.311,000 m³/);
  assert.match(await page.textContent('#meterLabel'), /Letzter Stand/);
  assert.deepEqual(problems, []);
  await context.close();
});

test('Analyse: alle fünf Karten, Tabellen aufklappbar, Tooltip per Tippen', async () => {
  const { context, page, mock, problems } = await openApp();
  mock.estimate = true;
  [['2025-11-01', 1865], ['2025-11-03', 1879], ['2025-11-10', 1910], ['2025-11-20', 1950], ['2025-12-01', 2010]].forEach(([date, value], i) =>
    mock.readings.push({ id: `a000000${i}`, date, time: null, value }));
  await page.goto(`${base}#auswertung`); // altes Lesezeichen
  await page.reload(); // nur der Hash hat sich geändert – neu laden holt die Ablesungen
  await page.locator('#view-prognose').waitFor();
  await page.click('#tab-analyse');
  for (const id of ['aHeat', 'aMonths', 'aDayCost', 'aCalendar', 'aSeason']) await page.locator(`#${id}`).waitFor();
  assert.equal(await page.isVisible('#analyseEmpty'), false);
  // Reihenfolge wie gewünscht: Heizkurve, Monate, Tageskosten, Kalender, Saison
  const order = await page.$$eval('#view-analyse > .card:not([hidden])', n => n.map(x => x.id).filter(Boolean));
  assert.deepEqual(order, ['aHeat', 'aMonths', 'aDayCost', 'aCalendar', 'aSeason']);
  assert.equal(await page.locator('#aHeat circle.pt').count(), 4);
  assert.match(await page.textContent('#aHeat'), /Je Grad kälter brauchst du 3,9 kWh mehr am Tag \(≈ 0,54 €\)/);
  assert.match(await page.textContent('#aMonths'), /2 Monaten: 1\.164 kWh – ▼ 19 % weniger als bei Normalwetter/);
  assert.match(await page.textContent('#aDayCost'), /Heute \(3,5\s°C\) kostet ein Tag etwa 5,38 €/);
  assert.match(await page.textContent('#aDayCost'), /▼ 708 kWh.*▼ 100 €/s);
  assert.equal(await page.locator('#aCalendar rect.today-box').count(), 1);
  assert.match(await page.textContent('#aSeason'), /6 %.*160 kWh.*≈ 4\.169 kWh.*am 1\. Januar 40 %, am 1\. April 93 %/s);
  // Tooltip: Tippen auf einen Punkt der Heizkurve, Tippen daneben schließt
  const dot = await page.locator('#aHeat circle.pt').first().boundingBox();
  await page.mouse.click(dot.x + dot.width / 2, dot.y + dot.height / 2);
  const tip = page.locator('#aHeat .chart-tip');
  await tip.waitFor();
  assert.match(await tip.textContent(), /Tage.*kWh\/Tag.*Modell/s);
  await page.mouse.click(5, 300);
  await tip.waitFor({ state: 'hidden' });
  // Tabellen
  await page.click('#view-analyse summary >> text=Monate');
  const months = await page.textContent('#monthRows');
  assert.match(months, /Nov\.? 26 \*/);
  assert.match(months, /1\.254/);
  assert.match(months, /122,15 €/);
  await page.click('#view-analyse summary >> text=Zeiträume');
  await page.locator('#intervalRows tr').first().waitFor();
  assert.match(await page.textContent('#intervalRows'), /01\.11\.–03\.11\.2025/);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, '5-analyse.png'), fullPage: true });
  assert.deepEqual(problems, []);
  await context.close();
});

test('Altes Server-Skript wird klar gemeldet statt „keine Periode“', async () => {
  const { context, page, mock } = await openApp();
  const orig = mock.overview;
  mock.overview = () => {
    const o = orig();
    delete o.periods;
    delete o.months;
    o.schema = 2;
    return o;
  };
  await page.reload();
  await page.click('#tab-prognose');
  await page.locator('#periodEmpty', { hasText: 'älteren Stand' }).waitFor();
  assert.match(await page.textContent('#hintsList'), /Update aus dem README/);
  await page.click('#tab-analyse');
  await page.locator('#analyseEmpty', { hasText: 'älteren Stand' }).waitFor();
  assert.equal(await page.isVisible('#aHeat'), false);
  await context.close();
});

test('Service Worker: App öffnet ohne Netz (Server weg) aus dem Cache', async () => {
  const offlineServer = await startServer(0, { apiUrl: API });
  const url = `http://127.0.0.1:${offlineServer.address().port}/`;
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'allow' });
  const page = await context.newPage();
  await page.goto(url);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => caches.keys().then(k => k.some(n => n.startsWith('gas-shell-'))));
  await new Promise(r => offlineServer.close(r));
  offlineServer.closeAllConnections?.();
  await page.reload();
  await page.locator('#readingForm').waitFor();
  assert.equal(await page.title(), 'Gaszähler');
  await context.close();
});
