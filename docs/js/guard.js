// Notbremse (klassisches Skript, läuft auch wenn die App-Module nicht laden): Meldet sich die App nicht innerhalb
// von 8 s als gestartet, holt der Service Worker die neueste Version vollständig (alle Dateien gemeinsam, am
// Browser-Cache vorbei) und die Seite lädt einmal neu. Klappt es dann immer noch nicht, steht der Fehler da.
// Gespeicherte Daten (Schlüssel, Warteschlange) bleiben immer erhalten.
(function () {
  var FLAG = 'gas.recovering';
  var firstError = '';
  function note(msg) {
    if (!firstError && msg) firstError = String(msg).slice(0, 300);
  }
  window.addEventListener('error', function (e) {
    var where = e.filename ? ' (' + e.filename.split('/').pop() + ':' + e.lineno + ')' : '';
    note((e.message || 'Fehler beim Laden') + where);
  });
  window.addEventListener('unhandledrejection', function (e) {
    note(e.reason && e.reason.message ? e.reason.message : e.reason);
  });

  function flag(value) {
    try {
      if (value === undefined) return sessionStorage.getItem(FLAG) === '1';
      if (value) sessionStorage.setItem(FLAG, '1');
      else sessionStorage.removeItem(FLAG);
    } catch (e) {
      return true; // ohne sessionStorage kein zweiter Versuch (sonst Endlosschleife)
    }
    return false;
  }

  function showMessage() {
    var box = document.createElement('p');
    box.id = 'guardMsg';
    box.className = 'card notice warn';
    box.textContent = 'Die App konnte nicht starten. ' + (firstError ? 'Fehler: ' + firstError + ' – ' : '') +
      'Bitte ganz schließen und neu öffnen (am PC: Strg+F5).';
    var main = document.querySelector('main') || document.body;
    main.insertBefore(box, main.firstChild);
  }

  setTimeout(function () {
    if (window.gasStarted) return flag(false);
    if (flag()) return showMessage();
    flag(true);
    var done = false;
    function reload() {
      if (!done) {
        done = true;
        location.reload();
      }
    }
    if (!navigator.serviceWorker) return reload();
    // Neue Version übernimmt die Seite → neu laden; findet sich keine, nach kurzer Zeit trotzdem neu laden
    navigator.serviceWorker.addEventListener('controllerchange', reload);
    navigator.serviceWorker
      .register('./sw.js', { scope: './', updateViaCache: 'none' })
      .then(function (reg) {
        return reg.update().then(function () { return reg; });
      })
      .catch(function () { return null; })
      .then(function (reg) {
        // Wird gerade eine Version installiert, auf deren Übernahme warten (höchstens 20 s)
        setTimeout(reload, reg && (reg.installing || reg.waiting) ? 20000 : 1000);
      });
  }, 8000);
})();
