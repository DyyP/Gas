# Gaszähler V1 – Konzept

Stand: 08.11.2026 · Status: **freigegeben**, M1–M4 umgesetzt.
Lebendes Dokument – Quelle der Wahrheit für Entscheidungen und für spätere Sessions.

---

## 0. Ziel und Umfang

Gasverbrauch (nur Heizung) einer Mietwohnung in Mannheim dauerhaft und wartungsarm erfassen und auswerten. Ablesen,
wann du willst, am iPhone 11 Pro (Home-Bildschirm-App) oder am Windows-PC eintragen, kurz danach die aktualisierte
Auswertung sehen. 0 €, kein eigener Server.

| Bereich | V1 enthält |
|---|---|
| Erfassung | online + offline (Warteschlange), Home-Bildschirm-App, PC-Browser, Plausibilitätsrückfrage |
| Stammdaten | Tarife, Umrechnung, Abschläge, Perioden, Einstellungen – direkt im Sheet, mit Prüfung und Hinweisen |
| Wetter | Tagesmitteltemperatur automatisch (DWD-Station Mannheim), Historie für Normalwerte, nächtliche Aktualisierung |
| Rechnung | Verbrauch je Tag (HGT-gewichtet), kWh, Kosten taggenau, Monatssummen |
| Statistik | Modell Verbrauch ~ HGT mit Unsicherheit, Heizgrenze aus Daten, Belastbarkeits-Ampel mit Klartext |
| Prognose | Kosten bis Periodenende, Nachzahlung/Guthaben P10/P50/P90, Abschlagsempfehlung |
| Dashboard | Prognosekarte, Monatsbalken, Modell-Diagramm, Intervalltabelle |
| Qualität | Tests, CI, Doku, Einrichtungs- und Update-Anleitung |

**Nicht in V1 (Daten werden gesammelt):** Witterungsbereinigung und Mehrjahresvergleich, Abgleich-Ansicht
Jahresabrechnung, 7-Tage-Vorhersage in der Prognose, ESP32-Sensor, Erinnerungen.

---

## 1. Entscheidungen

