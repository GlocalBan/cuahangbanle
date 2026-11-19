'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { openDatabase } = require('../src/server/dal/database.js');
const { computeFinancialMetrics } = require('../src/server/bll/reportService.js');
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

test('M5-01: Pure BR-08 financial metrics — DaThanhToan/TraMotPhan/DaHoanTra included, DaHuy/ChoDuyet excluded, zero COGS double-subtraction', () => {
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
      refund_amount: 54000, // 1 of 4 units
      payment_method: 'VIETQR',
      effective_at: '2026-11-18T14:00:00.000Z',
    },
    {
      id: 'TH2',
      order_id: 'HD3',
      status: 'DaXacNhan',
      refund_amount: 54000, // full return
      payment_method: 'CARD',
      effective_at: '2026-11-19T10:00:00.000Z',
    },
    {
      id: 'TH_PENDING',
      order_id: 'HD1',
      status: 'ChoDuyet',
      refund_amount: 54000,
      payment_method: 'CASH',
      effective_at: '2026-11-19T11:00:00.000Z',
    },
  ];

  const approvedReturnItems = [
    {
      return_id: 'TH1',
      product_id: 'P2',
      sku: 'SKU-2',
      product_name_snapshot: 'Sản phẩm B',
      category_code: 'CAT2',
      category_name: 'Bánh kẹo',
      unit_name: 'Hộp',
      qty: 1,
      refund_line_amount: 54000,
      unit_cost_snapshot: 35000,
      effective_at: '2026-11-18T14:00:00.000Z',
      payment_method: 'VIETQR',
    },
    {
      return_id: 'TH2',
      product_id: 'P1',
      sku: 'SKU-1',
      product_name_snapshot: 'Sản phẩm A',
      category_code: 'CAT1',
      category_name: 'Nước uống',
      unit_name: 'Chai',
      qty: 1,
      refund_line_amount: 54000,
      unit_cost_snapshot: 30000,
      effective_at: '2026-11-19T10:00:00.000Z',
      payment_method: 'CARD',
    },
    {
      return_id: 'TH_PENDING',
      product_id: 'P1',
      sku: 'SKU-1',
      product_name_snapshot: 'Sản phẩm A',
      category_code: 'CAT1',
      category_name: 'Nước uống',
      unit_name: 'Chai',
      qty: 1,
      refund_line_amount: 54000,
      unit_cost_snapshot: 30000,
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

  // Gross = 108,000 + 216,000 + 54,000 = 378,000 (HD_CANCEL excluded)
  assert.equal(m.summary.orderCount, 3);
  assert.equal(m.summary.grossRevenue, 378000);
  // Refund = 54,000 + 54,000 = 108,000 (TH_PENDING excluded)
  assert.equal(m.summary.returnCount, 2);
  assert.equal(m.summary.refundTotal, 108000);
  // Net Revenue = 378,000 - 108,000 = 270,000
  assert.equal(m.summary.netRevenue, 270000);
  // Gross COGS = 2*30,000 + 4*35,000 + 1*30,000 = 60,000 + 140,000 + 30,000 = 230,000
  // Returned COGS = 1*35,000 + 1*30,000 = 65,000
  // Net COGS = 230,000 - 65,000 = 165,000 (exact, zero double subtraction)
  assert.equal(m.summary.grossCogs, 230000);
  assert.equal(m.summary.returnedCogs, 65000);
  assert.equal(m.summary.netCogs, 165000);
  // Gross Profit = 270,000 - 165,000 = 105,000
  assert.equal(m.summary.grossProfit, 105000);

  // Category sums must reconcile exactly to grand summary
  const sumCatNet = m.categoryBreakdown.reduce((s, c) => s + c.netRevenue, 0);
  const sumCatProfit = m.categoryBreakdown.reduce((s, c) => s + c.grossProfit, 0);
  assert.equal(sumCatNet, m.summary.netRevenue);
  assert.equal(sumCatProfit, m.summary.grossProfit);
});

