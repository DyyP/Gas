// Gaszähler – App-Steuerung.
import { API_URL } from '../config.js';
import { APP_VERSION } from './version.js';
import { createStorage } from './storage.js';
import { createApi, NetworkError } from './api.js';
import { createQueue } from './queue.js';
import { checkReading, latestKnown } from './plausi.js';
import { parseReading, localIsoDate, localTime, readingT, formatDate } from './format.js';
import { renderMeter, renderIntervals, renderHints, renderQueue, renderPeriods, renderMonths, renderModel } from './render.js';
import { renderAnalyse } from './analyse.js';

const $ = id => document.getElementById(id);
const dom = Object.fromEntries(
  [
    'netBadge', 'updateBanner', 'reloadBtn', 'setupNotice', 'keyForm', 'keyInput', 'keyMsg', 'readingForm', 'date', 'value',
    'saveBtn', 'msg', 'queueCard', 'queueTitle', 'flushBtn', 'queueList', 'lastText', 'lastSub', 'dataAge', 'intervalRows',
    'intervalEmpty', 'hintsCard', 'hintsList', 'keyState', 'serverState', 'testBtn', 'changeKeyBtn', 'testMsg', 'appVersion',
    'confirmDialog', 'confirmText', 'confirmOk', 'confirmCancel', 'periodList', 'periodEmpty', 'monthRows', 'monthEmpty',
    'weatherState', 'ratingText', 'modelFacts', 'meterLabel', 'odo', 'meterTiles', 'analyseEmpty', 'aHeat', 'aMonths', 'aDayCost',
    'aCalendar', 'aSeason',
  ].map(id => [id, $(id)])
);

const storage = createStorage();
const api = createApi({ url: API_URL });
const getKey = () => storage.get('key', '');
const queue = createQueue({ storage, api, getKey, onChange: () => renderAll() });
let overview = storage.get('overview', null);
let offline = false;
let lastSync = 0;
let syncing = null;

const today = () => localIsoDate();
const MIN_SCHEMA = 4; // Server-Schema, das diese App-Version erwartet
const AUTH_TEXT = 'Der Schlüssel ist falsch oder wurde geändert.';

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return 'ungültige URL in config.js';
  }
}

function setMsg(node, text, kind = '') {
  node.textContent = text;
  node.className = `msg ${kind}`.trim();
}

function setOverview(o) {
  if (!o) return;
  overview = o;
  storage.set('overview', o);
}

function setOffline(value) {
  offline = value;
  dom.netBadge.hidden = !(value || navigator.onLine === false);
}

/** Datumsfeld: steht auf „heute“, solange du es nicht selbst änderst (auch über Mitternacht hinweg). */
function updateDateInput() {
  const t = today();
  dom.date.max = t;
  const min = overview && overview.settings && overview.settings.minDate;
  if (min && min > '2000-01-01') dom.date.min = min;
  if (!dom.date.value || dom.date.value > t || dom.date.dataset.auto !== '0') {
    dom.date.value = t;
    dom.date.dataset.auto = '1';
  }
}

/** Neuester noch nicht gesendeter Stand, mit Kennzeichen, ob er neuer als der Server-Stand ist. */
function newestPending(entries) {
  const best = latestKnown(null, entries);
  if (!best) return null;
  const last = overview && overview.last;
  return { ...best, newer: !last || readingT(best.date, best.time) > readingT(last.date, last.time) };
}

function renderAll() {
  const entries = queue.entries();
  renderQueue(dom, entries, {
    confirm: id => {
      queue.confirm(id);
      sync();
    },
    dismiss: id => queue.dismiss(id),
  });
  renderMeter(dom, overview, newestPending(entries), today());
  renderIntervals(dom.intervalRows, dom.intervalEmpty, overview ? overview.intervals : []);
  // Server-Skript älter als die App (Update im Sheet vergessen oder keine neue Version bereitgestellt)?
  const serverOld = !!overview && (overview.schema || 0) < MIN_SCHEMA;
  const oldText = 'Das Skript im Sheet ist noch auf einem älteren Stand. Bitte das Update aus dem README durchführen (Code ersetzen, setup ausführen, neue Version bereitstellen).';
  const hints = overview ? overview.hints.slice() : [];
  if (serverOld) hints.unshift({ level: 'warn', text: oldText });
  renderHints(dom.hintsCard, dom.hintsList, hints);
  renderModel(dom.ratingText, dom.modelFacts, overview && overview.model, overview && overview.rating);
  renderPeriods(dom.periodList, dom.periodEmpty, (overview && overview.periods) || []);
  renderMonths(dom.monthRows, dom.monthEmpty, (overview && overview.months) || []);
  renderAnalyse(dom, serverOld ? null : overview);
  if (serverOld) dom.periodEmpty.textContent = dom.monthEmpty.textContent = dom.analyseEmpty.textContent = oldText;
  const w = overview && overview.weather;
  dom.weatherState.textContent = w && w.last ? `DWD-Station ${w.station}, Werte bis ${formatDate(w.last)} – Quelle: Deutscher Wetterdienst` : 'noch keine Daten';
  const key = getKey();
  dom.keyState.textContent = key ? `gespeichert (…${key.slice(-4)})` : 'fehlt';
  dom.serverState.textContent = API_URL ? `${hostOf(API_URL)}${offline ? ' – nicht erreichbar' : ''}` : 'noch nicht eingetragen';
  updateDateInput();
}

