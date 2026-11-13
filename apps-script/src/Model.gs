/**
 * Model.gs – Verbrauchsmodell (rein, in Node testbar).
 *
 *   V_i = a · H_i(θ) + b · D_i + ε_i,   Var(ε_i) = σ² · D_i
 *   V_i: m³ im Ablesezeitraum i · D_i: Länge in Tagen · H_i(θ) = Σ Anteil_d · max(0, θ − Tm_d)
 *   a: m³ je Heizgradtag (Zustand der Wohnung) · b: Grundlast m³/Tag (≥ 0) · θ: Heizgrenze
 * Gewichtete kleinste Quadrate (Gewicht 1/D_i), geschlossene Form. θ wird aus den Daten geschätzt
 * (Raster 10–18 °C) oder aus den Einstellungen genommen.
 */

const THETA_GRID = [10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 14.5, 15, 15.5, 16, 16.5, 17, 17.5, 18];
const MIN_INTERVALS = 3;

/** Gewichtete Regression y = a·h + b·d (Gewicht 1/d) mit b ≥ 0. obs: [{y, h, d}]. */
function wls_(obs) {
  let shh = 0, shd = 0, sdd = 0, shy = 0, sdy = 0, sy = 0;
  for (const o of obs) {
    shh += (o.h * o.h) / o.d;
    shd += o.h;
    sdd += o.d;
    shy += (o.h * o.y) / o.d;
    sdy += o.y;
    sy += o.y;
  }
  if (shh <= 1e-12) return null;
  const det = shh * sdd - shd * shd;
  let a = shy / shh;
  let b = 0;
  let p = 1;
  if (det > 1e-9 * shh * sdd) {
    const a2 = (shy * sdd - shd * sdy) / det;
    const b2 = (shh * sdy - shd * shy) / det;
    if (b2 >= 0) {
      a = a2;
      b = b2;
      p = 2;
    }
  }
  let sse = 0;
  for (const o of obs) sse += Math.pow(o.y - a * o.h - b * o.d, 2) / o.d;
  const dof = Math.max(1, obs.length - p);
  const s2 = sse / dof;
  const cov = p === 2 ? { aa: (s2 * sdd) / det, ab: (-s2 * shd) / det, bb: (s2 * shh) / det } : { aa: s2 / shh, ab: 0, bb: 0 };
  return { a: a, b: b, p: p, sse: sse, s2: s2, dof: dof, cov: cov, n: obs.length, sumD: sdd, sumY: sy, sumH: shd };
}

/** Heizgradtage eines Zeitraums bei Heizgrenze θ aus den Tagesanteilen. */
function hgtOf_(days, theta) {
  let h = 0;
  for (const x of days) h += x.f * Math.max(0, theta - x.tm);
  return h;
}

/** Tagesanteile [{iso, f, tm}] eines Ablesepaars; null, wenn eine Temperatur fehlt. */
function pairDays_(p, temps) {
  const days = [];
  for (let d = Math.floor(p.a.t); d < p.b.t; d++) {
    const f = Math.min(p.b.t, d + 1) - Math.max(p.a.t, d);
    if (f <= 1e-9) continue;
    const iso = isoFromDayNumber_(d);
    const tm = temps[iso] ? temps[iso].tm : null;
    if (tm === null) return null;
    days.push({ iso: iso, f: f, tm: tm });
  }
  return days;
}

/**
 * Passt das Modell an. Rückgabe null (zu wenig Daten) oder
 * { a, b, theta, thetaSource, s2, cov, dof, n, excluded, coverage, cv, relSeA }.
 * normalYearHgt(θ): normale Jahres-HGT bei θ (für die Abdeckung).
 */
