// Diagramme als SVG – ohne Bibliothek (offline, strenge CSP). Farben kommen aus CSS-Variablen.
//   deine Daten: hell (--data) · Kontext: grau (--context) · gut/schlecht: Grün/Weinrot (nur mit Wort + Pfeil)
import { formatNumber, formatDate, dayNumber } from './format.js';

const isoOf = n => new Date(n * 86400000).toISOString().slice(0, 10);

const NS = 'http://www.w3.org/2000/svg';
const MONTH_LETTER = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

function svg(tag, attrs = {}, ...children) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  n.append(...children);
  return n;
}

function html(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

const euro = x => `${formatNumber(Math.round(Math.abs(x)), 0)} €`;
const path = pts => pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');

let gradientId = 0;

/**
 * Prognose-Karte einer Periode: Ist-Kosten (Linie + Fläche), Prognose (gestrichelt) mit 80-%-Band,
 * Abschläge als Treppe, die Lücke am Ende = Nachzahlung/Guthaben. Große Zahl als Overlay.
 */
export function periodChart(p) {
  const f = p.forecast;
  const wrap = html('div', 'pchart');
  const running = p.status === 'läuft';
  const end = f.balance.p50;
  const due = end > 0;

  // Overlay oben links
  const overlay = html('div', 'pchart-overlay');
  overlay.append(
    html('p', 'pchart-label', `${running ? 'Prognose' : 'Ergebnis'} · ${formatDate(p.end)}`),
    (() => {
      const row = html('div', 'pchart-hero');
      row.append(html('span', 'pchart-value', Math.abs(end) < 0.5 ? '0 €' : euro(end)));
      if (Math.abs(end) >= 0.5) row.append(html('span', `pill ${due ? 'pill-bad' : 'pill-good'}`, `${due ? '▲ Nachzahlung' : '▼ Guthaben'}`));
      return row;
    })(),
    html('p', 'pchart-sub', f.balance.p90 - f.balance.p10 >= 1 ? `80 % sicher: ${bandShort(f.balance.p10, f.balance.p90)}` : '')
  );
  wrap.append(overlay);

  const W = 360;
  const H = 280;
  const TOP = 118; // Zone für die große Zahl: Raster läuft durch, Daten bleiben darunter
  const padL = 14;
  const padR = 48; // rechte Randspalte für €-Werte und das Label der Lücke
  const padB = 22;
  const t0 = dayNumber(p.start);
  const t1 = dayNumber(p.end);
  const x = iso => padL + ((dayNumber(iso) - t0) / Math.max(1, t1 - t0)) * (W - padL - padR);
  const traj = f.trajectory;
  const steps = f.paymentSteps;
  const rec = running && f.recommendation && f.recommendation.balanced !== f.recommendation.current ? f.recommendation : null;
  const recSteps = rec ? steps.map(s => s) : null;
  if (rec) {
    let sum = 0;
    const today = isoOf(dayNumber(p.start) + p.elapsedDays - 1);
    for (let i = 0; i < steps.length; i++) {
      const amount = steps[i].sum - (i ? steps[i - 1].sum : 0);
      sum += steps[i].date > today ? rec.balanced : amount;
      recSteps[i] = { date: steps[i].date, sum };
    }
  }
  const yMax =
    Math.max(
      1,
      ...traj.map(t => t.p90),
      ...f.actual.map(a => a.cost),
      steps.length ? steps[steps.length - 1].sum : 0,
      recSteps && recSteps.length ? recSteps[recSteps.length - 1].sum : 0
    ) * 1.04;
  const y = v => H - padB - (v / yMax) * (H - padB - TOP);

  const gid = `g${++gradientId}`;
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'pchart-svg', role: 'img', 'aria-label': ariaText(p) });
  root.append(
    svg('defs', {},
      // Farben über Klassen (CSS-Variablen wirken in SVG-Attributen nicht zuverlässig)
      svg('linearGradient', { id: `${gid}a`, x1: 0, y1: 0, x2: 0, y2: 1 },
        svg('stop', { offset: '0%', class: 'stop-data', 'stop-opacity': 0.22 }),
        svg('stop', { offset: '100%', class: 'stop-data', 'stop-opacity': 0 })),
      svg('linearGradient', { id: `${gid}b`, x1: 0, y1: 0, x2: 0, y2: 1 },
        svg('stop', { offset: '0%', class: 'stop-data', 'stop-opacity': 0.16 }),
        svg('stop', { offset: '100%', class: 'stop-data', 'stop-opacity': 0.04 })))
  );

  // Lücke am Ende (für die Platzierung der Beschriftungen schon hier)
  const endCost = traj.length ? traj[traj.length - 1].p50 : f.cost.p50;
  const paidEnd = steps.length ? steps[steps.length - 1].sum : 0;
  const gapY = (y(paidEnd) + y(endCost)) / 2;
  const recEnd = recSteps && recSteps.length ? recSteps[recSteps.length - 1].sum : null;

  // Raster: dezente Linien, auch hinter der großen Zahl (nahtlos); €-Werte in der Randspalte
  const tick = niceStep(yMax / 3);
  for (let v = tick; v < yMax * 1.9; v += tick) {
    const gy = y(v);
    if (gy < 12) break;
    root.append(svg('line', { x1: 0, x2: W, y1: gy, y2: gy, class: 'grid' }));
    const clash = Math.abs(gy - 4 - gapY) < 16 || (recEnd !== null && Math.abs(gy - 4 - (y(recEnd) - 6)) < 14);
    if (v <= yMax && !clash) root.append(svg('text', { x: W - 4, y: gy - 4, class: 'axis', 'text-anchor': 'end' }, `${formatNumber(v, 0)} €`));
  }
  // Monatsbuchstaben
  for (let n = t0; n <= t1; n++) {
    const d = new Date(n * 86400000);
    if (d.getUTCDate() !== 15) continue;
    root.append(svg('text', { x: padL + ((n - t0) / Math.max(1, t1 - t0)) * (W - padL - padR), y: H - 6, class: 'axis', 'text-anchor': 'middle' }, MONTH_LETTER[d.getUTCMonth()]));
  }

  // Abschläge als Treppe (Kontext, grau)
  const stepPath = list => {
    const pts = [[x(p.start), y(0)]];
    let last = 0;
    for (const s of list) {
      pts.push([x(s.date), y(last)], [x(s.date), y(s.sum)]);
      last = s.sum;
    }
    pts.push([x(p.end), y(last)]);
    return path(pts);
  };
  if (steps.length) root.append(svg('path', { d: stepPath(steps), class: 'steps' }));
  if (recSteps) root.append(svg('path', { d: stepPath(recSteps), class: 'steps rec' }));

  // Ist-Kosten: Fläche + Linie
  const act = f.actual.map(a => [x(a.date), y(a.cost)]);
  if (act.length > 1) {
    root.append(svg('path', { d: `${path(act)}L${act[act.length - 1][0]},${y(0)}L${act[0][0]},${y(0)}Z`, fill: `url(#${gid}a)` }));
    root.append(svg('path', { d: path(act), class: 'line-actual' }));
  }
  // Prognose: Band + gestrichelter Median
  if (traj.length > 1) {
    const upper = traj.map(t => [x(t.date), y(t.p90)]);
    const lower = traj.map(t => [x(t.date), y(t.p10)]).reverse();
    root.append(svg('path', { d: `${path(upper)}${path(lower).replace('M', 'L')}Z`, fill: `url(#${gid}b)` }));
    root.append(svg('path', { d: path(traj.map(t => [x(t.date), y(t.p50)])), class: 'line-forecast' }));
  }
  // „Heute“ bzw. letzte Ablesung
  if (running && traj.length) {
    const tx = x(traj[0].date);
    root.append(svg('line', { x1: tx, x2: tx, y1: TOP - 12, y2: H - padB, class: 'today' }));
    root.append(svg('circle', { cx: tx, cy: y(traj[0].p50), r: 4, class: 'dot' }));
  }

  // Lücke am Ende = Nachzahlung / Guthaben
  const ex = x(p.end);
  if (Math.abs(endCost - paidEnd) >= 0.5) {
    root.append(svg('line', { x1: ex, x2: ex, y1: y(paidEnd), y2: y(endCost), class: `gap ${due ? 'bad' : 'good'}` }));
    root.append(svg('circle', { cx: ex, cy: y(endCost), r: 4, class: 'dot' }));
    root.append(svg('text', { x: ex + 7, y: gapY + 4, class: `gap-label ${due ? 'bad' : 'good'}` }, `${due ? '+' : '−'}${euro(endCost - paidEnd)}`));
  }
  if (recEnd !== null && Math.abs(y(recEnd) - 6 - gapY) >= 14) {
    root.append(svg('text', { x: ex + 7, y: y(recEnd) + 4, class: 'axis' }, `mit ${euro(rec.balanced)}`));
  }

  // Tooltip (antippen / überfahren)
  const tip = html('div', 'pchart-tip');
  tip.hidden = true;
  const cross = svg('line', { y1: TOP - 12, y2: H - padB, class: 'cross', visibility: 'hidden' });
  root.append(cross);
  const points = [
    ...f.actual.map(a => ({ date: a.date, kind: 'ist', v: a.cost })),
    ...traj.slice(f.actual.length ? 1 : 0).map(t => ({ date: t.date, kind: 'prognose', v: t.p50, lo: t.p10, hi: t.p90 })),
  ];
  const paidAt = iso => steps.filter(s => s.date <= iso).reduce((m, s) => s.sum, 0);
  const show = evt => {
    const box = root.getBoundingClientRect();
    const px = ((evt.clientX - box.left) / box.width) * W;
    let best = null;
    for (const pt of points) if (!best || Math.abs(x(pt.date) - px) < Math.abs(x(best.date) - px)) best = pt;
    if (!best) return;
    cross.setAttribute('x1', x(best.date));
    cross.setAttribute('x2', x(best.date));
    cross.setAttribute('visibility', 'visible');
    tip.replaceChildren(
      html('p', 'tip-date', formatDate(best.date)),
      html('p', '', best.kind === 'ist' ? `Kosten ${euro(best.v)}` : `Kosten ≈ ${euro(best.v)} (${euro(best.lo)}–${euro(best.hi)})`),
      html('p', 'muted', `Abschläge ${euro(paidAt(best.date))}`)
    );
    tip.hidden = false;
    wrap.classList.add('tipping'); // große Zahl tritt zurück, solange der Tooltip zu sehen ist
    const left = (x(best.date) / W) * 100;
    tip.style.left = `${Math.min(56, Math.max(3, left - 20))}%`;
  };
  root.addEventListener('pointermove', show);
  root.addEventListener('pointerdown', show);
  root.addEventListener('pointerleave', () => {
    tip.hidden = true;
    wrap.classList.remove('tipping');
    cross.setAttribute('visibility', 'hidden');
  });

  wrap.append(root, tip, legend(running, !!recSteps));
  return wrap;
}

