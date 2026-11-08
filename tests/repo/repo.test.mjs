// Prüfungen über das ganze Repo: Versionen konsistent, Bündel aktuell, keine Geheimnisse.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { bundle } from '../../tools/bundle.mjs';
import { APP_VERSION } from '../../docs/js/version.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

test('Service-Worker-Version = App-Version', () => {
  const m = /const VERSION = '([^']+)'/.exec(read('docs/sw.js'));
  assert.equal(m[1], APP_VERSION);
});

test('Service Worker speichert alle JS-Module und Icons vor', () => {
  const sw = read('docs/sw.js');
  for (const f of fs.readdirSync(path.join(root, 'docs/js'))) assert.ok(sw.includes(`'./js/${f}'`), `fehlt im SHELL: js/${f}`);
  for (const f of fs.readdirSync(path.join(root, 'docs/icons'))) assert.ok(sw.includes(`'./icons/${f}'`), `fehlt im SHELL: icons/${f}`);
});

test('Alle vorab gespeicherten Dateien des Service Workers existieren', () => {
  const list = /const SHELL = \[([\s\S]*?)\];/.exec(read('docs/sw.js'))[1];
  const files = [...list.matchAll(/'\.\/([^']*)'/g)].map(m => m[1]).filter(Boolean);
  assert.ok(files.length > 10);
  for (const f of files) assert.ok(fs.existsSync(path.join(root, 'docs', f)), `fehlt: docs/${f}`);
});

test('dist/Gaszaehler.gs ist aktuell (node tools/bundle.mjs)', () => {
  assert.equal(read('dist/Gaszaehler.gs'), bundle());
});

test('appsscript.json: Zeitzone, V8, minimale Berechtigungen, Web-App-Zugriff', () => {
  const m = JSON.parse(read('apps-script/appsscript.json'));
  assert.equal(m.timeZone, 'Europe/Berlin');
  assert.equal(m.runtimeVersion, 'V8');
  assert.deepEqual(m.oauthScopes, ['https://www.googleapis.com/auth/spreadsheets']);
  assert.deepEqual(m.webapp, { executeAs: 'USER_DEPLOYING', access: 'ANYONE_ANONYMOUS' });
});

test('CSP erlaubt nur eigene Skripte und Verbindungen zu Google Apps Script', () => {
  const html = read('docs/index.html');
  const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)[1];
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /script-src 'self'(;|$)/);
  assert.match(csp, /connect-src https:\/\/script\.google\.com https:\/\/script\.googleusercontent\.com(;|$)/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)/, 'keine Inline-Skripte');
  assert.doesNotMatch(html, /\sstyle=/, 'keine Inline-Styles');
});

test('Frontend nutzt kein innerHTML', () => {
  for (const f of fs.readdirSync(path.join(root, 'docs/js'))) assert.doesNotMatch(read(`docs/js/${f}`), /innerHTML|outerHTML|insertAdjacentHTML/, f);
});

test('Keine Geheimnisse im Repo (Sheet-URLs, Schlüssel)', () => {
  let files;
  try {
    files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
  } catch {
    return; // ohne git (z. B. entpacktes Archiv) überspringen
  }
  const bad = [];
  for (const f of files) {
    if (/\.(png|jpg|ico)$/.test(f) || !fs.existsSync(path.join(root, f))) continue;
    const text = read(f);
    if (/docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]{20,}/.test(text)) bad.push(`${f}: Sheet-URL`);
    if (/(^|[^0-9a-f])[0-9a-f]{32}([^0-9a-f]|$)/.test(text)) bad.push(`${f}: 32-stellige Hex-Zeichenkette (Schlüssel?)`);
  }
  assert.deepEqual(bad, []);
});
