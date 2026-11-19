'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { openDatabase } = require('../src/server/dal/database.js');
const { createRepositories } = require('../src/server/dal/repositories.js');
const { SystemService } = require('../src/server/bll/systemService.js');
const {
  SalesService,
  calculateOrderPricing,
  computePromotionDiscount,
} = require('../src/server/bll/salesService.js');
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

test('M4-01: Pure BR-04 pricing order (TamTinh -> GiamGiaHoaDon -> TienSauGiam -> ThueVAT -> TongThanhToan)', () => {
  // 1) PERCENT promotion with maxDiscount cap
  const p1 = calculateOrderPricing({
    items: [
      { qty: 3, unitPrice: 100000, lineDiscount: 0 },
      { qty: 2, unitPrice: 150000, lineDiscount: 20000 },
    ],
    promotion: { discountType: 'PERCENT', discountValue: 15, maxDiscount: 50000 },
    taxRate: 8,
  });
  // TamTinh = 300000 + 280000 = 580000
  // 15% of 580000 = 87000 -> capped at 50000
  // TienSauGiam = 530000; VAT 8% = 42400; TongThanhToan = 572400
  assert.equal(p1.subtotal, 580000);
  assert.equal(p1.invoiceDiscount, 50000);
  assert.equal(p1.afterDiscount, 530000);
  assert.equal(p1.taxAmount, 42400);
  assert.equal(p1.totalAmount, 572400);

  // 2) FIXED discount exceeding TamTinh must be clamped to TamTinh -> TongThanhToan >= 0
  const p2 = calculateOrderPricing({
    items: [{ qty: 1, unitPrice: 15000, lineDiscount: 0 }],
    promotion: { discountType: 'FIXED', discountValue: 50000, maxDiscount: 0 },
    taxRate: 10,
  });
  assert.equal(p2.subtotal, 15000);
  assert.equal(p2.invoiceDiscount, 15000);
  assert.equal(p2.afterDiscount, 0);
  assert.equal(p2.taxAmount, 0);
  assert.equal(p2.totalAmount, 0);

  // 3) Direct computePromotionDiscount without max cap
  assert.equal(
    computePromotionDiscount({ discountType: 'PERCENT', discountValue: 10, maxDiscount: 0 }, 250000),
    25000,
  );
});

