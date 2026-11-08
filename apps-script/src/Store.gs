/**
 * Store.gs – Lesen und Schreiben im Google Sheet.
 */

function isoOfDate_(d) {
  return Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
}

/** Liest einen Tab komplett: { sheet, cols: {Überschrift: Index}, rows: [{row, v, d}] }. */
function readTable_(ss, tabName) {
  const sheet = ss.getSheetByName(tabName);
  if (!sheet) throw apiError_('NOT_CONFIGURED', 'Tab „' + tabName + '“ fehlt – im Sheet „Gaszähler → Einrichten / aktualisieren“ wählen.');
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  const table = { sheet: sheet, cols: {}, lastCol: lastCol, rows: [] };
  if (lastRow < 1 || lastCol < 1) return table;
  const range = sheet.getRange(1, 1, lastRow, lastCol);
  const values = range.getValues();
  const display = range.getDisplayValues(); // Uhrzeit & Texte so, wie du sie siehst
  values[0].forEach((h, i) => {
    const name = norm_(h);
    if (name && !(name in table.cols)) table.cols[name] = i;
  });
  for (let r = 1; r < values.length; r++) {
    if (values[r].every(v => v === '' || v === null)) continue;
    table.rows.push({ row: r + 1, v: values[r], d: display[r] });
  }
  return table;
}

function requireCols_(table, tabName, names) {
  const missing = names.filter(n => !(n in table.cols));
  if (missing.length) {
    throw apiError_('NOT_CONFIGURED', 'Im Tab „' + tabName + '“ fehlt die Spalte „' + missing.join('“, „') + '“ – „Gaszähler → Einrichten / aktualisieren“ wählen.');
  }
}

function val_(table, row, name) {
  const i = table.cols[name];
  return i === undefined ? '' : row.v[i];
}

function text_(table, row, name) {
  const i = table.cols[name];
  return i === undefined ? '' : norm_(row.d[i]);
}

/** Einstellungen mit Vorgaben: { values: {Schlüssel: Wert}, hints }. */
function readSettings_(ss) {
  const table = readTable_(ss, 'Einstellungen');
  requireCols_(table, 'Einstellungen', ['Schlüssel', 'Wert']);
  const raw = {};
  for (const row of table.rows) {
    const key = text_(table, row, 'Schlüssel');
    if (key && !(key in raw)) raw[key] = { v: val_(table, row, 'Wert'), d: text_(table, row, 'Wert'), row: row.row };
  }
  const values = {};
  const hints = [];
  for (const def of settingDefs_()) {
    const cell = raw[def.key];
    let value = def.value;
    if (cell && cell.d !== '') {
      if (def.type === 'number') {
        const n = parseNumberDe_(cell.v);
        if (isNaN(n)) hints.push({ level: 'warn', text: 'Einstellung „' + def.key + '“ ist keine Zahl – Vorgabe ' + def.value + ' gilt.' });
        else value = n;
      } else if (def.type === 'date') {
        const iso = parseDateValue_(cell.v, isoOfDate_);
        if (!iso) hints.push({ level: 'warn', text: 'Einstellung „' + def.key + '“ ist kein Datum – wird ignoriert.' });
        else value = iso;
      } else {
        value = cell.d;
      }
    }
    values[def.key] = value;
  }
  return { values: values, hints: hints };
}

