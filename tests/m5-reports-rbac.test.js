'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { openDatabase } = require('../src/server/dal/database.js');
const { computeFinancialMetrics, splitRefundPreTaxAndTax } = require('../src/server/bll/reportService.js');
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

test('M5-01: Pure BR-08 accounting metrics — VAT excluded from netRevenuePreTax/grossProfit, COGS only credited on restock=1', () => {
  const orders = [
    {
      id: 'HD1',
      status: 'DaThanhToan',
      subtotal: 100000,
      invoice_discount: 0,
      tax_amount: 8000,
      total_amount: 108000,
      payment_method: 'CASH',
      created_at: '2026-11-18T10:00:00.000Z',
    },
    {
      id: 'HD2',
      status: 'TraMotPhan',
      subtotal: 200000,
      invoice_discount: 0,
      tax_amount: 16000,
      total_amount: 216000,
      payment_method: 'VIETQR',
      created_at: '2026-11-18T12:00:00.000Z',
    },
    {
      id: 'HD3',
      status: 'DaHoanTra',
      subtotal: 50000,
      invoice_discount: 0,
      tax_amount: 4000,
      total_amount: 54000,
      payment_method: 'CARD',
      created_at: '2026-11-19T08:00:00.000Z',
    },
    {
      id: 'HD_CANCEL',
      status: 'DaHuy',
      subtotal: 999000,
      invoice_discount: 0,
      tax_amount: 0,
      total_amount: 999000,
      payment_method: 'CASH',
      created_at: '2026-11-19T09:00:00.000Z',
    },
  ];

  const orderItems = [
    {
      id: 1,
      order_id: 'HD1',
      product_id: 'P1',
      sku: 'SKU-1',
      product_name_snapshot: 'Sản phẩm A',
      category_code: 'CAT1',
      category_name: 'Nước uống',
      unit_name: 'Chai',
      qty: 2,
      unit_price_snapshot: 50000,
      unit_cost_snapshot: 30000,
      line_discount: 0,
      order_subtotal: 100000,
      order_invoice_discount: 0,
      order_tax_amount: 8000,
      order_total_amount: 108000,
      order_created_at: '2026-11-18T10:00:00.000Z',
      payment_method: 'CASH',
    },
    {
      id: 2,
      order_id: 'HD2',
      product_id: 'P2',
      sku: 'SKU-2',
      product_name_snapshot: 'Sản phẩm B',
      category_code: 'CAT2',
      category_name: 'Bánh kẹo',
      unit_name: 'Hộp',
      qty: 4,
      unit_price_snapshot: 50000,
      unit_cost_snapshot: 35000,
      line_discount: 0,
      order_subtotal: 200000,
      order_invoice_discount: 0,
      order_tax_amount: 16000,
      order_total_amount: 216000,
      order_created_at: '2026-11-18T12:00:00.000Z',
      payment_method: 'VIETQR',
    },
    {
      id: 3,
      order_id: 'HD3',
      product_id: 'P1',
      sku: 'SKU-1',
      product_name_snapshot: 'Sản phẩm A',
      category_code: 'CAT1',
      category_name: 'Nước uống',
      unit_name: 'Chai',
      qty: 1,
      unit_price_snapshot: 50000,
      unit_cost_snapshot: 30000,
      line_discount: 0,
      order_subtotal: 50000,
      order_invoice_discount: 0,
      order_tax_amount: 4000,
      order_total_amount: 54000,
      order_created_at: '2026-11-19T08:00:00.000Z',
      payment_method: 'CARD',
    },
    {
      id: 4,
      order_id: 'HD_CANCEL',
      product_id: 'P1',
      sku: 'SKU-1',
      product_name_snapshot: 'Sản phẩm A',
      category_code: 'CAT1',
      category_name: 'Nước uống',
      unit_name: 'Chai',
      qty: 10,
      unit_price_snapshot: 99900,
      unit_cost_snapshot: 50000,
      line_discount: 0,
      order_subtotal: 999000,
      order_invoice_discount: 0,
      order_tax_amount: 0,
      order_total_amount: 999000,
      order_created_at: '2026-11-19T09:00:00.000Z',
      payment_method: 'CASH',
    },
  ];

  const approvedReturns = [
    {
      id: 'TH1',
      order_id: 'HD2',
      status: 'DaXacNhan',
      restock: 1, // Restocked -> COGS credited
      refund_amount: 54000, // 50,000 pre-tax + 4,000 VAT
      payment_method: 'VIETQR',
      order_subtotal: 200000,
      order_invoice_discount: 0,
      order_tax_amount: 16000,
      order_total_amount: 216000,
      effective_at: '2026-11-18T14:00:00.000Z',
    },
    {
      id: 'TH2',
      order_id: 'HD3',
      status: 'DaXacNhan',
      restock: 0, // Damaged / NOT restocked -> COGS NOT credited!
      refund_amount: 54000, // 50,000 pre-tax + 4,000 VAT
      payment_method: 'CARD',
      order_subtotal: 50000,
      order_invoice_discount: 0,
      order_tax_amount: 4000,
      order_total_amount: 54000,
      effective_at: '2026-11-19T10:00:00.000Z',
    },
    {
      id: 'TH_PENDING',
      order_id: 'HD1',
      status: 'ChoDuyet',
      restock: 1,
      refund_amount: 54000,
      payment_method: 'CASH',
      order_subtotal: 100000,
      order_invoice_discount: 0,
      order_tax_amount: 8000,
      order_total_amount: 108000,
      effective_at: '2026-11-19T11:00:00.000Z',
    },
  ];

  const approvedReturnItems = [
    {
      id: 11,
      return_id: 'TH1',
      order_id: 'HD2',
      product_id: 'P2',
      sku: 'SKU-2',
      product_name_snapshot: 'Sản phẩm B',
      category_code: 'CAT2',
      category_name: 'Bánh kẹo',
      unit_name: 'Hộp',
      qty: 1,
      restock: 1,
      refund_line_amount: 54000,
      unit_cost_snapshot: 35000,
      order_subtotal: 200000,
      order_invoice_discount: 0,
      order_tax_amount: 16000,
      order_total_amount: 216000,
      effective_at: '2026-11-18T14:00:00.000Z',
      payment_method: 'VIETQR',
    },
    {
      id: 12,
      return_id: 'TH2',
      order_id: 'HD3',
      product_id: 'P1',
      sku: 'SKU-1',
      product_name_snapshot: 'Sản phẩm A',
      category_code: 'CAT1',
      category_name: 'Nước uống',
      unit_name: 'Chai',
      qty: 1,
      restock: 0,
      refund_line_amount: 54000,
      unit_cost_snapshot: 30000,
      order_subtotal: 50000,
      order_invoice_discount: 0,
      order_tax_amount: 4000,
      order_total_amount: 54000,
      effective_at: '2026-11-19T10:00:00.000Z',
      payment_method: 'CARD',
    },
    {
      id: 13,
      return_id: 'TH_PENDING',
      order_id: 'HD1',
      product_id: 'P1',
      sku: 'SKU-1',
      product_name_snapshot: 'Sản phẩm A',
      category_code: 'CAT1',
      category_name: 'Nước uống',
      unit_name: 'Chai',
      qty: 1,
      restock: 1,
      refund_line_amount: 54000,
      unit_cost_snapshot: 30000,
      order_subtotal: 100000,
      order_invoice_discount: 0,
      order_tax_amount: 8000,
      order_total_amount: 108000,
      effective_at: '2026-11-19T11:00:00.000Z',
      payment_method: 'CASH',
    },
  ];

  const m = computeFinancialMetrics({
    orders,
    orderItems,
    approvedReturns,
    approvedReturnItems,
    fromDate: '2026-11-18',
    toDate: '2026-11-19',
    groupBy: 'day',
  });

  // Pre-tax gross = 100k + 200k + 50k = 350,000; grossTax = 8k + 16k + 4k = 28,000; grossCollected = 378,000
  assert.equal(m.summary.orderCount, 3);
  assert.equal(m.summary.grossRevenuePreTax, 350000);
  assert.equal(m.summary.grossTax, 28000);
  assert.equal(m.summary.grossCollected, 378000);

  // Approved refunds = TH1 (50k pre + 4k VAT) + TH2 (50k pre + 4k VAT) = 100k pre + 8k VAT = 108k total (TH_PENDING excluded)
  assert.equal(m.summary.returnCount, 2);
  assert.equal(m.summary.refundPreTax, 100000);
  assert.equal(m.summary.refundTax, 8000);
  assert.equal(m.summary.refundTotal, 108000);

  // Net Revenue Pre-Tax = 350k - 100k = 250,000; Net VAT = 28k - 8k = 20,000; Net Collected = 270,000
  assert.equal(m.summary.netRevenuePreTax, 250000);
  assert.equal(m.summary.netTax, 20000);
  assert.equal(m.summary.netCollected, 270000);

  // Gross COGS = 2*30k + 4*35k + 1*30k = 230,000
  // ONLY TH1 (restock=1) credits 35,000; TH2 (restock=0) is tracked in nonRestockedReturnCogs = 30,000, NOT subtracted from COGS!
  assert.equal(m.summary.grossCogs, 230000);
  assert.equal(m.summary.restockedReturnCogs, 35000);
  assert.equal(m.summary.nonRestockedReturnCogs, 30000);
  assert.equal(m.summary.netCogs, 195000);

  // Gross Profit strictly pre-tax: 250,000 - 195,000 = 55,000 (NOT inflated by 20,000 VAT, NOT inflated by 30,000 damaged stock)
  assert.equal(m.summary.grossProfit, 55000);
  assert.equal(m.summary.grossMarginPct, 22);

  // Category sums must reconcile exactly to grand summary
  const sumCatNetPre = m.categoryBreakdown.reduce((s, c) => s + c.netRevenuePreTax, 0);
  const sumCatProfit = m.categoryBreakdown.reduce((s, c) => s + c.grossProfit, 0);
  assert.equal(sumCatNetPre, m.summary.netRevenuePreTax);
  assert.equal(sumCatProfit, m.summary.grossProfit);
});