test('M4-02: 401/403/200 RBAC matrix across Promotions, Customers, POS Checkout, Orders & Returns', async () => {
  const srv = await startTestServer();
  try {
    // Unauthenticated -> 401
    for (const [m, p] of [
      ['GET', '/api/promotions'],
      ['POST', '/api/promotions/validate'],
      ['GET', '/api/customers'],
      ['POST', '/api/pos/checkout'],
      ['GET', '/api/orders'],
      ['GET', '/api/returns'],
    ]) {
      assert.equal((await srv.reqJson(m, p)).status, 401, `${m} ${p} must return 401 without token`);
    }

    const khoToken = await srv.loginAs('kho');
    const cashierToken = await srv.loginAs('thungan');
    const managerToken = await srv.loginAs('quanly');
    const adminToken = await srv.loginAs('admin');

    // NhanVienKho -> 403 on ALL M4 endpoints
    assert.equal((await srv.reqJson('GET', '/api/promotions', { token: khoToken })).status, 403);
    assert.equal(
      (await srv.reqJson('POST', '/api/promotions/validate', { token: khoToken, body: { code: 'GIAM10', subtotal: 150000 } }))
        .status,
      403,
    );
    assert.equal((await srv.reqJson('GET', '/api/customers', { token: khoToken })).status, 403);
    assert.equal(
      (await srv.reqJson('POST', '/api/pos/checkout', { token: khoToken, body: { items: [] } })).status,
      403,
    );
    assert.equal((await srv.reqJson('GET', '/api/orders', { token: khoToken })).status, 403);
    assert.equal((await srv.reqJson('GET', '/api/returns', { token: khoToken })).status, 403);

    // ThuNgan -> 200 on POS/active promotions/customers/orders/returns-list; 403 on promo manage & return approve/reject
    assert.equal((await srv.reqJson('GET', '/api/promotions?activeOnly=true', { token: cashierToken })).status, 200);
    assert.equal((await srv.reqJson('GET', '/api/promotions', { token: cashierToken })).status, 403);
    assert.equal(
      (await srv.reqJson('POST', '/api/promotions', { token: cashierToken, body: { code: 'TEST1' } })).status,
      403,
    );
    assert.equal(
      (await srv.reqJson('PATCH', '/api/promotions/KM001/status', { token: cashierToken, body: { status: 'TamDung' } }))
        .status,
      403,
    );
    assert.equal((await srv.reqJson('GET', '/api/customers', { token: cashierToken })).status, 200);
    assert.equal((await srv.reqJson('GET', '/api/orders', { token: cashierToken })).status, 200);
    assert.equal((await srv.reqJson('GET', '/api/returns', { token: cashierToken })).status, 200);

    // Cashier creates a real order + return so we can check cost masking & approval 403
    const prodRes = await srv.reqJson('GET', '/api/products?status=DangKinhDoanh', { token: cashierToken });
    const prod = prodRes.data.items.find((x) => x.stockQty >= 5);
    const ck = await srv.reqJson('POST', '/api/pos/checkout', {
      token: cashierToken,
      body: {
        paymentMethod: 'CASH',
        cashReceived: prod.salePrice * 2 * 2,
        items: [{ productId: prod.id, qty: 2 }],
      },
    });
    assert.equal(ck.status, 201);
    const orderId = ck.data.item.id;

    // ThuNgan must NOT see unitCost in order detail; QuanLy & Admin CAN see unitCost
    const orderAsCashier = await srv.reqJson('GET', `/api/orders/${orderId}`, { token: cashierToken });
    assert.equal(orderAsCashier.status, 200);
    assert.equal(orderAsCashier.data.item.items[0].unitCost, undefined, 'unitCost must be hidden from ThuNgan');

    const orderAsManager = await srv.reqJson('GET', `/api/orders/${orderId}`, { token: managerToken });
    assert.equal(orderAsManager.status, 200);
    assert.equal(typeof orderAsManager.data.item.items[0].unitCost, 'number');

    // ThuNgan creates return -> 201; tries to approve/reject -> 403
    const retCreate = await srv.reqJson('POST', '/api/returns', {
      token: cashierToken,
      body: {
        orderId,
        reason: 'Khách đổi ý sau mua',
        restock: true,
        items: [{ productId: prod.id, qty: 1 }],
      },
    });
    assert.equal(retCreate.status, 201);
    const retId = retCreate.data.item.id;

    assert.equal(
      (await srv.reqJson('POST', `/api/returns/${retId}/approve`, { token: cashierToken })).status,
      403,
    );
    assert.equal(
      (await srv.reqJson('POST', `/api/returns/${retId}/reject`, { token: cashierToken })).status,
      403,
    );

    // QuanLy & Admin can list all promotions and approve returns
    assert.equal((await srv.reqJson('GET', '/api/promotions', { token: managerToken })).status, 200);
    assert.equal((await srv.reqJson('GET', '/api/promotions', { token: adminToken })).status, 200);
    assert.equal(
      (await srv.reqJson('POST', `/api/returns/${retId}/approve`, { token: managerToken })).status,
      200,
    );

    // Hard-DELETE forbidden (403) on promotions, orders, returns
    assert.equal((await srv.reqJson('DELETE', '/api/promotions/KM001', { token: adminToken })).status, 403);
    assert.equal((await srv.reqJson('DELETE', `/api/orders/${orderId}`, { token: adminToken })).status, 403);
    assert.equal((await srv.reqJson('DELETE', `/api/returns/${retId}`, { token: adminToken })).status, 403);
  } finally {
    await srv.close();
  }
});

