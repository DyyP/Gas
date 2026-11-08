/**
 * Overview.gs – sammelt alle Eingaben, rechnet und baut die Übersicht für die App.
 */

/** Liest alle Tabs und rechnet. Rückgabe { s, today, readings, result, intervals, hints, weatherLast }. */
function computeFromSheet_(ss) {
  const today = Utilities.formatDate(now_(), TZ, 'yyyy-MM-dd');
  const settings = readSettings_(ss);
  const s = settings.values;
  const raw = readReadings_(ss);
  const conv = readConversions_(ss);
  const tar = readTariffs_(ss);
  const pay = readPaymentRows_(ss);
  const per = readPeriods_(ss);
  const weather = readWeather_(ss);
  const cleaned = cleanReadings_(raw.readings);
  const placeholder = { z: s.Platzhalter_Zustandszahl, hs: s.Platzhalter_Brennwert_kWh_m3 };
  const iv = buildIntervals_(cleaned.readings, conv.conversions, placeholder);
  const result = computeAll_({
    readings: cleaned.readings,
    weather: weather.map,
    conversions: conv.conversions,
    placeholder: placeholder,
    tariffs: tar.tariffs,
    payments: pay.payments,
    periods: per.periods,
    settings: s,
    today: today,
  });

  const hints = [].concat(settings.hints, raw.hints, conv.hints, tar.hints, pay.hints, per.hints, cleaned.hints, iv.hints, result.hints);
  if (!cleaned.readings.length) hints.push({ level: 'info', text: 'Noch keine Ablesung gespeichert.' });
  if (iv.intervals.some(i => i.conversion === 'Platzhalter')) {
    hints.push({
      level: 'info',
      text: 'kWh mit Platzhalter (Zustandszahl ' + deNum_(placeholder.z, 4) + ' × Brennwert ' + deNum_(placeholder.hs, 3) +
        ') – echte Werte aus der Rechnung im Tab „Umrechnung“ eintragen.',
    });
  }
  if (!weather.last) {
    hints.push({ level: 'warn', text: 'Noch keine Wetterdaten – im Sheet „Gaszähler → Wetter aktualisieren & neu berechnen“ wählen.' });
  } else if (dayNumber_(today) - dayNumber_(weather.last) > 3) {
    hints.push({ level: 'warn', text: 'Wetterdaten veraltet (letzter Tag ' + deDate_(weather.last) + ') – Protokoll prüfen.' });
  }
  if (cleaned.readings.length && !per.periods.some(p => p.start <= today && p.end >= today)) {
    hints.push({ level: 'info', text: 'Keine Abrechnungsperiode für heute – im Tab „Perioden“ eine neue anlegen.' });
  }
  return { s: s, today: today, readings: cleaned.readings, intervals: iv.intervals, result: result, hints: hints, weatherLast: weather.last };
}

function buildOverview_(ss) {
  const c = computeFromSheet_(ss);
  const s = c.s;
  let last = null;
  for (const r of c.readings) if (!last || r.t > last.t) last = r;
  return {
    generatedAt: now_().toISOString(),
    today: c.today,
    api: API_VERSION,
    schema: SCHEMA_VERSION,
    settings: {
      minDate: s.Mindestdatum || MIN_DATE,
      maxPerDay: s.Plausi_max_m3_pro_Tag,
      meter: s.Zähler_aktuell,
    },
    last: last ? { date: last.date, time: last.minutes === null ? null : formatTime_(last.minutes), value: last.value, meter: last.meter } : null,
    readingsCount: c.readings.length,
    intervals: c.intervals,
    months: c.result.months.slice(-14),
    periods: c.result.periods,
    weather: { last: c.weatherLast, station: dwdStation_(s.DWD_Station), source: 'Deutscher Wetterdienst' },
    hints: c.hints,
  };
}