test('M5-02: End-to-end SQLite reports reconciliation across DaThanhToan, TraMotPhan, DaHoanTra & pending return exclusion', async () => {
  const srv = await startTestServer();
  try {
    const cashierToken = await srv.loginAs('thungan');
    const managerToken = await srv.loginAs('quanly');
    assert.equal((await srv.reqJson('POST', '/api/shifts/open', { token: cashierToken, body: { openingCash: 500000 } })).status, 201);
    const today = new Date().toISOString().slice(0, 10);

    const baseSales = await srv.reqJson('GET', `/api/reports/sales?fromDate=${today}&toDate=${today}`, {
      token: managerToken,
    });
    assert.equal(baseSales.status, 200);
    const b = baseSales.data.summary;

    const prods = (await srv.reqJson('GET', '/api/products?status=DangKinhDoanh', { token: managerToken })).data.items;
    const p1 = prods.find((p) => p.stockQty >= 10 && p.costPrice > 0);
    const p2 = prods.find((p) => p.id !== p1.id && p.stockQty >= 10 && p.costPrice > 0);

    // 1) Order A (DaThanhToan): 2x p1
    const oA = (
      await srv.reqJson('POST', '/api/pos/checkout', {
        token: cashierToken,
        body: { paymentMethod: 'CASH', cashReceived: p1.salePrice * 10, items: [{ productId: p1.id, qty: 2 }] },
      })
    ).data.item;

    // 2) Order B (TraMotPhan): 3x p2, return 1x approved with restock=true
    const oB = (
      await srv.reqJson('POST', '/api/pos/checkout', {
        token: cashierToken,
        body: { paymentMethod: 'VIETQR', paymentRef: 'M5REF001', items: [{ productId: p2.id, qty: 3 }] },
      })
    ).data.item;
    const rB = (
      await srv.reqJson('POST', '/api/returns', {
        token: cashierToken,
        body: { orderId: oB.id, reason: 'Trả 1 sản phẩm nguyên vẹn', restock: true, items: [{ productId: p2.id, qty: 1 }] },
      })
    ).data.item;
    assert.equal((await srv.reqJson('POST', `/api/returns/${rB.id}/approve`, { token: managerToken })).status, 200);

    // 3) Order C (DaHoanTra): 1x p1, full return approved with restock=true
    const oC = (
      await srv.reqJson('POST', '/api/pos/checkout', {
        token: cashierToken,
        body: { paymentMethod: 'CARD', paymentRef: 'M5CARD02', items: [{ productId: p1.id, qty: 1 }] },
      })
    ).data.item;
    const rC = (
      await srv.reqJson('POST', '/api/returns', {
        token: cashierToken,
        body: { orderId: oC.id, reason: 'Hoàn trả toàn bộ đơn C nguyên vẹn', restock: true, items: [{ productId: p1.id, qty: 1 }] },
      })
    ).data.item;
    assert.equal((await srv.reqJson('POST', `/api/returns/${rC.id}/approve`, { token: managerToken })).status, 200);

    // 4) Pending return on Order A (ChoDuyet — MUST NOT affect report metrics!)
    const rPending = await srv.reqJson('POST', '/api/returns', {
      token: cashierToken,
      body: { orderId: oA.id, reason: 'Phiếu chờ duyệt chưa tính', restock: true, items: [{ productId: p1.id, qty: 1 }] },
    });
    assert.equal(rPending.status, 201);

    const afterSales = await srv.reqJson('GET', `/api/reports/sales?fromDate=${today}&toDate=${today}`, {
      token: managerToken,
    });
    assert.equal(afterSales.status, 200);
    const a = afterSales.data.summary;

    const preA = oA.subtotal - oA.invoiceDiscount;
    const preB = oB.subtotal - oB.invoiceDiscount;
    const preC = oC.subtotal - oC.invoiceDiscount;
    const spB = splitRefundPreTaxAndTax(rB.refundAmount, preB, oB.totalAmount);
    const spC = splitRefundPreTaxAndTax(rC.refundAmount, preC, oC.totalAmount);

    const deltaGrossPre = preA + preB + preC;
    const deltaGrossTax = oA.taxAmount + oB.taxAmount + oC.taxAmount;
    const deltaGrossCollected = oA.totalAmount + oB.totalAmount + oC.totalAmount;
    const deltaRefundPre = spB.refundPreTax + spC.refundPreTax;
    const deltaRefundTax = spB.refundTax + spC.refundTax;
    const deltaRefundTotal = rB.refundAmount + rC.refundAmount;
    const deltaNetPre = deltaGrossPre - deltaRefundPre;
    const deltaNetTax = deltaGrossTax - deltaRefundTax;
    const deltaNetCollected = deltaGrossCollected - deltaRefundTotal;
    const deltaGrossCogs = 2 * p1.costPrice + 3 * p2.costPrice + 1 * p1.costPrice;
    const deltaRestockedCogs = 1 * p2.costPrice + 1 * p1.costPrice;
    const deltaNetCogs = deltaGrossCogs - deltaRestockedCogs;
    const deltaProfit = deltaNetPre - deltaNetCogs;

    assert.equal(a.orderCount - b.orderCount, 3);
    assert.equal(a.grossRevenuePreTax - b.grossRevenuePreTax, deltaGrossPre);
    assert.equal(a.netRevenuePreTax - b.netRevenuePreTax, deltaNetPre);
    assert.equal(a.netTax - b.netTax, deltaNetTax);
    assert.equal(a.netCollected - b.netCollected, deltaNetCollected);
    assert.equal(a.netCogs - b.netCogs, deltaNetCogs);
    assert.equal(a.grossProfit - b.grossProfit, deltaProfit);
    assert.equal(a.netRevenuePreTax + a.netTax, a.netCollected);

    const dash = await srv.reqJson('GET', '/api/reports/dashboard?days=7', { token: managerToken });
    assert.equal(dash.status, 200);
    assert.equal(dash.data.today.netRevenuePreTax, a.netRevenuePreTax);
    assert.equal(dash.data.today.grossProfit, a.grossProfit);
    assert.ok(dash.data.queues.pendingReturns >= 1);
    assert.equal(dash.data.series.length, 7);

    const invRes = await srv.reqJson('GET', '/api/reports/inventory', { token: managerToken });
    assert.equal(invRes.status, 200);
    const rawVal = srv.db.prepare('SELECT SUM(stock_qty * cost_price) AS val FROM products').get().val;
    assert.equal(invRes.data.summary.totalCostValue, rawVal);
  } finally {
    await srv.close();
  }
});

