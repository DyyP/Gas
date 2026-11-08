/**
 * Calc.gs – Tagesrechnung, Kosten, Abschläge, Perioden (rein, in Node testbar).
 *
 * Konvention: Tag d (Tagesnummer) umfasst [d, d+1) in gebrochenen Tagesnummern; eine Ablesung zum Zeitpunkt t.
 */

/** Mitternacht Europe/Berlin als Date, ohne Utilities (EU-Sommerzeitregel seit 1996). */
function berlinMidnight_(iso) {
  const y = Number(iso.slice(0, 4));
  const n = dayNumber_(iso);
  const lastSunday = month => {
    const last = dayNumber_(y + '-' + month + '-31'); // März und Oktober haben 31 Tage
    const weekday = (last + 4) % 7; // 1970-01-01 war ein Donnerstag (4); 0 = Sonntag
    return last - weekday;
  };
  const summer = n > lastSunday('03') && n <= lastSunday('10');
  return new Date(n * 86400000 - (summer ? 2 : 1) * 3600000);
}

function isoRange_(fromIso, toIso) {
  const out = [];
  for (let n = dayNumber_(fromIso), end = dayNumber_(toIso); n <= end; n++) out.push(isoFromDayNumber_(n));
  return out;
}

/**
 * Temperatur je Tag mit Lückenfüllung: DWD-Wert, sonst linear interpoliert (Lücke ≤ 10 Tage),
 * am Ende fortgeschrieben (≤ 5 Tage nach dem letzten Wert, z. B. heute/gestern). Rückgabe { iso: {tm, src} }.
 */
function fillTemps_(weather, fromIso, toIso) {
  const out = {};
  const days = isoRange_(fromIso, toIso);
  const known = days.map(d => (weather[d] === undefined || weather[d] === null ? null : weather[d]));
  let prev = -1;
  for (let i = 0; i < days.length; i++) {
    if (known[i] !== null) {
      out[days[i]] = { tm: known[i], src: 'DWD' };
      prev = i;
      continue;
    }
    let next = i + 1;
    while (next < days.length && known[next] === null) next++;
    if (prev >= 0 && next < days.length && next - prev <= 11) {
      const tm = known[prev] + ((known[next] - known[prev]) * (i - prev)) / (next - prev);
      out[days[i]] = { tm: round_(tm, 2), src: 'interpoliert' };
    } else if (prev >= 0 && next >= days.length && i - prev <= 5) {
      out[days[i]] = { tm: known[prev], src: 'fortgeschrieben' };
    } else if (prev < 0 && next < days.length && next - i <= 5) {
      out[days[i]] = { tm: known[next], src: 'fortgeschrieben' };
    } else {
      out[days[i]] = { tm: null, src: null };
    }
  }
  return out;
}

/** HGT (stetig, fürs Modell) und Gradtagzahl G20/15 (VDI 3807) eines Tages. */
function degreeDays_(tm, heizgrenze, raum) {
  if (tm === null || tm === undefined) return { hgt: null, g: null };
  return { hgt: Math.max(0, heizgrenze - tm), g: tm < heizgrenze ? raum - tm : 0 };
}

/**
 * Verteilt den Verbrauch jedes Ablesepaars nach HGT auf die Tage (ohne Wärmebedarf oder ohne Temperatur
 * gleichmäßig). Rückgabe { m3: {iso: m³}, covered: {iso: Anteil 0–1}, hints }.
 */
function distributeReadings_(pairs, temps, heizgrenze) {
  const m3 = {};
  const covered = {};
  const missing = [];
  for (const p of pairs) {
    const parts = [];
    let sumW = 0;
    let gap = false;
    for (let d = Math.floor(p.a.t); d < p.b.t; d++) {
      const f = Math.min(p.b.t, d + 1) - Math.max(p.a.t, d);
      if (f <= 1e-9) continue;
      const iso = isoFromDayNumber_(d);
      const tm = temps[iso] ? temps[iso].tm : null;
      if (tm === null) gap = true;
      const w = tm === null ? 0 : f * Math.max(0, heizgrenze - tm);
      parts.push({ iso: iso, f: f, w: w });
      sumW += w;
    }
    if (gap) missing.push(deDate_(p.a.date) + '–' + deDate_(p.b.date));
    const uniform = gap || sumW <= 1e-9;
    const total = uniform ? p.b.t - p.a.t : sumW;
    for (const x of parts) {
      m3[x.iso] = (m3[x.iso] || 0) + (p.dv * (uniform ? x.f : x.w)) / total;
      covered[x.iso] = (covered[x.iso] || 0) + x.f;
    }
  }
  const hints = [];
  if (missing.length) {
    const list = missing.length <= 3 ? ' (' + missing.join(', ') + ')' : '';
    hints.push({ level: 'warn', text: missing.length + ' Zeitraum/Zeiträume ohne vollständige Temperatur' + list + ' – Verbrauch dort gleichmäßig verteilt.' });
  }
  return { m3: m3, covered: covered, hints: hints };
}

