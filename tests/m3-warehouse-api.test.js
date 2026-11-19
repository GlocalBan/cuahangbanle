'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { openDatabase } = require('../src/server/dal/database.js');
const { createRepositories } = require('../src/server/dal/repositories.js');
const { WarehouseService, computeWeightedAverageCost } = require('../src/server/bll/warehouseService.js');
const { createApiRouter } = require('../src/server/routes/api.js');

async function startTestServer() {
  const db = openDatabase(':memory:');
  const handleApi = createApiRouter(db);
  const server = http.createServer((req, res) => {
    const urlObj = new URL(req.url, 'http://127.0.0.1');
    return handleApi(req, res, urlObj);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  async function reqJson(method, path, { token = '', body = null } = {}) {
    const headers = { Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== null) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body !== null ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  }

  async function loginAs(username, password = '123456') {
    const res = await reqJson('POST', '/api/auth/login', { body: { username, password } });
    assert.equal(res.status, 200, `Login failed for ${username}`);
    return res.data.token;
  }

  return {
    db,
    reqJson,
    loginAs,
    close: () =>
      new Promise((resolve) => {
        server.close(() => {
          db.close();
          resolve();
        });
      }),
  };
}

test('M3-01: Pure weighted average cost calculation (BR-02)', () => {
  assert.equal(computeWeightedAverageCost(0, 20000, 10, 25000), 25000);
  assert.equal(computeWeightedAverageCost(10, 20000, 10, 30000), 25000);
  // (12 * 38160 + 20 * 41000) / 32 = (457920 + 820000) / 32 = 39935
  assert.equal(computeWeightedAverageCost(12, 38160, 20, 41000), 39935);
  assert.equal(computeWeightedAverageCost(8, 44800, 12, 50000), 47920);
});

test('M3-02: 401/403/200 RBAC matrix across all M3 Purchases, Restock Suggestions & Stock Audits endpoints', async () => {
  const srv = await startTestServer();
  try {
    // 401 without token
    for (const ep of ['/api/restock-suggestions', '/api/purchases', '/api/stock-audits']) {
      assert.equal((await srv.reqJson('GET', ep)).status, 401, `${ep} must return 401 without token`);
    }

    const cashierToken = await srv.loginAs('thungan');
    const warehouseToken = await srv.loginAs('kho');
    const managerToken = await srv.loginAs('quanly');
    const adminToken = await srv.loginAs('admin');

    // ThuNgan -> 403 on ALL M3 endpoints
    assert.equal((await srv.reqJson('GET', '/api/restock-suggestions', { token: cashierToken })).status, 403);
    assert.equal((await srv.reqJson('GET', '/api/purchases', { token: cashierToken })).status, 403);
    assert.equal(
      (await srv.reqJson('POST', '/api/purchases', { token: cashierToken, body: { supplierId: 'NCC001', items: [] } })).status,
      403,
    );
    assert.equal((await srv.reqJson('GET', '/api/stock-audits', { token: cashierToken })).status, 403);
    assert.equal(
      (await srv.reqJson('POST', '/api/stock-audits', { token: cashierToken, body: { items: [] } })).status,
      403,
    );

    // NhanVienKho -> 200/201 on read & Draft/ChoDuyet creation; 403 on confirm/approve/cancel
    assert.equal((await srv.reqJson('GET', '/api/restock-suggestions', { token: warehouseToken })).status, 200);
    assert.equal((await srv.reqJson('GET', '/api/purchases', { token: warehouseToken })).status, 200);
    assert.equal((await srv.reqJson('GET', '/api/stock-audits', { token: warehouseToken })).status, 200);

    const whPo = await srv.reqJson('POST', '/api/purchases', {
      token: warehouseToken,
      body: {
        supplierId: 'NCC003',
        note: 'Kho tạo phiếu nháp',
        items: [{ productId: 'SP006', qty: 10, unitCost: 46000 }],
      },
    });
    assert.equal(whPo.status, 201);
    const poId = whPo.data.item.id;

    // NhanVienKho forbidden from confirming or cancelling PO
    assert.equal((await srv.reqJson('POST', `/api/purchases/${poId}/confirm`, { token: warehouseToken })).status, 403);
    assert.equal((await srv.reqJson('POST', `/api/purchases/${poId}/cancel`, { token: warehouseToken, body: {} })).status, 403);

    const whAudit = await srv.reqJson('POST', '/api/stock-audits', {
      token: warehouseToken,
      body: {
        note: 'Kho kiểm kê định kỳ',
        items: [{ productId: 'SP001', actualQty: 154, reason: '' }],
      },
    });
    assert.equal(whAudit.status, 201);
    const auditId = whAudit.data.item.id;

    // NhanVienKho forbidden from approving or cancelling StockAudit
    assert.equal((await srv.reqJson('POST', `/api/stock-audits/${auditId}/approve`, { token: warehouseToken })).status, 403);
    assert.equal(
      (await srv.reqJson('POST', `/api/stock-audits/${auditId}/cancel`, { token: warehouseToken, body: {} })).status,
      403,
    );

    // Hard DELETE blocked even for Manager/Admin (Soft-delete via Cancelled/DaHuy)
    assert.equal((await srv.reqJson('DELETE', `/api/purchases/${poId}`, { token: managerToken })).status, 403);
    assert.equal((await srv.reqJson('DELETE', `/api/stock-audits/${auditId}`, { token: adminToken })).status, 403);

    // QuanLy & Admin allowed to approve/cancel
    assert.equal((await srv.reqJson('POST', `/api/purchases/${poId}/confirm`, { token: managerToken })).status, 200);
    assert.equal((await srv.reqJson('POST', `/api/stock-audits/${auditId}/approve`, { token: adminToken })).status, 200);
  } finally {
    await srv.close();
  }
});

test('M3-03: BR-02 Purchases lifecycle (Draft -> Confirmed/Cancelled), active supplier check, weighted avg cost & lock', async () => {
  const srv = await startTestServer();
  try {
    const warehouseToken = await srv.loginAs('kho');
    const managerToken = await srv.loginAs('quanly');

    // Inspect initial SP006 (NCC003, seeded stock 8)
    const beforeProd = (await srv.reqJson('GET', '/api/products/SP006', { token: managerToken })).data.item;
    const oldStock = beforeProd.stockQty;
    const oldCost = beforeProd.costPrice;
    assert.equal(oldStock, 8);

    // Reject empty items, qty <= 0, unitCost < 0, wrong supplier product
    assert.equal(
      (await srv.reqJson('POST', '/api/purchases', { token: warehouseToken, body: { supplierId: 'NCC003', items: [] } })).status,
      400,
    );
    assert.equal(
      (
        await srv.reqJson('POST', '/api/purchases', {
          token: warehouseToken,
          body: { supplierId: 'NCC003', items: [{ productId: 'SP006', qty: 0, unitCost: 40000 }] },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await srv.reqJson('POST', '/api/purchases', {
          token: warehouseToken,
          body: { supplierId: 'NCC003', items: [{ productId: 'SP006', qty: 5, unitCost: -100 }] },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await srv.reqJson('POST', '/api/purchases', {
          token: warehouseToken,
          body: { supplierId: 'NCC001', items: [{ productId: 'SP006', qty: 5, unitCost: 40000 }] },
        })
      ).status,
      400,
    );

    // Deactivate NCC009 temporarily -> BR-02 must block purchase from NgungHopTac supplier
    assert.equal(
      (await srv.reqJson('PATCH', '/api/suppliers/NCC009/status', { token: managerToken, body: { status: 'NgungHopTac' } })).status,
      200,
    );
    const inactiveSupRes = await srv.reqJson('POST', '/api/purchases', {
      token: warehouseToken,
      body: { supplierId: 'NCC009', items: [{ productId: 'SP007', qty: 5, unitCost: 140000 }] },
    });
    assert.equal(inactiveSupRes.status, 400);

    // Create Draft PN001 -> must NOT change stock or cost yet
    const created = await srv.reqJson('POST', '/api/purchases', {
      token: warehouseToken,
      body: {
        supplierId: 'NCC003',
        note: 'Nhập bổ sung SP006',
        items: [{ productId: 'SP006', qty: 10, unitCost: 50000 }],
      },
    });
    assert.equal(created.status, 201);
    assert.equal(created.data.item.id, 'PN001');
    assert.equal(created.data.item.status, 'Draft');
    assert.equal(created.data.item.totalAmount, 500000);

    const midProd = (await srv.reqJson('GET', '/api/products/SP006', { token: managerToken })).data.item;
    assert.equal(midProd.stockQty, oldStock, 'Draft purchase must NOT change stock');
    assert.equal(midProd.costPrice, oldCost, 'Draft purchase must NOT change costPrice');

    // Restock suggestions reflect pendingDraftQty = 10
    const restock = await srv.reqJson('GET', '/api/restock-suggestions', { token: warehouseToken });
    const sp006Sug = restock.data.items.find((x) => x.productId === 'SP006');
    assert.ok(sp006Sug);
    assert.equal(sp006Sug.pendingDraftQty, 10);

    // Edit Draft PN001 -> change qty to 12, unitCost to 50000
    const edited = await srv.reqJson('PUT', '/api/purchases/PN001', {
      token: warehouseToken,
      body: {
        supplierId: 'NCC003',
        note: 'Cập nhật số lượng nhập 12 hộp',
        items: [{ productId: 'SP006', qty: 12, unitCost: 50000 }],
      },
    });
    assert.equal(edited.status, 200);
    assert.equal(edited.data.item.totalAmount, 600000);

    // Manager confirms PN001 -> atomic stock + weighted avg cost + NHAP_KHO ledger + lock
    const confirmed = await srv.reqJson('POST', '/api/purchases/PN001/confirm', { token: managerToken });
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.data.item.status, 'Confirmed');

    const expectedNewStock = oldStock + 12;
    const expectedNewCost = computeWeightedAverageCost(oldStock, oldCost, 12, 50000);
    const afterProd = (await srv.reqJson('GET', '/api/products/SP006', { token: managerToken })).data.item;
    assert.equal(afterProd.stockQty, expectedNewStock);
    assert.equal(afterProd.costPrice, expectedNewCost);

    // Check NHAP_KHO entry in LichSuTonKho
    const ledger = await srv.reqJson('GET', '/api/stock-movements?productId=SP006&docType=NHAP_KHO', {
      token: managerToken,
    });
    assert.equal(ledger.status, 200);
    assert.equal(ledger.data.items.length, 1);
    assert.equal(ledger.data.items[0].docId, 'PN001');
    assert.equal(ledger.data.items[0].stockBefore, oldStock);
    assert.equal(ledger.data.items[0].delta, 12);
    assert.equal(ledger.data.items[0].stockAfter, expectedNewStock);

    // Confirmed PN001 is locked: edit/confirm/cancel all return 409
    assert.equal(
      (
        await srv.reqJson('PUT', '/api/purchases/PN001', {
          token: managerToken,
          body: { supplierId: 'NCC003', items: [{ productId: 'SP006', qty: 1, unitCost: 1000 }] },
        })
      ).status,
      409,
    );
    assert.equal((await srv.reqJson('POST', '/api/purchases/PN001/confirm', { token: managerToken })).status, 409);
    assert.equal((await srv.reqJson('POST', '/api/purchases/PN001/cancel', { token: managerToken, body: {} })).status, 409);

    // Create Draft PN002 and Cancel -> stock unchanged
    const po2 = await srv.reqJson('POST', '/api/purchases', {
      token: warehouseToken,
      body: { supplierId: 'NCC003', items: [{ productId: 'SP006', qty: 5, unitCost: 48000 }] },
    });
    assert.equal(po2.status, 201);
    const cancelled = await srv.reqJson('POST', `/api/purchases/${po2.data.item.id}/cancel`, {
      token: managerToken,
      body: { reason: 'Hết nhu cầu nhập' },
    });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.data.item.status, 'Cancelled');
    assert.equal((await srv.reqJson('GET', '/api/products/SP006', { token: managerToken })).data.item.stockQty, expectedNewStock);
  } finally {
    await srv.close();
  }
});

test('M3-04: BR-06 Stock Audit lifecycle (mandatory diff reason, ChoDuyet -> DaDuyet/DaHuy, KIEM_KE ledger)', async () => {
  const srv = await startTestServer();
  try {
    const warehouseToken = await srv.loginAs('kho');
    const managerToken = await srv.loginAs('quanly');

    const sp1Before = (await srv.reqJson('GET', '/api/products/SP001', { token: managerToken })).data.item.stockQty;
    const sp2Before = (await srv.reqJson('GET', '/api/products/SP002', { token: managerToken })).data.item.stockQty;

    // Missing reason when diff != 0 MUST be rejected (400 BR-06)
    const missingReason = await srv.reqJson('POST', '/api/stock-audits', {
      token: warehouseToken,
      body: {
        note: 'Thiếu lý do',
        items: [{ productId: 'SP001', actualQty: sp1Before - 2, reason: '' }],
      },
    });
    assert.equal(missingReason.status, 400);

    // Negative actualQty rejected (400)
    const negActual = await srv.reqJson('POST', '/api/stock-audits', {
      token: warehouseToken,
      body: {
        note: 'Âm tồn',
        items: [{ productId: 'SP001', actualQty: -1, reason: 'Lỗi đếm' }],
      },
    });
    assert.equal(negActual.status, 400);

    // Valid multi-item audit: SP001 (-3 with reason), SP002 (+4 with reason)
    const created = await srv.reqJson('POST', '/api/stock-audits', {
      token: warehouseToken,
      body: {
        note: 'Kiểm kê cuối tháng',
        items: [
          { productId: 'SP001', actualQty: sp1Before - 3, reason: 'Rách 3 hộp trong quá trình xếp kệ' },
          { productId: 'SP002', actualQty: sp2Before + 4, reason: 'Phát hiện 4 gói sót trên kệ dự trữ' },
        ],
      },
    });
    assert.equal(created.status, 201);
    assert.equal(created.data.item.id, 'KK001');
    assert.equal(created.data.item.status, 'ChoDuyet');
    assert.equal(created.data.item.diffItemCount, 2);

    // Stock MUST remain unchanged until Manager approves
    assert.equal((await srv.reqJson('GET', '/api/products/SP001', { token: managerToken })).data.item.stockQty, sp1Before);
    assert.equal((await srv.reqJson('GET', '/api/products/SP002', { token: managerToken })).data.item.stockQty, sp2Before);

    // Manager approves KK001 -> stock adjusted & 2 KIEM_KE movements appended
    const approved = await srv.reqJson('POST', '/api/stock-audits/KK001/approve', { token: managerToken });
    assert.equal(approved.status, 200);
    assert.equal(approved.data.item.status, 'DaDuyet');

    assert.equal((await srv.reqJson('GET', '/api/products/SP001', { token: managerToken })).data.item.stockQty, sp1Before - 3);
    assert.equal((await srv.reqJson('GET', '/api/products/SP002', { token: managerToken })).data.item.stockQty, sp2Before + 4);

    const ledger = await srv.reqJson('GET', '/api/stock-movements?docType=KIEM_KE', { token: managerToken });
    assert.equal(ledger.status, 200);
    assert.equal(ledger.data.items.length, 2);
    assert.ok(ledger.data.items.some((m) => m.productId === 'SP001' && m.delta === -3 && m.docId === 'KK001'));
    assert.ok(ledger.data.items.some((m) => m.productId === 'SP002' && m.delta === 4 && m.docId === 'KK001'));

    // Re-approve or cancel already-approved audit -> 409
    assert.equal((await srv.reqJson('POST', '/api/stock-audits/KK001/approve', { token: managerToken })).status, 409);
    assert.equal((await srv.reqJson('POST', '/api/stock-audits/KK001/cancel', { token: managerToken, body: {} })).status, 409);

    // Create KK002 and cancel -> stock untouched
    const kk2 = await srv.reqJson('POST', '/api/stock-audits', {
      token: warehouseToken,
      body: {
        note: 'Phiếu nhầm sản phẩm',
        items: [{ productId: 'SP001', actualQty: sp1Before - 10, reason: 'Kiểm nhầm kệ' }],
      },
    });
    assert.equal(kk2.status, 201);
    const cancelled = await srv.reqJson('POST', `/api/stock-audits/${kk2.data.item.id}/cancel`, {
      token: managerToken,
      body: { reason: 'Lập nhầm' },
    });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.data.item.status, 'DaHuy');
    assert.equal((await srv.reqJson('GET', '/api/products/SP001', { token: managerToken })).data.item.stockQty, sp1Before - 3);
  } finally {
    await srv.close();
  }
});

test('M3-05: Atomic transaction rollback on confirmPurchase/approveStockAudit failure & BR-08 date range validation', async () => {
  const srv = await startTestServer();
  try {
    const managerToken = await srv.loginAs('quanly');

    // BR-08: TuNgay > DenNgay rejected with 400
    assert.equal(
      (await srv.reqJson('GET', '/api/purchases?fromDate=2026-12-31&toDate=2026-01-01', { token: managerToken })).status,
      400,
    );
    assert.equal(
      (await srv.reqJson('GET', '/api/stock-audits?fromDate=2026-12-31&toDate=2026-01-01', { token: managerToken })).status,
      400,
    );

    // Direct BLL atomic rollback test for confirmPurchase
    const repos = createRepositories(srv.db);
    const svc = new WarehouseService(srv.db, repos);
    const managerUser = repos.users.findByUsername('quanly');

    const sp3Before = repos.products.findById('SP003');
    const po = svc.createPurchase(managerUser, {
      supplierId: 'NCC003',
      note: 'Kiểm thử rollback nhập kho',
      items: [{ productId: 'SP003', qty: 15, unitCost: 42000 }],
    });
    const moveCountBeforePo = srv.db.prepare('SELECT COUNT(*) AS cnt FROM stock_movements').get().cnt;

    assert.throws(() => {
      svc.confirmPurchase(managerUser, po.id, {
        _beforeCommitHook: () => {
          throw new Error('Simulated DB crash mid-confirmPurchase');
        },
      });
    }, /Simulated DB crash mid-confirmPurchase/);

    // Verify 100% rollback: PO still Draft, stock/cost unchanged, 0 new movements
    assert.equal(repos.purchases.findById(po.id).status, 'Draft');
    assert.equal(repos.products.findById('SP003').stock_qty, sp3Before.stock_qty);
    assert.equal(repos.products.findById('SP003').cost_price, sp3Before.cost_price);
    assert.equal(srv.db.prepare('SELECT COUNT(*) AS cnt FROM stock_movements').get().cnt, moveCountBeforePo);

    // Direct BLL atomic rollback test for approveStockAudit
    const audit = svc.createStockAudit(managerUser, {
      note: 'Kiểm thử rollback kiểm kê',
      items: [{ productId: 'SP003', actualQty: sp3Before.stock_qty - 2, reason: 'Vỡ chai khi vận chuyển' }],
    });
    const moveCountBeforeAudit = srv.db.prepare('SELECT COUNT(*) AS cnt FROM stock_movements').get().cnt;

    assert.throws(() => {
      svc.approveStockAudit(managerUser, audit.id, {
        _beforeCommitHook: () => {
          throw new Error('Simulated DB crash mid-approveStockAudit');
        },
      });
    }, /Simulated DB crash mid-approveStockAudit/);

    // Verify 100% rollback: Audit still ChoDuyet, stock unchanged, 0 new movements
    assert.equal(repos.stockAudits.findById(audit.id).status, 'ChoDuyet');
    assert.equal(repos.products.findById('SP003').stock_qty, sp3Before.stock_qty);
    assert.equal(srv.db.prepare('SELECT COUNT(*) AS cnt FROM stock_movements').get().cnt, moveCountBeforeAudit);
  } finally {
    await srv.close();
  }
});

test('M3-06: approveStockAudit rejects stale stock with 409 Conflict when concurrent movement occurs (no overwrite)', async () => {
  const srv = await startTestServer();
  try {
    const warehouseToken = await srv.loginAs('kho');
    const managerToken = await srv.loginAs('quanly');

    // Initial stock of SP006 is 8, SP001 is 154
    const sp6Initial = (await srv.reqJson('GET', '/api/products/SP006', { token: managerToken })).data.item.stockQty;
    const sp1Initial = (await srv.reqJson('GET', '/api/products/SP001', { token: managerToken })).data.item.stockQty;

    // 1. Warehouse creates multi-item Stock Audit (ChoDuyet) with SP001 and SP006
    const auditRes = await srv.reqJson('POST', '/api/stock-audits', {
      token: warehouseToken,
      body: {
        note: 'Kiểm kê trước khi nhập thêm SP006',
        items: [
          { productId: 'SP001', actualQty: sp1Initial - 1, reason: 'Hao hụt 1 hộp trên kệ' },
          { productId: 'SP006', actualQty: sp6Initial - 1, reason: 'Móp 1 hộp cà phê' },
        ],
      },
    });
    assert.equal(auditRes.status, 201);
    const auditId = auditRes.data.item.id;

    // 2. Concurrent stock movement happens on SP006 (create + confirm PO +10 units)
    const poRes = await srv.reqJson('POST', '/api/purchases', {
      token: warehouseToken,
      body: {
        supplierId: 'NCC003',
        note: 'Nhập chen ngang trước khi duyệt kiểm kê',
        items: [{ productId: 'SP006', qty: 10, unitCost: 45000 }],
      },
    });
    assert.equal(poRes.status, 201);
    assert.equal(
      (await srv.reqJson('POST', `/api/purchases/${poRes.data.item.id}/confirm`, { token: managerToken })).status,
      200,
    );

    const sp6AfterPo = (await srv.reqJson('GET', '/api/products/SP006', { token: managerToken })).data.item.stockQty;
    assert.equal(sp6AfterPo, sp6Initial + 10);

    // 3. Manager tries to approve stale audit -> MUST return 409 Conflict and NOT overwrite SP006 or SP001
    const approveRes = await srv.reqJson('POST', `/api/stock-audits/${auditId}/approve`, { token: managerToken });
    assert.equal(approveRes.status, 409);
    assert.match(approveRes.data.error?.message || '', /SP006/);

    // Verify audit stays ChoDuyet, neither SP001 nor SP006 overwritten, and 0 KIEM_KE movements appended
    const auditAfter = (await srv.reqJson('GET', `/api/stock-audits/${auditId}`, { token: managerToken })).data.item;
    assert.equal(auditAfter.status, 'ChoDuyet');
    assert.equal((await srv.reqJson('GET', '/api/products/SP006', { token: managerToken })).data.item.stockQty, sp6AfterPo);
    assert.equal((await srv.reqJson('GET', '/api/products/SP001', { token: managerToken })).data.item.stockQty, sp1Initial);
    const kiemKeMoves = await srv.reqJson('GET', '/api/stock-movements?docType=KIEM_KE', { token: managerToken });
    assert.equal(kiemKeMoves.data.items.length, 0);
  } finally {
    await srv.close();
  }
});
