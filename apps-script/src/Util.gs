/**
 * Util.gs – reine Hilfsfunktionen ohne Apps-Script-Dienste (in Node testbar).
 *
 * Regel für alle Dateien: Auf oberster Ebene nur Funktionen und Literal-Konstanten,
 * keine Abhängigkeiten zwischen Dateien beim Laden.
 */

const API_VERSION = 1;
const SCHEMA_VERSION = 2;
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
