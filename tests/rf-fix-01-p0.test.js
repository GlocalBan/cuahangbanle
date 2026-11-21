'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../server.js');
const { createRepositories } = require('../src/server/dal/repositories.js');
const { WarehouseService, computeWeightedAverageCost } = require('../src/server/bll/warehouseService.js');
const { CatalogService } = require('../src/server/bll/catalogService.js');
const { SalesService } = require('../src/server/bll/salesService.js');

async function startTestServer() {
  const server = createServer({ dbPath: ':memory:' });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  async function reqJson(method, urlPath, { token = '', body = null } = {}) {
    const headers = { Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== null) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${baseUrl}${urlPath}`, {
      method,
      headers,
      body: body !== null ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: res.status, data };
  }

  async function loginAs(username, password = '123456') {
    const r = await reqJson('POST', '/api/auth/login', { body: { username, password } });
    assert.equal(r.status, 200, `Login failed for ${username}: ${JSON.stringify(r.data)}`);
    return r.data.token;
  }

  function sumSalableBatches(productId) {
    const today = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
    const row = server.db
      .prepare(
        `SELECT COALESCE(SUM(qty_remaining), 0) AS qty
         FROM product_batches
         WHERE product_id = ?
           AND qty_remaining > 0
           AND status NOT IN ('HetHan', 'DaHuy', 'DaHet')
           AND (expiry_date = '' OR expiry_date > ?)`,
      )
      .get(productId, today);
    return Number(row?.qty) || 0;
  }

  function getProductRow(productId) {
    return server.db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
  }

  return {
    server,
    db: server.db,
    reqJson,
    loginAs,
    sumSalableBatches,
    getProductRow,
    close: () =>
      new Promise((resolve) => {
        server.close(() => {
          server.db.close();
          resolve();
        });
      }),
  };
}

function addDaysYmd(days) {
  const d = new Date(Date.now() + 7 * 3600000 + days * 86400000);
  return d.toISOString().slice(0, 10);
}

// ============================================================================
// F-01 REGRESSION SUITE (11 SCENARIOS)
// ============================================================================

test('P0-F01-01: Creating GRN against Draft, GuiNCC, Confirmed, or Cancelled PO is blocked (409)', async () => {
  const srv = await startTestServer();
  try {
    const kho = await srv.loginAs('kho');
    const quanly = await srv.loginAs('quanly');

    const poRes = await srv.reqJson('POST', '/api/purchases', {
      token: kho,
      body: {
        supplierId: 'NCC003',
        items: [{ productId: 'SP006', qty: 10, unitCost: 45000, expiryDate: addDaysYmd(180) }],
      },
    });
    assert.equal(poRes.status, 201);
    const poId = poRes.data.item.id;

    // Draft PO -> GRN must be blocked (409)
    const draftGrn = await srv.reqJson('POST', '/api/grns', {
      token: kho,
      body: {
        purchaseId: poId,
        items: [{ productId: 'SP006', receivedQty: 10, unitCost: 45000, expiryDate: addDaysYmd(180) }],
      },
    });
    assert.equal(draftGrn.status, 409);

    // Send to supplier (GuiNCC) -> GRN still blocked (409)
    assert.equal((await srv.reqJson('POST', `/api/purchases/${poId}/send`, { token: kho, body: {} })).status, 200);
    const sentGrn = await srv.reqJson('POST', '/api/grns', {
      token: kho,
      body: {
        purchaseId: poId,
        items: [{ productId: 'SP006', receivedQty: 10, unitCost: 45000, expiryDate: addDaysYmd(180) }],
      },
    });
    assert.equal(sentGrn.status, 409);

    // Direct confirm on a separate Draft PO -> GRN against Confirmed PO blocked (409)
    const po2 = await srv.reqJson('POST', '/api/purchases', {
      token: kho,
      body: {
        supplierId: 'NCC003',
        items: [{ productId: 'SP006', qty: 5, unitCost: 45000, expiryDate: addDaysYmd(180) }],
      },
    });
    assert.equal(po2.status, 201);
    assert.equal((await srv.reqJson('POST', `/api/purchases/${po2.data.item.id}/confirm`, { token: quanly })).status, 200);
    const confirmedGrn = await srv.reqJson('POST', '/api/grns', {
      token: kho,
      body: {
        purchaseId: po2.data.item.id,
        items: [{ productId: 'SP006', receivedQty: 5, unitCost: 45000, expiryDate: addDaysYmd(180) }],
      },
    });
    assert.equal(confirmedGrn.status, 409);

    // Cancelled PO -> GRN blocked (409)
    assert.equal((await srv.reqJson('POST', `/api/purchases/${poId}/cancel`, { token: quanly, body: { reason: 'Hủy' } })).status, 200);
    const cancelledGrn = await srv.reqJson('POST', '/api/grns', {
      token: kho,
      body: {
        purchaseId: poId,
        items: [{ productId: 'SP006', receivedQty: 5, unitCost: 45000, expiryDate: addDaysYmd(180) }],
      },
    });
    assert.equal(cancelledGrn.status, 409);

    // Zero GRNs created in DB
    assert.equal(srv.db.prepare('SELECT COUNT(*) AS c FROM purchase_receipts').get().c, 0);
  } finally {
    await srv.close();
  }
});

test('P0-F01-02: Valid PO + GRN posts stock, batch, and weighted average cost (WAC) exactly once', async () => {
  const srv = await startTestServer();
  try {
    const kho = await srv.loginAs('kho');
    const quanly = await srv.loginAs('quanly');
    const ncc = await srv.loginAs('ncc01');

    const before = srv.getProductRow('SP006');
    const batchesBefore = srv.sumSalableBatches('SP006');
    assert.equal(before.stock_qty, batchesBefore);

    const poRes = await srv.reqJson('POST', '/api/purchases', {
      token: kho,
      body: {
        supplierId: 'NCC003',
        items: [{ productId: 'SP006', qty: 10, unitCost: 20000, expiryDate: addDaysYmd(200) }],
      },
    });
    const poId = poRes.data.item.id;
    assert.equal((await srv.reqJson('POST', `/api/purchases/${poId}/send`, { token: kho, body: {} })).status, 200);
    assert.equal(
      (await srv.reqJson('POST', `/api/purchases/${poId}/respond`, { token: ncc, body: { action: 'ACCEPT' } })).status,
      200,
    );

    const grnRes = await srv.reqJson('POST', '/api/grns', {
      token: kho,
      body: {
        purchaseId: poId,
        items: [{ productId: 'SP006', receivedQty: 10, unitCost: 20000, expiryDate: addDaysYmd(200) }],
      },
    });
    assert.equal(grnRes.status, 201);
    const grnId = grnRes.data.item.id;

    // Direct PO confirm MUST be rejected once in GRN workflow (409)
    assert.equal((await srv.reqJson('POST', `/api/purchases/${poId}/confirm`, { token: quanly })).status, 409);

    // Confirm GRN by different actor (quanly)
    const conf = await srv.reqJson('POST', `/api/grns/${grnId}/confirm`, { token: quanly });
    assert.equal(conf.status, 200);

    const after = srv.getProductRow('SP006');
    const expectedWac = computeWeightedAverageCost(before.stock_qty, before.cost_price, 10, 20000);
    assert.equal(after.stock_qty, before.stock_qty + 10);
    assert.equal(srv.sumSalableBatches('SP006'), before.stock_qty + 10);
    assert.equal(after.cost_price, expectedWac);
    assert.equal(
      srv.db.prepare("SELECT COUNT(*) AS c FROM product_batches WHERE purchase_id = ?").get(poId).c,
      1,
      'Must create exactly 1 batch for the PO receipt',
    );
  } finally {
    await srv.close();
  }
});

test('P0-F01-03: AP payable recognized exactly once (200,000 VND, never 400,000 VND) and mutual exclusion holds even if DB has pending GRN', async () => {
  const srv = await startTestServer();
  try {
    const kho = await srv.loginAs('kho');
    const quanly = await srv.loginAs('quanly');
    const ncc = await srv.loginAs('ncc01');

    const poRes = await srv.reqJson('POST', '/api/purchases', {
      token: kho,
      body: {
        supplierId: 'NCC003',
        items: [{ productId: 'SP006', qty: 10, unitCost: 20000, expiryDate: addDaysYmd(200) }],
      },
    });
    const poId = poRes.data.item.id;
    await srv.reqJson('POST', `/api/purchases/${poId}/send`, { token: kho, body: {} });
    await srv.reqJson('POST', `/api/purchases/${poId}/respond`, { token: ncc, body: { action: 'ACCEPT' } });

    const grnRes = await srv.reqJson('POST', '/api/grns', {
      token: kho,
      body: {
        purchaseId: poId,
        items: [{ productId: 'SP006', receivedQty: 10, unitCost: 20000, expiryDate: addDaysYmd(200) }],
      },
    });
    assert.equal(grnRes.status, 201);
    assert.equal((await srv.reqJson('POST', `/api/grns/${grnRes.data.item.id}/confirm`, { token: quanly })).status, 200);

    const ap = srv.db
      .prepare('SELECT COUNT(*) AS cnt, COALESCE(SUM(total_amount), 0) AS total FROM supplier_payables WHERE purchase_id = ?')
      .get(poId);
    assert.equal(ap.cnt, 1);
    assert.equal(ap.total, 200000);

    // Adversarial: even if a legacy pending GRN row were forced in DB against an already-Confirmed PO, confirmGoodsReceipt must block it (409)
    const repos = createRepositories(srv.db);
    const legacyGrn = repos.supplierOps.createGrn(
      {
        purchase_id: poId,
        supplier_id: 'NCC003',
        received_by: repos.users.findByUsername('kho').id,
        total_received_amount: 200000,
        note: 'Simulated legacy orphan GRN',
      },
      [
        {
          product_id: 'SP006',
          ordered_qty: 10,
          received_qty: 10,
          rejected_qty: 0,
          unit_cost: 20000,
          expiry_date: addDaysYmd(200),
        },
      ],
    );
    const blocked = await srv.reqJson('POST', `/api/grns/${legacyGrn.id}/confirm`, { token: quanly });
    assert.equal(blocked.status, 409);

    const apAfter = srv.db
      .prepare('SELECT COUNT(*) AS cnt, COALESCE(SUM(total_amount), 0) AS total FROM supplier_payables WHERE purchase_id = ?')
      .get(poId);
    assert.equal(apAfter.cnt, 1);
    assert.equal(apAfter.total, 200000);
  } finally {
    await srv.close();
  }
});

test('P0-F01-04: Repeated direct PO confirmation returns 409 with zero duplicate stock or AP', async () => {
  const srv = await startTestServer();
  try {
    const kho = await srv.loginAs('kho');
    const quanly = await srv.loginAs('quanly');
    const before = srv.getProductRow('SP006').stock_qty;

    const poRes = await srv.reqJson('POST', '/api/purchases', {
      token: kho,
      body: {
        supplierId: 'NCC003',
        items: [{ productId: 'SP006', qty: 6, unitCost: 30000, expiryDate: addDaysYmd(150) }],
      },
    });
    const poId = poRes.data.item.id;
    assert.equal((await srv.reqJson('POST', `/api/purchases/${poId}/confirm`, { token: quanly })).status, 200);
    assert.equal((await srv.reqJson('POST', `/api/purchases/${poId}/confirm`, { token: quanly })).status, 409);

    assert.equal(srv.getProductRow('SP006').stock_qty, before + 6);
    assert.equal(srv.db.prepare('SELECT COUNT(*) AS c FROM supplier_payables WHERE purchase_id = ?').get(poId).c, 1);
  } finally {
    await srv.close();
  }
});

test('P0-F01-05: Repeated GRN confirmation returns 409 with zero duplicate stock, batch, or AP', async () => {
  const srv = await startTestServer();
  try {
    const kho = await srv.loginAs('kho');
    const quanly = await srv.loginAs('quanly');
    const ncc = await srv.loginAs('ncc01');
    const before = srv.getProductRow('SP006').stock_qty;

    const poId = (
      await srv.reqJson('POST', '/api/purchases', {
        token: kho,
        body: {
          supplierId: 'NCC003',
          items: [{ productId: 'SP006', qty: 8, unitCost: 40000, expiryDate: addDaysYmd(180) }],
        },
      })
    ).data.item.id;
    await srv.reqJson('POST', `/api/purchases/${poId}/send`, { token: kho, body: {} });
    await srv.reqJson('POST', `/api/purchases/${poId}/respond`, { token: ncc, body: { action: 'ACCEPT' } });

    const grnId = (
      await srv.reqJson('POST', '/api/grns', {
        token: kho,
        body: {
          purchaseId: poId,
          items: [{ productId: 'SP006', receivedQty: 4, unitCost: 40000, expiryDate: addDaysYmd(180) }],
        },
      })
    ).data.item.id;

    assert.equal((await srv.reqJson('POST', `/api/grns/${grnId}/confirm`, { token: quanly })).status, 200);
    assert.equal((await srv.reqJson('POST', `/api/grns/${grnId}/confirm`, { token: quanly })).status, 409);

    assert.equal(srv.getProductRow('SP006').stock_qty, before + 4);
    assert.equal(srv.db.prepare('SELECT COUNT(*) AS c FROM supplier_payables WHERE receipt_id = ?').get(grnId).c, 1);
  } finally {
    await srv.close();
  }
});

test('P0-F01-06: Partially received PO (DangNhanHang) cannot be cancelled into Cancelled (409) — preserves stock and AP', async () => {
  const srv = await startTestServer();
  try {
    const kho = await srv.loginAs('kho');
    const quanly = await srv.loginAs('quanly');
    const ncc = await srv.loginAs('ncc01');
    const before = srv.getProductRow('SP006').stock_qty;

    const poId = (
      await srv.reqJson('POST', '/api/purchases', {
        token: kho,
        body: {
          supplierId: 'NCC003',
          items: [{ productId: 'SP006', qty: 10, unitCost: 20000, expiryDate: addDaysYmd(180) }],
        },
      })
    ).data.item.id;
    await srv.reqJson('POST', `/api/purchases/${poId}/send`, { token: kho, body: {} });
    await srv.reqJson('POST', `/api/purchases/${poId}/respond`, { token: ncc, body: { action: 'ACCEPT' } });

    const grnId = (
      await srv.reqJson('POST', '/api/grns', {
        token: kho,
        body: {
          purchaseId: poId,
          items: [{ productId: 'SP006', receivedQty: 4, unitCost: 20000, expiryDate: addDaysYmd(180) }],
        },
      })
    ).data.item.id;
    assert.equal((await srv.reqJson('POST', `/api/grns/${grnId}/confirm`, { token: quanly })).status, 200);

    const cancelAttempt = await srv.reqJson('POST', `/api/purchases/${poId}/cancel`, {
      token: quanly,
      body: { reason: 'Cố tình hủy sau khi đã nhận 1 phần' },
    });
    assert.equal(cancelAttempt.status, 409);

    const poAfter = srv.db.prepare('SELECT status FROM purchases WHERE id = ?').get(poId);
    assert.equal(poAfter.status, 'DangNhanHang');
    assert.equal(srv.getProductRow('SP006').stock_qty, before + 4);
    const ap = srv.db.prepare('SELECT total_amount, status FROM supplier_payables WHERE purchase_id = ?').get(poId);
    assert.equal(ap.total_amount, 80000);
    assert.equal(ap.status, 'ChuaThanhToan');
  } finally {
    await srv.close();
  }
});

test('P0-F01-07: GuiNCC -> DaThongNhat unilateral store agreement blocked (409); allowed only after recorded supplier response (NCCPhanHoi)', async () => {
  const srv = await startTestServer();
  try {
    const kho = await srv.loginAs('kho');
    const quanly = await srv.loginAs('quanly');
    const ncc = await srv.loginAs('ncc01');

    const poId = (
      await srv.reqJson('POST', '/api/purchases', {
        token: kho,
        body: {
          supplierId: 'NCC003',
          items: [{ productId: 'SP006', qty: 10, unitCost: 45000, expiryDate: addDaysYmd(180) }],
        },
      })
    ).data.item.id;
    assert.equal((await srv.reqJson('POST', `/api/purchases/${poId}/send`, { token: kho, body: {} })).status, 200);

    // Unilateral agree from GuiNCC (zero supplier response) -> 409
    const bareAgree = await srv.reqJson('POST', `/api/purchases/${poId}/agree`, { token: quanly, body: {} });
    assert.equal(bareAgree.status, 409);
    assert.equal(srv.db.prepare('SELECT status FROM purchases WHERE id = ?').get(poId).status, 'GuiNCC');

    // Supplier counters (recorded SUPPLIER_COUNTER -> NCCPhanHoi)
    const counterRes = await srv.reqJson('POST', `/api/purchases/${poId}/respond`, {
      token: ncc,
      body: {
        action: 'COUNTER',
        note: 'Đề xuất 46.000đ',
        items: [{ productId: 'SP006', qty: 10, unitCost: 46000 }],
      },
    });
    assert.equal(counterRes.status, 200);
    assert.equal(counterRes.data.item.status, 'NCCPhanHoi');

    // Store sends counter (ThuongLuong) -> store cannot unilaterally agree its own unaccepted counter -> 409
    assert.equal(
      (
        await srv.reqJson('POST', `/api/purchases/${poId}/counter`, {
          token: quanly,
          body: { items: [{ productId: 'SP006', qty: 10, unitCost: 45500 }] },
        })
      ).status,
      200,
    );
    assert.equal((await srv.reqJson('POST', `/api/purchases/${poId}/agree`, { token: quanly, body: {} })).status, 409);

    // Supplier responds again with COUNTER -> NCCPhanHoi -> NOW store agree succeeds (200 -> DaThongNhat)
    assert.equal(
      (
        await srv.reqJson('POST', `/api/purchases/${poId}/respond`, {
          token: ncc,
          body: {
            action: 'COUNTER',
            note: 'Chốt giá 45.800đ',
            items: [{ productId: 'SP006', qty: 10, unitCost: 45800 }],
          },
        })
      ).status,
      200,
    );
    const validAgree = await srv.reqJson('POST', `/api/purchases/${poId}/agree`, {
      token: quanly,
      body: { note: 'Đồng ý giá 45.800đ từ NCC' },
    });
    assert.equal(validAgree.status, 200);
    assert.equal(validAgree.data.item.status, 'DaThongNhat');
  } finally {
    await srv.close();
  }
});

test('P0-F01-08: GRN self-approval is rejected (403 SoD); different approver succeeds (200)', async () => {
  const srv = await startTestServer();
  try {
    const kho = await srv.loginAs('kho');
    const quanly = await srv.loginAs('quanly');
    const admin = await srv.loginAs('admin');
    const ncc = await srv.loginAs('ncc01');

    const poId = (
      await srv.reqJson('POST', '/api/purchases', {
        token: kho,
        body: {
          supplierId: 'NCC003',
          items: [{ productId: 'SP006', qty: 6, unitCost: 45000, expiryDate: addDaysYmd(180) }],
        },
      })
    ).data.item.id;
    await srv.reqJson('POST', `/api/purchases/${poId}/send`, { token: kho, body: {} });
    await srv.reqJson('POST', `/api/purchases/${poId}/respond`, { token: ncc, body: { action: 'ACCEPT' } });

    // Manager creates GRN
    const grnRes = await srv.reqJson('POST', '/api/grns', {
      token: quanly,
      body: {
        purchaseId: poId,
        items: [{ productId: 'SP006', receivedQty: 6, unitCost: 45000, expiryDate: addDaysYmd(180) }],
      },
    });
    assert.equal(grnRes.status, 201);
    const grnId = grnRes.data.item.id;

    // Same actor (quanly) tries to confirm -> 403 Forbidden (SoD)
    const selfConfirm = await srv.reqJson('POST', `/api/grns/${grnId}/confirm`, { token: quanly });
    assert.equal(selfConfirm.status, 403);
    assert.equal(srv.db.prepare('SELECT status FROM purchase_receipts WHERE id = ?').get(grnId).status, 'ChoDuyet');

    // Different actor (admin) confirms -> 200
    const adminConfirm = await srv.reqJson('POST', `/api/grns/${grnId}/confirm`, { token: admin });
    assert.equal(adminConfirm.status, 200);
    assert.equal(adminConfirm.data.item.status, 'DaDuyet');
  } finally {
    await srv.close();
  }
});

test('P0-F01-09: Failed GRN posting rolls back 100% of stock, batches, WAC, movements, GRN status, PO status, and AP', async () => {
  const srv = await startTestServer();
  try {
    const repos = createRepositories(srv.db);
    const svc = new WarehouseService(srv.db, repos);
    const khoUser = repos.users.findByUsername('kho');
    const mgrUser = repos.users.findByUsername('quanly');
    const supUser = repos.users.findByUsername('ncc01');

    const po = svc.createPurchase(khoUser, {
      supplierId: 'NCC003',
      items: [{ productId: 'SP006', qty: 5, unitCost: 22000, expiryDate: addDaysYmd(200) }],
    });
    svc.sendPurchaseToSupplier(khoUser, po.id, {});
    svc.respondToPurchase(supUser, po.id, { action: 'ACCEPT' });
    const grn = svc.createGoodsReceipt(khoUser, {
      purchaseId: po.id,
      items: [{ productId: 'SP006', receivedQty: 5, unitCost: 22000, expiryDate: addDaysYmd(200) }],
    });

    const prodBefore = srv.getProductRow('SP006');
    const batchSumBefore = srv.sumSalableBatches('SP006');
    const movesBefore = srv.db.prepare('SELECT COUNT(*) AS c FROM stock_movements').get().c;
    const apBefore = srv.db.prepare('SELECT COUNT(*) AS c FROM supplier_payables').get().c;

    assert.throws(() => {
      svc.confirmGoodsReceipt(mgrUser, grn.id, {
        _beforeCommitHook: () => {
          throw new Error('Injected GRN failure mid-transaction');
        },
      });
    }, /Injected GRN failure mid-transaction/);

    assert.equal(srv.getProductRow('SP006').stock_qty, prodBefore.stock_qty);
    assert.equal(srv.getProductRow('SP006').cost_price, prodBefore.cost_price);
    assert.equal(srv.sumSalableBatches('SP006'), batchSumBefore);
    assert.equal(srv.db.prepare('SELECT COUNT(*) AS c FROM stock_movements').get().c, movesBefore);
    assert.equal(srv.db.prepare('SELECT COUNT(*) AS c FROM supplier_payables').get().c, apBefore);
    assert.equal(srv.db.prepare('SELECT status FROM purchase_receipts WHERE id = ?').get(grn.id).status, 'ChoDuyet');
    assert.equal(srv.db.prepare('SELECT status FROM purchases WHERE id = ?').get(po.id).status, 'DaThongNhat');
  } finally {
    await srv.close();
  }
});

test('P0-F01-10: Valid multi-shipment partial receiving works cleanly and blocks over-receiving', async () => {
  const srv = await startTestServer();
  try {
    const kho = await srv.loginAs('kho');
    const quanly = await srv.loginAs('quanly');
    const ncc = await srv.loginAs('ncc01');
    const before = srv.getProductRow('SP006').stock_qty;

    const poId = (
      await srv.reqJson('POST', '/api/purchases', {
        token: kho,
        body: {
          supplierId: 'NCC003',
          items: [{ productId: 'SP006', qty: 10, unitCost: 40000, expiryDate: addDaysYmd(180) }],
        },
      })
    ).data.item.id;
    await srv.reqJson('POST', `/api/purchases/${poId}/send`, { token: kho, body: {} });
    await srv.reqJson('POST', `/api/purchases/${poId}/respond`, { token: ncc, body: { action: 'ACCEPT' } });

    // Partial GRN 1: 4/10
    const g1 = await srv.reqJson('POST', '/api/grns', {
      token: kho,
      body: {
        purchaseId: poId,
        items: [{ productId: 'SP006', receivedQty: 4, unitCost: 40000, expiryDate: addDaysYmd(180) }],
      },
    });
    assert.equal(g1.status, 201);
    assert.equal((await srv.reqJson('POST', `/api/grns/${g1.data.item.id}/confirm`, { token: quanly })).status, 200);
    assert.equal(srv.db.prepare('SELECT status FROM purchases WHERE id = ?').get(poId).status, 'DangNhanHang');

    // Over-receive 7 (> remaining 6) blocked 400
    const over = await srv.reqJson('POST', '/api/grns', {
      token: kho,
      body: {
        purchaseId: poId,
        items: [{ productId: 'SP006', receivedQty: 7, unitCost: 40000, expiryDate: addDaysYmd(180) }],
      },
    });
    assert.equal(over.status, 400);

    // Partial GRN 2: remaining 6/10 -> PO becomes Confirmed
    const g2 = await srv.reqJson('POST', '/api/grns', {
      token: kho,
      body: {
        purchaseId: poId,
        items: [{ productId: 'SP006', receivedQty: 6, unitCost: 42000, expiryDate: addDaysYmd(200) }],
      },
    });
    assert.equal(g2.status, 201);
    assert.equal((await srv.reqJson('POST', `/api/grns/${g2.data.item.id}/confirm`, { token: quanly })).status, 200);
    assert.equal(srv.db.prepare('SELECT status FROM purchases WHERE id = ?').get(poId).status, 'Confirmed');

    assert.equal(srv.getProductRow('SP006').stock_qty, before + 10);
    assert.equal(srv.sumSalableBatches('SP006'), before + 10);
    const apTotal = srv.db.prepare('SELECT SUM(total_amount) AS t FROM supplier_payables WHERE purchase_id = ?').get(poId).t;
    assert.equal(apTotal, 4 * 40000 + 6 * 42000);
  } finally {
    await srv.close();
  }
});

test('P0-F01-11: Valid single-shipment full GRN receiving transitions DaThongNhat -> Confirmed cleanly', async () => {
  const srv = await startTestServer();
  try {
    const kho = await srv.loginAs('kho');
    const quanly = await srv.loginAs('quanly');
    const ncc = await srv.loginAs('ncc01');
    const before = srv.getProductRow('SP006').stock_qty;

    const poId = (
      await srv.reqJson('POST', '/api/purchases', {
        token: kho,
        body: {
          supplierId: 'NCC003',
          items: [{ productId: 'SP006', qty: 12, unitCost: 41000, expiryDate: addDaysYmd(240) }],
        },
      })
    ).data.item.id;
    await srv.reqJson('POST', `/api/purchases/${poId}/send`, { token: kho, body: {} });
    await srv.reqJson('POST', `/api/purchases/${poId}/respond`, { token: ncc, body: { action: 'ACCEPT' } });

    const g1 = await srv.reqJson('POST', '/api/grns', {
      token: kho,
      body: {
        purchaseId: poId,
        items: [{ productId: 'SP006', receivedQty: 12, unitCost: 41000, expiryDate: addDaysYmd(240) }],
      },
    });
    assert.equal(g1.status, 201);
    assert.equal((await srv.reqJson('POST', `/api/grns/${g1.data.item.id}/confirm`, { token: quanly })).status, 200);

    assert.equal(srv.db.prepare('SELECT status FROM purchases WHERE id = ?').get(poId).status, 'Confirmed');
    assert.equal(srv.getProductRow('SP006').stock_qty, before + 12);
    assert.equal(srv.sumSalableBatches('SP006'), before + 12);
    const ap = srv.db.prepare('SELECT total_amount FROM supplier_payables WHERE purchase_id = ?').get(poId);
    assert.equal(ap.total_amount, 12 * 41000);
  } finally {
    await srv.close();
  }
});

// ============================================================================
// F-02 REGRESSION SUITE (13 SCENARIOS)
// ============================================================================

test('P0-F02-01: Downward manual adjustment (154 -> 1) updates both products.stock_qty and product_batches atomically with full audit trail', async () => {
  const srv = await startTestServer();
  try {
    const quanly = await srv.loginAs('quanly');
    assert.equal(srv.getProductRow('SP001').stock_qty, 154);
    assert.equal(srv.sumSalableBatches('SP001'), 154);

    const adj = await srv.reqJson('POST', '/api/products/SP001/stock-adjust', {
      token: quanly,
      body: { newStock: 1, note: 'Điều chỉnh giảm theo kiểm đếm thực tế' },
    });
    assert.equal(adj.status, 200);
    assert.equal(adj.data.item.stockQty, 1);
    assert.equal(srv.getProductRow('SP001').stock_qty, 1);
    assert.equal(srv.sumSalableBatches('SP001'), 1);

    // Complete stock_movements audit trail including batch ref
    assert.equal(adj.data.movement.stockBefore, 154);
    assert.equal(adj.data.movement.delta, -153);
    assert.equal(adj.data.movement.stockAfter, 1);
    assert.equal(adj.data.movement.docType, 'DIEU_CHINH_TON');
    const mvRow = srv.db.prepare('SELECT * FROM stock_movements WHERE id = ?').get(adj.data.movement.id);
    assert.ok(mvRow.batch_code.length > 0, 'Movement must record affected batch code');
    assert.ok(mvRow.actor_id);
    assert.ok(mvRow.created_at);
  } finally {
    await srv.close();
  }
});

test('P0-F02-02: Upward manual adjustment (1 -> 200) creates canonical adjustment batch and synchronizes stock_qty & batches', async () => {
  const srv = await startTestServer();
  try {
    const quanly = await srv.loginAs('quanly');
    assert.equal(
      (
        await srv.reqJson('POST', '/api/products/SP001/stock-adjust', {
          token: quanly,
          body: { newStock: 1, note: 'Giảm về 1 trước khi tăng' },
        })
      ).status,
      200,
    );

    const up = await srv.reqJson('POST', '/api/products/SP001/stock-adjust', {
      token: quanly,
      body: { newStock: 200, note: 'Bổ sung hàng tồn thực tế 200' },
    });
    assert.equal(up.status, 200);
    assert.equal(up.data.item.stockQty, 200);
    assert.equal(srv.getProductRow('SP001').stock_qty, 200);
    assert.equal(srv.sumSalableBatches('SP001'), 200);
    assert.equal(up.data.movement.delta, 199);
    const mvRow = srv.db.prepare('SELECT * FROM stock_movements WHERE id = ?').get(up.data.movement.id);
    assert.match(mvRow.batch_code, /^ADJ-/);
  } finally {
    await srv.close();
  }
});

test('P0-F02-03: Batch-managed SKU adjustment targeting a specific batchId deducts/increments that exact batch', async () => {
  const srv = await startTestServer();
  try {
    const quanly = await srv.loginAs('quanly');
    const batches = srv.db
      .prepare("SELECT * FROM product_batches WHERE product_id = 'SP001' AND qty_remaining > 0 ORDER BY expiry_date ASC")
      .all();
    assert.ok(batches.length >= 1);
    const target = batches[0];
    const origQty = target.qty_remaining;

    const dec = await srv.reqJson('POST', '/api/products/SP001/stock-adjust', {
      token: quanly,
      body: { delta: -5, batchId: target.id, note: 'Giảm 5 đv trực tiếp trên lô chỉ định' },
    });
    assert.equal(dec.status, 200);
    assert.equal(srv.db.prepare('SELECT qty_remaining FROM product_batches WHERE id = ?').get(target.id).qty_remaining, origQty - 5);
    assert.equal(srv.getProductRow('SP001').stock_qty, srv.sumSalableBatches('SP001'));

    const inc = await srv.reqJson('POST', '/api/products/SP001/stock-adjust', {
      token: quanly,
      body: { delta: 3, batchId: target.id, note: 'Tăng lại 3 đv trên cùng lô' },
    });
    assert.equal(inc.status, 200);
    assert.equal(srv.db.prepare('SELECT qty_remaining FROM product_batches WHERE id = ?').get(target.id).qty_remaining, origQty - 2);
    assert.equal(srv.getProductRow('SP001').stock_qty, srv.sumSalableBatches('SP001'));
  } finally {
    await srv.close();
  }
});

test('P0-F02-04: Non-expiry (hasExpiry: false) SKU down/up adjustment and POS checkout stay 100% consistent (no 500, no fake expiry)', async () => {
  const srv = await startTestServer();
  try {
    const quanly = await srv.loginAs('quanly');
    const thungan = await srv.loginAs('thungan');
    const unit = srv.db.prepare("SELECT code FROM units WHERE status = 'HoatDong' LIMIT 1").get().code;

    const created = await srv.reqJson('POST', '/api/products', {
      token: quanly,
      body: {
        sku: 'SKU-NOEXP-P0',
        barcode: '8938888000442',
        name: 'Khăn giấy không hạn sử dụng P0',
        categoryCode: 'DM05',
        unitCode: unit,
        supplierId: 'NCC001',
        salePrice: 15000,
        costPrice: 10000,
        stockQty: 10,
        hasExpiry: false,
        imageUrl: 'assets/images/products/milk_vinamilk.jpg',
      },
    });
    assert.equal(created.status, 201);
    const pid = created.data.item.id;
    assert.equal(srv.getProductRow(pid).has_expiry, 0);
    assert.equal(srv.sumSalableBatches(pid), 10);
    const initBatch = srv.db.prepare('SELECT expiry_date FROM product_batches WHERE product_id = ?').get(pid);
    assert.equal(initBatch.expiry_date, '', 'Non-expiry SKU must NOT have a fabricated expiry date');

    // Down-adjust 10 -> 2
    assert.equal(
      (
        await srv.reqJson('POST', `/api/products/${pid}/stock-adjust`, {
          token: quanly,
          body: { newStock: 2, note: 'Giảm tồn SP không HSD xuống 2' },
        })
      ).status,
      200,
    );
    assert.equal(srv.getProductRow(pid).stock_qty, 2);
    assert.equal(srv.sumSalableBatches(pid), 2);

    // POS checkout qty: 3 -> controlled 400 (NEVER 500!)
    const failSale = await srv.reqJson('POST', '/api/pos/checkout', {
      token: thungan,
      body: { items: [{ productId: pid, qty: 3 }], paymentMethod: 'VIETQR', paymentRef: 'QR-NOEXP-FAIL' },
    });
    assert.equal(failSale.status, 400);

    // Up-adjust 2 -> 15 -> sell qty: 12 succeeds (201), leaves 3
    assert.equal(
      (
        await srv.reqJson('POST', `/api/products/${pid}/stock-adjust`, {
          token: quanly,
          body: { newStock: 15, note: 'Tăng tồn SP không HSD lên 15' },
        })
      ).status,
      200,
    );
    assert.equal(srv.sumSalableBatches(pid), 15);

    const okSale = await srv.reqJson('POST', '/api/pos/checkout', {
      token: thungan,
      body: { items: [{ productId: pid, qty: 12 }], paymentMethod: 'VIETQR', paymentRef: 'QR-NOEXP-OK' },
    });
    assert.equal(okSale.status, 201);
    assert.equal(srv.getProductRow(pid).stock_qty, 3);
    assert.equal(srv.sumSalableBatches(pid), 3);
  } finally {
    await srv.close();
  }
});

test('P0-F02-05: Product created with 0 stock / 0 batches can be adjusted up and sold cleanly', async () => {
  const srv = await startTestServer();
  try {
    const quanly = await srv.loginAs('quanly');
    const thungan = await srv.loginAs('thungan');
    const unit = srv.db.prepare("SELECT code FROM units WHERE status = 'HoatDong' LIMIT 1").get().code;

    const created = await srv.reqJson('POST', '/api/products', {
      token: quanly,
      body: {
        sku: 'SKU-ZERO-P0',
        barcode: '8938888000555',
        name: 'Sản phẩm khởi tạo tồn 0',
        categoryCode: 'DM01',
        unitCode: unit,
        supplierId: 'NCC001',
        salePrice: 20000,
        costPrice: 12000,
        stockQty: 0,
        imageUrl: 'assets/images/products/milk_vinamilk.jpg',
      },
    });
    assert.equal(created.status, 201);
    const pid = created.data.item.id;
    assert.equal(srv.db.prepare('SELECT COUNT(*) AS c FROM product_batches WHERE product_id = ?').get(pid).c, 0);

    const up = await srv.reqJson('POST', `/api/products/${pid}/stock-adjust`, {
      token: quanly,
      body: { newStock: 12, note: 'Điều chỉnh bổ sung cho SP chưa có lô' },
    });
    assert.equal(up.status, 200);
    assert.equal(srv.getProductRow(pid).stock_qty, 12);
    assert.equal(srv.sumSalableBatches(pid), 12);

    const sale = await srv.reqJson('POST', '/api/pos/checkout', {
      token: thungan,
      body: { items: [{ productId: pid, qty: 5 }], paymentMethod: 'VIETQR', paymentRef: 'QR-ZERO-OK' },
    });
    assert.equal(sale.status, 201);
    assert.equal(srv.getProductRow(pid).stock_qty, 7);
    assert.equal(srv.sumSalableBatches(pid), 7);
  } finally {
    await srv.close();
  }
});

test('P0-F02-06: POS sale exceeding down-adjusted stock returns controlled HTTP 400 (NEVER HTTP 500)', async () => {
  const srv = await startTestServer();
  try {
    const quanly = await srv.loginAs('quanly');
    const thungan = await srv.loginAs('thungan');

    assert.equal(
      (
        await srv.reqJson('POST', '/api/products/SP001/stock-adjust', {
          token: quanly,
          body: { newStock: 1, note: 'Giảm tồn SP001 xuống 1' },
        })
      ).status,
      200,
    );

    const ordersBefore = srv.db.prepare('SELECT COUNT(*) AS c FROM orders').get().c;
    const checkout = await srv.reqJson('POST', '/api/pos/checkout', {
      token: thungan,
      body: { items: [{ productId: 'SP001', qty: 3 }], paymentMethod: 'VIETQR', paymentRef: 'QR-OVER-FAIL' },
    });
    assert.equal(checkout.status, 400, `Expected controlled 400, got ${checkout.status}: ${JSON.stringify(checkout.data)}`);
    assert.equal(srv.getProductRow('SP001').stock_qty, 1);
    assert.equal(srv.sumSalableBatches('SP001'), 1);
    assert.equal(srv.db.prepare('SELECT COUNT(*) AS c FROM orders').get().c, ordersBefore);

    // Even if an external drift lowered products.stock_qty below batches directly in DB, POS must STILL return 400 (defense in depth)
    srv.db.prepare("UPDATE products SET stock_qty = 0 WHERE id = 'SP001'").run();
    const driftCheckout = await srv.reqJson('POST', '/api/pos/checkout', {
      token: thungan,
      body: { items: [{ productId: 'SP001', qty: 1 }], paymentMethod: 'VIETQR', paymentRef: 'QR-DRIFT-GUARD' },
    });
    assert.equal(driftCheckout.status, 400);
  } finally {
    await srv.close();
  }
});

test('P0-F02-07: POS sale after upward adjustment (1 -> 200, sell 160) succeeds 201 with zero lockout', async () => {
  const srv = await startTestServer();
  try {
    const quanly = await srv.loginAs('quanly');
    const thungan = await srv.loginAs('thungan');

    assert.equal(
      (
        await srv.reqJson('POST', '/api/products/SP001/stock-adjust', {
          token: quanly,
          body: { newStock: 200, note: 'Điều chỉnh tăng tồn SP001 lên 200' },
        })
      ).status,
      200,
    );

    const sale = await srv.reqJson('POST', '/api/pos/checkout', {
      token: thungan,
      body: { items: [{ productId: 'SP001', qty: 160 }], paymentMethod: 'VIETQR', paymentRef: 'QR-UP-160' },
    });
    assert.equal(sale.status, 201, JSON.stringify(sale.data));
    assert.equal(srv.getProductRow('SP001').stock_qty, 40);
    assert.equal(srv.sumSalableBatches('SP001'), 40);
  } finally {
    await srv.close();
  }
});

test('P0-F02-08: Negative target stock adjustment returns HTTP 400 and leaves DB completely unchanged', async () => {
  const srv = await startTestServer();
  try {
    const quanly = await srv.loginAs('quanly');
    const before = srv.getProductRow('SP001').stock_qty;
    const movesBefore = srv.db.prepare('SELECT COUNT(*) AS c FROM stock_movements').get().c;

    const r1 = await srv.reqJson('POST', '/api/products/SP001/stock-adjust', {
      token: quanly,
      body: { newStock: -5, note: 'Thử đặt tồn âm' },
    });
    assert.equal(r1.status, 400);

    const r2 = await srv.reqJson('POST', '/api/products/SP001/stock-adjust', {
      token: quanly,
      body: { delta: -(before + 1), note: 'Thử giảm vượt tồn' },
    });
    assert.equal(r2.status, 400);

    assert.equal(srv.getProductRow('SP001').stock_qty, before);
    assert.equal(srv.sumSalableBatches('SP001'), before);
    assert.equal(srv.db.prepare('SELECT COUNT(*) AS c FROM stock_movements').get().c, movesBefore);
  } finally {
    await srv.close();
  }
});

test('P0-F02-09: Failed POS checkout mid-transaction rolls back 100% of product stock, batch stock, movements, and orders', async () => {
  const srv = await startTestServer();
  try {
    const repos = createRepositories(srv.db);
    const salesSvc = new SalesService(srv.db, repos);
    const cashier = repos.users.findByUsername('thungan');

    const stockBefore = srv.getProductRow('SP001').stock_qty;
    const batchBefore = srv.sumSalableBatches('SP001');
    const ordersBefore = srv.db.prepare('SELECT COUNT(*) AS c FROM orders').get().c;
    const movesBefore = srv.db.prepare('SELECT COUNT(*) AS c FROM stock_movements').get().c;

    assert.throws(() => {
      salesSvc.checkout(
        cashier,
        { items: [{ productId: 'SP001', qty: 5 }], paymentMethod: 'VIETQR', paymentRef: 'QR-RB-01' },
        {
          _beforeCommitHook: () => {
            throw new Error('Injected checkout failure mid-TX');
          },
        },
      );
    }, /Injected checkout failure mid-TX/);

    assert.equal(srv.getProductRow('SP001').stock_qty, stockBefore);
    assert.equal(srv.sumSalableBatches('SP001'), batchBefore);
    assert.equal(srv.db.prepare('SELECT COUNT(*) AS c FROM orders').get().c, ordersBefore);
    assert.equal(srv.db.prepare('SELECT COUNT(*) AS c FROM stock_movements').get().c, movesBefore);

    // Also verify adjustProductStock rolls back 100% on mid-TX crash
    const catalogSvc = new CatalogService(srv.db, repos);
    const mgr = repos.users.findByUsername('quanly');
    assert.throws(() => {
      catalogSvc.adjustProductStock(
        mgr,
        'SP001',
        { newStock: 200, note: 'Rollback adjust test' },
        {
          _beforeCommitHook: () => {
            throw new Error('Injected adjust failure');
          },
        },
      );
    }, /Injected adjust failure/);
    assert.equal(srv.getProductRow('SP001').stock_qty, stockBefore);
    assert.equal(srv.sumSalableBatches('SP001'), batchBefore);
    assert.equal(srv.db.prepare('SELECT COUNT(*) AS c FROM stock_movements').get().c, movesBefore);
  } finally {
    await srv.close();
  }
});

test('P0-F02-10: Subsequent syncProductSalableStock preserves prior upward and downward manual adjustments', async () => {
  const srv = await startTestServer();
  try {
    const quanly = await srv.loginAs('quanly');
    const repos = createRepositories(srv.db);
    const today = addDaysYmd(0);

    assert.equal(
      (
        await srv.reqJson('POST', '/api/products/SP001/stock-adjust', {
          token: quanly,
          body: { newStock: 200, note: 'Tăng tồn lên 200' },
        })
      ).status,
      200,
    );
    const syncedUp = repos.batches.syncProductSalableStock('SP001', today);
    assert.equal(syncedUp, 200);
    assert.equal(srv.getProductRow('SP001').stock_qty, 200);

    assert.equal(
      (
        await srv.reqJson('POST', '/api/products/SP001/stock-adjust', {
          token: quanly,
          body: { newStock: 12, note: 'Giảm tồn xuống 12' },
        })
      ).status,
      200,
    );
    const syncedDown = repos.batches.syncProductSalableStock('SP001', today);
    assert.equal(syncedDown, 12);
    assert.equal(srv.getProductRow('SP001').stock_qty, 12);
  } finally {
    await srv.close();
  }
});

test('P0-F02-11: Write-off after upward adjustment (154 -> 200, write-off 1) yields 199 (NEVER silently erases to 153)', async () => {
  const srv = await startTestServer();
  try {
    const quanly = await srv.loginAs('quanly');
    const kho = await srv.loginAs('kho');

    assert.equal(
      (
        await srv.reqJson('POST', '/api/products/SP001/stock-adjust', {
          token: quanly,
          body: { newStock: 200, note: 'Điều chỉnh tăng SP001 lên 200' },
        })
      ).status,
      200,
    );
    assert.equal(srv.getProductRow('SP001').stock_qty, 200);
    assert.equal(srv.sumSalableBatches('SP001'), 200);

    const targetBatch = srv.db
      .prepare("SELECT id FROM product_batches WHERE product_id = 'SP001' AND qty_remaining > 0 LIMIT 1")
      .get();
    const woCreate = await srv.reqJson('POST', '/api/writeoffs', {
      token: kho,
      body: {
        reason: 'Hủy 1 hộp móp bao bì',
        items: [{ batchId: targetBatch.id, qty: 1, reason: 'Móp hộp' }],
      },
    });
    assert.equal(woCreate.status, 201);
    const woApprove = await srv.reqJson('POST', `/api/writeoffs/${woCreate.data.item.id}/approve`, { token: quanly });
    assert.equal(woApprove.status, 200);

    assert.equal(srv.getProductRow('SP001').stock_qty, 199, 'Must be 199, NOT 153!');
    assert.equal(srv.sumSalableBatches('SP001'), 199);
  } finally {
    await srv.close();
  }
});

test('P0-F02-12: Stocktake audit after manual adjustment preserves exact products <-> batches consistency', async () => {
  const srv = await startTestServer();
  try {
    const quanly = await srv.loginAs('quanly');
    const kho = await srv.loginAs('kho');

    assert.equal(
      (
        await srv.reqJson('POST', '/api/products/SP001/stock-adjust', {
          token: quanly,
          body: { newStock: 200, note: 'Điều chỉnh tăng lên 200 trước kiểm kê' },
        })
      ).status,
      200,
    );

    const auditCreate = await srv.reqJson('POST', '/api/stock-audits', {
      token: kho,
      body: {
        note: 'Kiểm kê sau điều chỉnh',
        items: [{ productId: 'SP001', actualQty: 196, reason: 'Thiếu 4 hộp trên quầy' }],
      },
    });
    assert.equal(auditCreate.status, 201);
    const auditApprove = await srv.reqJson('POST', `/api/stock-audits/${auditCreate.data.item.id}/approve`, {
      token: quanly,
    });
    assert.equal(auditApprove.status, 200);

    assert.equal(srv.getProductRow('SP001').stock_qty, 196);
    assert.equal(srv.sumSalableBatches('SP001'), 196);
  } finally {
    await srv.close();
  }
});

test('P0-F02-13: Repeated sequential stock operations (adjust up, POS sell, adjust down, GRN receive, write-off, stocktake) maintain zero drift', async () => {
  const srv = await startTestServer();
  try {
    const quanly = await srv.loginAs('quanly');
    const kho = await srv.loginAs('kho');
    const thungan = await srv.loginAs('thungan');
    const ncc = await srv.loginAs('ncc01');

    // Start SP006 = 8
    assert.equal(srv.getProductRow('SP006').stock_qty, 8);
    assert.equal(srv.sumSalableBatches('SP006'), 8);

    // 1. Up-adjust 8 -> 25
    assert.equal(
      (await srv.reqJson('POST', '/api/products/SP006/stock-adjust', { token: quanly, body: { newStock: 25, note: 'Bước 1 tăng' } })).status,
      200,
    );
    assert.equal(srv.getProductRow('SP006').stock_qty, 25);
    assert.equal(srv.sumSalableBatches('SP006'), 25);

    // 2. POS sell 10 -> 15
    assert.equal(
      (
        await srv.reqJson('POST', '/api/pos/checkout', {
          token: thungan,
          body: { items: [{ productId: 'SP006', qty: 10 }], paymentMethod: 'VIETQR', paymentRef: 'QR-SEQ-1' },
        })
      ).status,
      201,
    );
    assert.equal(srv.getProductRow('SP006').stock_qty, 15);
    assert.equal(srv.sumSalableBatches('SP006'), 15);

    // 3. Down-adjust 15 -> 9
    assert.equal(
      (await srv.reqJson('POST', '/api/products/SP006/stock-adjust', { token: quanly, body: { newStock: 9, note: 'Bước 3 giảm' } })).status,
      200,
    );
    assert.equal(srv.getProductRow('SP006').stock_qty, 9);
    assert.equal(srv.sumSalableBatches('SP006'), 9);

    // 4. PO + GRN receive +6 -> 15
    const poId = (
      await srv.reqJson('POST', '/api/purchases', {
        token: kho,
        body: {
          supplierId: 'NCC003',
          items: [{ productId: 'SP006', qty: 6, unitCost: 42000, expiryDate: addDaysYmd(200) }],
        },
      })
    ).data.item.id;
    await srv.reqJson('POST', `/api/purchases/${poId}/send`, { token: kho, body: {} });
    await srv.reqJson('POST', `/api/purchases/${poId}/respond`, { token: ncc, body: { action: 'ACCEPT' } });
    const grnId = (
      await srv.reqJson('POST', '/api/grns', {
        token: kho,
        body: {
          purchaseId: poId,
          items: [{ productId: 'SP006', receivedQty: 6, unitCost: 42000, expiryDate: addDaysYmd(200) }],
        },
      })
    ).data.item.id;
    assert.equal((await srv.reqJson('POST', `/api/grns/${grnId}/confirm`, { token: quanly })).status, 200);
    assert.equal(srv.getProductRow('SP006').stock_qty, 15);
    assert.equal(srv.sumSalableBatches('SP006'), 15);

    // 5. Write-off 2 -> 13
    const b = srv.db.prepare("SELECT id FROM product_batches WHERE product_id = 'SP006' AND qty_remaining >= 2 LIMIT 1").get();
    const woId = (
      await srv.reqJson('POST', '/api/writeoffs', {
        token: kho,
        body: { reason: 'Hủy 2 hộp', items: [{ batchId: b.id, qty: 2, reason: 'Rách' }] },
      })
    ).data.item.id;
    assert.equal((await srv.reqJson('POST', `/api/writeoffs/${woId}/approve`, { token: quanly })).status, 200);
    assert.equal(srv.getProductRow('SP006').stock_qty, 13);
    assert.equal(srv.sumSalableBatches('SP006'), 13);

    // 6. Stocktake -1 -> 12
    const kkId = (
      await srv.reqJson('POST', '/api/stock-audits', {
        token: kho,
        body: { note: 'Kiểm cuối', items: [{ productId: 'SP006', actualQty: 12, reason: 'Thiếu 1' }] },
      })
    ).data.item.id;
    assert.equal((await srv.reqJson('POST', `/api/stock-audits/${kkId}/approve`, { token: quanly })).status, 200);
    assert.equal(srv.getProductRow('SP006').stock_qty, 12);
    assert.equal(srv.sumSalableBatches('SP006'), 12);
  } finally {
    await srv.close();
  }
});
