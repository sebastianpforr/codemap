import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanDirectory, extractSymbols } from '../src/scan.mjs';
import { buildModel } from '../src/model.mjs';
import { renderHtml } from '../src/render.mjs';

test('Symbole: Interface-Mitglieder, Zod-Schema, Klasse und Python', () => {
  const ts = "export interface OrderStore {\n  save(order: Order): Promise<void>;\n  find(id: string): Order | null;\n}\nexport const Tenant = z.object({\n  id: z.string(),\n  name: z.string().min(1),\n});\nexport class Repo {\n  private x = 1;\n  async load(id: string): Promise<Order> { return null as any; }\n}\nexport function make(a: number): string { return ''; }\n";
  const sy = Object.fromEntries(extractSymbols(ts, 'js').map((x) => [x.n, x]));
  assert.deepEqual(sy.OrderStore.m.map((m) => m[0]), ['save', 'find']);
  assert.equal(sy.OrderStore.k, 'iface');
  assert.deepEqual(sy.Tenant.m.map((m) => m[0]), ['id', 'name']);
  assert.equal(sy.Tenant.k, 'schema');
  assert.deepEqual(sy.Repo.m.map((m) => m[0]), ['load']);
  assert.equal(sy.make.s, 'make(a: number): string');
  const py = extractSymbols("class Store(Protocol):\n    def save(self, o: Order) -> None: ...\n\ndef helper(x):\n    return x\n", 'py');
  assert.equal(py.find((x) => x.n === 'Store').k, 'iface');
  assert.deepEqual(py.find((x) => x.n === 'Store').m.map((m) => m[0]), ['save']);
});

test('Dateien tragen Verbindungen und Symbole im Modell', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codemap-'));
  const put = (p, b) => { fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); fs.writeFileSync(path.join(dir, p), b); };
  put('src/modules/orders/service.ts', "import type { OrderStore } from '../../contracts/store';\nexport function place() {}\n");
  put('src/contracts/store.ts', 'export interface OrderStore { save(): void }\n');
  put('src/adapters/pg/store.ts', "import type { OrderStore } from '../../contracts/store';\n");
  const m = buildModel(scanDirectory(dir), { name: 't' });
  const orders = m.units.find((u) => u.label === 'Orders');
  assert.equal(orders.files[0].out[0][1], 1);
  assert.ok(orders.files[0].sym.some((x) => x.n === 'place' && x.x === 1));
  const contracts = m.units.find((u) => u.role === 'port');
  assert.ok(contracts.files[0].in.length >= 1);
});

test('Viewer enthält Chat, Innenansicht und keine externen Ressourcen', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codemap-'));
  fs.mkdirSync(path.join(dir, 'src/modules/a'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src/modules/a/x.ts'), 'export const a = 1;\n');
  const html = renderHtml(buildModel(scanDirectory(dir), { name: 't' }), { fragment: true });
  assert.match(html, /id="chat"/);
  assert.match(html, /use\('sample'\)/);
  assert.doesNotMatch(html, /(src|href)="https?:/);
  assert.doesNotMatch(html, /\bfetch\(/);
});