test('M5-02: End-to-end SQLite reports reconciliation across DaThanhToan, TraMotPhan, DaHoanTra & pending return exclusion', async () => {
  const srv = await startTestServer();
  try {
    const cashierToken = await srv.loginAs('thungan');
    const managerToken = await srv.loginAs('quanly');
    const today = new Date().toISOString().slice(0, 10);

    // Snapshot baseline for today before our 3 controlled transactions
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

    // 2) Order B (will become TraMotPhan): 3x p2, return 1x approved
    const oB = (
      await srv.reqJson('POST', '/api/pos/checkout', {
        token: cashierToken,
        body: { paymentMethod: 'VIETQR', paymentRef: 'M5REF001', items: [{ productId: p2.id, qty: 3 }] },
      })
    ).data.item;
    const rB = (
      await srv.reqJson('POST', '/api/returns', {
        token: cashierToken,
        body: { orderId: oB.id, reason: 'Trả 1 sản phẩm thử nghiệm M5', restock: true, items: [{ productId: p2.id, qty: 1 }] },
      })
    ).data.item;
    assert.equal((await srv.reqJson('POST', `/api/returns/${rB.id}/approve`, { token: managerToken })).status, 200);

    // 3) Order C (will become DaHoanTra): 1x p1, full return approved
    const oC = (
      await srv.reqJson('POST', '/api/pos/checkout', {
        token: cashierToken,
        body: { paymentMethod: 'CARD', paymentRef: 'M5CARD02', items: [{ productId: p1.id, qty: 1 }] },
      })
    ).data.item;
    const rC = (
      await srv.reqJson('POST', '/api/returns', {
        token: cashierToken,
        body: { orderId: oC.id, reason: 'Hoàn trả toàn bộ đơn C', restock: true, items: [{ productId: p1.id, qty: 1 }] },
      })
    ).data.item;
    assert.equal((await srv.reqJson('POST', `/api/returns/${rC.id}/approve`, { token: managerToken })).status, 200);

    // 4) Pending return on Order A (ChoDuyet — MUST NOT affect netRevenue or netCogs!)
    const rPending = await srv.reqJson('POST', '/api/returns', {
      token: cashierToken,
      body: { orderId: oA.id, reason: 'Phiếu chờ duyệt chưa được tính vào hoàn trả', restock: true, items: [{ productId: p1.id, qty: 1 }] },
    });
    assert.equal(rPending.status, 201);

    // Verify exact delta in /api/reports/sales
    const afterSales = await srv.reqJson('GET', `/api/reports/sales?fromDate=${today}&toDate=${today}`, {
      token: managerToken,
    });
    assert.equal(afterSales.status, 200);
    const a = afterSales.data.summary;

    const deltaGross = oA.totalAmount + oB.totalAmount + oC.totalAmount;
    const deltaRefund = rB.refundAmount + rC.refundAmount; // rPending excluded!
    const deltaNetRev = deltaGross - deltaRefund;
    const deltaGrossCogs = 2 * p1.costPrice + 3 * p2.costPrice + 1 * p1.costPrice;
    const deltaRetCogs = 1 * p2.costPrice + 1 * p1.costPrice;
    const deltaNetCogs = deltaGrossCogs - deltaRetCogs;
    const deltaProfit = deltaNetRev - deltaNetCogs;

    assert.equal(a.orderCount - b.orderCount, 3, 'Must include DaThanhToan, TraMotPhan, DaHoanTra');
    assert.equal(a.grossRevenue - b.grossRevenue, deltaGross);
    assert.equal(a.refundTotal - b.refundTotal, deltaRefund);
    assert.equal(a.netRevenue - b.netRevenue, deltaNetRev);
    assert.equal(a.netCogs - b.netCogs, deltaNetCogs);
    assert.equal(a.grossProfit - b.grossProfit, deltaProfit);

    // Verify Dashboard reflects pending return queue & exact today netRevenue
    const dash = await srv.reqJson('GET', '/api/reports/dashboard?days=7', { token: managerToken });
    assert.equal(dash.status, 200);
    assert.equal(dash.data.today.netRevenue, a.netRevenue);
    assert.ok(dash.data.queues.pendingReturns >= 1, 'Pending return must appear in dashboard queues');
    assert.ok(dash.data.series.length === 7, '7-day dashboard must return 7 series buckets');

    // Verify Inventory report totalCostValue matches raw SQLite SUM(stock_qty * cost_price)
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
      'fromDate > toDate on /api/reports/sales must return 400',
    );
    assert.equal(
      (await srv.reqJson('GET', '/api/reports/sales?fromDate=2026-02-31&toDate=2026-03-01', { token: adminToken })).status,
      400,
      'Invalid calendar date must return 400',
    );
    assert.equal(
      (await srv.reqJson('GET', '/api/reports/sales?groupBy=year', { token: adminToken })).status,
      400,
      'Unsupported groupBy must return 400',
    );
    assert.equal(
      (await srv.reqJson('GET', '/api/reports/dashboard?fromDate=2026-12-31&toDate=2026-01-01', { token: adminToken })).status,
      400,
      'fromDate > toDate on /api/reports/dashboard must return 400',
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

    // [method, path, expected: { unauth, admin, quanly, thungan, kho }]
    const matrix = [
      // M1 — Auth, Staff, THAM_SO, Audit Logs
      ['GET', '/api/staff', { unauth: 401, admin: 200, quanly: 403, thungan: 403, kho: 403 }],
      ['GET', '/api/tham-so', { unauth: 401, admin: 200, quanly: 403, thungan: 403, kho: 403 }],
      ['GET', '/api/audit-logs', { unauth: 401, admin: 200, quanly: 403, thungan: 403, kho: 403 }],

      // M2 — Catalog, Suppliers, Stock Ledger
      ['GET', '/api/products', { unauth: 401, admin: 200, quanly: 200, thungan: 200, kho: 200 }],
      ['GET', '/api/suppliers', { unauth: 401, admin: 200, quanly: 200, thungan: 403, kho: 200 }],
      ['GET', '/api/stock-movements', { unauth: 401, admin: 200, quanly: 200, thungan: 403, kho: 200 }],

      // M3 — Purchases & Stock Audits
      ['GET', '/api/purchases', { unauth: 401, admin: 200, quanly: 200, thungan: 403, kho: 200 }],
      ['GET', '/api/stock-audits', { unauth: 401, admin: 200, quanly: 200, thungan: 403, kho: 200 }],

      // M4 — Promotions, Customers, Orders, Returns
      ['GET', '/api/promotions', { unauth: 401, admin: 200, quanly: 200, thungan: 403, kho: 403 }],
      ['GET', '/api/promotions?activeOnly=true', { unauth: 401, admin: 200, quanly: 200, thungan: 200, kho: 403 }],
      ['GET', '/api/customers', { unauth: 401, admin: 200, quanly: 200, thungan: 200, kho: 403 }],
      ['GET', '/api/orders', { unauth: 401, admin: 200, quanly: 200, thungan: 200, kho: 403 }],
      ['GET', '/api/returns', { unauth: 401, admin: 200, quanly: 200, thungan: 200, kho: 403 }],

      // M5 — Dashboard, Financial Sales/Profit Report, Inventory Valuation Report
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
