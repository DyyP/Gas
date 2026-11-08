// Darstellung – nur DOM-Methoden und textContent, nie HTML-Strings mit Daten.
import { formatNumber, formatDate, formatDateShort, daysBetween, relativeDays, formatDateTime } from './format.js';

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
