/**
 * Domain.gs – Fachlogik für Ablesungen (rein, in Node testbar).
 *
 * Eine Ablesung: { row, date: 'JJJJ-MM-TT', minutes: Zahl|null, t, value, meter, source, exclude, id }
 * t = gebrochene Tagesnummer (Datum + Uhrzeit; ohne Uhrzeit 12:00).
 */

/** Prüft die Eingabe aus der App auf Form und Typ und normalisiert sie. */
function normalizeReadingInput_(input, defaultMeter) {
  if (!input || typeof input !== 'object') throw apiError_('BAD_REQUEST', 'Ablesung fehlt');
  const id = input.id === undefined || input.id === null ? '' : input.id;
  if (typeof id !== 'string' || (id !== '' && !/^[A-Za-z0-9-]{8,64}$/.test(id))) {
    throw apiError_('BAD_REQUEST', 'Ungültige ID');
  }
  if (!isIsoDate_(input.date)) throw apiError_('VALIDATION', 'Ungültiges Datum');
  const minutes = parseTime_(input.time);
  if (typeof minutes === 'number' && isNaN(minutes)) throw apiError_('VALIDATION', 'Ungültige Uhrzeit');
  const value = input.value;
  if (typeof value !== 'number' || !isFinite(value) || value < 0 || value >= 1e7) {
    throw apiError_('VALIDATION', 'Ungültiger Zählerstand');
  }
  const meter = input.meter === undefined || input.meter === null ? defaultMeter : input.meter;
  // Enger Zeichensatz: landet als Text im Sheet (keine Formeln wie „=…“ einschleusbar)
  if (typeof meter !== 'string' || !/^[A-Za-z0-9 ._\/-]{0,40}$/.test(meter)) throw apiError_('BAD_REQUEST', 'Ungültige Zählernummer');
  return {
    id: id,
    date: input.date,
    minutes: minutes,
    t: readingT_(input.date, minutes),
    value: round_(value, 3), // Zähler zeigt 3 Nachkommastellen
    meter: norm_(meter),
    confirmed: input.confirmed === true,
  };
}

/**
 * Entscheidet, ob eine neue Ablesung gespeichert wird.
 * ctx: { today, minDate, maxPerDay }
 * Rückgabe { status: 'new' | 'duplicate' } oder wirft VALIDATION / CONFLICT / PLAUSIBILITY.
 */
function checkNewReading_(r, readings, ctx) {
  const same = readings.filter(x => x.meter === r.meter);
  const close = (a, b) => Math.abs(a - b) < 0.0005;

  // Zuerst Duplikate: Wiederholtes Senden muss immer gutgehen, auch wenn sich Regeln geändert haben.
  if (r.id) {
    const byId = readings.find(x => x.id === r.id);
    if (byId) {
      if (byId.date === r.date && close(byId.value, r.value)) return { status: 'duplicate' };
      throw apiError_('CONFLICT', 'Diese Ablesung wurde schon mit anderen Werten gespeichert.');
    }
  }
  const sameDay = same.find(x => x.date === r.date);
  if (sameDay) {
    if (close(sameDay.value, r.value)) return { status: 'duplicate' };
    throw apiError_(
      'CONFLICT',
      'Für den ' + deDate_(r.date) + ' gibt es schon den Stand ' + deNum_(sameDay.value, 3) + ' m³. Korrektur bitte im Sheet.',
      { date: r.date, existing: sameDay.value }
    );
  }

  const lower = ctx.minDate && ctx.minDate > MIN_DATE ? ctx.minDate : MIN_DATE;
  if (r.date < lower) throw apiError_('VALIDATION', 'Datum liegt vor dem ' + deDate_(lower));
  if (r.date > ctx.today) throw apiError_('VALIDATION', 'Datum liegt in der Zukunft');

  const sorted = same.slice().sort((a, b) => a.t - b.t);
  let before = null;
  let after = null;
  for (const x of sorted) {
    if (x.t < r.t) before = x;
    else if (!after) after = x;
  }
  if (before && r.value < before.value) {
    throw apiError_('VALIDATION', 'Stand ist kleiner als am ' + deDate_(before.date) + ' (' + deNum_(before.value, 3) + ' m³)');
  }
  if (after && r.value > after.value) {
    throw apiError_('VALIDATION', 'Stand ist größer als am ' + deDate_(after.date) + ' (' + deNum_(after.value, 3) + ' m³)');
  }

  if (!r.confirmed && ctx.maxPerDay > 0) {
    // Mindestens 1 Stunde Abstand ansetzen, sonst wird die Rate bei Ablesungen um Mitternacht künstlich riesig
    const gap = dt => Math.max(dt, 1 / 24);
    const checks = [];
    if (before) checks.push({ ref: before, perDay: (r.value - before.value) / gap(r.t - before.t) });
    if (after) checks.push({ ref: after, perDay: (after.value - r.value) / gap(after.t - r.t) });
    for (const c of checks) {
      if (c.perDay > ctx.maxPerDay) {
        throw apiError_(
          'PLAUSIBILITY',
          'Das wären ' + deNum_(c.perDay, 1) + ' m³ pro Tag seit dem ' + deDate_(c.ref.date) + ' – ungewöhnlich viel. Stimmt der Wert?',
          { perDay: round_(c.perDay, 2), maxPerDay: ctx.maxPerDay, refDate: c.ref.date }
        );
      }
    }
  }
  return { status: 'new' };
}