test('M4-03: Promotions CRUD & BR-04 validation rules (status, dates, usage limit, min order amount)', async () => {
  const srv = await startTestServer();
  try {
    const managerToken = await srv.loginAs('quanly');
    const cashierToken = await srv.loginAs('thungan');

    const today = new Date().toISOString().slice(0, 10);
    const past1 = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);
    const past2 = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
    const future = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);

    // Invalid date range startDate > endDate -> 400
    const badDates = await srv.reqJson('POST', '/api/promotions', {
      token: managerToken,
      body: {
        code: 'BADDATE',
        name: 'Sai ngày',
        discountType: 'PERCENT',
        discountValue: 10,
        maxDiscount: 30000,
        minOrderAmount: 50000,
        startDate: future,
        endDate: today,
        usageLimit: 10,
        status: 'DangDienRa',
      },
    });
    assert.equal(badDates.status, 400);

    // Create expired promo (DangDienRa but endDate in past)
    const expRes = await srv.reqJson('POST', '/api/promotions', {
      token: managerToken,
      body: {
        code: 'HETHAN10',
        name: 'Mã đã hết hạn',
        discountType: 'PERCENT',
        discountValue: 10,
        maxDiscount: 20000,
        minOrderAmount: 0,
        startDate: past1,
        endDate: past2,
        usageLimit: 10,
        status: 'DangDienRa',
      },
    });
    assert.equal(expRes.status, 201);

    // Create 1-use promo to test usageLimit exhaustion
    const oneUse = await srv.reqJson('POST', '/api/promotions', {
      token: managerToken,
      body: {
        code: 'ONLYONE',
        name: 'Duy nhất 1 lượt',
        discountType: 'FIXED',
        discountValue: 10000,
        maxDiscount: 0,
        minOrderAmount: 50000,
        startDate: today,
        endDate: future,
        usageLimit: 1,
        status: 'DangDienRa',
      },
    });
    assert.equal(oneUse.status, 201);

    // Validate seeded SapDienRa (KM003 = SAPMO15) -> 400
    const rUpcoming = await srv.reqJson('POST', '/api/promotions/validate', {
      token: cashierToken,
      body: { code: 'SAPMO15', subtotal: 500000 },
    });
    assert.equal(rUpcoming.status, 400);

    // Validate expired promo -> 400
    const rExpired = await srv.reqJson('POST', '/api/promotions/validate', {
      token: cashierToken,
      body: { code: 'HETHAN10', subtotal: 200000 },
    });
    assert.equal(rExpired.status, 400);

    // Validate below minOrderAmount (GIAM10 requires 100,000) -> 400
    const rMin = await srv.reqJson('POST', '/api/promotions/validate', {
      token: cashierToken,
      body: { code: 'GIAM10', subtotal: 50000 },
    });
    assert.equal(rMin.status, 400);

    // Pause GIAM10 -> validate fails (400); resume -> validate succeeds (200)
    const pauseRes = await srv.reqJson('PATCH', '/api/promotions/KM001/status', {
      token: managerToken,
      body: { status: 'TamDung' },
    });
    assert.equal(pauseRes.status, 200);
    assert.equal(
      (
        await srv.reqJson('POST', '/api/promotions/validate', {
          token: cashierToken,
          body: { code: 'GIAM10', subtotal: 200000 },
        })
      ).status,
      400,
    );
    await srv.reqJson('PATCH', '/api/promotions/KM001/status', {
      token: managerToken,
      body: { status: 'DangDienRa' },
    });
    const okPromo = await srv.reqJson('POST', '/api/promotions/validate', {
      token: cashierToken,
      body: { code: 'GIAM10', subtotal: 200000 },
    });
    assert.equal(okPromo.status, 200);
    assert.equal(okPromo.data.discountAmount, 20000); // 10% of 200k

    // Exhaust ONLYONE via checkout, then second validate must fail (400)
    const prod = (await srv.reqJson('GET', '/api/products?status=DangKinhDoanh', { token: cashierToken })).data.items
      .find((x) => x.salePrice >= 20000 && x.stockQty >= 5);
    const qty = Math.ceil(60000 / prod.salePrice);
    const ck = await srv.reqJson('POST', '/api/pos/checkout', {
      token: cashierToken,
      body: {
        promotionCode: 'ONLYONE',
        paymentMethod: 'CASH',
        cashReceived: prod.salePrice * qty * 2,
        items: [{ productId: prod.id, qty }],
      },
    });
    assert.equal(ck.status, 201);
    const rExhausted = await srv.reqJson('POST', '/api/promotions/validate', {
      token: cashierToken,
      body: { code: 'ONLYONE', subtotal: 200000 },
    });
    assert.equal(rExhausted.status, 400);
  } finally {
    await srv.close();
  }
});

