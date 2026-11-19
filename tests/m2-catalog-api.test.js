'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { openDatabase } = require('../src/server/dal/database.js');
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

test('M2-01: Seeded 93 real SKU, 6 categories, 14 units, 10 suppliers, real 1-1 product images & opening LichSuTonKho', async () => {
  const srv = await startTestServer();
  try {
    const managerToken = await srv.loginAs('quanly');
    const [prods, cats, units, sups, imgs, moves] = await Promise.all([
      srv.reqJson('GET', '/api/products', { token: managerToken }),
      srv.reqJson('GET', '/api/categories', { token: managerToken }),
      srv.reqJson('GET', '/api/units', { token: managerToken }),
      srv.reqJson('GET', '/api/suppliers', { token: managerToken }),
      srv.reqJson('GET', '/api/product-images', { token: managerToken }),
      srv.reqJson('GET', '/api/stock-movements?limit=10', { token: managerToken }),
    ]);

    assert.equal(prods.status, 200);
    assert.equal(prods.data.items.length, 93);
    assert.ok(prods.data.summary.lowStockCount >= 3, 'Should detect seeded low-stock SKUs (BR-01)');
    // Every seeded product must use a real product image, never default.jpg
    for (const p of prods.data.items) {
      assert.ok(
        p.imageUrl.startsWith('assets/images/products/') && !p.imageUrl.endsWith('default.jpg'),
        `Invalid placeholder image on ${p.sku}: ${p.imageUrl}`,
      );
      assert.equal(typeof p.costPrice, 'number', 'Manager must see costPrice');
    }

    assert.equal(cats.status, 200);
    assert.equal(cats.data.items.length, 6);
    assert.equal(units.status, 200);
    assert.equal(units.data.items.length, 14);
    assert.equal(sups.status, 200);
    assert.equal(sups.data.items.length, 10);
    assert.equal(imgs.status, 200);
    assert.ok(imgs.data.items.length >= 80);
    assert.equal(moves.status, 200);
    assert.equal(moves.data.total, 93, 'Opening KHOI_TAO_TON ledger should have 93 records');
  } finally {
    await srv.close();
  }
});

