import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadBackend, putReadings, FakeSpreadsheet } from '../fakes/gas.mjs';

function ready(opts = {}) {
  const b = loadBackend(opts);
  b.ctx.setup();
  return { ...b, key: b.store.KEY };
}

const reading = (over = {}) => ({ id: 'a1b2c3d4-0000-4000-8000-000000000001', date: '2026-11-08', time: '09:30', value: 2310.5, ...over });

test('setup: legt Tabs, Spalten, Einstellungen, Schlüssel an – idempotent', () => {
  const b = loadBackend();
  b.ctx.setup();
  const names = b.ss.getSheets().map(s => s.getName());
  assert.deepEqual(names, ['Ablesungen', 'Tarife', 'Umrechnung', 'Abschläge', 'Perioden', 'Einstellungen', 'Wetter', 'Tage', 'Monate', 'Protokoll']);
  assert.equal(b.ss.timeZone, 'Europe/Berlin');
  assert.equal(b.ss.locale, 'de_DE');
  assert.match(b.store.KEY, /^[0-9a-f]{32}$/);
  assert.equal(b.store.SHEET_ID, b.ss.getId());
  const key = b.store.KEY;
  const settingsRows = b.sheet('Einstellungen').getLastRow();
  b.ctx.setup();
  assert.equal(b.store.KEY, key, 'Schlüssel bleibt beim zweiten Lauf');
  assert.equal(b.ss.getSheets().length, 10, 'keine doppelten Tabs');
  assert.equal(b.sheet('Einstellungen').getLastRow(), settingsRows, 'keine doppelten Einstellungen');
  assert.equal(b.sheet('Protokoll').protections[0].warningOnly, true);
  assert.equal(b.sheet('Ablesungen').formats.get('2,2'), '@', 'Uhrzeit als Text');
});

test('setup: ergänzt fehlende Spalte, ohne Daten anzufassen', () => {
  const b = ready();
  const s = b.sheet('Ablesungen');
  // Spalte „Notiz“ (letzte) entfernen und Daten eintragen
  const last = s.getLastColumn();
  for (const row of s.data) row.length = last - 1;
  putReadings(s, [{ date: '2025-11-01', value: 1865 }]);
  b.ctx.setup();
  assert.equal(s.get(1, last), 'Notiz');
  assert.equal(s.get(2, 3), 1865);
});

test('setup: ohne aktives Sheet klare Fehlermeldung', () => {
  const b = loadBackend({ active: false });
  assert.throws(() => b.ctx.setup(), /aus dem Sheet heraus/);
});

test('GET liefert nur ein Lebenszeichen', () => {
  const b = ready();
  const out = JSON.parse(b.ctx.doGet().getContent());
  assert.deepEqual(out, { ok: true, v: 1, service: 'gaszaehler' });
});

test('Anfrage-Prüfung: kaputt, zu groß, falsche Version, nicht eingerichtet', () => {
  const b = ready();
  assert.equal(b.post('kein json').error.code, 'BAD_REQUEST');
  assert.equal(b.post('x'.repeat(5000)).error.code, 'BAD_REQUEST');
  assert.equal(b.post({ v: 2, key: b.key, action: 'overview' }).error.code, 'BAD_REQUEST');
  assert.equal(b.post([]).error.code, 'BAD_REQUEST');
  const out = b.ctx.doPost({});
  assert.equal(JSON.parse(out.getContent()).error.code, 'BAD_REQUEST');
  const fresh = loadBackend();
  assert.equal(fresh.post({ v: 1, key: 'x', action: 'overview' }).error.code, 'NOT_CONFIGURED');
});

