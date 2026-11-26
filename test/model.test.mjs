import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanDirectory } from '../src/scan.mjs';
import { buildModel } from '../src/model.mjs';
import { snippetToScan } from '../src/snippet.mjs';
import { renderHtml } from '../src/render.mjs';

function fixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codemap-'));
  for (const [p, body] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); fs.writeFileSync(path.join(dir, p), body); }
  return dir;
}

const base = {
  'src/entrypoints/http/server.ts': "import { Orders } from '../../modules/orders/service';\nimport { fail } from '../../contracts/fault';\n",
  'src/modules/orders/service.ts': "import type { OrderStore } from '../../contracts/order-store';\nimport { fail } from '../../contracts/fault';\n",
  'src/modules/billing/service.ts': "import { fail } from '../../contracts/fault';\n",
  'src/modules/shipping/service.ts': "import { fail } from '../../contracts/fault';\n",
  'src/contracts/order-store.ts': 'export interface OrderStore {}\n',
  'src/contracts/fault.ts': 'export function fail() {}\n',
  'src/adapters/postgres/store.ts': "import type { OrderStore } from '../../contracts/order-store';\nimport pg from 'pg';\n",
  'src/runtime/main.ts': "import './../adapters/postgres/store';\n",
};

test('Rollen werden aus Ordnern erkannt und Fehlerbehandlung wird Querschnitt', () => {
  const m = buildModel(scanDirectory(fixture(base)), { name: 't' });
  const role = (label) => m.units.find((u) => u.label === label)?.role;
  assert.equal(role('Http'), 'entrypoint');
  assert.equal(role('Orders'), 'core');
  assert.equal(role('Postgres'), 'adapter');
  assert.equal(role('Fehlerbehandlung & Diagnose'), 'crosscut');
  assert.equal(m.issues.filter((i) => i.cls === 'violation').length, 0);
  assert.deepEqual(m.units.find((u) => u.label === 'Postgres').ext, [['pg', 1]]);
});

test('Fachlogik, die einen Adapter importiert, ist ein Regelverstoß', () => {
  const dir = fixture({ ...base, 'src/modules/orders/bad.ts': "import { x } from '../../adapters/postgres/store';\n" });
  const m = buildModel(scanDirectory(dir), { name: 't' });
  const v = m.issues.filter((i) => i.cls === 'violation');
  assert.equal(v.length, 1);
  assert.match(v[0].why, /nach außen/);
  assert.equal(v[0].samples[0].line, 1);
});

test('Testdateien zählen nicht, Typ-Importe und Re-Exports werden aufgelöst', () => {
  const dir = fixture({ ...base, 'src/modules/orders/service.test.ts': "import '../../adapters/postgres/store';\n", 'src/modules/billing/index.ts': "export * from './service';\n" });
  const sc = scanDirectory(dir);
  assert.equal(sc.files.some((f) => f.path.endsWith('.test.ts')), false);
  assert.ok(sc.edges.some((e) => e.from.endsWith('billing/index.ts') && e.to.endsWith('billing/service.ts') && e.kind === 'reexport'));
  assert.ok(sc.edges.some((e) => e.kind === 'type'));
});

test('Schnipsel-Modus: Deklarationen werden Bausteine, Namensendung bestimmt die Rolle', () => {
  const code = "class OrderRepository {}\nclass PgOrderAdapter { run(r: OrderRepository) {} }\nfunction handleOrder(a: PgOrderAdapter) {}\nclass OrderController { x(h = handleOrder) {} }\n";
  const m = buildModel(snippetToScan(code, 'js', 'x.ts'), { name: 'x' });
  const roles = Object.fromEntries(m.units.map((u) => [u.label, u.role]));
  assert.equal(roles.OrderRepository, 'port');
  assert.equal(roles.PgOrderAdapter, 'adapter');
  assert.equal(roles.OrderController, 'entrypoint');
  assert.ok(m.edges.some((e) => e.cls === 'ok' || e.cls === 'warn'));
});

test('Python: relative und absolute Importe werden aufgelöst', () => {
  const dir = fixture({ 'app/routes/users.py': 'from ..services import users\nimport os\n', 'app/services/users.py': 'from app.db import session\n', 'app/db/session.py': 'import sqlalchemy\n', 'app/services/__init__.py': '' });
  const sc = scanDirectory(dir);
  assert.ok(sc.edges.some((e) => e.from === 'app/routes/users.py' && e.to === 'app/services/users.py'));
  assert.ok(sc.edges.some((e) => e.from === 'app/services/users.py' && e.to === 'app/db/session.py'));
  assert.ok(sc.externals.some((e) => e.name === 'sqlalchemy'));
});

test('Ausgabe ist eine einzige Datei ohne externe Ressourcen', () => {
  const m = buildModel(scanDirectory(fixture(base)), { name: 't' });
  const html = renderHtml(m);
  assert.doesNotMatch(html, /(src|href)="https?:/);
  assert.match(html, /<script type="application\/json" id="data">/);
  assert.equal(renderHtml(m, { fragment: true }).startsWith('<title>'), true);
});
