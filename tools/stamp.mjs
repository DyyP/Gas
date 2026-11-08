// Setzt BUILD in docs/sw.js auf eine Prüfsumme aller App-Dateien (außer sw.js und config.js).
// Jede Änderung an der App ergibt so eine neue sw.js → Browser installieren die neue Version vollständig.
//   node tools/stamp.mjs          → schreibt docs/sw.js
//   node tools/stamp.mjs --check  → Fehler, wenn BUILD nicht passt (für CI)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const swPath = path.join(root, 'docs', 'sw.js');

export function buildHash() {
  const sw = fs.readFileSync(swPath, 'utf8');
  const list = /const SHELL = \[([\s\S]*?)\];/.exec(sw)[1];
  const files = [...list.matchAll(/'\.\/([^']+)'/g)].map(m => m[1]).filter(f => f !== 'config.js').sort();
  const h = crypto.createHash('sha256');
  for (const f of files) h.update(f).update('\0').update(fs.readFileSync(path.join(root, 'docs', f))).update('\0');
  // sw.js selbst ohne die BUILD-Zeile
  h.update(sw.replace(/const BUILD = '[^']*';/, ''));
  return h.digest('hex').slice(0, 12);
}

export function currentBuild() {
  return /const BUILD = '([^']*)';/.exec(fs.readFileSync(swPath, 'utf8'))[1];
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const want = buildHash();
  if (process.argv.includes('--check')) {
    if (currentBuild() !== want) {
      console.error('docs/sw.js: BUILD ist nicht aktuell – `node tools/stamp.mjs` ausführen und committen.');
      process.exit(1);
    }
    console.log('docs/sw.js: BUILD aktuell.');
  } else {
    fs.writeFileSync(swPath, fs.readFileSync(swPath, 'utf8').replace(/const BUILD = '[^']*';/, `const BUILD = '${want}';`));
    console.log('BUILD =', want);
  }
}