test('Schlüssel: falsch → AUTH und Protokoll, richtig → Übersicht', () => {
  const b = ready();
  const bad = b.post({ v: 1, key: 'falsch', action: 'overview' });
  assert.deepEqual(bad, { ok: false, v: 1, error: { code: 'AUTH', message: 'Falscher Schlüssel' } });
  assert.equal(b.post({ v: 1, action: 'overview' }).error.code, 'AUTH');
  const log = b.sheet('Protokoll').rows().map(r => r[2]);
  assert.ok(log.includes('auth'));
  const ok = b.post({ v: 1, key: b.key, action: 'overview' });
  assert.equal(ok.ok, true);
  assert.equal(ok.data.overview.readingsCount, 0);
  assert.equal(ok.data.overview.last, null);
  assert.equal(ok.data.overview.today, '2026-11-08');
});

test('Unbekannte Aktion', () => {
  const b = ready();
  assert.equal(b.post({ v: 1, key: b.key, action: 'deleteAll' }).error.code, 'BAD_REQUEST');
});

test('addReading: speichert als echtes Datum + Text-Uhrzeit, Duplikat per ID und per Wert', () => {
  const b = ready();
  const r1 = b.post({ v: 1, key: b.key, action: 'addReading', reading: reading() });
  assert.equal(r1.ok, true);
  assert.equal(r1.data.saved, 'new');
  const s = b.sheet('Ablesungen');
  const row = s.rows()[0];
  assert.equal(Object.prototype.toString.call(row[0]), '[object Date]');
  assert.equal(row[0].toISOString(), '2026-11-07T23:00:00.000Z', 'Mitternacht Berlin (MEZ)');
  assert.equal(row[1], '09:30');
  assert.equal(row[2], 2310.5);
  assert.equal(row[4], 'App');
  assert.equal(r1.data.overview.last.value, 2310.5);
  assert.equal(r1.data.overview.last.time, '09:30');

  const again = b.post({ v: 1, key: b.key, action: 'addReading', reading: reading() });
  assert.equal(again.data.saved, 'duplicate');
  const sameValueNewId = b.post({ v: 1, key: b.key, action: 'addReading', reading: reading({ id: 'a1b2c3d4-0000-4000-8000-000000000002' }) });
  assert.equal(sameValueNewId.data.saved, 'duplicate');
  assert.equal(s.rows().length, 1);
});

test('addReading: Konflikt am selben Tag, gleiche ID mit anderem Wert', () => {
  const b = ready();
  b.post({ v: 1, key: b.key, action: 'addReading', reading: reading() });
  const c1 = b.post({ v: 1, key: b.key, action: 'addReading', reading: reading({ id: 'a1b2c3d4-0000-4000-8000-000000000009', value: 2311 }) });
  assert.equal(c1.error.code, 'CONFLICT');
  assert.match(c1.error.message, /08\.11\.2026.*2310,500/);
  const c2 = b.post({ v: 1, key: b.key, action: 'addReading', reading: reading({ value: 2311 }) });
  assert.equal(c2.error.code, 'CONFLICT');
});

test('addReading: Validierung (Datum, Zukunft, Mindestdatum, Wert, Uhrzeit, ID, Zähler)', () => {
  const b = ready();
  const send = over => b.post({ v: 1, key: b.key, action: 'addReading', reading: reading(over) });
  assert.equal(send({ date: '2026-02-30' }).error.code, 'VALIDATION');
  assert.equal(send({ date: '2026-11-09' }).error.code, 'VALIDATION');
  assert.equal(send({ date: '1999-12-31' }).error.code, 'VALIDATION');
  assert.equal(send({ value: -1 }).error.code, 'VALIDATION');
  assert.equal(send({ value: '2310' }).error.code, 'VALIDATION');
  assert.equal(send({ value: 1e7 }).error.code, 'VALIDATION');
  assert.equal(send({ time: '25:00' }).error.code, 'VALIDATION');
  assert.equal(send({ id: 'x' }).error.code, 'BAD_REQUEST');
  assert.equal(send({ meter: '=IMPORTXML()' }).error.code, 'BAD_REQUEST');
  assert.equal(b.post({ v: 1, key: b.key, action: 'addReading' }).error.code, 'BAD_REQUEST');
  // Mindestdatum aus den Einstellungen
  const st = b.sheet('Einstellungen');
  const rowIdx = st.rows().findIndex(r => r[0] === 'Mindestdatum') + 2;
  st.set(rowIdx, 2, '01.11.2025');
  assert.equal(send({ date: '2025-10-31' }).error.code, 'VALIDATION');
  assert.equal(send({ date: '2025-11-01', value: 1865 }).ok, true);
  assert.equal(b.sheet('Ablesungen').rows().length, 1);
});