/** Grundpreis pro Tag aus Monatspreis: „Jahr“ = × 12 / 365, „Kalendermonat“ = / Tage des Monats. */
function basePerDay_(gpMonth, iso, method) {
  if (method === 'Kalendermonat') return gpMonth / daysInMonth_(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)));
  return (gpMonth * 12) / 365;
}

/**
 * Fällige Abschläge zwischen fromIso und toIso (inklusive). rows: [{from, amount, day}] nach from sortiert;
 * jede Zeile gilt bis zum Gültig_ab der nächsten. Rückgabe [{date, amount}].
 */
function paymentSchedule_(rows, fromIso, toIso) {
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const until = i + 1 < rows.length ? rows[i + 1].from : '9999-12-31';
    let y = Number(r.from.slice(0, 4));
    let m = Number(r.from.slice(5, 7));
    for (let guard = 0; guard < 1200; guard++) {
      const day = Math.min(Math.max(1, Math.round(r.day || 1)), daysInMonth_(y, m));
      const iso = y + '-' + pad2_(m) + '-' + pad2_(day);
      if (iso >= until || iso > toIso) break;
      if (iso >= r.from && iso >= fromIso && r.amount) out.push({ date: iso, amount: r.amount });
      m++;
      if (m > 12) {
        m = 1;
        y++;
      }
    }
  }
  return out;
}

/** Mittlere HGT je Kalendertag (MM-TT) über vollständige Jahre [fromYear, toYear]. */
function dailyNormals_(weather, fromYear, toYear, heizgrenze) {
  const sum = {};
  const cnt = {};
  for (let y = fromYear; y <= toYear; y++) {
    for (const iso of isoRange_(y + '-01-01', y + '-12-31')) {
      const tm = weather[iso];
      if (tm === undefined || tm === null) continue;
      const k = iso.slice(5);
      sum[k] = (sum[k] || 0) + Math.max(0, heizgrenze - tm);
      cnt[k] = (cnt[k] || 0) + 1;
    }
  }
  const out = {};
  Object.keys(sum).forEach(k => (out[k] = sum[k] / cnt[k]));
  if (out['02-29'] === undefined && out['02-28'] !== undefined) out['02-29'] = out['02-28'];
  return out;
}

/**
 * Gesamtrechnung. in: { readings (bereinigt, sortiert), pairs (readingPairs_), weather {iso: tm}, conversions, placeholder,
 * tariffs [{from, ap, gp}], payments [{from, amount, day}], periods [{name, start, end}], settings, today }
 * Rückgabe { days, months, periods, hints, weatherLast }.
 */
function computeAll_(input) {
  const s = input.settings;
  const heizgrenze = s.Heizgrenze_C;
  const raum = s.Raumtemperatur_C;
  const hints = [];
  const readings = input.readings;
  const weatherDates = Object.keys(input.weather).sort();
  const weatherLast = weatherDates.length ? weatherDates[weatherDates.length - 1] : null;
  if (!readings.length) return { days: [], months: [], periods: [], hints: hints, weatherLast: weatherLast };

  const first = readings.reduce((m, r) => (r.date < m ? r.date : m), readings[0].date);
  const periodStart = input.periods.reduce((m, p) => (p.start < m ? p.start : m), first);
  const from = periodStart < first ? periodStart : first;
  const to = input.today;
  const temps = fillTemps_(input.weather, from, to);
  const dist = distributeReadings_(input.pairs, temps, heizgrenze);
  hints.push.apply(hints, dist.hints);

  const lastFullYear = Number(to.slice(0, 4)) - 1;
  const fromYear = Number((s.Wetter_ab || '2020-01-01').slice(0, 4));
  const normals = dailyNormals_(input.weather, fromYear, lastFullYear, heizgrenze);

  const days = isoRange_(from, to).map(iso => {
    const t = temps[iso];
    const dd = degreeDays_(t.tm, heizgrenze, raum);
    const m3 = dist.m3[iso] === undefined ? null : dist.m3[iso];
    const conv = factorAt_(input.conversions, iso, input.placeholder);
    const kWh = m3 === null ? null : m3 * conv.factor;
    const tariff = validAt_(input.tariffs, iso);
    const costWork = kWh === null || !tariff ? null : (kWh * tariff.ap) / 100;
    const costBase = tariff ? basePerDay_(tariff.gp, iso, s.Grundpreis_Verteilung) : null;
    return {
      date: iso,
      tm: t.tm,
      tmSrc: t.src,
      hgt: dd.hgt,
      g: dd.g,
      hgtNormal: normals[iso.slice(5)] === undefined ? null : normals[iso.slice(5)],
      m3: m3,
      kWh: kWh,
      covered: Math.min(1, dist.covered[iso] || 0),
      ap: tariff ? tariff.ap : null,
      costWork: costWork,
      costBase: costBase,
    };
  });

  const missingTemp = days.filter(d => d.tm === null).length;
  if (missingTemp) hints.push({ level: 'warn', text: missingTemp + ' Tag(e) ohne Temperatur – Wetterdaten prüfen (Menü „Wetter aktualisieren“).' });
  const estTemp = days.filter(d => d.tmSrc === 'interpoliert').length;
  if (estTemp) hints.push({ level: 'info', text: estTemp + ' Tag(e) mit interpolierter Temperatur (Lücke in den DWD-Daten).' });

  const periods = input.periods.map(p => summarizePeriod_(p, days, input.payments, to, hints));
  return { days: days, months: aggregateMonths_(days), periods: periods, hints: hints, weatherLast: weatherLast };
}