| Datum | Entscheidung | Begründung |
|---|---|---|
| 07.11. | Web-App (GitHub Pages) + Apps Script + Google Sheet | 0 €, Daten am PC sicht-/korrigierbar, Zeit-Trigger gratis |
| 08.11. | Kompletter Neustart, neues Repo + neues Sheet „GasWerte“ | alte Sheet-ID war öffentlich und das Sheet für „Jeder“ freigegeben |
| 08.11. | Meilensteine M1–M4 wie unten | M1 zuerst, damit sofort produktiv abgelesen wird |
| 08.11. | **Wetter: DWD-Station Mannheim (05906)**, Open-Meteo nur als Ersatz | Test mit deinen Ablesungen: DWD und ERA5 erklären den Verbrauch gleich gut (CV 44,5 % vs. 44,6 %, mittlere Abweichung −0,23 K); DWD ist 1 Tag aktuell statt ~6, ist Wunschquelle und stationsgenau |
| 08.11. | Modell neu rechnen statt inkrementell | ~15 Ablesungen, ~400 Tage → Neuberechnung dauert Millisekunden und ist nach Korrekturen im Sheet immer richtig. Teuer ist nur der Wetterabruf – der läuft inkrementell (nur neue Tage) |
| 08.11. | Kein Startwert aus Vertragsprognose nötig | ein volles Jahr eigener Daten liegt vor |
| 08.11. | Direkt auf `main` pushen | Wunsch Nutzer |
| 08.11. | Grundpreis in €/Monat erfassen | beide Versorger nennen ihn so |
| 08.11. | **Wetter ab 2020**, Normalwerte aus 2020 bis Vorjahr | Klimawandel: ältere Jahre verzerren das „Normal“ |
| 08.11. | **Nur DWD**, kein Open-Meteo | Wunsch Nutzer; Lücken (heute/gestern, Ausfälle) werden fortgeschrieben/interpoliert und automatisch ersetzt – eine Abhängigkeit und das 429-Risiko weniger |
| 08.11. | Grundpreis je Tag = Monatspreis × 12 / 365 (Einstellung „Grundpreis_Verteilung“) | Abrechnungsweise des Versorgers unbekannt; umschaltbar auf „Kalendermonat“ |
| 08.11. | Laufende Periode zeigt nur den Zwischenstand (neutral), kein „Guthaben“ | Abschläge werden im Voraus gezahlt – ein Guthaben nach 8 Tagen wäre irreführend |
| 08.11. | **Aufräumen nach Review:** ein schemagesteuerter Tab-Leser (`readRows_`), eine Paar-Funktion für Ablesezeiträume, keine Ablese-ID (Duplikat = gleicher Tag + Wert), kein Wetter-Cache und keine Fehlversuchs-Zählung (ohne messbaren Nutzen), `setup` aus dem Editor ohne Dialog | weniger Doppelungen, eine Stelle pro Regel; Backend −11 % Code |
| 08.11. | **M3:** Ampel nach Datenmenge (HGT-Abdeckung) und Unsicherheit von a; CV(RMSE) nur als Information | Ablesezeiträume sind unregelmäßig (2–75 Tage); ASHRAEs 15 % gilt für Monatswerte und wäre hier dauerhaft „gelb“, ohne etwas über die Prognosegüte zu sagen |
| 08.11. | **M3:** Heizgrenze aus Daten (ab 6 Zeiträumen, Raster 10–18 °C), Verteilung auf Tage mit dem Modell | deine Daten: 12,5 °C statt Norm 15 °C – bessere Anpassung, konsistente Tageswerte |
| 08.11. | **M3:** Plausibilität mit Modell: Rückfrage bei Abweichung > max(3 σ, 2 m³) | Test mit deinen 24 Zeiträumen: 0 Fehlalarme; fängt Tippfehler, die unter 20 m³/Tag bleiben |
| 08.11. | **M4:** vier Ansichten mit Symbolen: Erfassen (mit Live-Zähler) · Prognose · Analyse · Einstellungen; alte Adresse `#auswertung` führt zur Prognose | Prognose (Geld) und Analyse (Verhalten) sind verschiedene Fragen; Erfassen bleibt der Startpunkt |
| 08.11. | **M4:** nur dunkles Design; Farbe hat Bedeutung: Bernstein = Gas/Kosten, Blau = Kälte, Grau = Kontext, Koralle/Dunkelgrün = Nachzahlung/Guthaben, immer mit Wort + Pfeil | Wunsch Nutzer („mehr Farbe, Rot entsättigt, dunkleres Grün“); Koralle ↔ Grün auch bei Rot-Grün-Schwäche unterscheidbar (ΔE 10,9, dataviz-Validator) |
| 08.11. | **M4:** Analyse in der Reihenfolge Heizkurve · Monate gegen Normalwetter · Kosten pro Tag + Sparrechner · Heizkalender · Heizsaison; Tabellen aufklappbar darunter | Reihenfolge Nutzer (Ideen 5, 6, 9, 3, 2) |
| 08.11. | **M4:** Live-Zähler = Modell seit der letzten Ablesung (Server) + heutige Rate seit dem Datenstand (App, alle 10 s) | kein Server-Aufruf pro Sekunde; ± zeigt die Modellunsicherheit |
| 08.11. | **M4:** Heizsaison = 01.08.–31.07., Fortschritt nach **normalen Heizgradtagen**, nicht nach Kalendertagen | Am 08.11. sind 27 % der Kalendertage, aber nur 6 % des Heizbedarfs vorbei |
| 08.11. | **M4:** Sparrechner aus dem Modell (1 °C kühler ≈ Heizgrenze 1 K tiefer), Hinweis auf die 6-%-Faustregel | dein Modell ergibt ≈ 16 %, weil du erst unter 12,5 °C heizt (mittlere Differenz an Heiztagen ≈ 6 K statt ≈ 18 K) |
| 08.11. | **M4:** Tooltips per Antippen, Tippen daneben schließt; Tabellen bleiben als Datenzugang | iPhone kennt kein „Maus weg“; Diagramme sind nur mit Zeiger bedienbar |
| 08.11. | **M4 (Rückmeldung):** Monate je **Heizjahr Aug–Jul** mit Umschalter; im laufenden Heizjahr die kommenden Monate als „noch offen“ mit Normalwert (`season.months`); Prognose-Grundlage unter die Perioden | Wunsch Nutzer: Geld zuerst; Heizjahr passt zur Heizsaison |
| 08.11. | Sparrechner bleibt beim Modellwert (≈ 16 %/K) | Altbau-Dachgeschoss: Wärme von unten und Sonne heizen mit → Heizgrenze 12,5 °C → jedes Grad ist ein größerer Teil des Bedarfs |
| 08.11. | Live-Zähler übernimmt den Schätzwert **nicht** ins Eingabefeld | Wunsch Nutzer: echter Stand wird selbst eingetippt |
| 08.11. | **Fehler behoben:** Service Worker liefert die App-Hülle nur noch aus dem Cache *einer* Version (vorher „Netz zuerst, nach 3 s Cache“ je Datei → bei langsamem Netz Mischung aus alten und neuen Dateien → App startete nicht). Jede Änderung ergibt über `BUILD` (Prüfsumme, `tools/stamp.mjs`, CI prüft) eine neue sw.js; nach dem Update lädt die App einmal neu. `config.js` bleibt „Netz zuerst“. Notbremse `guard.js`: startet die App nicht binnen 8 s, holt der Service Worker die neueste Version vollständig und die Seite lädt einmal neu; klappt es dann nicht, zeigt sie den Fehlertext (Schlüssel/Warteschlange bleiben). Nicht abmelden – ohne Service Worker liefert der Browser-Cache (GitHub Pages: 10 min) wieder alte Dateien | Ausfall beim Nutzer nach dem M4-Update; Ursache im Test nachgestellt |
| 08.11. | **Fehler behoben:** `analyse.js` → `diagramme.js` | Werbeblocker (EasyPrivacy-Regel `/analyse.js`, z. B. uBlock Origin) sperrten die Datei → App startete in Firefox nicht; Repo-Test verbietet typische Tracker-Namen |
| 08.11. | **Backlog:** PDF-Export | Wunsch Nutzer „für später“ |
| 08.11. | Optimierungen: nach dem Speichern keine zweite Übersichtsanfrage, beim Speichern bereits gelesene Daten weiterverwenden, `getDataRange` | Kaltstarts von Apps Script kosten bis ~15 s pro Anfrage; Übersichts-Cache erst nach Messung |

