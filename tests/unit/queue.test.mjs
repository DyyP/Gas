import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createQueue } from '../../docs/js/queue.js';
import { createStorage } from '../../docs/js/storage.js';
import { createApi, ApiError, NetworkError } from '../../docs/js/api.js';

function memoryBackend() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m };
}

/** Fake-Server: speichert per ID, antwortet je nach Modus. */
function fakeApi() {
  const saved = new Map();
  const api = {
    mode: 'ok',
    calls: 0,
    async addReading(r, key) {
      api.calls++;
      if (api.mode === 'offline') throw new NetworkError('Server nicht erreichbar');
      if (key !== 'k') throw new ApiError('AUTH', 'Falscher Schlüssel');
      if (r.value < 0) throw new ApiError('VALIDATION', 'Ungültiger Zählerstand');
      if (r.value > 10000 && !r.confirmed) throw new ApiError('PLAUSIBILITY', 'Stimmt der Wert?');
      const dup = saved.has(r.id);
      saved.set(r.id, r);
      return { saved: dup ? 'duplicate' : 'new', overview: { readingsCount: saved.size } };
    },
  };
  return { api, saved };
}

const make = (opts = {}) => {
  const backend = memoryBackend();
  const storage = createStorage(backend);
  const { api, saved } = fakeApi();
  let key = opts.key === undefined ? 'k' : opts.key;
  const q = createQueue({ storage, api, getKey: () => key, now: () => new Date('2026-11-08T10:00:00Z') });
  return { q, api, saved, storage, backend, setKey: k => (key = k) };
};

const r = (n, over = {}) => ({ id: `id-0000000${n}`, date: `2026-11-0${n}`, time: null, value: 2300 + n, ...over });

test('online: zuerst lokal, dann gesendet und entfernt', async () => {
  const { q, saved, backend } = make();
  q.add(r(1));
  assert.ok(backend.m.get('gas.queue').includes('id-00000001'), 'liegt lokal, bevor gesendet wird');
  const res = await q.flush();
  assert.deepEqual(res.sent, [{ id: 'id-00000001', saved: 'new' }]);
  assert.equal(q.entries().length, 0);
  assert.equal(saved.size, 1);
  assert.equal(res.overview.readingsCount, 1);
});

test('offline: bleibt liegen, später genau einmal gesendet', async () => {
  const { q, api, saved } = make();
  api.mode = 'offline';
  q.add(r(1));
  q.add(r(2));
  const res = await q.flush();
  assert.equal(res.stoppedBy, 'network');
  assert.equal(q.pendingCount(), 2);
  assert.equal(q.entries()[0].attempts, 1);
  assert.equal(api.calls, 1, 'nach dem ersten Netzfehler wird abgebrochen');
  api.mode = 'ok';
  const res2 = await q.flush();
  assert.equal(res2.sent.length, 2);
  assert.equal(q.entries().length, 0);
  assert.equal(saved.size, 2);
});

test('Wiederholung nach verlorener Antwort ist sicher (Duplikat)', async () => {
  const { q, api } = make();
  const real = api.addReading;
  api.addReading = async (rd, key) => {
    await real(rd, key); // Server speichert …
    throw new NetworkError('Zeitüberschreitung'); // … aber Antwort kommt nicht an
  };
  q.add(r(1));
  await q.flush();
  assert.equal(q.pendingCount(), 1);
  api.addReading = real;
  const res = await q.flush();
  assert.deepEqual(res.sent, [{ id: 'id-00000001', saved: 'duplicate' }]);
});

test('abgelehnt: bleibt sichtbar mit Grund, blockiert die anderen nicht', async () => {
  const { q } = make();
  q.add(r(1, { value: -1 }));
  q.add(r(2));
  const res = await q.flush();
  assert.equal(res.rejected.length, 1);
  assert.equal(res.sent.length, 1);
  const [e] = q.entries();
  assert.equal(e.state, 'rejected');
  assert.equal(e.error, 'Ungültiger Zählerstand');
  q.dismiss(e.id);
  assert.equal(q.entries().length, 0);
});

test('Rückfrage: confirm sendet mit confirmed=true', async () => {
  const { q, saved } = make();
  q.add(r(1, { value: 23000 }));
  const res = await q.flush();
  assert.deepEqual(res.confirm, ['id-00000001']);
  assert.equal(q.entries()[0].state, 'confirm');
  q.confirm('id-00000001');
  const res2 = await q.flush();
  assert.equal(res2.sent.length, 1);
  assert.equal(saved.get('id-00000001').confirmed, true);
});

test('falscher oder fehlender Schlüssel: nichts wird verworfen', async () => {
  const { q, setKey } = make({ key: 'falsch' });
  q.add(r(1));
  const res = await q.flush();
  assert.equal(res.stoppedBy, 'auth');
  assert.equal(q.pendingCount(), 1);
  setKey('');
  assert.equal((await q.flush()).stoppedBy, 'nokey');
  setKey('k');
  assert.equal((await q.flush()).sent.length, 1);
});

test('gleichzeitige flush-Aufrufe teilen sich einen Lauf', async () => {
  const { q, api } = make();
  q.add(r(1));
  const [a, b] = await Promise.all([q.flush(), q.flush()]);
  assert.equal(a, b);
  assert.equal(api.calls, 1);
});

test('kaputter Speicherinhalt → leere Warteschlange statt Absturz', () => {
  const backend = memoryBackend();
  backend.setItem('gas.queue', '{kaputt');
  const q = createQueue({ storage: createStorage(backend), api: {}, getKey: () => 'k' });
  assert.deepEqual(q.entries(), []);
});

test('Speicher wirft (privater Modus) → keine Ausnahme', () => {
  const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
  const s = createStorage(throwing);
  assert.equal(s.get('x', 5), 5);
  assert.equal(s.set('x', 1), false);
  s.remove('x');
});

test('api: Antwortformate und Fehler', async () => {
  const mk = impl => createApi({ url: 'https://example.test/exec', fetchImpl: impl, timeoutMs: 50 });
  const ok = mk(async (url, opts) => {
    assert.equal(opts.method, 'POST');
    assert.equal(typeof opts.body, 'string', 'String-Body → text/plain, keine CORS-Vorabanfrage');
    assert.equal(opts.credentials, 'omit');
    assert.equal(opts.headers, undefined, 'keine eigenen Header');
    const body = JSON.parse(opts.body);
    assert.deepEqual(Object.keys(body).sort(), ['action', 'key', 'v']);
    return { json: async () => ({ ok: true, v: 1, data: { overview: { x: 1 } } }) };
  });
  assert.deepEqual(await ok.overview('k'), { overview: { x: 1 } });

  const err = mk(async () => ({ json: async () => ({ ok: false, v: 1, error: { code: 'AUTH', message: 'Falscher Schlüssel' } }) }));
  await assert.rejects(err.overview('k'), e => e instanceof ApiError && e.code === 'AUTH');

  const html = mk(async () => ({ json: async () => { throw new SyntaxError('Unexpected token <'); } }));
  await assert.rejects(html.overview('k'), e => e.code === 'BAD_RESPONSE');

  const down = mk(async () => { throw new TypeError('Load failed'); });
  await assert.rejects(down.overview('k'), e => e instanceof NetworkError);

  const slow = mk((url, opts) => new Promise((_, reject) => opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))));
  await assert.rejects(slow.overview('k'), e => e instanceof NetworkError && /Zeitüberschreitung/.test(e.message));

  const nourl = createApi({ url: '' });
  await assert.rejects(nourl.overview('k'), e => e.code === 'NO_URL');
});
