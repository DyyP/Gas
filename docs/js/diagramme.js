// Analyse-Seite: Monate gegen Normalwetter, Heizkalender (Saison + Vergleich), Kosten pro Tag + Sparrechner, Heizsaison.
// SVG ohne Bibliothek. Farben über CSS-Klassen; nur die Glut-Skala des Kalenders setzt Farben als Attribut (CSP-sicher).
import { formatNumber, formatDate, formatDateShort, formatMonth, formatEuro, expandDays } from './format.js';
import { svg, html, niceStep, attachTip, uid } from './charts.js';

const W = 360;
const fmt = (x, d = 0) => formatNumber(x, d);
const temp = t => `${t < 0 ? '−' : ''}${formatNumber(Math.abs(t), 1)}\u00a0°C`;
const tick = t => `${t < 0 ? '−' : ''}${Math.abs(t)}°`;
const pct = x => `${formatNumber(Math.round(Math.abs(x) * 100), 0)} %`;
const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

function head(node, kicker, title, lead) {
  node.replaceChildren(html('p', 'kicker', kicker), html('h2', 'title', title));
  if (lead) node.append(html('p', 'lead', lead));
}

/** Absatz mit fett hervorgehobenen Teilen: ['Je Grad ', ['+3,9 kWh'], ' mehr'] – Hervorhebungen brechen nicht um. */
function rich(cls, parts) {
  const p = html('p', cls);
  for (const part of parts) if (part) p.append(Array.isArray(part) ? html('b', '', part[0].replace(/ /g, '\u00a0')) : document.createTextNode(part));
  return p;
}

function tiles(list) {
  const box = html('div', 'tiles');
  for (const [cls, value, label] of list) {
    const t = html('div', `tile ${cls}`.trim());
    t.append(html('b', '', value), html('small', '', label));
    box.append(t);
  }
  return box;
}

function chart(H, label) {
  const wrap = html('div', 'chart');
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': label });
  wrap.append(root);
  return { wrap, root };
}

const grad = (id, stops, attrs = { x1: 0, y1: 0, x2: 0, y2: 1 }) =>
  svg('linearGradient', { id, ...attrs }, ...stops.map(([offset, cls, op]) => svg('stop', { offset, class: cls, 'stop-opacity': op })));

/** Alle Karten der Analyse; leere Karten bleiben verborgen. */
export function renderAnalyse(dom, o) {
  const ins = o && o.insights;
  const model = (o && o.model) || null;
  const shown = {
    aMonths: !!ins && monthsCard(dom.aMonths, o.months || [], model, ins.season || null),
    aCalendar: !!ins && calendarCard(dom.aCalendar, ins),
    aDayCost: !!ins && dayCostCard(dom.aDayCost, model, ins),
    aSeason: !!ins && seasonCard(dom.aSeason, ins),
  };
  for (const [id, ok] of Object.entries(shown)) dom[id].hidden = !ok;
  dom.analyseEmpty.hidden = Object.values(shown).some(Boolean);
}

// ---------- 6 · Monate gegen normales Wetter, je Heizjahr (Aug–Jul) ----------
const heatYear = ym => (Number(ym.slice(5, 7)) >= 8 ? Number(ym.slice(0, 4)) : Number(ym.slice(0, 4)) - 1);
const yearLabel = y => `${y}/${String(y + 1).slice(2)}`;
let shownYear = null; // gewähltes Heizjahr (Startjahr); bleibt beim Neuzeichnen erhalten

