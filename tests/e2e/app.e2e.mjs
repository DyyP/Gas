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
  const m = { offline: false, readings: [], calls: [], forceError: null, estimate: false, constDays: false };
  // Tageswerte der letzten 800 Tage bis heute; die letzten 3 Tage ohne Ablesung. Temperatur jahreszeitlich.
  m.days = () => {
    const n = 800;
    const now = Date.now();
    const start = new Date(now - (n - 1) * 864e5).toISOString().slice(0, 10);
    const cols = { start, m3: [], kWh: [], tm: [], covered: [] };
    for (let i = 0; i < n; i++) {
      const date = new Date(now - (n - 1 - i) * 864e5);
      const doy = (date - Date.UTC(date.getUTCFullYear(), 0, 1)) / 864e5;
      const tm = Math.round((10 - 9 * Math.cos((2 * Math.PI * (doy - 15)) / 365)) * 10) / 10;
      const open = i >= n - 3;
      const kWh = open ? null : m.constDays ? 10.8 : Math.round(Math.max(0, 12.5 - tm) * 3.855 * 100) / 100;
      cols.m3.push(open ? null : Math.round((kWh / 10.8) * 1000) / 1000);
      cols.kWh.push(kWh);
      cols.tm.push(tm);
      cols.covered.push(open ? 0 : 1);
    }
    return cols;
  };
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
      generatedAt: new Date().toISOString(), today: new Date().toISOString().slice(0, 10), api: 1, schema: 5,
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
          forecastSeason: { kWh: { p10: 1440, p50: 2112, p80: 2600, p90: 2859 }, cost: { p10: 382, p50: 476, p80: 540, p90: 582 }, balance: { p10: 21.56, p50: 116.37, p80: 180, p90: 221.7 }, paymentsTotal: 360, paymentsCount: 12, measuredShare: 0.04, unknownDays: 357.5, climateYears: 6, mainUncertainty: 'Modell', recommendation: { remaining: 11, current: 30, balanced: 41, safe: 47 },
            measuredUntil: '2026-11-07', actual: [{ date: '2026-11-01', cost: 2 }, { date: '2026-11-07', cost: 16.47 }],
            trajectory: [{ date: '2026-11-07', p10: 16.4, p50: 16.5, p90: 16.6 }, { date: '2027-01-31', p10: 150, p50: 190, p90: 230 }, { date: '2027-10-31', p10: 382, p50: 476, p90: 582 }],
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
        days: m.days(),
        level: { source: 'Faktor', factor: 0.468, theta: 12.5, a: 0.1664, aKWh: 1.806, b: 0, n: 5, from: '2026-08-01', to: '2026-11-08', expectedKWh: 342, actualKWh: 160 },
        ...(m.estimate && last
          ? { estimate: { since: last.date, sinceTime: last.time, hours: 8, lastValue: last.value, m3: 1.066, sd: 0.799, value: last.value + 1.066, tmToday: 3.5, m3PerDay: 3.198, kWhPerDay: 34.7, eurPerDay: 5.38 } }
          : {}),
        savings: { kWh: 708, eur: 100, share: 0.159 },
        season: {
          start: '2026-08-01', end: '2027-07-31', share: 0.064, doneKWh: 160, remainingKWh: 4169, remainingEur: 588,
          marks: [['08', 0], ['09', 0], ['10', 0.005], ['11', 0.038], ['12', 0.187], ['01', 0.402], ['02', 0.639], ['03', 0.801], ['04', 0.926], ['05', 0.992], ['06', 1], ['07', 1]]
            .map(([mo, share]) => ({ month: `${mo >= '08' ? 2026 : 2027}-${mo}`, share })),
          months: [['08', 0], ['09', 22], ['10', 150], ['11', 420], ['12', 640], ['01', 700], ['02', 560], ['03', 450], ['04', 260], ['05', 70], ['06', 0], ['07', 0]]
            .map(([mo, kWhNormal]) => ({ month: `${mo >= '08' ? 2026 : 2027}-${mo}`, kWhNormal })),
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
/** Text eines Elements; geschützte Leerzeichen (in Hervorhebungen) als normale. */
const text = async (page, sel) => (await page.textContent(sel)).replace(/\u00a0/g, ' ');

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

test('Analyse: vier Karten in neuer Reihenfolge, Heizkalender mit Vergleich, Tabellen, Tooltip per Tippen', async () => {
  const { context, page, mock, problems } = await openApp();
  mock.estimate = true;
  [['2025-11-01', 1865], ['2025-11-03', 1879], ['2025-11-10', 1910], ['2025-11-20', 1950], ['2025-12-01', 2010]].forEach(([date, value], i) =>
    mock.readings.push({ id: `a000000${i}`, date, time: null, value }));
  await page.goto(`${base}#auswertung`); // altes Lesezeichen
  await page.reload(); // nur der Hash hat sich geändert – neu laden holt die Ablesungen
  await page.locator('#view-prognose').waitFor();
  await page.click('#tab-analyse');
  for (const id of ['aMonths', 'aCalendar', 'aDayCost', 'aSeason']) await page.locator(`#${id}`).waitFor();
  assert.equal(await page.isVisible('#analyseEmpty'), false);
  // Reihenfolge wie gewünscht; die Heizkurve gibt es nicht mehr
  const order = await page.$$eval('#view-analyse > .card:not([hidden])', n => n.map(x => x.id).filter(Boolean));
  assert.deepEqual(order, ['aMonths', 'aCalendar', 'aDayCost', 'aSeason']);
  assert.equal(await page.locator('#aHeat').count(), 0);
  // Monate je Heizjahr
  assert.match(await text(page, '#aMonths'), /Heizjahr 2026\/27 bisher: 88 kWh – ▼ 54 % weniger als bei Normalwetter/);
  assert.equal(await page.locator('#aMonths rect.nbar.open').count(), 6, 'Dez.–Mai als „noch offen“ (Juni/Juli normal 0 → kein Balken)');
  await page.click('#aMonths .seg button >> text=2025/26');
  assert.equal(await page.getAttribute('#aMonths .seg button >> text=2025/26', 'aria-pressed'), 'true');
  assert.match(await text(page, '#aMonths'), /Heizjahr 2025\/26 \(Daten ab Dez\.? 25\): 1\.076 kWh – ▼ 14 % weniger/);
  // Heizkalender: aktuelle Saison oben, Vergleich darunter (Auswahl), nur Heizmonate Okt–Mai, gleiche Skala
  const today = new Date().toISOString().slice(0, 10);
  const cur = Number(today.slice(5, 7)) >= 8 ? Number(today.slice(0, 4)) : Number(today.slice(0, 4)) - 1;
  const label = y => `${y}/${String(y + 1).slice(2)}`;
  assert.equal(await page.locator('#aCalendar svg').count(), 2, 'zwei Kalender');
  const cal = await text(page, '#aCalendar');
  assert.match(cal, new RegExp(`Saison ${label(cur)}`));
  for (const mo of ['Okt', 'Nov', 'Dez', 'Jan', 'Feb', 'Mär', 'Apr', 'Mai']) assert.ok(cal.includes(mo), mo);
  for (const mo of ['Jun', 'Jul', 'Aug']) assert.ok(!(await page.locator('#aCalendar svg text', { hasText: new RegExp(`^${mo}$`) }).count()), `${mo} ist kein Heizmonat`);
  const options = await page.$$eval('#aCalendar select option', o => o.map(x => x.textContent));
  assert.deepEqual(options, [`Saison ${label(cur - 1)}`, `Saison ${label(cur - 2)}`], 'vergangene Saisons, neueste zuerst');
  assert.match(cal, new RegExp(`in ${label(cur - 1)} bis zum selben Tag`));
  await page.selectOption('#aCalendar select', String(cur - 2));
  assert.match(await text(page, '#aCalendar'), new RegExp(`in ${label(cur - 2)} bis zum selben Tag`));
  assert.equal(await page.inputValue('#aCalendar select'), String(cur - 2), 'Auswahl bleibt');
  assert.equal(await page.locator('#aCalendar rect.today-box').count(), 1, 'heute nur im aktuellen Kalender');
  // Kosten pro Tag nach dem Heizverhalten dieser Saison
  const cost = await text(page, '#aDayCost');
  assert.match(cost, /so wie du diese Saison heizt/);
  assert.match(cost, /Heute \(3,5\s°C\) kostet ein Tag etwa 5,38 €/);
  assert.match(cost, /Jedes Grad kälter: \+0,25 € am Tag/);
  assert.match(cost, /▼ 708 kWh.*▼ 100 €/s);
  assert.match(await text(page, '#aSeason'), /6 %.*160 kWh.*≈ 4\.169 kWh.*am 1\. Januar 40 %, am 1\. April 93 %/s);
  // Tooltip: Tippen auf ein Kästchen im Heizkalender, Tippen daneben schließt
  await page.locator('#aCalendar svg').first().scrollIntoViewIfNeeded();
  const box = await page.locator('#aCalendar svg').first().boundingBox();
  await page.mouse.click(box.x + box.width * 0.3, box.y + 8);
  const tip = page.locator('#aCalendar .chart-tip').first();
  await tip.waitFor();
  assert.match(await tip.textContent(), /\d{2}\.\d{2}\.\d{4}/);
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

test('Rückblick „Letzte 4 Wochen“: Kalenderwochen bis zur letzten Ablesung, Tippen wechselt m³ ↔ kWh (bleibt gemerkt)', async () => {
  const { context, page, mock, problems } = await openApp();
  mock.constDays = true; // jeden Tag 1 m³ = 10,8 kWh, die letzten 3 Tage ohne Ablesung
  mock.readings.push({ id: 'w0000001', date: '2026-10-01', time: null, value: 2300 });
  await page.reload();
  await page.locator('#weeksCard').waitFor();
  const vals = await page.$$eval('#weeksBars .wval', n => n.map(x => x.textContent));
  assert.equal(vals.length, 4);
  assert.deepEqual(vals.slice(0, 2), ['7,0', '7,0'], 'volle Wochen: 7 Tage × 1 m³');
  const kws = await page.$$eval('#weeksBars .wkw', n => n.map(x => x.textContent));
  assert.ok(kws.every(k => /^KW \d{1,2}$/.test(k)));
  const lastRead = new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10);
  const de = iso => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
  assert.match(await page.textContent('#weeksSum'), new RegExp(`m³ · abgelesen bis ${de(lastRead).replace(/\./g, '\\.')}`));
  await page.click('#weeksCard');
  assert.deepEqual((await page.$$eval('#weeksBars .wval', n => n.map(x => x.textContent))).slice(0, 2), ['76', '76'], '7 × 10,8 kWh');
  assert.match(await page.textContent('#weeksSum'), /kWh · abgelesen/);
  assert.equal(await page.locator('#weeksUnit .on').textContent(), 'kWh');
  await page.reload();
  await page.locator('#weeksCard').waitFor();
  assert.match(await page.textContent('#weeksSum'), /kWh/, 'Einheit gemerkt');
  // Unter dem Eingabeformular
  const order = await page.$$eval('#view-erfassen > *', n => n.map(x => x.id).filter(Boolean));
  assert.ok(order.indexOf('weeksCard') === order.indexOf('readingForm') + 1, order.join(','));
  assert.deepEqual(problems, []);
  await context.close();
});

test('Prognose: Umschalter „Langfristig | Diese Saison“ ändert Zahl, Bereich und Empfehlung und bleibt gemerkt', async () => {
  const { context, page } = await openApp();
  await page.click('#tab-prognose');
  await page.locator('.period-switch').waitFor();
  let periods = await text(page, '#periodList');
  assert.match(periods, /Prognose · 31\.10\.2027\s*431 €/);
  await page.click('.period-switch button >> text=Diese Saison');
  periods = await text(page, '#periodList');
  assert.match(periods, /Diese Saison heizt du etwa 53 % weniger als im Jahresmodell/);
  assert.match(periods, /Faktor aus 5 Ablesezeiträumen seit 01\.08\.2026/);
  assert.match(periods, /Prognose · 31\.10\.2027\s*116 €\s*▲ Nachzahlung/);
  assert.match(periods, /80 % sicher: 22–222 €/);
  assert.match(periods, /Abschlag 41 € statt 30 € pro Monat → etwa ausgeglichen \(mit Puffer: 47 €\)/);
  assert.equal(await page.locator('.period-switch').count(), 1, 'nur bei der laufenden Periode');
  await page.reload();
  await page.locator('.period-switch').waitFor();
  assert.match(await text(page, '#periodList'), /116 €/, 'Auswahl gemerkt');
  assert.match(await text(page, '#modelFacts'), /Diese Saison.*1,8 kWh je Heizgradtag.*Faktor 0,47.*5 Zeiträume seit 01\.08\.2026/s);
  await page.click('.period-switch button >> text=Langfristig');
  assert.match(await text(page, '#periodList'), /431 €/);
  await context.close();
});

test('Schmale Bildschirme (iPhone SE 320 px, iPhone 11 Pro 375 px): nichts ragt seitlich heraus', async () => {
  for (const width of [320, 375]) {
    const { context, page, mock } = await openApp();
    mock.estimate = true;
    [['2025-11-01', 1865], ['2025-11-03', 1879], ['2025-11-10', 1910], ['2025-11-20', 1950], ['2025-12-01', 2010]].forEach(([date, value], i) =>
      mock.readings.push({ id: `b000000${i}`, date, time: null, value }));
    await page.setViewportSize({ width, height: 800 });
    for (const view of ['erfassen', 'prognose', 'analyse', 'einstellungen']) {
      await page.goto(`${base}#${view}`);
      await page.reload();
      await page.locator(`#view-${view}`).waitFor();
      await page.waitForTimeout(150);
      const w = await page.evaluate(() => document.documentElement.scrollWidth);
      assert.ok(w <= width, `${view} bei ${width} px: Seite ist ${w} px breit`);
    }
    await context.close();
  }
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

test('Notbremse: startet die App nicht, lädt sie einmal neu; klappt es dann noch nicht, steht der Fehler da', { timeout: 60000 }, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  let served = 0;
  let broken = 1; // so oft liefert der Server eine kaputte main.js
  await context.route('**/js/main.js', route => (served++ < broken ? route.fulfill({ contentType: 'text/javascript', body: 'throw new Error("kaputt")' }) : route.continue()));
  await context.route('https://script.google.com/**', route => route.abort());
  const page = await context.newPage();
  await page.goto(base + '#analyse');
  await page.waitForEvent('load', { timeout: 20000 }); // Neuladen durch guard.js nach 8 s
  await page.waitForFunction(() => window.gasStarted === true);
  assert.equal(served, 2, 'main.js nach dem Neuladen frisch geholt');
  await page.click('#tab-analyse'); // Tabs reagieren wieder
  await page.locator('#view-analyse').waitFor();
  assert.equal(await page.locator('#guardMsg').count(), 0);
  // Dauerhaft kaputt: nach einem Neuladen keine Schleife, sondern Meldung mit Fehlertext
  served = 0;
  broken = 99;
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await page.waitForEvent('load', { timeout: 20000 });
  await page.locator('#guardMsg').waitFor({ timeout: 20000 });
  assert.match(await page.textContent('#guardMsg'), /Fehler: .*kaputt.*main\.js/);
  assert.equal(served, 2, 'genau ein automatischer Neuladeversuch');
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