test('M5-03: BR-08 date range validation (fromDate > toDate, invalid format, invalid groupBy -> 400)', async () => {
  const srv = await startTestServer();
  try {
    const adminToken = await srv.loginAs('admin');

    assert.equal(
      (await srv.reqJson('GET', '/api/reports/sales?fromDate=2026-12-31&toDate=2026-01-01', { token: adminToken })).status,
      400,
    );
    assert.equal(
      (await srv.reqJson('GET', '/api/reports/sales?fromDate=2026-02-31&toDate=2026-03-01', { token: adminToken })).status,
      400,
    );
    assert.equal(
      (await srv.reqJson('GET', '/api/reports/sales?groupBy=year', { token: adminToken })).status,
      400,
    );
    assert.equal(
      (await srv.reqJson('GET', '/api/reports/dashboard?fromDate=2026-12-31&toDate=2026-01-01', { token: adminToken })).status,
      400,
    );
  } finally {
    await srv.close();
  }
});

test('M5-04: Full System 4-Role RBAC Matrix (401/403/200) spanning M1 -> M5', async () => {
  const srv = await startTestServer();
  try {
    const adminToken = await srv.loginAs('admin');
    const managerToken = await srv.loginAs('quanly');
    const cashierToken = await srv.loginAs('thungan');
    const khoToken = await srv.loginAs('kho');

    const matrix = [
      ['GET', '/api/staff', { unauth: 401, admin: 200, quanly: 403, thungan: 403, kho: 403 }],
      ['GET', '/api/tham-so', { unauth: 401, admin: 200, quanly: 403, thungan: 403, kho: 403 }],
      ['GET', '/api/audit-logs', { unauth: 401, admin: 200, quanly: 403, thungan: 403, kho: 403 }],

      ['GET', '/api/products', { unauth: 401, admin: 200, quanly: 200, thungan: 200, kho: 200 }],
      ['GET', '/api/suppliers', { unauth: 401, admin: 200, quanly: 200, thungan: 403, kho: 200 }],
      ['GET', '/api/stock-movements', { unauth: 401, admin: 200, quanly: 200, thungan: 403, kho: 200 }],

      ['GET', '/api/purchases', { unauth: 401, admin: 200, quanly: 200, thungan: 403, kho: 200 }],
      ['GET', '/api/stock-audits', { unauth: 401, admin: 200, quanly: 200, thungan: 403, kho: 200 }],

      ['GET', '/api/promotions', { unauth: 401, admin: 200, quanly: 200, thungan: 403, kho: 403 }],
      ['GET', '/api/promotions?activeOnly=true', { unauth: 401, admin: 200, quanly: 200, thungan: 200, kho: 403 }],
      ['GET', '/api/customers', { unauth: 401, admin: 200, quanly: 200, thungan: 200, kho: 403 }],
      ['GET', '/api/orders', { unauth: 401, admin: 200, quanly: 200, thungan: 200, kho: 403 }],
      ['GET', '/api/returns', { unauth: 401, admin: 200, quanly: 200, thungan: 200, kho: 403 }],

      ['GET', '/api/reports/dashboard', { unauth: 401, admin: 200, quanly: 200, thungan: 403, kho: 403 }],
      ['GET', '/api/reports/sales', { unauth: 401, admin: 200, quanly: 200, thungan: 403, kho: 403 }],
      ['GET', '/api/reports/inventory', { unauth: 401, admin: 200, quanly: 200, thungan: 403, kho: 200 }],
    ];

    for (const [method, path, exp] of matrix) {
      assert.equal((await srv.reqJson(method, path)).status, exp.unauth, `UNAUTH ${method} ${path}`);
      assert.equal((await srv.reqJson(method, path, { token: adminToken })).status, exp.admin, `ADMIN ${method} ${path}`);
      assert.equal((await srv.reqJson(method, path, { token: managerToken })).status, exp.quanly, `QUANLY ${method} ${path}`);
      assert.equal((await srv.reqJson(method, path, { token: cashierToken })).status, exp.thungan, `THUNGAN ${method} ${path}`);
      assert.equal((await srv.reqJson(method, path, { token: khoToken })).status, exp.kho, `KHO ${method} ${path}`);
    }
  } finally {
    await srv.close();
  }
});