test('M4-04: POS Checkout (BR-03, BR-04, BR-05) — Price Snapshot, no negative stock, CASH/VietQR, double-pay 409 & paid immutability 403', async () => {
  const srv = await startTestServer();
  try {
    const cashierToken = await srv.loginAs('thungan');
    const managerToken = await srv.loginAs('quanly');
    const adminToken = await srv.loginAs('admin');

    const products = (await srv.reqJson('GET', '/api/products?status=DangKinhDoanh', { token: cashierToken })).data
      .items;
    const prod = products.find((p) => p.salePrice >= 25000 && p.stockQty >= 10);
    const originalPrice = prod.salePrice;
    const stockBefore = prod.stockQty;

    // 1) Ban negative stock (qty > stockQty -> 400)
    const overStock = await srv.reqJson('POST', '/api/pos/checkout', {
      token: cashierToken,
      body: {
        paymentMethod: 'CASH',
        cashReceived: 999999999,
        items: [{ productId: prod.id, qty: stockBefore + 1 }],
      },
    });
    assert.equal(overStock.status, 400);

    // 2) Ban selling NgungKinhDoanh product -> 400
    const stoppedProd = products.find((p) => p.id !== prod.id);
    await srv.reqJson('PATCH', `/api/products/${stoppedProd.id}/status`, {
      token: managerToken,
      body: { status: 'NgungKinhDoanh' },
    });
    const sellStopped = await srv.reqJson('POST', '/api/pos/checkout', {
      token: cashierToken,
      body: {
        paymentMethod: 'CASH',
        cashReceived: 500000,
        items: [{ productId: stoppedProd.id, qty: 1 }],
      },
    });
    assert.equal(sellStopped.status, 400);

    // 3) Ban CASH shortage (cashReceived < totalAmount -> 400)
    const qty = Math.max(4, Math.ceil(120000 / originalPrice));
    const expectedSub = qty * originalPrice;
    const shortCash = await srv.reqJson('POST', '/api/pos/checkout', {
      token: cashierToken,
      body: {
        paymentMethod: 'CASH',
        cashReceived: 1000,
        items: [{ productId: prod.id, qty }],
      },
    });
    assert.equal(shortCash.status, 400);

    // 4) Ban VietQR missing paymentRef -> 400
    const noRef = await srv.reqJson('POST', '/api/pos/checkout', {
      token: cashierToken,
      body: {
        paymentMethod: 'VIETQR',
        paymentRef: '',
        items: [{ productId: prod.id, qty: 1 }],
      },
    });
    assert.equal(noRef.status, 400);

    // 5) Valid CASH checkout with GIAM10 + tampered client price ignored (Price Snapshot from DB)
    const expectedDiscount = Math.min(50000, Math.round((expectedSub * 10) / 100));
    const expectedAfter = expectedSub - expectedDiscount;
    const expectedTax = Math.round((expectedAfter * 8) / 100);
    const expectedTotal = expectedAfter + expectedTax;
    const tendered = expectedTotal + 15000;

    const ck = await srv.reqJson('POST', '/api/pos/checkout', {
      token: cashierToken,
      body: {
        customerId: 'KH001',
        promotionCode: 'GIAM10',
        paymentMethod: 'CASH',
        cashReceived: tendered,
        items: [{ productId: prod.id, qty, unitPrice: 1 }], // tampered price must be ignored!
      },
    });
    assert.equal(ck.status, 201);
    const order = ck.data.item;
    assert.equal(order.subtotal, expectedSub);
    assert.equal(order.invoiceDiscount, expectedDiscount);
    assert.equal(order.taxRate, 8);
    assert.equal(order.taxAmount, expectedTax);
    assert.equal(order.totalAmount, expectedTotal);
    assert.equal(order.cashReceived, tendered);
    assert.equal(order.cashChange, 15000);
    assert.equal(order.items[0].unitPrice, originalPrice);

    // Verify stock deducted, BAN_HANG ledger written, and promo usedCount incremented
    const afterProd = (await srv.reqJson('GET', `/api/products/${prod.id}`, { token: managerToken })).data.item;
    assert.equal(afterProd.stockQty, stockBefore - qty);
    const movRes = await srv.reqJson('GET', `/api/stock-movements?docType=BAN_HANG&search=${order.id}`, {
      token: managerToken,
    });
    assert.equal(movRes.data.items.length, 1);
    assert.equal(movRes.data.items[0].delta, -qty);
    assert.equal(movRes.data.items[0].stockBefore, stockBefore);
    assert.equal(movRes.data.items[0].stockAfter, stockBefore - qty);

    const promoList = (await srv.reqJson('GET', '/api/promotions?search=GIAM10', { token: managerToken })).data.items;
    assert.equal(promoList[0].usedCount, 1);

    // 6) Change product salePrice -> old invoice item snapshot MUST stay unchanged!
    const newPrice = originalPrice + 9000;
    const updProd = await srv.reqJson('PUT', `/api/products/${prod.id}`, {
      token: managerToken,
      body: { salePrice: newPrice },
    });
    assert.equal(updProd.status, 200);
    const oldOrderRefetch = (await srv.reqJson('GET', `/api/orders/${order.id}`, { token: cashierToken })).data.item;
    assert.equal(oldOrderRefetch.items[0].unitPrice, originalPrice, 'Price snapshot must not change after product reprice');

    // 7) Valid VIETQR checkout with paymentRef
    const qrCk = await srv.reqJson('POST', '/api/pos/checkout', {
      token: cashierToken,
      body: {
        paymentMethod: 'VIETQR',
        paymentRef: 'VCB202600991',
        items: [{ productId: prod.id, qty: 1 }],
      },
    });
    assert.equal(qrCk.status, 201);
    assert.equal(qrCk.data.item.paymentMethod, 'VIETQR');
    assert.equal(qrCk.data.item.paymentRef, 'VCB202600991');

    // 8) Double payment -> 409 Conflict; Mutate/Delete paid order -> 403 Forbidden
    assert.equal((await srv.reqJson('POST', `/api/orders/${order.id}/pay`, { token: cashierToken })).status, 409);
    assert.equal(
      (await srv.reqJson('PUT', `/api/orders/${order.id}`, { token: adminToken, body: { note: 'hack' } })).status,
      403,
    );
    assert.equal((await srv.reqJson('DELETE', `/api/orders/${order.id}`, { token: adminToken })).status, 403);
  } finally {
    await srv.close();
  }
});

