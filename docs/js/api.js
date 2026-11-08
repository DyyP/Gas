// Verbindung zum Apps-Script-Backend.
// Immer POST mit einem String-Body: Der Browser sendet ihn als text/plain, damit entfällt die
// CORS-Vorabanfrage (OPTIONS), die Apps Script nicht beantworten kann. Keine Cookies (credentials: omit).
import { API_VERSION } from './version.js';

export class ApiError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
  }
}

/** Server nicht erreichbar (kein Netz, Zeitüberschreitung, CORS) – Wiederholen ist sicher. */
export class NetworkError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NetworkError';
    this.code = 'NETWORK';
  }
}

/** Fehler, bei denen ein späterer neuer Versuch sinnvoll ist. */
export const isRetryable = err => err instanceof NetworkError || ['BUSY', 'SERVER', 'BAD_RESPONSE'].includes(err && err.code);

export function createApi({ url, fetchImpl = (...a) => globalThis.fetch(...a), timeoutMs = 45000 }) {
  async function call(action, payload, key) {
    if (!url) throw new ApiError('NO_URL', 'Die API-URL ist noch nicht eingetragen (docs/config.js).');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let res;
      try {
        res = await fetchImpl(url, {
          method: 'POST',
          body: JSON.stringify({ v: API_VERSION, key, action, ...payload }),
          redirect: 'follow',
          credentials: 'omit',
          cache: 'no-store',
          signal: controller.signal,
        });
      } catch (e) {
        throw new NetworkError(e && e.name === 'AbortError' ? 'Zeitüberschreitung – Server antwortet nicht' : 'Server nicht erreichbar');
      }
      let data;
      try {
        data = await res.json();
      } catch (e) {
        if (e && e.name === 'AbortError') throw new NetworkError('Zeitüberschreitung – Server antwortet nicht');
        throw new ApiError('BAD_RESPONSE', 'Antwort ist kein JSON – stimmen API-URL und Zugriff „Jeder“?');
      }
      if (!data || data.ok !== true) {
        const e = (data && data.error) || {};
        throw new ApiError(e.code || 'SERVER', e.message || 'Unbekannter Serverfehler', e.details);
      }
      return data.data;
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    overview: key => call('overview', {}, key),
    addReading: (reading, key) => call('addReading', { reading }, key),
  };
}
