// Schnipsel-Modus: eine einzelne Datei oder ein Textstück. Jede Deklaration (Klasse, Funktion, Typ) wird ein Baustein,
// ein Verweis auf einen anderen Namen im Rumpf wird eine Kante. Die Rolle kommt aus der Namensendung (Port, Adapter, Controller ...).
// Intern wird das als virtuelles Dateisystem aufgebaut, damit dieselbe Modell-Logik wie bei Repositories gilt.
import path from 'node:path';
import { LANGS } from './scan.mjs';

const DECL = {
  js: /^[ \t]*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\*?\s+(\w+)|^[ \t]*(?:export\s+)?(?:abstract\s+)?class\s+(\w+)|^[ \t]*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>|^[ \t]*(?:export\s+)?interface\s+(\w+)|^[ \t]*(?:export\s+)?type\s+(\w+)\s*=/gm,
  py: /^(?:async\s+)?def\s+(\w+)|^class\s+(\w+)/gm,
  other: /^[ \t]*(?:(?:public|private|protected|internal|abstract|final|open|data|sealed|static|export|pub)\s+)*(?:class|interface|enum|record|struct|trait|object|fun|func|fn|def)\s+(\w+)/gm,
};

function roleDir(name) {
  if (/(Port|Repository|Gateway|Store|Interface|Contract)$/.test(name)) return 'ports';
  if (/(Adapter|Client|Impl|Provider|Dao|Sink|Driver)$/.test(name)) return 'adapters';
  if (/(Controller|Handler|Route|Resolver|Endpoint|Command|View|Page|Cli)$/.test(name)) return 'entrypoints';
  if (/(Error|Exception|Logger|Fault|Diagnostic)/.test(name)) return 'diagnostics';
  if (/^(main|bootstrap|app|run|setup|start)$/i.test(name)) return 'runtime';
  return 'modules';
}

export function snippetToScan(text, lang, label = 'Schnipsel') {
  const re = DECL[lang === 'js' ? 'js' : lang === 'py' ? 'py' : 'other'];
  const found = []; let m;
  re.lastIndex = 0;
  while ((m = re.exec(text))) {
    const nm = m.slice(1).find(Boolean);
    if (nm) found.push({ name: nm, start: m.index, line: text.slice(0, m.index).split('\n').length });
  }
  const seen = new Set();
  const decls = found.filter((d) => (seen.has(d.name) ? false : seen.add(d.name)));
  decls.forEach((d, i) => { d.end = i + 1 < decls.length ? decls[i + 1].start : text.length; d.body = text.slice(d.start, d.end); });
  const ext = lang === 'py' ? '.py' : '.ts';
  const files = decls.map((d) => ({ path: `${roleDir(d.name)}/${d.name}/${d.name}${ext}`, lang, loc: d.body.split('\n').length, doc: '' }));
  const pathOf = new Map(decls.map((d, i) => [d.name, files[i].path]));
  const edges = [];
  for (const d of decls) {
    const own = d.body.replace(new RegExp(`\\b${d.name}\\b`), ' '.repeat(d.name.length));
    for (const o of decls) {
      if (o === d) continue;
      const idx = own.search(new RegExp(`\\b${o.name}\\b`));
      if (idx >= 0) edges.push({ from: pathOf.get(d.name), to: pathOf.get(o.name), line: d.line + own.slice(0, idx).split('\n').length - 1, kind: 'import' });
    }
  }
  return { root: path.resolve(label), files, edges, externals: [], skippedTests: 0, langCount: { [lang]: 1 } };
}

export const langOf = (file) => LANGS[path.extname(file).toLowerCase()] || 'other';