---

## 2. Architektur

```
 iPhone (Home-Bildschirm-App) ─┐
                               ├─ HTTPS POST, text/plain-JSON ──►  Apps Script Web-App (/exec)  ──►  Google Sheet „GasWerte“
 PC-Browser ───────────────────┘   (Schlüssel im Body)              „Ausführen als: Ich“             (Freigabe: Eingeschränkt)
        ▲                                                                   ▲
        │ statische Dateien                                                 │ nachts (Zeit-Trigger, ab M2)
 GitHub Pages (/docs)                                               DWD Opendata (Ersatz: Open-Meteo)
```

- Sheet = einzige Wahrheit. Gerechnet wird im Apps Script; die App zeigt an.
- kWh ist die zentrale Einheit, Umrechnung m³ → kWh austauschbar (MVV will das Gasnetz bis 2035 stilllegen).

---

## 3. Sicherheitsmodell

**Schutzziel:** Nur du kannst Daten ändern oder löschen. Lesen durch Fremde wäre verkraftbar, wird aber verhindert.

| Tür | Schloss |
|---|---|
| Sheet | Freigabe „Eingeschränkt“. Sheet-ID/URL nie ins Repo (CI-Test). |
| Apps Script | An das Sheet gebunden → gleiche Zugriffsliste; nur Bearbeiter können den Code ändern. |
| Berechtigungen | `oauthScopes` explizit: M1 nur `spreadsheets`; ab M2 zusätzlich `script.external_request` (Wetter) und `script.scriptapp` (Trigger). `@OnlyCurrentDoc` geht nicht: In Web-Apps ist `getActiveSpreadsheet()` nicht verfügbar → `openById`. Menüs/`alert` brauchen keinen eigenen Scope (nur HTML-Dialoge bräuchten `script.container.ui`). |
| Web-App | „Ausführen als: Ich“, „Zugriff: Jeder“ (nötig für die App). Jede Anfrage braucht den Schlüssel (UUID v4 = 122 Zufallsbit), im Body, Vergleich in konstanter Zeit. |
| API-Fähigkeiten | Nur lesen und Ablesung anhängen. Kein Ändern/Löschen/Stammdaten. |
| Eingaben | Body ≤ 4 KB, strikte Typ-/Bereichsprüfung, Zählernummer mit engem Zeichensatz, Texte nie als Formel (`safeText_`). |
| App | CSP per `<meta>` (nur eigene Skripte/Styles, Verbindungen nur zu `script.google.com` + `script.googleusercontent.com`), kein `innerHTML`, `credentials: 'omit'`, `referrer: no-referrer`, localStorage-Präfix `gas.`. |
| Konten | Zwei-Faktor-Anmeldung bei Google und GitHub. |
| Notfall | Menü „Neuen Schlüssel erzeugen“. |