test('addReading: Monotonie auch beim Nachtragen, Sortierung', () => {
  const b = ready();
  const send = over => b.post({ v: 1, key: b.key, action: 'addReading', reading: reading({ id: '', time: null, ...over }) });
  assert.equal(send({ date: '2025-11-01', value: 1865 }).ok, true);
  assert.equal(send({ date: '2026-10-31', value: 2309 }).ok, true);
  assert.equal(send({ date: '2026-01-03', value: 2400 }).error.code, 'VALIDATION', 'größer als spätere Ablesung');
  assert.equal(send({ date: '2026-01-03', value: 1800 }).error.code, 'VALIDATION', 'kleiner als frühere Ablesung');
  const ok = send({ date: '2026-01-03', value: 2064 });
  assert.equal(ok.ok, true);
  const dates = b.sheet('Ablesungen').rows().map(r => r[0].toISOString().slice(0, 10));
  assert.deepEqual(dates, ['2025-10-31', '2026-01-02', '2026-10-30'], 'nach Datum sortiert (UTC-Darstellung von Mitternacht Berlin)');
  assert.equal(ok.data.overview.intervals.length, 2);
  assert.equal(ok.data.overview.last.value, 2309);
});

test('addReading: Plausibilität fragt nach, confirmed speichert', () => {
  const b = ready();
  const send = over => b.post({ v: 1, key: b.key, action: 'addReading', reading: reading({ id: '', ...over }) });
  send({ date: '2026-11-01', time: '12:00', value: 2309 });
  const p = send({ date: '2026-11-08', time: '12:00', value: 23095 }); // Komma vergessen
  assert.equal(p.error.code, 'PLAUSIBILITY');
  assert.equal(p.error.details.refDate, '2026-11-01');
  assert.ok(p.error.details.perDay > 20);
  const c = send({ date: '2026-11-08', time: '12:00', value: 23095, confirmed: true });
  assert.equal(c.data.saved, 'new');
  // Nachtrag vor dem (bestätigten) Extremwert: der Abstand nach hinten ist unplausibel → Rückfrage
  assert.equal(send({ date: '2026-11-02', value: 2309.5 }).error.code, 'PLAUSIBILITY');
});

test('addReading: Plausibilität beim Nachtragen prüft beide Nachbarn', () => {
  const b = ready();
  const send = over => b.post({ v: 1, key: b.key, action: 'addReading', reading: reading({ id: '', time: null, ...over }) });
  send({ date: '2026-11-01', value: 2309 });
  send({ date: '2026-11-08', value: 2330 });
  assert.equal(send({ date: '2026-11-04', value: 2315 }).ok, true, 'normaler Wert dazwischen');
  const p = send({ date: '2026-11-05', value: 2315 + 0 }); // 0 m³ – unauffällig
  assert.equal(p.ok, true);
});

test('addReading: Sperre belegt → BUSY', () => {
  const b = ready();
  b.state.lockFree = false;
  assert.equal(b.post({ v: 1, key: b.key, action: 'addReading', reading: reading() }).error.code, 'BUSY');
});