/** Ablesungen aus dem Sheet: { readings, hints }. Ungültige Zeilen werden gemeldet, nicht still verworfen. */
function readReadings_(ss) {
  const table = readTable_(ss, 'Ablesungen');
  requireCols_(table, 'Ablesungen', ['Datum', 'Stand_m3']);
  const readings = [];
  const hints = [];
  for (const row of table.rows) {
    const date = parseDateValue_(val_(table, row, 'Datum'), isoOfDate_);
    const value = parseNumberDe_(val_(table, row, 'Stand_m3'));
    if (!date) {
      hints.push({ level: 'warn', text: 'Ablesungen Zeile ' + row.row + ': Datum fehlt oder ist ungültig – Zeile wird ignoriert.' });
      continue;
    }
    if (isNaN(value) || value < 0) {
      hints.push({ level: 'warn', text: 'Ablesungen Zeile ' + row.row + ': Stand fehlt oder ist keine Zahl – Zeile wird ignoriert.' });
      continue;
    }
    let minutes = parseTime_(text_(table, row, 'Uhrzeit'));
    if (typeof minutes === 'number' && isNaN(minutes)) {
      hints.push({ level: 'warn', text: 'Ablesungen Zeile ' + row.row + ': Uhrzeit nicht lesbar (HH:MM) – 12:00 angenommen.' });
      minutes = null;
    }
    readings.push({
      row: row.row,
      date: date,
      minutes: minutes,
      t: readingT_(date, minutes),
      value: value,
      meter: text_(table, row, 'Zähler'),
      source: text_(table, row, 'Quelle'),
      exclude: text_(table, row, 'Modell').toLowerCase() === 'ausschließen',
      id: text_(table, row, 'ID'),
    });
  }
  const meters = {};
  readings.forEach(r => (meters[r.meter] = true));
  if ('' in meters && Object.keys(meters).length > 1) {
    hints.push({ level: 'warn', text: 'Ablesungen: Zeilen mit und ohne Zählernummer gemischt – Zeiträume dazwischen fehlen. Bitte überall die Nummer eintragen.' });
  }
  return { readings: readings, hints: hints };
}

/** Umrechnung (Brennwert × Zustandszahl) aus dem Sheet: { conversions, hints }. */
function readConversions_(ss) {
  const table = readTable_(ss, 'Umrechnung');
  requireCols_(table, 'Umrechnung', ['Gültig_ab', 'Brennwert_kWh_m3', 'Zustandszahl']);
  const conversions = [];
  const hints = [];
  for (const row of table.rows) {
    const from = parseDateValue_(val_(table, row, 'Gültig_ab'), isoOfDate_);
    const hs = parseNumberDe_(val_(table, row, 'Brennwert_kWh_m3'));
    const z = parseNumberDe_(val_(table, row, 'Zustandszahl'));
    if (!from || !(hs >= 8 && hs <= 13) || !(z >= 0.8 && z <= 1.1)) {
      hints.push({ level: 'warn', text: 'Umrechnung Zeile ' + row.row + ': Datum, Brennwert (8–13) oder Zustandszahl (0,8–1,1) unplausibel – Zeile wird ignoriert.' });
      continue;
    }
    conversions.push({ from: from, hs: hs, z: z, status: text_(table, row, 'Status') });
  }
  return { conversions: conversions, hints: hints };
}

/** Hängt eine geprüfte Ablesung an und sortiert, falls sie nachgetragen wurde. */
function appendReading_(ss, r, existing) {
  const table = readTable_(ss, 'Ablesungen');
  requireCols_(table, 'Ablesungen', ['Datum', 'Uhrzeit', 'Stand_m3', 'Zähler', 'Quelle', 'ID', 'Erfasst_am']);
  const row = [];
  for (let i = 0; i < table.lastCol; i++) row.push('');
  const put = (name, value) => (row[table.cols[name]] = value);
  put('Datum', Utilities.parseDate(r.date, TZ, 'yyyy-MM-dd')); // echtes Datum, Mitternacht Berlin
  put('Uhrzeit', r.minutes === null ? '' : formatTime_(r.minutes));
  put('Stand_m3', r.value);
  put('Zähler', safeText_(r.meter));
  put('Quelle', 'App');
  put('ID', r.id);
  put('Erfasst_am', now_());
  const sheet = table.sheet;
  const newRow = sheet.getLastRow() + 1;
  sheet.getRange(newRow, 1, 1, row.length).setValues([row]);
  const latest = existing.reduce((m, x) => Math.max(m, x.t), -Infinity);
  if (r.t < latest) {
    sheet.getRange(2, 1, newRow - 1, row.length).sort([
      { column: table.cols['Datum'] + 1, ascending: true },
      { column: table.cols['Uhrzeit'] + 1, ascending: true },
    ]);
  }
}