---

## 4. Datenmodell (Google Sheet „GasWerte“)

Alles in `Schema.gs` (Spalten, Formate, Typ, Pflicht, Wertebereich) – `setup()` legt daraus an, `readRows_()` liest und
prüft daraus. Spalten werden über die Überschrift gefunden; fehlende Pflichtwerte → Zeile mit Hinweis ignoriert,
ungültige optionale Werte → Hinweis, Feld leer. `setup()` ändert keine Daten und keine Formate vorhandener Spalten.
Sheet-Zeitzone Europe/Berlin, Gebietsschema de_DE.

**Ablesungen** – Datum · Uhrzeit (Text HH:MM, leer = 12:00) · Stand_m3 · Zähler · Quelle (App/Sheet/Übergabe/Rechnung) ·
Modell („ausschließen“) · Erfasst_am · Notiz
**Tarife** – Gültig_ab · Arbeitspreis_ct_kWh (brutto) · Grundpreis_EUR_Monat (brutto) · Anbieter · Tarif · Notiz
**Umrechnung** – Gültig_ab · Brennwert_kWh_m3 · Zustandszahl · Status (Schätzung/Rechnung) · Notiz
**Abschläge** – Gültig_ab · Betrag_EUR (0 = ausgesetzt) · Fälligkeitstag · Notiz
**Perioden** – Name · Start · Ende (inklusive) · Notiz
**Einstellungen** – Schlüssel · Wert · Beschreibung (M1: Mindestdatum, Zähler_aktuell, Plausi_max_m3_pro_Tag,
Platzhalter_Zustandszahl 0,96, Platzhalter_Brennwert_kWh_m3 11,3; weitere ab M2)
**Protokoll** (System, Warnschutz) – Zeit · Ebene · Ereignis · Details (rollierend ~600 Zeilen)
**Ab M2:** Wetter, Tage, Monate, _Cache (System-Tabs)

---

## 5. Konventionen

- Zeitzone Europe/Berlin überall; Tagesrechnung über UTC-Tagesnummern (sommerzeitfest; Tage zählen 24 h).
- Ablesezeitpunkt = Datum + Uhrzeit; App speichert die Uhrzeit, wenn das Datum „heute“ ist; sonst 12:00.
  Intervalle sind gebrochene Tage.
- Ein Stand pro Tag und Zähler. Gleicher Tag + gleicher Wert → still ignoriert (sicher wiederholbar), anderer Wert → Konflikt.
- Zählertausch: Zählernummer in allen Zeilen pflegen; Intervalle nie über Zähler hinweg.
- Preise brutto; gerundet wird nur in der Anzeige.
- Bekannte künftige Preise mit künftigem Gültig_ab eintragen; sonst gilt der letzte Tarif bis Periodenende.

---

## 6. Rechenkern

### 6.1 Wetter und Heizgradtage (M2)

- **Quelle DWD** (CC BY 4.0, „Quelle: Deutscher Wetterdienst“), Station **05906 Mannheim** (98 m, 49,5063/8,5584),
  Reihe seit 1781, aktiv. Tagesmittel `TMK` aus `produkt_klima_tag_*.txt`:
  - laufend: `…/climate/daily/kl/recent/tageswerte_KL_05906_akt.zip` (fester Name, ~45 KB, letzte ~550 Tage, 1 Tag Verzug)
  - Historie einmalig: `…/historical/tageswerte_KL_05906_<von>_<bis>_hist.zip` (Name ändert sich jährlich → aus dem
    Verzeichnis lesen), Apps Script entpackt mit `Utilities.unzip`, Text ISO-8859-1, `-999` = fehlt.
  - Definition: seit 01.04.2001 Mittel aus mind. 21 Stundenwerten; davor (T7 + T14 + 2·T21)/4 („Mannheimer Stunden“).
    → **Klimajahre ab 2001** (einheitliche Definition).
