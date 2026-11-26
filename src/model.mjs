// Macht aus Dateien und Importen ein Architekturmodell: Rollen, Bausteine (Units), Kanten, Querschnitt, Verstöße.
// Rollen werden aus Ordnernamen abgeleitet (Voreinstellung) und lassen sich per codemap.config.json ergänzen.
import path from 'node:path';

export const ROLE_LABEL = {
  entrypoint: 'Eingang', core: 'Fachmodul', port: 'Port (Vertrag)', adapter: 'Adapter (Anbindung)',
  orchestration: 'Ablaufsteuerung', runtime: 'Start & Verdrahtung', crosscut: 'Querschnitt', shared: 'Gemeinsam genutzt', unknown: 'Baustein',
};

const DEFAULT_ROLES = {
  entrypoint: ['entrypoints', 'entrypoint', 'controllers', 'controller', 'routes', 'routers', 'router', 'handlers', 'handler', 'web', 'http', 'rest',
    'graphql', 'cli', 'commands', 'endpoints', 'resources', 'ui', 'views', 'pages', 'components', 'screens', 'inbound', 'primary'],
  orchestration: ['orchestration', 'workflows', 'workflow', 'activities', 'jobs', 'workers', 'worker', 'scheduler', 'schedulers', 'sagas', 'pipelines',
    'cron', 'queues', 'consumers', 'listeners', 'subscribers'],
  adapter: ['adapters', 'adapter', 'infrastructure', 'infra', 'integrations', 'integration', 'connectors', 'gateways', 'gateway', 'clients',
    'persistence', 'repositories', 'storage', 'db', 'database', 'drivers', 'providers', 'external', 'outbound', 'secondary'],
  port: ['ports', 'port', 'contracts', 'spi'],
  core: ['modules', 'module', 'domain', 'core', 'model', 'models', 'entities', 'entity', 'aggregates', 'usecases', 'usecase', 'use-cases',
    'application', 'services', 'service', 'business', 'logic', 'features', 'feature'],
  runtime: ['runtime', 'bootstrap', 'wiring', 'startup', 'config', 'configuration', 'di', 'container', 'composition', 'boot', 'setup'],
  shared: ['shared', 'common', 'lib', 'libs', 'utils', 'util', 'helpers', 'helper', 'support', 'kernel'],
  crosscut: ['diagnostics', 'logging', 'logger', 'observability', 'telemetry', 'tracing', 'metrics', 'monitoring', 'errors', 'error', 'exceptions', 'fault', 'faults'],
};

// Dateien/Ordner, die wie Fehlerbehandlung heißen und von vielen Seiten genutzt werden, bilden einen Querschnittsbaustein.
const DEFAULT_CONCERNS = [
  { id: 'errors', label: 'Fehlerbehandlung & Diagnose', match: '(^|[/._-])(fault|faults|errors?|exceptions?|diagnostics?|report-?failure|logger|logging|observability|telemetry|tracing)([/._-]|$)', minUsers: 3 },
];

const STRIP_ANYWHERE = new Set(['src', 'source', 'sources', 'main', 'java', 'kotlin', 'scala', 'python', 'packages']);
const SERVER_ROOT_FILES = /^(main|index|app|server|cli|program|manage|wsgi|asgi)\.[a-z]+$/i;

const hash = (s) => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
export const hueFor = (name) => 75 + ((hash(name) * 0.618033988749895) % 1) * 255; // Rot/Orange bleiben für Status frei

function buildRoleLookup(cfg) {
  const map = new Map();
  for (const [role, words] of Object.entries(DEFAULT_ROLES)) for (const w of words) map.set(w, role);
  for (const [role, words] of Object.entries(cfg.roles || {})) for (const w of words) map.set(String(w).toLowerCase(), role);
  return map;
}