test('M4-05: Customer Returns (BR-05, BR-06, BR-08) — return window, partial/full restock & damaged non-restock, reject, date validation', async () => {
  const srv = await startTestServer();
  try {
    const cashierToken = await srv.loginAs('thungan');
    const managerToken = await srv.loginAs('quanly');

    const prod = (await srv.reqJson('GET', '/api/products?status=DangKinhDoanh', { token: cashierToken })).data.items
      .find((p) => p.stockQty >= 10);
    const initialStock = prod.stockQty;

    // Checkout 3 units
    const ck = await srv.reqJson('POST', '/api/pos/checkout', {
      token: cashierToken,
      body: {
        paymentMethod: 'CASH',
        cashReceived: prod.salePrice * 10,
        items: [{ productId: prod.id, qty: 3 }],
      },
    });
    assert.equal(ck.status, 201);
    const order = ck.data.item;
    const stockAfterSale = initialStock - 3;

    // 1) Over-quantity return (qty 4 > 3) -> 400
    const overRet = await srv.reqJson('POST', '/api/returns', {
      token: cashierToken,
      body: {
        orderId: order.id,
        reason: 'Trả vượt số lượng mua',
        restock: true,
        items: [{ productId: prod.id, qty: 4 }],
      },
    });
    assert.equal(overRet.status, 400);

    // 2) Create partial return (qty 2, restock: true) -> ChoDuyet does NOT change stock yet
    const r1 = await srv.reqJson('POST', '/api/returns', {
      token: cashierToken,
      body: {
        orderId: order.id,
        reason: 'Khách mua dư 2 sản phẩm nguyên vẹn',
        restock: true,
        items: [{ productId: prod.id, qty: 2 }],
      },
    });
    assert.equal(r1.status, 201);
    assert.equal(r1.data.item.status, 'ChoDuyet');
    assert.equal((await srv.reqJson('GET', `/api/products/${prod.id}`, { token: managerToken })).data.item.stockQty, stockAfterSale);

    // Approve r1 -> DaXacNhan, order TraMotPhan, stock +2, TRA_HANG ledger appended
    const app1 = await srv.reqJson('POST', `/api/returns/${r1.data.item.id}/approve`, { token: managerToken });
    assert.equal(app1.status, 200);
    assert.equal(app1.data.item.status, 'DaXacNhan');
    assert.equal((await srv.reqJson('GET', `/api/products/${prod.id}`, { token: managerToken })).data.item.stockQty, stockAfterSale + 2);
    assert.equal((await srv.reqJson('GET', `/api/orders/${order.id}`, { token: managerToken })).data.item.status, 'TraMotPhan');

    const traMovs = await srv.reqJson('GET', `/api/stock-movements?docType=TRA_HANG&search=${r1.data.item.id}`, {
      token: managerToken,
    });
    assert.equal(traMovs.data.items.length, 1);
    assert.equal(traMovs.data.items[0].delta, 2);

    // 3) Return remaining 1 unit as damaged (restock: false) -> Approve -> order DaHoanTra, stock unchanged, exact total refunded
    const r2 = await srv.reqJson('POST', '/api/returns', {
      token: cashierToken,
      body: {
        orderId: order.id,
        reason: 'Sản phẩm bị móp vỏ',
        restock: false,
        items: [{ productId: prod.id, qty: 1 }],
      },
    });
    assert.equal(r2.status, 201);
    const app2 = await srv.reqJson('POST', `/api/returns/${r2.data.item.id}/approve`, { token: managerToken });
    assert.equal(app2.status, 200);
    assert.equal((await srv.reqJson('GET', `/api/products/${prod.id}`, { token: managerToken })).data.item.stockQty, stockAfterSale + 2);
    const finalOrder = (await srv.reqJson('GET', `/api/orders/${order.id}`, { token: managerToken })).data.item;
    assert.equal(finalOrder.status, 'DaHoanTra');
    assert.equal(finalOrder.refundedAmount, order.totalAmount, 'Cumulative partial returns must sum exactly to paid total');

    // 4) Out-of-window order (> SoNgayChoPhepTraHang = 7 days) -> 400
    const repos = createRepositories(srv.db);
    const sysSvc = new SystemService(srv.db, repos);
    const salesSvc = new SalesService(srv.db, repos, sysSvc);
    const cashierUser = repos.users.findByUsername('thungan');
    const oldDate = new Date(Date.now() - 10 * 86400000).toISOString();
    const oldOrder = salesSvc.checkout(
      cashierUser,
      {
        paymentMethod: 'CASH',
        cashReceived: prod.salePrice * 5,
        items: [{ productId: prod.id, qty: 1 }],
      },
      { _createdAtOverride: oldDate },
    );
    const expiredRet = await srv.reqJson('POST', '/api/returns', {
      token: cashierToken,
      body: {
        orderId: oldOrder.id,
        reason: 'Trả hàng quá hạn 7 ngày',
        restock: true,
        items: [{ productId: prod.id, qty: 1 }],
      },
    });
    assert.equal(expiredRet.status, 400);

    // 5) Reject return flow -> TuChoi, no stock/refund change
    const ck3 = await srv.reqJson('POST', '/api/pos/checkout', {
      token: cashierToken,
      body: {
        paymentMethod: 'CASH',
        cashReceived: prod.salePrice * 5,
        items: [{ productId: prod.id, qty: 1 }],
      },
    });
    const r3 = await srv.reqJson('POST', '/api/returns', {
      token: cashierToken,
      body: {
        orderId: ck3.data.item.id,
        reason: 'Yêu cầu trả không đủ điều kiện',
        restock: true,
        items: [{ productId: prod.id, qty: 1 }],
      },
    });
    const rej3 = await srv.reqJson('POST', `/api/returns/${r3.data.item.id}/reject`, {
      token: managerToken,
      body: { reason: 'Hàng đã mở seal' },
    });
    assert.equal(rej3.status, 200);
    assert.equal(rej3.data.item.status, 'TuChoi');

    // 6) BR-08 date range validation (TuNgay > DenNgay -> 400)
    assert.equal(
      (await srv.reqJson('GET', '/api/orders?fromDate=2026-12-31&toDate=2026-01-01', { token: managerToken })).status,
      400,
    );
    assert.equal(
      (await srv.reqJson('GET', '/api/returns?fromDate=2026-12-31&toDate=2026-01-01', { token: managerToken })).status,
      400,
    );
  } finally {
    await srv.close();
  }
});

