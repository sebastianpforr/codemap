// Liest ein Verzeichnis und liefert Dateien und ihre Importe (Datei -> Datei, Datei -> externes Paket).
// Keine Abhängigkeiten. Erkennt JS/TS, Python, Java/Kotlin/Scala, Go, Rust, PHP, C#.
// Quelltexte verlassen diese Datei nie: Ergebnis sind nur Pfade, Zeilenzahlen, Namen und ein kurzer Kommentarauszug.
import fs from 'node:fs';
import path from 'node:path';

export const LANGS = {
  '.ts': 'js', '.tsx': 'js', '.mts': 'js', '.cts': 'js', '.js': 'js', '.jsx': 'js', '.mjs': 'js', '.cjs': 'js',
  '.py': 'py', '.java': 'java', '.kt': 'java', '.kts': 'java', '.scala': 'java',
  '.go': 'go', '.rs': 'rs', '.php': 'php', '.cs': 'cs',
};

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'target', 'vendor', '__pycache__', '.venv', 'venv', 'env', '.next',
  '.nuxt', 'coverage', '.idea', '.vscode', '.gradle', '.tox', '.mypy_cache', '.pytest_cache', 'bin', 'obj', '.harness',
  'site-packages', '.cache', 'tmp', 'temp',
]);

const TEST_RE = /(^|\/)(tests?|__tests__|spec|specs|e2e|__mocks__|fixtures?|testdata)(\/|$)|\.(test|spec)\.[a-z]+$|_test\.(go|py)$|(^|\/)test_[^/]*\.py$|Tests?\.(java|kt|cs)$/i;

const NODE_BUILTINS = new Set(['fs', 'path', 'os', 'http', 'https', 'url', 'util', 'crypto', 'stream', 'events', 'child_process', 'zlib',
  'net', 'tls', 'dns', 'readline', 'assert', 'buffer', 'querystring', 'timers', 'worker_threads', 'perf_hooks', 'async_hooks', 'process',
  'module', 'vm', 'v8', 'cluster', 'dgram', 'http2', 'string_decoder', 'tty', 'inspector', 'diagnostics_channel']);

const PY_STDLIB = new Set(['os', 'sys', 're', 'json', 'typing', 'pathlib', 'dataclasses', 'collections', 'functools', 'itertools', 'logging',
  'asyncio', 'datetime', 'abc', 'enum', 'math', 'random', 'time', 'uuid', 'hashlib', 'subprocess', 'argparse', 'unittest', 'io', 'copy',
  'contextlib', 'string', 'textwrap', 'shutil', 'tempfile', 'glob', 'csv', 'sqlite3', 'threading', 'http', 'urllib', 'base64', 'struct',
  'operator', 'inspect', 'traceback', 'warnings', '__future__', 'ast', 'types', 'secrets', 'socket', 'ssl', 'queue', 'decimal',
  'fractions', 'statistics', 'heapq', 'bisect', 'weakref', 'pprint', 'platform', 'signal', 'zipfile', 'tarfile', 'gzip', 'pickle', 'shlex',
  'getpass', 'html', 'xml', 'email', 'smtplib', 'multiprocessing', 'concurrent', 'importlib', 'codecs', 'locale', 'unicodedata', 'zoneinfo',
  'tomllib', 'array', 'select', 'selectors', 'ctypes', 'configparser', 'fnmatch', 'numbers', 'calendar', 'mimetypes']);

const toPosix = (p) => p.split(path.sep).join('/');

// ---------- Hilfen ----------

