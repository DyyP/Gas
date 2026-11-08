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
