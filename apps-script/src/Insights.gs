/**
 * Insights.gs – Daten für die Analyse-Grafiken und den Live-Zähler (rein, in Node testbar).
 */

/**
 * r: Ergebnis von computeAll_ · input: dessen Eingaben · nowT: jetzt als gebrochene Tagesnummer (Berlin).
 * Rückgabe { tariffNow, factorNow, daily, estimate?, savings?, season? } – ohne Modell nur die ersten drei.
 */
function insights_(r, input, nowT) {
  const s = input.settings;
  const m = r.model;
  const today = input.today;
  const tariff = validAt_(input.tariffs, today);
  const factor = factorAt_(input.conversions, today, input.placeholder).factor;
  const basePerDay = tariff ? basePerDay_(tariff.gp, today, s.Grundpreis_Verteilung) : null;
  const out = {
    tariffNow: tariff ? { ap: tariff.ap, gp: tariff.gp, name: tariff.name || '', basePerDay: round_(basePerDay, 4) } : null,
    factorNow: round_(factor, 4),
    // Heizkalender: die letzten 12 Monate Tag für Tag
    daily: r.days
      .filter(d => dayNumber_(today) - dayNumber_(d.date) < 366)
      .map(d => ({ date: d.date, kWh: d.kWh === null ? null : round_(d.kWh, 2), tm: d.tm, covered: round_(d.covered, 2) })),
  };
  if (!m) return out;

  // Live-Zähler: erwarteter Verbrauch seit der letzten Ablesung bis jetzt
  let last = null;
  for (const x of input.readings) if (!last || x.t > last.t) last = x;
  const todayTm = r.temps[today] ? r.temps[today].tm : null;
  if (last && nowT > last.t && todayTm !== null) {
    const days = pairDays_({ a: last, b: { t: nowT } }, r.temps);
    if (days) {
      const d = nowT - last.t;
      const p = predictPair_(m, days, d);
      const rate = m.b + m.a * Math.max(0, m.theta - todayTm); // m³/Tag bei heutiger Temperatur
      out.estimate = {
        since: last.date,
        sinceTime: last.minutes === null ? null : formatTime_(last.minutes),
        hours: round_(d * 24, 1),
        lastValue: last.value,
        m3: round_(p.mean, 3),
        sd: round_(p.sd, 3),
        value: round_(last.value + p.mean, 3),
        tmToday: todayTm,
        m3PerDay: round_(rate, 3),
        kWhPerDay: round_(rate * factor, 2),
        eurPerDay: tariff ? round_((rate * factor * tariff.ap) / 100 + basePerDay, 2) : null,
      };
    }
  }

  // Normalwerte (Mittel der Klimajahre) bei der Heizgrenze θ und θ − 1
  const lastFullYear = Number(today.slice(0, 4)) - 1;
  const fromYear = Number((s.Wetter_ab || '2020-01-01').slice(0, 4));
  const normals = dailyNormals_(input.weather, fromYear, lastFullYear, m.theta);
  const normalsCooler = dailyNormals_(input.weather, fromYear, lastFullYear, m.theta - 1);
  const yearSum = n => Object.keys(n).filter(k => k !== '02-29').reduce((sum, k) => sum + n[k], 0);

  // Sparrechner: 1 °C kühler heizen ≈ Heizgrenze 1 K tiefer (Näherung)
  const dH = yearSum(normals) - yearSum(normalsCooler);
  const kWh = m.a * dH * factor;
  out.savings = { kWh: round_(kWh, 0), eur: tariff ? round_((kWh * tariff.ap) / 100, 0) : null, share: round_(dH / Math.max(1e-9, yearSum(normals)), 3) };

  // Heizsaison = Heizjahr 01.08.–31.07.; Fortschritt nach normalen Heizgradtagen, nicht nach Kalendertagen
  const y = Number(today.slice(5, 7)) >= 8 ? Number(today.slice(0, 4)) : Number(today.slice(0, 4)) - 1;
  const start = y + '-08-01';
  const end = y + 1 + '-07-31';
  let total = 0;
  let done = 0;
  let remainingKWh = 0;
  const cum = {}; // normale Heizgradtage bis zum Monatsersten (für die Skala Okt/Jan/Apr)
  for (const iso of isoRange_(start, end)) {
    if (iso.slice(8) === '01') cum[iso.slice(0, 7)] = total;
    const h = normals[iso.slice(5)] || 0;
    total += h;
    if (iso <= today) done += h;
    else remainingKWh += (m.b + m.a * h) * factor;
  }
  const doneKWh = r.days.filter(d => d.date >= start && d.date <= today).reduce((sum, d) => sum + (d.kWh || 0), 0);
  out.season = {
    start: start,
    end: end,
    share: round_(total > 0 ? done / total : 0, 3),
    doneKWh: round_(doneKWh, 0),
    remainingKWh: round_(remainingKWh, 0),
    remainingEur: tariff ? round_((remainingKWh * tariff.ap) / 100, 0) : null,
    marks: Object.keys(cum).map(k => ({ month: k, share: round_(total > 0 ? cum[k] / total : 0, 3) })),
  };
  return out;
}
