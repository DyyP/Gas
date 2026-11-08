// Nachbau der benutzten Apps-Script-Dienste für Tests in Node.
// Bildet nur das ab, was der Code wirklich aufruft – Verhalten so nah wie möglich am Original.
import vm from 'node:vm';
import crypto from 'node:crypto';
import { bundle } from '../../tools/bundle.mjs';

const TZ = 'Europe/Berlin';

function partsInTz(date, tz) {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const p = {};
  for (const x of f.formatToParts(date)) p[x.type] = x.value;
  return p;
}

export function formatDate(date, tz, pattern) {
  const p = partsInTz(date, tz);
  const map = { yyyy: p.year, MM: p.month, dd: p.day, HH: p.hour, mm: p.minute, ss: p.second };
  return pattern.replace(/'([^']*)'|yyyy|MM|dd|HH|mm|ss/g, (m, lit) => (lit !== undefined ? lit : map[m]));
}

export function zonedToUtc(y, mo, d, h, mi, tz) {
  const target = Date.UTC(y, mo - 1, d, h, mi);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const p = partsInTz(new Date(guess), tz);
    guess += target - Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  }
  return new Date(guess);
}

function parseDate(str, tz, pattern) {
  let m;
  if (pattern === 'yyyy-MM-dd' && (m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str))) return zonedToUtc(+m[1], +m[2], +m[3], 0, 0, tz);
  if (pattern === 'yyyy-MM-dd HH:mm' && (m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(str))) {
    return zonedToUtc(+m[1], +m[2], +m[3], +m[4], +m[5], tz);
  }
  throw new Error(`Fake parseDate: Muster nicht unterstützt: ${pattern} / ${str}`);
}

const isDate = v => Object.prototype.toString.call(v) === '[object Date]';

function displayOf(v, fmt) {
  if (v === '' || v === null || v === undefined) return '';
  if (isDate(v)) return formatDate(v, TZ, fmt && /hh/i.test(fmt) ? 'dd.MM.yyyy HH:mm' : 'dd.MM.yyyy');
  if (typeof v === 'number') {
    const m = fmt && /^0(?:\.(0+))?$/.exec(fmt);
    const s = m ? v.toFixed(m[1] ? m[1].length : 0) : String(v);
    return s.replace('.', ',');
  }
  if (typeof v === 'boolean') return v ? 'WAHR' : 'FALSCH';
  return String(v);
}

function compareCells(a, b) {
  const blank = x => x === '' || x === null || x === undefined;
  if (blank(a) && blank(b)) return 0;
  if (blank(a)) return 1;
  if (blank(b)) return -1;
  const ka = isDate(a) ? a.getTime() : a;
  const kb = isDate(b) ? b.getTime() : b;
  if (typeof ka === 'number' && typeof kb === 'number') return ka - kb;
  return String(ka) < String(kb) ? -1 : String(ka) > String(kb) ? 1 : 0;
}

