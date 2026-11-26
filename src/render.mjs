// Baut die eine HTML-Datei: Viewer-Template plus Modell als JSON. Keine externen Ressourcen.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** @param {object} model Ergebnis von buildModel
 *  @param {{fragment?: boolean, title?: string}} opts fragment=true liefert nur den Seiteninhalt (für Artefakte), sonst ein vollständiges Dokument */
export function renderHtml(model, opts = {}) {
  const title = opts.title || `${model.project.name} Architekturkarte`;
  const json = JSON.stringify(model).replace(/</g, '\\u003c').split(String.fromCharCode(0x2028)).join('\\u2028').split(String.fromCharCode(0x2029)).join('\\u2029');
  let html = fs.readFileSync(path.join(here, 'template.html'), 'utf8');
  html = html.replace('__TITLE__', () => title.replace(/[<>&]/g, '')).replace('__DATA__', () => json);
  if (opts.fragment) return html;
  return `<!doctype html>\n<html lang="de">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<style>:root{color-scheme:light}body{margin:0}</style>\n</head>\n<body>\n${html}\n</body>\n</html>\n`;
}
