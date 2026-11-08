// Notbremse (klassisches Skript, läuft auch wenn die App-Module nicht laden): Meldet sich die App nicht innerhalb
// von 8 s als gestartet, werden Service Worker und App-Cache gelöscht und die Seite einmal neu geladen.
// Gespeicherte Daten (Schlüssel, Warteschlange) bleiben erhalten – gelöscht wird nur die zwischengespeicherte App.
(function () {
  var FLAG = 'gas.recovering';
  setTimeout(function () {
    if (window.gasStarted) {
      try { sessionStorage.removeItem(FLAG); } catch (e) { /* egal */ }
      return;
    }
    var tried = false;
    try {
      tried = sessionStorage.getItem(FLAG) === '1';
      sessionStorage.setItem(FLAG, '1');
    } catch (e) { /* ohne sessionStorage: nur Meldung */ tried = true; }
    if (tried) {
      var box = document.createElement('p');
      box.id = 'guardMsg';
      box.className = 'card notice warn';
      box.textContent = 'Die App konnte nicht starten. Bitte ganz schließen und neu öffnen. Hilft das nicht: Verbindung prüfen.';
      var main = document.querySelector('main') || document.body;
      main.insertBefore(box, main.firstChild);
      return;
    }
    var jobs = [];
    if (navigator.serviceWorker) {
      jobs.push(navigator.serviceWorker.getRegistrations().then(function (rs) {
        return Promise.all(rs.map(function (r) { return r.unregister(); }));
      }));
    }
    if (window.caches) {
      jobs.push(caches.keys().then(function (ks) {
        return Promise.all(ks.filter(function (k) { return k.indexOf('gas-shell-') === 0; }).map(function (k) { return caches.delete(k); }));
      }));
    }
    Promise.all(jobs).catch(function () { /* trotzdem neu laden */ }).then(function () { location.reload(); });
  }, 8000);
})();
