// Darstellung – nur DOM-Methoden und textContent, nie HTML-Strings mit Daten.
import { formatNumber, formatDate, formatDateShort, daysBetween, relativeDays, formatDateTime, formatMonth, formatEuro, expandDays, dayNumber, isoOfDay, isoWeek } from './format.js';
import { periodChart } from './charts.js';

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of children) if (c !== null && c !== undefined) node.append(c);
  return node;
}

export function renderLast(dom, overview, pending, today) {
  const last = overview && overview.last;
  if (!last && !pending) {
    dom.lastText.textContent = '–';
    dom.lastSub.textContent = overview ? 'Noch keine Ablesung gespeichert.' : 'Noch keine Daten geladen.';
  } else {
    const show = pending && (!last || pending.newer) ? pending : last;
    dom.lastText.textContent = `${formatNumber(show.value, 3)} m³`;
    const when = `${formatDate(show.date)}${show.time ? `, ${show.time} Uhr` : ''} (${relativeDays(daysBetween(show.date, today))})`;
    dom.lastSub.textContent = show === pending ? `${when} – noch nicht gesendet` : when;
  }
  dom.dataAge.textContent = overview ? `Datenstand: ${formatDateTime(overview.generatedAt)}` : '';
}

const hoursAgo = h => (h < 1 ? 'vor weniger als 1 Std.' : h < 36 ? `vor ${Math.round(h)} Std.` : `vor ${Math.round(h / 24)} Tagen`);
const tempText = t => `${t < 0 ? '−' : ''}${formatNumber(Math.abs(t), 1)}\u00a0°C`;

/**
 * Live-Zähler: geschätzter Stand jetzt = Schätzung des Servers + Verbrauch seit dem Datenstand (heutige Rate).
 * Ohne Modell oder mit neuerer, noch nicht gesendeter Ablesung: letzter Stand wie bisher.
 */
export function renderMeter(dom, overview, pending, today, nowMs = Date.now()) {
  const e = overview && overview.insights && overview.insights.estimate;
  const last = overview && overview.last;
  const generated = overview ? Date.parse(overview.generatedAt) : NaN;
  if (!e || (pending && (!last || pending.newer)) || !Number.isFinite(generated)) {
    dom.meterLabel.textContent = 'Letzter Stand';
    dom.odo.hidden = true;
    dom.meterTiles.hidden = true;
    dom.lastText.hidden = false;
    renderLast(dom, overview, pending, today);
    return;
  }
  const ageH = Math.max(0, (nowMs - generated) / 3600000);
  const value = e.value + (e.m3PerDay * Math.min(ageH, 7 * 24)) / 24;
  const [int, dec] = value.toFixed(3).split('.');
  dom.meterLabel.textContent = 'Zähler jetzt · geschätzt';
  dom.odo.replaceChildren(
    ...int.padStart(5, '0').split('').map(d => el('span', { text: d })),
    el('span', { class: 'sep', text: ',' }),
    ...dec.split('').map(d => el('span', { class: 'dec', text: d })),
    el('span', { class: 'unit', text: 'm³' })
  );
  dom.odo.setAttribute('role', 'img');
  dom.odo.setAttribute('aria-label', `geschätzt ${formatNumber(value, 3)} m³`);
  dom.odo.hidden = false;
  dom.lastText.hidden = true;
  const when = `${formatDate(e.since)}${e.sinceTime ? `, ${e.sinceTime} Uhr` : ''}`;
  dom.lastSub.textContent = `± ${formatNumber(e.sd, 1)} m³ · zuletzt abgelesen ${when} (${hoursAgo(e.hours + ageH)}): ${formatNumber(e.lastValue, 3)} m³`;
  const tariff = overview.insights.tariffNow;
  const tile = (cls, value, label) => el('div', { class: `tile ${cls}`.trim() }, el('b', { text: value }), el('small', { text: label }));
  dom.meterTiles.replaceChildren(
    tile('gas', `${formatNumber(e.m3PerDay, 1)} m³`, `pro Tag bei ${tempText(e.tmToday)}`),
    tile('', e.eurPerDay === null ? '–' : formatEuro(e.eurPerDay), `pro Tag${tariff && tariff.name ? ` (${tariff.name})` : ''}`)
  );
  dom.meterTiles.hidden = false;
  dom.dataAge.textContent = `Datenstand: ${formatDateTime(overview.generatedAt)}`;
}

