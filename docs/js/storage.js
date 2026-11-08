// Lokaler Speicher mit Präfix „gas.“ (der Origin dyyp.github.io wird mit anderen Pages-Projekten geteilt).
// Jeder Zugriff ist abgesichert: In privaten Fenstern oder bei gesperrtem Speicher kann localStorage werfen.
const PREFIX = 'gas.';

function defaultBackend() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

export function createStorage(backend = defaultBackend()) {
  return {
    get(key, fallback = null) {
      try {
        const s = backend ? backend.getItem(PREFIX + key) : null;
        return s === null ? fallback : JSON.parse(s);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        if (!backend) return false;
        backend.setItem(PREFIX + key, JSON.stringify(value));
        return true;
      } catch {
        return false;
      }
    },
    remove(key) {
      try {
        if (backend) backend.removeItem(PREFIX + key);
      } catch {
        /* egal */
      }
    },
  };
}
