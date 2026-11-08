# Gaszähler

Gasverbrauch (Heizung) einer Mietwohnung in Mannheim erfassen und auswerten – am iPhone als Home-Bildschirm-App
und am PC im Browser. Kostenlos, kein eigener Server:

```
App (GitHub Pages, Ordner docs/)  ──POST──►  Google Apps Script (Web-App)  ──►  Google Sheet „GasWerte“
```

**Stand: V1 / Meilenstein M4** – Ablesungen erfassen (auch offline), Tagesmitteltemperatur der DWD-Station Mannheim
(täglich automatisch, Historie ab 2020), Verbrauchsmodell mit Heizgrenze aus deinen Daten, Verbrauch modellgewichtet auf
Tage verteilt, kWh und Kosten taggenau, **Prognose bis Periodenende** (Nachzahlung/Guthaben mit 80-%-Bereich, als
Verlaufsdiagramm), **Abschlagsempfehlung**, Ampel zur Verlässlichkeit, Plausibilitätsprüfung mit dem Modell.
Dazu **Live-Zähler** (geschätzter Stand jetzt) und eine **Analyse-Seite**: Heizkurve, Monate gegen Normalwetter,
Kosten pro Tag mit Sparrechner, Heizkalender, Heizsaison-Fortschritt.
Plan und Entscheidungen: [KONZEPT.md](KONZEPT.md).

Wetterdaten: Quelle **Deutscher Wetterdienst** (DWD Opendata, CC BY 4.0).

---

## Einrichtung (einmalig)

### 1. Skript ins Sheet

1. Sheet **GasWerte** öffnen → **Erweiterungen → Apps Script**.
2. Links **Projekteinstellungen** (Zahnrad) → Haken bei **„Manifestdatei ‚appsscript.json‘ im Editor anzeigen“**.
3. Zurück im **Editor**:
   - Datei `appsscript.json` öffnen, Inhalt komplett ersetzen durch [`apps-script/appsscript.json`](apps-script/appsscript.json).
   - Datei `Code.gs` öffnen, Inhalt komplett ersetzen durch [`dist/Gaszaehler.gs`](dist/Gaszaehler.gs).
   - Speichern (Strg+S).
4. Oben die Funktion **`setup`** auswählen → **Ausführen**. (Ergebnis steht im Ausführungsprotokoll. Über das Menü
   im Sheet – **Gaszähler → Einrichten / aktualisieren** – kommt es stattdessen als Meldung.)
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

- **Ablesungen** nachtragen: direkt im Tab `Ablesungen` (Datum, Stand) oder über die App. Ein Stand pro Tag;
  derselbe Wert noch einmal gesendet wird ignoriert. (Eine Spalte „ID“ aus älteren Versionen wird nicht mehr
  gebraucht und kann gelöscht werden.)
- **Einstellungen → Mindestdatum** auf das Einzugsdatum setzen.
- **Tarife** (Arbeitspreis ct/kWh brutto, Grundpreis €/Monat brutto, je ab Datum), **Abschläge** (Betrag, Fälligkeitstag,
  ab Datum – eine neue Zeile je Änderung), **Perioden** (Abrechnungszeiträume), **Umrechnung** (Brennwert und Zustandszahl
  aus der Rechnung; bis dahin gelten die Platzhalter aus den Einstellungen).
- Die Tabs **Wetter, Tage, Monate, Protokoll** schreibt das Skript selbst (Bearbeiten nur mit Warnung).
- Spalte **Modell = „ausschließen“**: Der Zeitraum, der mit dieser Ablesung endet, zählt für Verbrauch und Kosten,
  aber nicht fürs Modell (z. B. Aufheizen nach Einzug).

---

## Update des Skripts (bei neuen Versionen)

1. `Code.gs` komplett durch die neue [`dist/Gaszaehler.gs`](dist/Gaszaehler.gs) ersetzen; `appsscript.json` ebenfalls,
   wenn sie sich geändert hat (seit M2 unverändert). Speichern.
2. **`setup`** ausführen (ergänzt neue Tabs/Spalten/Einstellungen, ändert keine Daten). Bei neuen Berechtigungen fragt
   Google erneut – M2 braucht zusätzlich **„Verbindung zu einem externen Dienst“** (DWD-Wetter) und **„Ausführung, wenn
   du nicht anwesend bist“** (täglicher Lauf). Beim ersten Mal lädt `setup` die Wetter-Historie (dauert ein paar Sekunden).
3. **Bereitstellen → Bereitstellungen verwalten** → bestehende Bereitstellung → **Bearbeiten** (Stift) →
   **Version: Neue Version** → **Bereitstellen**. Die URL bleibt gleich.

> Nicht „Neue Bereitstellung“ wählen – das erzeugt eine **neue URL**, und die App spricht weiter mit der alten.

Die App selbst aktualisiert sich automatisch (GitHub Pages); bei offener App erscheint „Neue Version geladen“.

---

## Täglicher Lauf

Jeden Tag zwischen 13 und 14 Uhr holt das Skript die neuen DWD-Werte (der DWD veröffentlicht vormittags) und rechnet
die Tabs `Tage` und `Monate` neu. Von Hand: Sheet → **Gaszähler → Wetter aktualisieren & neu berechnen**.
Fällt der DWD länger als drei Tage aus, schickt Google eine Fehler-Mail; Einzelheiten stehen im Tab `Protokoll`.
Fehlende Tage (z. B. heute) werden vorläufig fortgeschrieben bzw. interpoliert und automatisch ersetzt.