- **Lücken:** innerhalb ≤ 10 Tage linear interpoliert, am Ende (heute/gestern) ≤ 5 Tage fortgeschrieben; markiert
  („interpoliert“/„fortgeschrieben“ in `Tage`) und beim nächsten Lauf durch DWD-Werte ersetzt. Ohne Temperatur →
  Verbrauch des Intervalls gleichmäßig verteilt (Hinweis).
- **Täglicher Lauf** 13–14 Uhr (DWD veröffentlicht vormittags UTC); Fehler-Mail nur, wenn Wetter > 3 Tage alt.
- **Erste Auswertung (echte Daten, Platzhalter-Umrechnung):** Octopus 01.11.2025–31.10.2026: 429,4 m³ ≈ 4.658 kWh,
  Kosten 638,76 € (Arbeit 464,88 + Grund 173,88), Abschläge 12 × 66,09 = 793,08 € → **Guthaben ≈ 154 €** (±14 € je
  nach echtem Brennwert). Januar 2026 war deutlich kälter als das Mittel 2020–2025 (420 vs. 352 HGT).
- Modell-HGT: HGT_d = max(0, θ_H − Tm_d). Gradtagzahl VDI 3807 (Anzeige): G_d = 20 − Tm_d für Tm_d < 15 °C.
- Robustheit: `muteHttpExceptions`, Retry mit Backoff, Fehler → Protokoll, bestehende Daten bleiben.

### 6.2 Ablesungen → Intervalle → Tage (M1: Intervalle; M2: Tage)

Intervalle je Zähler zwischen aufeinanderfolgenden Ständen (gebrochene Tage). Verteilung auf Tage:
w_d = f_d · (b + a · HGT_d), ohne Modell f_d · HGT_d, Σ HGT = 0 → gleichmäßig. Summe exakt = ΔV.

### 6.3 Energie und Kosten (M2)

kWh_d = m³_d × Zustandszahl(d) × Brennwert(d) (DVGW G 685). Kosten_d = kWh_d × AP(d)/100 + GP_Monat(d) × 12/365
(Annahme, bis bekannt ist, wie der Versorger rechnet).

### 6.4 Modell (M3)

- y_i = a · H_i + b · D_i + ε_i, Var(ε_i) = σ² · D_i → gewichtete Regression (Gewicht 1/D_i), geschlossene Form;
  Unsicherheit über Normal-Inverse-Gamma (für die Monte-Carlo-Ziehung).
- **b ≥ 0** (nur Heizung → b nahe 0; ein negatives b ist physikalisch unmöglich).
- **Heizgrenze θ_H aus den Daten** (Raster 10–18 °C, Minimum der gewichteten Fehlerquadrate), Ausweichwert 15 °C.
- Intervalle mit Modell = „ausschließen“ zählen nicht.
- Kennzahlen: a, b mit Intervallen, σ, n, HGT-Abdeckung, CV(RMSE), NMBE (Referenz ASHRAE Guideline 14: monatlich CV ≤ 15 %).

**Erste Analyse deiner Daten (08.11.2026, DWD, Ablesungen 01.11.2025–31.10.2026):**

| Variante | a (m³/HGT) | CV(RMSE) |
|---|---|---|
| alle Intervalle, θ_H 15 °C | 0,272 | 44 % |
| ohne Einzugsintervall 01.–03.11.2025 (7 m³/Tag), θ_H 15 °C | 0,269 | 27 % |
| ohne Einzugsintervall, θ_H 13 °C | – | 23 % |

→ Ausreißer-Ausschluss und Heizgrenzen-Schätzung bringen viel; beides ist in M3 umgesetzt.