export class FakeSheet {
  constructor(name) {
    this.name = name;
    this.data = []; // data[r][c], 0-basiert
    this.formats = new Map(); // "r,c" → Format (1-basiert)
    this.validations = new Map();
    this.protections = [];
    this.frozenRows = 0;
    this.maxRows = 1000;
  }
  getName() { return this.name; }
  setName(n) { this.name = n; return this; }
  getMaxRows() { return Math.max(this.maxRows, this.data.length); }
  getLastRow() {
    for (let r = this.data.length - 1; r >= 0; r--) if ((this.data[r] || []).some(v => v !== '' && v !== null && v !== undefined)) return r + 1;
    return 0;
  }
  getLastColumn() {
    let max = 0;
    for (const row of this.data) for (let c = (row || []).length - 1; c >= 0; c--) if (row[c] !== '' && row[c] !== undefined) { max = Math.max(max, c + 1); break; }
    return max;
  }
  get(r, c) { const row = this.data[r - 1]; const v = row ? row[c - 1] : undefined; return v === undefined ? '' : v; }
  set(r, c, v) {
    while (this.data.length < r) this.data.push([]);
    const row = this.data[r - 1];
    while (row.length < c) row.push('');
    row[c - 1] = v;
  }
  getRange(row, col, nr = 1, nc = 1) {
    if (typeof row !== 'number') throw new Error('Fake: nur numerische getRange');
    if (row < 1 || col < 1 || nr < 1 || nc < 1) throw new Error(`Fake: ungültiger Bereich ${row},${col},${nr},${nc}`);
    return new FakeRange(this, row, col, nr, nc);
  }
  appendRow(values) { const r = this.getLastRow() + 1; values.forEach((v, i) => this.set(r, i + 1, v)); return this; }
  deleteRows(start, n) { this.data.splice(start - 1, n); }
  setFrozenRows(n) { this.frozenRows = n; }
  protect() {
    const p = { description: '', warningOnly: false };
    p.setDescription = d => { p.description = d; return p; };
    p.setWarningOnly = w => { p.warningOnly = w; return p; };
    this.protections.push(p);
    return p;
  }
  getProtections() { return this.protections.slice(); }
  /** Testhilfe: Zeilen als Arrays (ohne Kopfzeile ab Zeile 2). */
  rows() { return this.data.slice(1).map(r => r.slice()); }
}

class FakeRange {
  constructor(sheet, row, col, nr, nc) { Object.assign(this, { sheet, row, col, nr, nc }); }
  cells(fn) { for (let r = 0; r < this.nr; r++) for (let c = 0; c < this.nc; c++) fn(this.row + r, this.col + c, r, c); }
  getValues() {
    const out = [];
    for (let r = 0; r < this.nr; r++) {
      const row = [];
      for (let c = 0; c < this.nc; c++) row.push(this.sheet.get(this.row + r, this.col + c));
      out.push(row);
    }
    return out;
  }
  getDisplayValues() {
    return this.getValues().map((row, r) => row.map((v, c) => displayOf(v, this.sheet.formats.get(`${this.row + r},${this.col + c}`))));
  }
  setValues(values) {
    if (values.length !== this.nr || values.some(r => r.length !== this.nc)) throw new Error('Fake: Größe von setValues passt nicht zum Bereich');
    this.cells((R, C, r, c) => this.sheet.set(R, C, values[r][c]));
    return this;
  }
  setValue(v) { this.sheet.set(this.row, this.col, v); return this; }
  setNumberFormat(f) { this.cells((R, C) => this.sheet.formats.set(`${R},${C}`, f)); return this; }
  setDataValidation(v) { this.cells((R, C) => this.sheet.validations.set(`${R},${C}`, v)); return this; }
  setFontWeight() { return this; }
  sort(specs) {
    const list = Array.isArray(specs) ? specs : [specs];
    const rows = this.getValues();
    const idx = rows.map((_, i) => i);
    idx.sort((i, j) => {
      for (const s of list) {
        const col = (typeof s === 'number' ? s : s.column) - this.col;
        const asc = typeof s === 'number' ? true : s.ascending !== false;
        const d = compareCells(rows[i][col], rows[j][col]);
        if (d) return asc ? d : -d;
      }
      return i - j;
    });
    const sorted = idx.map(i => rows[i]);
    this.cells((R, C, r, c) => this.sheet.set(R, C, sorted[r][c]));
    return this;
  }
}

export class FakeSpreadsheet {
  constructor(id = 'sheet-id-1') {
    this.id = id;
    this.sheets = [new FakeSheet('Tabellenblatt1')];
    this.timeZone = 'America/Los_Angeles';
    this.locale = 'en_US';
  }
  getId() { return this.id; }
  getSheets() { return this.sheets.slice(); }
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
  insertSheet(n) {
    if (this.getSheetByName(n)) throw new Error(`Fake: Tab ${n} existiert schon`);
    const s = new FakeSheet(n);
    this.sheets.push(s);
    return s;
  }
  setSpreadsheetTimeZone(tz) { this.timeZone = tz; }
  setSpreadsheetLocale(l) { this.locale = l; }
}