/** Schreibt ins Protokoll (rollierend, höchstens ~600 Zeilen). Fehler hier dürfen nie die Anfrage scheitern lassen. */
function logEvent_(ss, level, event, details) {
  try {
    const sheet = ss.getSheetByName('Protokoll');
    if (!sheet) return;
    sheet.appendRow([now_(), level, safeText_(event), safeText_(String(details === undefined ? '' : details).slice(0, 2000))]);
    if (sheet.getLastRow() > 600) sheet.deleteRows(2, 100);
  } catch (e) {
    console.error('Protokoll nicht schreibbar: ' + e);
  }
}

// ----- ab M2: Wetter, Tarife, Abschläge, Perioden, Ergebnistabellen -----

const WEATHER_CACHE_KEY = 'weather-v1';

/** Wetter als { map: {iso: tm}, last }. Mit kurzem Cache (kompakt kodiert, < 100 KB). */
function readWeather_(ss, noCache) {
  const cache = CacheService.getScriptCache();
  if (!noCache) {
    const hit = cache.get(WEATHER_CACHE_KEY);
    if (hit) return decodeWeather_(hit);
  }
  const table = readTable_(ss, 'Wetter');
  const map = {};
  for (const row of table.rows) {
    const iso = parseDateValue_(text_(table, row, 'Datum'), isoOfDate_) || parseDateValue_(val_(table, row, 'Datum'), isoOfDate_);
    const tm = parseNumberDe_(val_(table, row, 'Tm_C'));
    if (iso && !isNaN(tm)) map[iso] = tm;
  }
  const result = { map: map, last: Object.keys(map).sort().pop() || null };
  try {
    cache.put(WEATHER_CACHE_KEY, encodeWeather_(map), 21600);
  } catch (e) {
    /* zu groß o. Ä. – dann eben ohne Cache */
  }
  return result;
}

/** „JJJJ-MM-TT|v,v,,v“ – eine Zahl je Tag ab Startdatum, leer = fehlt. */
function encodeWeather_(map) {
  const keys = Object.keys(map).sort();
  if (!keys.length) return '|';
  const vals = isoRange_(keys[0], keys[keys.length - 1]).map(d => (map[d] === undefined ? '' : String(map[d])));
  return keys[0] + '|' + vals.join(',');
}

function decodeWeather_(s) {
  const parts = s.split('|');
  const map = {};
  if (!parts[0]) return { map: map, last: null };
  let n = dayNumber_(parts[0]);
  for (const v of parts[1].split(',')) {
    if (v !== '') map[isoFromDayNumber_(n)] = Number(v);
    n++;
  }
  return { map: map, last: Object.keys(map).sort().pop() || null };
}

function writeWeather_(ss, map, station) {
  const now = now_();
  const rows = Object.keys(map)
    .sort()
    .map(iso => [berlinMidnight_(iso), map[iso], 'DWD ' + station, now]);
  writeTable_(ss, 'Wetter', rows);
  CacheService.getScriptCache().remove(WEATHER_CACHE_KEY);
}

/** Ersetzt alle Datenzeilen eines System-Tabs (Kopfzeile bleibt). */
function writeTable_(ss, tabName, rows) {
  const sheet = ss.getSheetByName(tabName);
  if (!sheet) throw apiError_('NOT_CONFIGURED', 'Tab „' + tabName + '“ fehlt – „Gaszähler → Einrichten / aktualisieren“ wählen.');
  const width = sheet.getLastColumn();
  const old = sheet.getLastRow();
  if (old > 1) sheet.getRange(2, 1, old - 1, width).clearContent();
  if (!rows.length) return;
  const need = rows.length + 1;
  if (sheet.getMaxRows() < need) sheet.insertRowsAfter(sheet.getMaxRows(), need - sheet.getMaxRows());
  sheet.getRange(2, 1, rows.length, width).setValues(rows.map(r => r.concat(new Array(Math.max(0, width - r.length)).fill('')).slice(0, width)));
}