test('M2-02: 401 Unauthorized & 403 Forbidden RBAC matrix + ThuNgan costPrice masking at API level', async () => {
  const srv = await startTestServer();
  try {
    // 401 without token across all M2 endpoints
    for (const ep of ['/api/products', '/api/categories', '/api/units', '/api/suppliers', '/api/stock-movements']) {
      const r = await srv.reqJson('GET', ep);
      assert.equal(r.status, 401, `${ep} must return 401 without token`);
    }

    const cashierToken = await srv.loginAs('thungan');
    const warehouseToken = await srv.loginAs('kho');
    const managerToken = await srv.loginAs('quanly');

    // ThuNgan: 200 GET /api/products WITHOUT costPrice
    const cashierProds = await srv.reqJson('GET', '/api/products', { token: cashierToken });
    assert.equal(cashierProds.status, 200);
    assert.equal(cashierProds.data.items.length, 93);
    assert.equal(cashierProds.data.items[0].costPrice, undefined, 'API must strip costPrice for ThuNgan');
    assert.equal(cashierProds.data.summary.totalInventoryValue, undefined, 'API must strip inventory value for ThuNgan');

    // ThuNgan: 403 on mutations, suppliers, and stock-movements
    assert.equal((await srv.reqJson('GET', '/api/suppliers', { token: cashierToken })).status, 403);
    assert.equal((await srv.reqJson('GET', '/api/stock-movements', { token: cashierToken })).status, 403);
    assert.equal(
      (await srv.reqJson('POST', '/api/products', { token: cashierToken, body: { name: 'Hack' } })).status,
      403,
    );
    assert.equal(
      (await srv.reqJson('POST', '/api/categories', { token: cashierToken, body: { name: 'Hack' } })).status,
      403,
    );
    assert.equal(
      (await srv.reqJson('POST', '/api/products/SP001/stock-adjust', { token: cashierToken, body: { newStock: 10, note: 'hack' } })).status,
      403,
    );

    // NhanVienKho: 200 read on products (with costPrice), suppliers, stock-movements; 403 on write/manage
    const whProds = await srv.reqJson('GET', '/api/products', { token: warehouseToken });
    assert.equal(whProds.status, 200);
    assert.equal(typeof whProds.data.items[0].costPrice, 'number');
    assert.equal((await srv.reqJson('GET', '/api/suppliers', { token: warehouseToken })).status, 200);
    assert.equal((await srv.reqJson('GET', '/api/stock-movements', { token: warehouseToken })).status, 200);
    assert.equal(
      (await srv.reqJson('POST', '/api/products', { token: warehouseToken, body: { name: 'NoPerm' } })).status,
      403,
    );
    assert.equal(
      (await srv.reqJson('POST', '/api/suppliers', { token: warehouseToken, body: { name: 'NoPerm' } })).status,
      403,
    );
    assert.equal(
      (await srv.reqJson('POST', '/api/products/SP001/stock-adjust', { token: warehouseToken, body: { newStock: 5, note: 'bypass' } })).status,
      403,
    );

    // Immutable LichSuTonKho: even Manager/Admin cannot PUT/PATCH/DELETE stock-movements
    assert.equal((await srv.reqJson('DELETE', '/api/stock-movements/STK-SEED-SP001', { token: managerToken })).status, 403);
    assert.equal((await srv.reqJson('PUT', '/api/stock-movements/STK-SEED-SP001', { token: managerToken, body: {} })).status, 403);
  } finally {
    await srv.close();
  }
});