/**
 * Lädt das gebündelte Backend in eine isolierte Umgebung.
 * Optionen: now (ISO-String), ss (FakeSpreadsheet), active (true: getActiveSpreadsheet liefert ss), props
 */
export function loadBackend({ now = '2026-11-08T10:00:00Z', ss = new FakeSpreadsheet(), active = true, props = {} } = {}) {
  const logs = [];
  const errors = [];
  const store = { ...props };
  const cache = new Map();
  const state = { lockFree: true, ui: null, nowMs: Date.parse(now) };
  const ctx = {
    console: { log: m => logs.push(String(m)), error: m => errors.push(String(m)), warn: m => logs.push(String(m)) },
    Logger: { log: m => logs.push(String(m)) },
    Utilities: { formatDate, parseDate, getUuid: () => crypto.randomUUID() },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: k => (k in store ? store[k] : null),
        setProperty: (k, v) => { store[k] = String(v); },
        getProperties: () => ({ ...store }),
        deleteProperty: k => { delete store[k]; },
      }),
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => state.lockFree,
        waitLock: () => { if (!state.lockFree) throw new Error('Lock timeout'); },
        releaseLock: () => {},
      }),
    },
    CacheService: {
      getScriptCache: () => ({ get: k => (cache.has(k) ? cache.get(k) : null), put: (k, v) => cache.set(k, v) }),
    },
    ContentService: {
      MimeType: { JSON: 'JSON' },
      createTextOutput: s => { const o = { content: s, mime: null }; o.setMimeType = m => { o.mime = m; return o; }; o.getContent = () => o.content; return o; },
    },
    SpreadsheetApp: {
      ProtectionType: { SHEET: 'SHEET', RANGE: 'RANGE' },
      openById: id => { if (id !== ss.getId()) throw new Error(`Fake: unbekannte ID ${id}`); return ss; },
      getActiveSpreadsheet: () => (active ? ss : null),
      flush: () => {},
      getUi: () => { if (!state.ui) throw new Error('Cannot call SpreadsheetApp.getUi() from this context.'); return state.ui; },
      newDataValidation: () => {
        const b = { list: null, allowInvalid: true };
        b.requireValueInList = l => { b.list = l; return b; };
        b.setAllowInvalid = a => { b.allowInvalid = a; return b; };
        b.build = () => ({ list: b.list, allowInvalid: b.allowInvalid });
        return b;
      },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(bundle(), ctx, { filename: 'Gaszaehler.gs' });
  ctx.now_ = () => new Date(state.nowMs);

  const post = body => {
    const contents = typeof body === 'string' ? body : JSON.stringify(body);
    const out = ctx.doPost({ postData: { contents, length: contents.length, type: 'text/plain', name: 'postData' }, parameter: {} });
    return JSON.parse(out.getContent());
  };
  return {
    ctx, ss, store, logs, errors, state, post,
    setNow: iso => { state.nowMs = Date.parse(iso); },
    sheet: name => ss.getSheetByName(name),
  };
}

/** Testhilfe: Ablesungen direkt ins Sheet schreiben (wie von Hand eingetragen). */
export function putReadings(sheet, rows) {
  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const col = n => header.indexOf(n) + 1;
  for (const r of rows) {
    const row = sheet.getLastRow() + 1;
    const [y, m, d] = r.date.split('-').map(Number);
    sheet.set(row, col('Datum'), r.dateValue !== undefined ? r.dateValue : zonedToUtc(y, m, d, 0, 0, TZ));
    sheet.set(row, col('Stand_m3'), r.value);
    if (r.time !== undefined) sheet.set(row, col('Uhrzeit'), r.time);
    if (r.meter !== undefined) sheet.set(row, col('Zähler'), r.meter);
    if (r.model !== undefined) sheet.set(row, col('Modell'), r.model);
    if (r.id !== undefined) sheet.set(row, col('ID'), r.id);
  }
}