function fitModel_(pairs, temps, settings, normalYearHgt) {
  const usable = [];
  let excluded = 0;
  for (const p of pairs) {
    if (p.b.exclude) {
      excluded++;
      continue;
    }
    const days = pairDays_(p, temps);
    if (days && p.b.t - p.a.t > 0) usable.push({ y: p.dv, d: p.b.t - p.a.t, days: days });
  }
  if (usable.length < MIN_INTERVALS) return null;

  const auto = String(settings.Heizgrenze_aus_Daten || 'ja').toLowerCase() !== 'nein' && usable.length >= 6;
  const thetas = auto ? THETA_GRID : [settings.Heizgrenze_C];
  let best = null;
  for (const theta of thetas) {
    const fit = wls_(usable.map(u => ({ y: u.y, d: u.d, h: hgtOf_(u.days, theta) })));
    if (!fit || fit.a <= 0) continue;
    // Bei gleichem Fehler die Heizgrenze näher an 15 °C bevorzugen (Norm)
    if (!best || fit.sse < best.fit.sse - 1e-9 || (Math.abs(fit.sse - best.fit.sse) <= 1e-9 && Math.abs(theta - 15) < Math.abs(best.theta - 15))) {
      best = { theta: theta, fit: fit };
    }
  }
  if (!best) return null;
  const f = best.fit;
  const normal = normalYearHgt(best.theta);
  const meanRate = f.sumY / f.sumD;
  return {
    a: f.a,
    b: f.b,
    theta: best.theta,
    thetaSource: auto ? 'Daten' : 'Einstellung',
    s2: f.s2,
    cov: f.cov,
    dof: f.dof,
    n: f.n,
    excluded: excluded,
    coverage: normal > 0 ? f.sumH / normal : 0,
    cv: meanRate > 0 ? Math.sqrt(f.sse / f.sumD) / meanRate : null,
    relSeA: Math.sqrt(f.cov.aa) / f.a,
  };
}

/** Ampel + Klartext zur Verlässlichkeit. */
function modelRating_(m) {
  if (!m) return { level: 'rot', text: 'Noch kein Modell: Es braucht mindestens ' + MIN_INTERVALS + ' Ablesezeiträume mit Temperaturdaten.' };
  const cover = Math.round(Math.min(m.coverage, 9.99) * 100);
  let level = 'grün';
  if (m.n < MIN_INTERVALS || m.coverage < 0.15) level = 'rot';
  else if (m.coverage < 0.5 || m.relSeA > 0.1) level = 'gelb';
  const basis = m.n + ' Ablesezeiträume, ' + (cover >= 100 ? 'mehr als eine ganze Heizsaison' : cover + ' % einer normalen Heizsaison');
  const quality = 'Streuung um das Modell ' + Math.round((m.cv || 0) * 100) + ' %, Unsicherheit des Verbrauchs je Heizgradtag ±' + Math.round(m.relSeA * 100) + ' %';
  const lead = { grün: 'Belastbar', gelb: 'Eingeschränkt belastbar', rot: 'Noch wenig belastbar' }[level];
  return { level: level, text: lead + ': ' + basis + '. ' + quality + '.' };
}

/** Erwarteter Verbrauch (m³) und Standardabweichung für einen Zeitraum mit bekannten Tagesanteilen. */
function predictPair_(m, days, d) {
  const h = hgtOf_(days, m.theta);
  const mean = m.a * h + m.b * d;
  const varParam = m.cov.aa * h * h + 2 * m.cov.ab * h * d + m.cov.bb * d * d;
  return { mean: mean, sd: Math.sqrt(m.s2 * d + varParam) };
}

const SEASON_MIN_EXPECTED_M3 = 14; // ≈ 150 kWh Heizbedarf: darunter wäre jede Aussage Zufall
const SEASON_MIN_DAYS = 28;
const SEASON_FIT_MIN = 6; // ab so vielen Zeiträumen mit Heizbedarf: eigene Heizgrenze und Steigung

