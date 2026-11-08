/**
 * Overview.gs – liest alle Tabs, rechnet und baut die Übersicht für die App.
 */

/**
 * Rechnet alles aus dem Sheet. `pre` (optional): schon gelesene { settings, readings } – spart beim Speichern
 * einer Ablesung zwei Lesezugriffe. Rückgabe { s, today, readings, intervals, result, hints, weatherLast }.
 */
function computeFromSheet_(ss, pre) {
  const today = Utilities.formatDate(now_(), TZ, 'yyyy-MM-dd');
  const settings = pre ? pre.settings : readSettings_(ss);
  const raw = pre ? pre.readings : readReadings_(ss);
  const s = settings.values;
  const conv = readSorted_(ss, 'Umrechnung');
  const tar = readSorted_(ss, 'Tarife');
  const pay = readSorted_(ss, 'Abschläge');
  const per = readPeriods_(ss);
  const weather = readWeather_(ss);
  const cleaned = cleanReadings_(raw.readings);
  const pairs = readingPairs_(cleaned.readings);
  const placeholder = { z: s.Platzhalter_Zustandszahl, hs: s.Platzhalter_Brennwert_kWh_m3 };
  const intervals = buildIntervals_(pairs.pairs, conv.rows, placeholder);
  const result = computeAll_({
    readings: cleaned.readings,
    pairs: pairs.pairs,
    weather: weather.map,
    conversions: conv.rows,
    placeholder: placeholder,
    tariffs: tar.rows,
    payments: pay.rows,
    periods: per.periods,
    settings: s,
    today: today,
  });

  const hints = [].concat(settings.hints, raw.hints, conv.hints, tar.hints, pay.hints, per.hints, cleaned.hints, pairs.hints, result.hints);
  if (!cleaned.readings.length) hints.push({ level: 'info', text: 'Noch keine Ablesung gespeichert.' });
  if (intervals.some(i => i.conversion === 'Platzhalter')) {
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
  return { s: s, today: today, readings: cleaned.readings, intervals: intervals, result: result, hints: hints, weatherLast: weather.last };
}

function buildOverview_(ss, pre) {
  const c = computeFromSheet_(ss, pre);
  const s = c.s;
  let last = null;
  for (const r of c.readings) if (!last || r.t > last.t) last = r;
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
    weather: { last: c.weatherLast, station: dwdStation_(s.DWD_Station) },
    hints: c.hints,
  };
}
