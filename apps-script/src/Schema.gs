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
    { key: 'Heizgrenze_C', type: 'number', value: 15, text: 'Tagesmittel, ab dem nicht mehr geheizt wird (für Heizgradtage)' },
    { key: 'Raumtemperatur_C', type: 'number', value: 20, text: 'Für die Gradtagzahl G20/15 (VDI 3807)' },
    { key: 'Grundpreis_Verteilung', type: 'text', value: 'Jahr', text: '„Jahr“: Monatspreis × 12 / 365 je Tag · „Kalendermonat“: Monatspreis / Tage des Monats' },
  ];
}
