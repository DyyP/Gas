// Zahlen, Datum und Zeit – deutsch formatiert, lokal gerechnet.

/** „2309,567“, „2309.567“, „2.309,567“ → Zahl; sonst NaN. */
export function parseReading(text) {
  if (typeof text !== 'string') return NaN;
  let s = text.replace(/[\s  ]/g, '');
  if (s === '') return NaN;
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '');
  s = s.replace(',', '.');
  if (!/^(\d+\.?\d*|\.\d+)$/.test(s)) return NaN;
  return Number(s);
}

const nf = new Map();
export function formatNumber(x, digits) {
  if (x === null || x === undefined || !Number.isFinite(x)) return '–';
  if (!nf.has(digits)) nf.set(digits, new Intl.NumberFormat('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits }));
  return nf.get(digits).format(x);
}

/** JJJJ-MM-TT → TT.MM.JJJJ */
export const formatDate = iso => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
/** JJJJ-MM-TT → TT.MM. */
export const formatDateShort = iso => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;

const pad = n => String(n).padStart(2, '0');
/** Lokales Datum des Geräts als JJJJ-MM-TT (nicht UTC!). */
export const localIsoDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const localTime = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function isIsoDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  if (!m) return false;
  const d = new Date(0);
  d.setUTCFullYear(+m[1], +m[2] - 1, +m[3]);
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

export function dayNumber(iso) {
  const d = new Date(0);
  d.setUTCFullYear(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  return Math.round(d.getTime() / 86400000);
}

export const daysBetween = (fromIso, toIso) => dayNumber(toIso) - dayNumber(fromIso);

export function relativeDays(n) {
  if (n <= 0) return 'heute';
  if (n === 1) return 'gestern';
  return `vor ${n} Tagen`;
}

/** Zeitpunkt als gebrochene Tagesnummer (ohne Uhrzeit 12:00) – wie im Backend. */
export function readingT(iso, time) {
  let minutes = 12 * 60;
  const m = /^(\d{1,2}):(\d{2})$/.exec(time || '');
  if (m) minutes = +m[1] * 60 + +m[2];
  return dayNumber(iso) + minutes / 1440;
}

export function formatDateTime(isoString) {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return '–';
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const monthFmt = new Intl.DateTimeFormat('de-DE', { month: 'short', year: '2-digit', timeZone: 'UTC' });
/** „2025-11“ → „Nov. 25“ */
export function formatMonth(ym) {
  const d = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1, 1));
  return monthFmt.format(d);
}

/** Euro mit zwei Nachkommastellen: 154.32 → „154,32 €“ */
export const formatEuro = x => `${formatNumber(x, 2)} €`;