test('M5-05: Accounting Patch Lock — Case A (8% VAT separation) & Case B (full return restock=1 vs restock=0 damaged loss)', async () => {
  const srv = await startTestServer();
  try {
    // Isolate clean test slate for orders/returns inside this in-memory test DB
    srv.db.exec('DELETE FROM return_items; DELETE FROM returns; DELETE FROM order_items; DELETE FROM orders;');

    const cashierToken = await srv.loginAs('thungan');
    const managerToken = await srv.loginAs('quanly');
    assert.equal((await srv.reqJson('POST', '/api/shifts/open', { token: cashierToken, body: { openingCash: 500000 } })).status, 201);
    const today = new Date().toISOString().slice(0, 10);

    const prods = (await srv.reqJson('GET', '/api/products?status=DangKinhDoanh', { token: managerToken })).data.items;
    const prod = prods.find((p) => p.stockQty >= 15 && p.salePrice >= 20000 && p.costPrice > 0);
    assert.ok(prod, 'Need active product with salePrice >= 20000 and costPrice > 0');

    // ── CASE A: Tách VAT 8% khỏi Doanh thu thuần & Lợi nhuận gộp ──────────────
    const ckA = (
      await srv.reqJson('POST', '/api/pos/checkout', {
        token: cashierToken,
        body: {
          paymentMethod: 'CASH',
          cashReceived: prod.salePrice * 10,
          items: [{ productId: prod.id, qty: 2 }],
        },
      })
    ).data.item;
    assert.equal(ckA.taxRate, 8);
    const expectedPreTaxA = prod.salePrice * 2;
    const expectedTaxA = Math.round((expectedPreTaxA * 8) / 100);
    const expectedCogsA = prod.costPrice * 2;
    assert.equal(ckA.taxAmount, expectedTaxA);

    const repA1 = (
      await srv.reqJson('GET', `/api/reports/sales?fromDate=${today}&toDate=${today}`, { token: managerToken })
    ).data.summary;

    assert.equal(repA1.grossRevenuePreTax, expectedPreTaxA);
    assert.equal(repA1.netRevenuePreTax, expectedPreTaxA);
    assert.equal(repA1.netTax, expectedTaxA);
    assert.equal(repA1.netCollected, expectedPreTaxA + expectedTaxA);
    assert.equal(repA1.netCogs, expectedCogsA);
    assert.equal(
      repA1.grossProfit,
      repA1.netRevenuePreTax - repA1.netCogs,
      'Gross profit must strictly equal netRevenuePreTax - netCogs (zero 8% VAT inflation)',
    );
    assert.notEqual(repA1.grossProfit, repA1.netCollected - repA1.netCogs);

    // Partial return of 1 unit (restock=true) -> verify netTax reduces by exact refunded VAT
    const retA = (
      await srv.reqJson('POST', '/api/returns', {
        token: cashierToken,
        body: { orderId: ckA.id, reason: 'Trả 1 sản phẩm kiểm chứng tách VAT', restock: true, items: [{ productId: prod.id, qty: 1 }] },
      })
    ).data.item;
    assert.equal((await srv.reqJson('POST', `/api/returns/${retA.id}/approve`, { token: managerToken })).status, 200);

    const repA2 = (
      await srv.reqJson('GET', `/api/reports/sales?fromDate=${today}&toDate=${today}`, { token: managerToken })
    ).data.summary;
    const spA = splitRefundPreTaxAndTax(retA.refundAmount, expectedPreTaxA, ckA.totalAmount);
    assert.equal(repA2.netRevenuePreTax, expectedPreTaxA - spA.refundPreTax);
    assert.equal(repA2.netTax, expectedTaxA - spA.refundTax);
    assert.equal(repA2.netCogs, prod.costPrice);
    assert.equal(repA2.grossProfit, repA2.netRevenuePreTax - repA2.netCogs);

    // ── CASE B1: Full return with restock = 1 -> netRevenuePreTax=0, netCogs=0, grossProfit=0 ──
    srv.db.exec('DELETE FROM return_items; DELETE FROM returns; DELETE FROM order_items; DELETE FROM orders;');

    const ckB1 = (
      await srv.reqJson('POST', '/api/pos/checkout', {
        token: cashierToken,
        body: {
          paymentMethod: 'VIETQR',
          paymentRef: 'CASEB1REF',
          items: [{ productId: prod.id, qty: 3 }],
        },
      })
    ).data.item;
    const retB1 = (
      await srv.reqJson('POST', '/api/returns', {
        token: cashierToken,
        body: { orderId: ckB1.id, reason: 'Trả toàn bộ hàng nguyên vẹn nhập lại kho', restock: true, items: [{ productId: prod.id, qty: 3 }] },
      })
    ).data.item;
    assert.equal((await srv.reqJson('POST', `/api/returns/${retB1.id}/approve`, { token: managerToken })).status, 200);

    const repB1 = (
      await srv.reqJson('GET', `/api/reports/sales?fromDate=${today}&toDate=${today}`, { token: managerToken })
    ).data.summary;
    assert.equal(repB1.netRevenuePreTax, 0, 'Full return (restock=1) must yield netRevenuePreTax === 0');
    assert.equal(repB1.netTax, 0, 'Full return must yield netTax === 0');
    assert.equal(repB1.netCollected, 0, 'Full return must yield netCollected === 0');
    assert.equal(repB1.netCogs, 0, 'Full return (restock=1) must yield netCogs === 0');
    assert.equal(repB1.nonRestockedReturnCogs, 0);
    assert.equal(repB1.grossProfit, 0, 'Full return (restock=1) must yield grossProfit === 0');

    // ── CASE B2: Full return with restock = 0 (damaged) -> netRevenuePreTax=0, netCogs=cost*qty, grossProfit=-netCogs ──
    srv.db.exec('DELETE FROM return_items; DELETE FROM returns; DELETE FROM order_items; DELETE FROM orders;');

    const ckB2 = (
      await srv.reqJson('POST', '/api/pos/checkout', {
        token: cashierToken,
        body: {
          paymentMethod: 'CASH',
          cashReceived: prod.salePrice * 10,
          items: [{ productId: prod.id, qty: 3 }],
        },
      })
    ).data.item;
    const retB2 = (
      await srv.reqJson('POST', '/api/returns', {
        token: cashierToken,
        body: { orderId: ckB2.id, reason: 'Hàng bị hỏng vỏ không thể nhập lại kho', restock: false, items: [{ productId: prod.id, qty: 3 }] },
      })
    ).data.item;
    assert.equal((await srv.reqJson('POST', `/api/returns/${retB2.id}/approve`, { token: managerToken })).status, 200);

    const repB2 = (
      await srv.reqJson('GET', `/api/reports/sales?fromDate=${today}&toDate=${today}`, { token: managerToken })
    ).data.summary;
    const expectedLossCogs = prod.costPrice * 3;
    assert.equal(repB2.netRevenuePreTax, 0, 'Full return (restock=0) must yield netRevenuePreTax === 0');
    assert.equal(repB2.netTax, 0, 'Full return (restock=0) must yield netTax === 0');
    assert.equal(repB2.restockedReturnCogs, 0, 'Damaged return (restock=0) must NOT credit COGS');
    assert.equal(repB2.nonRestockedReturnCogs, expectedLossCogs, 'Damaged return must be tracked in nonRestockedReturnCogs');
    assert.equal(repB2.netCogs, expectedLossCogs, 'Full return (restock=0) must keep netCogs === unit_cost_snapshot * qty');
    assert.equal(repB2.grossProfit, -expectedLossCogs, 'Full return (restock=0) must yield grossProfit === -netCogs');
  } finally {
    await srv.close();
  }
});
