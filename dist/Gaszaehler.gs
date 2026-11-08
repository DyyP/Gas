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
const SCHEMA_VERSION = 4;
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

/** Datum als Text (TT.MM.JJJJ, T.M.JJJJ, JJJJ-MM-TT) → ISO oder null. */
function parseDateText_(s) {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s);
  const iso = m ? m[3] + '-' + pad2_(Number(m[2])) + '-' + pad2_(Number(m[1])) : s;
  return isIsoDate_(iso) ? iso : null;
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
 * Schema.gs – Aufbau des Sheets: Tabs, Spalten, Formate, Typen und Prüfregeln. Reine Daten.
 *
 * Einzige Stelle, an der Spalten definiert sind: setup() legt sie an, readRows_() liest und prüft sie.
 * Spalten mit `key` werden gelesen (type: date | number | text | time); `required` fehlt/ungültig → Zeile
 * wird mit Hinweis ignoriert; optional ungültig → Hinweis, Wert leer. Gefunden wird über die Überschrift.
 */

function schema_() {
  const DATE = 'dd.mm.yyyy';
  const TEXT = '@';
  const STAMP = 'dd.mm.yyyy hh:mm';
  return [
    {
      name: 'Ablesungen',
      columns: [
        { name: 'Datum', key: 'date', type: 'date', required: true, format: DATE },
        { name: 'Uhrzeit', key: 'time', type: 'time', format: TEXT },
        { name: 'Stand_m3', key: 'value', type: 'number', required: true, min: 0, max: 9999999, format: '0.000' },
        { name: 'Zähler', key: 'meter', type: 'text', format: TEXT },
        { name: 'Quelle', key: 'source', type: 'text', format: TEXT, list: ['App', 'Sheet', 'Übergabe', 'Rechnung'] },
        { name: 'Modell', key: 'model', type: 'text', format: TEXT, list: ['ausschließen'] },
        { name: 'Erfasst_am', format: STAMP },
        { name: 'Notiz', format: TEXT },
      ],
    },
    {
      name: 'Tarife',
      columns: [
        { name: 'Gültig_ab', key: 'from', type: 'date', required: true, format: DATE },
        { name: 'Arbeitspreis_ct_kWh', key: 'ap', type: 'number', required: true, min: 0.01, max: 100, format: '0.00' },
        { name: 'Grundpreis_EUR_Monat', key: 'gp', type: 'number', required: true, min: 0, max: 200, format: '0.00' },
        { name: 'Anbieter', key: 'name', type: 'text', format: TEXT },
        { name: 'Tarif', format: TEXT },
        { name: 'Notiz', format: TEXT },
      ],
    },
    {
      name: 'Umrechnung',
      columns: [
        { name: 'Gültig_ab', key: 'from', type: 'date', required: true, format: DATE },
        { name: 'Brennwert_kWh_m3', key: 'hs', type: 'number', required: true, min: 8, max: 13, format: '0.000' },
        { name: 'Zustandszahl', key: 'z', type: 'number', required: true, min: 0.8, max: 1.1, format: '0.0000' },
        { name: 'Status', key: 'status', type: 'text', format: TEXT, list: ['Schätzung', 'Rechnung'] },
        { name: 'Notiz', format: TEXT },
      ],
    },
    {
      name: 'Abschläge',
      columns: [
        { name: 'Gültig_ab', key: 'from', type: 'date', required: true, format: DATE },
        { name: 'Betrag_EUR', key: 'amount', type: 'number', required: true, min: 0, max: 9999, format: '0.00' },
        { name: 'Fälligkeitstag', key: 'day', type: 'number', min: 1, max: 31, format: '0' },
        { name: 'Notiz', format: TEXT },
      ],
    },
    {
      name: 'Perioden',
      columns: [
        { name: 'Name', key: 'name', type: 'text', format: TEXT },
        { name: 'Start', key: 'start', type: 'date', required: true, format: DATE },
        { name: 'Ende', key: 'end', type: 'date', required: true, format: DATE },
        { name: 'Notiz', format: TEXT },
      ],
    },
    {
      name: 'Einstellungen',
      columns: [
        { name: 'Schlüssel', key: 'key', type: 'text', required: true, format: TEXT },
        { name: 'Wert', key: 'value' }, // Typ je Einstellung, siehe settingDefs_()
        { name: 'Beschreibung', format: TEXT },
      ],
    },
    {
      name: 'Wetter',
      system: true,
      columns: [
        { name: 'Datum', key: 'date', type: 'date', required: true, format: 'yyyy-mm-dd' },
        { name: 'Tm_C', key: 'tm', type: 'number', required: true, min: -50, max: 50, format: '0.0' },
        { name: 'Quelle', format: TEXT },
        { name: 'Abgerufen_am', format: STAMP },
      ],
    },
    {
      name: 'Tage',
      system: true,
      columns: [
        { name: 'Datum', format: DATE },
        { name: 'Tm_C', format: '0.0' },
        { name: 'Temp_Quelle', format: TEXT },
        { name: 'HGT', format: '0.0' },
        { name: 'G20_15', format: '0.0' },
        { name: 'HGT_Normal', format: '0.0' },
        { name: 'm3', format: '0.000' },
        { name: 'kWh', format: '0.0' },
        { name: 'Abgedeckt', format: '0%' },
        { name: 'Arbeitspreis_ct', format: '0.00' },
        { name: 'Kosten_Arbeit_EUR', format: '0.00' },
        { name: 'Kosten_Grund_EUR', format: '0.00' },
        { name: 'Kosten_EUR', format: '0.00' },
      ],
    },
    {
      name: 'Monate',
      system: true,
      columns: [
        { name: 'Monat', format: TEXT },
        { name: 'Tage', format: '0' },
        { name: 'HGT', format: '0.0' },
        { name: 'HGT_Normal', format: '0.0' },
        { name: 'm3', format: '0.000' },
        { name: 'kWh', format: '0.0' },
        { name: 'Kosten_EUR', format: '0.00' },
        { name: 'Abgedeckt', format: '0%' },
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

/** Einstellungen mit Typ und Vorgabe. Fehlende ergänzt setup(); vorhandene Werte bleiben. */
function settingDefs_() {
  return [
    { key: 'Mindestdatum', type: 'date', value: '', text: 'Frühestes erlaubtes Ablesedatum (z. B. Einzug), leer = keine Grenze' },
    { key: 'Zähler_aktuell', type: 'text', value: '', text: 'Zählernummer für neue Ablesungen aus der App (leer = ein Zähler)' },
    { key: 'Plausi_max_m3_pro_Tag', type: 'number', value: 20, text: 'Ab diesem Verbrauch pro Tag fragt die App nach' },
    { key: 'Platzhalter_Zustandszahl', type: 'number', value: 0.96, text: 'Gilt, solange der Tab „Umrechnung“ leer ist' },
    { key: 'Platzhalter_Brennwert_kWh_m3', type: 'number', value: 11.3, text: 'Gilt, solange der Tab „Umrechnung“ leer ist' },
    { key: 'DWD_Station', type: 'text', value: '05906', text: 'DWD-Stationsnummer (05906 = Mannheim)' },
    { key: 'Wetter_ab', type: 'date', value: '2020-01-01', text: 'Wetterdaten und Normalwerte ab diesem Datum' },
    { key: 'Heizgrenze_C', type: 'number', value: 15, text: 'Tagesmittel, ab dem nicht mehr geheizt wird – gilt, wenn Heizgrenze_aus_Daten = nein oder zu wenig Daten' },
    { key: 'Heizgrenze_aus_Daten', type: 'text', value: 'ja', text: '„ja“: Heizgrenze 10–18 °C aus deinen Ablesungen schätzen (ab 6 Zeiträumen) · „nein“: Heizgrenze_C verwenden' },
    { key: 'Unsicherheit_Umrechnung_Prozent', type: 'number', value: 3, text: 'Unsicherheit von Brennwert × Zustandszahl in der Prognose, solange nicht aus der Rechnung' },
    { key: 'Raumtemperatur_C', type: 'number', value: 20, text: 'Für die Gradtagzahl G20/15 (VDI 3807)' },
    { key: 'Grundpreis_Verteilung', type: 'text', value: 'Jahr', text: '„Jahr“: Monatspreis × 12 / 365 je Tag · „Kalendermonat“: Monatspreis / Tage des Monats' },
  ];
}

// ===== Domain.gs =====

/**
 * Domain.gs – Fachlogik für Ablesungen (rein, in Node testbar).
 *
 * Eine Ablesung: { row, date: 'JJJJ-MM-TT', minutes: Zahl|null, t, value, meter, exclude }
 * t = gebrochene Tagesnummer (Datum + Uhrzeit; ohne Uhrzeit 12:00).
 */

/** Prüft die Eingabe aus der App auf Form und Typ. Der Zähler kommt aus den Einstellungen. */
function normalizeReadingInput_(input, meter) {
  if (!input || typeof input !== 'object') throw apiError_('BAD_REQUEST', 'Ablesung fehlt');
  if (!isIsoDate_(input.date)) throw apiError_('VALIDATION', 'Ungültiges Datum');
  const minutes = parseTime_(input.time);
  if (typeof minutes === 'number' && isNaN(minutes)) throw apiError_('VALIDATION', 'Ungültige Uhrzeit');
  const value = input.value;
  if (typeof value !== 'number' || !isFinite(value) || value < 0 || value >= 1e7) {
    throw apiError_('VALIDATION', 'Ungültiger Zählerstand');
  }
  return {
    date: input.date,
    minutes: minutes,
    t: readingT_(input.date, minutes),
    value: round_(value, 3), // Zähler zeigt 3 Nachkommastellen
    meter: norm_(meter),
    confirmed: input.confirmed === true,
  };
}

/**
 * Entscheidet, ob eine neue Ablesung gespeichert wird. Ein Stand pro Tag und Zähler: gleicher Tag + gleicher
 * Wert = Duplikat (wiederholtes Senden ist damit immer sicher), anderer Wert = Konflikt.
 * ctx: { today, minDate, maxPerDay, expect?(before, r) → {mean, sd} } · Rückgabe { status: 'new' | 'duplicate' } oder wirft.
 */
function checkNewReading_(r, readings, ctx) {
  const same = readings.filter(x => x.meter === r.meter).sort((a, b) => a.t - b.t);
  const sameDay = same.find(x => x.date === r.date);
  if (sameDay) {
    if (Math.abs(sameDay.value - r.value) < 0.0005) return { status: 'duplicate' };
    throw apiError_(
      'CONFLICT',
      'Für den ' + deDate_(r.date) + ' gibt es schon den Stand ' + deNum_(sameDay.value, 3) + ' m³. Korrektur bitte im Sheet.',
      { date: r.date, existing: sameDay.value }
    );
  }

  const lower = ctx.minDate && ctx.minDate > MIN_DATE ? ctx.minDate : MIN_DATE;
  if (r.date < lower) throw apiError_('VALIDATION', 'Datum liegt vor dem ' + deDate_(lower));
  if (r.date > ctx.today) throw apiError_('VALIDATION', 'Datum liegt in der Zukunft');

  const before = same.filter(x => x.t < r.t).pop() || null;
  const after = same.find(x => x.t > r.t) || null;
  if (before && r.value < before.value) {
    throw apiError_('VALIDATION', 'Stand ist kleiner als am ' + deDate_(before.date) + ' (' + deNum_(before.value, 3) + ' m³)');
  }
  if (after && r.value > after.value) {
    throw apiError_('VALIDATION', 'Stand ist größer als am ' + deDate_(after.date) + ' (' + deNum_(after.value, 3) + ' m³)');
  }

  if (!r.confirmed && ctx.maxPerDay > 0) {
    // Mindestens 1 Stunde Abstand, sonst wird die Rate bei Ablesungen um Mitternacht künstlich riesig
    const rate = (dv, dt) => dv / Math.max(dt, 1 / 24);
    const checks = [];
    if (before) checks.push({ ref: before, perDay: rate(r.value - before.value, r.t - before.t) });
    if (after) checks.push({ ref: after, perDay: rate(after.value - r.value, after.t - r.t) });
    for (const c of checks) {
      if (c.perDay > ctx.maxPerDay) {
        throw apiError_(
          'PLAUSIBILITY',
          'Das wären ' + deNum_(c.perDay, 1) + ' m³ pro Tag seit dem ' + deDate_(c.ref.date) + ' – ungewöhnlich viel. Stimmt der Wert?',
          { perDay: round_(c.perDay, 2), maxPerDay: ctx.maxPerDay, refDate: c.ref.date }
        );
      }
    }
    // Mit Modell: Abweichung vom erwarteten Verbrauch seit der letzten Ablesung (mind. 2 m³ oder 3 σ)
    const e = before && ctx.expect ? ctx.expect(before, r) : null;
    const dv = before ? r.value - before.value : 0;
    if (e && Math.abs(dv - e.mean) > Math.max(3 * e.sd, 2)) {
      throw apiError_(
        'PLAUSIBILITY',
        'Seit dem ' + deDate_(before.date) + ' wären etwa ' + deNum_(e.mean, 1) + ' m³ zu erwarten, eingegeben sind ' + deNum_(dv, 1) +
          ' m³. Stimmt der Wert?',
        { expected: round_(e.mean, 2), entered: round_(dv, 3), refDate: before.date }
      );
    }
  }
  return { status: 'new' };
}

/** Sortiert je Zähler, entfernt doppelte Tage (erste Zeile zählt) und meldet sie. */
function cleanReadings_(readings) {
  const hints = [];
  const sorted = readings.slice().sort((a, b) => (a.meter < b.meter ? -1 : a.meter > b.meter ? 1 : a.t - b.t || a.row - b.row));
  const out = [];
  for (const r of sorted) {
    const prev = out[out.length - 1];
    if (prev && prev.meter === r.meter && prev.date === r.date) {
      hints.push({ level: 'warn', text: 'Ablesungen Zeile ' + prev.row + ' und ' + r.row + ': zwei Stände am ' + deDate_(r.date) + ' – nur Zeile ' + prev.row + ' zählt.' });
      continue;
    }
    out.push(r);
  }
  return { readings: out, hints: hints };
}

/**
 * Aufeinanderfolgende Ablesungen desselben Zählers als Paare {a, b, dv}. Rückläufige Stände werden gemeldet
 * und übersprungen. Einzige Stelle, die festlegt, was ein gültiger Ablesezeitraum ist.
 */
function readingPairs_(readings) {
  const pairs = [];
  const hints = [];
  for (let i = 1; i < readings.length; i++) {
    const a = readings[i - 1];
    const b = readings[i];
    if (a.meter !== b.meter) continue;
    const dv = round_(b.value - a.value, 3);
    if (dv < 0) {
      hints.push({ level: 'warn', text: 'Ablesungen Zeile ' + b.row + ': Stand am ' + deDate_(b.date) + ' ist kleiner als am ' + deDate_(a.date) + ' – Zeitraum wird ignoriert.' });
      continue;
    }
    pairs.push({ a: a, b: b, dv: dv });
  }
  return { pairs: pairs, hints: hints };
}

/** Letzte Zeile mit from ≤ iso (Liste nach from sortiert) oder null. */
function validAt_(rows, iso) {
  let hit = null;
  for (const r of rows) if (r.from <= iso) hit = r;
  return hit;
}

/** kWh je m³ an einem Tag: Brennwert × Zustandszahl aus „Umrechnung“, sonst Platzhalter. */
function factorAt_(conversions, iso, placeholder) {
  const c = validAt_(conversions, iso);
  return c ? { factor: c.z * c.hs, source: c.status || 'Tabelle' } : { factor: placeholder.z * placeholder.hs, source: 'Platzhalter' };
}

/** Zeiträume zwischen Ablesungen für die Anzeige (neueste zuerst); mit temps auch die mittlere Temperatur. */
function buildIntervals_(pairs, conversions, placeholder, temps) {
  return pairs
    .map(p => {
      const days = p.b.t - p.a.t;
      const conv = factorAt_(conversions, p.b.date, placeholder);
      const td = temps ? pairDays_(p, temps) : null;
      return {
        from: p.a.date,
        to: p.b.date,
        meter: p.b.meter,
        days: round_(days, 3),
        m3: p.dv,
        m3PerDay: round_(p.dv / days, 4),
        kWh: round_(p.dv * conv.factor, 1),
        kWhPerDay: round_((p.dv * conv.factor) / days, 2),
        conversion: conv.source,
        excluded: p.b.exclude === true,
        tmean: td ? round_(td.reduce((s, x) => s + x.f * x.tm, 0) / days, 2) : null,
      };
    })
    .reverse();
}

// ===== Model.gs =====

/**
 * Model.gs – Verbrauchsmodell (rein, in Node testbar).
 *
 *   V_i = a · H_i(θ) + b · D_i + ε_i,   Var(ε_i) = σ² · D_i
 *   V_i: m³ im Ablesezeitraum i · D_i: Länge in Tagen · H_i(θ) = Σ Anteil_d · max(0, θ − Tm_d)
 *   a: m³ je Heizgradtag (Zustand der Wohnung) · b: Grundlast m³/Tag (≥ 0) · θ: Heizgrenze
 * Gewichtete kleinste Quadrate (Gewicht 1/D_i), geschlossene Form. θ wird aus den Daten geschätzt
 * (Raster 10–18 °C) oder aus den Einstellungen genommen.
 */

const THETA_GRID = [10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 14.5, 15, 15.5, 16, 16.5, 17, 17.5, 18];
const MIN_INTERVALS = 3;

/** Gewichtete Regression y = a·h + b·d (Gewicht 1/d) mit b ≥ 0. obs: [{y, h, d}]. */
function wls_(obs) {
  let shh = 0, shd = 0, sdd = 0, shy = 0, sdy = 0, sy = 0;
  for (const o of obs) {
    shh += (o.h * o.h) / o.d;
    shd += o.h;
    sdd += o.d;
    shy += (o.h * o.y) / o.d;
    sdy += o.y;
    sy += o.y;
  }
  if (shh <= 1e-12) return null;
  const det = shh * sdd - shd * shd;
  let a = shy / shh;
  let b = 0;
  let p = 1;
  if (det > 1e-9 * shh * sdd) {
    const a2 = (shy * sdd - shd * sdy) / det;
    const b2 = (shh * sdy - shd * shy) / det;
    if (b2 >= 0) {
      a = a2;
      b = b2;
      p = 2;
    }
  }
  let sse = 0;
  for (const o of obs) sse += Math.pow(o.y - a * o.h - b * o.d, 2) / o.d;
  const dof = Math.max(1, obs.length - p);
  const s2 = sse / dof;
  const cov = p === 2 ? { aa: (s2 * sdd) / det, ab: (-s2 * shd) / det, bb: (s2 * shh) / det } : { aa: s2 / shh, ab: 0, bb: 0 };
  return { a: a, b: b, p: p, sse: sse, s2: s2, dof: dof, cov: cov, n: obs.length, sumD: sdd, sumY: sy, sumH: shd };
}

/** Heizgradtage eines Zeitraums bei Heizgrenze θ aus den Tagesanteilen. */
function hgtOf_(days, theta) {
  let h = 0;
  for (const x of days) h += x.f * Math.max(0, theta - x.tm);
  return h;
}

/** Tagesanteile [{iso, f, tm}] eines Ablesepaars; null, wenn eine Temperatur fehlt. */
function pairDays_(p, temps) {
  const days = [];
  for (let d = Math.floor(p.a.t); d < p.b.t; d++) {
    const f = Math.min(p.b.t, d + 1) - Math.max(p.a.t, d);
    if (f <= 1e-9) continue;
    const iso = isoFromDayNumber_(d);
    const tm = temps[iso] ? temps[iso].tm : null;
    if (tm === null) return null;
    days.push({ iso: iso, f: f, tm: tm });
  }
  return days;
}

/**
 * Passt das Modell an. Rückgabe null (zu wenig Daten) oder
 * { a, b, theta, thetaSource, s2, cov, dof, n, excluded, coverage, cv, relSeA }.
 * normalYearHgt(θ): normale Jahres-HGT bei θ (für die Abdeckung).
 */
function fitModel_(pairs, temps, settings, normalYearHgt) {
  const usable = [];
  let excluded = 0;
  for (const p of pairs) {
    if (p.b.exclude) {
      excluded++;
      continue;
    }
    const days = pairDays_(p, temps);
    if (days && p.b.t - p.a.t > 0) usable.push({ y: p.dv, d: p.b.t - p.a.t, days: days });
  }
  if (usable.length < MIN_INTERVALS) return null;

  const auto = String(settings.Heizgrenze_aus_Daten || 'ja').toLowerCase() !== 'nein' && usable.length >= 6;
  const thetas = auto ? THETA_GRID : [settings.Heizgrenze_C];
  let best = null;
  for (const theta of thetas) {
    const fit = wls_(usable.map(u => ({ y: u.y, d: u.d, h: hgtOf_(u.days, theta) })));
    if (!fit || fit.a <= 0) continue;
    // Bei gleichem Fehler die Heizgrenze näher an 15 °C bevorzugen (Norm)
    if (!best || fit.sse < best.fit.sse - 1e-9 || (Math.abs(fit.sse - best.fit.sse) <= 1e-9 && Math.abs(theta - 15) < Math.abs(best.theta - 15))) {
      best = { theta: theta, fit: fit };
    }
  }
  if (!best) return null;
  const f = best.fit;
  const normal = normalYearHgt(best.theta);
  const meanRate = f.sumY / f.sumD;
  return {
    a: f.a,
    b: f.b,
    theta: best.theta,
    thetaSource: auto ? 'Daten' : 'Einstellung',
    s2: f.s2,
    cov: f.cov,
    dof: f.dof,
    n: f.n,
    excluded: excluded,
    coverage: normal > 0 ? f.sumH / normal : 0,
    cv: meanRate > 0 ? Math.sqrt(f.sse / f.sumD) / meanRate : null,
    relSeA: Math.sqrt(f.cov.aa) / f.a,
  };
}

/** Ampel + Klartext zur Verlässlichkeit. */
function modelRating_(m) {
  if (!m) return { level: 'rot', text: 'Noch kein Modell: Es braucht mindestens ' + MIN_INTERVALS + ' Ablesezeiträume mit Temperaturdaten.' };
  const cover = Math.round(Math.min(m.coverage, 9.99) * 100);
  let level = 'grün';
  if (m.n < MIN_INTERVALS || m.coverage < 0.15) level = 'rot';
  else if (m.coverage < 0.5 || m.relSeA > 0.1) level = 'gelb';
  const basis = m.n + ' Ablesezeiträume, ' + (cover >= 100 ? 'mehr als eine ganze Heizsaison' : cover + ' % einer normalen Heizsaison');
  const quality = 'Streuung um das Modell ' + Math.round((m.cv || 0) * 100) + ' %, Unsicherheit des Verbrauchs je Heizgradtag ±' + Math.round(m.relSeA * 100) + ' %';
  const lead = { grün: 'Belastbar', gelb: 'Eingeschränkt belastbar', rot: 'Noch wenig belastbar' }[level];
  return { level: level, text: lead + ': ' + basis + '. ' + quality + '.' };
}

/** Erwarteter Verbrauch (m³) und Standardabweichung für einen Zeitraum mit bekannten Tagesanteilen. */
function predictPair_(m, days, d) {
  const h = hgtOf_(days, m.theta);
  const mean = m.a * h + m.b * d;
  const varParam = m.cov.aa * h * h + 2 * m.cov.ab * h * d + m.cov.bb * d * d;
  return { mean: mean, sd: Math.sqrt(m.s2 * d + varParam) };
}

// ===== Calc.gs =====

/**
 * Calc.gs – Tagesrechnung, Kosten, Abschläge, Perioden (rein, in Node testbar).
 *
 * Konvention: Tag d (Tagesnummer) umfasst [d, d+1) in gebrochenen Tagesnummern; eine Ablesung zum Zeitpunkt t.
 */

/** Mitternacht Europe/Berlin als Date, ohne Utilities (EU-Sommerzeitregel seit 1996). */
function berlinMidnight_(iso) {
  const y = Number(iso.slice(0, 4));
  const n = dayNumber_(iso);
  const lastSunday = month => {
    const last = dayNumber_(y + '-' + month + '-31'); // März und Oktober haben 31 Tage
    const weekday = (last + 4) % 7; // 1970-01-01 war ein Donnerstag (4); 0 = Sonntag
    return last - weekday;
  };
  const summer = n > lastSunday('03') && n <= lastSunday('10');
  return new Date(n * 86400000 - (summer ? 2 : 1) * 3600000);
}

function isoRange_(fromIso, toIso) {
  const out = [];
  for (let n = dayNumber_(fromIso), end = dayNumber_(toIso); n <= end; n++) out.push(isoFromDayNumber_(n));
  return out;
}

/**
 * Temperatur je Tag mit Lückenfüllung: DWD-Wert, sonst linear interpoliert (Lücke ≤ 10 Tage),
 * am Ende fortgeschrieben (≤ 5 Tage nach dem letzten Wert, z. B. heute/gestern). Rückgabe { iso: {tm, src} }.
 */
function fillTemps_(weather, fromIso, toIso) {
  const out = {};
  const days = isoRange_(fromIso, toIso);
  const known = days.map(d => (weather[d] === undefined || weather[d] === null ? null : weather[d]));
  let prev = -1;
  for (let i = 0; i < days.length; i++) {
    if (known[i] !== null) {
      out[days[i]] = { tm: known[i], src: 'DWD' };
      prev = i;
      continue;
    }
    let next = i + 1;
    while (next < days.length && known[next] === null) next++;
    if (prev >= 0 && next < days.length && next - prev <= 11) {
      const tm = known[prev] + ((known[next] - known[prev]) * (i - prev)) / (next - prev);
      out[days[i]] = { tm: round_(tm, 2), src: 'interpoliert' };
    } else if (prev >= 0 && next >= days.length && i - prev <= 5) {
      out[days[i]] = { tm: known[prev], src: 'fortgeschrieben' };
    } else if (prev < 0 && next < days.length && next - i <= 5) {
      out[days[i]] = { tm: known[next], src: 'fortgeschrieben' };
    } else {
      out[days[i]] = { tm: null, src: null };
    }
  }
  return out;
}

/** HGT (stetig, fürs Modell) und Gradtagzahl G20/15 (VDI 3807) eines Tages. */
function degreeDays_(tm, heizgrenze, raum) {
  if (tm === null || tm === undefined) return { hgt: null, g: null };
  return { hgt: Math.max(0, heizgrenze - tm), g: tm < heizgrenze ? raum - tm : 0 };
}

/**
 * Verteilt den Verbrauch jedes Ablesepaars auf die Tage: Gewicht Anteil × (b + a · HGT) aus dem Modell
 * (ohne Modell a = 1, b = 0, also nach HGT); ohne Wärmebedarf oder ohne Temperatur gleichmäßig.
 * Rückgabe { m3: {iso: m³}, covered: {iso: Anteil 0–1}, hints }.
 */
function distributeReadings_(pairs, temps, heizgrenze, weights) {
  const wa = weights ? weights.a : 1;
  const wb = weights ? weights.b : 0;
  const m3 = {};
  const covered = {};
  const missing = [];
  for (const p of pairs) {
    const parts = [];
    let sumW = 0;
    let gap = false;
    for (let d = Math.floor(p.a.t); d < p.b.t; d++) {
      const f = Math.min(p.b.t, d + 1) - Math.max(p.a.t, d);
      if (f <= 1e-9) continue;
      const iso = isoFromDayNumber_(d);
      const tm = temps[iso] ? temps[iso].tm : null;
      if (tm === null) gap = true;
      const w = tm === null ? 0 : f * (wb + wa * Math.max(0, heizgrenze - tm));
      parts.push({ iso: iso, f: f, w: w });
      sumW += w;
    }
    if (gap) missing.push(deDate_(p.a.date) + '–' + deDate_(p.b.date));
    const uniform = gap || sumW <= 1e-9;
    const total = uniform ? p.b.t - p.a.t : sumW;
    for (const x of parts) {
      m3[x.iso] = (m3[x.iso] || 0) + (p.dv * (uniform ? x.f : x.w)) / total;
      covered[x.iso] = (covered[x.iso] || 0) + x.f;
    }
  }
  const hints = [];
  if (missing.length) {
    const list = missing.length <= 3 ? ' (' + missing.join(', ') + ')' : '';
    hints.push({ level: 'warn', text: missing.length + ' Zeitraum/Zeiträume ohne vollständige Temperatur' + list + ' – Verbrauch dort gleichmäßig verteilt.' });
  }
  return { m3: m3, covered: covered, hints: hints };
}

/** Grundpreis pro Tag aus Monatspreis: „Jahr“ = × 12 / 365, „Kalendermonat“ = / Tage des Monats. */
function basePerDay_(gpMonth, iso, method) {
  if (method === 'Kalendermonat') return gpMonth / daysInMonth_(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)));
  return (gpMonth * 12) / 365;
}

/**
 * Fällige Abschläge zwischen fromIso und toIso (inklusive). rows: [{from, amount, day}] nach from sortiert;
 * jede Zeile gilt bis zum Gültig_ab der nächsten. Rückgabe [{date, amount}].
 */
function paymentSchedule_(rows, fromIso, toIso) {
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const until = i + 1 < rows.length ? rows[i + 1].from : '9999-12-31';
    let y = Number(r.from.slice(0, 4));
    let m = Number(r.from.slice(5, 7));
    for (let guard = 0; guard < 1200; guard++) {
      const day = Math.min(Math.max(1, Math.round(r.day || 1)), daysInMonth_(y, m));
      const iso = y + '-' + pad2_(m) + '-' + pad2_(day);
      if (iso >= until || iso > toIso) break;
      if (iso >= r.from && iso >= fromIso && r.amount) out.push({ date: iso, amount: r.amount });
      m++;
      if (m > 12) {
        m = 1;
        y++;
      }
    }
  }
  return out;
}

/** Mittlere HGT je Kalendertag (MM-TT) über vollständige Jahre [fromYear, toYear]. */
function dailyNormals_(weather, fromYear, toYear, heizgrenze) {
  const sum = {};
  const cnt = {};
  for (let y = fromYear; y <= toYear; y++) {
    for (const iso of isoRange_(y + '-01-01', y + '-12-31')) {
      const tm = weather[iso];
      if (tm === undefined || tm === null) continue;
      const k = iso.slice(5);
      sum[k] = (sum[k] || 0) + Math.max(0, heizgrenze - tm);
      cnt[k] = (cnt[k] || 0) + 1;
    }
  }
  const out = {};
  Object.keys(sum).forEach(k => (out[k] = sum[k] / cnt[k]));
  if (out['02-29'] === undefined && out['02-28'] !== undefined) out['02-29'] = out['02-28'];
  return out;
}

/**
 * Gesamtrechnung. in: { readings (bereinigt, sortiert), pairs (readingPairs_), weather {iso: tm}, conversions, placeholder,
 * tariffs [{from, ap, gp}], payments [{from, amount, day}], periods [{name, start, end}], settings, today }
 * Rückgabe { days, months, periods, model, rating, temps, hints, weatherLast }.
 */
function computeAll_(input) {
  const s = input.settings;
  const raum = s.Raumtemperatur_C;
  const hints = [];
  const readings = input.readings;
  const weatherDates = Object.keys(input.weather).sort();
  const weatherLast = weatherDates.length ? weatherDates[weatherDates.length - 1] : null;
  if (!readings.length) return { days: [], months: [], periods: [], model: null, rating: modelRating_(null), temps: {}, hints: hints, weatherLast: weatherLast };

  const first = readings.reduce((m, r) => (r.date < m ? r.date : m), readings[0].date);
  const periodStart = input.periods.reduce((m, p) => (p.start < m ? p.start : m), first);
  const from = periodStart < first ? periodStart : first;
  const to = input.today;
  const temps = fillTemps_(input.weather, from, to);
  const lastFullYear = Number(to.slice(0, 4)) - 1;
  const fromYear = Number((s.Wetter_ab || '2020-01-01').slice(0, 4));
  const yearNormal = theta => {
    const n = dailyNormals_(input.weather, fromYear, lastFullYear, theta);
    return Object.keys(n).filter(k => k !== '02-29').reduce((sum, k) => sum + n[k], 0);
  };
  const model = fitModel_(input.pairs, temps, s, yearNormal);
  const heizgrenze = model ? model.theta : s.Heizgrenze_C;
  const dist = distributeReadings_(input.pairs, temps, heizgrenze, model);
  hints.push.apply(hints, dist.hints);
  const normals = dailyNormals_(input.weather, fromYear, lastFullYear, heizgrenze);

  const days = isoRange_(from, to).map(iso => {
    const t = temps[iso];
    const dd = degreeDays_(t.tm, heizgrenze, raum);
    const m3 = dist.m3[iso] === undefined ? null : dist.m3[iso];
    const conv = factorAt_(input.conversions, iso, input.placeholder);
    const kWh = m3 === null ? null : m3 * conv.factor;
    const tariff = validAt_(input.tariffs, iso);
    const costWork = kWh === null || !tariff ? null : (kWh * tariff.ap) / 100;
    const costBase = tariff ? basePerDay_(tariff.gp, iso, s.Grundpreis_Verteilung) : null;
    return {
      date: iso,
      tm: t.tm,
      tmSrc: t.src,
      hgt: dd.hgt,
      g: dd.g,
      hgtNormal: normals[iso.slice(5)] === undefined ? null : normals[iso.slice(5)],
      // Erwarteter Verbrauch bei normalem Wetter (Modell × Normal-HGT) – für „Wetter oder du?“
      kWhNormal: model && normals[iso.slice(5)] !== undefined ? (model.b + model.a * normals[iso.slice(5)]) * conv.factor : null,
      m3: m3,
      kWh: kWh,
      factor: conv.factor,
      factorSource: conv.source,
      covered: Math.min(1, dist.covered[iso] || 0),
      ap: tariff ? tariff.ap : null,
      costWork: costWork,
      costBase: costBase,
    };
  });

  const missingTemp = days.filter(d => d.tm === null).length;
  if (missingTemp) hints.push({ level: 'warn', text: missingTemp + ' Tag(e) ohne Temperatur – Wetterdaten prüfen (Menü „Wetter aktualisieren“).' });
  const estTemp = days.filter(d => d.tmSrc === 'interpoliert').length;
  if (estTemp) hints.push({ level: 'info', text: estTemp + ' Tag(e) mit interpolierter Temperatur (Lücke in den DWD-Daten).' });

  const years = [];
  for (let y = fromYear; y <= lastFullYear; y++) years.push(y);
  const fctx = {
    days: days, model: model, theta: heizgrenze, weather: input.weather, years: years, normals: normals,
    conversions: input.conversions, placeholder: input.placeholder, tariffs: input.tariffs, payments: input.payments,
    settings: s, today: to,
  };
  const periods = input.periods.map(p => {
    const sum = summarizePeriod_(p, days, input.payments, to, hints);
    if (sum.status !== 'zukünftig') {
      // ±3 % solange Platzhalter/Schätzung, sonst ±0,5 % (der Brennwert schwankt von Monat zu Monat)
      const last = input.conversions[input.conversions.length - 1];
      const estimated = days.some(d => d.date >= p.start && d.date <= p.end && d.factorSource !== 'Rechnung') || (p.end > to && !(last && last.status === 'Rechnung'));
      sum.forecast = forecastPeriod_(p, Object.assign({ u: estimated ? (s.Unsicherheit_Umrechnung_Prozent || 3) / 100 : 0.005 }, fctx));
    }
    return sum;
  });
  if (!model && input.pairs.length) hints.push({ level: 'info', text: modelRating_(null).text });
  return { days: days, months: aggregateMonths_(days), periods: periods, model: model, rating: modelRating_(model), temps: temps, hints: hints, weatherLast: weatherLast };
}

function aggregateMonths_(days) {
  const map = {};
  const order = [];
  for (const d of days) {
    const k = d.date.slice(0, 7);
    if (!map[k]) {
      map[k] = { month: k, days: 0, hgt: 0, hgtNormal: 0, normalOk: true, m3: 0, kWh: 0, kWhNormal: 0, kWhNormalOk: true, cost: 0, covered: 0, costOk: true };
      order.push(k);
    }
    const m = map[k];
    m.days++;
    m.hgt += d.hgt || 0;
    if (d.hgtNormal === null) m.normalOk = false;
    else m.hgtNormal += d.hgtNormal;
    m.m3 += d.m3 || 0;
    m.kWh += d.kWh || 0;
    if (d.kWhNormal === null || d.kWhNormal === undefined) m.kWhNormalOk = false;
    else m.kWhNormal += d.kWhNormal;
    m.covered += d.covered;
    if (d.costBase === null || (d.covered > 0 && d.costWork === null)) m.costOk = false;
    m.cost += (d.costWork || 0) + (d.costBase || 0);
  }
  return order.map(k => {
    const m = map[k];
    return {
      month: k,
      days: m.days,
      hgt: round_(m.hgt, 1),
      hgtNormal: m.normalOk ? round_(m.hgtNormal, 1) : null,
      m3: round_(m.m3, 3),
      kWh: round_(m.kWh, 1),
      kWhNormal: m.kWhNormalOk ? round_(m.kWhNormal, 1) : null,
      cost: m.costOk ? round_(m.cost, 2) : null,
      coverage: round_(m.covered / m.days, 3),
    };
  });
}

/** Kennzahlen eines Abrechnungszeitraums bis heute (bzw. bis Periodenende). */
function summarizePeriod_(p, days, paymentRows, today, hints) {
  const elapsedEnd = p.end < today ? p.end : today;
  const totalDays = dayNumber_(p.end) - dayNumber_(p.start) + 1;
  const inPeriod = days.filter(d => d.date >= p.start && d.date <= elapsedEnd);
  const elapsedDays = Math.max(0, dayNumber_(elapsedEnd) - dayNumber_(p.start) + 1);
  let m3 = 0;
  let kWh = 0;
  let costWork = 0;
  let costBase = 0;
  let covered = 0;
  let tariffMissing = false;
  let measuredUntil = null;
  for (const d of inPeriod) {
    m3 += d.m3 || 0;
    kWh += d.kWh || 0;
    covered += d.covered;
    if (d.costBase === null) tariffMissing = true;
    costBase += d.costBase || 0;
    if (d.costWork !== null) costWork += d.costWork;
    else if (d.covered > 0) tariffMissing = true;
    if (d.covered > 0.999) measuredUntil = d.date;
  }
  // Tage ohne Ablesung (vor der ersten / nach der letzten) haben covered = 0
  const uncovered = elapsedDays - covered;
  const due = paymentSchedule_(paymentRows, p.start, elapsedEnd);
  const all = paymentSchedule_(paymentRows, p.start, p.end);
  const paid = due.reduce((s, x) => s + x.amount, 0);
  const ended = p.end < today;
  const complete = elapsedDays > 0 && uncovered < 0.01;
  if (tariffMissing) hints.push({ level: 'warn', text: 'Periode „' + p.name + '“: Für manche Tage fehlt ein Tarif (Tab „Tarife“).' });
  if (ended && !complete) {
    hints.push({ level: 'warn', text: 'Periode „' + p.name + '“: ' + round_(uncovered, 1) + ' Tag(e) ohne Ablesung – Verbrauch dort fehlt in der Summe.' });
  }
  if (!all.length && p.start <= today) hints.push({ level: 'info', text: 'Periode „' + p.name + '“: keine Abschläge eingetragen (Tab „Abschläge“).' });
  const cost = costWork + costBase;
  return {
    name: p.name,
    start: p.start,
    end: p.end,
    status: ended ? 'beendet' : p.start > today ? 'zukünftig' : 'läuft',
    complete: complete,
    totalDays: totalDays,
    elapsedDays: elapsedDays,
    measuredUntil: measuredUntil,
    m3: round_(m3, 3),
    kWh: round_(kWh, 1),
    costWork: round_(costWork, 2),
    costBase: round_(costBase, 2),
    cost: round_(cost, 2),
    paymentsCount: due.length,
    paymentsPaid: round_(paid, 2),
    paymentsCountTotal: all.length,
    balance: round_(cost - paid, 2), // > 0 Nachzahlung, < 0 Guthaben (Stand heute)
  };
}

// ===== Forecast.gs =====

/**
 * Forecast.gs – Prognose bis Periodenende per Monte Carlo (rein, in Node testbar).
 *
 * Unsicherheiten: Modellparameter (a, b, σ²), Zufallsabweichung der Tage, Wetter bis Periodenende (ein ganzes
 * historisches Jahr je Lauf), Umrechnung m³ → kWh (±3 % solange geschätzt, gilt für ALLE kWh der Periode).
 * Weil der Verbrauch linear in a und b ist, werden die Tageswerte je Wetterjahr vorab zu Summen verdichtet –
 * jeder Lauf kostet dann nur ein paar Rechenschritte.
 */

const MC_RUNS = 4000;

/** Reproduzierbarer Zufall (mulberry32). */
function rng_(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash_(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

function normal_(rnd) {
  let u = 0;
  while (u === 0) u = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
}

/** Gamma-verteilte Zufallszahl (Marsaglia & Tsang). */
function gamma_(rnd, shape) {
  if (shape < 1) return gamma_(rnd, shape + 1) * Math.pow(rnd(), 1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x;
    let v;
    do {
      x = normal_(rnd);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rnd();
    if (u < 1 - 0.0331 * x * x * x * x || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

function quantile_(sorted, q) {
  const i = q * (sorted.length - 1);
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

function band_(values) {
  const s = values.slice().sort((x, y) => x - y);
  return { p10: round_(quantile_(s, 0.1), 2), p50: round_(quantile_(s, 0.5), 2), p80: round_(quantile_(s, 0.8), 2), p90: round_(quantile_(s, 0.9), 2) };
}

/** Temperatur eines Kalendertags (MM-TT) in Jahr y; 29.02. fällt auf den 28.02. zurück. */
function tmInYear_(weather, y, mmdd) {
  const v = weather[y + '-' + mmdd];
  if (v !== undefined) return v;
  return mmdd === '02-29' ? weather[y + '-02-28'] : undefined;
}

/**
 * Prognose für eine Periode. ctx: { days (Tagesrechnung bis heute), model, theta, weather, years [Jahre],
 * normals {MM-TT: HGT}, conversions, placeholder, tariffs, payments, settings, today, u (rel. Umrechnungsunsicherheit) }
 * Rückgabe null, wenn ohne Modell unbekannte Tage bleiben oder ein Tarif fehlt.
 */
function forecastPeriod_(p, ctx) {
  const m = ctx.model;
  const pastEnd = p.end < ctx.today ? p.end : ctx.today;
  const acc = { kWhM: 0, costM: 0, m3M: 0, base: 0, M1: 0, MH: 0, K1: 0, KH: 0, C1: 0, CH: 0 };
  let tariffOk = true;

  // Verlauf fürs Diagramm: Ist-Kosten bis zur letzten vollen Ablesung, Prognose an Stichtagen (Monatsenden, heute, Ende)
  let measuredUntil = null;
  for (const d of ctx.days) if (d.date >= p.start && d.date <= pastEnd && d.covered > 0.999) measuredUntil = d.date;
  const checkpoints = {};
  for (let y = Number(p.start.slice(0, 4)), mo = Number(p.start.slice(5, 7)); ; ) {
    const iso = y + '-' + pad2_(mo) + '-' + pad2_(daysInMonth_(y, mo));
    if (iso >= p.end) break;
    checkpoints[iso] = true;
    if (++mo > 12) {
      mo = 1;
      y++;
    }
  }
  [p.end, ctx.today <= p.end ? ctx.today : null, measuredUntil].forEach(d => d && d >= p.start && (checkpoints[d] = true));
  const snaps = [];
  const actual = [];
  const snapshot = (iso, perYear) => {
    if (!checkpoints[iso]) return;
    snaps.push({ date: iso, base: acc.base, costM: acc.costM, C1: acc.C1, CH: acc.CH, years: perYear ? perYear.map(py => py.CH) : null });
  };

  // Vergangenheit: gemessene Anteile + nicht abgelesene Anteile mit echtem Wetter
  for (const d of ctx.days) {
    if (d.date < p.start || d.date > pastEnd) continue;
    if (d.ap === null || d.costBase === null) tariffOk = false;
    const f = d.factor;
    const ap = (d.ap || 0) / 100;
    acc.base += d.costBase || 0;
    acc.m3M += d.m3 || 0;
    acc.kWhM += (d.m3 || 0) * f;
    acc.costM += (d.m3 || 0) * f * ap;
    const u = 1 - d.covered;
    if (u > 1e-9) {
      const h = d.hgt !== null ? d.hgt : ctx.normals[d.date.slice(5)] || 0;
      acc.M1 += u;
      acc.MH += u * h;
      acc.K1 += u * f;
      acc.KH += u * f * h;
      acc.C1 += u * f * ap;
      acc.CH += u * f * ap * h;
    }
    if (measuredUntil && d.date <= measuredUntil && (dayNumber_(d.date) - dayNumber_(p.start)) % 7 === 0 || d.date === measuredUntil) {
      actual.push({ date: d.date, cost: round_(acc.costM + acc.base, 2) });
    }
    snapshot(d.date, null);
  }

  // Zukunft: Wetter je Klimajahr
  const future = p.end > ctx.today ? isoRange_(isoFromDayNumber_(Math.max(dayNumber_(ctx.today) + 1, dayNumber_(p.start))), p.end) : [];
  const years = ctx.years.filter(y => future.every(iso => tmInYear_(ctx.weather, y, iso.slice(5)) !== undefined));
  const perYear = (years.length ? years : [null]).map(() => ({ MH: 0, KH: 0, CH: 0 }));
  for (const iso of future) {
    const tariff = validAt_(ctx.tariffs, iso);
    if (!tariff) tariffOk = false;
    const f = factorAt_(ctx.conversions, iso, ctx.placeholder).factor;
    const ap = tariff ? tariff.ap / 100 : 0;
    acc.base += tariff ? basePerDay_(tariff.gp, iso, ctx.settings.Grundpreis_Verteilung) : 0;
    acc.M1 += 1;
    acc.K1 += f;
    acc.C1 += f * ap;
    perYear.forEach((py, i) => {
      const tm = years.length ? tmInYear_(ctx.weather, years[i], iso.slice(5)) : null;
      const h = tm === null ? ctx.normals[iso.slice(5)] || 0 : Math.max(0, ctx.theta - tm);
      py.MH += h;
      py.KH += f * h;
      py.CH += f * ap * h;
    });
    snapshot(iso, perYear);
  }
  if (!tariffOk) return null;
  if (!m && acc.M1 > 0) return null;

  const all = paymentSchedule_(ctx.payments, p.start, p.end);
  const due = all.filter(x => x.date <= ctx.today);
  const paymentsTotal = all.reduce((s, x) => s + x.amount, 0);
  const paid = due.reduce((s, x) => s + x.amount, 0);
  const mean = (k) => perYear.reduce((s, py) => s + py[k], 0) / perYear.length;
  const avgYear = { MH: mean('MH'), KH: mean('KH'), CH: mean('CH') };
  const rnd = rng_(hash_(p.name + '|' + ctx.today));
  const a0 = m ? m.a : 0;
  const b0 = m ? m.b : 0;

  const traj = snaps.map(() => []);

  /** Ein Lauf; opts schaltet einzelne Unsicherheiten ab (für „größte Unsicherheit“), opts.track sammelt den Verlauf. */
  function run(opts) {
    let a = a0;
    let b = b0;
    let s2 = m ? m.s2 : 0;
    if (m && opts.model) {
      s2 = (m.s2 * m.dof) / (2 * gamma_(rnd, m.dof / 2)); // σ² aus skalierter inverser χ²-Verteilung
      const k = s2 / m.s2;
      const z1 = normal_(rnd);
      const z2 = normal_(rnd);
      const l11 = Math.sqrt(Math.max(0, m.cov.aa * k));
      const l21 = l11 > 0 ? (m.cov.ab * k) / l11 : 0;
      const l22 = Math.sqrt(Math.max(0, m.cov.bb * k - l21 * l21));
      a = Math.max(0, a0 + l11 * z1);
      b = Math.max(0, b0 + l21 * z1 + l22 * z2);
    }
    const yi = opts.weather ? Math.floor(rnd() * perYear.length) : -1;
    const yr = yi >= 0 ? perYear[yi] : avgYear;
    const MH = acc.MH + yr.MH;
    const mean3 = b * acc.M1 + a * MH;
    const noise = opts.model ? Math.sqrt(s2 * acc.M1) * normal_(rnd) : 0;
    const m3U = Math.max(0, mean3 + noise);
    const scale = mean3 > 1e-9 ? m3U / mean3 : 0;
    const kWhU = scale * (b * acc.K1 + a * (acc.KH + yr.KH));
    const costU = scale * (b * acc.C1 + a * (acc.CH + yr.CH));
    const conv = opts.conversion ? 1 + ctx.u * normal_(rnd) : 1;
    const kWh = conv * (acc.kWhM + kWhU);
    const cost = conv * (acc.costM + costU) + acc.base;
    if (opts.track) {
      snaps.forEach((sn, k) => {
        const chf = sn.years ? (yi >= 0 ? sn.years[yi] : sn.years.reduce((x, v) => x + v, 0) / sn.years.length) : 0;
        traj[k].push(conv * (sn.costM + scale * (b * sn.C1 + a * (sn.CH + chf))) + sn.base);
      });
    }
    return { m3: acc.m3M + m3U, kWh: kWh, cost: cost, balance: cost - paymentsTotal };
  }

  const full = [];
  for (let i = 0; i < MC_RUNS; i++) full.push(run({ model: true, weather: true, conversion: true, track: true }));
  const spread = opts => {
    const v = [];
    for (let i = 0; i < MC_RUNS / 4; i++) v.push(run(opts).balance);
    const b = band_(v);
    return b.p90 - b.p10;
  };
  const sources = [
    { name: 'Wetter', width: future.length ? spread({ weather: true }) : 0 },
    { name: 'Modell', width: acc.M1 > 0 ? spread({ model: true }) : 0 },
    { name: 'Umrechnung', width: spread({ conversion: true }) },
  ].sort((x, y) => y.width - x.width);

  const kWh = band_(full.map(r => r.kWh));
  const cost = band_(full.map(r => r.cost));
  const remaining = all.length - due.length;
  const perRate = q => Math.max(0, Math.ceil((q - paid) / remaining));
  return {
    m3: band_(full.map(r => r.m3)),
    kWh: kWh,
    cost: cost,
    balance: band_(full.map(r => r.balance)),
    paymentsTotal: round_(paymentsTotal, 2),
    paymentsCount: all.length,
    measuredShare: kWh.p50 > 0 ? round_(Math.min(1, acc.kWhM / kWh.p50), 3) : 1,
    unknownDays: round_(acc.M1, 1),
    climateYears: years.length,
    mainUncertainty: sources[0].width >= 1 ? sources[0].name : null,
    measuredUntil: measuredUntil,
    actual: actual,
    trajectory: snaps
      .map((sn, k) => Object.assign({ date: sn.date }, band_(traj[k])))
      .filter(t => !measuredUntil || t.date >= measuredUntil)
      .map(t => ({ date: t.date, p10: t.p10, p50: t.p50, p90: t.p90 })),
    paymentSteps: all.reduce((list, x) => list.concat([{ date: x.date, sum: round_((list.length ? list[list.length - 1].sum : 0) + x.amount, 2) }]), []),
    recommendation:
      p.start <= ctx.today && remaining > 0
        ? { remaining: remaining, current: all[all.length - 1].amount, balanced: perRate(cost.p50), safe: perRate(cost.p80) }
        : null,
  };
}

// ===== Insights.gs =====

/**
 * Insights.gs – Daten für die Analyse-Grafiken und den Live-Zähler (rein, in Node testbar).
 */

/**
 * r: Ergebnis von computeAll_ · input: dessen Eingaben · nowT: jetzt als gebrochene Tagesnummer (Berlin).
 * Rückgabe { tariffNow, factorNow, daily, estimate?, savings?, season? } – ohne Modell nur die ersten drei.
 */
function insights_(r, input, nowT) {
  const s = input.settings;
  const m = r.model;
  const today = input.today;
  const tariff = validAt_(input.tariffs, today);
  const factor = factorAt_(input.conversions, today, input.placeholder).factor;
  const basePerDay = tariff ? basePerDay_(tariff.gp, today, s.Grundpreis_Verteilung) : null;
  const out = {
    tariffNow: tariff ? { ap: tariff.ap, gp: tariff.gp, name: tariff.name || '', basePerDay: round_(basePerDay, 4) } : null,
    factorNow: round_(factor, 4),
    // Heizkalender: die letzten 12 Monate Tag für Tag
    daily: r.days
      .filter(d => dayNumber_(today) - dayNumber_(d.date) < 366)
      .map(d => ({ date: d.date, kWh: d.kWh === null ? null : round_(d.kWh, 2), tm: d.tm, covered: round_(d.covered, 2) })),
  };
  if (!m) return out;

  // Live-Zähler: erwarteter Verbrauch seit der letzten Ablesung bis jetzt
  let last = null;
  for (const x of input.readings) if (!last || x.t > last.t) last = x;
  const todayTm = r.temps[today] ? r.temps[today].tm : null;
  if (last && nowT > last.t && todayTm !== null) {
    const days = pairDays_({ a: last, b: { t: nowT } }, r.temps);
    if (days) {
      const d = nowT - last.t;
      const p = predictPair_(m, days, d);
      const rate = m.b + m.a * Math.max(0, m.theta - todayTm); // m³/Tag bei heutiger Temperatur
      out.estimate = {
        since: last.date,
        sinceTime: last.minutes === null ? null : formatTime_(last.minutes),
        hours: round_(d * 24, 1),
        lastValue: last.value,
        m3: round_(p.mean, 3),
        sd: round_(p.sd, 3),
        value: round_(last.value + p.mean, 3),
        tmToday: todayTm,
        m3PerDay: round_(rate, 3),
        kWhPerDay: round_(rate * factor, 2),
        eurPerDay: tariff ? round_((rate * factor * tariff.ap) / 100 + basePerDay, 2) : null,
      };
    }
  }

  // Normalwerte (Mittel der Klimajahre) bei der Heizgrenze θ und θ − 1
  const lastFullYear = Number(today.slice(0, 4)) - 1;
  const fromYear = Number((s.Wetter_ab || '2020-01-01').slice(0, 4));
  const normals = dailyNormals_(input.weather, fromYear, lastFullYear, m.theta);
  const normalsCooler = dailyNormals_(input.weather, fromYear, lastFullYear, m.theta - 1);
  const yearSum = n => Object.keys(n).filter(k => k !== '02-29').reduce((sum, k) => sum + n[k], 0);

  // Sparrechner: 1 °C kühler heizen ≈ Heizgrenze 1 K tiefer (Näherung)
  const dH = yearSum(normals) - yearSum(normalsCooler);
  const kWh = m.a * dH * factor;
  out.savings = { kWh: round_(kWh, 0), eur: tariff ? round_((kWh * tariff.ap) / 100, 0) : null, share: round_(dH / Math.max(1e-9, yearSum(normals)), 3) };

  // Heizsaison = Heizjahr 01.08.–31.07.; Fortschritt nach normalen Heizgradtagen, nicht nach Kalendertagen
  const y = Number(today.slice(5, 7)) >= 8 ? Number(today.slice(0, 4)) : Number(today.slice(0, 4)) - 1;
  const start = y + '-08-01';
  const end = y + 1 + '-07-31';
  let total = 0;
  let done = 0;
  let remainingKWh = 0;
  const cum = {}; // normale Heizgradtage bis zum Monatsersten (für die Skala Okt/Jan/Apr)
  for (const iso of isoRange_(start, end)) {
    if (iso.slice(8) === '01') cum[iso.slice(0, 7)] = total;
    const h = normals[iso.slice(5)] || 0;
    total += h;
    if (iso <= today) done += h;
    else remainingKWh += (m.b + m.a * h) * factor;
  }
  const doneKWh = r.days.filter(d => d.date >= start && d.date <= today).reduce((sum, d) => sum + (d.kWh || 0), 0);
  out.season = {
    start: start,
    end: end,
    share: round_(total > 0 ? done / total : 0, 3),
    doneKWh: round_(doneKWh, 0),
    remainingKWh: round_(remainingKWh, 0),
    remainingEur: tariff ? round_((remainingKWh * tariff.ap) / 100, 0) : null,
    marks: Object.keys(cum).map(k => ({ month: k, share: round_(total > 0 ? cum[k] / total : 0, 3) })),
  };
  return out;
}

// ===== Store.gs =====

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

// ===== Weather.gs =====

/**
 * Weather.gs – Tagesmitteltemperatur der DWD-Station (Opendata, CC BY 4.0, Quelle: Deutscher Wetterdienst).
 *
 *   laufend:   …/daily/kl/recent/tageswerte_KL_<Station>_akt.zip  (letzte ~550 Tage, 1 Tag Verzug)
 *   Historie:  …/daily/kl/historical/tageswerte_KL_<Station>_<von>_<bis>_hist.zip (Name ändert sich jährlich)
 * Darin produkt_klima_tag_*.txt: Semikolon-getrennt, Spalten MESS_DATUM (JJJJMMTT) und TMK (°C), -999 = fehlt.
 */

const DWD_KL_BASE = 'https://opendata.dwd.de/climate_environment/CDC/observations_germany/climate/daily/kl/';

/** Station immer fünfstellig (im Sheet kann aus „05906“ die Zahl 5906 werden). */
function dwdStation_(v) {
  const s = String(v === undefined || v === null || v === '' ? '05906' : v).replace(/\D/g, '');
  return ('00000' + s).slice(-5);
}

/** Parst produkt_klima_tag_*.txt → [{date, tm}] ab fromIso (rein, testbar). */
function parseDwdKl_(text, fromIso) {
  const lines = text.split(/\r?\n/);
  const header = lines[0].split(';').map(s => s.trim());
  const iDate = header.indexOf('MESS_DATUM');
  const iTmk = header.indexOf('TMK');
  if (iDate < 0 || iTmk < 0) throw new Error('DWD-Datei hat unerwartetes Format (MESS_DATUM/TMK fehlt)');
  const from = fromIso ? fromIso.replace(/-/g, '') : '';
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const f = line.split(';');
    const d = (f[iDate] || '').trim();
    if (d.length !== 8 || d < from) continue;
    const tm = Number((f[iTmk] || '').trim());
    if (!isFinite(tm) || tm <= -999) continue;
    out.push({ date: d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6, 8), tm: tm });
  }
  return out;
}

/** Sucht im Verzeichnis-Listing den Namen der Historien-Datei (rein, testbar). */
function findDwdHistFile_(html, station) {
  const re = new RegExp('tageswerte_KL_' + station + '_(\\d{8})_(\\d{8})_hist\\.zip', 'g');
  let best = null;
  let m;
  while ((m = re.exec(html))) if (!best || m[2] > best.to) best = { name: m[0], to: m[2] };
  return best ? best.name : null;
}

/** HTTP-Abruf mit Wiederholung bei Netz-/Serverfehlern (2 s, 4 s, 8 s). */
function fetchWithRetry_(url) {
  let last = '';
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) Utilities.sleep(1000 * Math.pow(2, attempt));
    try {
      const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
      const code = res.getResponseCode();
      if (code === 200) return res;
      last = 'HTTP ' + code;
      if (code < 500 && code !== 429) break; // 404 & Co.: Wiederholen hilft nicht
    } catch (e) {
      last = String(e && e.message ? e.message : e);
    }
  }
  throw new Error('Abruf fehlgeschlagen (' + last + '): ' + url);
}

function readDwdZip_(url, fromIso) {
  const blob = fetchWithRetry_(url).getBlob();
  const files = Utilities.unzip(blob);
  const produkt = files.find(f => /^produkt_klima_tag_.*\.txt$/.test(f.getName()));
  if (!produkt) throw new Error('DWD-Archiv ohne produkt_klima_tag-Datei: ' + url);
  return parseDwdKl_(produkt.getDataAsString('ISO-8859-1'), fromIso);
}

function fetchDwdRecent_(station, fromIso) {
  return readDwdZip_(DWD_KL_BASE + 'recent/tageswerte_KL_' + station + '_akt.zip', fromIso);
}

function fetchDwdHistorical_(station, fromIso) {
  const html = fetchWithRetry_(DWD_KL_BASE + 'historical/').getContentText();
  const name = findDwdHistFile_(html, station);
  if (!name) throw new Error('Keine DWD-Historie für Station ' + station + ' gefunden');
  return readDwdZip_(DWD_KL_BASE + 'historical/' + name, fromIso);
}

/**
 * Ergänzt/aktualisiert den Tab „Wetter“. Historie wird nur geholt, wenn sie fehlt; die laufende Datei
 * jedes Mal (der DWD korrigiert jüngste Werte nachträglich). Rückgabe: Bericht als Text.
 */
function updateWeather_(ss, settings) {
  const station = dwdStation_(settings.DWD_Station);
  const from = settings.Wetter_ab || '2020-01-01';
  const known = readWeather_(ss).map;
  const merged = {};
  Object.keys(known).forEach(d => (merged[d] = known[d]));
  const notes = [];

  const firstKnown = Object.keys(known).sort()[0];
  if (!firstKnown || firstKnown > from) {
    const hist = fetchDwdHistorical_(station, from);
    hist.forEach(r => (merged[r.date] = r.tm));
    notes.push('Historie: ' + hist.length + ' Tage');
  }
  const recent = fetchDwdRecent_(station, from);
  let changed = 0;
  recent.forEach(r => {
    if (merged[r.date] !== r.tm) changed++;
    merged[r.date] = r.tm;
  });
  notes.push('aktuell: ' + recent.length + ' Tage, ' + changed + ' neu/geändert');
  writeWeather_(ss, merged, station);
  const last = Object.keys(merged).sort().pop();
  notes.push('letzter Tag: ' + (last ? deDate_(last) : '–'));
  return 'DWD ' + station + ' – ' + notes.join(', ');
}

// ===== Overview.gs =====

/**
 * Overview.gs – liest alle Tabs (einmal pro Anfrage), rechnet und baut die Übersicht für die App.
 */

/** Alle Eingaben aus dem Sheet. */
function readInputs_(ss) {
  return {
    settings: readSettings_(ss),
    readings: readReadings_(ss),
    conversions: readSorted_(ss, 'Umrechnung'),
    tariffs: readSorted_(ss, 'Tarife'),
    payments: readSorted_(ss, 'Abschläge'),
    periods: readPeriods_(ss),
    weather: readWeather_(ss),
  };
}

/** Rechnet aus den Eingaben. Rückgabe { s, today, readings, intervals, result, hints, weatherLast, conversions, placeholder }. */
function computeFromInputs_(inp) {
  const today = Utilities.formatDate(now_(), TZ, 'yyyy-MM-dd');
  const s = inp.settings.values;
  const cleaned = cleanReadings_(inp.readings.readings);
  const pairs = readingPairs_(cleaned.readings);
  const placeholder = { z: s.Platzhalter_Zustandszahl, hs: s.Platzhalter_Brennwert_kWh_m3 };
  const input = {
    readings: cleaned.readings,
    pairs: pairs.pairs,
    weather: inp.weather.map,
    conversions: inp.conversions.rows,
    placeholder: placeholder,
    tariffs: inp.tariffs.rows,
    payments: inp.payments.rows,
    periods: inp.periods.periods,
    settings: s,
    today: today,
  };
  const result = computeAll_(input);
  const intervals = buildIntervals_(pairs.pairs, inp.conversions.rows, placeholder, result.temps);
  const now = now_();
  const nowT = dayNumber_(today) + (parseTime_(Utilities.formatDate(now, TZ, 'HH:mm')) || 0) / 1440;
  const insights = cleaned.readings.length ? insights_(result, input, nowT) : null;

  const hints = [].concat(
    inp.settings.hints, inp.readings.hints, inp.conversions.hints, inp.tariffs.hints, inp.payments.hints, inp.periods.hints,
    cleaned.hints, pairs.hints, result.hints
  );
  if (!cleaned.readings.length) hints.push({ level: 'info', text: 'Noch keine Ablesung gespeichert.' });
  if (intervals.some(i => i.conversion === 'Platzhalter')) {
    hints.push({
      level: 'info',
      text: 'kWh mit Platzhalter (Zustandszahl ' + deNum_(placeholder.z, 4) + ' × Brennwert ' + deNum_(placeholder.hs, 3) +
        ') – echte Werte aus der Rechnung im Tab „Umrechnung“ eintragen.',
    });
  }
  const last = inp.weather.last;
  if (!last) {
    hints.push({ level: 'warn', text: 'Noch keine Wetterdaten – im Sheet „Gaszähler → Wetter aktualisieren & neu berechnen“ wählen.' });
  } else if (dayNumber_(today) - dayNumber_(last) > 3) {
    hints.push({ level: 'warn', text: 'Wetterdaten veraltet (letzter Tag ' + deDate_(last) + ') – Protokoll prüfen.' });
  }
  if (cleaned.readings.length && !inp.periods.periods.some(p => p.start <= today && p.end >= today)) {
    hints.push({ level: 'info', text: 'Keine Abrechnungsperiode für heute – im Tab „Perioden“ eine neue anlegen.' });
  }
  return {
    s: s, today: today, readings: cleaned.readings, intervals: intervals, result: result, hints: hints, weatherLast: last,
    conversions: inp.conversions.rows, placeholder: placeholder, insights: insights,
  };
}

function computeFromSheet_(ss) {
  return computeFromInputs_(readInputs_(ss));
}

/** Übersicht für die App; `c` = Ergebnis von computeFromInputs_ (sonst wird gelesen und gerechnet). */
function buildOverview_(ss, c) {
  c = c || computeFromSheet_(ss);
  const s = c.s;
  const m = c.result.model;
  let last = null;
  for (const r of c.readings) if (!last || r.t > last.t) last = r;
  const factorToday = factorAt_(c.conversions, c.today, c.placeholder).factor;
  return {
    generatedAt: now_().toISOString(),
    today: c.today,
    api: API_VERSION,
    schema: SCHEMA_VERSION,
    settings: { minDate: s.Mindestdatum || MIN_DATE, maxPerDay: s.Plausi_max_m3_pro_Tag },
    last: last ? { date: last.date, time: last.minutes === null ? null : formatTime_(last.minutes), value: last.value } : null,
    readingsCount: c.readings.length,
    intervals: c.intervals,
    months: c.result.months.slice(-14),
    periods: c.result.periods,
    model: m
      ? {
          a: round_(m.a, 4),
          aKWh: round_(m.a * factorToday, 3),
          b: round_(m.b, 3),
          theta: m.theta,
          thetaSource: m.thetaSource,
          n: m.n,
          excluded: m.excluded,
          coverage: round_(m.coverage, 3),
          cv: m.cv === null ? null : round_(m.cv, 3),
          relSeA: round_(m.relSeA, 3),
        }
      : null,
    rating: c.result.rating,
    insights: c.insights,
    weather: { last: c.weatherLast, station: dwdStation_(s.DWD_Station) },
    hints: c.hints,
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
  let ss = null;
  try {
    const body = parseBody_(e);
    const props = PropertiesService.getScriptProperties().getProperties();
    if (!props.KEY || !props.SHEET_ID) {
      throw apiError_('NOT_CONFIGURED', 'Server ist noch nicht eingerichtet – im Sheet „Gaszähler → Einrichten / aktualisieren“ wählen.');
    }
    if (!safeEqual_(body.key, props.KEY)) throw apiError_('AUTH', 'Falscher Schlüssel');
    ss = SpreadsheetApp.openById(props.SHEET_ID);
    if (body.action === 'overview') return ok_({ overview: buildOverview_(ss) });
    if (body.action === 'addReading') return ok_(addReadingAction_(ss, body.reading));
    throw apiError_('BAD_REQUEST', 'Unbekannte Aktion');
  } catch (err) {
    if (err && err.code) return fail_(err.code, err.message, err.details);
    // Unerwarteter Fehler: vor der Anmeldung (ss noch null) nichts verraten, danach zeigen und protokollieren.
    if (!ss) return fail_('SERVER', 'Serverfehler');
    logEvent_(ss, 'FEHLER', 'api', (err && err.stack) || String(err));
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

/**
 * Speichert eine Ablesung unter Sperre (keine zwei Schreibvorgänge gleichzeitig). Jeder Tab wird nur einmal
 * gelesen: dieselben Eingaben dienen der Prüfung (inkl. Modell) und danach der neuen Übersicht.
 */
function addReadingAction_(ss, input) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw apiError_('BUSY', 'Server ist gerade beschäftigt – bitte gleich nochmal.');
  try {
    const inp = readInputs_(ss);
    const s = inp.settings.values;
    const r = normalizeReadingInput_(input, s.Zähler_aktuell);
    const before = computeFromInputs_(inp);
    const res = checkNewReading_(r, inp.readings.readings, {
      today: before.today,
      minDate: s.Mindestdatum,
      maxPerDay: s.Plausi_max_m3_pro_Tag,
      expect: modelExpectation_(before.result),
    });
    if (res.status !== 'new') return { saved: res.status, overview: buildOverview_(ss, before) };
    const row = appendReading_(ss, r, inp.readings.readings);
    SpreadsheetApp.flush(); // laut Doku vor dem Freigeben der Sperre
    if (row) inp.readings.readings.push(Object.assign({ row: row, exclude: false }, r));
    else inp.readings = readReadings_(ss); // nachgetragen und sortiert → Zeilennummern neu lesen
    return { saved: 'new', overview: buildOverview_(ss, computeFromInputs_(inp)) };
  } finally {
    lock.releaseLock();
  }
}

/** Erwartung aus dem Modell für einen neuen Zeitraum (nur bei brauchbarem Modell). */
function modelExpectation_(result) {
  const m = result.model;
  if (!m || result.rating.level === 'rot') return null;
  return (before, r) => {
    const days = pairDays_({ a: before, b: r }, result.temps);
    return days ? predictPair_(m, days, r.t - before.t) : null;
  };
}

// ===== Job.gs =====

/**
 * Job.gs – täglicher Lauf (Zeit-Trigger) und Ergebnistabellen „Tage“ / „Monate“.
 *
 * Der DWD veröffentlicht die Tageswerte vormittags (UTC) – deshalb läuft der Trigger mittags.
 */

const DAILY_FUNCTION = 'taeglich';
const DAILY_HOUR = 13; // zufällige Minute zwischen 13 und 14 Uhr (Europe/Berlin)

/** Wird vom Zeit-Trigger aufgerufen: Wetter holen, neu rechnen, Tabellen schreiben. */
function taeglich() {
  const ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SHEET_ID'));
  const report = runDaily_(ss);
  if (report.fatal) throw report.fatal; // → Google schickt die Fehler-Mail
}

/** Ein Durchlauf; Fehler beim Wetter brechen nicht ab. Rückgabe { text, fatal }. */
function runDaily_(ss) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(60000)) return { text: 'übersprungen (Sperre belegt)', fatal: null };
  try {
    const settings = readSettings_(ss).values;
    const parts = [];
    let weatherError = null;
    try {
      parts.push(updateWeather_(ss, settings));
    } catch (e) {
      weatherError = e;
      parts.push('Wetter-Fehler: ' + e.message);
      logEvent_(ss, 'WARN', 'wetter', e.message);
    }
    const tables = writeResultTables_(ss);
    parts.push(tables.text);
    const text = parts.join(' · ');
    logEvent_(ss, weatherError ? 'WARN' : 'INFO', 'täglich', text);
    // Nur melden, wenn die Daten wirklich veralten (ein Ausfall des DWD für einen Tag ist kein Problem).
    const last = tables.weatherLast;
    const stale = !last || dayNumber_(tables.today) - dayNumber_(last) > 3;
    return { text: text, fatal: weatherError && stale ? weatherError : null };
  } finally {
    lock.releaseLock();
  }
}

/** Schreibt „Tage“ und „Monate“ neu. Rückgabe { text, weatherLast, today }. */
function writeResultTables_(ss) {
  const c = computeFromSheet_(ss);
  const v = x => (x === null || x === undefined ? '' : x);
  const dayRows = c.result.days.map(d => [
    berlinMidnight_(d.date),
    v(d.tm),
    v(d.tmSrc),
    v(d.hgt === null ? null : round_(d.hgt, 2)),
    v(d.g === null ? null : round_(d.g, 2)),
    v(d.hgtNormal === null ? null : round_(d.hgtNormal, 2)),
    v(d.m3 === null ? null : round_(d.m3, 4)),
    v(d.kWh === null ? null : round_(d.kWh, 2)),
    round_(d.covered, 3),
    v(d.ap),
    v(d.costWork === null ? null : round_(d.costWork, 4)),
    v(d.costBase === null ? null : round_(d.costBase, 4)),
    d.costBase === null ? '' : round_((d.costWork || 0) + d.costBase, 4),
  ]);
  writeTable_(ss, 'Tage', dayRows);
  const monthRows = c.result.months.map(m => [m.month, m.days, m.hgt, v(m.hgtNormal), m.m3, m.kWh, v(m.cost), m.coverage]);
  writeTable_(ss, 'Monate', monthRows);
  return { text: 'Tage: ' + dayRows.length + ', Monate: ' + monthRows.length, weatherLast: c.weatherLast, today: c.today };
}

/** Legt den täglichen Trigger genau einmal an (alte Trigger dieser Funktion werden ersetzt). */
function installTriggers_() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === DAILY_FUNCTION)
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger(DAILY_FUNCTION).timeBased().atHour(DAILY_HOUR).everyDays(1).inTimezone(TZ).create();
}

function menuDaily() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const report = runDaily_(ss);
  showAlert_('Wetter & Berechnung', report.text + (report.fatal ? '\n\nFehler: ' + report.fatal.message : ''));
}

// ===== Setup.gs =====

/**
 * Setup.gs – Einrichtung, Migration, Menü im Sheet, Schlüsselverwaltung.
 *
 * setup() ist idempotent: mehrfach ausführen schadet nie. Es legt fehlende Tabs, Spalten und
 * Einstellungen an, ändert aber keine vorhandenen Daten.
 */

/** Einmalig (und nach jedem Update) im Skript-Editor ausführen – Ergebnis steht im Ausführungsprotokoll. */
function setup() {
  Logger.log(runSetup_());
}

/** Dasselbe über das Menü im Sheet – mit Meldung (im Editor würde die Meldung unsichtbar im Sheet warten). */
function menuSetup() {
  showAlert_('Gaszähler', runSetup_());
}

function runSetup_() {
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
  SpreadsheetApp.flush();

  installTriggers_();
  report.push('Täglicher Lauf eingerichtet (' + DAILY_HOUR + '–' + (DAILY_HOUR + 1) + ' Uhr)');
  logEvent_(ss, 'INFO', 'setup', report.join('; '));
  const daily = runDaily_(ss); // Wetter holen (beim ersten Mal inkl. Historie) und rechnen

  const lines = ['Einrichtung abgeschlossen (Schema ' + SCHEMA_VERSION + ').'];
  lines.push(report.join('\n'));
  lines.push(daily.text);
  if (newKey) lines.push('Neuer Schlüssel für die App: ' + props.getProperty('KEY'));
  else lines.push('Schlüssel unverändert – anzeigen über „Gaszähler → Schlüssel anzeigen“.');
  return lines.join('\n\n');
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
    const value = def.type === 'date' && def.value ? berlinMidnight_(def.value) : def.value;
    settings.appendRow([def.key, value, def.text]);
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
    .addItem('Wetter aktualisieren & neu berechnen', 'menuDaily')
    .addItem('Schlüssel anzeigen', 'menuShowKey')
    .addSeparator()
    .addItem('Einrichten / aktualisieren', 'menuSetup')
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
