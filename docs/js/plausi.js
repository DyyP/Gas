// Prüfung vor dem Speichern – auch offline, mit dem zuletzt bekannten Stand.
// Maßgeblich bleibt der Server; das hier erspart nur unnötige Runden.
import { isIsoDate, readingT, formatDate, formatNumber } from './format.js';

/**
 * @param reading { date, time, value }
 * @param ctx { today, minDate, maxPerDay, latest: {date, time, value} | null }
 * @returns { error } | { warn, perDay } | {}
 */
export function checkReading(reading, ctx) {
  const { date, time, value } = reading;
  if (!isIsoDate(date)) return { error: 'Bitte ein gültiges Datum wählen.' };
  if (date > ctx.today) return { error: 'Das Datum liegt in der Zukunft.' };
  if (ctx.minDate && date < ctx.minDate) return { error: `Das Datum liegt vor dem ${formatDate(ctx.minDate)}.` };
  if (!Number.isFinite(value) || value < 0 || value >= 1e7) return { error: 'Bitte eine Zahl eingeben, z. B. 2309,567' };

  const latest = ctx.latest;
  if (!latest) return {};
  const t = readingT(date, time);
  const tl = readingT(latest.date, latest.time);
  if (t <= tl) return {}; // Nachtrag: prüft der Server gegen beide Nachbarn
  if (value < latest.value) {
    return { error: `Der Stand ist kleiner als zuletzt (${formatNumber(latest.value, 3)} m³ am ${formatDate(latest.date)}).` };
  }
  const perDay = (value - latest.value) / Math.max(t - tl, 1 / 24); // wie im Backend: mind. 1 Stunde
  if (ctx.maxPerDay > 0 && perDay > ctx.maxPerDay) {
    return {
      warn: `Das wären ${formatNumber(perDay, 1)} m³ pro Tag seit dem ${formatDate(latest.date)} – ungewöhnlich viel. Stimmt der Wert?`,
      perDay,
    };
  }
  return {};
}

/** Neuester bekannter Stand: aus der Übersicht oder aus noch nicht gesendeten Einträgen. */
export function latestKnown(overviewLast, queueEntries) {
  let best = overviewLast ? { date: overviewLast.date, time: overviewLast.time, value: overviewLast.value } : null;
  for (const e of queueEntries) {
    if (e.state === 'rejected') continue;
    if (!best || readingT(e.date, e.time) > readingT(best.date, best.time)) best = { date: e.date, time: e.time, value: e.value };
  }
  return best;
}
