// Darstellung – nur DOM-Methoden und textContent, nie HTML-Strings mit Daten.
import { formatNumber, formatDate, formatDateShort, daysBetween, relativeDays, formatDateTime, formatMonth, formatEuro } from './format.js';

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

/** Abrechnungszeiträume: laufende zuerst, dann die jüngsten beendeten. */
export function renderPeriods(list, empty, periods) {
  const order = { läuft: 0, beendet: 1, zukünftig: 2 };
  const sorted = periods.slice().sort((a, b) => order[a.status] - order[b.status] || (a.start < b.start ? 1 : -1));
  empty.hidden = sorted.length > 0;
  list.replaceChildren(
    ...sorted.map(p => {
      const head = el(
        'div',
        {},
        el('h3', { text: p.name }),
        el('p', {
          class: 'muted small-text',
          text: `${formatDate(p.start)}–${formatDate(p.end)} · ${STATUS_TEXT[p.status] || p.status}${p.status === 'läuft' ? ` (Tag ${p.elapsedDays} von ${p.totalDays})` : ''}`,
        })
      );
      if (p.status === 'zukünftig') return el('div', { class: 'period' }, head);
      const credit = p.balance < 0;
      const amount = formatEuro(Math.abs(p.balance));
      // Laufende Periode: nur Zwischenstand (Abschläge werden im Voraus gezahlt) – neutral, kein „Guthaben“
      const balance =
        p.status === 'läuft'
          ? el('p', { class: 'balance-now', text: credit ? `Bisher ${amount} mehr gezahlt als verbraucht` : `Bisher ${amount} mehr verbraucht als gezahlt` })
          : el('p', {
              class: `balance ${credit ? 'credit' : 'due'}`,
              text: Math.abs(p.balance) < 0.005 ? 'ausgeglichen' : `${credit ? 'Guthaben' : 'Nachzahlung'} ${amount}`,
            });
      const note =
        p.status === 'beendet'
          ? p.complete
            ? 'Schätzung der Schlussrechnung (Stand der eingetragenen Werte).'
            : 'Unvollständig: Für einen Teil der Periode fehlen Ablesungen.'
          : `Stand heute – Verbrauch abgelesen bis ${p.measuredUntil ? formatDate(p.measuredUntil) : '–'}. Prognose bis Periodenende folgt.`;
      const facts = el(
        'dl',
        { class: 'facts' },
        el('dt', { text: 'Verbrauch' }),
        el('dd', { text: `${formatNumber(p.kWh, 0)} kWh (${formatNumber(p.m3, 1)} m³)` }),
        el('dt', { text: 'Kosten' }),
        el('dd', { text: `${formatEuro(p.cost)} (Arbeit ${formatEuro(p.costWork)} + Grund ${formatEuro(p.costBase)})` }),
        el('dt', { text: 'Abschläge' }),
        el('dd', { text: `${formatEuro(p.paymentsPaid)} (${p.paymentsCount} von ${p.paymentsCountTotal})` })
      );
      return el('div', { class: 'period' }, head, balance, facts, el('p', { class: 'muted small-text', text: note }));
    })
  );
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
        el('td', { text: formatNumber(m.hgt, 0) }),
        el('td', { text: m.hgtNormal === null ? '–' : formatNumber(m.hgtNormal, 0) }),
        el('td', { text: formatNumber(m.m3, 1) }),
        el('td', { text: formatNumber(m.kWh, 0) }),
        el('td', { text: m.cost === null ? '–' : formatEuro(m.cost) })
      )
    )
  );
}
