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
