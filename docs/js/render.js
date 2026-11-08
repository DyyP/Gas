// Darstellung – nur DOM-Methoden und textContent, nie HTML-Strings mit Daten.
import { formatNumber, formatDate, formatDateShort, daysBetween, relativeDays, formatDateTime, formatMonth, formatEuro } from './format.js';
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

/** Abrechnungszeiträume: laufende zuerst, dann die jüngsten beendeten. */
export function renderPeriods(list, empty, periods) {
  const order = { läuft: 0, beendet: 1, zukünftig: 2 };
  const sorted = periods.slice().sort((a, b) => order[a.status] - order[b.status] || (a.start < b.start ? 1 : -1));
  empty.hidden = sorted.length > 0;
  list.replaceChildren(...sorted.map(renderPeriod));
}

function renderPeriod(p) {
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
  return el('div', { class: 'period' }, head, f ? periodChart(p) : null, body);
}

const RATING_CLASS = { grün: 'green', gelb: 'yellow', rot: 'red' };

/** Modell & Verlässlichkeit (Ampel + Kennzahlen). */
export function renderModel(textNode, factsNode, model, rating) {
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