test('M4-06: Atomic DAL transaction rollback on mid-flight error in checkout() and approveReturn()', () => {
  const db = openDatabase(':memory:');
  try {
    const repos = createRepositories(db);
    const sysSvc = new SystemService(db, repos);
    const salesSvc = new SalesService(db, repos, sysSvc);
    const cashier = repos.users.findByUsername('thungan');
    const manager = repos.users.findByUsername('quanly');

    const prod = repos.products.list({ status: 'DangKinhDoanh' }).find((p) => p.sale_price >= 25000 && p.stock_qty >= 10);
    const stock0 = Number(prod.stock_qty);
    const qty = Math.max(4, Math.ceil(110000 / Number(prod.sale_price)));
    const ordersBefore = repos.orders.list({}).length;
    const movesBefore = db.prepare("SELECT COUNT(*) AS c FROM stock_movements WHERE doc_type = 'BAN_HANG'").get().c;
    const promoBefore = repos.promotions.findByCode('GIAM10').used_count;

    // 1) Inject failure inside checkout() transaction -> MUST rollback 100%
    assert.throws(
      () =>
        salesSvc.checkout(
          cashier,
          {
            promotionCode: 'GIAM10',
            paymentMethod: 'CASH',
            cashReceived: Number(prod.sale_price) * qty * 2,
            items: [{ productId: prod.id, qty }],
          },
          {
            _beforeCommitHook: () => {
              throw new Error('SIMULATED_CHECKOUT_DB_FAILURE');
            },
          },
        ),
      /SIMULATED_CHECKOUT_DB_FAILURE/,
    );

    assert.equal(repos.orders.list({}).length, ordersBefore, 'Orders table must rollback');
    assert.equal(repos.products.findById(prod.id).stock_qty, stock0, 'Product stock must rollback');
    assert.equal(
      db.prepare("SELECT COUNT(*) AS c FROM stock_movements WHERE doc_type = 'BAN_HANG'").get().c,
      movesBefore,
      'BAN_HANG movement must rollback',
    );
    assert.equal(repos.promotions.findByCode('GIAM10').used_count, promoBefore, 'Promotion used_count must rollback');

    // 2) Perform real checkout + create return, then inject failure inside approveReturn() -> MUST rollback 100%
    const okOrder = salesSvc.checkout(cashier, {
      paymentMethod: 'CASH',
      cashReceived: Number(prod.sale_price) * 5,
      items: [{ productId: prod.id, qty: 2 }],
    });
    const ret = salesSvc.createReturn(cashier, {
      orderId: okOrder.id,
      reason: 'Kiểm thử rollback hoàn tiền',
      restock: true,
      items: [{ productId: prod.id, qty: 1 }],
    });
    const stockBeforeApprove = repos.products.findById(prod.id).stock_qty;
    const traBefore = db.prepare("SELECT COUNT(*) AS c FROM stock_movements WHERE doc_type = 'TRA_HANG'").get().c;

    assert.throws(
      () =>
        salesSvc.approveReturn(manager, ret.id, {
          _beforeCommitHook: () => {
            throw new Error('SIMULATED_RETURN_APPROVE_FAILURE');
          },
        }),
      /SIMULATED_RETURN_APPROVE_FAILURE/,
    );

    assert.equal(repos.returns.findById(ret.id).status, 'ChoDuyet', 'Return status must stay ChoDuyet');
    assert.equal(repos.orders.findById(okOrder.id).status, 'DaThanhToan', 'Order status must stay DaThanhToan');
    assert.equal(repos.orders.findById(okOrder.id).items[0].returned_qty, 0, 'returned_qty must rollback to 0');
    assert.equal(repos.products.findById(prod.id).stock_qty, stockBeforeApprove, 'Product stock must rollback');
    assert.equal(
      db.prepare("SELECT COUNT(*) AS c FROM stock_movements WHERE doc_type = 'TRA_HANG'").get().c,
      traBefore,
      'TRA_HANG movement must rollback',
    );
  } finally {
    db.close();
  }
});