**Ergebnis M3 mit deinen eigenen Ablesungen (26.10.2025–08.11.2026, DWD, Platzhalter-Umrechnung):** Heizgrenze 12,5 °C,
a = 0,355 m³ ≈ 3,9 kWh je Heizgradtag, keine Grundlast, 24 Zeiträume, > 1 Heizsaison, Unsicherheit a ±4 % → grün.
Octopus 2025/26: Guthaben ≈ 155 € (80 %: 137–173 €). MVV 2026/27 bei 30 € Abschlag: Nachzahlung ≈ 431 €
(80 %: 349–573 €) → Empfehlung 70 €/Monat (mit Puffer 77 €). Hauptunsicherheit: Wetter.

### 6.5 Prognose bis Periodenende (M3, umgesetzt in `Forecast.gs`)

Monte Carlo (N = 4000, Seed aus Periodenname + Datum → am selben Tag reproduzierbar; weil der Verbrauch linear in a, b ist,
werden Tagessummen je Wetterjahr vorab gebildet – ein Lauf kostet O(1)): Parameter aus der Unsicherheit ziehen; Vergangenheit gemessen; nicht abgelesene
Tage mit echtem Wetter; Zukunft mit Wetter eines zufälligen Klimajahres (ganzer Verlauf); Umrechnungsfaktor ±3 %
solange Schätzung, auf **alle** kWh der Periode; Kosten mit Tarifen; Saldo = Kosten − Abschläge.
Ergebnis P10/P50/P90, Monatsbänder, Abschlagsempfehlung, größte Unsicherheitsquelle.

### 6.6 Belastbarkeit (M3)

Rot: < 3 Intervalle oder < 10 % HGT-Abdeckung · Gelb: < 40 % Abdeckung oder rel. Unsicherheit a > 10 % oder
CV > 15 % · Grün: sonst. Dazu ein Satz in Klartext.

### 6.7 Analyse (M4, umgesetzt in `Insights.gs` + `docs/js/diagramme.js`)

- **Live-Zähler:** Erwartung und σ für den Zeitraum letzte Ablesung → jetzt (wie ein Ablesezeitraum), dazu m³, kWh
  und € pro Tag bei der heutigen Temperatur (Arbeitspreis + Grundpreis je Tag).
- **Heizkurve:** je Ablesezeitraum mittlere Temperatur (`intervals[].tmean`) gegen kWh/Tag; Linie = Modell
  b + a · max(0, θ − t). Punkte im Übergang liegen etwas über der Linie (Mittel über warme und kalte Tage).
- **Monate gegen Normalwetter (je Heizjahr):** `months[].kWhNormal` = Σ (b + a · Normal-HGT) × Faktor; kommende Monate aus `season.months`. Im Tooltip zusätzlich
  „bei diesem Wetter erwartet“ = kWhNormal + a_kWh · (HGT − Normal-HGT) → trennt Wetter von Verhalten.
- **Kosten pro Tag:** Kurve über −10…20 °C zum aktuellen Tarif. **Sparrechner:** Normal-HGT(θ) − Normal-HGT(θ − 1).
- **Heizkalender:** die letzten 366 Tage, Wert = kWh des Tages (Teil-Tage hochgerechnet), Glut-Skala mit Wurzel,
  Obergrenze = 95-%-Quantil. Einzelne Tage sind modellverteilt, nicht gemessen (steht unter der Karte).
- **Heizsaison:** Anteil der normalen HGT seit 01.08., Skala Okt/Jan/Apr an den Monatsersten (`season.marks`).

### 6.8 Plausibilität (M1 umgesetzt)

Hart (Server lehnt ab): ungültig, Zukunft, vor Mindestdatum, negativ, nicht monoton (auch beim Nachtragen),
anderer Wert am selben Tag. Weich (Rückfrage, dann `confirmed`): > Plausi_max_m3_pro_Tag (Vorgabe 20) gegenüber
einem Nachbarn. Ab M3: 99-%-Vorhersagebereich des Modells.

---

## 7. Backend (Apps Script)

Quellen in `apps-script/src/` (Util, Schema, Domain = rein; Store, Overview, Api, Setup = mit Diensten), gebündelt
nach `dist/Gaszaehler.gs` (eine Datei zum Einfügen; CI prüft Aktualität). Oberste Ebene nur Funktionen/Literale.

