# Gaszähler

Gasverbrauch (Heizung) einer Mietwohnung in Mannheim erfassen und auswerten – am iPhone als Home-Bildschirm-App
und am PC im Browser. Kostenlos, kein eigener Server:

```
App (GitHub Pages, Ordner docs/)  ──POST──►  Google Apps Script (Web-App)  ──►  Google Sheet „GasWerte“
```

**Stand: V1 / Meilenstein M1** – Ablesungen erfassen (auch offline), Zeiträume und Hinweise anzeigen.
Wetter, Kosten, Modell, Prognose und Diagramme folgen in M2–M4. Plan und Entscheidungen: [KONZEPT.md](KONZEPT.md).

---

## Einrichtung (einmalig)

### 1. Skript ins Sheet

1. Sheet **GasWerte** öffnen → **Erweiterungen → Apps Script**.
2. Links **Projekteinstellungen** (Zahnrad) → Haken bei **„Manifestdatei ‚appsscript.json‘ im Editor anzeigen“**.
3. Zurück im **Editor**:
   - Datei `appsscript.json` öffnen, Inhalt komplett ersetzen durch [`apps-script/appsscript.json`](apps-script/appsscript.json).
   - Datei `Code.gs` öffnen, Inhalt komplett ersetzen durch [`dist/Gaszaehler.gs`](dist/Gaszaehler.gs).
   - Speichern (Strg+S).
4. Oben die Funktion **`setup`** auswählen → **Ausführen**.
   Google fragt nach Berechtigungen: **Berechtigungen prüfen** → dein Konto → bei „Google hat diese App nicht überprüft“
   auf **Erweitert → Zu „…“ wechseln** → **Zulassen**. (Normal bei eigenen Skripten; das Skript bekommt nur Zugriff auf
   Tabellen.)
5. Im **Ausführungsprotokoll** steht der **Schlüssel für die App** → in deinen Passwort-Manager kopieren.
   Später jederzeit im Sheet über **Gaszähler → Schlüssel anzeigen** (Sheet einmal neu laden, damit das Menü erscheint).

### 2. Als Web-App bereitstellen

1. **Bereitstellen → Neue Bereitstellung** → Zahnrad → **Web-App**.
2. Beschreibung z. B. „Gaszähler API“, **Ausführen als: Ich**, **Zugriff: Jeder** → **Bereitstellen**.
3. **Web-App-URL** kopieren (endet auf `/exec`). Sie ist kein Geheimnis – geschützt wird über den Schlüssel.
4. URL in [`docs/config.js`](docs/config.js) bei `API_URL` eintragen (auf GitHub: Datei öffnen → Stift → Commit).

> **Sheet-Freigabe bleibt „Eingeschränkt“.** Das Skript läuft mit deinen Rechten und braucht keine Freigabe.
> Nie die Sheet-URL oder den Schlüssel ins Repo schreiben (ein Test im CI schlägt sonst an).

### 3. GitHub Pages

Repo → **Settings → Pages** → Source **Deploy from a branch** → Branch **main**, Ordner **/docs** → **Save**.
Nach ein bis zwei Minuten läuft die App unter **https://dyyp.github.io/Gas/**.

### 4. Geräte

- **iPhone:** Seite in Safari öffnen → **Teilen → Zum Home-Bildschirm** → „Als Web-App öffnen“ an → **Hinzufügen**.
  App vom Home-Bildschirm starten und dort den Schlüssel eingeben (sie hat einen eigenen Speicher, getrennt von Safari).
- **PC:** Seite im Browser öffnen, Schlüssel eingeben. In Chrome/Edge optional „App installieren“.

### 5. Daten im Sheet