function legend(running, rec) {
  const l = html('div', 'legend');
  const item = (cls, text) => {
    const i = html('span', 'legend-item');
    i.append(html('span', `swatch ${cls}`), document.createTextNode(text));
    l.append(i);
  };
  item('sw-actual', 'Kosten');
  if (running) {
    item('sw-forecast', 'Prognose');
    item('sw-band', '80 %-Bereich');
  }
  item('sw-steps', 'Abschläge');
  if (rec) item('sw-rec', 'Empfehlung');
  return l;
}

/** Kurzform des 80-%-Bereichs; die Richtung steht schon in der Pille daneben. */
function bandShort(lo, hi) {
  const n = v => formatNumber(Math.round(Math.abs(v)), 0);
  if (lo >= 0) return `${n(lo)}–${n(hi)} €`;
  if (hi <= 0) return `${n(hi)}–${n(lo)} €`;
  return `${n(lo)} € Guthaben bis ${n(hi)} € Nachzahlung`;
}

function niceStep(v) {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(v, 1))));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

function ariaText(p) {
  const f = p.forecast;
  const b = f.balance.p50;
  return `${p.name}: ${b > 0 ? 'Nachzahlung' : 'Guthaben'} etwa ${euro(b)}, 80 % wahrscheinlich ${bandShort(f.balance.p10, f.balance.p90)}.`;
}
