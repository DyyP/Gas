// Offline-Warteschlange: Jede Ablesung wird ZUERST lokal gespeichert und dann gesendet.
// Geht das Senden schief (kein Netz, Zeitüberschreitung), bleibt sie liegen und wird später erneut
// gesendet – sicher, weil der Server dieselbe ID (oder gleichen Tag + Wert) nur einmal speichert.
//
// Zustände: pending (wartet) · confirm (Server fragt nach) · rejected (abgelehnt, mit Grund)
import { isRetryable } from './api.js';

export function createQueue({ storage, api, getKey, onChange = () => {}, now = () => new Date() }) {
  let running = null;
  const load = () => {
    const q = storage.get('queue', []);
    return Array.isArray(q) ? q : [];
  };
  const save = q => {
    storage.set('queue', q);
    onChange(q);
  };
  const update = (id, patch) => save(load().map(e => (e.id === id ? { ...e, ...patch } : e)));
  const drop = id => save(load().filter(e => e.id !== id));

  function add({ id, date, time, value, confirmed = false }) {
    const q = load();
    q.push({ id, date, time, value, confirmed, createdAt: now().toISOString(), attempts: 0, state: 'pending', error: null });
    save(q);
  }

  async function run() {
    const result = { sent: [], rejected: [], confirm: [], stoppedBy: null, error: null, overview: null };
    const tried = new Set();
    for (;;) {
      const next = load().find(e => e.state === 'pending' && !tried.has(e.id));
      if (!next) break;
      tried.add(next.id);
      const key = getKey();
      if (!key) {
        result.stoppedBy = 'nokey';
        break;
      }
      try {
        const data = await api.addReading(
          { id: next.id, date: next.date, time: next.time, value: next.value, confirmed: next.confirmed === true },
          key
        );
        drop(next.id);
        result.sent.push({ id: next.id, saved: data.saved });
        result.overview = data.overview;
      } catch (err) {
        if (isRetryable(err) || err.code === 'AUTH' || err.code === 'NOT_CONFIGURED' || err.code === 'NO_URL') {
          update(next.id, { attempts: (next.attempts || 0) + 1, error: err.message });
          result.stoppedBy = err.code === 'AUTH' ? 'auth' : 'network';
          result.error = err;
          break; // Rest bleibt in der Warteschlange
        }
        if (err.code === 'PLAUSIBILITY') {
          update(next.id, { state: 'confirm', error: err.message });
          result.confirm.push(next.id);
          continue;
        }
        update(next.id, { state: 'rejected', error: err.message }); // VALIDATION, CONFLICT, BAD_REQUEST
        result.rejected.push({ id: next.id, message: err.message });
      }
    }
    return result;
  }

  return {
    add,
    entries: load,
    pendingCount: () => load().filter(e => e.state === 'pending').length,
    /** Sendet alle wartenden Einträge nacheinander. Gleichzeitige Aufrufe teilen sich einen Lauf. */
    flush() {
      if (!running) running = run().finally(() => (running = null));
      return running;
    },
    /** Rückfrage bestätigt → erneut senden mit confirmed. */
    confirm: id => update(id, { state: 'pending', confirmed: true, error: null }),
    /** Eintrag verwerfen (abgelehnt oder Rückfrage verneint). */
    dismiss: drop,
  };
}