/** Entfernt Kommentare, lässt Zeichenketten und Zeilenumbrüche unangetastet (Zeilennummern bleiben stabil). */
export function stripComments(src, style = 'c') {
  if (style === 'py') return src.replace(/("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|#[^\n]*/g, (m, s) => s ?? '');
  return src.replace(/("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
    (m, s) => s ?? m.replace(/[^\n]/g, ' '));
}

const lineOf = (text, idx) => { let n = 1; for (let i = 0; i < idx; i++) if (text.charCodeAt(i) === 10) n++; return n; };

/** Erster sinnvoller Kommentar am Dateianfang, als Kurzbeschreibung (ohne Lizenzköpfe). */
export function firstDoc(src, lang) {
  let t = '';
  const head = src.slice(0, 4000).replace(/^﻿/, '').replace(/^#!.*\n/, '');
  let m;
  if (lang === 'py') {
    m = head.match(/^\s*(?:#[^\n]*\n\s*)*(?:"""([\s\S]*?)"""|'''([\s\S]*?)''')/);
    t = m ? (m[1] ?? m[2]) : (head.match(/^(?:\s*#[^\n]*\n)+/) || [''])[0].replace(/^\s*#\s?/gm, '');
  } else if ((m = head.match(/^\s*\/\*\*?([\s\S]*?)\*\//))) {
    t = m[1].replace(/^\s*\*\s?/gm, '');
  } else if ((m = head.match(/^(?:\s*\/\/[^\n]*\n)+/))) {
    t = m[0].replace(/^\s*\/\/\s?/gm, '');
  }
  t = t.replace(/\s+/g, ' ').trim();
  if (!t || /copyright|license|lizenz|@license|eslint-|prettier-|ts-nocheck|use strict/i.test(t.slice(0, 160))) return '';
  return t.length > 220 ? t.slice(0, 217) + '…' : t;
}

function readJsonLoose(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(stripComments(raw).replace(/,(\s*[}\]])/g, '$1'));
  } catch { return null; }
}

// ---------- Dateien sammeln ----------

export function collectFiles(root, opts = {}) {
  const exclude = (opts.exclude || []).map((r) => new RegExp(r));
  const out = [];
  const walk = (dir) => {
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.isSymbolicLink()) continue;
      const abs = path.join(dir, e.name);
      const rel = toPosix(path.relative(root, abs));
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || (e.name.startsWith('.') && e.name !== '.')) continue;
        if (exclude.some((r) => r.test(rel + '/'))) continue;
        walk(abs);
      } else if (e.isFile()) {
        const lang = LANGS[path.extname(e.name).toLowerCase()];
        if (!lang || /\.d\.ts$/.test(e.name) || /\.min\./.test(e.name)) continue;
        if (exclude.some((r) => r.test(rel))) continue;
        out.push({ path: rel, abs, lang, isTest: TEST_RE.test(rel) });
      }
    }
  };
  walk(root);
  out.sort((a, b) => (a.path < b.path ? -1 : 1));
  return out;
}

// ---------- Importe je Sprache ----------

function importsJs(text) {
  const code = stripComments(text);
  const found = [];
  const add = (re, group, kindFn) => { let m; while ((m = re.exec(code))) found.push({ spec: m[group], line: lineOf(code, m.index), kind: kindFn(m) }); };
  add(/(?:^|[\n;{}])\s*import\s+(type\s+)?(?:[\w*${}\s,]+?\s+from\s+)?['"]([^'"\n]+)['"]/g, 2, (m) => (m[1] ? 'type' : 'import'));
  add(/(?:^|[\n;{}])\s*export\s+(type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s+from\s+['"]([^'"\n]+)['"]/g, 2, (m) => (m[1] ? 'type' : 'reexport'));
  add(/\b(?:require|import)\(\s*['"]([^'"\n]+)['"]\s*\)/g, 1, () => 'dynamic');
  return found;
}

function importsPy(text) {
  const code = stripComments(text, 'py');
  const found = [];
  let m;
  const reImp = /^[ \t]*import\s+([\w.]+(?:\s+as\s+\w+)?(?:\s*,\s*[\w.]+(?:\s+as\s+\w+)?)*)/gm;
  while ((m = reImp.exec(code))) for (const part of m[1].split(',')) found.push({ spec: part.trim().split(/\s+as\s+/)[0], line: lineOf(code, m.index), kind: 'import' });
  const reFrom = /^[ \t]*from\s+(\.*[\w.]*)\s+import\s+(\([^)]*\)|[^\n]+)/gm;
  while ((m = reFrom.exec(code))) {
    const names = m[2].replace(/[()\\]/g, ' ').split(',').map((s) => s.trim().split(/\s+as\s+/)[0]).filter((s) => /^\w+$/.test(s));
    found.push({ spec: m[1], names, line: lineOf(code, m.index), kind: 'import' });
  }
  return found;
}

function importsJava(text) {
  const code = stripComments(text);
  const found = [];
  const pkg = (code.match(/^\s*package\s+([\w.]+)/m) || [])[1] || '';
  let m;
  const re = /^\s*import\s+(?:static\s+)?([\w.]+)(\.\*)?\s*;?/gm;
  while ((m = re.exec(code))) found.push({ spec: m[1], wildcard: !!m[2], line: lineOf(code, m.index), kind: 'import' });
  return { found, pkg };
}

function importsGo(text) {
  const code = stripComments(text);
  const found = [];
  let m;
  const block = /import\s*\(([\s\S]*?)\)/g;
  while ((m = block.exec(code))) {
    const base = lineOf(code, m.index);
    const re = /(?:[\w.]+\s+)?"([^"]+)"/g; let n;
    while ((n = re.exec(m[1]))) found.push({ spec: n[1], line: base, kind: 'import' });
  }
  const single = /^\s*import\s+(?:[\w.]+\s+)?"([^"]+)"/gm;
  while ((m = single.exec(code))) found.push({ spec: m[1], line: lineOf(code, m.index), kind: 'import' });
  return found;
}