function showKeyForm(message) {
  dom.keyForm.hidden = false;
  setMsg(dom.keyMsg, message || '', 'error');
  if (location.hash && location.hash !== '#erfassen') location.hash = '#erfassen';
}

/**
 * Warteschlange senden; die Übersicht nur nachladen, wenn das Senden keine mitgebracht hat (spart eine
 * Anfrage – bei Kaltstart von Apps Script bis zu ~15 s). Fehler landen einheitlich in res.error.
 * Gleichzeitige Aufrufe teilen sich einen Lauf.
 */
function sync() {
  if (!API_URL || !getKey()) {
    renderAll();
    return Promise.resolve(null);
  }
  if (syncing) return syncing;
  syncing = (async () => {
    lastSync = Date.now();
    const res = await queue.flush();
    if (res.overview) setOverview(res.overview);
    if (!res.stoppedBy && !res.overview) {
      try {
        setOverview((await api.overview(getKey())).overview);
      } catch (err) {
        res.error = err;
      }
    }
    if (res.error && res.error.code === 'AUTH') showKeyForm(AUTH_TEXT);
    setOffline(res.error instanceof NetworkError);
    return res;
  })().finally(() => {
    syncing = null;
    renderAll();
  });
  return syncing;
}

function askConfirm(text) {
  return new Promise(resolve => {
    dom.confirmText.textContent = text;
    const done = answer => {
      dom.confirmOk.onclick = dom.confirmCancel.onclick = dom.confirmDialog.oncancel = null;
      if (dom.confirmDialog.open) dom.confirmDialog.close();
      resolve(answer);
    };
    dom.confirmOk.onclick = () => done(true);
    dom.confirmCancel.onclick = () => done(false);
    dom.confirmDialog.oncancel = e => {
      e.preventDefault();
      done(false);
    };
    dom.confirmDialog.showModal();
  });
}

/** Meldung nach dem Senden für genau diese Ablesung. */
async function reportOutcome(id, res) {
  const sent = res && res.sent.find(s => s.id === id);
  if (sent) return setMsg(dom.msg, sent.saved === 'duplicate' ? 'War schon gespeichert ✓' : 'Gespeichert ✓', 'ok');
  const rejected = res && res.rejected.find(r => r.id === id);
  if (rejected) {
    queue.dismiss(id);
    return setMsg(dom.msg, `Nicht gespeichert: ${rejected.message}`, 'error');
  }
  const entry = queue.entries().find(e => e.id === id);
  if (entry && entry.state === 'confirm') {
    if (await askConfirm(entry.error)) {
      queue.confirm(id);
      setMsg(dom.msg, 'Wird gesendet …');
      return reportOutcome(id, await sync());
    }
    queue.dismiss(id);
    return setMsg(dom.msg, 'Verworfen – bitte den Wert prüfen.', 'warn');
  }
  if (!getKey()) return setMsg(dom.msg, 'Lokal gespeichert – zum Senden fehlt noch der Schlüssel.', 'warn');
  if (!API_URL) return setMsg(dom.msg, 'Lokal gespeichert – die App ist noch nicht mit dem Server verbunden.', 'warn');
  return setMsg(dom.msg, 'Offline gespeichert – wird gesendet, sobald eine Verbindung besteht.', 'warn');
}

dom.readingForm.addEventListener('submit', async e => {
  e.preventDefault();
  const date = dom.date.value;
  const value = parseReading(dom.value.value);
  const reading = { id: crypto.randomUUID(), date, time: date === today() ? localTime() : null, value };
  const settings = (overview && overview.settings) || {};
  const check = checkReading(reading, {
    today: today(),
    minDate: settings.minDate,
    maxPerDay: typeof settings.maxPerDay === 'number' ? settings.maxPerDay : 20,
    latest: latestKnown(overview && overview.last, queue.entries()),
  });
  if (check.error) return setMsg(dom.msg, check.error, 'error');
  if (check.warn) {
    if (!(await askConfirm(check.warn))) return dom.value.focus();
    reading.confirmed = true;
  }
  queue.add(reading); // zuerst lokal – geht nicht verloren
  dom.value.value = '';
  dom.date.dataset.auto = '1';
  dom.saveBtn.disabled = true;
  setMsg(dom.msg, 'Wird gesendet …');
  try {
    await reportOutcome(reading.id, await sync());
  } finally {
    dom.saveBtn.disabled = false;
  }
});