/**
 * Rückblick: die letzten 4 Kalenderwochen (Mo–So) – nur Fakten bis zur letzten Ablesung, keine Schätzung danach.
 * Innerhalb eines Ablesezeitraums ist der Verbrauch nach Temperatur auf die Tage verteilt (Wochengrenzen).
 * unit: 'm3' | 'kWh'; onToggle wechselt die Einheit (ganze Karte antippen).
 */
export function renderWeeks(dom, overview, unit, onToggle) {
  const days = expandDays(overview && overview.insights && overview.insights.days);
  let last = -1;
  days.forEach((d, i) => d.covered > 0 && (last = i));
  dom.weeksCard.hidden = last < 0;
  if (last < 0) return;
  const lastDate = days[last].date;
  const byDate = new Map(days.map(d => [d.date, d]));
  const today = overview.today || days[days.length - 1].date;
  const n = dayNumber(today);
  const monday = n - ((new Date(n * 86400000).getUTCDay() + 6) % 7);
  const kwh = unit === 'kWh';
  const weeks = [3, 2, 1, 0].map(i => {
    const from = monday - 7 * i;
    let m3 = 0;
    let kWh = 0;
    let measured = 0;
    let lastIn = null;
    for (let k = 0; k < 7; k++) {
      const d = byDate.get(isoOfDay(from + k));
      if (!d || !(d.covered > 0)) continue;
      m3 += d.m3 || 0;
      kWh += d.kWh || 0;
      measured += d.covered;
      lastIn = d.date;
    }
    return { from: isoOfDay(from), to: isoOfDay(from + 6), kw: isoWeek(isoOfDay(from)), m3, kWh, measured, lastIn };
  });
  const value = w => (kwh ? w.kWh : w.m3);
  const max = Math.max(1e-9, ...weeks.map(value));
  const fmtV = v => (kwh ? `${formatNumber(v, 0)}` : formatNumber(v, 1));
  for (const s of dom.weeksUnit.children) s.classList.toggle('on', s.dataset.unit === (kwh ? 'kWh' : 'm3'));
  dom.weeksBars.replaceChildren(
    ...weeks.map(w => {
      const has = w.measured > 0;
      const partial = has && w.lastIn < w.to;
      const bar = el('div', { class: 'wbar' });
      bar.style.height = `${has ? Math.max(3, (value(w) / max) * 100) : 0}%`;
      return el(
        'div',
        { class: `week${has ? '' : ' empty'}` },
        el('span', { class: 'wval', text: has ? fmtV(value(w)) : '–' }),
        el('div', { class: 'wtrack' }, bar),
        el('span', { class: 'wkw', text: `KW ${w.kw}` }),
        el('span', { class: 'wdates', text: has ? `${formatDateShort(w.from)}–${partial ? formatDateShort(w.lastIn) : formatDateShort(w.to)}` : 'keine Ablesung' })
      );
    })
  );
  const total = weeks.reduce((s, w) => s + value(w), 0);
  dom.weeksSum.textContent = `4 Wochen: ${fmtV(total)} ${kwh ? 'kWh' : 'm³'} · abgelesen bis ${formatDate(lastDate)}`;
  dom.weeksCard.onclick = onToggle;
  dom.weeksCard.onkeydown = e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onToggle();
    }
  };
  dom.weeksCard.setAttribute('aria-label', `Letzte 4 Wochen in ${kwh ? 'kWh' : 'Kubikmetern'} – antippen für ${kwh ? 'Kubikmeter' : 'kWh'}`);
}

export function renderIntervals(tbody, empty, intervals) {
  tbody.replaceChildren();
  empty.hidden = intervals.length > 0;
  for (const i of intervals) {
    const label = `${formatDateShort(i.from)}–${formatDate(i.to)}${i.meter && intervals.some(x => x.meter !== i.meter) ? ` (${i.meter})` : ''}`;
    const row = el(
      'tr',
      i.excluded ? { class: 'excluded', title: 'Im Modell ausgeschlossen' } : {},
      el('td', { text: label }),
      el('td', { text: formatNumber(i.days, i.days % 1 === 0 ? 0 : 1) }),
      el('td', { text: formatNumber(i.m3, i.m3 % 1 === 0 ? 0 : 2) }),
      el('td', { text: formatNumber(i.m3PerDay, 2) }),
      el('td', { text: formatNumber(i.kWhPerDay, 1) })
    );
    tbody.append(row);
  }
}