function aggregateMonths_(days) {
  const map = {};
  const order = [];
  for (const d of days) {
    const k = d.date.slice(0, 7);
    if (!map[k]) {
      map[k] = { month: k, days: 0, hgt: 0, hgtNormal: 0, normalOk: true, m3: 0, kWh: 0, cost: 0, covered: 0, costOk: true };
      order.push(k);
    }
    const m = map[k];
    m.days++;
    m.hgt += d.hgt || 0;
    if (d.hgtNormal === null) m.normalOk = false;
    else m.hgtNormal += d.hgtNormal;
    m.m3 += d.m3 || 0;
    m.kWh += d.kWh || 0;
    m.covered += d.covered;
    if (d.costBase === null || (d.covered > 0 && d.costWork === null)) m.costOk = false;
    m.cost += (d.costWork || 0) + (d.costBase || 0);
  }
  return order.map(k => {
    const m = map[k];
    return {
      month: k,
      days: m.days,
      hgt: round_(m.hgt, 1),
      hgtNormal: m.normalOk ? round_(m.hgtNormal, 1) : null,
      m3: round_(m.m3, 3),
      kWh: round_(m.kWh, 1),
      cost: m.costOk ? round_(m.cost, 2) : null,
      coverage: round_(m.covered / m.days, 3),
    };
  });
}

/** Kennzahlen eines Abrechnungszeitraums bis heute (bzw. bis Periodenende). */
function summarizePeriod_(p, days, paymentRows, today, hints) {
  const elapsedEnd = p.end < today ? p.end : today;
  const totalDays = dayNumber_(p.end) - dayNumber_(p.start) + 1;
  const inPeriod = days.filter(d => d.date >= p.start && d.date <= elapsedEnd);
  const elapsedDays = Math.max(0, dayNumber_(elapsedEnd) - dayNumber_(p.start) + 1);
  let m3 = 0;
  let kWh = 0;
  let costWork = 0;
  let costBase = 0;
  let covered = 0;
  let tariffMissing = false;
  let measuredUntil = null;
  for (const d of inPeriod) {
    m3 += d.m3 || 0;
    kWh += d.kWh || 0;
    covered += d.covered;
    if (d.costBase === null) tariffMissing = true;
    costBase += d.costBase || 0;
    if (d.costWork !== null) costWork += d.costWork;
    else if (d.covered > 0) tariffMissing = true;
    if (d.covered > 0.999) measuredUntil = d.date;
  }
  // Tage ohne Ablesung (vor der ersten / nach der letzten) haben covered = 0
  const uncovered = elapsedDays - covered;
  const due = paymentSchedule_(paymentRows, p.start, elapsedEnd);
  const all = paymentSchedule_(paymentRows, p.start, p.end);
  const paid = due.reduce((s, x) => s + x.amount, 0);
  const ended = p.end < today;
  const complete = elapsedDays > 0 && uncovered < 0.01;
  if (tariffMissing) hints.push({ level: 'warn', text: 'Periode „' + p.name + '“: Für manche Tage fehlt ein Tarif (Tab „Tarife“).' });
  if (ended && !complete) {
    hints.push({ level: 'warn', text: 'Periode „' + p.name + '“: ' + round_(uncovered, 1) + ' Tag(e) ohne Ablesung – Verbrauch dort fehlt in der Summe.' });
  }
  if (!all.length && p.start <= today) hints.push({ level: 'info', text: 'Periode „' + p.name + '“: keine Abschläge eingetragen (Tab „Abschläge“).' });
  const cost = costWork + costBase;
  return {
    name: p.name,
    start: p.start,
    end: p.end,
    status: ended ? 'beendet' : p.start > today ? 'zukünftig' : 'läuft',
    complete: complete,
    totalDays: totalDays,
    elapsedDays: elapsedDays,
    measuredUntil: measuredUntil,
    m3: round_(m3, 3),
    kWh: round_(kWh, 1),
    costWork: round_(costWork, 2),
    costBase: round_(costBase, 2),
    cost: round_(cost, 2),
    paymentsCount: due.length,
    paymentsPaid: round_(paid, 2),
    paymentsCountTotal: all.length,
    balance: round_(cost - paid, 2), // > 0 Nachzahlung, < 0 Guthaben (Stand heute)
  };
}
