/**
 * Store.gs – Lesen und Schreiben im Google Sheet.
 */

function isoOfDate_(d) {
  return Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
}

function sheet_(ss, tabName) {
  const sheet = ss.getSheetByName(tabName);
  if (!sheet) throw apiError_('NOT_CONFIGURED', 'Tab „' + tabName + '“ fehlt – im Sheet „Gaszähler → Einrichten / aktualisieren“ wählen.');
  return sheet;
}

/** Liest einen Tab komplett: { sheet, cols: {Überschrift: Index}, width, rows: [{row, v, d}] }. */
function readTable_(ss, tabName) {
  const sheet = sheet_(ss, tabName);
  const range = sheet.getDataRange();
  const values = range.getValues();
  const display = range.getDisplayValues(); // so, wie du es siehst (Uhrzeit, Texte, Datum)
  const table = { sheet: sheet, cols: {}, width: values[0].length, rows: [] };
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

/** Zellwert nach Typ: null = leer, NaN = ungültig. */
function parseCell_(type, raw, text) {
  if (text === '' && (raw === '' || raw === null)) return null;
  if (type === 'date') return parseDateText_(text) || (isDate_(raw) ? isoOfDate_(raw) : NaN);
  if (type === 'number') return typeof raw === 'number' ? raw : parseNumberDe_(text);
  if (type === 'time') return parseTime_(text);
  return text;
}

/**
 * Liest einen Tab nach Schema: { rows: [{row, <key>: Wert}], hints }. Pflichtfeld fehlt/ungültig → Zeile
 * ignoriert; optionales Feld ungültig → leer. Beides mit Hinweis (nie stilles Verwerfen).
 */
function readRows_(ss, tabName) {
  const def = schema_().find(d => d.name === tabName);
  const table = readTable_(ss, tabName);
  const cols = def.columns.filter(c => c.key && c.type);
  const missing = cols.filter(c => c.required && !(c.name in table.cols)).map(c => c.name);
  if (missing.length) {
    throw apiError_('NOT_CONFIGURED', 'Im Tab „' + tabName + '“ fehlt die Spalte „' + missing.join('“, „') + '“ – „Gaszähler → Einrichten / aktualisieren“ wählen.');
  }
  const rows = [];
  const hints = [];
  for (const r of table.rows) {
    const out = { row: r.row };
    let skip = null;
    for (const c of cols) {
      const i = table.cols[c.name];
      const v = i === undefined ? null : parseCell_(c.type, r.v[i], norm_(r.d[i]));
      const bad = typeof v === 'number' && (isNaN(v) || (c.min !== undefined && v < c.min) || (c.max !== undefined && v > c.max));
      if (bad || (v === null && c.required)) {
        const why = v === null ? 'fehlt' : 'ungültig' + (c.min !== undefined ? ' (erlaubt ' + deRange_(c) + ')' : '');
        if (c.required) {
          skip = c.name + ' ' + why;
          break;
        }
        hints.push({ level: 'warn', text: tabName + ' Zeile ' + r.row + ': ' + c.name + ' ' + why + ' – wird ignoriert.' });
        out[c.key] = null;
      } else {
        out[c.key] = v;
      }
    }
    if (skip) hints.push({ level: 'warn', text: tabName + ' Zeile ' + r.row + ': ' + skip + ' – Zeile wird ignoriert.' });
    else rows.push(out);
  }
  return { rows: rows, hints: hints };
}

function deRange_(c) {
  return String(c.min).replace('.', ',') + '–' + String(c.max).replace('.', ',');
}

const byFrom_ = (a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0);

/** Einstellungen mit Vorgaben: { values: {Schlüssel: Wert}, hints }. */
function readSettings_(ss) {
  const table = readTable_(ss, 'Einstellungen');
  const iKey = table.cols['Schlüssel'];
  const iVal = table.cols['Wert'];
  if (iKey === undefined || iVal === undefined) throw apiError_('NOT_CONFIGURED', 'Tab „Einstellungen“ unvollständig – „Gaszähler → Einrichten / aktualisieren“ wählen.');
  const cells = {};
  for (const r of table.rows) {
    const key = norm_(r.d[iKey]);
    if (key && !(key in cells)) cells[key] = { raw: r.v[iVal], text: norm_(r.d[iVal]) };
  }
  const values = {};
  const hints = [];
  for (const def of settingDefs_()) {
    const cell = cells[def.key];
    const v = cell ? parseCell_(def.type, cell.raw, cell.text) : null;
    if (typeof v === 'number' && isNaN(v)) hints.push({ level: 'warn', text: 'Einstellung „' + def.key + '“ ist ungültig – Vorgabe gilt.' });
    values[def.key] = v === null || (typeof v === 'number' && isNaN(v)) ? def.value : v;
  }
  return { values: values, hints: hints };
}

/** Ablesungen: [{row, date, minutes, t, value, meter, exclude}] + Hinweise. */
function readReadings_(ss) {
  const res = readRows_(ss, 'Ablesungen');
  const readings = res.rows.map(r => ({
    row: r.row,
    date: r.date,
    minutes: r.time,
    t: readingT_(r.date, r.time),
    value: r.value,
    meter: r.meter || '',
    exclude: (r.model || '').toLowerCase() === 'ausschließen',
  }));
  const meters = {};
  readings.forEach(r => (meters[r.meter] = true));
  if ('' in meters && Object.keys(meters).length > 1) {
    res.hints.push({ level: 'warn', text: 'Ablesungen: Zeilen mit und ohne Zählernummer gemischt – Zeiträume dazwischen fehlen. Bitte überall die Nummer eintragen.' });
  }
  return { readings: readings, hints: res.hints };
}

function readSorted_(ss, tabName) {
  const res = readRows_(ss, tabName);
  res.rows.sort(byFrom_);
  return res;
}

/** Perioden: [{name, start, end}] + Hinweise. */
function readPeriods_(ss) {
  const res = readRows_(ss, 'Perioden');
  const periods = [];
  for (const p of res.rows) {
    if (p.end < p.start) {
      res.hints.push({ level: 'warn', text: 'Perioden Zeile ' + p.row + ': Ende liegt vor Start – Zeile wird ignoriert.' });
      continue;
    }
    periods.push({ name: p.name || 'Periode Zeile ' + p.row, start: p.start, end: p.end });
  }
  periods.sort((a, b) => (a.start < b.start ? -1 : 1));
  return { periods: periods, hints: res.hints };
}

/** Wetter als { map: {iso: tm}, last }. */
function readWeather_(ss) {
  const map = {};
  readRows_(ss, 'Wetter').rows.forEach(r => (map[r.date] = r.tm));
  return { map: map, last: Object.keys(map).sort().pop() || null };
}

function writeWeather_(ss, map, station) {
  const now = now_();
  const rows = Object.keys(map)
    .sort()
    .map(iso => [berlinMidnight_(iso), map[iso], 'DWD ' + station, now]);
  writeTable_(ss, 'Wetter', rows);
}

/** Ersetzt alle Datenzeilen eines System-Tabs (Kopfzeile bleibt). */
function writeTable_(ss, tabName, rows) {
  const sheet = sheet_(ss, tabName);
  const width = sheet.getLastColumn();
  const old = sheet.getLastRow();
  if (old > 1) sheet.getRange(2, 1, old - 1, width).clearContent();
  if (!rows.length) return;
  const need = rows.length + 1;
  if (sheet.getMaxRows() < need) sheet.insertRowsAfter(sheet.getMaxRows(), need - sheet.getMaxRows());
  sheet.getRange(2, 1, rows.length, width).setValues(rows.map(r => r.concat(new Array(Math.max(0, width - r.length)).fill('')).slice(0, width)));
}

/**
 * Hängt eine geprüfte Ablesung an und sortiert, falls sie nachgetragen wurde.
 * Rückgabe: Zeilennummer, oder 0, wenn sortiert wurde (Zeilennummern haben sich verschoben).
 */
function appendReading_(ss, r, existing) {
  const table = readTable_(ss, 'Ablesungen');
  const row = new Array(table.width).fill('');
  const put = (name, value) => {
    if (name in table.cols) row[table.cols[name]] = value;
  };
  put('Datum', Utilities.parseDate(r.date, TZ, 'yyyy-MM-dd')); // echtes Datum, Mitternacht Berlin
  put('Uhrzeit', r.minutes === null ? '' : formatTime_(r.minutes));
  put('Stand_m3', r.value);
  put('Zähler', safeText_(r.meter));
  put('Quelle', 'App');
  put('Erfasst_am', now_());
  const sheet = table.sheet;
  const newRow = sheet.getLastRow() + 1;
  sheet.getRange(newRow, 1, 1, row.length).setValues([row]);
  const latest = existing.reduce((m, x) => Math.max(m, x.t), -Infinity);
  if (r.t >= latest) return newRow;
  const col = name => table.cols[name] + 1;
  sheet.getRange(2, 1, newRow - 1, row.length).sort([
    { column: col('Datum'), ascending: true },
    { column: col('Uhrzeit'), ascending: true },
  ]);
  return 0;
}

/** Schreibt ins Protokoll (rollierend, höchstens ~600 Zeilen). Fehler hier lassen nie die Anfrage scheitern. */
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
