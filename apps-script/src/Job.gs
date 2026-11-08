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