---

## Abnahme-Checkliste

- [ ] Sheet-Link im privaten Browserfenster → nur „Zugriff anfordern“
- [ ] App mit falschem Schlüssel → „Der Schlüssel ist falsch …“
- [ ] Ablesung am PC und am iPhone speichern → Zeile im Sheet, Uhrzeit stimmt
- [ ] Flugmodus: speichern → „Offline gespeichert“ → Flugmodus aus → App öffnen → genau **eine** neue Zeile
- [ ] Unplausibler Wert (z. B. Komma vergessen) → Rückfrage
- [ ] Einstellungen → „Verbindung testen“ → „Verbindung ok“
- [ ] Sheet → Gaszähler → Daten prüfen → keine unerwarteten Auffälligkeiten
- [ ] Tab `Wetter` gefüllt ab 01.01.2020 bis gestern, `Tage`/`Monate` gefüllt, Protokoll-Eintrag „täglich“
- [ ] Apps Script → **Trigger** (Wecker-Symbol): genau ein Trigger `taeglich`, täglich 13–14 Uhr
- [ ] App → Erfassen: Live-Zähler zählt weiter (alle 10 s), Vergleich mit dem echten Zähler passt im Rahmen von ±
- [ ] App → Prognose: Ampel, Abrechnungszeiträume mit Saldo/Prognose/Empfehlung und Diagramm
- [ ] App → Analyse: fünf Karten, Antippen zeigt Details, Tippen daneben schließt; Tabellen aufklappbar

---

## Sicherheit (Kurzfassung)

- Sheet nur für dich freigegeben; Skript im Sheet gebunden (nur du kannst den Code ändern).
- Berechtigungen des Skripts: Tabellen (`spreadsheets`), Abruf externer Daten (`script.external_request`, nur DWD),
  Trigger (`script.scriptapp`, täglicher Lauf).
- Die API kann **nur lesen und Ablesungen anhängen** – nichts ändern oder löschen. Korrekturen nur im Sheet.
- Schlüssel: 122 Zufallsbit, im Anfrage-Body (nicht in der URL), Vergleich in konstanter Zeit.
- Schlüssel kompromittiert? Sheet → **Gaszähler → Neuen Schlüssel erzeugen** → auf allen Geräten neu eingeben.
- Bitte Zwei-Faktor-Anmeldung bei Google **und** GitHub aktivieren.

---

## Entwicklung

Node ≥ 22, keine npm-Abhängigkeiten (Playwright nur für Browser-Tests/Icons).

```bash
node tools/bundle.mjs              # apps-script/src → dist/Gaszaehler.gs
node tools/stamp.mjs               # nach Änderungen in docs/: BUILD in sw.js setzen (CI prüft)
node --test "tests/**/*.test.mjs"  # Unit-, Backend- (mit Apps-Script-Attrappe) und Repo-Tests
node --test tests/e2e/app.e2e.mjs  # Browser-Test mit simuliertem Server
node tools/serve.mjs 8080          # docs/ lokal unter http://127.0.0.1:8080/
node tools/render-icons.mjs        # Icons aus tools/assets/icon.svg
```

| Ordner | Inhalt |
|---|---|
| `docs/` | Web-App (wird von GitHub Pages ausgeliefert) |
| `apps-script/src/` | Backend-Quellen (Util, Schema, Domain, Model, Calc, Forecast, Insights, Store, Weather, Overview, Api, Job, Setup) |
| `dist/` | gebündeltes Backend zum Einfügen (generiert, CI prüft Aktualität) |
| `tests/` | `unit/`, `backend/`, `repo/`, `e2e/`, `fakes/` |
| `tools/` | Bündeln, lokaler Server, Icons |

---

## Wie die Prognose rechnet (Kurzfassung)

- **Modell:** Verbrauch je Ablesezeitraum = a × Heizgradtage + b × Tage (gewichtet nach Länge, b ≥ 0). Die Heizgrenze
  (10–18 °C) wird aus deinen Ablesungen geschätzt (Einstellung `Heizgrenze_aus_Daten`). Zeilen mit
  Modell = „ausschließen“ zählen nicht.
- **Prognose:** 4.000 Durchläufe je Periode mit zufälligen Modellparametern, zufälliger Tagesstreuung, dem Wetter eines
  zufälligen Jahres seit 2020 für die Zukunft und ±3 % Unsicherheit der Umrechnung (bis die Rechnung da ist).
  Angezeigt werden der Median und der Bereich, in dem das Ergebnis mit 80 % Wahrscheinlichkeit liegt.
- **Abschlagsempfehlung:** Rate für die restlichen Monate, bei der der Median ausgeglichen wäre – „mit Puffer“ beim
  80-%-Wert (dann droht nur noch mit 20 % Wahrscheinlichkeit eine Nachzahlung).
- **Ampel:** grün ab ≥ 50 % einer normalen Heizsaison an Daten und ≤ 10 % Unsicherheit des Verbrauchs je Heizgradtag.
