import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanDirectory } from '../src/scan.mjs';
import { buildModel } from '../src/model.mjs';

// Je Sprache ein kleines Hexagon: Fachmodul (billing) -> Port (contracts) <- Adapter (stripe), plus eine externe Bibliothek im Adapter.
// Geprüft wird, was jede Sprache zusagt: Verweise zwischen Dateien, Rollen aus Ordnern, Symbole, externe Pakete.
const LANGS = {
  ts: {
    files: {
      'src/modules/billing/service.ts': "import { PaymentPort } from '../../contracts/payment';\nexport class Billing { constructor(p: PaymentPort) {} }\n",
      'src/contracts/payment.ts': 'export interface PaymentPort { pay(): void }\n',
      'src/adapters/stripe/client.ts': "import Stripe from 'stripe';\nimport type { PaymentPort } from '../../contracts/payment';\nexport class StripeAdapter implements PaymentPort { pay() {} }\n",
    },
    external: 'stripe', symbols: ['Billing', 'PaymentPort', 'StripeAdapter'],
  },
  py: {
    files: {
      'app/__init__.py': '',
      'app/modules/billing/service.py': 'from app.contracts.payment_port import PaymentPort\n\nclass Billing:\n    def charge(self, p: PaymentPort): pass\n',
      'app/contracts/payment_port.py': 'class PaymentPort:\n    def pay(self): ...\n',
      'app/adapters/stripe/client.py': 'import requests\nfrom app.contracts.payment_port import PaymentPort\n\nclass StripeAdapter(PaymentPort): pass\n',
    },
    external: 'requests', symbols: ['Billing', 'PaymentPort', 'StripeAdapter'],
  },
  go: {
    files: {
      'go.mod': 'module example.com/shop\n',
      'internal/modules/billing/service.go': 'package billing\n\nimport "example.com/shop/internal/contracts"\n\nfunc Charge(p contracts.PaymentPort) {}\n',
      'internal/contracts/payment.go': 'package contracts\n\ntype PaymentPort interface { Pay() }\n',
      'internal/adapters/stripe/client.go': 'package stripe\n\nimport (\n\t"github.com/stripe/stripe-go/v76"\n\t"example.com/shop/internal/contracts"\n)\n\ntype A struct{}\n',
    },
    external: 'github.com/stripe/stripe-go', symbols: ['Charge', 'PaymentPort'],
  },
  java: {
    files: {
      'src/main/java/com/shop/modules/billing/Billing.java': 'package com.shop.modules.billing;\n\nimport com.shop.contracts.PaymentPort;\n\npublic class Billing { PaymentPort p; }\n',
      'src/main/java/com/shop/contracts/PaymentPort.java': 'package com.shop.contracts;\n\npublic interface PaymentPort { void pay(); }\n',
      'src/main/java/com/shop/adapters/stripe/StripeAdapter.java': 'package com.shop.adapters.stripe;\n\nimport com.shop.contracts.PaymentPort;\nimport com.stripe.Stripe;\n\npublic class StripeAdapter implements PaymentPort { public void pay() {} }\n',
    },
    external: 'com.stripe.Stripe'.split('.').slice(0, 3).join('.'), symbols: ['Billing', 'PaymentPort', 'StripeAdapter'],
  },
  kt: {
    files: {
      'src/modules/billing/Billing.kt': 'package shop.modules.billing\n\nimport shop.contracts.PaymentPort\n\nclass Billing(val p: PaymentPort)\n',
      'src/contracts/PaymentPort.kt': 'package shop.contracts\n\ninterface PaymentPort { fun pay() }\n',
      'src/adapters/Stripe.kt': 'package shop.adapters\n\nimport shop.contracts.PaymentPort\n\nclass Stripe : PaymentPort { override fun pay() {} }\n',
    },
    external: null, symbols: ['Billing', 'PaymentPort', 'Stripe'],
  },
  rs: {
    files: {
      'src/main.rs': 'pub mod modules;\npub mod adapters;\npub mod contracts;\nfn main() {}\n',
      'src/modules/mod.rs': 'pub mod billing;\n',
      'src/modules/billing/mod.rs': 'use crate::contracts::PaymentPort;\n\npub fn charge(_p: &dyn PaymentPort) {}\n',
      'src/adapters/mod.rs': 'pub mod stripe;\n',
      'src/adapters/stripe.rs': 'use crate::contracts::PaymentPort;\nuse reqwest::Client;\n\npub struct A;\n',
      'src/contracts/mod.rs': 'pub trait PaymentPort { fn pay(&self); }\n',
    },
    external: 'reqwest', symbols: ['PaymentPort'],
  },
  php: {
    files: {
      'src/Modules/Billing/Billing.php': '<?php\nnamespace App\\Modules\\Billing;\n\nuse App\\Contracts\\PaymentPort;\n\nclass Billing {}\n',
      'src/Contracts/PaymentPort.php': '<?php\nnamespace App\\Contracts;\n\ninterface PaymentPort {}\n',
      'src/Adapters/Stripe.php': '<?php\nnamespace App\\Adapters;\n\nuse App\\Contracts\\PaymentPort;\nuse GuzzleHttp\\Client;\n\nclass Stripe implements PaymentPort {}\n',
    },
    external: 'GuzzleHttp', symbols: ['Billing', 'PaymentPort', 'Stripe'],
  },
  cs: {
    files: {
      'Shop/Modules/Billing/Billing.cs': 'using Shop.Contracts;\nusing Newtonsoft.Json;\n\nnamespace Shop.Modules.Billing\n{\n    public class Billing\n    {\n        private readonly IPaymentPort _port;\n    }\n}\n',
      'Shop/Contracts/IPaymentPort.cs': 'namespace Shop.Contracts;\n\npublic interface IPaymentPort\n{\n    void Pay();\n}\n',
      'Shop/Adapters/Stripe.cs': 'using Shop.Contracts;\n\nnamespace Shop.Adapters\n{\n    public class Stripe : IPaymentPort\n    {\n        public void Pay() { }\n    }\n}\n',
    },
    external: 'Newtonsoft.Json', symbols: ['Billing', 'IPaymentPort', 'Stripe'],
  },
};