function importsRs(text) {
  const code = stripComments(text);
  const found = [];
  let m;
  const reUse = /^\s*(?:pub(?:\([^)]*\))?\s+)?use\s+([\w:]+)/gm;
  while ((m = reUse.exec(code))) found.push({ spec: m[1], line: lineOf(code, m.index), kind: 'import' });
  const reMod = /^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*;/gm;
  while ((m = reMod.exec(code))) found.push({ spec: 'self::' + m[1], line: lineOf(code, m.index), kind: 'mod' });
  return found;
}

function importsPhp(text) {
  const code = stripComments(text);
  const found = []; let m;
  const re = /^\s*use\s+(?:function\s+|const\s+)?([\w\\]+)(?:\s+as\s+\w+)?\s*;/gm;
  while ((m = re.exec(code))) found.push({ spec: m[1], line: lineOf(code, m.index), kind: 'import' });
  return found;
}

function importsCs(text) {
  const code = stripComments(text);
  const found = []; let m;
  const pkg = (code.match(/^\s*namespace\s+([\w.]+)/m) || [])[1] || '';
  const re = /^\s*(?:global\s+)?using\s+(?:static\s+)?(?:\w+\s*=\s*)?([\w.]+)\s*;/gm;
  while ((m = re.exec(code))) found.push({ spec: m[1], wildcard: true, line: lineOf(code, m.index), kind: 'import' });
  return { found, pkg };
}

// ---------- Auflösung ----------

const JS_EXT = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json'];

function jsCandidates(base, fileSet) {
  const list = [base];
  const swapped = base.replace(/\.(m|c)?jsx?$/, (_, p = '') => '');
  if (swapped !== base) for (const e of ['.ts', '.tsx', '.mts', '.cts']) list.push(swapped + e);
  for (const e of JS_EXT) list.push(base + e);
  for (const e of JS_EXT) list.push(base + '/index' + e);
  return list.find((c) => fileSet.has(c)) || null;
}