**API v1** – immer POST, Body `text/plain` JSON `{ v: 1, key, action, … }`:
- `overview` → `{ ok, v, data: { overview } }`
- `addReading` (`reading: { date, time, value, confirmed? }`; Zähler aus den Einstellungen) → `{ ok, v, data: { saved: 'new'|'duplicate', overview } }`
- Fehler `{ ok: false, v, error: { code, message, details? } }`, Codes: BAD_REQUEST, NOT_CONFIGURED, AUTH,
  VALIDATION, CONFLICT, PLAUSIBILITY, BUSY, SERVER. Die App entscheidet nach `code`.
- GET → nur Lebenszeichen.

Schreiben unter `LockService` (tryLock 20 s → BUSY), `SpreadsheetApp.flush()` vor Freigabe.
Menü im Sheet: Daten prüfen · Schlüssel anzeigen · Einrichten/aktualisieren · Neuen Schlüssel erzeugen.
Täglicher Trigger (atHour → zufällige Minute in der Stunde). Kein Ergebnis-Cache: erst einführen, wenn die
Ausführungsdauer (Apps Script → Ausführungen) es nötig macht.

Quoten (Privatkonto): 6 min/Ausführung, 90 min Trigger/Tag, 20.000 UrlFetch/Tag, 50.000 Properties-Zugriffe/Tag,
30 gleichzeitige Ausführungen.

---

## 8. Frontend (`docs/`)

Ansichten Erfassen · Prognose · Analyse · Einstellungen (Hash-Routing, Leiste unten mit Symbolen). ES-Module: `api`,
`queue`, `plausi`, `format`, `storage`, `render`, `charts` (SVG-Helfer, Prognose-Diagramm, Tooltip), `diagramme`
(fünf Analyse-Karten), `main`. Diagramme als SVG ohne Bibliothek; Farben über CSS-Klassen, nur die Glut-Skala als
berechnete Farbe (CSP erlaubt keine Inline-Styles). Offline-Warteschlange (zuerst lokal speichern, dann senden; Zustände wartet/Rückfrage/
abgelehnt; Auslöser Start, `online`, Sichtbarwerden, Knopf; Timeout 45 s wegen Kaltstarts). Service Worker:
alle Dateien einer Version gemeinsam vorab gespeichert und nur aus diesem Cache ausgeliefert (nie gemischt),
`config.js` Netz zuerst, API unberührt, `updateViaCache: 'none'`, Update-Prüfung beim Öffnen und Sichtbarwerden,
danach einmal neu laden. `BUILD` = Prüfsumme der Dateien (`node tools/stamp.mjs`). Notbremse `guard.js`. Datum springt über
Mitternacht mit, solange du es nicht selbst änderst.

---

## 9. Tests

`node --test "tests/**/*.test.mjs"`: Unit (Format, Plausibilität, Warteschlange, API-Client), Backend mit
Apps-Script-Attrappe (`tests/fakes/gas.mjs`: Setup, Schlüssel, Validierung, Duplikate, Nachtragen, Sortierung,
Plausibilität, Sperre, Intervalle, Zählertausch, Umrechnung), Repo (Versionen, Bündel, CSP, keine Geheimnisse).
`node --test tests/e2e/app.e2e.mjs`: Chromium in iPhone-Größe mit simuliertem Server (Ersteinrichtung, online,
offline + genau einmal senden, Rückfrage, Ablehnung, Live-Zähler, alle Analyse-Karten mit Tooltip per Tippen,
Service-Worker-Offlinestart). Backend M4 (`m4.test.mjs`): Schätzung seit letzter Ablesung, Kalender, Sparrechner,
Saison-Skala gegen ein Wetter mit bekannter Lösung. CI: beides bei jedem Push.

Grenze der Tests: Die Attrappe bildet Apps Script nach – echtes Verhalten prüft die Abnahme-Checkliste (README).

---

## 10. Meilensteine

| | Inhalt | Status |
|---|---|---|
| **M1 Fundament** | Repo, CI, Schema/Setup, API, App (Erfassen, Warteschlange, Service Worker), Sicherheit | ✅ umgesetzt, Abnahme durch dich offen |
| **M2 Wetter & Kosten** | DWD (Historie ab 2020 + täglich), Tage/Monate, Kosten taggenau, Abschläge, Saldo je Periode, Hinweise | ✅ umgesetzt |
| **M3 Modell & Prognose** | Modell mit Heizgrenze, Monte Carlo, Ampel, Abschlagsempfehlung, Plausibilität mit Modell | ✅ umgesetzt |
| **M4 Dashboard** | Farben, Navigation mit Symbolen, Prognose-Diagramm, Live-Zähler, Analyse (Heizkurve, Monate gegen Normalwetter, Kosten pro Tag + Sparrechner, Heizkalender, Heizsaison), Tooltips | ✅ umgesetzt |
| **Backlog** | PDF-Export (Jahresbericht) | später |