- **Ablesungen** nachtragen: direkt im Tab `Ablesungen` (Datum, Stand) oder über die App.
- **Einstellungen → Mindestdatum** auf das Einzugsdatum setzen.
- **Tarife, Umrechnung, Abschläge, Perioden** pflegen (werden ab M2 ausgewertet).
- Spalte **Modell = „ausschließen“**: Der Zeitraum, der mit dieser Ablesung endet, zählt für Verbrauch und Kosten,
  aber nicht fürs Modell (z. B. Aufheizen nach Einzug).

---

## Update des Skripts (bei neuen Versionen)

1. `Code.gs` komplett durch die neue [`dist/Gaszaehler.gs`](dist/Gaszaehler.gs) ersetzen; `appsscript.json` nur, wenn sie sich geändert hat. Speichern.
2. **`setup`** ausführen (ergänzt neue Tabs/Spalten, ändert keine Daten; bei neuen Berechtigungen fragt Google erneut).
3. **Bereitstellen → Bereitstellungen verwalten** → bestehende Bereitstellung → **Bearbeiten** (Stift) →
   **Version: Neue Version** → **Bereitstellen**. Die URL bleibt gleich.

> Nicht „Neue Bereitstellung“ wählen – das erzeugt eine **neue URL**, und die App spricht weiter mit der alten.

Die App selbst aktualisiert sich automatisch (GitHub Pages); bei offener App erscheint „Neue Version geladen“.

---

## Abnahme-Checkliste

- [ ] Sheet-Link im privaten Browserfenster → nur „Zugriff anfordern“
- [ ] App mit falschem Schlüssel → „Der Schlüssel ist falsch …“
- [ ] Ablesung am PC und am iPhone speichern → Zeile im Sheet, Uhrzeit stimmt
- [ ] Flugmodus: speichern → „Offline gespeichert“ → Flugmodus aus → App öffnen → genau **eine** neue Zeile
- [ ] Unplausibler Wert (z. B. Komma vergessen) → Rückfrage
- [ ] Einstellungen → „Verbindung testen“ → „Verbindung ok“
- [ ] Sheet → Gaszähler → Daten prüfen → keine unerwarteten Auffälligkeiten

---

## Sicherheit (Kurzfassung)

- Sheet nur für dich freigegeben; Skript im Sheet gebunden (nur du kannst den Code ändern).
- Berechtigung des Skripts: nur Tabellen (`spreadsheets`).
- Die API kann **nur lesen und Ablesungen anhängen** – nichts ändern oder löschen. Korrekturen nur im Sheet.
- Schlüssel: 122 Zufallsbit, im Anfrage-Body (nicht in der URL). Falsche Versuche landen im Tab `Protokoll`.
- Schlüssel kompromittiert? Sheet → **Gaszähler → Neuen Schlüssel erzeugen** → auf allen Geräten neu eingeben.
- Bitte Zwei-Faktor-Anmeldung bei Google **und** GitHub aktivieren.

---

## Entwicklung

Node ≥ 22, keine npm-Abhängigkeiten (Playwright nur für Browser-Tests/Icons).

```bash
node tools/bundle.mjs              # apps-script/src → dist/Gaszaehler.gs
node --test "tests/**/*.test.mjs"  # Unit-, Backend- (mit Apps-Script-Attrappe) und Repo-Tests
node --test tests/e2e/app.e2e.mjs  # Browser-Test mit simuliertem Server
node tools/serve.mjs 8080          # docs/ lokal unter http://127.0.0.1:8080/
node tools/render-icons.mjs        # Icons aus tools/assets/icon.svg
```

| Ordner | Inhalt |
|---|---|
| `docs/` | Web-App (wird von GitHub Pages ausgeliefert) |
| `apps-script/src/` | Backend-Quellen (Util, Schema, Domain, Store, Overview, Api, Setup) |
| `dist/` | gebündeltes Backend zum Einfügen (generiert, CI prüft Aktualität) |
| `tests/` | `unit/`, `backend/`, `repo/`, `e2e/`, `fakes/` |
| `tools/` | Bündeln, lokaler Server, Icons |
