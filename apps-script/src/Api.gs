/**
 * Api.gs – Web-App-Schnittstelle.
 *
 *   GET  …/exec  → Lebenszeichen ohne Daten
 *   POST …/exec  → Body (text/plain, JSON): { v, key, action, … }
 *        action "overview"   → { ok, v, data: { overview } }
 *        action "addReading" → { ok, v, data: { saved: "new"|"duplicate", overview } }
 *   Fehler       → { ok: false, v, error: { code, message, details? } }
 *   Codes: BAD_REQUEST, NOT_CONFIGURED, AUTH, VALIDATION, CONFLICT, PLAUSIBILITY, BUSY, SERVER
 *
 * Die API kann nur lesen und Ablesungen anhängen – nie ändern oder löschen.
 */

const MAX_BODY = 4096;

function doGet() {
  return json_({ ok: true, v: API_VERSION, service: 'gaszaehler' });
}

function doPost(e) {
  return json_(handlePost_(e));
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function handlePost_(e) {
  let ss = null;
  try {
    const body = parseBody_(e);
    const props = PropertiesService.getScriptProperties().getProperties();
    if (!props.KEY || !props.SHEET_ID) {
      throw apiError_('NOT_CONFIGURED', 'Server ist noch nicht eingerichtet – im Sheet „Gaszähler → Einrichten / aktualisieren“ wählen.');
    }
    if (!safeEqual_(body.key, props.KEY)) throw apiError_('AUTH', 'Falscher Schlüssel');
    ss = SpreadsheetApp.openById(props.SHEET_ID);
    if (body.action === 'overview') return ok_({ overview: buildOverview_(ss) });
    if (body.action === 'addReading') return ok_(addReadingAction_(ss, body.reading));
    throw apiError_('BAD_REQUEST', 'Unbekannte Aktion');
  } catch (err) {
    if (err && err.code) return fail_(err.code, err.message, err.details);
    // Unerwarteter Fehler: vor der Anmeldung (ss noch null) nichts verraten, danach zeigen und protokollieren.
    if (!ss) return fail_('SERVER', 'Serverfehler');
    logEvent_(ss, 'FEHLER', 'api', (err && err.stack) || String(err));
    return fail_('SERVER', 'Serverfehler: ' + ((err && err.message) || String(err)));
  }
}

function parseBody_(e) {
  const contents = e && e.postData && typeof e.postData.contents === 'string' ? e.postData.contents : null;
  if (contents === null) throw apiError_('BAD_REQUEST', 'Leere Anfrage');
  if (contents.length > MAX_BODY) throw apiError_('BAD_REQUEST', 'Anfrage zu groß');
  let body;
  try {
    body = JSON.parse(contents);
  } catch (x) {
    throw apiError_('BAD_REQUEST', 'Anfrage ist kein JSON');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw apiError_('BAD_REQUEST', 'Anfrage ist kein Objekt');
  if (body.v !== API_VERSION) throw apiError_('BAD_REQUEST', 'API-Version passt nicht – App bitte neu laden.');
  return body;
}

function ok_(data) {
  return { ok: true, v: API_VERSION, data: data };
}

function fail_(code, message, details) {
  const error = { code: code, message: message };
  if (details) error.details = details;
  return { ok: false, v: API_VERSION, error: error };
}

/**
 * Speichert eine Ablesung unter Sperre (keine zwei Schreibvorgänge gleichzeitig). Jeder Tab wird nur einmal
 * gelesen: dieselben Eingaben dienen der Prüfung (inkl. Modell) und danach der neuen Übersicht.
 */
function addReadingAction_(ss, input) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw apiError_('BUSY', 'Server ist gerade beschäftigt – bitte gleich nochmal.');
  try {
    const inp = readInputs_(ss);
    const s = inp.settings.values;
    const r = normalizeReadingInput_(input, s.Zähler_aktuell);
    const before = computeFromInputs_(inp);
    const res = checkNewReading_(r, inp.readings.readings, {
      today: before.today,
      minDate: s.Mindestdatum,
      maxPerDay: s.Plausi_max_m3_pro_Tag,
      expect: modelExpectation_(before.result),
    });
    if (res.status !== 'new') return { saved: res.status, overview: buildOverview_(ss, before) };
    const row = appendReading_(ss, r, inp.readings.readings);
    SpreadsheetApp.flush(); // laut Doku vor dem Freigeben der Sperre
    if (row) inp.readings.readings.push(Object.assign({ row: row, exclude: false }, r));
    else inp.readings = readReadings_(ss); // nachgetragen und sortiert → Zeilennummern neu lesen
    return { saved: 'new', overview: buildOverview_(ss, computeFromInputs_(inp)) };
  } finally {
    lock.releaseLock();
  }
}

/** Erwartung aus dem Modell für einen neuen Zeitraum (nur bei brauchbarem Modell). */
function modelExpectation_(result) {
  const m = result.model;
  if (!m || result.rating.level === 'rot') return null;
  return (before, r) => {
    const days = pairDays_({ a: before, b: r }, result.temps);
    return days ? predictPair_(m, days, r.t - before.t) : null;
  };
}
