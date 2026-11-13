/**
 * Forecast.gs – Prognose bis Periodenende per Monte Carlo (rein, in Node testbar).
 *
 * Unsicherheiten: Modellparameter (a, b, σ²), Zufallsabweichung der Tage, Wetter bis Periodenende (ein ganzes
 * historisches Jahr je Lauf), Umrechnung m³ → kWh (±3 % solange geschätzt, gilt für ALLE kWh der Periode).
 * Weil der Verbrauch linear in a und b ist, werden die Tageswerte je Wetterjahr vorab zu Summen verdichtet –
 * jeder Lauf kostet dann nur ein paar Rechenschritte.
 */

const MC_RUNS = 4000;

/** Reproduzierbarer Zufall (mulberry32). */
function rng_(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash_(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

function normal_(rnd) {
  let u = 0;
  while (u === 0) u = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
}

/** Gamma-verteilte Zufallszahl (Marsaglia & Tsang). */
function gamma_(rnd, shape) {
  if (shape < 1) return gamma_(rnd, shape + 1) * Math.pow(rnd(), 1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x;
    let v;
    do {
      x = normal_(rnd);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rnd();
    if (u < 1 - 0.0331 * x * x * x * x || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

function quantile_(sorted, q) {
  const i = q * (sorted.length - 1);
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

function band_(values) {
  const s = values.slice().sort((x, y) => x - y);
  return { p10: round_(quantile_(s, 0.1), 2), p50: round_(quantile_(s, 0.5), 2), p80: round_(quantile_(s, 0.8), 2), p90: round_(quantile_(s, 0.9), 2) };
}

/** Temperatur eines Kalendertags (MM-TT) in Jahr y; 29.02. fällt auf den 28.02. zurück. */
function tmInYear_(weather, y, mmdd) {
  const v = weather[y + '-' + mmdd];
  if (v !== undefined) return v;
  return mmdd === '02-29' ? weather[y + '-02-28'] : undefined;
}

/**
 * Prognose für eine Periode. ctx: { days (Tagesrechnung bis heute), model, theta, weather, years [Jahre],
 * normals {MM-TT: HGT bei theta}, conversions, placeholder, tariffs, payments, settings, today, u (rel. Umrechnungsunsicherheit) }
 * – mit dem Saisonmodell als model/theta/normals ergibt das „wenn du so weiterheizt wie diese Saison“.
 * Rückgabe null, wenn ohne Modell unbekannte Tage bleiben oder ein Tarif fehlt.
 */
function forecastPeriod_(p, ctx) {
  const m = ctx.model;
  const pastEnd = p.end < ctx.today ? p.end : ctx.today;
  const acc = { kWhM: 0, costM: 0, m3M: 0, base: 0, M1: 0, MH: 0, K1: 0, KH: 0, C1: 0, CH: 0 };
  let tariffOk = true;

  // Verlauf fürs Diagramm: Ist-Kosten bis zur letzten vollen Ablesung, Prognose an Stichtagen (Monatsenden, heute, Ende)
  let measuredUntil = null;
  for (const d of ctx.days) if (d.date >= p.start && d.date <= pastEnd && d.covered > 0.999) measuredUntil = d.date;
  const checkpoints = {};
  for (let y = Number(p.start.slice(0, 4)), mo = Number(p.start.slice(5, 7)); ; ) {
    const iso = y + '-' + pad2_(mo) + '-' + pad2_(daysInMonth_(y, mo));
    if (iso >= p.end) break;
    checkpoints[iso] = true;
    if (++mo > 12) {
      mo = 1;
      y++;
    }
  }
  [p.end, ctx.today <= p.end ? ctx.today : null, measuredUntil].forEach(d => d && d >= p.start && (checkpoints[d] = true));
  const snaps = [];
  const actual = [];
  const snapshot = (iso, perYear) => {
    if (!checkpoints[iso]) return;
    snaps.push({ date: iso, base: acc.base, costM: acc.costM, C1: acc.C1, CH: acc.CH, years: perYear ? perYear.map(py => py.CH) : null });
  };

  // Vergangenheit: gemessene Anteile + nicht abgelesene Anteile mit echtem Wetter
  for (const d of ctx.days) {
    if (d.date < p.start || d.date > pastEnd) continue;
    if (d.ap === null || d.costBase === null) tariffOk = false;
    const f = d.factor;
    const ap = (d.ap || 0) / 100;
    acc.base += d.costBase || 0;
    acc.m3M += d.m3 || 0;
    acc.kWhM += (d.m3 || 0) * f;
    acc.costM += (d.m3 || 0) * f * ap;
    const u = 1 - d.covered;
    if (u > 1e-9) {
      const h = d.tm !== null && d.tm !== undefined ? Math.max(0, ctx.theta - d.tm) : ctx.normals[d.date.slice(5)] || 0;
      acc.M1 += u;
      acc.MH += u * h;
      acc.K1 += u * f;
      acc.KH += u * f * h;
      acc.C1 += u * f * ap;
      acc.CH += u * f * ap * h;
    }
    if (measuredUntil && d.date <= measuredUntil && (dayNumber_(d.date) - dayNumber_(p.start)) % 7 === 0 || d.date === measuredUntil) {
      actual.push({ date: d.date, cost: round_(acc.costM + acc.base, 2) });
    }
    snapshot(d.date, null);
  }

  // Zukunft: Wetter je Klimajahr
  const future = p.end > ctx.today ? isoRange_(isoFromDayNumber_(Math.max(dayNumber_(ctx.today) + 1, dayNumber_(p.start))), p.end) : [];
  const years = ctx.years.filter(y => future.every(iso => tmInYear_(ctx.weather, y, iso.slice(5)) !== undefined));
  const perYear = (years.length ? years : [null]).map(() => ({ MH: 0, KH: 0, CH: 0 }));
  for (const iso of future) {
    const tariff = validAt_(ctx.tariffs, iso);
    if (!tariff) tariffOk = false;
    const f = factorAt_(ctx.conversions, iso, ctx.placeholder).factor;
    const ap = tariff ? tariff.ap / 100 : 0;
    acc.base += tariff ? basePerDay_(tariff.gp, iso, ctx.settings.Grundpreis_Verteilung) : 0;
    acc.M1 += 1;
    acc.K1 += f;
    acc.C1 += f * ap;
    perYear.forEach((py, i) => {
      const tm = years.length ? tmInYear_(ctx.weather, years[i], iso.slice(5)) : null;
      const h = tm === null ? ctx.normals[iso.slice(5)] || 0 : Math.max(0, ctx.theta - tm);
      py.MH += h;
      py.KH += f * h;
      py.CH += f * ap * h;
    });
    snapshot(iso, perYear);
  }
  if (!tariffOk) return null;
  if (!m && acc.M1 > 0) return null;

  const all = paymentSchedule_(ctx.payments, p.start, p.end);
  const due = all.filter(x => x.date <= ctx.today);
  const paymentsTotal = all.reduce((s, x) => s + x.amount, 0);
  const paid = due.reduce((s, x) => s + x.amount, 0);
  const mean = (k) => perYear.reduce((s, py) => s + py[k], 0) / perYear.length;
  const avgYear = { MH: mean('MH'), KH: mean('KH'), CH: mean('CH') };
  const rnd = rng_(hash_(p.name + '|' + ctx.today));
  const a0 = m ? m.a : 0;
  const b0 = m ? m.b : 0;

  const traj = snaps.map(() => []);

  /** Ein Lauf; opts schaltet einzelne Unsicherheiten ab (für „größte Unsicherheit“), opts.track sammelt den Verlauf. */
  function run(opts) {
    let a = a0;
    let b = b0;
    let s2 = m ? m.s2 : 0;
    if (m && opts.model) {
      s2 = (m.s2 * m.dof) / (2 * gamma_(rnd, m.dof / 2)); // σ² aus skalierter inverser χ²-Verteilung
      const k = s2 / m.s2;
      const z1 = normal_(rnd);
      const z2 = normal_(rnd);
      const l11 = Math.sqrt(Math.max(0, m.cov.aa * k));
      const l21 = l11 > 0 ? (m.cov.ab * k) / l11 : 0;
      const l22 = Math.sqrt(Math.max(0, m.cov.bb * k - l21 * l21));
      a = Math.max(0, a0 + l11 * z1);
      b = Math.max(0, b0 + l21 * z1 + l22 * z2);
    }
    const yi = opts.weather ? Math.floor(rnd() * perYear.length) : -1;
    const yr = yi >= 0 ? perYear[yi] : avgYear;
    const MH = acc.MH + yr.MH;
    const mean3 = b * acc.M1 + a * MH;
    const noise = opts.model ? Math.sqrt(s2 * acc.M1) * normal_(rnd) : 0;
    const m3U = Math.max(0, mean3 + noise);
    const scale = mean3 > 1e-9 ? m3U / mean3 : 0;
    const kWhU = scale * (b * acc.K1 + a * (acc.KH + yr.KH));
    const costU = scale * (b * acc.C1 + a * (acc.CH + yr.CH));
    const conv = opts.conversion ? 1 + ctx.u * normal_(rnd) : 1;
    const kWh = conv * (acc.kWhM + kWhU);
    const cost = conv * (acc.costM + costU) + acc.base;
    if (opts.track) {
      snaps.forEach((sn, k) => {
        const chf = sn.years ? (yi >= 0 ? sn.years[yi] : sn.years.reduce((x, v) => x + v, 0) / sn.years.length) : 0;
        traj[k].push(conv * (sn.costM + scale * (b * sn.C1 + a * (sn.CH + chf))) + sn.base);
      });
    }
    return { m3: acc.m3M + m3U, kWh: kWh, cost: cost, balance: cost - paymentsTotal };
  }

  const full = [];
  for (let i = 0; i < MC_RUNS; i++) full.push(run({ model: true, weather: true, conversion: true, track: true }));
  const spread = opts => {
    const v = [];
    for (let i = 0; i < MC_RUNS / 4; i++) v.push(run(opts).balance);
    const b = band_(v);
    return b.p90 - b.p10;
  };
  const sources = [
    { name: 'Wetter', width: future.length ? spread({ weather: true }) : 0 },
    { name: 'Modell', width: acc.M1 > 0 ? spread({ model: true }) : 0 },
    { name: 'Umrechnung', width: spread({ conversion: true }) },
  ].sort((x, y) => y.width - x.width);

  const kWh = band_(full.map(r => r.kWh));
  const cost = band_(full.map(r => r.cost));
  const remaining = all.length - due.length;
  const perRate = q => Math.max(0, Math.ceil((q - paid) / remaining));
  return {
    m3: band_(full.map(r => r.m3)),
    kWh: kWh,
    cost: cost,
    balance: band_(full.map(r => r.balance)),
    paymentsTotal: round_(paymentsTotal, 2),
    paymentsCount: all.length,
    measuredShare: kWh.p50 > 0 ? round_(Math.min(1, acc.kWhM / kWh.p50), 3) : 1,
    unknownDays: round_(acc.M1, 1),
    climateYears: years.length,
    mainUncertainty: sources[0].width >= 1 ? sources[0].name : null,
    measuredUntil: measuredUntil,
    actual: actual,
    trajectory: snaps
      .map((sn, k) => Object.assign({ date: sn.date }, band_(traj[k])))
      .filter(t => !measuredUntil || t.date >= measuredUntil)
      .map(t => ({ date: t.date, p10: t.p10, p50: t.p50, p90: t.p90 })),
    paymentSteps: all.reduce((list, x) => list.concat([{ date: x.date, sum: round_((list.length ? list[list.length - 1].sum : 0) + x.amount, 2) }]), []),
    recommendation:
      p.start <= ctx.today && remaining > 0
        ? { remaining: remaining, current: all[all.length - 1].amount, balanced: perRate(cost.p50), safe: perRate(cost.p80) }
        : null,
  };
}