dom.date.addEventListener('input', () => {
  dom.date.dataset.auto = dom.date.value === today() ? '1' : '0';
});

dom.keyForm.addEventListener('submit', async e => {
  e.preventDefault();
  const key = dom.keyInput.value.trim();
  if (!key) return setMsg(dom.keyMsg, 'Bitte den Schlüssel eingeben.', 'error');
  storage.set('key', key);
  dom.keyInput.value = '';
  dom.keyForm.hidden = true;
  setMsg(dom.msg, 'Verbinde …');
  const err = (await sync() || {}).error;
  if (!err) setMsg(dom.msg, 'Verbunden ✓', 'ok');
  else setMsg(dom.msg, err.code === 'AUTH' ? '' : err.message, 'error');
});

dom.flushBtn.addEventListener('click', () => sync());
dom.changeKeyBtn.addEventListener('click', () => showKeyForm(''));
dom.reloadBtn.addEventListener('click', () => location.reload());

dom.testBtn.addEventListener('click', async () => {
  if (!API_URL) return setMsg(dom.testMsg, 'Keine API-URL eingetragen (docs/config.js).', 'error');
  if (!getKey()) return setMsg(dom.testMsg, 'Kein Schlüssel gespeichert.', 'error');
  setMsg(dom.testMsg, 'Teste …');
  const err = (await sync() || {}).error;
  if (!err) return setMsg(dom.testMsg, `Verbindung ok – ${overview.readingsCount} Ablesung(en) im Sheet.`, 'ok');
  if (navigator.onLine === false) return setMsg(dom.testMsg, 'Kein Internet.', 'error');
  const check = err instanceof NetworkError ? '. Prüfe: Web-App-URL in config.js, Bereitstellung mit Zugriff „Jeder“, Internetverbindung.' : '';
  setMsg(dom.testMsg, err.message + check, 'error');
});

// Ansichten über den Hash (#erfassen, #prognose, #analyse, #einstellungen); alte Lesezeichen #auswertung → Prognose
const VIEWS = ['erfassen', 'prognose', 'analyse', 'einstellungen'];
function route() {
  const hash = location.hash.slice(1) === 'auswertung' ? 'prognose' : location.hash.slice(1);
  const name = VIEWS.includes(hash) ? hash : 'erfassen';
  for (const v of VIEWS) {
    $(`view-${v}`).hidden = v !== name;
    const tab = $(`tab-${v}`);
    if (v === name) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
}
window.addEventListener('hashchange', () => {
  route();
  window.scrollTo(0, 0);
});

// Live-Zähler: alle 10 s weiterzählen, solange die App sichtbar ist
setInterval(() => {
  if (document.visibilityState === 'visible' && !dom.odo.hidden) renderMeter(dom, overview, newestPending(queue.entries()), today());
}, 10000);

// Wieder sichtbar (iOS friert Home-Bildschirm-Apps oft nur ein): Datum aktualisieren, Daten holen, nach Updates sehen.
function onResume() {
  renderAll();
  if (Date.now() - lastSync > 20000) sync();
  if ('serviceWorker' in navigator) navigator.serviceWorker.getRegistration().then(r => r && r.update()).catch(() => {});
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') onResume();
});
window.addEventListener('pageshow', e => {
  if (e.persisted) onResume();
});
window.addEventListener('online', () => {
  setOffline(false);
  sync();
});
window.addEventListener('offline', () => setOffline(true));

// Service Worker: App-Hülle offline verfügbar
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' }).catch(() => {});
  // Neue Version installiert: sofort neu laden, außer du tippst gerade etwas ein (dann Hinweis mit Knopf)
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return;
    if (!dom.value.value && !dom.keyInput.value && !dom.confirmDialog.open) location.reload();
    else dom.updateBanner.hidden = false;
  });
}

// Start
dom.appVersion.textContent = APP_VERSION;
route();
if (!API_URL) {
  dom.setupNotice.hidden = false;
  dom.setupNotice.textContent =
    'Die App ist noch nicht mit dem Server verbunden: In docs/config.js die Web-App-URL (…/exec) eintragen – siehe README, Schritt „Einrichtung“. Ablesungen werden bis dahin lokal gespeichert.';
}
setOffline(false);
renderAll();
if (API_URL && !getKey()) showKeyForm('');
else sync();
window.gasStarted = true; // für js/guard.js: App läuft
if ($('guardMsg')) $('guardMsg').remove();