function write(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codemap-lang-'));
  for (const [p, body] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); fs.writeFileSync(path.join(dir, p), body); }
  return dir;
}

for (const [lang, spec] of Object.entries(LANGS)) {
  test(`${lang}: Verweise, Rollen, Symbole und externe Pakete`, () => {
    const scan = scanDirectory(write(spec.files));
    const m = buildModel(scan, { name: lang });
    const role = (label) => m.units.find((u) => u.label.toLowerCase().startsWith(label))?.role;
    assert.equal(role('billing'), 'core', 'Fachmodul erkannt');
    assert.equal(m.units.find((u) => u.role === 'port')?.id.split('|').at(-1).toLowerCase(), 'contracts', 'Port erkannt');
    assert.ok(m.units.some((u) => u.role === 'adapter'), 'Adapter erkannt');
    const toPort = m.edges.filter((e) => m.units.find((u) => u.id === e.to)?.role === 'port');
    assert.ok(toPort.length >= 2, `Fachmodul und Adapter zeigen auf den Port (${toPort.length})`);
    assert.equal(m.issues.filter((i) => i.cls === 'violation').length, 0, 'kein Regelverstoß in einem sauberen Hexagon');
    const names = new Set(scan.files.flatMap((f) => f.sym.map((s) => s.n)));
    for (const s of spec.symbols) assert.ok(names.has(s), `Symbol ${s} gefunden (gefunden: ${[...names].join(', ')})`);
    if (spec.external) assert.ok(scan.externals.some((x) => x.name.startsWith(spec.external)), `externes Paket ${spec.external}`);
  });
}

test('nicht unterstützte Sprache liefert leeres Ergebnis statt Absturz', () => {
  const scan = scanDirectory(write({ 'app/models/a.rb': 'class A; end\n' }));
  assert.equal(scan.files.length, 0);
});