export function renderHints(card, list, hints) {
  list.replaceChildren(...hints.map(h => el('li', { class: h.level === 'warn' ? 'warn' : '', text: h.text })));
  card.hidden = hints.length === 0;
}

const STATE_TEXT = { pending: 'wartet auf Senden', confirm: 'Rückfrage', rejected: 'abgelehnt' };

export function renderQueue(dom, entries, handlers) {
  dom.queueCard.hidden = entries.length === 0;
  const pending = entries.filter(e => e.state === 'pending').length;
  dom.queueTitle.textContent = pending ? `${pending} Ablesung${pending === 1 ? '' : 'en'} warten` : 'Ablesungen prüfen';
  dom.flushBtn.hidden = pending === 0;
  dom.queueList.replaceChildren(
    ...entries.map(e => {
      const head = el('div', { text: `${formatDate(e.date)}${e.time ? ` ${e.time}` : ''}: ${formatNumber(e.value, 3)} m³ – ${STATE_TEXT[e.state] || e.state}` });
      const detail = e.error ? el('div', { class: 'small-text', text: e.error }) : null;
      let actions = null;
      if (e.state === 'confirm') {
        actions = el(
          'div',
          { class: 'actions' },
          el('button', { type: 'button', class: 'small', text: 'Stimmt, speichern', onclick: () => handlers.confirm(e.id) }),
          el('button', { type: 'button', class: 'small secondary', text: 'Verwerfen', onclick: () => handlers.dismiss(e.id) })
        );
      } else if (e.state === 'rejected') {
        actions = el('div', { class: 'actions' }, el('button', { type: 'button', class: 'small secondary', text: 'Ausblenden', onclick: () => handlers.dismiss(e.id) }));
      }
      return el('li', { class: e.state === 'rejected' ? 'error' : e.state === 'confirm' ? 'warn' : '' }, head, detail, actions);
    })
  );
}

const STATUS_TEXT = { beendet: 'beendet', läuft: 'läuft', zukünftig: 'beginnt noch' };
const UNCERTAINTY_TEXT = {
  Wetter: 'das Wetter bis zum Periodenende',
  Modell: 'dein Heizverhalten (Streuung um das Modell)',
  Umrechnung: 'Brennwert und Zustandszahl (noch geschätzt)',
};

const euro0 = x => `${formatNumber(Math.round(Math.abs(x)), 0)} €`;
/** Saldo als Text: negativ = Guthaben, positiv = Nachzahlung. */
const saldoText = (v, approx = '') => (Math.abs(v) < 0.5 ? 'etwa ausgeglichen' : `${v < 0 ? 'Guthaben' : 'Nachzahlung'} ${approx}${euro0(v)}`);
function bandText(lo, hi) {
  if (lo >= 0) return `zwischen ${euro0(lo)} und ${euro0(hi)} Nachzahlung`;
  if (hi <= 0) return `zwischen ${euro0(hi)} und ${euro0(lo)} Guthaben`;
  return `zwischen ${euro0(lo)} Guthaben und ${euro0(hi)} Nachzahlung`;
}

function recommendationText(r) {
  if (r.balanced > r.current) return `Abschlag ${euro0(r.balanced)} statt ${euro0(r.current)} pro Monat → etwa ausgeglichen (mit Puffer: ${euro0(r.safe)})`;
  if (r.safe < r.current) return `Abschlag könnte auf ${euro0(r.safe)} sinken (inkl. Puffer) – derzeit ${euro0(r.current)}`;
  return `Abschlag von ${euro0(r.current)} passt (ausgeglichen bei ${euro0(r.balanced)}, mit Puffer ${euro0(r.safe)})`;
}