test('M2-03: BR-01 SKU/Barcode uniqueness, price >= 0, real image check, Soft-Delete & hard-delete protection', async () => {
  const srv = await startTestServer();
  try {
    const managerToken = await srv.loginAs('quanly');

    // Negative salePrice rejected (BR-01)
    const negPrice = await srv.reqJson('POST', '/api/products', {
      token: managerToken,
      body: {
        sku: 'SP-NEG-1',
        barcode: '8939999000001',
        name: 'SP giá âm',
        categoryCode: 'DM01',
        unitCode: 'DVT01',
        supplierId: 'NCC001',
        salePrice: -1000,
        costPrice: 5000,
        minStock: 10,
        imageUrl: 'assets/images/products/milk_vinamilk.jpg',
      },
    });
    assert.equal(negPrice.status, 400);

    // Placeholder default.jpg rejected
    const placeholderImg = await srv.reqJson('POST', '/api/products', {
      token: managerToken,
      body: {
        sku: 'SP-IMG-1',
        barcode: '8939999000002',
        name: 'SP ảnh mặc định',
        categoryCode: 'DM01',
        unitCode: 'DVT01',
        supplierId: 'NCC001',
        salePrice: 12000,
        costPrice: 8000,
        minStock: 10,
        imageUrl: 'assets/images/products/default.jpg',
      },
    });
    assert.equal(placeholderImg.status, 400);

    // Duplicate SKU -> 409 Conflict
    const dupSku = await srv.reqJson('POST', '/api/products', {
      token: managerToken,
      body: {
        sku: 'SP001',
        barcode: '8939999000003',
        name: 'SP trùng SKU',
        categoryCode: 'DM01',
        unitCode: 'DVT01',
        supplierId: 'NCC001',
        salePrice: 15000,
        costPrice: 10000,
        minStock: 5,
        imageUrl: 'assets/images/products/milk_vinamilk.jpg',
      },
    });
    assert.equal(dupSku.status, 409);

    // Create valid product with stockQty = 20 -> atomically creates KHOI_TAO_TON movement
    const created = await srv.reqJson('POST', '/api/products', {
      token: managerToken,
      body: {
        sku: 'SP-TEST-01',
        barcode: '8939999000101',
        name: 'Trà Sữa M2 Kiểm Thử',
        brand: 'RetailFlow',
        packSize: '350ml',
        categoryCode: 'DM01',
        unitCode: 'DVT02',
        supplierId: 'NCC001',
        salePrice: 25000,
        costPrice: 16000,
        stockQty: 20,
        minStock: 25,
        imageUrl: 'assets/images/products/oolong_tea.jpg',
      },
    });
    assert.equal(created.status, 201);
    const prod = created.data.item;
    assert.equal(prod.sku, 'SP-TEST-01');
    assert.equal(prod.isLowStock, true, '20 <= 25 must trigger low stock alert');

    // Duplicate barcode -> 409
    const dupBarcode = await srv.reqJson('POST', '/api/products', {
      token: managerToken,
      body: {
        sku: 'SP-TEST-02',
        barcode: '8939999000101',
        name: 'SP trùng barcode',
        categoryCode: 'DM01',
        unitCode: 'DVT02',
        supplierId: 'NCC001',
        salePrice: 25000,
        costPrice: 16000,
        imageUrl: 'assets/images/products/oolong_tea.jpg',
      },
    });
    assert.equal(dupBarcode.status, 409);

    // Verify KHOI_TAO_TON in LichSuTonKho
    const ledger = await srv.reqJson('GET', `/api/stock-movements?productId=${encodeURIComponent(prod.id)}`, {
      token: managerToken,
    });
    assert.equal(ledger.status, 200);
    assert.equal(ledger.data.items.length, 1);
    assert.equal(ledger.data.items[0].docType, 'KHOI_TAO_TON');
    assert.equal(ledger.data.items[0].stockBefore, 0);
    assert.equal(ledger.data.items[0].delta, 20);
    assert.equal(ledger.data.items[0].stockAfter, 20);

    // Hard DELETE product with stock_movements -> 409 Conflict (BR-01)
    const hardDel = await srv.reqJson('DELETE', `/api/products/${encodeURIComponent(prod.id)}`, {
      token: managerToken,
    });
    assert.equal(hardDel.status, 409);

    // Soft-Delete DangKinhDoanh -> NgungKinhDoanh -> DangKinhDoanh
    const stopRes = await srv.reqJson('PATCH', `/api/products/${encodeURIComponent(prod.id)}/status`, {
      token: managerToken,
      body: { status: 'NgungKinhDoanh' },
    });
    assert.equal(stopRes.status, 200);
    assert.equal(stopRes.data.item.status, 'NgungKinhDoanh');
    assert.equal(stopRes.data.item.active, false);

    const reopenRes = await srv.reqJson('PATCH', `/api/products/${encodeURIComponent(prod.id)}/status`, {
      token: managerToken,
      body: { status: 'DangKinhDoanh' },
    });
    assert.equal(reopenRes.status, 200);
    assert.equal(reopenRes.data.item.status, 'DangKinhDoanh');
  } finally {
    await srv.close();
  }
});

