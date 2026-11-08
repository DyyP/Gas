// Gaszähler – Backend (Google Apps Script)
// GENERIERT aus apps-script/src/ mit `node tools/bundle.mjs` – nicht hier bearbeiten.
// Einfügen: Erweiterungen → Apps Script → Datei „Code.gs“ komplett ersetzen.

// ===== Util.gs =====

/**
 * Util.gs – reine Hilfsfunktionen ohne Apps-Script-Dienste (in Node testbar).
 *
 * Regel für alle Dateien: Auf oberster Ebene nur Funktionen und Literal-Konstanten,
 * keine Abhängigkeiten zwischen Dateien beim Laden.
 */

const API_VERSION = 1;
const SCHEMA_VERSION = 1;
const TZ = 'Europe/Berlin';
const MIN_DATE = '2000-01-01';
const DEFAULT_MINUTES = 12 * 60; // Ablesung ohne Uhrzeit gilt als 12:00

/** Aktueller Zeitpunkt – eigene Funktion, damit Tests die Zeit festlegen können. */
function now_() {
  return new Date();
}

function isDate_(v) {
  return Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime());
}

/** true für echte Kalenderdaten im Format JJJJ-MM-TT (also nicht 2026-02-30). */
function isIsoDate_(s) {
  if (typeof s !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return false;
  return d <= daysInMonth_(y, mo);
}

function isLeapYear_(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function daysInMonth_(y, m) {
  return [31, isLeapYear_(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

/**
 * Tagesnummer (Tage seit 1970-01-01) eines ISO-Datums. Rechnet über UTC und ist damit
 * unabhängig von Sommerzeit. setUTCFullYear statt Date.UTC, weil Date.UTC die Jahre
 * 0–99 als 1900–1999 deutet.
 */
function dayNumber_(iso) {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  const dt = new Date(0);
  dt.setUTCFullYear(y, m - 1, d);
  return Math.round(dt.getTime() / 86400000);
}

function isoFromDayNumber_(n) {
  return new Date(n * 86400000).toISOString().slice(0, 10);
}

/** 'HH:MM' → Minuten seit Mitternacht; leer → null; ungültig → NaN. */
function parseTime_(s) {
  if (s === null || s === undefined) return null;
  const t = String(s).trim();
  if (t === '') return null;
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(t);
  if (!m) return NaN;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return NaN;
  return h * 60 + min;
}

function formatTime_(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
}

/** Zeitpunkt einer Ablesung als gebrochene Tagesnummer. */
function readingT_(iso, minutes) {
  return dayNumber_(iso) + (minutes === null || minutes === undefined ? DEFAULT_MINUTES : minutes) / 1440;
}

/**
 * Zahl aus Sheet oder Eingabe: akzeptiert Zahlen und Texte wie „2057,01“, „2.057,01“, „2057.01“.
 * Gibt NaN zurück, wenn es keine Zahl ist.
 */
function parseNumberDe_(v) {
  if (typeof v === 'number') return isFinite(v) ? v : NaN;
  if (typeof v !== 'string') return NaN;
  let s = v.replace(/[\s  ]/g, '');
  if (s === '') return NaN;
  if (s.indexOf(',') >= 0 && s.indexOf('.') >= 0) s = s.replace(/\./g, '');
  s = s.replace(',', '.');
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return NaN;
  return Number(s);
}

/** Datum aus Sheet-Zelle oder Text (TT.MM.JJJJ, T.M.JJJJ, JJJJ-MM-TT) → ISO oder null. */
function parseDateValue_(v, formatDateFn) {
  if (isDate_(v)) return formatDateFn(v);
  if (typeof v !== 'string') return null;
  const s = v.trim();
  let m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s);
  if (m) {
    const iso = m[3] + '-' + pad2_(Number(m[2])) + '-' + pad2_(Number(m[1]));
    return isIsoDate_(iso) ? iso : null;
  }
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return isIsoDate_(s) ? s : null;
  return null;
}

function pad2_(n) {
  return (n < 10 ? '0' : '') + n;
}

function round_(x, digits) {
  const f = Math.pow(10, digits);
  return Math.round(x * f) / f;
}

/** Vergleich in konstanter Zeit (gegen Zeitmessungs-Angriffe, schadet nie). */
function safeEqual_(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/** JJJJ-MM-TT → TT.MM.JJJJ */
function deDate_(iso) {
  return iso.slice(8, 10) + '.' + iso.slice(5, 7) + '.' + iso.slice(0, 4);
}

/** Zahl mit Komma und fester Anzahl Nachkommastellen (für Meldungen). */
function deNum_(x, digits) {
  return x.toFixed(digits).replace('.', ',');
}

/** Fehler mit Code für die API-Antwort. */
function apiError_(code, message, details) {
  const err = new Error(message);
  err.code = code;
  if (details) err.details = details;
  return err;
}

/** Text, der in eine Zelle geschrieben wird, nie als Formel deuten lassen. */
function safeText_(s) {
  const t = String(s);
  return /^[=+\-@]/.test(t) ? "'" + t : t;
}

/** Text normalisieren (Überschriften, Schlüssel): trimmen, Unicode NFC. */
function norm_(s) {
  return String(s === null || s === undefined ? '' : s).trim().normalize('NFC');
}

// ===== Schema.gs =====

/**
 * Schema.gs – Aufbau des Sheets (Tabs, Spalten, Formate, Vorgaben). Reine Daten.
 *
 * Spalten werden über die Überschrift gefunden, nicht über die Position. setup() legt
 * fehlende Tabs und Spalten an und lässt vorhandene Daten unangetastet.
 */

function schema_() {
  const DATE = 'dd.mm.yyyy';
  const TEXT = '@';
  return [
    {
      name: 'Ablesungen',
      columns: [
        { name: 'Datum', format: DATE },
        { name: 'Uhrzeit', format: TEXT },
        { name: 'Stand_m3', format: '0.000' },
        { name: 'Zähler', format: TEXT },
        { name: 'Quelle', format: TEXT, list: ['App', 'Sheet', 'Übergabe', 'Rechnung'] },
        { name: 'Modell', format: TEXT, list: ['ausschließen'] },
        { name: 'ID', format: TEXT },
        { name: 'Erfasst_am', format: 'dd.mm.yyyy hh:mm' },
        { name: 'Notiz', format: TEXT },
      ],
    },
    {
      name: 'Tarife',
      columns: [
        { name: 'Gültig_ab', format: DATE },
        { name: 'Arbeitspreis_ct_kWh', format: '0.00' },
        { name: 'Grundpreis_EUR_Monat', format: '0.00' },
        { name: 'Anbieter', format: TEXT },
        { name: 'Tarif', format: TEXT },
        { name: 'Notiz', format: TEXT },
      ],
    },
    {
      name: 'Umrechnung',
      columns: [
        { name: 'Gültig_ab', format: DATE },
        { name: 'Brennwert_kWh_m3', format: '0.000' },
        { name: 'Zustandszahl', format: '0.0000' },
        { name: 'Status', format: TEXT, list: ['Schätzung', 'Rechnung'] },
        { name: 'Notiz', format: TEXT },
      ],
    },
    {
      name: 'Abschläge',
      columns: [
        { name: 'Gültig_ab', format: DATE },
        { name: 'Betrag_EUR', format: '0.00' },
        { name: 'Fälligkeitstag', format: '0' },
        { name: 'Notiz', format: TEXT },
      ],
    },
    {
      name: 'Perioden',
      columns: [
        { name: 'Name', format: TEXT },
        { name: 'Start', format: DATE },
        { name: 'Ende', format: DATE },
        { name: 'Notiz', format: TEXT },
      ],
    },
    {
      name: 'Einstellungen',
      columns: [
        { name: 'Schlüssel', format: TEXT },
        { name: 'Wert' },
        { name: 'Beschreibung', format: TEXT },
      ],
    },
    {
      name: 'Protokoll',
      system: true,
      columns: [
        { name: 'Zeit', format: 'dd.mm.yyyy hh:mm:ss' },
        { name: 'Ebene', format: TEXT },
        { name: 'Ereignis', format: TEXT },
        { name: 'Details', format: TEXT },
      ],
    },
  ];
}

/**
 * Einstellungen mit Typ und Vorgabe. Fehlende Schlüssel ergänzt setup(); vorhandene Werte
 * bleiben, wie du sie gesetzt hast.
 */
function settingDefs_() {
  return [
    { key: 'Mindestdatum', type: 'date', value: '', text: 'Frühestes erlaubtes Ablesedatum (z. B. Einzug), leer = keine Grenze' },
    { key: 'Zähler_aktuell', type: 'text', value: '', text: 'Zählernummer für neue Ablesungen aus der App (leer = ein Zähler)' },
    { key: 'Plausi_max_m3_pro_Tag', type: 'number', value: 20, text: 'Ab diesem Verbrauch pro Tag fragt die App nach' },
    { key: 'Platzhalter_Zustandszahl', type: 'number', value: 0.96, text: 'Gilt, solange der Tab „Umrechnung“ leer ist' },
    { key: 'Platzhalter_Brennwert_kWh_m3', type: 'number', value: 11.3, text: 'Gilt, solange der Tab „Umrechnung“ leer ist' },
  ];
}

// ===== Domain.gs =====

/**
 * Domain.gs – Fachlogik für Ablesungen (rein, in Node testbar).
 *
 * Eine Ablesung: { row, date: 'JJJJ-MM-TT', minutes: Zahl|null, t, value, meter, source, exclude, id }
 * t = gebrochene Tagesnummer (Datum + Uhrzeit; ohne Uhrzeit 12:00).
 */

/** Prüft die Eingabe aus der App auf Form und Typ und normalisiert sie. */
function normalizeReadingInput_(input, defaultMeter) {
  if (!input || typeof input !== 'object') throw apiError_('BAD_REQUEST', 'Ablesung fehlt');
  const id = input.id === undefined || input.id === null ? '' : input.id;
  if (typeof id !== 'string' || (id !== '' && !/^[A-Za-z0-9-]{8,64}$/.test(id))) {
    throw apiError_('BAD_REQUEST', 'Ungültige ID');
  }
  if (!isIsoDate_(input.date)) throw apiError_('VALIDATION', 'Ungültiges Datum');
  const minutes = parseTime_(input.time);
  if (typeof minutes === 'number' && isNaN(minutes)) throw apiError_('VALIDATION', 'Ungültige Uhrzeit');
  const value = input.value;
  if (typeof value !== 'number' || !isFinite(value) || value < 0 || value >= 1e7) {
    throw apiError_('VALIDATION', 'Ungültiger Zählerstand');
  }
  const meter = input.meter === undefined || input.meter === null ? defaultMeter : input.meter;
  // Enger Zeichensatz: landet als Text im Sheet (keine Formeln wie „=…“ einschleusbar)
  if (typeof meter !== 'string' || !/^[A-Za-z0-9 ._\/-]{0,40}$/.test(meter)) throw apiError_('BAD_REQUEST', 'Ungültige Zählernummer');
  return {
    id: id,
    date: input.date,
    minutes: minutes,
    t: readingT_(input.date, minutes),
    value: round_(value, 3), // Zähler zeigt 3 Nachkommastellen
    meter: norm_(meter),
    confirmed: input.confirmed === true,
  };
}

/**
 * Entscheidet, ob eine neue Ablesung gespeichert wird.
 * ctx: { today, minDate, maxPerDay }
 * Rückgabe { status: 'new' | 'duplicate' } oder wirft VALIDATION / CONFLICT / PLAUSIBILITY.
 */
function checkNewReading_(r, readings, ctx) {
  const same = readings.filter(x => x.meter === r.meter);
  const close = (a, b) => Math.abs(a - b) < 0.0005;

  // Zuerst Duplikate: Wiederholtes Senden muss immer gutgehen, auch wenn sich Regeln geändert haben.
  if (r.id) {
    const byId = readings.find(x => x.id === r.id);
    if (byId) {
      if (byId.date === r.date && close(byId.value, r.value)) return { status: 'duplicate' };
      throw apiError_('CONFLICT', 'Diese Ablesung wurde schon mit anderen Werten gespeichert.');
    }
  }
  const sameDay = same.find(x => x.date === r.date);
  if (sameDay) {
    if (close(sameDay.value, r.value)) return { status: 'duplicate' };
    throw apiError_(
      'CONFLICT',
      'Für den ' + deDate_(r.date) + ' gibt es schon den Stand ' + deNum_(sameDay.value, 3) + ' m³. Korrektur bitte im Sheet.',
      { date: r.date, existing: sameDay.value }
    );
  }

  const lower = ctx.minDate && ctx.minDate > MIN_DATE ? ctx.minDate : MIN_DATE;
  if (r.date < lower) throw apiError_('VALIDATION', 'Datum liegt vor dem ' + deDate_(lower));
  if (r.date > ctx.today) throw apiError_('VALIDATION', 'Datum liegt in der Zukunft');

  const sorted = same.slice().sort((a, b) => a.t - b.t);
  let before = null;
  let after = null;
  for (const x of sorted) {
    if (x.t < r.t) before = x;
    else if (!after) after = x;
  }
  if (before && r.value < before.value) {
    throw apiError_('VALIDATION', 'Stand ist kleiner als am ' + deDate_(before.date) + ' (' + deNum_(before.value, 3) + ' m³)');
  }
  if (after && r.value > after.value) {
    throw apiError_('VALIDATION', 'Stand ist größer als am ' + deDate_(after.date) + ' (' + deNum_(after.value, 3) + ' m³)');
  }

  if (!r.confirmed && ctx.maxPerDay > 0) {
    // Mindestens 1 Stunde Abstand ansetzen, sonst wird die Rate bei Ablesungen um Mitternacht künstlich riesig
    const gap = dt => Math.max(dt, 1 / 24);
    const checks = [];
    if (before) checks.push({ ref: before, perDay: (r.value - before.value) / gap(r.t - before.t) });
    if (after) checks.push({ ref: after, perDay: (after.value - r.value) / gap(after.t - r.t) });
    for (const c of checks) {
      if (c.perDay > ctx.maxPerDay) {
        throw apiError_(
          'PLAUSIBILITY',
          'Das wären ' + deNum_(c.perDay, 1) + ' m³ pro Tag seit dem ' + deDate_(c.ref.date) + ' – ungewöhnlich viel. Stimmt der Wert?',
          { perDay: round_(c.perDay, 2), maxPerDay: ctx.maxPerDay, refDate: c.ref.date }
        );
      }
    }
  }
  return { status: 'new' };
}

/**
 * Bereinigt die Ablesungen aus dem Sheet: sortiert, entfernt doppelte Tage und meldet
 * Auffälligkeiten. Rückgabe { readings, hints }.
 */
function cleanReadings_(readings) {
  const hints = [];
  const sorted = readings.slice().sort((a, b) => (a.meter < b.meter ? -1 : a.meter > b.meter ? 1 : a.t - b.t || a.row - b.row));
  const out = [];
  for (const r of sorted) {
    const prev = out.length ? out[out.length - 1] : null;
    if (prev && prev.meter === r.meter && prev.date === r.date) {
      hints.push({
        level: 'warn',
        text: 'Ablesungen Zeile ' + prev.row + ' und ' + r.row + ': zwei Stände am ' + deDate_(r.date) + ' – nur Zeile ' + prev.row + ' zählt.',
      });
      continue;
    }
    out.push(r);
  }
  return { readings: out, hints: hints };
}

/** Umrechnungsfaktor kWh/m³ für ein Datum: letzte Zeile mit Gültig_ab ≤ Datum, sonst Platzhalter. */
function conversionAt_(conversions, iso, placeholder) {
  let hit = null;
  for (const c of conversions) if (c.from <= iso && (!hit || c.from >= hit.from)) hit = c;
  if (!hit) return { factor: placeholder.z * placeholder.hs, source: 'Platzhalter' };
  return { factor: hit.z * hit.hs, source: hit.status || 'Tabelle' };
}

/**
 * Intervalle zwischen aufeinanderfolgenden Ablesungen desselben Zählers.
 * Rückgabe { intervals (neueste zuerst), hints }.
 */
function buildIntervals_(readings, conversions, placeholder) {
  const hints = [];
  const intervals = [];
  for (let i = 1; i < readings.length; i++) {
    const a = readings[i - 1];
    const b = readings[i];
    if (a.meter !== b.meter) continue;
    const days = b.t - a.t;
    const m3 = round_(b.value - a.value, 3);
    if (m3 < 0) {
      hints.push({
        level: 'warn',
        text: 'Ablesungen Zeile ' + b.row + ': Stand am ' + deDate_(b.date) + ' ist kleiner als am ' + deDate_(a.date) + ' – Zeitraum wird ignoriert.',
      });
      continue;
    }
    const conv = conversionAt_(conversions, b.date, placeholder);
    intervals.push({
      from: a.date,
      to: b.date,
      fromTime: a.minutes === null ? null : formatTime_(a.minutes),
      toTime: b.minutes === null ? null : formatTime_(b.minutes),
      meter: b.meter,
      days: round_(days, 3),
      m3: m3,
      m3PerDay: round_(m3 / days, 4),
      kWh: round_(m3 * conv.factor, 1),
      kWhPerDay: round_((m3 * conv.factor) / days, 2),
      conversion: conv.source,
      excluded: b.exclude === true,
    });
  }
  intervals.reverse();
  return { intervals: intervals, hints: hints };
}

// ===== Store.gs =====

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

// ===== Overview.gs =====

/**
 * Overview.gs – Übersicht für die App (letzter Stand, Intervalle, Hinweise).
 */

function buildOverview_(ss) {
  const now = now_();
  const today = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');
  const settings = readSettings_(ss);
  const s = settings.values;
  const raw = readReadings_(ss);
  const conv = readConversions_(ss);
  const cleaned = cleanReadings_(raw.readings);
  const placeholder = { z: s.Platzhalter_Zustandszahl, hs: s.Platzhalter_Brennwert_kWh_m3 };
  const iv = buildIntervals_(cleaned.readings, conv.conversions, placeholder);

  const hints = [].concat(settings.hints, raw.hints, conv.hints, cleaned.hints, iv.hints);
  const readings = cleaned.readings;
  if (!readings.length) hints.push({ level: 'info', text: 'Noch keine Ablesung gespeichert.' });
  if (iv.intervals.some(i => i.conversion === 'Platzhalter')) {
    hints.push({
      level: 'info',
      text: 'kWh mit Platzhalter (Zustandszahl ' + deNum_(placeholder.z, 4) + ' × Brennwert ' + deNum_(placeholder.hs, 3) +
        ') – echte Werte aus der Rechnung im Tab „Umrechnung“ eintragen.',
    });
  }

  let last = null;
  for (const r of readings) if (!last || r.t > last.t) last = r;

  return {
    generatedAt: now.toISOString(),
    today: today,
    api: API_VERSION,
    schema: SCHEMA_VERSION,
    settings: {
      minDate: s.Mindestdatum || MIN_DATE,
      maxPerDay: s.Plausi_max_m3_pro_Tag,
      meter: s.Zähler_aktuell,
    },
    last: last
      ? { date: last.date, time: last.minutes === null ? null : formatTime_(last.minutes), value: last.value, meter: last.meter }
      : null,
    readingsCount: readings.length,
    intervals: iv.intervals,
    hints: hints,
  };
}

// ===== Api.gs =====

/**
 * Api.gs – Web-App-Schnittstelle.
 *
 *   GET  …/exec  → Lebenszeichen ohne Daten
 *   POST …/exec  → Body (text/plain, JSON): { v, key, action, … }
 *        action "overview"   → { ok, v, data: { overview } }
 *        action "addReading" → { ok, v, data: { saved: "new"|"duplicate", overview } }
 *   Fehler       → { ok: false, v, error: { code, message, details? } }
 *   Codes: BAD_REQUEST, NOT_CONFIGURED, AUTH, VALIDATION, CONFLICT, PLAUSIBILITY, BUSY, SERVER
 *
 * Die API kann nur lesen und Ablesungen anhängen – nie ändern oder löschen.
 */

const MAX_BODY = 4096;

function doGet() {
  return json_({ ok: true, v: API_VERSION, service: 'gaszaehler' });
}

function doPost(e) {
  return json_(handlePost_(e));
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function handlePost_(e) {
  let authed = false;
  let ss = null;
  try {
    const body = parseBody_(e);
    const props = PropertiesService.getScriptProperties().getProperties();
    if (!props.KEY || !props.SHEET_ID) {
      throw apiError_('NOT_CONFIGURED', 'Server ist noch nicht eingerichtet – im Sheet „Gaszähler → Einrichten / aktualisieren“ wählen.');
    }
    if (!safeEqual_(body.key, props.KEY)) {
      noteAuthFailure_(props.SHEET_ID);
      throw apiError_('AUTH', 'Falscher Schlüssel');
    }
    authed = true;
    ss = SpreadsheetApp.openById(props.SHEET_ID);
    if (body.action === 'overview') return ok_({ overview: buildOverview_(ss) });
    if (body.action === 'addReading') return ok_(addReadingAction_(ss, body.reading));
    throw apiError_('BAD_REQUEST', 'Unbekannte Aktion');
  } catch (err) {
    if (err && err.code) return fail_(err.code, err.message, err.details);
    // Unerwarteter Fehler: vor der Anmeldung nichts verraten, danach Meldung zeigen und protokollieren.
    if (!authed) return fail_('SERVER', 'Serverfehler');
    if (ss) logEvent_(ss, 'FEHLER', 'api', (err && err.stack) || String(err));
    return fail_('SERVER', 'Serverfehler: ' + ((err && err.message) || String(err)));
  }
}

function parseBody_(e) {
  const contents = e && e.postData && typeof e.postData.contents === 'string' ? e.postData.contents : null;
  if (contents === null) throw apiError_('BAD_REQUEST', 'Leere Anfrage');
  if (contents.length > MAX_BODY) throw apiError_('BAD_REQUEST', 'Anfrage zu groß');
  let body;
  try {
    body = JSON.parse(contents);
  } catch (x) {
    throw apiError_('BAD_REQUEST', 'Anfrage ist kein JSON');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw apiError_('BAD_REQUEST', 'Anfrage ist kein Objekt');
  if (body.v !== API_VERSION) throw apiError_('BAD_REQUEST', 'API-Version passt nicht – App bitte neu laden.');
  return body;
}

function ok_(data) {
  return { ok: true, v: API_VERSION, data: data };
}

function fail_(code, message, details) {
  const error = { code: code, message: message };
  if (details) error.details = details;
  return { ok: false, v: API_VERSION, error: error };
}

/** Speichert eine Ablesung unter Sperre (keine zwei Schreibvorgänge gleichzeitig). */
function addReadingAction_(ss, input) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw apiError_('BUSY', 'Server ist gerade beschäftigt – bitte gleich nochmal.');
  try {
    const settings = readSettings_(ss).values;
    const r = normalizeReadingInput_(input, settings.Zähler_aktuell);
    const existing = readReadings_(ss).readings;
    const today = Utilities.formatDate(now_(), TZ, 'yyyy-MM-dd');
    const res = checkNewReading_(r, existing, {
      today: today,
      minDate: settings.Mindestdatum,
      maxPerDay: settings.Plausi_max_m3_pro_Tag,
    });
    if (res.status === 'new') {
      appendReading_(ss, r, existing);
      SpreadsheetApp.flush(); // laut Doku vor dem Freigeben der Sperre
    }
    return { saved: res.status, overview: buildOverview_(ss) };
  } finally {
    lock.releaseLock();
  }
}

/** Zählt falsche Schlüssel pro Stunde und protokolliert bei 1, 10, 100, 1000 Versuchen. */
function noteAuthFailure_(sheetId) {
  try {
    const cache = CacheService.getScriptCache();
    const hourKey = 'authfail-' + Utilities.formatDate(now_(), TZ, 'yyyyMMddHH');
    const n = Number(cache.get(hourKey) || 0) + 1;
    cache.put(hourKey, String(n), 7200);
    if ([1, 10, 100, 1000].indexOf(n) >= 0 && sheetId) {
      logEvent_(SpreadsheetApp.openById(sheetId), 'WARN', 'auth', n + ' falsche(r) Schlüssel in dieser Stunde');
    }
  } catch (x) {
    console.error('Zählung fehlgeschlagen: ' + x);
  }
}

// ===== Setup.gs =====

/**
 * Setup.gs – Einrichtung, Migration, Menü im Sheet, Schlüsselverwaltung.
 *
 * setup() ist idempotent: mehrfach ausführen schadet nie. Es legt fehlende Tabs, Spalten und
 * Einstellungen an, ändert aber keine vorhandenen Daten.
 */

/** Einmalig (und nach jedem Update) im Skript-Editor ausführen. */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error('Kein Sheet gefunden: Das Skript muss aus dem Sheet heraus angelegt sein (Erweiterungen → Apps Script).');
  }
  ss.setSpreadsheetTimeZone(TZ);
  ss.setSpreadsheetLocale('de_DE');
  const report = ensureSchema_(ss);

  const props = PropertiesService.getScriptProperties();
  const oldId = props.getProperty('SHEET_ID');
  if (oldId && oldId !== ss.getId()) report.push('Verknüpfung auf dieses Sheet umgestellt');
  props.setProperty('SHEET_ID', ss.getId());
  const newKey = !props.getProperty('KEY');
  if (newKey) props.setProperty('KEY', newKey_());
  props.setProperty('SCHEMA', String(SCHEMA_VERSION));

  logEvent_(ss, 'INFO', 'setup', report.length ? report.join('; ') : 'alles aktuell');
  const lines = ['Einrichtung abgeschlossen (Schema ' + SCHEMA_VERSION + ').'];
  if (report.length) lines.push(report.join('\n'));
  if (newKey) lines.push('Neuer Schlüssel für die App: ' + props.getProperty('KEY'));
  else lines.push('Schlüssel unverändert – anzeigen über „Gaszähler → Schlüssel anzeigen“.');
  const text = lines.join('\n\n');
  Logger.log(text);
  showAlert_('Gaszähler', text);
}

/** Legt fehlende Tabs/Spalten/Einstellungen an. Rückgabe: Liste der Änderungen. */
function ensureSchema_(ss) {
  const report = [];
  const defs = schema_();
  const names = defs.map(d => d.name);
  for (const def of defs) {
    let sheet = ss.getSheetByName(def.name);
    if (!sheet) {
      const sheets = ss.getSheets();
      const first = sheets[0];
      const reusable = sheets.length === 1 && names.indexOf(first.getName()) < 0 && first.getLastRow() === 0 && first.getLastColumn() === 0;
      sheet = reusable ? first.setName(def.name) : ss.insertSheet(def.name);
      report.push('Tab „' + def.name + '“ angelegt');
    }
    const lastCol = sheet.getLastColumn();
    const header = lastCol ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(norm_) : [];
    for (const col of def.columns) {
      if (header.indexOf(col.name) >= 0) continue; // vorhandene Spalten (und deine Formate) bleiben unberührt
      const idx = header.length;
      header.push(col.name);
      sheet.getRange(1, idx + 1).setValue(col.name);
      const rows = sheet.getMaxRows() - 1;
      if (rows > 0) {
        const range = sheet.getRange(2, idx + 1, rows, 1);
        if (col.format) range.setNumberFormat(col.format);
        if (col.list) {
          range.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(col.list, true).setAllowInvalid(false).build());
        }
      }
      if (lastCol) report.push('Spalte „' + col.name + '“ in „' + def.name + '“ ergänzt');
    }
    sheet.getRange(1, 1, 1, header.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
    if (def.system && sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET).length === 0) {
      sheet.protect().setDescription('Wird vom Skript geschrieben – bitte nicht bearbeiten').setWarningOnly(true);
    }
  }

  const settings = ss.getSheetByName('Einstellungen');
  const known = {};
  if (settings.getLastRow() > 1) {
    settings.getRange(2, 1, settings.getLastRow() - 1, 1).getValues().forEach(r => (known[norm_(r[0])] = true));
  }
  for (const def of settingDefs_()) {
    if (known[def.key]) continue;
    settings.appendRow([def.key, def.value, def.text]);
    report.push('Einstellung „' + def.key + '“ ergänzt');
  }
  return report;
}

function newKey_() {
  // java.util.UUID.randomUUID(): 122 Zufallsbit
  return Utilities.getUuid().replace(/-/g, '');
}

/** Neuer Schlüssel – danach müssen alle Geräte ihn neu eingeben. */
function rotateKey() {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('KEY', newKey_());
  const id = props.getProperty('SHEET_ID');
  if (id) logEvent_(SpreadsheetApp.openById(id), 'INFO', 'rotateKey', 'Neuer Schlüssel erzeugt');
  Logger.log('Neuer Schlüssel: ' + props.getProperty('KEY'));
  return props.getProperty('KEY');
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Gaszähler')
    .addItem('Daten prüfen', 'menuCheck')
    .addItem('Schlüssel anzeigen', 'menuShowKey')
    .addSeparator()
    .addItem('Einrichten / aktualisieren', 'setup')
    .addItem('Neuen Schlüssel erzeugen …', 'menuRotateKey')
    .addToUi();
}

function menuCheck() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const o = buildOverview_(ss);
  const lines = [
    o.readingsCount + ' Ablesung(en), ' + o.intervals.length + ' Zeitraum/Zeiträume.',
    o.last ? 'Letzter Stand: ' + deNum_(o.last.value, 3) + ' m³ am ' + deDate_(o.last.date) : '',
  ];
  const hints = o.hints.filter(h => h.level === 'warn');
  lines.push(hints.length ? 'Auffälligkeiten:\n• ' + hints.map(h => h.text).join('\n• ') : 'Keine Auffälligkeiten.');
  showAlert_('Daten prüfen', lines.filter(Boolean).join('\n\n'));
}

function menuShowKey() {
  const key = PropertiesService.getScriptProperties().getProperty('KEY');
  showAlert_('Schlüssel für die App', key ? key : 'Noch kein Schlüssel – zuerst „Einrichten / aktualisieren“ wählen.');
}

function menuRotateKey() {
  const ui = SpreadsheetApp.getUi();
  const answer = ui.alert('Neuen Schlüssel erzeugen?', 'Der alte Schlüssel wird sofort ungültig. Alle Geräte müssen den neuen eingeben.', ui.ButtonSet.YES_NO);
  if (answer !== ui.Button.YES) return;
  ui.alert('Neuer Schlüssel für die App', rotateKey(), ui.ButtonSet.OK);
}

/** Meldung im Sheet anzeigen, falls möglich (im Editor gibt es keine Oberfläche → nur Protokoll). */
function showAlert_(title, text) {
  try {
    const ui = SpreadsheetApp.getUi();
    ui.alert(title, text, ui.ButtonSet.OK);
  } catch (e) {
    // Aufruf aus dem Editor: Text steht im Ausführungsprotokoll.
  }
}
