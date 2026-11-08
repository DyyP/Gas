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
