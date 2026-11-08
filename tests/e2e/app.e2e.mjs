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
  const m = { offline: false, readings: [], calls: [], forceError: null };
  m.overview = () => {
    const sorted = m.readings.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
    const last = sorted.at(-1) || null;
    const intervals = [];
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1];
      const b = sorted[i];
      const days = (Date.parse(b.date) - Date.parse(a.date)) / 864e5;
      const m3 = b.value - a.value;
      intervals.unshift({ from: a.date, to: b.date, days, m3, m3PerDay: m3 / days, kWh: m3 * 10.8, kWhPerDay: (m3 * 10.8) / days, meter: '', excluded: false, conversion: 'Platzhalter' });
    }
    return {
      generatedAt: new Date().toISOString(), today: new Date().toISOString().slice(0, 10), api: 1, schema: 2,
      settings: { minDate: '2025-11-01', maxPerDay: 20, meter: '' },
      last: last && { date: last.date, time: last.time, value: last.value, meter: '' },
      readingsCount: m.readings.length, intervals,
      months: [
        { month: '2025-12', days: 31, hgt: 338.3, hgtNormal: 325.4, m3: 99.183, kWh: 1075.9, cost: 122.15, coverage: 1 },
        { month: '2026-11', days: 8, hgt: 72.6, hgtNormal: 49.3, m3: 8.105, kWh: 87.9, cost: 16.31, coverage: 0.938 },
      ],
      periods: [
        { name: 'Octopus 2025/26', start: '2025-11-01', end: '2026-10-31', status: 'beendet', complete: true, totalDays: 365, elapsedDays: 365, coveredDays: 365, measuredUntil: '2026-10-31', m3: 429.403, kWh: 4658.2, costWork: 464.88, costBase: 173.88, cost: 638.76, paymentsCount: 12, paymentsPaid: 793.08, paymentsCountTotal: 12, paymentsTotal: 793.08, balance: -154.32, tariffMissing: false },
        { name: 'MVV 2026/27', start: '2026-11-01', end: '2027-10-31', status: 'läuft', complete: false, totalDays: 365, elapsedDays: 8, coveredDays: 7.5, measuredUntil: '2026-11-07', m3: 8.105, kWh: 87.9, costWork: 12.4, costBase: 3.91, cost: 16.31, paymentsCount: 1, paymentsPaid: 30, paymentsCountTotal: 12, paymentsTotal: 360, balance: -13.69, tariffMissing: false },
      ],
      weather: { last: '2026-11-07', station: '05906', source: 'Deutscher Wetterdienst' },
      hints: [{ level: 'info', text: 'kWh mit Platzhalter' }],
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

test('Auswertung und Einstellungen', async () => {
  const { context, page, mock } = await openApp();
  mock.readings.push({ id: 'a0000001', date: '2025-11-01', time: null, value: 1865 }, { id: 'a0000002', date: '2025-11-03', time: null, value: 1879 });
  await page.reload();
  await page.click('#tab-auswertung');
  await page.locator('#intervalRows tr').first().waitFor();
  assert.match(await page.textContent('#intervalRows'), /01\.11\.–03\.11\.2025/);
  const periods = await page.textContent('#periodList');
  assert.match(periods, /MVV 2026\/27.*läuft \(Tag 8 von 365\)/s);
  assert.match(periods, /Guthaben 154,32 €/);
  assert.match(periods, /Bisher 13,69 € mehr gezahlt als verbraucht/);
  assert.doesNotMatch(periods, /Guthaben 13,69/);
  assert.match(periods, /Schätzung der Schlussrechnung/);
  assert.ok(periods.indexOf('MVV') < periods.indexOf('Octopus'), 'laufende Periode zuerst');
  const months = await page.textContent('#monthRows');
  assert.match(months, /Nov\.? 26 \*/);
  assert.match(months, /122,15 €/);
  assert.equal(await page.isVisible('#hintsCard'), true);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, '4-auswertung.png'), fullPage: true });
  await page.click('#tab-einstellungen');
  await page.click('#testBtn');
  await page.locator('#testMsg', { hasText: 'Verbindung ok – 2 Ablesung(en)' }).waitFor();
  assert.match(await page.textContent('#keyState'), /…ssel/);
  assert.match(await page.textContent('#weatherState'), /05906.*07\.11\.2026.*Deutscher Wetterdienst/);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, '5-einstellungen.png'), fullPage: true });
  await context.close();
});

test('Altes Server-Skript wird klar gemeldet statt „keine Periode“', async () => {
  const { context, page, mock } = await openApp();
  const orig = mock.overview;
  mock.overview = () => {
    const o = orig();
    delete o.periods;
    delete o.months;
    o.schema = 1;
    return o;
  };
  await page.reload();
  await page.click('#tab-auswertung');
  await page.locator('#periodEmpty', { hasText: 'älteren Stand' }).waitFor();
  assert.match(await page.textContent('#hintsList'), /Update aus dem README/);
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