/**
 * Modell nur aus dieser Heizsaison („wenn du so weiterheizt“): alle Ablesezeiträume, die seit Beginn des Heizjahres
 * (01.08.) enden – mindestens die der letzten 28 Tage.
 * - Ab 6 Zeiträumen mit Heizbedarf werden Heizgrenze und Steigung neu geschätzt (wie das Jahresmodell). So wird auch
 *   ein heruntergedrehtes Thermostat richtig erkannt: Es verschiebt die Heizgrenze, statt jeden Tag gleich viel
 *   Prozent zu sparen.
 * - Davor: ein Faktor auf das Jahresmodell (gemessen ÷ erwartet bei echtem Wetter; als Summenverhältnis nach
 *   Heizbedarf gewichtet), Heizgrenze unverändert, Unsicherheit des Faktors in den Parametern.
 * factor = Verbrauch im Normaljahr Saisonmodell ÷ Jahresmodell (fairer Vergleich, egal was sich geändert hat).
 * Rückgabe null (kein Modell / zu wenig Heizbedarf) oder ein Modell wie fitModel_ plus
 * { source: 'Saison' | 'Faktor', factor, from, to, nSeason, expectedM3, actualM3 }.
 */
function seasonModel_(pairs, temps, m, today, settings, normalYearHgt) {
  if (!m) return null;
  const used = pairs.filter(p => p.b.exclude !== true);
  if (!used.length) return null;
  const lastT = used.reduce((t, p) => Math.max(t, p.b.t), -Infinity);
  const y = Number(today.slice(5, 7)) >= 8 ? Number(today.slice(0, 4)) : Number(today.slice(0, 4)) - 1;
  const from = Math.min(dayNumber_(y + '-08-01'), Math.floor(lastT) - SEASON_MIN_DAYS);
  const rows = [];
  let to = null;
  for (const p of used) {
    if (p.b.t <= from) continue;
    const days = pairDays_(p, temps);
    if (!days) continue;
    rows.push({ p: p, y: p.dv, w: m.a * hgtOf_(days, m.theta) + m.b * (p.b.t - p.a.t) }); // w: Erwartung Jahresmodell
    if (!to || p.b.date > to) to = p.b.date;
  }
  const sumW = rows.reduce((s, r) => s + r.w, 0);
  const sumY = rows.reduce((s, r) => s + r.y, 0);
  if (sumW < SEASON_MIN_EXPECTED_M3) return null;
  const heated = rows.filter(r => r.w > 0.2);

  let sm = null;
  let source = 'Saison';
  if (heated.length >= SEASON_FIT_MIN) {
    sm = fitModel_(rows.map(r => r.p), temps, { Heizgrenze_aus_Daten: settings.Heizgrenze_aus_Daten, Heizgrenze_C: m.theta }, normalYearHgt);
  }
  if (!sm) {
    source = 'Faktor';
    const k = sumY / sumW;
    // Unsicherheit: gewichtete Streuung der einzelnen Verhältnisse, mindestens die Modellstreuung (cv) je Zeitraum
    const sumW2 = heated.reduce((s, r) => s + r.w * r.w, 0);
    const n = heated.length;
    const empirical = n >= 3 ? Math.sqrt((heated.reduce((s, r) => s + r.w * r.w * Math.pow(r.y / r.w - k, 2), 0) / (sumW * sumW)) * (n / (n - 1))) : 0;
    const floor = k * (m.cv || 0.2) * (sumW2 > 0 ? Math.sqrt(sumW2) / sumW : 1);
    const se = Math.max(empirical, floor, 0.02 * k);
    sm = scaleModel_(m, k, Number.isFinite(se) ? se : 0.2 * k);
  }
  const year = x => x.b * 365 + x.a * normalYearHgt(x.theta);
  return Object.assign(sm, {
    source: source,
    factor: year(m) > 0 ? year(sm) / year(m) : 1,
    from: isoFromDayNumber_(from),
    to: to,
    nSeason: rows.length,
    expectedM3: sumW,
    actualM3: sumY,
  });
}

/** Jahresmodell mit Faktor k (Heizgrenze und Tagesstreuung gleich); se = Unsicherheit von k → in die Parameter. */
function scaleModel_(m, k, se) {
  const s = se || 0;
  return Object.assign({}, m, {
    a: m.a * k,
    b: m.b * k,
    cov: { aa: m.cov.aa * k * k + Math.pow(m.a * s, 2), ab: m.cov.ab * k * k + m.a * m.b * s * s, bb: m.cov.bb * k * k + Math.pow(m.b * s, 2) },
  });
}
