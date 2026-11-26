# Inspirations: what was taken from open-source projects (read 21 Nov 2026, in German)

Gelesen wurden flache Klone (nur lesen, nichts ausgeführt). Alle vier Repos stehen unter MIT-Lizenz, Ideen und kleine Muster dürfen übernommen werden, Code nur mit Herkunftsangabe.

## hexwright (vonkernel/hexwright, TypeScript, MIT, 53 Dateien)

Das nächste Vorbild für Ports und Adapter.

- **Austauschbares Profil (YAML):** Schichten werden per Pfadfragment erkannt (`/adapter/`, `/application/port/out/`), Komponenten per Regelliste ("erste passende Regel gewinnt", Namensendungen als Ausnahme vor der Schicht). Ein anderes Projekt tauscht nur die Datei. **Übernehmen:** eigenes Profil als JSON mit automatischer Voreinstellung, damit es ohne Konfiguration schon brauchbar ist.
- **Ringe von innen nach außen:** Entity, Service, UseCase, Port, DTO/VO, Adapter. Sättigung dunkel im Kern, heller nach außen; Formen trennen, was die Sättigung nicht trennt. **Übernehmen:** feste Rangfolge der Rollen und eigene Form je Rolle.
- **Fachbereich = Farbton:** Name wird per Hash zu einer Farbe (goldener Winkel, damit Nachbarn verschieden sind). Rot, Orange und Rosa sind für Status reserviert (Verstoß, neu), damit Rot immer „Regelverstoß“ bedeutet. **Übernehmen:** unbedingt.
- **Deterministisches Layout:** Gleicher Graph, gleiche Position. Nur so sind zwei Stände vergleichbar. **Übernehmen.**
- **Delta-Sicht:** Zeigt nur, was ein Branch geändert hat, plus „Impact“-Sicht. Später sinnvoll, nicht für Version 1.
- **Text kürzen:** SVG kann Text nicht messen, deshalb Schätzfunktion mit Auslassung. **Übernehmen.**
- **Grenzen:** Nur Kotlin, 2D-SVG mit festen Layouts, 0 Sterne. Es zeigt keine Querschnittsdienste und keine Erklärungen für Laien.

## dependency-cruiser (sverweij, JavaScript, MIT, ~1.800 Dateien)

Die ausgereifteste Auflösung von Importen.

- **Auflösung:** relative Pfade, Indexdateien, Endungen, `tsconfig`-Pfadaliase, Typ-only-Importe getrennt, Node-Kernmodule und externe Pakete getrennt klassifiziert. **Übernehmen:** dieselben Fälle in einer abgespeckten Version, ohne Abhängigkeiten.
- **Regelmodell:** `forbidden` / `allowed` mit `from` und `to`, dazu Bedingungen wie `circular`, `orphan`, `numberOfDependentsMoreThan`. **Übernehmen:** `numberOfDependentsMoreThan` als Idee, Querschnittsbausteine automatisch zu erkennen (viele verschiedene Aufrufer).
- **Grenzen:** Ausgabe nur Graph (dot, mermaid, html), kein Rollenmodell, JS/TS.

## dep-tree (gabotechs, Go, MIT, ~400 Dateien)

- **Sprachen über Parser je Sprache:** JS/TS, Python, Rust, Go, mit Importen und Exporten. **Übernehmen:** Analysator je Sprache mit gemeinsamem Ergebnisformat.
- **Konfiguration:** `exclude`, `only`, `entrypoints`, `allowCircularDependencies`, `unwrapExports` (Re-Exports bis zur Zieldatei auflösen). **Übernehmen:** `exclude`, `entrypoints` und das Auflösen von Re-Export-Dateien, denn `index.ts` verfälscht sonst die Abhängigkeiten.
- **Grenzen:** 3D-Force-Graph, kein Architekturmodell.

## wirehouse (creyes-git/wirehouse, Python, MIT, 173 Dateien)

- **Eine einzige Offline-HTML-Datei** als Ausgabe: Daten, Skript und Schrift stecken drin. **Übernehmen:** genau so, dann lässt sich das Ergebnis überall öffnen und teilen.
- **Beleg für jede Verbindung** mit Datei und Zeile. **Übernehmen:** jede Kante speichert Beispiele (Datei:Zeile).
- **Schwärzung** (`redact.py`) vor dem Export. **Übernehmen:** keine Quelltexte und keine Secrets in die Ausgabe, nur Pfade, Namen und Zahlen.
- **Geführte Touren** und Mermaid-Export. Später.
- **Grenzen:** 3D mit three.js (bei uns bewusst nicht), feste Web-Schichten.

## Entscheidungen für codemap

1. 2D, SVG, eine Offline-HTML-Datei, keine Laufzeit-Abhängigkeiten (Node ab 18).
2. Rollenmodell mit automatischer Voreinstellung nach Ordnernamen und optionaler `codemap.config.json` je Repo.
3. Rollen und Platz im Bild: Eingänge links (treibend), Fachmodule in der Mitte, Ausgänge rechts (getrieben), Ports als Rand der Mitte, Orchestrierung oben, Querschnitt (Fehlerbehandlung, Logging) als durchgehendes Band, Start und Verdrahtung unten.
4. Querschnittsbausteine werden automatisch erkannt (viele verschiedene Aufrufer, typische Namen) und gebündelt gezeichnet, nicht als hundert Linien.
5. Verstöße gegen die Abhängigkeitsrichtung sind rot und nur rot.
6. Beschreibung für Laien: je Baustein ein deutscher Satz aus Rolle, Aufgabe (erster Kommentar oder README) und Nachbarn.