---

## 11. Risiken

| Punkt | Umgang |
|---|---|
| Attrappe ≠ echtes Apps Script | Abnahme-Checkliste, konservative API-Nutzung |
| DWD-Station fällt aus / wird verlegt | Open-Meteo als Ersatz, Lücken markiert |
| 429 bei Open-Meteo (geteilte Google-IPs) | nur Ersatzquelle, Retry/Backoff |
| Kaltstart der Web-App bis ~15 s | Warteschlange, Timeout 45 s, Statusanzeige |
| iOS räumt Speicher ungenutzter Web-Apps | Warteschlange sichtbar, Sheet ist Wahrheit |
| Google ändert Web-App-Regeln | API versioniert, Architektur austauschbar |

---

## 12. Quellen (Recherche 07./08.11.2026)

Apps Script: [Quotas](https://developers.google.com/apps-script/guides/services/quotas) ·
[Gebundene Skripte](https://developers.google.com/apps-script/guides/bound) ·
[Web Apps](https://developers.google.com/apps-script/guides/web) ·
[Content Service/Redirect](https://developers.google.com/apps-script/guides/content) ·
[Deployments](https://developers.google.com/apps-script/concepts/deployments) ·
[Manifest webapp](https://developers.google.com/apps-script/manifest/web-app-api-executable) ·
[Scopes](https://developers.google.com/apps-script/concepts/scopes) ·
[Ui](https://developers.google.com/apps-script/reference/base/ui) ·
[Simple Triggers](https://developers.google.com/apps-script/guides/triggers) ·
[Lock](https://developers.google.com/apps-script/reference/lock/lock) ·
[Cache](https://developers.google.com/apps-script/reference/cache/cache) ·
[Utilities.getUuid](https://developers.google.com/apps-script/reference/utilities/utilities) ·
[V8-Migration](https://developers.google.com/apps-script/guides/v8-runtime/migration)
DWD: [CDC daily/kl](https://opendata.dwd.de/climate_environment/CDC/observations_germany/climate/daily/kl/) ·
[Nutzungsbedingungen](https://opendata.dwd.de/climate_environment/CDC/Nutzungsbedingungen_German.txt) ·
[VDI-3807-Gradtage](https://opendata.dwd.de/climate_environment/CDC/derived_germany/techn/daily/heating_degreedays/hdd_3807/recent/)
Open-Meteo: [Terms](https://open-meteo.com/en/terms) · [Historical API](https://open-meteo.com/en/docs/historical-weather-api) · [Forecast API](https://open-meteo.com/en/docs)
iOS/WebKit: [iOS 26 Web-Apps (heise)](https://heise.de/-10749652) · [iOS 27 Geräte](https://www.macrumors.com/2026/06/08/ios-27-supports-iphone-11-newer/) ·
[Storage Policy](https://webkit.org/blog/14403/updates-to-storage-policy/) · [Background Sync fehlt](https://bugs.webkit.org/show_bug.cgi?id=201866)
GitHub Pages: [Quelle /docs](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site) ·
[Limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)
Gasabrechnung: [MVV Netze Merkblatt](https://www.mvv-netze.de/fileadmin/user_upload_mvv-netze/Dokumente/energie_beziehen/netzentgelte/gas/Gasverbrauch.pdf)
CSP: [MDN connect-src](https://developer.mozilla.org/docs/Web/HTTP/Headers/Content-Security-Policy/connect-src)
Sparrechner-Faustregel 6 %/K: [Utopia (Herleitung ≈ 1/18)](https://utopia.de/ratgeber/raumtemperatur-senken-so-viel-energie-sparst-du-pro-grad_734434) ·
[Vattenfall](https://www.vattenfall.de/infowelt-energie/energie-sparen/energiespartipps-heizen)