/**
 * Abrechnungszeiträume: laufende zuerst, dann die jüngsten beendeten.
 * mode: 'long' (Jahresmodell) | 'season' („wenn du so weiterheizt wie diese Saison“); level: insights.level.
 */
export function renderPeriods(list, empty, periods, { mode = 'long', level = null, onMode = () => {} } = {}) {
  const order = { läuft: 0, beendet: 1, zukünftig: 2 };
  const sorted = periods.slice().sort((a, b) => order[a.status] - order[b.status] || (a.start < b.start ? 1 : -1));
  empty.hidden = sorted.length > 0;
  list.replaceChildren(...sorted.map(p => renderPeriod(p, mode, level, onMode)));
}

/** Satz zur Saison-Variante: wie anders heizt du diese Saison, worauf beruht das? */
function seasonText(level) {
  const d = level.factor - 1;
  const how = Math.abs(d) < 0.03 ? 'etwa so viel wie' : `etwa ${formatNumber(Math.round(Math.abs(d) * 100), 0)} % ${d < 0 ? 'weniger' : 'mehr'} als`;
  const basis = level.source === 'Saison'
    ? `Modell neu geschätzt aus ${level.n} Ablesezeiträumen seit ${formatDate(level.from)}: Heizgrenze ${formatNumber(level.theta, 1)} °C`
    : `Faktor aus ${level.n} Ablesezeiträumen seit ${formatDate(level.from)}, Heizgrenze wie im Jahresmodell`;
  return `Diese Saison heizt du ${how} im Jahresmodell (bei gleichem Wetter). ${basis}. Prognose: so weiter, bei normalem Wetter.`;
}

function modeSwitch(mode, onMode) {
  const seg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Prognose-Grundlage' });
  for (const [m, text] of [['long', 'Langfristig'], ['season', 'Diese Saison']]) {
    seg.append(el('button', { type: 'button', 'aria-pressed': String(m === mode), text, onclick: () => onMode(m) }));
  }
  return seg;
}

function renderPeriod(p0, mode, level, onMode) {
  const switchable = p0.status === 'läuft' && !!p0.forecastSeason && !!level;
  const season = switchable && mode === 'season';
  const p = season ? Object.assign({}, p0, { forecast: p0.forecastSeason }) : p0;
  const status = `${formatDate(p.start)}–${formatDate(p.end)} · ${STATUS_TEXT[p.status] || p.status}`;
  const head = el('div', { class: 'period-head' }, el('div', {}, el('h3', { text: p.name }), el('p', { class: 'muted small-text', text: status })));
  if (p.status === 'läuft') head.append(el('span', { class: 'pill pill-neutral', text: `Tag ${p.elapsedDays}/${p.totalDays}` }));
  if (p.status === 'zukünftig') return el('div', { class: 'period' }, head);
  const f = p.forecast;
  const body = el('div', { class: 'period-body' });
  const facts = el('dl', { class: 'facts' });
  const fact = (k, v) => facts.append(el('dt', { text: k }), el('dd', { text: v }));

  if (!f) {
    const text = p.status === 'läuft'
      ? p.balance < 0 ? `Bisher ${formatEuro(-p.balance)} mehr gezahlt als verbraucht` : `Bisher ${formatEuro(p.balance)} mehr verbraucht als gezahlt`
      : saldoText(p.balance);
    body.append(el('p', { class: p.status === 'läuft' ? 'balance-now' : `balance ${p.balance < 0 ? 'credit' : 'due'}`, text }));
  }
  if (p.status === 'läuft' && f) {
    if (f.recommendation) body.append(el('p', { class: 'reco', text: recommendationText(f.recommendation) }));
    fact('Verbrauch', `≈ ${formatNumber(f.kWh.p50, 0)} kWh (${formatNumber(f.kWh.p10, 0)}–${formatNumber(f.kWh.p90, 0)})`);
    fact('Kosten', `≈ ${euro0(f.cost.p50)} (${euro0(f.cost.p10)}–${euro0(f.cost.p90)})`);
    fact('Abschläge', `${euro0(f.paymentsTotal)} (${f.paymentsCount} × geplant)`);
    fact('Bisher', `${formatEuro(p.cost)} Kosten, ${formatEuro(p.paymentsPaid)} gezahlt`);
  } else {
    fact('Verbrauch', `${formatNumber(p.kWh, 0)} kWh (${formatNumber(p.m3, 1)} m³)`);
    fact('Kosten', `${formatEuro(p.cost)} (Arbeit ${formatEuro(p.costWork)} + Grund ${formatEuro(p.costBase)})`);
    fact('Abschläge', `${formatEuro(p.paymentsPaid)} (${p.paymentsCount} von ${p.paymentsCountTotal})`);
  }
  body.append(facts);
  const notes = [];
  if (p.status === 'beendet') notes.push(p.complete ? 'Schätzung der Schlussrechnung.' : 'Für einen Teil der Periode fehlen Ablesungen – dort mit dem Modell geschätzt.');
  if (p.status === 'läuft') notes.push(`Abgelesen bis ${p.measuredUntil ? formatDate(p.measuredUntil) : '–'}.`);
  if (p.status === 'läuft' && !f) notes.push('Für eine Prognose fehlt noch das Modell (siehe oben).');
  if (f && f.mainUncertainty) notes.push(`Größte Unsicherheit: ${UNCERTAINTY_TEXT[f.mainUncertainty]}.`);
  body.append(el('p', { class: 'muted small-text', text: notes.join(' ') }));
  // Umschalter über Zahl und Diagramm – er ändert beides
  const switchBox = switchable
    ? el('div', { class: 'period-switch' }, modeSwitch(mode, onMode),
      el('p', { class: 'muted small-text season-note', text: season ? seasonText(level) : 'Jahresmodell aus allen Ablesungen, bei normalem Wetter.' }))
    : null;
  return el('div', { class: 'period' }, head, switchBox, f ? periodChart(p) : null, body);
}