test('Übersicht: Intervalle (gebrochene Tage, neueste zuerst), Hinweise, Platzhalter, Umrechnung', () => {
  const b = ready();
  putReadings(b.sheet('Ablesungen'), [
    { date: '2025-11-01', value: 1865 },
    { date: '2025-11-03', value: 1879, time: '18:00' },
    { date: '2025-11-09', value: 1891 },
    { date: '2025-11-09', value: 1892 }, // doppelt
    { date: '2025-11-10', value: 'abc' }, // ungültig
    { date: '2025-11-12', value: '1.900,5' }, // Text, aber lesbar
  ]);
  const o = b.post({ v: 1, key: b.key, action: 'overview' }).data.overview;
  assert.equal(o.readingsCount, 4);
  assert.equal(o.intervals.length, 3);
  const first = o.intervals[o.intervals.length - 1];
  assert.equal(first.from, '2025-11-01');
  assert.equal(first.days, 2.25);
  assert.equal(first.m3, 14);
  assert.equal(first.conversion, 'Platzhalter');
  assert.equal(first.kWh, Math.round(14 * 0.96 * 11.3 * 10) / 10);
  assert.equal(o.intervals[0].to, '2025-11-12');
  const texts = o.hints.map(h => h.text).join('\n');
  assert.match(texts, /zwei Stände am 09\.11\.2025/);
  assert.match(texts, /Zeile 6: Stand fehlt/);
  assert.match(texts, /Platzhalter/);

  // Umrechnung eintragen → Faktor aus Tabelle
  const u = b.sheet('Umrechnung');
  u.set(2, 1, new Date('2025-10-31T23:00:00Z'));
  u.set(2, 2, 11.2);
  u.set(2, 3, 0.95);
  u.set(2, 4, 'Rechnung');
  const o2 = b.post({ v: 1, key: b.key, action: 'overview' }).data.overview;
  assert.equal(o2.intervals.at(-1).conversion, 'Rechnung');
  assert.equal(o2.intervals.at(-1).kWh, Math.round(14 * 11.2 * 0.95 * 10) / 10);
  assert.ok(!o2.hints.some(h => /Platzhalter/.test(h.text)));
});

test('Übersicht: rückläufiger Stand von Hand → Hinweis, Zeitraum ignoriert; Ausschluss-Markierung', () => {
  const b = ready();
  putReadings(b.sheet('Ablesungen'), [
    { date: '2026-01-01', value: 2000 },
    { date: '2026-01-05', value: 1990 },
    { date: '2026-01-10', value: 2010, model: 'ausschließen' },
  ]);
  const o = b.post({ v: 1, key: b.key, action: 'overview' }).data.overview;
  assert.equal(o.intervals.length, 1);
  assert.equal(o.intervals[0].excluded, true);
  assert.match(o.hints.map(h => h.text).join(), /kleiner als am 01\.01\.2026/);
});

test('Übersicht: Zählertausch – keine Intervalle über Zähler hinweg', () => {
  const b = ready();
  putReadings(b.sheet('Ablesungen'), [
    { date: '2026-01-01', value: 2000, meter: 'A1' },
    { date: '2026-01-05', value: 2010, meter: 'A1' },
    { date: '2026-01-05', value: 0.5, meter: 'B2' },
    { date: '2026-01-09', value: 9.5, meter: 'B2' },
  ]);
  const o = b.post({ v: 1, key: b.key, action: 'overview' }).data.overview;
  assert.deepEqual(o.intervals.map(i => [i.meter, i.m3]), [['B2', 9], ['A1', 10]]);
});

test('Unerwarteter Fehler nach Anmeldung wird protokolliert', () => {
  const b = ready();
  b.ss.sheets = b.ss.sheets.filter(s => s.getName() !== 'Umrechnung');
  const out = b.post({ v: 1, key: b.key, action: 'overview' });
  assert.equal(out.error.code, 'NOT_CONFIGURED');
  assert.match(out.error.message, /Umrechnung/);
});

test('Kopie des Sheets: setup stellt Verknüpfung um', () => {
  const ss = new FakeSpreadsheet('kopie-id');
  const b = loadBackend({ ss, props: { SHEET_ID: 'alte-id', KEY: 'k'.repeat(32) } });
  b.ctx.setup();
  assert.equal(b.store.SHEET_ID, 'kopie-id');
  assert.equal(b.store.KEY, 'k'.repeat(32));
});