function monthsCard(node, months, model, season) {
  const withData = months.filter(m => typeof m.kWhNormal === 'number');
  const current = season ? Number(season.start.slice(0, 4)) : null;
  const years = [...new Set(withData.map(m => heatYear(m.month)).concat(current === null ? [] : [current]))].sort();
  if (!withData.length || !years.length) return false;
  if (!years.includes(shownYear)) shownYear = current !== null ? current : years[years.length - 1];
  const y0 = shownYear;
  const lastData = withData[withData.length - 1].month;
  const future = new Map(((season && Number(season.start.slice(0, 4)) === y0 && season.months) || []).map(x => [x.month, x.kWhNormal]));
  // 12 feste Plätze Aug … Jul
  const slots = Array.from({ length: 12 }, (_, i) => {
    const mo = ((7 + i) % 12) + 1;
    const ym = `${i < 5 ? y0 : y0 + 1}-${String(mo).padStart(2, '0')}`;
    const m = withData.find(x => x.month === ym) || null;
    const open = !m && ym > lastData && future.has(ym) ? future.get(ym) : null;
    return { ym, mo, m, open };
  });
  const list = slots.filter(x => x.m).map(x => x.m);

  head(node, 'Monate · Heizjahr', 'Du gegen normales Wetter', 'Bernstein: dein Verbrauch. Schraffiert: was dein Modell bei normalem Wetter (Mittel seit 2020) erwarten würde.');
  if (years.length > 1) {
    const seg = html('div', 'seg');
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', 'Heizjahr');
    for (const y of years) {
      const b = html('button', '', yearLabel(y));
      b.type = 'button';
      b.setAttribute('aria-pressed', String(y === y0));
      b.addEventListener('click', () => {
        shownYear = y;
        monthsCard(node, months, model, season);
      });
      seg.append(b);
    }
    node.append(seg);
  }
  const H = 214;
  const L = 6;
  const R = 6;
  const T = 26;
  const B = 34;
  const top = Math.max(1, ...slots.map(x => (x.m ? Math.max(x.m.kWh, x.m.kWhNormal) : x.open || 0)));
  const yMax = top * 1.06;
  const slot = (W - L - R) / 12;
  const y = v => H - B - (v / yMax) * (H - B - T);
  const cx = i => L + slot * (i + 0.5);
  const expected = m => (model && typeof m.hgtNormal === 'number' ? m.kWhNormal + model.aKWh * (m.hgt - m.hgtNormal) : null);
  const { wrap, root } = chart(H, `Heizjahr ${yearLabel(y0)}: Verbrauch gegen Normalwetter`);
  const hid = uid();
  const gid = uid();
  root.append(
    svg('defs', {},
      svg('pattern', { id: hid, width: 5, height: 5, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, svg('line', { x1: 0, y1: 0, x2: 0, y2: 5, class: 'hatch' })),
      grad(gid, [['0%', 'stop-data', 1], ['100%', 'stop-data', 0.55]]))
  );
  const step = niceStep(yMax / 3);
  for (let v = step; v < yMax; v += step) {
    root.append(svg('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'grid' }));
    root.append(svg('text', { x: W - R, y: y(v) - 4, class: 'axis', 'text-anchor': 'end' }, `${fmt(v)} kWh`));
  }
  root.append(svg('line', { x1: L, x2: W - R, y1: y(0), y2: y(0), class: 'grid' }));
  slots.forEach((x, i) => {
    // Jahreszahl unter August und Januar
    if (i === 0 || x.mo === 1) {
      root.append(svg('line', { x1: L + slot * i + 1, x2: L + slot * i + 1, y1: H - B + 4, y2: H - 2, class: 'year' }));
      root.append(svg('text', { x: L + slot * i + 4, y: H - 3, class: 'axis' }, x.ym.slice(0, 4)));
    }
    const normal = x.m ? x.m.kWhNormal : x.open;
    if (normal !== null && y(0) - y(normal) > 0.5) {
      root.append(svg('rect', { x: cx(i) - slot * 0.36, y: y(normal), width: slot * 0.72, height: y(0) - y(normal), fill: `url(#${hid})`, class: x.m ? 'nbar' : 'nbar open' }));
    }
    if (x.m && y(0) - y(x.m.kWh) > 0.5) root.append(svg('rect', { x: cx(i) - slot * 0.19, y: y(x.m.kWh), width: slot * 0.38, height: y(0) - y(x.m.kWh), rx: 2, fill: `url(#${gid})` }));
    root.append(svg('text', { x: cx(i), y: H - B + 13, class: x.m && x.m.coverage >= 0.999 ? 'axis' : 'axis faint', 'text-anchor': 'middle' }, MONTHS[x.mo - 1].slice(0, 1)));
  });
  // Größte Abweichung in einem vollständigen Heizmonat beschriften
  let big = null;
  slots.forEach((x, i) => {
    const m = x.m;
    if (m && m.kWhNormal >= 60 && m.coverage >= 0.9 && (!big || Math.abs(m.kWh - m.kWhNormal) > Math.abs(big.m.kWh - big.m.kWhNormal))) big = { m, i };
  });
  if (big) {
    const d = big.m.kWh / big.m.kWhNormal - 1;
    const lx = Math.min(W - 26, Math.max(26, cx(big.i)));
    root.append(svg('text', { x: lx, y: Math.min(y(big.m.kWh), y(big.m.kWhNormal)) - 6, class: d < 0 ? 'lbl-good' : 'lbl-bad', 'text-anchor': 'middle' }, `${d < 0 ? '▼' : '▲'} ${pct(d)}`));
  }
  attachTip(wrap, root, W, H, px => {
    const i = Math.min(11, Math.max(0, Math.floor((px - L) / slot)));
    const { ym, m, open } = slots[i];
    if (!m && open === null) return null;
    const topY = m ? Math.min(y(m.kWh), y(m.kWhNormal)) : y(open);
    const hit = { x: cx(i), y: topY, box: { x: cx(i) - slot * 0.46, y: topY - 3, w: slot * 0.92, h: y(0) - topY + 3 } };
    if (!m) return { ...hit, lines: [formatMonth(ym), `noch offen · normal ≈ ${fmt(open)} kWh`] };
    const d = m.kWh / Math.max(1e-9, m.kWhNormal) - 1;
    const e = expected(m);
    const weather = typeof m.hgtNormal === 'number' && m.hgtNormal > 5 ? m.hgt / m.hgtNormal - 1 : null;
    return {
      ...hit,
      lines: [
        `${formatMonth(m.month)}${m.coverage < 0.999 ? ' (unvollständig)' : ''}`,
        `${fmt(m.kWh)} kWh · normal ${fmt(m.kWhNormal)} kWh`,
        m.kWhNormal < 20 ? null : Math.abs(d) < 0.01 ? 'so viel wie normal' : `${d < 0 ? '▼' : '▲'} ${pct(d)} ${d < 0 ? 'weniger' : 'mehr'} als normal`,
        weather !== null && Math.abs(weather) >= 0.02 ? `Wetter ${pct(weather)} ${weather > 0 ? 'kälter' : 'milder'} als normal` : null,
        e !== null && m.kWhNormal >= 20 ? `bei diesem Wetter erwartet ≈ ${fmt(Math.max(0, e))} kWh` : null,
      ],
    };
  });
  node.append(wrap, legend([['sw-gas', 'Verbrauch'], ['sw-normal', 'bei Normalwetter'], ...(future.size && slots.some(x => x.open !== null) ? [['sw-open', 'noch offen']] : [])]));
  if (list.length) {
    const sumK = list.reduce((sum, m) => sum + m.kWh, 0);
    const sumN = list.reduce((sum, m) => sum + m.kWhNormal, 0);
    const d = sumK / Math.max(1e-9, sumN) - 1;
    const hgt = list.reduce((sum, m) => sum + m.hgt, 0);
    const hgtN = list.reduce((sum, m) => sum + (m.hgtNormal || 0), 0);
    const w = hgtN > 0 ? hgt / hgtN - 1 : 0;
    const over = current !== null ? y0 < current : false;
    const from = list[0].month > `${y0}-08` ? ` (Daten ab ${formatMonth(list[0].month)})` : '';
    node.append(
      rich('insight', [
        `Heizjahr ${yearLabel(y0)}${over ? from : ' bisher'}: `, [`${fmt(sumK)} kWh`], ' – ',
        Math.abs(d) < 0.02 ? 'etwa so viel wie bei Normalwetter.' : `${d < 0 ? '▼' : '▲'} ${pct(d)} ${d < 0 ? 'weniger' : 'mehr'} als bei Normalwetter.`,
        Math.abs(w) >= 0.02 ? ` Das Wetter war ${pct(w)} ${w > 0 ? 'kälter' : 'milder'} als normal.` : '',
      ])
    );
  }
  node.append(html('p', 'foot', 'Antippen zeigt, ob es am Wetter lag oder an dir („bei diesem Wetter erwartet“).'));
  return true;
}

function legend(items) {
  const l = html('div', 'legend');
  for (const [cls, text] of items) {
    const i = html('span', 'legend-item');
    i.append(html('span', `swatch ${cls}`), document.createTextNode(text));
    l.append(i);
  }
  return l;
}

// ---------- 9 · Kosten pro Tag nach Temperatur + Sparrechner ----------
function dayCostCard(node, model0, ins) {
  const tariff = ins.tariffNow;
  if (!model0 || !tariff) return false;
  // So wie du diese Saison heizt (sonst Jahresmodell)
  const model = ins.level ? { a: ins.level.a, b: ins.level.b, theta: ins.level.theta } : model0;
  const fac = ins.factorNow;
  const kWh = t => (model.b + model.a * Math.max(0, model.theta - t)) * fac;
  const eur = t => (kWh(t) * tariff.ap) / 100 + tariff.basePerDay;
  head(node, 'Kosten pro Tag', 'Was ein Tag dich kostet', `Je nach Außentemperatur – Tarif ${tariff.name || 'aktuell'}, inklusive Grundpreis, ${ins.level ? 'so wie du diese Saison heizt' : 'nach deinem Jahresmodell'}.`);
  const H = 190;
  const L = 34;
  const R = 12;
  const T = 16;
  const B = 28;
  const t0 = -10;
  const t1 = 20;
  const step = niceStep((eur(t0) * 1.08) / 3);
  const yMax = Math.ceil((eur(t0) * 1.08) / step) * step;
  const x = t => L + ((t - t0) / (t1 - t0)) * (W - L - R);
  const y = v => H - B - (v / yMax) * (H - B - T);
  const e = ins.estimate;
  const { wrap, root } = chart(H, `Kosten pro Tag: bei 0 °C ${formatEuro(eur(0))}, bei −5 °C ${formatEuro(eur(-5))}`);
  const aid = uid();
  const cid = uid();
  const coldEnd = (model.theta - t0) / (t1 - t0);
  root.append(
    svg('defs', {},
      grad(aid, [['0%', 'stop-data', 0.38], ['100%', 'stop-data', 0.02]]),
      svg('linearGradient', { id: cid, x1: 0, y1: 0, x2: 1, y2: 0 },
        svg('stop', { offset: '0%', class: 'stop-cold', 'stop-opacity': 0.95 }),
        svg('stop', { offset: `${Math.round(coldEnd * 100)}%`, class: 'stop-cold', 'stop-opacity': 0.08 }),
        svg('stop', { offset: '100%', class: 'stop-cold', 'stop-opacity': 0 })))
  );
  for (let v = 0; v <= yMax + 1e-9; v += step) {
    root.append(svg('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'grid' }));
    root.append(svg('text', { x: L - 5, y: y(v) + 3, class: 'axis', 'text-anchor': 'end' }, `${fmt(v)} €`));
  }
  root.append(svg('rect', { x: L, y: H - B + 3, width: W - L - R, height: 3, rx: 1.5, fill: `url(#${cid})` }));
  for (let t = t0; t <= t1; t += 5) root.append(svg('text', { x: x(t), y: H - 8, class: 'axis', 'text-anchor': 'middle' }, tick(t)));
  const pts = [];
  for (let t = t0; t <= t1 + 1e-9; t += 0.5) pts.push([x(t), y(eur(t))]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
  root.append(svg('path', { d: `${line}L${x(t1)},${y(0)}L${x(t0)},${y(0)}Z`, fill: `url(#${aid})` }));
  root.append(svg('line', { x1: L, x2: W - R, y1: y(tariff.basePerDay), y2: y(tariff.basePerDay), class: 'base' }));
  root.append(svg('path', { d: line, class: 'curve' }));
  root.append(svg('text', { x: W - R, y: y(tariff.basePerDay) - 6, class: 'axis', 'text-anchor': 'end' }, `Grundpreis ${formatEuro(tariff.basePerDay)}`));
  if (e && typeof e.tmToday === 'number' && e.tmToday >= t0 && e.tmToday <= t1) {
    const tx = x(e.tmToday);
    root.append(svg('line', { x1: tx, x2: tx, y1: T, y2: H - B, class: 'today-c' }));
    root.append(svg('circle', { cx: tx, cy: y(eur(e.tmToday)), r: 5, class: 'mk-cold' }));
    const right = tx + 70 < W - R;
    root.append(svg('text', { x: right ? tx + 5 : tx - 5, y: T + 8, class: 'lbl-cold', 'text-anchor': right ? 'start' : 'end' }, `heute ${temp(e.tmToday)}`));
  }
  for (const t of [-5, 0, 10]) {
    if (e && Math.abs(t - e.tmToday) < 1.2) continue;
    root.append(svg('circle', { cx: x(t), cy: y(eur(t)), r: 3.5, class: 'mk' }));
    root.append(svg('text', { x: x(t) + 5, y: y(eur(t)) - 8, class: 'lbl' }, formatEuro(eur(t))));
  }
  attachTip(wrap, root, W, H, px => {
    const t = Math.min(t1, Math.max(t0, Math.round(((px - L) / (W - L - R)) * (t1 - t0) * 2) / 2 + t0));
    return {
      x: x(t),
      y: y(eur(t)),
      ring: 5,
      cross: { y1: T, y2: H - B },
      lines: [`bei ${temp(t)}`, `${formatEuro(eur(t))} am Tag`, `${fmt(kWh(t), 1)} kWh · ${fmt(kWh(t) / fac, 2)} m³`],
    };
  });
  node.append(wrap);
  if (e && typeof e.eurPerDay === 'number') {
    node.append(rich('insight', ['Heute (', temp(e.tmToday), ') kostet ein Tag etwa ', [formatEuro(e.eurPerDay)], '. Bei −5 °C wären es ', [formatEuro(eur(-5))], '.']));
  }
  const perDegree = (model.a * fac * tariff.ap) / 100;
  node.append(rich('insight', ['Jedes Grad kälter: ', [`+${formatEuro(perDegree)}`], ` am Tag (${fmt(model.a * fac, 1)} kWh). Ab `, [temp(model.theta)], ' heizt du praktisch nicht.']));
  const s = ins.savings;
  if (s && s.kWh > 0) {
    node.append(html('h3', 'sub-head', 'Sparrechner: 1 °C kühler'));
    node.append(html('p', 'lead', 'Eine Stufe weniger Raumtemperatur spart im Jahr ungefähr:'));
    node.append(tiles([
      ['good', `▼ ${fmt(s.kWh)} kWh`, `≈ ${pct(s.share)} weniger Gas`],
      ['good', s.eur === null ? '–' : `▼ ${fmt(s.eur)} €`, 'pro Jahr'],
    ]));
    node.append(html('p', 'foot', `Näherung aus deinem Modell: 1 °C kühler ≈ Heizgrenze 1 °C tiefer, bei normalem Wetter. Die bekannte Faustregel (≈ 6 %) gilt für Häuser mit Heizgrenze um 15–20 °C – du heizt erst unter ${temp(model.theta)}, dadurch wirkt jedes Grad stärker.`));
  }
  return true;
}

// ---------- 3 · Heizkalender: jeder Tag ein Kästchen ----------
const EMBER = [[0x3a, 0x26, 0x17], [0x6b, 0x3d, 0x18], [0xa8, 0x60, 0x1f], [0xe0, 0x97, 0x4a], [0xf8, 0xd4, 0x9b]];
function ember(t) {
  const u = Math.min(1, Math.max(0, t)) * (EMBER.length - 1);
  const i = Math.min(EMBER.length - 2, Math.floor(u));
  const k = u - i;
  const c = EMBER[i].map((v, j) => Math.round(v + (EMBER[i + 1][j] - v) * k));
  return `#${c.map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

let compareYear = null; // gewählte Vergleichssaison (Startjahr); bleibt beim Neuzeichnen erhalten

/** Tageswert für den Kalender: kWh, Teil-Tage hochgerechnet; null = keine Ablesung. */
const dayValue = d => (d.kWh === null || d.covered < 0.25 ? null : d.kWh / Math.min(1, Math.max(d.covered, 1e-9)));

/** Heizmonate (Monatsnummern in Heizjahr-Reihenfolge Aug–Jul): normaler Bedarf ≥ 1 % des Jahres. */
function heatingMonths(ins) {
  const normal = ins.season && ins.season.months;
  const total = normal ? normal.reduce((s, x) => s + x.kWhNormal, 0) : 0;
  const list = total > 0 ? normal.filter(x => x.kWhNormal >= 0.01 * total).map(x => Number(x.month.slice(5, 7))) : [10, 11, 12, 1, 2, 3, 4];
  return [8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7].filter(m => list.includes(m));
}

function calendarCard(node, ins) {
  const days = expandDays(ins.days).map(d => ({ ...d, v: dayValue(d) }));
  if (!days.some(d => d.v !== null && d.v >= 0.5)) return false;
  const byDate = new Map(days.map(d => [d.date, d]));
  const today = days[days.length - 1].date;
  const current = heatYear(today.slice(0, 7));
  const past = [...new Set(days.filter(d => d.v !== null && d.v >= 0.5).map(d => heatYear(d.date.slice(0, 7))))].filter(y => y < current).sort();
  if (!past.includes(compareYear)) compareYear = past.length ? past[past.length - 1] : null;
  const shownYears = [current].concat(compareYear === null ? [] : [compareYear]);
  // Monate: Heizmonate + Monate, in denen in einer der beiden Saisons wirklich geheizt wurde
  const months = heatingMonths(ins);
  for (const y of shownYears) {
    for (const mo of [8, 9, 5, 6, 7]) {
      const ym = `${mo >= 8 ? y : y + 1}-${String(mo).padStart(2, '0')}`;
      const sum = days.filter(d => d.date.startsWith(ym) && d.v !== null).reduce((s, d) => s + d.v, 0);
      if (sum >= 20 && !months.includes(mo)) months.push(mo);
    }
  }
  months.sort((a, b) => ((a + 4) % 12) - ((b + 4) % 12)); // Aug … Jul
  const inSeason = (d, y) => heatYear(d.date.slice(0, 7)) === y && months.includes(Number(d.date.slice(5, 7)));
  const vals = days.filter(d => shownYears.some(y => inSeason(d, y)) && d.v !== null && d.v >= 0.5).map(d => d.v).sort((a, b) => a - b);
  const vmax = Math.max(1, vals.length ? vals[Math.min(vals.length - 1, Math.floor(vals.length * 0.95))] : 1);

  head(node, 'Heizkalender', 'Diese Saison im Vergleich', 'Nur die Heizmonate. Je heller, desto mehr Gas an diesem Tag – beide Kalender mit derselben Skala, rechts die Monatssumme in kWh.');
  node.append(html('h3', 'cal-head', `Saison ${yearLabel(current)}`), seasonCalendar(byDate, current, months, vmax, today));
  const row = html('div', 'cal-compare');
  row.append(html('h3', 'cal-head', 'Vergleich'));
  if (past.length) {
    const sel = html('select', 'select');
    sel.setAttribute('aria-label', 'Vergleichssaison');
    for (const y of past.slice().reverse()) {
      const opt = html('option', '', `Saison ${yearLabel(y)}`);
      opt.value = String(y);
      opt.selected = y === compareYear;
      sel.append(opt);
    }
    sel.addEventListener('change', () => {
      compareYear = Number(sel.value);
      calendarCard(node, ins);
    });
    row.append(sel);
  }
  node.append(row);
  if (compareYear !== null) node.append(seasonCalendar(byDate, compareYear, months, vmax, today));
  else node.append(html('p', 'muted small-text', 'Den Vergleich gibt es ab der zweiten Heizsaison mit Ablesungen.'));

  const scale = html('div', 'scale');
  scale.append(document.createTextNode('wenig'));
  for (const t of [0.1, 0.3, 0.5, 0.75, 1]) {
    const i = html('i');
    i.style.background = ember(t);
    scale.append(i);
  }
  scale.append(document.createTextNode(`viel (${fmt(vmax)}+ kWh)`));
  node.append(scale);

  // Gleicher Stichtag: diese Saison bis heute gegen die Vergleichssaison bis zum selben Kalendertag
  const sumUntil = (y, mmdd) => {
    const end = `${mmdd >= '08-01' ? y : y + 1}-${mmdd}`;
    let sum = 0;
    let first = null;
    for (const d of days) {
      if (heatYear(d.date.slice(0, 7)) !== y || d.date > end || d.kWh === null) continue;
      sum += d.kWh;
      if (!first && d.covered > 0) first = d.date;
    }
    return { sum, first };
  };
  const mmdd = today.slice(5);
  const cur = sumUntil(current, mmdd);
  if (compareYear !== null) {
    const cmp = sumUntil(compareYear, mmdd);
    const d = cmp.sum > 0 ? cur.sum / cmp.sum - 1 : null;
    const late = cmp.first && cmp.first > `${compareYear}-08-01`;
    node.append(rich('insight', [
      `Bis heute (${formatDateShort(today)}): `, [`${fmt(cur.sum)} kWh`], ` – in ${yearLabel(compareYear)} bis zum selben Tag `, [`${fmt(cmp.sum)} kWh`],
      d === null ? '.' : ` (${d < 0 ? '▼' : '▲'} ${pct(d)}).`,
      late ? ` Ablesungen dort erst ab ${formatDate(cmp.first)}.` : '',
    ]));
  }
  node.append(html('p', 'foot', 'Zwischen zwei Ablesungen wird der Verbrauch nach Temperatur auf die Tage verteilt – einzelne Tage sind also geschätzt, die Summe über alle Tage stimmt mit den Ablesungen überein.'));
  return true;
}

/** Ein Kalender für ein Heizjahr: Zeilen = Heizmonate, Spalten = Tage 1–31, rechts die Monatssumme. */
function seasonCalendar(byDate, y, months, vmax, today) {
  const LBL = 30;
  const SUM = 38;
  const T = 2;
  const pitch = 12;
  const cw = (W - LBL - SUM) / 31;
  const H = T + months.length * pitch + 14;
  const { wrap, root } = chart(H, `Heizkalender Saison ${yearLabel(y)}`);
  const cells = [];
  months.forEach((mo, ri) => {
    const year = mo >= 8 ? y : y + 1;
    const len = new Date(Date.UTC(year, mo, 0)).getUTCDate(); // Tage im Monat
    const ry = T + ri * pitch;
    root.append(svg('text', { x: 0, y: ry + 8.5, class: 'axis' }, MONTHS[mo - 1]));
    let sum = 0;
    let any = false;
    for (let day = 1; day <= len; day++) {
      const iso = `${year}-${String(mo).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const d = byDate.get(iso);
      const cx = LBL + (day - 1) * cw;
      const attrs = { x: cx, y: ry, width: cw - 1.5, height: pitch - 2.5, rx: 2 };
      if (!d || d.v === null) root.append(svg('rect', { ...attrs, class: 'cell-none' }));
      else root.append(svg('rect', { ...attrs, fill: d.v < 0.5 ? '#2a2a2c' : ember(Math.sqrt(d.v / vmax)) }));
      if (iso === today) root.append(svg('rect', { ...attrs, class: 'today-box' }));
      if (d && d.kWh !== null) {
        sum += d.kWh;
        any = true;
      }
      cells.push({ iso, d, ri, day });
    }
    root.append(svg('text', { x: W, y: ry + 8.5, class: any ? 'axis sum' : 'axis faint', 'text-anchor': 'end' }, any ? fmt(sum) : '–'));
  });
  for (const day of [1, 10, 20, 31]) root.append(svg('text', { x: LBL + (day - 0.5) * cw, y: H - 2, class: 'axis', 'text-anchor': 'middle' }, String(day)));
  attachTip(wrap, root, W, H, (px, py) => {
    const ri = Math.floor((py - T) / pitch);
    const day = Math.floor((px - LBL) / cw) + 1;
    const c = cells.find(x => x.ri === ri && x.day === day);
    if (!c) return null;
    const ry = T + ri * pitch;
    const cx = LBL + (day - 1) * cw;
    const d = c.d;
    const wd = WEEKDAYS[new Date(`${c.iso}T12:00:00Z`).getUTCDay()];
    return {
      x: cx + cw / 2,
      y: ry,
      box: { x: cx - 1, y: ry - 1, w: cw + 0.5, h: pitch - 0.5 },
      lines: [
        `${wd}, ${formatDate(c.iso)}`,
        !d || d.v === null ? (c.iso > today ? 'noch nicht' : 'keine Ablesung') : d.v < 0.5 ? 'nicht geheizt' : `${fmt(d.v, 1)} kWh${d.covered < 0.999 ? ' (hochgerechnet)' : ''}`,
        d && typeof d.tm === 'number' ? `Ø ${temp(d.tm)}` : null,
      ],
    };
  });
  return wrap;
}

// ---------- 2 · Heizsaison-Fortschritt ----------
function seasonCard(node, ins) {
  const s = ins.season;
  if (!s) return false;
  const y0 = s.start.slice(0, 4);
  const y1 = s.end.slice(0, 4);
  head(node, 'Heizsaison', `Winter ${y0}/${y1.slice(2)}`, 'Wie viel vom Winter schon geschafft ist – nach normalem Heizbedarf, nicht nach Kalendertagen.');
  const H = 178;
  const cx = W / 2;
  const cy = 156;
  const r = 116;
  const sw = 16;
  const pos = (share, rad = r) => {
    const a = Math.PI * (1 - share);
    return [cx + rad * Math.cos(a), cy - rad * Math.sin(a)];
  };
  const arc = (a, b) => {
    const [x0, y0p] = pos(a);
    const [x1, y1p] = pos(b);
    return `M${x0.toFixed(1)},${y0p.toFixed(1)}A${r},${r} 0 0 1 ${x1.toFixed(1)},${y1p.toFixed(1)}`;
  };
  const { wrap, root } = chart(H, `Heizsaison: ${pct(s.share)} geschafft`);
  const gid = uid();
  root.append(svg('defs', {}, svg('linearGradient', { id: gid, gradientUnits: 'userSpaceOnUse', x1: cx - r, y1: 0, x2: cx + r, y2: 0 },
    svg('stop', { offset: '0%', class: 'stop-data', 'stop-opacity': 0.55 }),
    svg('stop', { offset: '100%', class: 'stop-data', 'stop-opacity': 1 }))));
  root.append(svg('path', { d: arc(0, 1), class: 'track', 'stroke-width': sw }));
  if (s.share > 0.002) root.append(svg('path', { d: arc(0, Math.min(1, s.share)), class: 'progress', stroke: `url(#${gid})`, 'stroke-width': sw }));
  // Monatsskala; Monate ganz ohne Heizbedarf (Aug, Sep, Jun, Jul) sitzen an den Enden und bekommen keinen Strich
  for (const m of (s.marks || []).filter(x => x.share > 0.02 && x.share < 0.98)) {
    const [ax, ay] = pos(m.share, r - sw / 2 - 4);
    const [bx, by] = pos(m.share, r - sw / 2 - 9);
    root.append(svg('line', { x1: ax, y1: ay, x2: bx, y2: by, class: 'tick' }));
    const mo = Number(m.month.slice(5, 7));
    if ([10, 1, 4].includes(mo) && m.share > 0.06 && m.share < 0.94) {
      const [lx, ly] = pos(m.share, r + sw / 2 + 11);
      root.append(svg('text', { x: lx, y: ly + 3, class: 'axis', 'text-anchor': 'middle' }, MONTHS[mo - 1]));
    }
  }
  root.append(svg('text', { x: cx - r, y: cy + 18, class: 'axis', 'text-anchor': 'middle' }, 'Aug'));
  root.append(svg('text', { x: cx + r, y: cy + 18, class: 'axis', 'text-anchor': 'middle' }, 'Jul'));
  const [kx, ky] = pos(Math.min(1, s.share));
  root.append(svg('circle', { cx: kx, cy: ky, r: 5, class: 'knob' }));
  root.append(svg('text', { x: cx, y: cy - 22, class: 'gauge-value', 'text-anchor': 'middle' }, pct(s.share)));
  root.append(svg('text', { x: cx, y: cy - 2, class: 'lbl-m', 'text-anchor': 'middle' }, 'geschafft'));
  node.append(wrap);
  node.append(tiles([
    ['gas', `${fmt(s.doneKWh)} kWh`, `seit ${formatDateShort(s.start)} verbraucht`],
    ['', `≈ ${fmt(s.remainingKWh)} kWh`, `kommen noch${typeof s.remainingEur === 'number' ? ` (≈\u00a0${fmt(s.remainingEur)}\u00a0€)` : ''}`],
  ]));
  const ahead = (s.marks || []).filter(m => ['01', '04'].includes(m.month.slice(5)) && m.share > s.share);
  if (ahead.length) {
    const parts = ['Normalerweise sind '];
    ahead.forEach((m, i) => {
      if (i) parts.push(', ');
      parts.push(`am 1. ${m.month.slice(5) === '01' ? 'Januar' : 'April'} `, [pct(m.share)]);
    });
    parts.push(' geschafft.');
    node.append(rich('insight', parts));
  } else if (s.share >= 0.95) {
    node.append(html('p', 'insight', 'Der Winter ist so gut wie geschafft.'));
  }
  node.append(html('p', 'foot', '„Kommen noch“: dein Modell bei normalem Wetter bis Ende Juli, zum aktuellen Arbeitspreis.'));
  return true;
}