test('M2-04: BR-06 Atomic stock adjust + negative stock rejection + BR-08 date range & multi-criteria filtering', async () => {
  const srv = await startTestServer();
  try {
    const managerToken = await srv.loginAs('quanly');

    // Adjust SP006 (seeded stock 8 -> 20)
    const adj = await srv.reqJson('POST', '/api/products/SP006/stock-adjust', {
      token: managerToken,
      body: { newStock: 20, note: 'Bổ sung tồn kho từ kho dự phòng' },
    });
    assert.equal(adj.status, 200);
    assert.equal(adj.data.item.stockQty, 20);
    assert.equal(adj.data.movement.stockBefore, 8);
    assert.equal(adj.data.movement.delta, 12);
    assert.equal(adj.data.movement.stockAfter, 20);
    assert.equal(adj.data.movement.docType, 'DIEU_CHINH_TON');

    // Negative stock adjustment rejected (BR-06)
    const negAdj = await srv.reqJson('POST', '/api/products/SP006/stock-adjust', {
      token: managerToken,
      body: { delta: -999, note: 'Xuất âm không hợp lệ' },
    });
    assert.equal(negAdj.status, 400);
    // Verify stock stayed 20 (atomic rollback / unchanged)
    const checkProd = await srv.reqJson('GET', '/api/products/SP006', { token: managerToken });
    assert.equal(checkProd.data.item.stockQty, 20);

    // Multi-criteria search & price range
    const filtered = await srv.reqJson(
      'GET',
      '/api/products?categoryCode=DM01&minPrice=10000&maxPrice=40000&status=DangKinhDoanh',
      { token: managerToken },
    );
    assert.equal(filtered.status, 200);
    assert.ok(filtered.data.items.length > 0);
    for (const p of filtered.data.items) {
      assert.equal(p.categoryCode, 'DM01');
      assert.ok(p.salePrice >= 10000 && p.salePrice <= 40000);
    }

    // Invalid price range -> 400
    const badPrice = await srv.reqJson('GET', '/api/products?minPrice=50000&maxPrice=10000', {
      token: managerToken,
    });
    assert.equal(badPrice.status, 400);

    // Invalid date range on LichSuTonKho -> 400 (BR-08)
    const badDate = await srv.reqJson(
      'GET',
      '/api/stock-movements?fromDate=2026-12-31&toDate=2026-01-01',
      { token: managerToken },
    );
    assert.equal(badDate.status, 400);
  } finally {
    await srv.close();
  }
});

test('M2-05: Category, Unit & Supplier CRUD + Soft-Delete + referential hard-delete guard', async () => {
  const srv = await startTestServer();
  try {
    const managerToken = await srv.loginAs('quanly');

    // Category create + soft-delete + hard-delete block on used DM01
    const cat = await srv.reqJson('POST', '/api/categories', {
      token: managerToken,
      body: { name: 'Hàng đông lạnh', description: 'Kem, thịt cá đông lạnh' },
    });
    assert.equal(cat.status, 201);
    assert.equal(cat.data.item.code, 'DM07');

    const catDelUsed = await srv.reqJson('DELETE', '/api/categories/DM01', { token: managerToken });
    assert.equal(catDelUsed.status, 409);

    const catStop = await srv.reqJson('PATCH', '/api/categories/DM07/status', {
      token: managerToken,
      body: { status: 'NgungSuDung' },
    });
    assert.equal(catStop.status, 200);
    assert.equal(catStop.data.item.status, 'NgungSuDung');

    // Unit create + soft-delete
    const unit = await srv.reqJson('POST', '/api/units', {
      token: managerToken,
      body: { name: 'thùng' },
    });
    assert.equal(unit.status, 201);
    assert.equal(unit.data.item.code, 'DVT15');

    // Supplier create + update + soft-delete + hard-delete block on NCC001
    const sup = await srv.reqJson('POST', '/api/suppliers', {
      token: managerToken,
      body: {
        name: 'Công ty Thực phẩm Xanh',
        phone: '02839998877',
        categoryGroup: 'Hàng hữu cơ',
        areas: 'TP. HCM, Long An',
      },
    });
    assert.equal(sup.status, 201);
    assert.equal(sup.data.item.id, 'NCC011');

    const supStop = await srv.reqJson('PATCH', '/api/suppliers/NCC011/status', {
      token: managerToken,
      body: { status: 'NgungHopTac' },
    });
    assert.equal(supStop.status, 200);
    assert.equal(supStop.data.item.status, 'NgungHopTac');

    const supDelUsed = await srv.reqJson('DELETE', '/api/suppliers/NCC001', { token: managerToken });
    assert.equal(supDelUsed.status, 409);
  } finally {
    await srv.close();
  }
});