const RATING_CLASS = { grün: 'green', gelb: 'yellow', rot: 'red' };

/** Modell & Verlässlichkeit (Ampel + Kennzahlen). */
export function renderModel(textNode, factsNode, model, rating, level) {
  textNode.textContent = rating ? rating.text : 'Noch keine Daten.';
  textNode.className = `rating ${rating ? RATING_CLASS[rating.level] || '' : ''}`.trim();
  factsNode.replaceChildren();
  factsNode.hidden = !model;
  if (!model) return;
  const fact = (k, v) => factsNode.append(el('dt', { text: k }), el('dd', { text: v }));
  fact('Je Heizgradtag', `${formatNumber(model.aKWh, 1)} kWh (${formatNumber(model.a, 3)} m³)`);
  fact('Heizgrenze', `${formatNumber(model.theta, 1)} °C (${model.thetaSource === 'Daten' ? 'aus deinen Ablesungen' : 'aus den Einstellungen'})`);
  fact('Grundlast', model.b >= 0.005 ? `${formatNumber(model.b, 2)} m³/Tag` : 'keine (nur Heizung)');
  fact('Grundlage', `${model.n} Ablesezeiträume${model.excluded ? ` (+${model.excluded} ausgeschlossen)` : ''}`);
  if (level) {
    fact('Diese Saison', `${formatNumber(level.aKWh, 1)} kWh je Heizgradtag, Heizgrenze ${formatNumber(level.theta, 1)} °C – ${level.source === 'Saison' ? 'neu geschätzt' : 'Faktor ' + formatNumber(level.factor, 2)} (${level.n} Zeiträume seit ${formatDate(level.from)})`);
  }
}

/** Monatstabelle, neueste zuerst. */
export function renderMonths(tbody, empty, months) {
  const rows = months.slice().reverse();
  empty.hidden = rows.length > 0;
  tbody.replaceChildren(
    ...rows.map(m =>
      el(
        'tr',
        {},
        el('td', { text: `${formatMonth(m.month)}${m.coverage < 0.999 ? ' *' : ''}` }),
        el('td', { text: formatNumber(m.kWh, 0) }),
        el('td', { text: typeof m.kWhNormal === 'number' ? formatNumber(m.kWhNormal, 0) : '–' }),
        el('td', { text: formatNumber(m.m3, 1) }),
        el('td', { text: formatNumber(m.hgt, 0) }),
        el('td', { text: m.cost === null ? '–' : formatEuro(m.cost) })
      )
    )
  );
}