function makeJsResolver(root, files, fileSet) {
  const tsCache = new Map();
  const tsconfigFor = (dir) => {
    if (tsCache.has(dir)) return tsCache.get(dir);
    let res = null;
    for (const name of ['tsconfig.json', 'jsconfig.json']) {
      const f = path.join(root, dir, name);
      if (fs.existsSync(f)) {
        const j = readJsonLoose(f);
        const co = j && j.compilerOptions;
        if (co && (co.paths || co.baseUrl)) res = { dir, baseUrl: co.baseUrl || '.', paths: co.paths || {} };
        break;
      }
    }
    if (!res && dir) res = tsconfigFor(dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : '');
    tsCache.set(dir, res);
    return res;
  };
  // Arbeitsbereiche (Monorepo): Paketname -> Ordner
  const packages = new Map();
  for (const f of files) if (f.lang === 'js') { /* Paketordner über package.json unten */ }
  const walkPkgs = (dir, depth) => {
    if (depth > 4) return;
    let ents; try { ents = fs.readdirSync(path.join(root, dir), { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) walkPkgs(dir ? dir + '/' + e.name : e.name, depth + 1);
      else if (e.isFile() && e.name === 'package.json') {
        const j = readJsonLoose(path.join(root, dir, e.name));
        if (j && j.name) packages.set(j.name, { dir, main: j.module || j.main || j.types || null });
      }
    }
  };
  walkPkgs('', 0);

  const norm = (p) => path.posix.normalize(p).replace(/^\.\//, '');
  return (imp, from) => {
    const spec = imp.spec;
    const fromDir = path.posix.dirname(from) === '.' ? '' : path.posix.dirname(from);
    if (spec.startsWith('.')) {
      const hit = jsCandidates(norm(path.posix.join(fromDir, spec)), fileSet);
      return hit ? { file: hit } : { unresolved: spec };
    }
    const ts = tsconfigFor(fromDir);
    if (ts) {
      for (const [pat, targets] of Object.entries(ts.paths)) {
        const star = pat.indexOf('*');
        const m = star < 0 ? (spec === pat ? '' : null) : (spec.startsWith(pat.slice(0, star)) && spec.endsWith(pat.slice(star + 1)) ? spec.slice(star, spec.length - (pat.length - star - 1)) : null);
        if (m === null) continue;
        for (const t of targets) {
          const hit = jsCandidates(norm(path.posix.join(ts.dir, ts.baseUrl, t.replace('*', m))), fileSet);
          if (hit) return { file: hit };
        }
      }
      const viaBase = jsCandidates(norm(path.posix.join(ts.dir, ts.baseUrl, spec)), fileSet);
      if (viaBase) return { file: viaBase };
    }
    for (const [name, pkg] of packages) {
      if (spec === name || spec.startsWith(name + '/')) {
        const sub = spec.slice(name.length).replace(/^\//, '');
        const tries = sub ? [path.posix.join(pkg.dir, sub), path.posix.join(pkg.dir, 'src', sub)]
          : [pkg.main && path.posix.join(pkg.dir, pkg.main), path.posix.join(pkg.dir, 'src/index'), path.posix.join(pkg.dir, 'index')].filter(Boolean);
        for (const t of tries) { const hit = jsCandidates(norm(t), fileSet); if (hit) return { file: hit }; }
      }
    }
    if (spec.startsWith('node:') || NODE_BUILTINS.has(spec.split('/')[0])) return { builtin: spec.replace(/^node:/, '') };
    const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
    return { external: name };
  };
}

function makePyResolver(files, fileSet) {
  const index = new Map(); // gepunkteter Name -> Datei (alle Suffixe)
  const full = new Map();
  for (const f of files) {
    if (f.lang !== 'py') continue;
    const parts = f.path.replace(/\.py$/, '').split('/');
    if (parts[parts.length - 1] === '__init__') parts.pop();
    if (!parts.length) continue;
    full.set(parts.join('.'), f.path);
    for (let i = 0; i < parts.length; i++) {
      const key = parts.slice(i).join('.');
      if (!index.has(key)) index.set(key, f.path); else if (index.get(key) !== f.path) index.set(key, null);
    }
  }
  const lookup = (dotted) => full.get(dotted) || index.get(dotted) || null;
  return (imp, from) => {
    const results = [];
    let spec = imp.spec;
    if (spec.startsWith('.')) {
      const dots = spec.match(/^\.+/)[0].length;
      let dir = path.posix.dirname(from);
      for (let i = 1; i < dots; i++) dir = path.posix.dirname(dir);
      const rest = spec.slice(dots);
      const base = (dir === '.' ? '' : dir) + (rest ? (dir === '.' ? '' : '/') + rest.replace(/\./g, '/') : '');
      const tryFile = (b) => [b + '.py', b + '/__init__.py'].find((c) => fileSet.has(c));
      const main = rest ? tryFile(base) : (fileSet.has((dir === '.' ? '' : dir + '/') + '__init__.py') ? (dir === '.' ? '' : dir + '/') + '__init__.py' : null);
      if (main) results.push({ file: main });
      for (const n of imp.names || []) { const sub = tryFile((base ? base + '/' : '') + n); if (sub) results.push({ file: sub }); }
      return results.length ? results : [{ unresolved: spec }];
    }
    const parts = spec.split('.');
    for (let n = parts.length; n >= 1; n--) {
      const mod = lookup(parts.slice(0, n).join('.'));
      const subs = (imp.names || []).map((nm) => lookup(parts.slice(0, n).concat(nm).join('.'))).filter(Boolean);
      if (mod || subs.length) {
        if (mod) results.push({ file: mod });
        for (const sub of subs) results.push({ file: sub });
        return results;
      }
    }
    if (PY_STDLIB.has(parts[0])) return [{ builtin: parts[0] }];
    return [{ external: parts[0] }];
  };
}

function makeJavaResolver(files) {
  const byFqn = new Map(); const byPkg = new Map();
  for (const f of files) {
    if (f.lang !== 'java' || !f.pkg) continue;
    byFqn.set(f.pkg + '.' + path.posix.basename(f.path).replace(/\.[^.]+$/, ''), f.path);
    if (!byPkg.has(f.pkg)) byPkg.set(f.pkg, f.path);
  }
  return (imp) => {
    const parts = imp.spec.split('.');
    if (!imp.wildcard) for (let n = parts.length; n >= 2; n--) { const hit = byFqn.get(parts.slice(0, n).join('.')); if (hit) return { file: hit }; }
    const pkg = imp.wildcard ? imp.spec : parts.slice(0, -1).join('.');
    if (byPkg.has(pkg)) return { file: byPkg.get(pkg) };
    if (/^(java|javax|kotlin|kotlinx|scala|jdk|sun)\./.test(imp.spec)) return { builtin: parts[0] };
    return { external: parts.slice(0, /^(com|org|net|io|de|eu)$/.test(parts[0]) ? 3 : 2).join('.') };
  };
}

// C#: `using A.B` meint einen Namensraum; Ziel ist eine Datei, die ihn mit `namespace A.B` deklariert.
function makeNamespaceResolver(files, lang, builtinRe) {
  const byNs = new Map();
  for (const f of files) if (f.lang === lang && f.pkg && !byNs.has(f.pkg)) byNs.set(f.pkg, f.path);
  return (imp) => {
    if (byNs.has(imp.spec)) return { file: byNs.get(imp.spec) };
    if (builtinRe.test(imp.spec)) return { builtin: imp.spec.split('.')[0] };
    return { external: imp.spec.split('.').slice(0, 2).join('.') };
  };
}

function makeGoResolver(root, files) {
  let mod = '';
  try { mod = (fs.readFileSync(path.join(root, 'go.mod'), 'utf8').match(/^module\s+(\S+)/m) || [])[1] || ''; } catch { /* kein go.mod */ }
  const byDir = new Map();
  for (const f of files) if (f.lang === 'go' && !f.isTest) { const d = path.posix.dirname(f.path); if (!byDir.has(d)) byDir.set(d, f.path); }
  return (imp) => {
    if (mod && (imp.spec === mod || imp.spec.startsWith(mod + '/'))) {
      const dir = imp.spec.slice(mod.length).replace(/^\//, '') || '.';
      return byDir.has(dir) ? { file: byDir.get(dir) } : { unresolved: imp.spec };
    }
    if (!imp.spec.split('/')[0].includes('.')) return { builtin: imp.spec.split('/')[0] };
    return { external: imp.spec.split('/').slice(0, 3).join('/') };
  };
}

function makeRustResolver(root, files, fileSet) {
  const crateSrc = (from) => {
    let dir = path.posix.dirname(from);
    while (true) {
      if (fileSet.has(dir + '/lib.rs') || fileSet.has(dir + '/main.rs')) return dir;
      if (!dir.includes('/')) return dir === '.' ? '' : dir;
      dir = dir.slice(0, dir.lastIndexOf('/'));
    }
  };
  const modFile = (segs, base) => {
    for (let n = segs.length; n >= 1; n--) {
      const p = path.posix.join(base, ...segs.slice(0, n));
      for (const c of [p + '.rs', p + '/mod.rs']) if (fileSet.has(c)) return c;
    }
    return null;
  };
  return (imp, from) => {
    const segs = imp.spec.split('::').filter(Boolean);
    const first = segs[0];
    const fromDir = path.posix.dirname(from);
    if (first === 'crate') { const hit = modFile(segs.slice(1), crateSrc(from)); return hit ? { file: hit } : { unresolved: imp.spec }; }
    if (first === 'self' || first === 'super') {
      const modDir = /(^|\/)(mod|lib|main)\.rs$/.test(from) ? fromDir : fromDir + '/' + path.posix.basename(from, '.rs');
      const base = first === 'self' ? modDir : path.posix.dirname(modDir);
      const hit = modFile(segs.slice(1).filter((s) => s !== 'super'), base) || (fileSet.has(path.posix.join(fromDir, segs[1] + '.rs')) ? path.posix.join(fromDir, segs[1] + '.rs') : null);
      return hit && hit !== from ? { file: hit } : { unresolved: imp.spec };
    }
    if (['std', 'core', 'alloc'].includes(first)) return { builtin: first };
    return { external: first };
  };
}

function makeSuffixResolver(files, lang, sep, ext, builtinRe) {
  const list = files.filter((f) => f.lang === lang);
  return (imp) => {
    const parts = imp.spec.split(sep);
    if (builtinRe && builtinRe.test(imp.spec)) return { builtin: parts[0] };
    for (let drop = 0; drop < parts.length - 1; drop++) {
      const tail = parts.slice(drop).join('/');
      const hit = list.find((f) => f.path.toLowerCase().endsWith('/' + tail.toLowerCase() + (ext || '')) || f.path.toLowerCase() === tail.toLowerCase() + (ext || ''))
        || (ext ? null : list.find((f) => path.posix.dirname(f.path).toLowerCase().endsWith(tail.toLowerCase())));
      if (hit) return { file: hit.path };
    }
    return { external: parts.slice(0, 2).join('.') };
  };
}

// ---------- Hauptfunktion ----------

export function scanDirectory(root, opts = {}) {
  root = path.resolve(root);
  const all = collectFiles(root, opts);
  const files = all.filter((f) => opts.includeTests || !f.isTest);
  const fileSet = new Set(files.map((f) => f.path));
  const skippedTests = all.length - files.length;

  // erster Durchgang: Text lesen, Importe sammeln
  const parsed = [];
  for (const f of files) {
    let text = '';
    try {
      const st = fs.statSync(f.abs);
      if (st.size > 1_500_000) { f.loc = 0; parsed.push({ f, imps: [] }); continue; }
      text = fs.readFileSync(f.abs, 'utf8');
    } catch { continue; }
    f.loc = text.split('\n').length;
    f.doc = firstDoc(text, f.lang);
    f.sym = extractSymbols(text, f.lang);
    let imps = [];
    if (f.lang === 'js') imps = importsJs(text);
    else if (f.lang === 'py') imps = importsPy(text);
    else if (f.lang === 'java') { const r = importsJava(text); imps = r.found; f.pkg = r.pkg; }
    else if (f.lang === 'go') imps = importsGo(text);
    else if (f.lang === 'rs') imps = importsRs(text);
    else if (f.lang === 'php') imps = importsPhp(text);
    else if (f.lang === 'cs') { const r = importsCs(text); imps = r.found; f.pkg = r.pkg; }
    parsed.push({ f, imps });
  }

  const resolvers = {
    js: makeJsResolver(root, files, fileSet),
    py: makePyResolver(files, fileSet),
    java: makeJavaResolver(files),
    go: makeGoResolver(root, files),
    rs: makeRustResolver(root, files, fileSet),
    php: makeSuffixResolver(files, 'php', '\\', '.php', null),
    cs: makeNamespaceResolver(files, 'cs', /^(System|Microsoft)(\.|$)/),
  };

  const edges = []; // Datei -> Datei
  const externals = []; // Datei -> Paket
  for (const { f, imps } of parsed) {
    for (const imp of imps) {
      const r = resolvers[f.lang](imp, f.path);
      for (const x of Array.isArray(r) ? r : [r]) {
        if (x.file) { if (x.file !== f.path) edges.push({ from: f.path, to: x.file, line: imp.line, kind: imp.kind }); }
        else if (x.external) externals.push({ from: f.path, name: x.external, line: imp.line });
      }
    }
  }
  const langCount = {};
  for (const f of files) langCount[f.lang] = (langCount[f.lang] || 0) + 1;
  return { root, files: files.map(({ path: p, lang, loc, doc, sym }) => ({ path: p, lang, loc: loc || 0, doc: doc || '', sym: sym || [] })), edges, externals, skippedTests, langCount };
}

// ---------- Symbole (Funktionen, Klassen, Schnittstellen, Typen, Schemas) ----------
// Muster statt Parser: gut genug für Orientierung. Ergebnis je Symbol: n=Name, k=Art, l=Zeile, s=Signatur, x=exportiert, m=Mitglieder [[name, sig]]
const clip = (s, n = 110) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
function blockAt(code, open) {
  let d = 0;
  for (let i = open; i < code.length; i++) {
    const c = code[i];
    if (c === '{') d++;
    else if (c === '}') { d--; if (!d) return code.slice(open + 1, i); }
  }
  return code.slice(open + 1, open + 3000);
}
/** Zeilen einer Klammer-Ebene (nur oberste Ebene des Blocks) */
function topLines(body) {
  const out = []; let d = 0;
  for (const line of body.split('\n')) {
    if (d === 0 && line.trim()) out.push(line);
    for (const c of line) { if (c === '{' || c === '(' || c === '[') d++; else if (c === '}' || c === ')' || c === ']') d--; }
    if (d < 0) d = 0;
  }
  return out;
}
const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'return', 'catch', 'function', 'else', 'try', 'new', 'await', 'typeof', 'throw']);

function symsJs(text) {
  const code = stripComments(text);
  const out = [];
  const add = (s) => { if (out.length < 40) out.push(s); };
  const at = (m) => lineOf(code, m.index);
  const members = (open, kind) => {
    const res = [];
    for (const line of topLines(blockAt(code, open))) {
      let m;
      if (kind === 'class') {
        if (/\b(private|#)/.test(line.split('(')[0])) continue;
        m = line.match(/^\s*(?:(?:public|protected|static|async|readonly|abstract|override|get|set)\s+)*(\w+)\s*(?:<[^>]*>)?\s*(\([^)]*\))\s*(?::\s*([^{;]+))?/);
        if (m && !KEYWORDS.has(m[1]) && !m[1].startsWith('_')) res.push([m[1], clip(`${m[1]}${m[2]}${m[3] ? ': ' + m[3] : ''}`, 90)]);
      } else if (kind === 'schema') {
        m = line.match(/^\s*(\w+)\s*:\s*(.*?),?\s*$/);
        if (m) res.push([m[1], clip(m[2], 60)]);
      } else if (kind === 'enum') {
        for (const part of line.split(',')) { const n = part.trim().split(/\s*=/)[0]; if (/^\w+$/.test(n)) res.push([n, '']); }
      } else {
        m = line.match(/^\s*(?:readonly\s+)?(\w+)\s*(\??)\s*([(:<].*)$/);
        if (m && !KEYWORDS.has(m[1])) res.push([m[1], clip(`${m[1]}${m[2]}${m[3]}`.replace(/[;,]\s*$/, ''), 90)]);
      }
      if (res.length >= 24) break;
    }
    return res;
  };
  let re = /^(export\s+)?(?:default\s+)?(?:declare\s+)?(?:(?:async)\s+)?function\*?\s+(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)\s*(?::\s*([^{;=\n]+))?/gm, m;
  while ((m = re.exec(code))) add({ n: m[2], k: 'fn', l: at(m), s: clip(`${m[2]}(${m[3]})${m[4] ? ': ' + m[4] : ''}`), x: m[1] ? 1 : 0 });
  re = /^(export\s+)?const\s+(\w+)\s*(?::[^=\n]+)?=\s*(?:async\s*)?(?:\(([^)]*)\)|(\w+))\s*(?::\s*[^=\n]+)?=>/gm;
  while ((m = re.exec(code))) add({ n: m[2], k: 'fn', l: at(m), s: clip(`${m[2]}(${m[3] ?? m[4] ?? ''})`), x: m[1] ? 1 : 0 });
  re = /^(export\s+)?const\s+(\w+)\s*=\s*z\s*\.\s*object\s*\(\s*\{/gm;
  while ((m = re.exec(code))) add({ n: m[2], k: 'schema', l: at(m), s: 'z.object', x: m[1] ? 1 : 0, m: members(m.index + m[0].length - 1, 'schema') });
  re = /^(export\s+)?const\s+(\w+)\s*=\s*z\s*\.\s*(enum|union|string|number|array|discriminatedUnion|literal|record)\b([^\n]{0,70})/gm;
  while ((m = re.exec(code))) add({ n: m[2], k: 'schema', l: at(m), s: clip(`z.${m[3]}${m[4]}`, 80), x: m[1] ? 1 : 0 });
  re = /^(export\s+)?(?:declare\s+)?interface\s+(\w+)(?:<[^>{]*>)?(?:\s+extends\s+([^{]+))?\s*\{/gm;
  while ((m = re.exec(code))) add({ n: m[2], k: 'iface', l: at(m), s: m[3] ? `extends ${clip(m[3], 60)}` : '', x: m[1] ? 1 : 0, m: members(m.index + m[0].length - 1, 'iface') });
  re = /^(export\s+)?(?:declare\s+)?type\s+(\w+)(?:<[^>=]*>)?\s*=\s*([^\n]*)/gm;
  while ((m = re.exec(code))) {
    const braced = m[3].trim().startsWith('{');
    add({ n: m[2], k: 'type', l: at(m), s: braced ? '' : clip(m[3], 90), x: m[1] ? 1 : 0, m: braced ? members(m.index + m[0].indexOf('{', m[0].indexOf('=')), 'iface') : undefined });
  }
  re = /^(export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+(\w+)([^{\n]*)\{/gm;
  while ((m = re.exec(code))) add({ n: m[2], k: 'class', l: at(m), s: clip(m[3], 70), x: m[1] ? 1 : 0, m: members(m.index + m[0].length - 1, 'class') });
  re = /^(export\s+)?(?:declare\s+)?(?:const\s+)?enum\s+(\w+)\s*\{/gm;
  while ((m = re.exec(code))) add({ n: m[2], k: 'enum', l: at(m), s: '', x: m[1] ? 1 : 0, m: members(m.index + m[0].length - 1, 'enum') });
  return out.sort((a, b) => a.l - b.l);
}

function symsPy(text) {
  const code = stripComments(text, 'py');
  const out = []; let m;
  const reC = /^class\s+(\w+)\s*(?:\(([^)]*)\))?\s*:/gm;
  while ((m = reC.exec(code))) {
    const rest = code.slice(m.index + m[0].length);
    const end = rest.search(/\n\S/);
    const body = end < 0 ? rest : rest.slice(0, end);
    const ms = []; let q; const reM = /^[ \t]+(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)\s*(?:->\s*([^:\n]+))?:/gm;
    while ((q = reM.exec(body)) && ms.length < 24) if (!q[1].startsWith('_') || q[1] === '__init__') ms.push([q[1], clip(`${q[1]}(${q[2]})${q[3] ? ' -> ' + q[3] : ''}`, 90)]);
    out.push({ n: m[1], k: /Protocol|ABC|Interface/.test(m[2] || '') ? 'iface' : 'class', l: lineOf(code, m.index), s: clip(m[2] || '', 60), x: m[1].startsWith('_') ? 0 : 1, m: ms });
  }
  const reF = /^(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)\s*(?:->\s*([^:\n]+))?:/gm;
  while ((m = reF.exec(code))) out.push({ n: m[1], k: 'fn', l: lineOf(code, m.index), s: clip(`${m[1]}(${m[2]})${m[3] ? ' -> ' + m[3] : ''}`), x: m[1].startsWith('_') ? 0 : 1 });
  return out.sort((a, b) => a.l - b.l).slice(0, 40);
}

function symsGo(text) {
  const code = stripComments(text);
  const out = []; let m;
  const reI = /^type\s+(\w+)\s+interface\s*\{/gm;
  while ((m = reI.exec(code))) {
    const ms = topLines(blockAt(code, m.index + m[0].length - 1)).map((l) => l.trim().match(/^(\w+)\s*(\(.*)$/)).filter(Boolean).slice(0, 24).map((q) => [q[1], clip(q[1] + q[2], 90)]);
    out.push({ n: m[1], k: 'iface', l: lineOf(code, m.index), s: '', x: /^[A-Z]/.test(m[1]) ? 1 : 0, m: ms });
  }
  const reS = /^type\s+(\w+)\s+struct\b/gm;
  while ((m = reS.exec(code))) out.push({ n: m[1], k: 'class', l: lineOf(code, m.index), s: '', x: /^[A-Z]/.test(m[1]) ? 1 : 0 });
  const reF = /^func\s+(?:\(([^)]*)\)\s*)?(\w+)\s*\(([^)]*)\)\s*([^{\n]*)/gm;
  while ((m = reF.exec(code))) out.push({ n: m[2], k: 'fn', l: lineOf(code, m.index), s: clip(`${m[1] ? '(' + m[1] + ') ' : ''}${m[2]}(${m[3]}) ${m[4]}`), x: /^[A-Z]/.test(m[2]) ? 1 : 0 });
  return out.sort((a, b) => a.l - b.l).slice(0, 40);
}

function symsGeneric(text) {
  const code = stripComments(text);
  const out = []; let m;
  const re = /^[ \t]*((?:(?:public|private|protected|internal|abstract|final|open|data|sealed|static|pub|export)\s+)*)(class|interface|enum|record|struct|trait|object)\s+(\w+)[^{\n]*(\{)?/gm;
  while ((m = re.exec(code))) {
    const iface = m[2] === 'interface' || m[2] === 'trait';
    let ms;
    if (iface && m[4]) ms = topLines(blockAt(code, m.index + m[0].length - 1)).map((l) => l.match(/(\w+)\s*\(([^)]*)\)/)).filter((q) => q && !KEYWORDS.has(q[1])).slice(0, 24).map((q) => [q[1], clip(`${q[1]}(${q[2]})`, 90)]);
    out.push({ n: m[3], k: iface ? 'iface' : m[2] === 'enum' ? 'enum' : 'class', l: lineOf(code, m.index), s: '', x: /private/.test(m[1]) ? 0 : 1, m: ms });
  }
  return out.slice(0, 40);
}

export function extractSymbols(text, lang) {
  try {
    if (lang === 'js') return symsJs(text);
    if (lang === 'py') return symsPy(text);
    if (lang === 'go') return symsGo(text);
    return symsGeneric(text);
  } catch { return []; }
}
