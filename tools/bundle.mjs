// Bündelt apps-script/src/*.gs zu einer Datei dist/Gaszaehler.gs (zum Einfügen im Apps-Script-Editor).
//   node tools/bundle.mjs          → schreibt dist/Gaszaehler.gs
//   node tools/bundle.mjs --check  → Fehler, wenn dist/ nicht aktuell ist (für CI)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ORDER = ['Util', 'Schema', 'Domain', 'Model', 'Calc', 'Forecast', 'Insights', 'Store', 'Weather', 'Overview', 'Api', 'Job', 'Setup'];

export function bundle() {
  const srcDir = path.join(root, 'apps-script', 'src');
  const found = fs.readdirSync(srcDir).filter(f => f.endsWith('.gs')).map(f => f.slice(0, -3)).sort();
  const missing = found.filter(f => !ORDER.includes(f));
  if (missing.length) throw new Error(`Nicht in ORDER eingetragen: ${missing.join(', ')}`);
  const parts = ORDER.map(name => {
    const code = fs.readFileSync(path.join(srcDir, `${name}.gs`), 'utf8').replace(/\s+$/, '');
    return `// ===== ${name}.gs =====\n\n${code}\n`;
  });
  return [
    '// Gaszähler – Backend (Google Apps Script)',
    '// GENERIERT aus apps-script/src/ mit `node tools/bundle.mjs` – nicht hier bearbeiten.',
    '// Einfügen: Erweiterungen → Apps Script → Datei „Code.gs“ komplett ersetzen.',
    '',
    parts.join('\n'),
  ].join('\n');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const out = path.join(root, 'dist', 'Gaszaehler.gs');
  const text = bundle();
  if (process.argv.includes('--check')) {
    const current = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
    if (current !== text) {
      console.error('dist/Gaszaehler.gs ist nicht aktuell – `node tools/bundle.mjs` ausführen und committen.');
      process.exit(1);
    }
    console.log('dist/Gaszaehler.gs ist aktuell.');
  } else {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, text);
    console.log(`geschrieben: ${path.relative(root, out)} (${text.length} Zeichen)`);
  }
}
