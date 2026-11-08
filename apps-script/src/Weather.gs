/**
 * Weather.gs – Tagesmitteltemperatur der DWD-Station (Opendata, CC BY 4.0, Quelle: Deutscher Wetterdienst).
 *
 *   laufend:   …/daily/kl/recent/tageswerte_KL_<Station>_akt.zip  (letzte ~550 Tage, 1 Tag Verzug)
 *   Historie:  …/daily/kl/historical/tageswerte_KL_<Station>_<von>_<bis>_hist.zip (Name ändert sich jährlich)
 * Darin produkt_klima_tag_*.txt: Semikolon-getrennt, Spalten MESS_DATUM (JJJJMMTT) und TMK (°C), -999 = fehlt.
 */

const DWD_KL_BASE = 'https://opendata.dwd.de/climate_environment/CDC/observations_germany/climate/daily/kl/';

/** Station immer fünfstellig (im Sheet kann aus „05906“ die Zahl 5906 werden). */
function dwdStation_(v) {
  const s = String(v === undefined || v === null || v === '' ? '05906' : v).replace(/\D/g, '');
  return ('00000' + s).slice(-5);
}

/** Parst produkt_klima_tag_*.txt → [{date, tm}] ab fromIso (rein, testbar). */
function parseDwdKl_(text, fromIso) {
  const lines = text.split(/\r?\n/);
  const header = lines[0].split(';').map(s => s.trim());
  const iDate = header.indexOf('MESS_DATUM');
  const iTmk = header.indexOf('TMK');
  if (iDate < 0 || iTmk < 0) throw new Error('DWD-Datei hat unerwartetes Format (MESS_DATUM/TMK fehlt)');
  const from = fromIso ? fromIso.replace(/-/g, '') : '';
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const f = line.split(';');
    const d = (f[iDate] || '').trim();
    if (d.length !== 8 || d < from) continue;
    const tm = Number((f[iTmk] || '').trim());
    if (!isFinite(tm) || tm <= -999) continue;
    out.push({ date: d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6, 8), tm: tm });
  }
  return out;
}

/** Sucht im Verzeichnis-Listing den Namen der Historien-Datei (rein, testbar). */
function findDwdHistFile_(html, station) {
  const re = new RegExp('tageswerte_KL_' + station + '_(\\d{8})_(\\d{8})_hist\\.zip', 'g');
  let best = null;
  let m;
  while ((m = re.exec(html))) if (!best || m[2] > best.to) best = { name: m[0], to: m[2] };
  return best ? best.name : null;
}

/** HTTP-Abruf mit Wiederholung bei Netz-/Serverfehlern (2 s, 4 s, 8 s). */
function fetchWithRetry_(url) {
  let last = '';
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) Utilities.sleep(1000 * Math.pow(2, attempt));
    try {
      const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
      const code = res.getResponseCode();
      if (code === 200) return res;
      last = 'HTTP ' + code;
      if (code < 500 && code !== 429) break; // 404 & Co.: Wiederholen hilft nicht
    } catch (e) {
      last = String(e && e.message ? e.message : e);
    }
  }
  throw new Error('Abruf fehlgeschlagen (' + last + '): ' + url);
}

function readDwdZip_(url, fromIso) {
  const blob = fetchWithRetry_(url).getBlob();
  const files = Utilities.unzip(blob);
  const produkt = files.find(f => /^produkt_klima_tag_.*\.txt$/.test(f.getName()));
  if (!produkt) throw new Error('DWD-Archiv ohne produkt_klima_tag-Datei: ' + url);
  return parseDwdKl_(produkt.getDataAsString('ISO-8859-1'), fromIso);
}

function fetchDwdRecent_(station, fromIso) {
  return readDwdZip_(DWD_KL_BASE + 'recent/tageswerte_KL_' + station + '_akt.zip', fromIso);
}

function fetchDwdHistorical_(station, fromIso) {
  const html = fetchWithRetry_(DWD_KL_BASE + 'historical/').getContentText();
  const name = findDwdHistFile_(html, station);
  if (!name) throw new Error('Keine DWD-Historie für Station ' + station + ' gefunden');
  return readDwdZip_(DWD_KL_BASE + 'historical/' + name, fromIso);
}

/**
 * Ergänzt/aktualisiert den Tab „Wetter“. Historie wird nur geholt, wenn sie fehlt; die laufende Datei
 * jedes Mal (der DWD korrigiert jüngste Werte nachträglich). Rückgabe: Bericht als Text.
 */
function updateWeather_(ss, settings) {
  const station = dwdStation_(settings.DWD_Station);
  const from = settings.Wetter_ab || '2020-01-01';
  const known = readWeather_(ss, true).map;
  const merged = {};
  Object.keys(known).forEach(d => (merged[d] = known[d]));
  const notes = [];

  const firstKnown = Object.keys(known).sort()[0];
  if (!firstKnown || firstKnown > from) {
    const hist = fetchDwdHistorical_(station, from);
    hist.forEach(r => (merged[r.date] = r.tm));
    notes.push('Historie: ' + hist.length + ' Tage');
  }
  const recent = fetchDwdRecent_(station, from);
  let changed = 0;
  recent.forEach(r => {
    if (merged[r.date] !== r.tm) changed++;
    merged[r.date] = r.tm;
  });
  notes.push('aktuell: ' + recent.length + ' Tage, ' + changed + ' neu/geändert');
  writeWeather_(ss, merged, station);
  const last = Object.keys(merged).sort().pop();
  notes.push('letzter Tag: ' + (last ? deDate_(last) : '–'));
  return 'DWD ' + station + ' – ' + notes.join(', ');
}