function pretty(name) { return name.replace(/^[-_.]+|[-_.]+$/g, '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()); }

/** Ordnet eine Datei einem Baustein zu: { role, key, label, project } */
function dirsOf(file, prefixLen) {
  let dirs = file.path.split('/').slice(0, -1).slice(prefixLen).filter((d) => !STRIP_ANYWHERE.has(d.toLowerCase()));
  if (/^(com|org|net|io|de|eu)$/.test((dirs[0] || '').toLowerCase()) && dirs.length > 2) dirs = dirs.slice(2);
  return dirs;
}

function classifyFile(file, lookup, prefixLen, ctx) {
  const raw = file.path.split('/');
  let dirs = dirsOf(file, prefixLen);
  const base = raw[raw.length - 1];
  const project = raw.slice(0, prefixLen).join('/');
  for (let i = 0; i < dirs.length; i++) {
    const role = lookup.get(dirs[i].toLowerCase());
    if (!role) continue;
    const next = dirs[i + 1];
    if (role === 'core' && /^(modules?|features?)$/i.test(dirs[i]) && next) {
      // Ports innerhalb eines Fachmoduls als eigener Baustein
      const portIdx = dirs.findIndex((d, j) => j > i + 1 && lookup.get(d.toLowerCase()) === 'port');
      if (portIdx > 0) return { role: 'port', key: `${project}|port|${dirs[i + 1]}`, label: `${pretty(dirs[i + 1])} · Ports`, project };
      return { role: 'core', key: `${project}|core|${next}`, label: pretty(next), project };
    }
    if (role === 'port' && next && !/^(in|out|inbound|outbound)$/i.test(next))
      return { role, key: `${project}|port|${next}`, label: pretty(next), project };
    if (role === 'core' && next && lookup.get(next.toLowerCase()) === 'port')
      return { role: 'port', key: `${project}|port|${dirs[i]}`, label: `${pretty(dirs[i])} · Ports`, project };
    if (['adapter', 'entrypoint', 'orchestration'].includes(role) && next)
      return { role, key: `${project}|${role}|${next}`, label: pretty(next), project };
    if (['adapter', 'entrypoint', 'orchestration'].includes(role))
      return { role, key: `${project}|${role}|_flat`, label: `${pretty(dirs[i])} (Basis)`, project, flat: true };
    return { role, key: `${project}|${role}|${dirs[i]}`, label: pretty(dirs[i]), project };
  }
  if (!dirs.length) {
    if (SERVER_ROOT_FILES.test(base)) return { role: 'runtime', key: `${project}|runtime|root`, label: 'Start (Hauptdatei)', project };
    if (ctx.splitRoot) { const stem = base.replace(/\.[^.]+$/, ''); return { role: 'unknown', key: `${project}|unknown|file:${stem}`, label: pretty(stem), project }; }
    return { role: 'unknown', key: `${project}|unknown|root`, label: 'Wurzelordner', project };
  }
  if (ctx.big.has(dirs[0]) && dirs[1]) return { role: 'unknown', key: `${project}|unknown|${dirs[0]}/${dirs[1]}`, label: `${pretty(dirs[0])} · ${pretty(dirs[1])}`, project };
  return { role: 'unknown', key: `${project}|unknown|${dirs[0]}`, label: pretty(dirs[0]), project };
}

function commonPrefixLen(files) {
  if (!files.length) return 0;
  const parts = files.map((f) => f.path.split('/').slice(0, -1));
  let n = 0;
  while (parts.every((p) => p.length > n && p[n] === parts[0][n])) n++;
  // Der gemeinsame Anfang wird nur entfernt, wenn er kein Rollenordner ist.
  return n;
}

/** @returns {{project, units, edges, stats}} */
export function buildModel(scan, cfg = {}) {
  const lookup = buildRoleLookup(cfg);
  let files = scan.files;
  let prefixLen = commonPrefixLen(files);
  // gemeinsame Ordner entfernen, außer sie sind selbst Rollenwörter (z. B. alles liegt unter adapters/)
  while (prefixLen > 0 && lookup.has(files[0].path.split('/')[prefixLen - 1].toLowerCase())) prefixLen--;
  const commonPrefix = files[0] ? files[0].path.split('/').slice(0, prefixLen).join('/') : '';

  const assign = new Map(); // Datei -> { role, key, label, project }
  const rootFlat = files.filter((f) => !dirsOf(f, prefixLen).length && !SERVER_ROOT_FILES.test(f.path.split('/').pop())).length;
  const firstCount = new Map();
  for (const f of files) { const d = dirsOf(f, prefixLen); if (d.length > 1 && !lookup.get(d[0].toLowerCase())) firstCount.set(d[0], (firstCount.get(d[0]) || 0) + 1); }
  const ctx = { splitRoot: rootFlat > 0 && rootFlat <= 30, big: new Set([...firstCount].filter(([, n]) => n > 30).map(([k]) => k)) };
  for (const f of files) assign.set(f.path, classifyFile(f, lookup, prefixLen, ctx));

  // Datei-Kanten vorbereiten
  const inEdges = new Map();
  for (const e of scan.edges) { (inEdges.get(e.to) || inEdges.set(e.to, []).get(e.to)).push(e); }
  const unitOf = (p) => assign.get(p).key;

  // Querschnitt: Dateien mit Fehler-/Diagnose-Namen, die in Ordnern gleichen Namens liegen oder von vielen Bausteinen genutzt werden
  const concerns = [...DEFAULT_CONCERNS, ...(cfg.concerns || [])].map((c) => ({ ...c, re: new RegExp(c.match, 'i'), minUsers: c.minUsers ?? 3 }));
  for (const f of files) {
    const a = assign.get(f.path);
    if (a.role === 'crosscut') continue;
    for (const c of concerns) {
      if (!c.re.test(f.path)) continue;
      const users = new Set((inEdges.get(f.path) || []).map((e) => unitOf(e.from)));
      users.delete(a.key);
      const inConcernDir = f.path.split('/').slice(0, -1).some((d) => c.re.test(d));
      if (inConcernDir || users.size >= c.minUsers) {
        assign.set(f.path, { role: 'crosscut', key: `|crosscut|${c.id}`, label: c.label, project: '' });
        break;
      }
    }
  }

  // Bausteine
  const units = new Map();
  for (const f of files) {
    const a = assign.get(f.path);
    let u = units.get(a.key);
    if (!u) { u = { id: a.key, label: a.label, role: a.role, project: a.project, files: [], loc: 0, ext: new Map(), docs: [] }; units.set(a.key, u); }
    u.files.push({ path: f.path, loc: f.loc, lang: f.lang, doc: f.doc || '', sym: f.sym || [] });
    u.loc += f.loc;
    if (f.doc) u.docs.push({ path: f.path, doc: f.doc, loc: f.loc });
  }
  for (const x of scan.externals) { const u = units.get(unitOf(x.from)); if (u) u.ext.set(x.name, (u.ext.get(x.name) || 0) + 1); }

  // Lose Dateien direkt im Adapter-/Eingangs-Ordner sind gemeinsame Hilfen, wenn es daneben echte Bausteine derselben Rolle gibt
  for (const u of units.values()) {
    if (!u.id.endsWith('|_flat')) continue;
    if (u.role === 'adapter' && [...units.values()].some((o) => o !== u && o.role === u.role)) u.role = 'shared';
  }

  // Kanten Baustein -> Baustein
  const edgeMap = new Map();
  for (const e of scan.edges) {
    const a = unitOf(e.from), b = unitOf(e.to);
    if (a === b) continue;
    const k = a + ' -> ' + b;
    let ed = edgeMap.get(k);
    if (!ed) { ed = { from: a, to: b, count: 0, typeOnly: 0, samples: [] }; edgeMap.set(k, ed); }
    ed.count++;
    if (e.kind === 'type') ed.typeOnly++;
    if (ed.samples.length < 3) ed.samples.push({ from: e.from, to: e.to, line: e.line });
  }

  // Verbindungen je Datei: wohin sie zeigt, von wo sie genutzt wird, welche Bibliotheken sie braucht
  const fOut = new Map(), fIn = new Map(), fExt = new Map(), fInt = new Map();
  const bump = (m, f, k) => { let x = m.get(f); if (!x) m.set(f, (x = new Map())); x.set(k, (x.get(k) || 0) + 1); };
  for (const e of scan.edges) {
    const a = unitOf(e.from), b = unitOf(e.to);
    if (a === b) { fInt.set(e.from, (fInt.get(e.from) || 0) + 1); fInt.set(e.to, (fInt.get(e.to) || 0) + 1); }
    else { bump(fOut, e.from, b); bump(fIn, e.to, a); }
  }
  for (const x of scan.externals) bump(fExt, x.from, x.name);
  const top = (m, n = 10) => (m ? [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n) : []);

  // Hubs: gemeinsam genutzte oder nicht zuordenbare Bausteine, die fast alle nutzen, gelten als Querschnitt
  const allUnits = [...units.values()];
  if (allUnits.length >= 6) {
    for (const u of allUnits) {
      if (!['shared', 'unknown'].includes(u.role)) continue;
      const users = new Set([...edgeMap.values()].filter((e) => e.to === u.id).map((e) => e.from));
      if (users.size >= 4 && users.size >= 0.4 * (allUnits.length - 1)) u.role = 'crosscut';
    }
  }
  // Adapter, die mindestens drei andere Adapter nutzen, sind gemeinsame technische Hilfen (z. B. ein HTTP-Client)
  for (const u of allUnits) {
    if (u.role !== 'adapter') continue;
    const users = new Set([...edgeMap.values()].filter((e) => e.to === u.id && units.get(e.from).role === 'adapter').map((e) => e.from));
    if (users.size >= 3) u.role = 'shared';
  }
  const roleOf = (id) => units.get(id).role;

  // Bewertung der Kanten (Abhängigkeitsrichtung nach innen)
  const INNER = new Set(['core', 'port']);
  const OUTER = new Set(['adapter', 'entrypoint', 'orchestration', 'runtime']);
  const edges = [];
  const issues = [];
  for (const ed of edgeMap.values()) {
    const ra = roleOf(ed.from), rb = roleOf(ed.to);
    let cls = 'ok', why = '';
    if (ra === 'crosscut' || ra === 'shared') cls = 'ok';
    else if (rb === 'crosscut' || rb === 'shared') cls = 'cross';
    else if (ra === 'runtime') cls = 'wiring';
    else if (INNER.has(ra) && OUTER.has(rb)) { cls = 'violation'; why = `${ROLE_LABEL[ra]} greift nach außen auf ${ROLE_LABEL[rb]} zu`; }
    else if (ra === 'adapter' && rb === 'entrypoint') { cls = 'violation'; why = 'Adapter greift auf einen Eingang zu'; }
    else if (ra === 'entrypoint' && rb === 'adapter') { cls = 'warn'; why = 'Eingang umgeht den Fachkern und nutzt einen Adapter direkt'; }
    else if (ra === 'adapter' && rb === 'adapter') { cls = 'warn'; why = 'Adapter nutzt einen anderen Adapter'; }
    else if (ra === 'core' && rb === 'core') { cls = 'warn'; why = 'Fachmodul greift direkt in ein anderes Fachmodul'; }
    if (why) issues.push({ from: ed.from, to: ed.to, cls, why, count: ed.count, samples: ed.samples });
    edges.push({ ...ed, cls, why });
  }

  // Seite der Ports (Eingang links oder Ausgang rechts)
  for (const u of allUnits) {
    if (u.role !== 'port') continue;
    let inb = 0, outb = 0;
    for (const e of edges) if (e.to === u.id) { const r = roleOf(e.from); if (r === 'entrypoint' || r === 'orchestration') inb += e.count; else if (r === 'adapter') outb += e.count; }
    u.side = inb > outb ? 'left' : 'right';
  }

  // Beschreibungen
  const out = allUnits.map((u) => {
    const docs = u.docs.sort((a, b) => (/(index|readme|mod)\b/i.test(b.path) ? 1 : 0) - (/(index|readme|mod)\b/i.test(a.path) ? 1 : 0) || b.loc - a.loc);
    const uses = edges.filter((e) => e.from === u.id).map((e) => ({ id: e.to, count: e.count, cls: e.cls })).sort((a, b) => b.count - a.count);
    const usedBy = edges.filter((e) => e.to === u.id).map((e) => ({ id: e.from, count: e.count, cls: e.cls })).sort((a, b) => b.count - a.count);
    return {
      id: u.id, label: u.label, role: u.role, project: u.project, side: u.side || null, owner: u.role === 'port' && units.has(u.id.replace('|port|', '|core|')) ? u.id.replace('|port|', '|core|') : null, hue: Math.round(hueFor(u.label)),
      fileCount: u.files.length, loc: u.loc, doc: docs[0] ? docs[0].doc : '',
      files: u.files.sort((a, b) => b.loc - a.loc).slice(0, 300).map((f) => ({ path: f.path, loc: f.loc, doc: f.doc ? f.doc.slice(0, 140) : '', out: top(fOut.get(f.path)), in: top(fIn.get(f.path)), ext: top(fExt.get(f.path), 6).map((x) => x[0]), int: fInt.get(f.path) || 0, sym: f.sym })),
      ext: [...u.ext.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12),
      uses, usedBy,
    };
  });
  out.sort((a, b) => (a.role < b.role ? -1 : a.role > b.role ? 1 : a.label.localeCompare(b.label)));

  const roles = {};
  for (const u of out) roles[u.role] = (roles[u.role] || 0) + 1;
  return {
    project: { name: cfg.name || path.basename(scan.root), root: scan.root, prefix: commonPrefix, langs: scan.langCount, skippedTests: scan.skippedTests },
    units: out, edges: edges.map(({ from, to, count, typeOnly, cls, why, samples }) => ({ from, to, count, typeOnly, cls, why, samples })),
    stats: { files: files.length, loc: files.reduce((s, f) => s + f.loc, 0), units: out.length, roles, issues: issues.length, fileEdges: scan.edges.length },
    issues, roleLabels: ROLE_LABEL,
  };
}
