# codemap: Code als erklärende 2D-Karte

Zeichnet ein Repository, einen Ordner oder ein eingefügtes Stück Code so, wie man es einem Laien an der Tafel erklären würde: die Fachmodule, die **Ports** (Verträge), die **Adapter** zur Außenwelt, die Eingänge und das, was quer durch alles läuft, etwa Fehlerbehandlung und Logging.

Das Ergebnis ist **eine** HTML-Datei ohne Server, ohne Upload und ohne Abhängigkeiten (Node ab 18). Quelltext kommt nicht hinein, nur Pfade, Namen, Zeilenzahlen, Verweise mit Datei und Zeile und ein kurzer Kommentarauszug. Die Oberfläche ist auf Deutsch; die englische README steht in [README.md](README.md).

## Benutzung

```bash
git clone https://github.com/sebastianpforr/codemap.git
cd codemap
node bin/codemap.mjs /pfad/zum/repo --name MeinProjekt            # schreibt codemap-MeinProjekt.html
node bin/codemap.mjs src/modul.ts                                 # eine einzelne Datei als Schnipsel
cat schnipsel.py | node bin/codemap.mjs --stdin --lang py         # Text von der Standardeingabe
node bin/codemap.mjs repo --json modell.json --fragment           # Modell als JSON, HTML nur als Seiteninhalt
node --test test/                                                 # Tests
```

Die HTML-Datei öffnest du in jedem Browser, offline, und kannst sie verschicken.

## Welche Sprachen funktionieren

Die Erkennung beruht auf **Konventionen und Mustern, nicht auf einem vollständigen Parser**.

| Sprache | Endungen | Verweise zwischen Dateien | Symbole |
| --- | --- | --- | --- |
| TypeScript / JavaScript | `.ts .tsx .mts .cts .js .jsx .mjs .cjs` | am besten: relative Pfade, Indexdateien, `tsconfig`-Pfade, Monorepo-Pakete, Re-Exports, Typ-Importe | am besten: Funktionen, Klassen, Interfaces, Typen, Zod-Schemas, Mitglieder |
| Python | `.py` | gut: relative, absolute und Namensraum-Pakete | gut: Klassen, Funktionen |
| Java, Kotlin, Scala | `.java .kt .kts .scala` | gut über `package` und `import`; Platzhalterimport zeigt nur auf eine Datei des Pakets | Klassen, Interfaces, Traits (allgemeine Muster) |
| Go | `.go` | gut: Modulpfad aus `go.mod`, Import zeigt auf das Paketverzeichnis (erste Datei) | Typen, Interfaces, Funktionen (allgemeine Muster) |
| Rust | `.rs` | gut: `mod`, `use crate::…`, `super`, `self` | Traits, Structs, Enums (allgemeine Muster) |
| PHP | `.php` | gut: `use` mit Namensräumen, Ordner folgen den Namensräumen (PSR-4-Stil) | Klassen, Interfaces, Traits |
| C# | `.cs` | gut: `using` über `namespace`-Deklarationen | Klassen, Interfaces, Records |

Jede Sprache hat einen Test in [`test/languages.test.mjs`](test/languages.test.mjs).

**Nicht unterstützt:** Ruby, C/C++, Swift, Dart, Elixir und alles, was oben nicht steht. Ein Ordner ohne unterstützte Dateien endet mit „Keine Quelldateien gefunden“ und Exitcode 2. Gemischte Repositories funktionieren, nicht unterstützte Dateien fehlen einfach.

## Was man sieht

- **Mitte (Sechseck):** die Fachmodule, nach Kopplung geordnet. Der Rand ist die Grenze der Fachlogik. Am Rand sitzen die **Ports**.
- **Links:** Eingänge. **Rechts:** Adapter und ihre Bibliotheken. **Oben:** Ablaufsteuerung. **Unten:** Start, gemeinsame Hilfen und der **Querschnitt**.
- **Rot:** Regelverstoß (Fachlogik greift nach außen). **Orange:** Hinweis. Alles andere ist grau.
- **Klick:** alles außer den Verbindungen wird ausgegraut, rechts steht ein Erklärsatz mit Nutzern, Abhängigkeiten, Dateien und Hinweisen.
- **Innenansicht:** Doppelklick, Knopf oder weit hineinzoomen öffnet das Modul bis zu Funktionen und Schemas. Der Knopf „↑ Eine Ebene höher“, Rechtsklick oder Esc führen zurück.
- **Chat „Fragen zum Code“:** nur im als Claude-Artefakt veröffentlichten Stand (Fähigkeit `sample`, eigenes Claude-Konto, kein API-Schlüssel). Claude sieht nur Struktur und Signaturen.

## So wird erkannt

Rollen kommen aus Ordnernamen (`modules`, `adapters`, `contracts`, `entrypoints`, `runtime`, `orchestration`, `diagnostics` und Varianten, siehe `src/model.mjs`). Fehlerbehandlung und Logging werden automatisch zum Querschnitt. Fachlogik und Ports dürfen nicht auf Adapter, Eingänge, Ablaufsteuerung oder Start zeigen. Tests werden ausgelassen (`--include-tests`). Anpassung pro Repository mit `codemap.config.json`, Vorlage: [`codemap.config.example.json`](codemap.config.example.json).

## Grenzen

- Konventionsbasiert: Ein Repo, dessen Ordner nichts über Rollen verraten, erscheint als Bausteine nach Ordnern, nicht als Sechseck. Die Trefferquote auf fremden Repos ist nur an wenigen Beispielen geprüft.
- Importe werden per Muster gelesen: dynamische Importe mit Variablen, Makros und Codegenerierung fehlen. Symbole ebenfalls per Muster, am besten für TypeScript/JavaScript und Python.
- Der Chat beantwortet nur, was aus Struktur und Signaturen folgt.
- Nur der heutige Stand: kein Vergleich zweier Stände, keine Prüfung in CI, kein Export nach Mermaid oder PNG.
- Die Oberfläche gibt es nur auf Deutsch.

## Lizenz

MIT, siehe [LICENSE](LICENSE). Ideen (kein Code) aus hexwright, dependency-cruiser, dep-tree und wirehouse, siehe [docs/inspirations.md](docs/inspirations.md).