/** Tarife: [{from, ap (ct/kWh), gp (€/Monat)}] nach Datum sortiert. */
function readTariffs_(ss) {
  const table = readTable_(ss, 'Tarife');
  requireCols_(table, 'Tarife', ['Gültig_ab', 'Arbeitspreis_ct_kWh', 'Grundpreis_EUR_Monat']);
  const rows = [];
  const hints = [];
  for (const row of table.rows) {
    const from = parseDateValue_(val_(table, row, 'Gültig_ab'), isoOfDate_);
    const ap = parseNumberDe_(val_(table, row, 'Arbeitspreis_ct_kWh'));
    const gp = parseNumberDe_(val_(table, row, 'Grundpreis_EUR_Monat'));
    if (!from || !(ap > 0 && ap < 100) || !(gp >= 0 && gp < 200)) {
      hints.push({ level: 'warn', text: 'Tarife Zeile ' + row.row + ': Datum, Arbeitspreis (ct/kWh) oder Grundpreis (€/Monat) fehlt/unplausibel – Zeile wird ignoriert.' });
      continue;
    }
    rows.push({ from: from, ap: ap, gp: gp, name: text_(table, row, 'Anbieter') });
  }
  rows.sort((a, b) => (a.from < b.from ? -1 : 1));
  return { tariffs: rows, hints: hints };
}

/** Abschläge: [{from, amount, day}] nach Datum sortiert. */
function readPaymentRows_(ss) {
  const table = readTable_(ss, 'Abschläge');
  requireCols_(table, 'Abschläge', ['Gültig_ab', 'Betrag_EUR']);
  const rows = [];
  const hints = [];
  for (const row of table.rows) {
    const from = parseDateValue_(val_(table, row, 'Gültig_ab'), isoOfDate_);
    const amount = parseNumberDe_(val_(table, row, 'Betrag_EUR'));
    const dayRaw = val_(table, row, 'Fälligkeitstag');
    const day = dayRaw === '' ? 1 : parseNumberDe_(dayRaw);
    if (!from || !(amount >= 0 && amount < 10000) || !(day >= 1 && day <= 31)) {
      hints.push({ level: 'warn', text: 'Abschläge Zeile ' + row.row + ': Datum, Betrag oder Fälligkeitstag (1–31) fehlt/unplausibel – Zeile wird ignoriert.' });
      continue;
    }
    rows.push({ from: from, amount: amount, day: Math.round(day) });
  }
  rows.sort((a, b) => (a.from < b.from ? -1 : 1));
  return { payments: rows, hints: hints };
}

/** Perioden: [{name, start, end}]. */
function readPeriods_(ss) {
  const table = readTable_(ss, 'Perioden');
  requireCols_(table, 'Perioden', ['Name', 'Start', 'Ende']);
  const periods = [];
  const hints = [];
  for (const row of table.rows) {
    const name = text_(table, row, 'Name') || 'Periode Zeile ' + row.row;
    const start = parseDateValue_(val_(table, row, 'Start'), isoOfDate_);
    const end = parseDateValue_(val_(table, row, 'Ende'), isoOfDate_);
    if (!start || !end || end < start) {
      hints.push({ level: 'warn', text: 'Perioden Zeile ' + row.row + ': Start/Ende fehlt oder Ende vor Start – Zeile wird ignoriert.' });
      continue;
    }
    periods.push({ name: name, start: start, end: end });
  }
  periods.sort((a, b) => (a.start < b.start ? -1 : 1));
  return { periods: periods, hints: hints };
}
