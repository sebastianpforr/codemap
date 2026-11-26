#!/usr/bin/env node
// codemap: erzeugt aus einem Repository oder einer einzelnen Datei eine erklärende 2D-Karte (eine HTML-Datei, kein Upload).
import fs from 'node:fs';
import path from 'node:path';
import { scanDirectory } from '../src/scan.mjs';
import { buildModel } from '../src/model.mjs';
import { renderHtml } from '../src/render.mjs';
import { snippetToScan, langOf } from '../src/snippet.mjs';

const HELP = `codemap <ordner|datei> [Optionen]

  --out <datei>        HTML-Ausgabe (Standard: ./codemap-<name>.html)
  --json <datei>       zusätzlich das Modell als JSON schreiben
  --name <text>        Anzeigename des Projekts
  --config <datei>     Konfiguration (Standard: <ordner>/codemap.config.json, falls vorhanden)
  --include-tests      Testdateien einbeziehen
  --fragment           nur Seiteninhalt ausgeben (für Einbettung, z. B. als Artefakt)
  --lang <js|py|java>  Sprache bei --stdin oder unbekannter Endung
  --stdin              Quelltext von der Standardeingabe lesen (Schnipsel-Modus)
  -h, --help           diese Hilfe
`;

const args = process.argv.slice(2);
const opt = { _: [] };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '-h' || a === '--help') opt.help = true;
  else if (['--include-tests', '--fragment', '--stdin'].includes(a)) opt[a.slice(2)] = true;
  else if (a.startsWith('--')) opt[a.slice(2)] = args[++i];
  else opt._.push(a);
}
if (opt.help || (!opt._.length && !opt.stdin)) { process.stdout.write(HELP); process.exit(opt.help ? 0 : 1); }

let cfg = {};
const target = opt._[0] ? path.resolve(opt._[0]) : process.cwd();
const cfgFile = opt.config ? path.resolve(opt.config) : path.join(fs.existsSync(target) && fs.statSync(target).isDirectory() ? target : path.dirname(target), 'codemap.config.json');
if (fs.existsSync(cfgFile)) cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
if (opt.name) cfg.name = opt.name;

let scan, label;
if (opt.stdin) {
  scan = snippetToScan(fs.readFileSync(0, 'utf8'), opt.lang || 'js', 'Schnipsel');
  label = cfg.name || 'Schnipsel';
} else if (fs.statSync(target).isFile()) {
  scan = snippetToScan(fs.readFileSync(target, 'utf8'), opt.lang || langOf(target), path.basename(target));
  label = cfg.name || path.basename(target);
} else {
  scan = scanDirectory(target, { includeTests: !!opt['include-tests'], exclude: cfg.exclude });
  label = cfg.name || path.basename(target);
}
if (!scan.files.length) { console.error('Keine Quelldateien gefunden.'); process.exit(2); }
cfg.name = cfg.name || label;
const model = buildModel(scan, cfg);
const safe = label.replace(/[^\w.-]+/g, '_');
const out = path.resolve(opt.out || `codemap-${safe}.html`);
fs.writeFileSync(out, renderHtml(model, { fragment: !!opt.fragment, title: `${label} Architekturkarte` }));
if (opt.json) fs.writeFileSync(path.resolve(opt.json), JSON.stringify(model, null, 2));
const s = model.stats;
console.log(`${label}: ${s.files} Dateien, ${s.units} Bausteine, ${s.fileEdges} Verweise, ${model.issues.filter((i) => i.cls === 'violation').length} Verstöße, ${model.issues.filter((i) => i.cls === 'warn').length} Hinweise`);
console.log(`geschrieben: ${out}`);
