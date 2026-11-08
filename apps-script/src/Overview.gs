/**
 * Overview.gs – liest alle Tabs (einmal pro Anfrage), rechnet und baut die Übersicht für die App.
 */

/** Alle Eingaben aus dem Sheet. */
function readInputs_(ss) {
  return {
    settings: readSettings_(ss),
    readings: readReadings_(ss),
    conversions: readSorted_(ss, 'Umrechnung'),
    tariffs: readSorted_(ss, 'Tarife'),
    payments: readSorted_(ss, 'Abschläge'),
    periods: readPeriods_(ss),
    weather: readWeather_(ss),
  };
}

/** Rechnet aus den Eingaben. Rückgabe { s, today, readings, intervals, result, hints, weatherLast, conversions, placeholder }. */
function computeFromInputs_(inp) {
  const today = Utilities.formatDate(now_(), TZ, 'yyyy-MM-dd');
  const s = inp.settings.values;
  const cleaned = cleanReadings_(inp.readings.readings);
  const pairs = readingPairs_(cleaned.readings);
  const placeholder = { z: s.Platzhalter_Zustandszahl, hs: s.Platzhalter_Brennwert_kWh_m3 };
  const input = {
    readings: cleaned.readings,
    pairs: pairs.pairs,
    weather: inp.weather.map,
    conversions: inp.conversions.rows,
    placeholder: placeholder,
    tariffs: inp.tariffs.rows,
    payments: inp.payments.rows,
    periods: inp.periods.periods,
    settings: s,
    today: today,
  };
  const result = computeAll_(input);
  const intervals = buildIntervals_(pairs.pairs, inp.conversions.rows, placeholder, result.temps);
  const now = now_();
  const nowT = dayNumber_(today) + (parseTime_(Utilities.formatDate(now, TZ, 'HH:mm')) || 0) / 1440;
  const insights = cleaned.readings.length ? insights_(result, input, nowT) : null;

  const hints = [].concat(
    inp.settings.hints, inp.readings.hints, inp.conversions.hints, inp.tariffs.hints, inp.payments.hints, inp.periods.hints,
    cleaned.hints, pairs.hints, result.hints
  );
  if (!cleaned.readings.length) hints.push({ level: 'info', text: 'Noch keine Ablesung gespeichert.' });
  if (intervals.some(i => i.conversion === 'Platzhalter')) {
    hints.push({
      level: 'info',
      text: 'kWh mit Platzhalter (Zustandszahl ' + deNum_(placeholder.z, 4) + ' × Brennwert ' + deNum_(placeholder.hs, 3) +
        ') – echte Werte aus der Rechnung im Tab „Umrechnung“ eintragen.',
    });
  }
  const last = inp.weather.last;
  if (!last) {
    hints.push({ level: 'warn', text: 'Noch keine Wetterdaten – im Sheet „Gaszähler → Wetter aktualisieren & neu berechnen“ wählen.' });
  } else if (dayNumber_(today) - dayNumber_(last) > 3) {
    hints.push({ level: 'warn', text: 'Wetterdaten veraltet (letzter Tag ' + deDate_(last) + ') – Protokoll prüfen.' });
  }
  if (cleaned.readings.length && !inp.periods.periods.some(p => p.start <= today && p.end >= today)) {
    hints.push({ level: 'info', text: 'Keine Abrechnungsperiode für heute – im Tab „Perioden“ eine neue anlegen.' });
  }
  return {
    s: s, today: today, readings: cleaned.readings, intervals: intervals, result: result, hints: hints, weatherLast: last,
    conversions: inp.conversions.rows, placeholder: placeholder, insights: insights,
  };
}

function computeFromSheet_(ss) {
  return computeFromInputs_(readInputs_(ss));
}

/** Übersicht für die App; `c` = Ergebnis von computeFromInputs_ (sonst wird gelesen und gerechnet). */
function buildOverview_(ss, c) {
  c = c || computeFromSheet_(ss);
  const s = c.s;
  const m = c.result.model;
  let last = null;
  for (const r of c.readings) if (!last || r.t > last.t) last = r;
  const factorToday = factorAt_(c.conversions, c.today, c.placeholder).factor;
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
    model: m
      ? {
          a: round_(m.a, 4),
          aKWh: round_(m.a * factorToday, 3),
          b: round_(m.b, 3),
          theta: m.theta,
          thetaSource: m.thetaSource,
          n: m.n,
          excluded: m.excluded,
          coverage: round_(m.coverage, 3),
          cv: m.cv === null ? null : round_(m.cv, 3),
          relSeA: round_(m.relSeA, 3),
        }
      : null,
    rating: c.result.rating,
    insights: c.insights,
    weather: { last: c.weatherLast, station: dwdStation_(s.DWD_Station) },
    hints: c.hints,
  };
}