test('M4-07: M4 Patch — lineDiscount RBAC/THAM_SO limit, return approval window anchored to created_at, and overlapping pending returns cap', async () => {
  const srv = await startTestServer();
  try {
    const cashierToken = await srv.loginAs('thungan');
    const managerToken = await srv.loginAs('quanly');

    const prod = (await srv.reqJson('GET', '/api/products?status=DangKinhDoanh', { token: cashierToken })).data.items
      .find((p) => p.salePrice >= 20000 && p.stockQty >= 15);
    assert.ok(prod, 'Need active product with salePrice >= 20000 and stockQty >= 15');

    // (a) ThuNgan lineDiscount > 10% -> 403 Forbidden; <= 10% -> 201; QuanLy 30% -> 201 + logged in audit_logs
    const qty = 2;
    const lineGross = prod.salePrice * qty;
    const overLimit = Math.round(lineGross * 0.15); // 15% > 10% default TyLeGiamGiaDongToiDa
    const withinLimit = Math.floor(lineGross * 0.1); // <= 10%
    const managerDiscount = Math.round(lineGross * 0.3); // 30% allowed for QuanLy

    const cashierOver = await srv.reqJson('POST', '/api/pos/checkout', {
      token: cashierToken,
      body: {
        paymentMethod: 'CASH',
        cashReceived: lineGross * 2,
        items: [{ productId: prod.id, qty, lineDiscount: overLimit }],
      },
    });
    assert.equal(cashierOver.status, 403, 'ThuNgan exceeding TyLeGiamGiaDongToiDa must get 403');

    const cashierOk = await srv.reqJson('POST', '/api/pos/checkout', {
      token: cashierToken,
      body: {
        paymentMethod: 'CASH',
        cashReceived: lineGross * 2,
        items: [{ productId: prod.id, qty, lineDiscount: withinLimit }],
      },
    });
    assert.equal(cashierOk.status, 201, 'ThuNgan within 10% lineDiscount limit must succeed');
    assert.equal(cashierOk.data.item.subtotal, lineGross - withinLimit);

    const managerOk = await srv.reqJson('POST', '/api/pos/checkout', {
      token: managerToken,
      body: {
        paymentMethod: 'CASH',
        cashReceived: lineGross * 2,
        items: [{ productId: prod.id, qty, lineDiscount: managerDiscount }],
      },
    });
    assert.equal(managerOk.status, 201, 'QuanLy with 30% lineDiscount must succeed');
    assert.equal(managerOk.data.item.subtotal, lineGross - managerDiscount);

    const auditRow = srv.db
      .prepare("SELECT detail, after_json FROM audit_logs WHERE action = 'ORDER_CHECKOUT' AND entity_id = ?")
      .get(managerOk.data.item.id);
    assert.ok(auditRow, 'Audit log must exist for manager checkout');
    assert.equal(JSON.parse(auditRow.after_json).totalLineDiscount, managerDiscount);

    // (b) Return window anchored to returnSlip.created_at (order day 0, return created day 6, approved day 8 -> 200)
    const repos = createRepositories(srv.db);
    const sysSvc = new SystemService(srv.db, repos);
    const salesSvc = new SalesService(srv.db, repos, sysSvc);
    const cashierUser = repos.users.findByUsername('thungan');

    const order8DaysAgo = salesSvc.checkout(
      cashierUser,
      {
        paymentMethod: 'CASH',
        cashReceived: prod.salePrice * 5,
        items: [{ productId: prod.id, qty: 2 }],
      },
      { _createdAtOverride: new Date(Date.now() - 8 * 86400000).toISOString() },
    );
    const retFiledDay6 = salesSvc.createReturn(
      cashierUser,
      {
        orderId: order8DaysAgo.id,
        reason: 'Lập phiếu trả ngày thứ 6, quản lý duyệt ngày thứ 8',
        restock: true,
        items: [{ productId: prod.id, qty: 1 }],
      },
      { _createdAtOverride: new Date(Date.now() - 2 * 86400000).toISOString() },
    );
    assert.equal(retFiledDay6.status, 'ChoDuyet');

    const approveDay8 = await srv.reqJson('POST', `/api/returns/${retFiledDay6.id}/approve`, {
      token: managerToken,
    });
    assert.equal(approveDay8.status, 200, 'Approving return filed within 7-day window must succeed even after day 7');
    assert.equal(approveDay8.data.item.status, 'DaXacNhan');

    // (c) Overlapping ChoDuyet returns capped by (purchased - returned - pending)
    const ck5 = await srv.reqJson('POST', '/api/pos/checkout', {
      token: cashierToken,
      body: {
        paymentMethod: 'CASH',
        cashReceived: prod.salePrice * 10,
        items: [{ productId: prod.id, qty: 5 }],
      },
    });
    assert.equal(ck5.status, 201);
    const ord5Id = ck5.data.item.id;

    const pending1 = await srv.reqJson('POST', '/api/returns', {
      token: cashierToken,
      body: {
        orderId: ord5Id,
        reason: 'Phiếu chờ duyệt đợt 1 (3 sp)',
        restock: true,
        items: [{ productId: prod.id, qty: 3 }],
      },
    });
    assert.equal(pending1.status, 201);

    const overlapExceed = await srv.reqJson('POST', '/api/returns', {
      token: cashierToken,
      body: {
        orderId: ord5Id,
        reason: 'Phiếu trùng vượt số lượng còn lại (3 > 5 - 3)',
        restock: true,
        items: [{ productId: prod.id, qty: 3 }],
      },
    });
    assert.equal(overlapExceed.status, 400, 'Overlapping ChoDuyet return exceeding remaining qty must return 400');

    const overlapValid = await srv.reqJson('POST', '/api/returns', {
      token: cashierToken,
      body: {
        orderId: ord5Id,
        reason: 'Phiếu chờ duyệt đợt 2 hợp lệ (2 sp)',
        restock: true,
        items: [{ productId: prod.id, qty: 2 }],
      },
    });
    assert.equal(overlapValid.status, 201, 'Second pending return fitting remaining qty (2) must succeed');
  } finally {
    await srv.close();
  }
});
