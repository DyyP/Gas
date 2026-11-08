/**
 * Domain.gs – Fachlogik für Ablesungen (rein, in Node testbar).
 *
 * Eine Ablesung: { row, date: 'JJJJ-MM-TT', minutes: Zahl|null, t, value, meter, exclude }
 * t = gebrochene Tagesnummer (Datum + Uhrzeit; ohne Uhrzeit 12:00).
 */

/** Prüft die Eingabe aus der App auf Form und Typ. Der Zähler kommt aus den Einstellungen. */
function normalizeReadingInput_(input, meter) {
  if (!input || typeof input !== 'object') throw apiError_('BAD_REQUEST', 'Ablesung fehlt');
  if (!isIsoDate_(input.date)) throw apiError_('VALIDATION', 'Ungültiges Datum');
  const minutes = parseTime_(input.time);
  if (typeof minutes === 'number' && isNaN(minutes)) throw apiError_('VALIDATION', 'Ungültige Uhrzeit');
  const value = input.value;
  if (typeof value !== 'number' || !isFinite(value) || value < 0 || value >= 1e7) {
    throw apiError_('VALIDATION', 'Ungültiger Zählerstand');
  }
  return {
    date: input.date,
    minutes: minutes,
    t: readingT_(input.date, minutes),
    value: round_(value, 3), // Zähler zeigt 3 Nachkommastellen
    meter: norm_(meter),
    confirmed: input.confirmed === true,
  };
}

/**
 * Entscheidet, ob eine neue Ablesung gespeichert wird. Ein Stand pro Tag und Zähler: gleicher Tag + gleicher
 * Wert = Duplikat (wiederholtes Senden ist damit immer sicher), anderer Wert = Konflikt.
 * ctx: { today, minDate, maxPerDay } · Rückgabe { status: 'new' | 'duplicate' } oder wirft.
 */
function checkNewReading_(r, readings, ctx) {
  const same = readings.filter(x => x.meter === r.meter).sort((a, b) => a.t - b.t);
  const sameDay = same.find(x => x.date === r.date);
  if (sameDay) {
    if (Math.abs(sameDay.value - r.value) < 0.0005) return { status: 'duplicate' };
    throw apiError_(
      'CONFLICT',
      'Für den ' + deDate_(r.date) + ' gibt es schon den Stand ' + deNum_(sameDay.value, 3) + ' m³. Korrektur bitte im Sheet.',
      { date: r.date, existing: sameDay.value }
    );
  }

  const lower = ctx.minDate && ctx.minDate > MIN_DATE ? ctx.minDate : MIN_DATE;
  if (r.date < lower) throw apiError_('VALIDATION', 'Datum liegt vor dem ' + deDate_(lower));
  if (r.date > ctx.today) throw apiError_('VALIDATION', 'Datum liegt in der Zukunft');

  const before = same.filter(x => x.t < r.t).pop() || null;
  const after = same.find(x => x.t > r.t) || null;
  if (before && r.value < before.value) {
    throw apiError_('VALIDATION', 'Stand ist kleiner als am ' + deDate_(before.date) + ' (' + deNum_(before.value, 3) + ' m³)');
  }
  if (after && r.value > after.value) {
    throw apiError_('VALIDATION', 'Stand ist größer als am ' + deDate_(after.date) + ' (' + deNum_(after.value, 3) + ' m³)');
  }

  if (!r.confirmed && ctx.maxPerDay > 0) {
    // Mindestens 1 Stunde Abstand, sonst wird die Rate bei Ablesungen um Mitternacht künstlich riesig
    const rate = (dv, dt) => dv / Math.max(dt, 1 / 24);
    const checks = [];
    if (before) checks.push({ ref: before, perDay: rate(r.value - before.value, r.t - before.t) });
    if (after) checks.push({ ref: after, perDay: rate(after.value - r.value, after.t - r.t) });
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

/** Sortiert je Zähler, entfernt doppelte Tage (erste Zeile zählt) und meldet sie. */
function cleanReadings_(readings) {
  const hints = [];
  const sorted = readings.slice().sort((a, b) => (a.meter < b.meter ? -1 : a.meter > b.meter ? 1 : a.t - b.t || a.row - b.row));
  const out = [];
  for (const r of sorted) {
    const prev = out[out.length - 1];
    if (prev && prev.meter === r.meter && prev.date === r.date) {
      hints.push({ level: 'warn', text: 'Ablesungen Zeile ' + prev.row + ' und ' + r.row + ': zwei Stände am ' + deDate_(r.date) + ' – nur Zeile ' + prev.row + ' zählt.' });
      continue;
    }
    out.push(r);
  }
  return { readings: out, hints: hints };
}

/**
 * Aufeinanderfolgende Ablesungen desselben Zählers als Paare {a, b, dv}. Rückläufige Stände werden gemeldet
 * und übersprungen. Einzige Stelle, die festlegt, was ein gültiger Ablesezeitraum ist.
 */
function readingPairs_(readings) {
  const pairs = [];
  const hints = [];
  for (let i = 1; i < readings.length; i++) {
    const a = readings[i - 1];
    const b = readings[i];
    if (a.meter !== b.meter) continue;
    const dv = round_(b.value - a.value, 3);
    if (dv < 0) {
      hints.push({ level: 'warn', text: 'Ablesungen Zeile ' + b.row + ': Stand am ' + deDate_(b.date) + ' ist kleiner als am ' + deDate_(a.date) + ' – Zeitraum wird ignoriert.' });
      continue;
    }
    pairs.push({ a: a, b: b, dv: dv });
  }
  return { pairs: pairs, hints: hints };
}

/** Letzte Zeile mit from ≤ iso (Liste nach from sortiert) oder null. */
function validAt_(rows, iso) {
  let hit = null;
  for (const r of rows) if (r.from <= iso) hit = r;
  return hit;
}

/** kWh je m³ an einem Tag: Brennwert × Zustandszahl aus „Umrechnung“, sonst Platzhalter. */
function factorAt_(conversions, iso, placeholder) {
  const c = validAt_(conversions, iso);
  return c ? { factor: c.z * c.hs, source: c.status || 'Tabelle' } : { factor: placeholder.z * placeholder.hs, source: 'Platzhalter' };
}

/** Zeiträume zwischen Ablesungen für die Anzeige (neueste zuerst). */
function buildIntervals_(pairs, conversions, placeholder) {
  return pairs
    .map(p => {
      const days = p.b.t - p.a.t;
      const conv = factorAt_(conversions, p.b.date, placeholder);
      return {
        from: p.a.date,
        to: p.b.date,
        meter: p.b.meter,
        days: round_(days, 3),
        m3: p.dv,
        m3PerDay: round_(p.dv / days, 4),
        kWh: round_(p.dv * conv.factor, 1),
        kWhPerDay: round_((p.dv * conv.factor) / days, 2),
        conversion: conv.source,
        excluded: p.b.exclude === true,
      };
    })
    .reverse();
}