/**
 * Bereinigt die Ablesungen aus dem Sheet: sortiert, entfernt doppelte Tage und meldet
 * Auffälligkeiten. Rückgabe { readings, hints }.
 */
function cleanReadings_(readings) {
  const hints = [];
  const sorted = readings.slice().sort((a, b) => (a.meter < b.meter ? -1 : a.meter > b.meter ? 1 : a.t - b.t || a.row - b.row));
  const out = [];
  for (const r of sorted) {
    const prev = out.length ? out[out.length - 1] : null;
    if (prev && prev.meter === r.meter && prev.date === r.date) {
      hints.push({
        level: 'warn',
        text: 'Ablesungen Zeile ' + prev.row + ' und ' + r.row + ': zwei Stände am ' + deDate_(r.date) + ' – nur Zeile ' + prev.row + ' zählt.',
      });
      continue;
    }
    out.push(r);
  }
  return { readings: out, hints: hints };
}

/** Umrechnungsfaktor kWh/m³ für ein Datum: letzte Zeile mit Gültig_ab ≤ Datum, sonst Platzhalter. */
function conversionAt_(conversions, iso, placeholder) {
  let hit = null;
  for (const c of conversions) if (c.from <= iso && (!hit || c.from >= hit.from)) hit = c;
  if (!hit) return { factor: placeholder.z * placeholder.hs, source: 'Platzhalter' };
  return { factor: hit.z * hit.hs, source: hit.status || 'Tabelle' };
}

/**
 * Intervalle zwischen aufeinanderfolgenden Ablesungen desselben Zählers.
 * Rückgabe { intervals (neueste zuerst), hints }.
 */
function buildIntervals_(readings, conversions, placeholder) {
  const hints = [];
  const intervals = [];
  for (let i = 1; i < readings.length; i++) {
    const a = readings[i - 1];
    const b = readings[i];
    if (a.meter !== b.meter) continue;
    const days = b.t - a.t;
    const m3 = round_(b.value - a.value, 3);
    if (m3 < 0) {
      hints.push({
        level: 'warn',
        text: 'Ablesungen Zeile ' + b.row + ': Stand am ' + deDate_(b.date) + ' ist kleiner als am ' + deDate_(a.date) + ' – Zeitraum wird ignoriert.',
      });
      continue;
    }
    const conv = conversionAt_(conversions, b.date, placeholder);
    intervals.push({
      from: a.date,
      to: b.date,
      fromTime: a.minutes === null ? null : formatTime_(a.minutes),
      toTime: b.minutes === null ? null : formatTime_(b.minutes),
      meter: b.meter,
      days: round_(days, 3),
      m3: m3,
      m3PerDay: round_(m3 / days, 4),
      kWh: round_(m3 * conv.factor, 1),
      kWhPerDay: round_((m3 * conv.factor) / days, 2),
      conversion: conv.source,
      excluded: b.exclude === true,
    });
  }
  intervals.reverse();
  return { intervals: intervals, hints: hints };
}
