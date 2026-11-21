'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { openDatabase } = require('../src/server/dal/database.js');
const { createApiRouter } = require('../src/server/routes/api.js');
const { todayYmdVn } = require('../src/server/bll/reportService.js');

function addDaysYmd(offsetDays) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

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

  async function reqJson(method, reqPath, { token = '', body = null, headers: extraHeaders = {} } = {}) {
    const headers = { Accept: 'application/json', ...extraHeaders };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== null) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${baseUrl}${reqPath}`, {
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

  async function openShift(token, openingCash = 500000) {
    const res = await reqJson('POST', '/api/shifts/open', { token, body: { openingCash } });
    assert.equal(res.status, 201, `openShift failed: ${JSON.stringify(res.data)}`);
    return res.data.item;
  }

  return {
    db,
    reqJson,
    loginAs,
    openShift,
    close: () =>
      new Promise((resolve) => {
        server.close(() => {
          db.close();
          resolve();
        });
      }),
  };
}

async function createIsolatedProduct(srv, token, overrides = {}) {
  const suffix = `${Date.now().toString().slice(-5)}${Math.floor(Math.random() * 900 + 100)}`;
  const payload = {
    sku: overrides.sku || `P2-SKU-${suffix}`,
    barcode: overrides.barcode || `893899${suffix}`.slice(0, 13),
    name: overrides.name || `Sản phẩm kiểm thử P2 ${suffix}`,
    categoryCode: overrides.categoryCode || 'DM01',
    unitCode: overrides.unitCode || 'DVT01',
    supplierId: overrides.supplierId || 'NCC001',
    salePrice: overrides.salePrice ?? 25000,
    costPrice: overrides.costPrice ?? 15000,
    stockQty: overrides.stockQty ?? 10,
    minStock: overrides.minStock ?? 2,
    hasExpiry: overrides.hasExpiry ?? true,
    expiryDate: overrides.expiryDate !== undefined ? overrides.expiryDate : addDaysYmd(120),
    imageUrl: 'assets/images/products/milk_vinamilk.jpg',
  };
  const res = await srv.reqJson('POST', '/api/products', { token, body: payload });
  assert.equal(res.status, 201, `createIsolatedProduct failed: ${JSON.stringify(res.data)}`);
  return res.data.item;
}

// ============================================================================
// MIGRATION GUARD: LEGACY DB UPGRADE TEST (PRE-P1/PRE-P2 SCHEMA -> CURRENT)
// ============================================================================

test('P2-MIG-01: Legacy SQLite DB missing refund_shift_id, credit_amount, and idempotency_key upgrades cleanly without crash', () => {
  const tmpFile = path.join(os.tmpdir(), `rf_fix_03_legacy_${Date.now()}_${Math.floor(Math.random() * 1000)}.sqlite`);
  try {
    // Construct a minimal legacy pre-P1/pre-P2 schema missing newer columns
    const raw = new DatabaseSync(tmpFile);
    raw.exec(`
      CREATE TABLE roles (code TEXT PRIMARY KEY, display_name TEXT NOT NULL, short_name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '');
      CREATE TABLE permissions (code TEXT PRIMARY KEY, module TEXT NOT NULL, description TEXT NOT NULL DEFAULT '');
      CREATE TABLE role_permissions (role_code TEXT NOT NULL, permission_code TEXT NOT NULL, PRIMARY KEY (role_code, permission_code));
      CREATE TABLE suppliers (id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', category_group TEXT NOT NULL DEFAULT '', areas TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'HoatDong', created_at TEXT NOT NULL);
      CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, full_name TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', role_code TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ACTIVE', must_change_password INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE orders (
        id TEXT PRIMARY KEY,
        customer_id TEXT,
        customer_name TEXT NOT NULL DEFAULT 'Khách lẻ',
        customer_phone TEXT NOT NULL DEFAULT '',
        cashier_id TEXT NOT NULL,
        cashier_name TEXT NOT NULL,
        promotion_id TEXT,
        promotion_code TEXT NOT NULL DEFAULT '',
        subtotal INTEGER NOT NULL DEFAULT 0,
        invoice_discount INTEGER NOT NULL DEFAULT 0,
        after_discount INTEGER NOT NULL DEFAULT 0,
        tax_rate REAL NOT NULL DEFAULT 8,
        tax_amount INTEGER NOT NULL DEFAULT 0,
        total_amount INTEGER NOT NULL DEFAULT 0,
        payment_method TEXT NOT NULL DEFAULT 'CASH',
        payment_ref TEXT NOT NULL DEFAULT '',
        cash_received INTEGER NOT NULL DEFAULT 0,
        cash_change INTEGER NOT NULL DEFAULT 0,
        refunded_amount INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'DaThanhToan',
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
      CREATE TABLE returns (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        restock INTEGER NOT NULL DEFAULT 1,
        refund_amount INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'ChoDuyet',
        created_by TEXT NOT NULL,
        created_by_name TEXT NOT NULL,
        approved_by TEXT,
        approved_by_name TEXT,
        reject_reason TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        approved_at TEXT
      );
      CREATE TABLE supplier_payables (
        id TEXT PRIMARY KEY,
        supplier_id TEXT NOT NULL,
        purchase_id TEXT NOT NULL,
        receipt_id TEXT,
        total_amount INTEGER NOT NULL DEFAULT 0,
        paid_amount INTEGER NOT NULL DEFAULT 0,
        balance_amount INTEGER NOT NULL DEFAULT 0,
        due_date TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'ChuaThanhToan',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    raw.prepare("INSERT INTO roles VALUES ('ADMIN', 'Admin', 'Admin', '')").run();
    raw.prepare("INSERT INTO users VALUES ('NV001', 'admin', 'legacyhash', 'Admin', '', '', 'ADMIN', 'ACTIVE', 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')").run();
    raw.prepare("INSERT INTO orders (id, cashier_id, cashier_name, total_amount, created_at) VALUES ('HD-LEGACY-1', 'NV001', 'Admin', 50000, '2026-01-01T00:00:00Z')").run();
    raw.close();

    // Opening with openDatabase() MUST NOT throw "no such column: refund_shift_id" or "idempotency_key"
    const upgraded = openDatabase(tmpFile);
    try {
      const orderCols = upgraded.prepare('PRAGMA table_info(orders)').all().map((c) => c.name);
      const returnCols = upgraded.prepare('PRAGMA table_info(returns)').all().map((c) => c.name);
      const apCols = upgraded.prepare('PRAGMA table_info(supplier_payables)').all().map((c) => c.name);
      assert.ok(orderCols.includes('idempotency_key'), 'orders.idempotency_key must be added by migration');
      assert.ok(returnCols.includes('refund_shift_id'), 'returns.refund_shift_id must be added by migration');
      assert.ok(apCols.includes('credit_amount'), 'supplier_payables.credit_amount must be added by migration');

      const idxNames = upgraded
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
        .all()
        .map((r) => r.name);
      assert.ok(idxNames.includes('idx_orders_idempotency_key'), 'idx_orders_idempotency_key must exist');
      assert.ok(idxNames.includes('idx_returns_refund_shift'), 'idx_returns_refund_shift must exist');

      const legacyOrder = upgraded.prepare('SELECT id, total_amount FROM orders WHERE id = ?').get('HD-LEGACY-1');
      assert.equal(legacyOrder.total_amount, 50000, 'Legacy order data must be preserved');
    } finally {
      upgraded.close();
    }
  } finally {
    for (const suffix of ['', '-wal', '-shm']) {
      if (fs.existsSync(`${tmpFile}${suffix}`)) fs.unlinkSync(`${tmpFile}${suffix}`);
    }
  }
});

// ============================================================================
// F-05C: OPEN SHIFT REQUIRED FOR CASH CHECKOUT
// ============================================================================

test('P2-F05C-01: Shiftless CASH checkout -> 409 OPEN_SHIFT_REQUIRED; VIETQR allowed without shift; open shift unlocks CASH', async () => {
  const srv = await startTestServer();
  try {
    const cashierToken = await srv.loginAs('thungan');

    const cashFail = await srv.reqJson('POST', '/api/pos/checkout', {
      token: cashierToken,
      body: { items: [{ productId: 'SP001', qty: 1 }], paymentMethod: 'CASH', cashReceived: 200000 },
    });
    assert.equal(cashFail.status, 409);
    assert.equal(cashFail.data.error?.code, 'OPEN_SHIFT_REQUIRED');

    // Non-cash VIETQR remains permitted without an open cash drawer shift
    const qrOk = await srv.reqJson('POST', '/api/pos/checkout', {
      token: cashierToken,
      body: { items: [{ productId: 'SP001', qty: 1 }], paymentMethod: 'VIETQR', paymentRef: 'QR-NOSHIFT-01' },
    });
    assert.equal(qrOk.status, 201, JSON.stringify(qrOk.data));
    assert.equal(qrOk.data.item.shiftId, null);

    // Opening shift unlocks CASH checkout
    const shift = await srv.openShift(cashierToken, 300000);
    const cashOk = await srv.reqJson('POST', '/api/pos/checkout', {
      token: cashierToken,
      body: { items: [{ productId: 'SP001', qty: 1 }], paymentMethod: 'CASH', cashReceived: 200000 },
    });
    assert.equal(cashOk.status, 201, JSON.stringify(cashOk.data));
    assert.equal(cashOk.data.item.shiftId, shift.id);
  } finally {
    await srv.close();
  }
});

// ============================================================================
// F-07A / F-07B / F-07C: WRITE-OFF SoD, LEDGER CONTINUITY & EXPIRED SWEEP
// ============================================================================

test('P2-F07A-01: Write-off approval enforces SoD (creator self-approval -> 403; distinct authorized actor -> 200)', async () => {
  const srv = await startTestServer();
  try {
    const managerToken = await srv.loginAs('quanly');
    const adminToken = await srv.loginAs('admin');
    const prod = await createIsolatedProduct(srv, managerToken, { stockQty: 5, expiryDate: addDaysYmd(30) });
    const batch = srv.db.prepare('SELECT id FROM product_batches WHERE product_id = ?').get(prod.id);

    const wo = await srv.reqJson('POST', '/api/writeoffs', {
      token: managerToken,
      body: {
        reason: 'Hư hỏng bao bì do rơi vỡ tại kệ',
        items: [{ batchId: batch.id, qty: 2 }],
      },
    });
    assert.equal(wo.status, 201, JSON.stringify(wo.data));

    // Self-approval by creator (quanly) -> 403 Forbidden
    const selfApp = await srv.reqJson('POST', `/api/writeoffs/${wo.data.item.id}/approve`, { token: managerToken });
    assert.equal(selfApp.status, 403);

    // Distinct authorized approver (admin) -> 200 OK
    const otherApp = await srv.reqJson('POST', `/api/writeoffs/${wo.data.item.id}/approve`, { token: adminToken });
    assert.equal(otherApp.status, 200, JSON.stringify(otherApp.data));
    assert.equal(otherApp.data.item.status, 'DaDuyet');
  } finally {
    await srv.close();
  }
});

test('P2-F07B-01: Expired-lot write-off preserves stock_movements continuity (stockBefore + delta === stockAfter) with expired tag', async () => {
  const srv = await startTestServer();
  try {
    const warehouseToken = await srv.loginAs('kho');
    const managerToken = await srv.loginAs('quanly');
    const prod = await createIsolatedProduct(srv, managerToken, { stockQty: 10, expiryDate: addDaysYmd(60) });

    // Add a separate expired lot on the same product (qty = 4)
    const expLotId = `LOT-F07B-EXP-${Date.now()}`;
    srv.db
      .prepare(
        `INSERT INTO product_batches (id, batch_code, product_id, mfg_date, expiry_date, initial_qty, qty_remaining, unit_cost, status, created_at)
         VALUES (?, ?, ?, '2025-01-01', '2025-06-01', 4, 4, 15000, 'HetHan', ?)`,
      )
      .run(expLotId, 'LO-F07B-EXP', prod.id, new Date().toISOString());

    const woExp = await srv.reqJson('POST', '/api/writeoffs', {
      token: warehouseToken,
      body: { reason: 'Xuất hủy lô hết hạn sử dụng', items: [{ batchId: expLotId, qty: 4 }] },
    });
    assert.equal(woExp.status, 201, JSON.stringify(woExp.data));
    const appExp = await srv.reqJson('POST', `/api/writeoffs/${woExp.data.item.id}/approve`, { token: managerToken });
    assert.equal(appExp.status, 200, JSON.stringify(appExp.data));

    const movExp = srv.db
      .prepare("SELECT * FROM stock_movements WHERE doc_type = 'HUY_HANG' AND doc_id = ? AND product_id = ?")
      .get(woExp.data.item.id, prod.id);
    assert.ok(movExp, 'Expired write-off must emit HUY_HANG ledger row');
    assert.equal(movExp.stock_before, 10);
    assert.equal(movExp.delta, 0, 'Salable stock delta must be 0 when writing off an already-expired lot');
    assert.equal(movExp.stock_after, 10);
    assert.equal(movExp.stock_before + movExp.delta, movExp.stock_after);
    assert.match(movExp.note, /\[Lô hết hạn -4 đv\]/);

    // Now write off 3 units from the salable lot -> delta MUST be -3 (10 -> 7)
    const salableLot = srv.db
      .prepare("SELECT id FROM product_batches WHERE product_id = ? AND status != 'DaHuy' AND qty_remaining > 0")
      .get(prod.id);
    const woSalable = await srv.reqJson('POST', '/api/writeoffs', {
      token: warehouseToken,
      body: { reason: 'Xuất hủy hàng bị bể vỡ tại kho', items: [{ batchId: salableLot.id, qty: 3 }] },
    });
    assert.equal(woSalable.status, 201);
    const appSalable = await srv.reqJson('POST', `/api/writeoffs/${woSalable.data.item.id}/approve`, { token: managerToken });
    assert.equal(appSalable.status, 200);

    const movSal = srv.db
      .prepare("SELECT * FROM stock_movements WHERE doc_type = 'HUY_HANG' AND doc_id = ? AND product_id = ?")
      .get(woSalable.data.item.id, prod.id);
    assert.equal(movSal.stock_before, 10);
    assert.equal(movSal.delta, -3);
    assert.equal(movSal.stock_after, 7);
    assert.equal(movSal.stock_before + movSal.delta, movSal.stock_after);
  } finally {
    await srv.close();
  }
});

test('P2-F07C-01: Auto expired-batch sweep removes elapsed lots from salable stock across catalog, reports, and POS', async () => {
  const srv = await startTestServer();
  try {
    const managerToken = await srv.loginAs('quanly');
    const cashierToken = await srv.loginAs('thungan');
    await srv.openShift(cashierToken);

    const prod = await createIsolatedProduct(srv, managerToken, { stockQty: 6, expiryDate: addDaysYmd(10) });
    const lot = srv.db.prepare('SELECT id FROM product_batches WHERE product_id = ?').get(prod.id);

    // Simulate time passing: batch is still marked 'ConHan' in DB, products.stock_qty is still 6, but expiry_date is past!
    srv.db.prepare("UPDATE product_batches SET expiry_date = '2020-01-01', status = 'ConHan' WHERE id = ?").run(lot.id);

    // Catalog GET must automatically sweep expired batch and report salable stockQty = 0
    const getProd = await srv.reqJson('GET', `/api/products/${prod.id}`, { token: managerToken });
    assert.equal(getProd.status, 200);
    assert.equal(getProd.data.item.stockQty, 0, 'Expired lot must be swept out of products.stockQty');
    const batchAfter = srv.db.prepare('SELECT status, qty_remaining FROM product_batches WHERE id = ?').get(lot.id);
    assert.equal(batchAfter.status, 'HetHan');
    assert.equal(batchAfter.qty_remaining, 6, 'Expired physical units remain on HetHan batch awaiting HUY_HANG write-off');

    // POS checkout MUST block selling expired product
    const sellExp = await srv.reqJson('POST', '/api/pos/checkout', {
      token: cashierToken,
      body: { items: [{ productId: prod.id, qty: 1 }], paymentMethod: 'CASH', cashReceived: 100000 },
    });
    assert.equal(sellExp.status, 400);

    // Inventory report & Dashboard both reflect swept salable stock = 0 and expiredBatchCount > 0
    const invRep = await srv.reqJson('GET', `/api/reports/inventory?search=${encodeURIComponent(prod.sku)}`, { token: managerToken });
    assert.equal(invRep.status, 200);
    assert.equal(invRep.data.items[0].stockQty, 0);

    const dash = await srv.reqJson('GET', '/api/reports/dashboard?days=7', { token: managerToken });
    assert.equal(dash.status, 200);
    assert.ok(dash.data.queues.expiredBatchCount >= 1);
  } finally {
    await srv.close();
  }
});

// ============================================================================
// F-08A / F-08B / F-08C / F-08D: IDEMPOTENCY, RETURN SoD, RECEIPT & 0-DRIFT
// ============================================================================

test('P2-F08A-01: Checkout Idempotency-Key replays cleanly (200 idempotentReplay, zero duplicate stock deduction) and rejects conflicting payload (409)', async () => {
  const srv = await startTestServer();
  try {
    const managerToken = await srv.loginAs('quanly');
    const cashierToken = await srv.loginAs('thungan');
    await srv.openShift(cashierToken);

    const prod = await createIsolatedProduct(srv, managerToken, { stockQty: 10, salePrice: 30000 });
    const key = `IDEMP-POS-${Date.now()}`;
    const body = { items: [{ productId: prod.id, qty: 2 }], paymentMethod: 'CASH', cashReceived: 100000 };

    // First call -> 201 Created
    const first = await srv.reqJson('POST', '/api/pos/checkout', {
      token: cashierToken,
      headers: { 'Idempotency-Key': key },
      body,
    });
    assert.equal(first.status, 201, JSON.stringify(first.data));
    assert.equal(first.data.idempotentReplay, undefined);

    // Exact replay -> 200 OK with idempotentReplay: true, same order ID, stock deducted ONLY ONCE (10 -> 8)
    const replay = await srv.reqJson('POST', '/api/pos/checkout', {
      token: cashierToken,
      headers: { 'Idempotency-Key': key },
      body,
    });
    assert.equal(replay.status, 200, JSON.stringify(replay.data));
    assert.equal(replay.data.idempotentReplay, true);
    assert.equal(replay.data.item.id, first.data.item.id);
    assert.equal(srv.db.prepare('SELECT stock_qty FROM products WHERE id = ?').get(prod.id).stock_qty, 8);
    assert.equal(srv.db.prepare('SELECT COUNT(*) AS c FROM orders WHERE idempotency_key = ?').get(key).c, 1);

    // Same key with DIFFERENT payload (qty 3 instead of 2) -> 409 IDEMPOTENCY_KEY_CONFLICT
    const conflict = await srv.reqJson('POST', '/api/pos/checkout', {
      token: cashierToken,
      headers: { 'Idempotency-Key': key },
      body: { items: [{ productId: prod.id, qty: 3 }], paymentMethod: 'CASH', cashReceived: 200000 },
    });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.data.error?.code, 'IDEMPOTENCY_KEY_CONFLICT');
    assert.equal(srv.db.prepare('SELECT stock_qty FROM products WHERE id = ?').get(prod.id).stock_qty, 8);
  } finally {
    await srv.close();
  }
});

test('P2-F08A-02: Duplicate non-cash paymentRef (case/whitespace normalized) returns 409 DUPLICATE_PAYMENT_REF', async () => {
  const srv = await startTestServer();
  try {
    const managerToken = await srv.loginAs('quanly');
    const cashierToken = await srv.loginAs('thungan');
    const prod = await createIsolatedProduct(srv, managerToken, { stockQty: 10, salePrice: 20000 });

    const r1 = await srv.reqJson('POST', '/api/pos/checkout', {
      token: cashierToken,
      body: { items: [{ productId: prod.id, qty: 1 }], paymentMethod: 'VIETQR', paymentRef: 'VCB-UNIQUE-901' },
    });
    assert.equal(r1.status, 201);

    const r2 = await srv.reqJson('POST', '/api/pos/checkout', {
      token: cashierToken,
      body: { items: [{ productId: prod.id, qty: 1 }], paymentMethod: 'VIETQR', paymentRef: '  vcb-unique-901  ' },
    });
    assert.equal(r2.status, 409);
    assert.equal(r2.data.error?.code, 'DUPLICATE_PAYMENT_REF');
    assert.equal(srv.db.prepare('SELECT stock_qty FROM products WHERE id = ?').get(prod.id).stock_qty, 9);
  } finally {
    await srv.close();
  }
});

test('P2-F08B-01: Return approval enforces SoD (creator self-approval -> 403; distinct authorized actor -> 200)', async () => {
  const srv = await startTestServer();
  try {
    const managerToken = await srv.loginAs('quanly');
    const adminToken = await srv.loginAs('admin');
    const prod = await createIsolatedProduct(srv, managerToken, { stockQty: 10, salePrice: 20000 });

    const ck = await srv.reqJson('POST', '/api/pos/checkout', {
      token: managerToken,
      body: { items: [{ productId: prod.id, qty: 2 }], paymentMethod: 'VIETQR', paymentRef: 'QR-F08B-01' },
    });
    assert.equal(ck.status, 201);

    const ret = await srv.reqJson('POST', '/api/returns', {
      token: managerToken,
      body: { orderId: ck.data.item.id, reason: 'Khách đổi ý', restock: true, items: [{ productId: prod.id, qty: 1 }] },
    });
    assert.equal(ret.status, 201);

    // Self-approval by creator (quanly) -> 403
    const selfApp = await srv.reqJson('POST', `/api/returns/${ret.data.item.id}/approve`, { token: managerToken });
    assert.equal(selfApp.status, 403);

    // Distinct authorized approver (admin) -> 200
    const adminApp = await srv.reqJson('POST', `/api/returns/${ret.data.item.id}/approve`, { token: adminToken });
    assert.equal(adminApp.status, 200);
    assert.equal(adminApp.data.item.status, 'DaXacNhan');
  } finally {
    await srv.close();
  }
});

test('P2-F08C-01: Receipt template renders both promotionCode and voucherCode on invoice discount line', () => {
  const ordersUi = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'orders.js'), 'utf8');
  assert.match(ordersUi, /o\.promotionCode/);
  assert.match(ordersUi, /o\.voucherCode/);
});

test('P2-F08D-01: Sequential partial returns (1+1+1 of 3 units) with non-divisible total have 0 VND rounding drift', async () => {
  const srv = await startTestServer();
  try {
    const managerToken = await srv.loginAs('quanly');
    const cashierToken = await srv.loginAs('thungan');
    // unitPrice = 10,001 -> qty 3 -> subtotal 30,003 -> 8% VAT = 2,400 -> total = 32,403 (32,403 % 3 === 0? Wait: 32,403 / 3 = 10,801).
    // Pick unitPrice = 10,003 -> qty 3 -> subtotal 30,009 -> 8% VAT = Math.round(2400.72)=2401 -> total = 32,410 (32,410 % 3 === 1 -> non-divisible by 3!)
    const prod = await createIsolatedProduct(srv, managerToken, { stockQty: 10, salePrice: 10003, costPrice: 5000 });

    const ck = await srv.reqJson('POST', '/api/pos/checkout', {
      token: cashierToken,
      body: { items: [{ productId: prod.id, qty: 3 }], paymentMethod: 'VIETQR', paymentRef: 'QR-F08D-01' },
    });
    assert.equal(ck.status, 201);
    const totalPaid = ck.data.item.totalAmount;
    assert.equal(totalPaid, 32410, 'Expected non-divisible-by-3 total of 32,410 VND');

    // Return #1 (1 unit) -> approved
    const r1 = await srv.reqJson('POST', '/api/returns', {
      token: cashierToken,
      body: { orderId: ck.data.item.id, reason: 'Trả đợt 1', restock: true, items: [{ productId: prod.id, qty: 1 }] },
    });
    assert.equal((await srv.reqJson('POST', `/api/returns/${r1.data.item.id}/approve`, { token: managerToken })).status, 200);

    // Rejected return mid-way MUST NOT corrupt remaining allocation
    const rRej = await srv.reqJson('POST', '/api/returns', {
      token: cashierToken,
      body: { orderId: ck.data.item.id, reason: 'Phiếu bị từ chối', restock: true, items: [{ productId: prod.id, qty: 1 }] },
    });
    assert.equal(
      (await srv.reqJson('POST', `/api/returns/${rRej.data.item.id}/reject`, { token: managerToken, body: { reason: 'Hủy kiểm thử' } }))
        .status,
      200,
    );

    // Return #2 (1 unit) -> approved
    const r2 = await srv.reqJson('POST', '/api/returns', {
      token: cashierToken,
      body: { orderId: ck.data.item.id, reason: 'Trả đợt 2', restock: true, items: [{ productId: prod.id, qty: 1 }] },
    });
    assert.equal((await srv.reqJson('POST', `/api/returns/${r2.data.item.id}/approve`, { token: managerToken })).status, 200);

    // Return #3 (final 1 unit) -> absorbs rounding remainder -> exact 0 VND drift!
    const r3 = await srv.reqJson('POST', '/api/returns', {
      token: cashierToken,
      body: { orderId: ck.data.item.id, reason: 'Trả đợt 3 cuối cùng', restock: true, items: [{ productId: prod.id, qty: 1 }] },
    });
    assert.equal((await srv.reqJson('POST', `/api/returns/${r3.data.item.id}/approve`, { token: managerToken })).status, 200);

    const sumRefunds = r1.data.item.refundAmount + r2.data.item.refundAmount + r3.data.item.refundAmount;
    assert.equal(sumRefunds, totalPaid, `Cumulative partial refunds (${sumRefunds}) must equal paid total (${totalPaid}) with 0 VND drift`);
  } finally {
    await srv.close();
  }
});

// ============================================================================
// F-09A / F-09B / F-09C: CATEGORY WRITEOFF, AUDIT SHRINKAGE & UTC+7 DATES
// ============================================================================

test('P2-F09A-01: Category-filtered sales report scopes writeoffLoss strictly to the selected category', async () => {
  const srv = await startTestServer();
  try {
    const warehouseToken = await srv.loginAs('kho');
    const managerToken = await srv.loginAs('quanly');
    const prodDm01 = await createIsolatedProduct(srv, managerToken, {
      categoryCode: 'DM01',
      stockQty: 5,
      costPrice: 12000,
      salePrice: 20000,
    });
    const batch = srv.db.prepare('SELECT id FROM product_batches WHERE product_id = ?').get(prodDm01.id);

    const wo = await srv.reqJson('POST', '/api/writeoffs', {
      token: warehouseToken,
      body: { reason: 'Hủy thử danh mục DM01', items: [{ batchId: batch.id, qty: 2 }] },
    });
    assert.equal((await srv.reqJson('POST', `/api/writeoffs/${wo.data.item.id}/approve`, { token: managerToken })).status, 200);

    const today = todayYmdVn();
    const repDm01 = await srv.reqJson('GET', `/api/reports/sales?fromDate=${today}&toDate=${today}&categoryCode=DM01`, {
      token: managerToken,
    });
    const repDm02 = await srv.reqJson('GET', `/api/reports/sales?fromDate=${today}&toDate=${today}&categoryCode=DM02`, {
      token: managerToken,
    });
    assert.equal(repDm01.status, 200);
    assert.equal(repDm02.status, 200);
    assert.equal(repDm01.data.summary.writeoffLoss, 24000);
    assert.equal(repDm02.data.summary.writeoffLoss, 0);
  } finally {
    await srv.close();
  }
});

test('P2-F09B-01: Approved negative stocktake shrinkage is included in totalShrinkageLoss and netProfitAfterShrinkage', async () => {
  const srv = await startTestServer();
  try {
    const warehouseToken = await srv.loginAs('kho');
    const managerToken = await srv.loginAs('quanly');
    const prod = await createIsolatedProduct(srv, managerToken, {
      categoryCode: 'DM05',
      stockQty: 10,
      costPrice: 10000,
      salePrice: 20000,
    });

    // Warehouse submits stock audit with -2 shrinkage (actualQty = 8 vs systemQty = 10 -> loss 20,000)
    const audit = await srv.reqJson('POST', '/api/stock-audits', {
      token: warehouseToken,
      body: {
        note: 'Kiểm kê kiểm chứng hao hụt F-09B',
        items: [{ productId: prod.id, actualQty: 8, reasonCode: 'MAT_HANG', reason: 'Thiếu 2 đơn vị khi kiểm kho' }],
      },
    });
    assert.equal(audit.status, 201, JSON.stringify(audit.data));
    const app = await srv.reqJson('POST', `/api/stock-audits/${audit.data.item.id}/approve`, { token: managerToken });
    assert.equal(app.status, 200, JSON.stringify(app.data));

    const today = todayYmdVn();
    const repDm05 = await srv.reqJson('GET', `/api/reports/sales?fromDate=${today}&toDate=${today}&categoryCode=DM05`, {
      token: managerToken,
    });
    assert.equal(repDm05.status, 200);
    assert.equal(repDm05.data.summary.auditShrinkageLoss, 20000);
    assert.equal(repDm05.data.summary.auditShrinkageQty, 2);
    assert.equal(repDm05.data.summary.totalShrinkageLoss, repDm05.data.summary.writeoffLoss + 20000);
    assert.equal(
      repDm05.data.summary.netProfitAfterShrinkage,
      repDm05.data.summary.grossProfit - repDm05.data.summary.totalShrinkageLoss,
    );

    const repDm02 = await srv.reqJson('GET', `/api/reports/sales?fromDate=${today}&toDate=${today}&categoryCode=DM02`, {
      token: managerToken,
    });
    assert.equal(repDm02.data.summary.auditShrinkageLoss, 0);

    const dash = await srv.reqJson('GET', '/api/reports/dashboard?days=7', { token: managerToken });
    assert.equal(dash.status, 200);
    assert.ok(dash.data.summary.auditShrinkageLoss >= 20000);
    assert.equal(
      dash.data.summary.netProfitAfterShrinkage,
      dash.data.summary.grossProfit - dash.data.summary.totalShrinkageLoss,
    );
  } finally {
    await srv.close();
  }
});

test('P2-F09C-01: todayYmdVn() uses Asia/Ho_Chi_Minh (UTC+7) and dashboard defaults to VN date', async () => {
  // 2026-11-21 18:30 UTC is 2026-11-22 01:30 ICT (UTC+7)
  assert.equal(todayYmdVn(new Date('2026-11-21T18:30:00.000Z')), '2026-11-22');
  // 2026-11-21 16:59 UTC is 2026-11-21 23:59 ICT (UTC+7)
  assert.equal(todayYmdVn(new Date('2026-11-21T16:59:59.000Z')), '2026-11-21');

  const srv = await startTestServer();
  try {
    const managerToken = await srv.loginAs('quanly');
    const dash = await srv.reqJson('GET', '/api/reports/dashboard?days=7', { token: managerToken });
    assert.equal(dash.status, 200);
    assert.equal(dash.data.period.today, todayYmdVn());
    assert.equal(dash.data.period.toDate, todayYmdVn());
  } finally {
    await srv.close();
  }
});

// ============================================================================
// F-11A / F-11B / F-10: SCHEMA FKs, DRAFT PO UPDATE & UI SEMANTICS
// ============================================================================

test('P2-F11A-01: Fresh schema enforces all newly added Foreign Keys and passes PRAGMA foreign_key_check', () => {
  const db = openDatabase(':memory:');
  try {
    const fkCheck = db.prepare('PRAGMA foreign_key_check').all();
    assert.deepEqual(fkCheck, [], 'Seeded DB must have zero foreign key violations');

    const expectedFks = [
      ['users', 'supplier_id', 'suppliers'],
      ['audit_logs', 'actor_id', 'users'],
      ['product_batches', 'purchase_id', 'purchases'],
      ['voucher_redemptions', 'order_id', 'orders'],
      ['voucher_redemptions', 'customer_id', 'customers'],
      ['purchase_negotiations', 'actor_id', 'users'],
      ['supplier_payables', 'receipt_id', 'purchase_receipts'],
      ['supplier_credits', 'supplier_return_id', 'supplier_returns'],
      ['supplier_credits', 'payable_id', 'supplier_payables'],
      ['supplier_returns', 'purchase_id', 'purchases'],
      ['supplier_return_items', 'batch_id', 'product_batches'],
      ['orders', 'shift_id', 'cashier_shifts'],
      ['orders', 'voucher_id', 'vouchers'],
      ['order_item_batches', 'order_item_id', 'order_items'],
      ['order_item_batches', 'batch_id', 'product_batches'],
      ['returns', 'refund_shift_id', 'cashier_shifts'],
      ['stock_audits', 'assigned_to', 'users'],
      ['stock_audits', 'recount_by', 'users'],
      ['stock_audit_items', 'batch_id', 'product_batches'],
      ['stock_audit_rounds', 'counted_by', 'users'],
    ];

    for (const [tableName, fromCol, refTable] of expectedFks) {
      const fks = db.prepare(`PRAGMA foreign_key_list(${tableName})`).all();
      const found = fks.some((fk) => fk.from === fromCol && fk.table === refTable);
      assert.ok(found, `Missing FK ${tableName}.${fromCol} -> ${refTable}`);
    }
  } finally {
    db.close();
  }
});

test('P2-F11B-01: PUT /api/purchases/:id preserves/updates expectedDeliveryDate, validates format, and returns hydrated detail', async () => {
  const srv = await startTestServer();
  try {
    const warehouseToken = await srv.loginAs('kho');
    const expDelivery = addDaysYmd(7);
    const created = await srv.reqJson('POST', '/api/purchases', {
      token: warehouseToken,
      body: {
        supplierId: 'NCC001',
        expectedDeliveryDate: expDelivery,
        note: 'PO nháp kiểm thử F-11B',
        items: [{ productId: 'SP001', qty: 5, unitCost: 20000, expiryDate: addDaysYmd(180) }],
      },
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const poId = created.data.item.id;

    // 1) Omit expectedDeliveryDate on PUT -> MUST preserve existing value & return hydrated fields
    const upd1 = await srv.reqJson('PUT', `/api/purchases/${poId}`, {
      token: warehouseToken,
      body: {
        supplierId: 'NCC001',
        note: 'Cập nhật ghi chú giữ ngày giao',
        items: [{ productId: 'SP001', qty: 6, unitCost: 21000, expiryDate: addDaysYmd(180) }],
      },
    });
    assert.equal(upd1.status, 200, JSON.stringify(upd1.data));
    assert.equal(upd1.data.item.expectedDeliveryDate, expDelivery);
    assert.ok(Array.isArray(upd1.data.item.negotiations), 'Hydrated PO must include negotiations array');
    assert.ok(Array.isArray(upd1.data.item.receipts), 'Hydrated PO must include receipts array');

    // 2) Update expectedDeliveryDate to valid date -> updated
    const newDelivery = addDaysYmd(12);
    const upd2 = await srv.reqJson('PUT', `/api/purchases/${poId}`, {
      token: warehouseToken,
      body: {
        supplierId: 'NCC001',
        expectedDeliveryDate: newDelivery,
        note: 'Đổi ngày giao mới',
        items: [{ productId: 'SP001', qty: 6, unitCost: 21000, expiryDate: addDaysYmd(180) }],
      },
    });
    assert.equal(upd2.status, 200);
    assert.equal(upd2.data.item.expectedDeliveryDate, newDelivery);

    // 3) Invalid date format -> 400
    const badUpd = await srv.reqJson('PUT', `/api/purchases/${poId}`, {
      token: warehouseToken,
      body: {
        supplierId: 'NCC001',
        expectedDeliveryDate: '20-11-2026',
        items: [{ productId: 'SP001', qty: 6, unitCost: 21000, expiryDate: addDaysYmd(180) }],
      },
    });
    assert.equal(badUpd.status, 400);
  } finally {
    await srv.close();
  }
});

test('P2-F10-01: UI semantics guard — GRN selector excludes Draft, Dashboard shows expiredBatchCount, POS reflects real shift state', () => {
  const purchasesUi = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'purchases.js'), 'utf8');
  const inventoryUi = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'inventory.js'), 'utf8');
  const dashboardUi = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'dashboard.js'), 'utf8');
  const posUi = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'pos.js'), 'utf8');

  assert.doesNotMatch(purchasesUi, /\['DaThongNhat',\s*'DangNhanHang',\s*'Draft'\]/);
  assert.match(purchasesUi, /\['DaThongNhat',\s*'DangNhanHang'\]/);
  assert.match(purchasesUi, /if \(canPurchaseCreate && !apiState\.grnsLoaded/);
  assert.match(inventoryUi, /if \(!apiState\.nearExpiryLoaded && !apiState\.loading\.nearExpiry\)/);
  assert.match(inventoryUi, /if \(!apiState\.stockAuditsLoaded && !apiState\.loading\.stockAudits\)/);
  assert.match(dashboardUi, /queues\.expiredBatchCount > 0/);
  assert.doesNotMatch(posUi, /badge\('Sẵn sàng bán'/);
  assert.match(posUi, /Chưa mở ca/);
});

// ============================================================================
// RF-FIX-04: ODD-VND PAYABLE SETTLEMENT (198 đ) & HTML5 MONETARY STEP="1" GUARD
// ============================================================================

test('P2-UAT-01: Odd-VND supplier payable settlement (323,200 -> pay 323,002 -> settle exact 198 đ) reconciles to 0 balance', async () => {
  const srv = await startTestServer();
  try {
    const warehouseToken = await srv.loginAs('kho');
    const managerToken = await srv.loginAs('quanly');

    // Create PO for 323,200 VND (10 units * 32,320 VND) and confirm to generate AP
    const poRes = await srv.reqJson('POST', '/api/purchases', {
      token: warehouseToken,
      body: {
        supplierId: 'NCC001',
        note: 'PO test thanh toán số lẻ 198đ (RF-FIX-04)',
        items: [{ productId: 'SP001', qty: 10, unitCost: 32320, expiryDate: addDaysYmd(180) }],
      },
    });
    assert.equal(poRes.status, 201, JSON.stringify(poRes.data));
    const poId = poRes.data.item.id;
    const confRes = await srv.reqJson('POST', `/api/purchases/${poId}/confirm`, { token: managerToken });
    assert.equal(confRes.status, 200, JSON.stringify(confRes.data));

    const apRow = srv.db.prepare('SELECT * FROM supplier_payables WHERE purchase_id = ?').get(poId);
    assert.ok(apRow, 'Payable must exist after PO confirmation');
    assert.equal(apRow.total_amount, 323200);
    assert.equal(apRow.balance_amount, 323200);

    // Partial payment leaving exact odd balance of 198 VND
    const pay1 = await srv.reqJson('POST', `/api/payables/${apRow.id}/pay`, {
      token: managerToken,
      body: {
        amount: 323002,
        paymentMethod: 'BANK_TRANSFER',
        paymentRef: 'RF04-PAY-PARTIAL-01',
        note: 'Thanh toán đợt 1 còn lẻ 198đ',
      },
    });
    assert.equal(pay1.status, 200, JSON.stringify(pay1.data));
    assert.equal(pay1.data.item.balanceAmount, 198);
    assert.equal(pay1.data.item.status, 'ThanhToanMotPhan');

    // Final settlement of exact 198 VND -> MUST succeed 200 and reconcile to 0 balance
    const pay2 = await srv.reqJson('POST', `/api/payables/${apRow.id}/pay`, {
      token: managerToken,
      body: {
        amount: 198,
        paymentMethod: 'BANK_TRANSFER',
        paymentRef: 'RF04-PAY-ODD198-02',
        note: 'Tất toán phần lẻ 198đ',
      },
    });
    assert.equal(pay2.status, 200, JSON.stringify(pay2.data));
    assert.equal(pay2.data.item.paidAmount, 323200);
    assert.equal(pay2.data.item.balanceAmount, 0);
    assert.equal(pay2.data.item.status, 'DaThanhToanNCC');

    // Verify DB ledger reconciliation
    const dbAp = srv.db.prepare('SELECT total_amount, paid_amount, balance_amount, status FROM supplier_payables WHERE id = ?').get(apRow.id);
    assert.equal(dbAp.total_amount, 323200);
    assert.equal(dbAp.paid_amount, 323200);
    assert.equal(dbAp.balance_amount, 0);
    assert.equal(dbAp.status, 'DaThanhToanNCC');
    const sumPayments = srv.db
      .prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM supplier_payments WHERE payable_id = ?')
      .get(apRow.id).total;
    assert.equal(sumPayments, 323200);
  } finally {
    await srv.close();
  }
});

test('P2-UAT-02: Frontend monetary HTML5 number inputs use step="1" (zero step >= 10 across src/features and index.html)', () => {
  const featuresDir = path.join(__dirname, '..', 'src', 'features');
  const featureFiles = fs
    .readdirSync(featuresDir)
    .filter((f) => f.endsWith('.js'))
    .map((f) => path.join(featuresDir, f));
  const filesToAudit = [...featureFiles, path.join(__dirname, '..', 'index.html')];

  for (const filePath of filesToAudit) {
    const content = fs.readFileSync(filePath, 'utf8');
    const badMatches = content.match(/step=["'](?:[1-9][0-9]+)["']/g) || [];
    assert.deepEqual(
      badMatches,
      [],
      `${path.basename(filePath)} must not contain monetary step > 1 attributes (found: ${badMatches.join(', ')})`,
    );
  }

  const purchasesUi = fs.readFileSync(path.join(featuresDir, 'purchases.js'), 'utf8');
  assert.match(purchasesUi, /required min="1" max="\$\{ap\.balanceAmount\}" step="1"/);
  const paymentsUi = fs.readFileSync(path.join(featuresDir, 'payments.js'), 'utf8');
  assert.match(paymentsUi, /id="cash-input" required min="0" step="1"/);
});

// ============================================================================
// F-06D: PER-SUPPLIER CONFIGURABLE PAYMENT TERMS DAYS (0..365, DEFAULT 30)
// ============================================================================

test('P2-F06D-01: Per-supplier paymentTermsDays (+15d via GRN and +45d via PO confirm) controls supplier_payables.due_date', async () => {
  const srv = await startTestServer();
  try {
    const managerToken = await srv.loginAs('quanly');
    const warehouseToken = await srv.loginAs('kho');
    const nccToken = await srv.loginAs('ncc01');

    // Configure NCC003 (portal-linked to ncc01) -> 15 days, NCC001 -> 45 days
    const u1 = await srv.reqJson('PUT', '/api/suppliers/NCC003', {
      token: managerToken,
      body: { paymentTermsDays: 15 },
    });
    assert.equal(u1.status, 200, JSON.stringify(u1.data));
    assert.equal(u1.data.item.paymentTermsDays, 15);

    const u2 = await srv.reqJson('PUT', '/api/suppliers/NCC001', {
      token: managerToken,
      body: { paymentTermsDays: 45 },
    });
    assert.equal(u2.status, 200, JSON.stringify(u2.data));
    assert.equal(u2.data.item.paymentTermsDays, 45);

    // Path A: Two-way PO -> ncc01 ACCEPT -> GRN -> confirmGoodsReceipt (NCC003, +15 days)
    const poGrn = await srv.reqJson('POST', '/api/purchases', {
      token: warehouseToken,
      body: {
        supplierId: 'NCC003',
        note: 'PO F-06D GRN +15d',
        items: [{ productId: 'SP006', qty: 5, unitCost: 45000, expiryDate: addDaysYmd(180) }],
      },
    });
    assert.equal(poGrn.status, 201, JSON.stringify(poGrn.data));
    const poGrnId = poGrn.data.item.id;
    assert.equal(
      (await srv.reqJson('POST', `/api/purchases/${poGrnId}/send`, { token: warehouseToken, body: {} })).status,
      200,
    );
    assert.equal(
      (await srv.reqJson('POST', `/api/purchases/${poGrnId}/respond`, { token: nccToken, body: { action: 'ACCEPT' } })).status,
      200,
    );
    const grn = await srv.reqJson('POST', '/api/grns', {
      token: warehouseToken,
      body: {
        purchaseId: poGrnId,
        note: 'GRN F-06D +15d',
        items: [
          {
            productId: 'SP006',
            receivedQty: 5,
            rejectedQty: 0,
            unitCost: 45000,
            batchCode: 'LOT-F06D-NCC003',
            expiryDate: addDaysYmd(180),
          },
        ],
      },
    });
    assert.equal(grn.status, 201, JSON.stringify(grn.data));
    const grnId = grn.data.item.id;
    const grnConf = await srv.reqJson('POST', `/api/grns/${grnId}/confirm`, { token: managerToken });
    assert.equal(grnConf.status, 200, JSON.stringify(grnConf.data));
    const ap15 = srv.db.prepare('SELECT * FROM supplier_payables WHERE receipt_id = ?').get(grnId);
    assert.ok(ap15, 'Payable for NCC003 GRN must exist');
    assert.equal(ap15.due_date, addDaysYmd(15), `Expected +15d (${addDaysYmd(15)}), got ${ap15.due_date}`);

    // Path B: Direct PO confirmPurchase (NCC001, +45 days)
    const poDirect = await srv.reqJson('POST', '/api/purchases', {
      token: warehouseToken,
      body: {
        supplierId: 'NCC001',
        note: 'PO F-06D Direct +45d',
        items: [{ productId: 'SP001', qty: 5, unitCost: 22000, expiryDate: addDaysYmd(180) }],
      },
    });
    assert.equal(poDirect.status, 201, JSON.stringify(poDirect.data));
    const poDirectId = poDirect.data.item.id;
    const poConf = await srv.reqJson('POST', `/api/purchases/${poDirectId}/confirm`, { token: managerToken });
    assert.equal(poConf.status, 200, JSON.stringify(poConf.data));
    const ap45 = srv.db.prepare('SELECT * FROM supplier_payables WHERE purchase_id = ?').get(poDirectId);
    assert.ok(ap45, 'Payable for NCC001 PO must exist');
    assert.equal(ap45.due_date, addDaysYmd(45), `Expected +45d (${addDaysYmd(45)}), got ${ap45.due_date}`);
  } finally {
    await srv.close();
  }
});

test('P2-F06D-02: Invalid paymentTermsDays (-5, 500, 12.5) rejected with 400; legacy/default supplier uses 30 days', async () => {
  const srv = await startTestServer();
  try {
    const managerToken = await srv.loginAs('quanly');
    const warehouseToken = await srv.loginAs('kho');

    // Reject out-of-range / non-integer values on update & create
    for (const badVal of [-5, 500, 12.5, 'abc']) {
      const badUpd = await srv.reqJson('PUT', '/api/suppliers/NCC001', {
        token: managerToken,
        body: { paymentTermsDays: badVal },
      });
      assert.equal(badUpd.status, 400, `Update with ${badVal} must fail 400`);

      const badCre = await srv.reqJson('POST', '/api/suppliers', {
        token: managerToken,
        body: {
          name: `NCC Invalid ${badVal}`,
          phone: '0909123456',
          categoryGroup: 'Đồ uống',
          areas: 'TP. HCM',
          paymentTermsDays: badVal,
        },
      });
      assert.equal(badCre.status, 400, `Create with ${badVal} must fail 400`);
    }

    // Create supplier omitting paymentTermsDays -> defaults cleanly to 30
    const created = await srv.reqJson('POST', '/api/suppliers', {
      token: managerToken,
      body: {
        name: 'NCC Mặc Định 30 Ngày F06D',
        phone: '0909888777',
        categoryGroup: 'Thực phẩm khô',
        areas: 'TP. HCM',
      },
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    assert.equal(created.data.item.paymentTermsDays, 30);

    // Create an isolated product owned by this new supplier, then confirm PO -> due_date = today (UTC+7) + 30 days
    const supId = created.data.item.id;
    const prod = await createIsolatedProduct(srv, managerToken, { supplierId: supId });
    const po = await srv.reqJson('POST', '/api/purchases', {
      token: warehouseToken,
      body: {
        supplierId: supId,
        note: 'PO default 30d F-06D',
        items: [{ productId: prod.id, qty: 4, unitCost: 11000, expiryDate: addDaysYmd(180) }],
      },
    });
    assert.equal(po.status, 201, JSON.stringify(po.data));
    const poId = po.data.item.id;
    const conf = await srv.reqJson('POST', `/api/purchases/${poId}/confirm`, { token: managerToken });
    assert.equal(conf.status, 200, JSON.stringify(conf.data));

    const ap30 = srv.db.prepare('SELECT * FROM supplier_payables WHERE purchase_id = ?').get(poId);
    assert.ok(ap30, 'Payable for default-30d PO must exist');
    assert.equal(ap30.due_date, addDaysYmd(30), `Expected default +30d (${addDaysYmd(30)}), got ${ap30.due_date}`);
  } finally {
    await srv.close();
  }
});

// ============================================================================
// F-09C (MIDNIGHT BOUNDARY): UTC vs ASIA/HO_CHI_MINH (+07:00) REPORT ROLLOVER
// ============================================================================

test('P2-F09C-02: Midnight UTC timestamp 2026-11-21T17:30:00.000Z (= 2026-11-22 00:30 +07:00) is included in 2026-11-22 VN report and excluded from 2026-11-21', async () => {
  const srv = await startTestServer();
  try {
    const managerToken = await srv.loginAs('quanly');
    const cashierToken = await srv.loginAs('thungan');
    const warehouseToken = await srv.loginAs('kho');

    // Use an isolated product in DM05 and capture exact baselines for both VN calendar days
    const baseNov21 = (
      await srv.reqJson('GET', '/api/reports/sales?fromDate=2026-11-21&toDate=2026-11-21&categoryCode=DM05', {
        token: managerToken,
      })
    ).data.summary;
    const baseNov22 = (
      await srv.reqJson('GET', '/api/reports/sales?fromDate=2026-11-22&toDate=2026-11-22&categoryCode=DM05', {
        token: managerToken,
      })
    ).data.summary;

    const prod = await createIsolatedProduct(srv, managerToken, {
      categoryCode: 'DM05',
      stockQty: 10,
      costPrice: 15000,
      salePrice: 40000,
    });
    const batch = srv.db.prepare('SELECT id FROM product_batches WHERE product_id = ?').get(prod.id);

    // 1) POS checkout (2 units = 80,000 pre-tax)
    const ck = await srv.reqJson('POST', '/api/pos/checkout', {
      token: cashierToken,
      body: { items: [{ productId: prod.id, qty: 2 }], paymentMethod: 'VIETQR', paymentRef: 'QR-MIDNIGHT-VN-01' },
    });
    assert.equal(ck.status, 201, JSON.stringify(ck.data));
    const orderId = ck.data.item.id;

    // 2) Approved batch write-off (1 unit = 15,000 loss)
    const wo = await srv.reqJson('POST', '/api/writeoffs', {
      token: warehouseToken,
      body: { reason: 'Hủy kiểm chứng ranh giới 00:30 +07', items: [{ batchId: batch.id, qty: 1 }] },
    });
    assert.equal(wo.status, 201, JSON.stringify(wo.data));
    assert.equal((await srv.reqJson('POST', `/api/writeoffs/${wo.data.item.id}/approve`, { token: managerToken })).status, 200);

    // 3) Approved negative stock audit (-1 unit -> actualQty 6 vs systemQty 7 = 15,000 shrinkage)
    const audit = await srv.reqJson('POST', '/api/stock-audits', {
      token: warehouseToken,
      body: {
        note: 'Kiểm kê kiểm chứng ranh giới 00:30 +07',
        items: [{ productId: prod.id, actualQty: 6, reasonCode: 'MAT_HANG', reason: 'Thiếu 1 đơn vị lúc 00:30 VN' }],
      },
    });
    assert.equal(audit.status, 201, JSON.stringify(audit.data));
    assert.equal((await srv.reqJson('POST', `/api/stock-audits/${audit.data.item.id}/approve`, { token: managerToken })).status, 200);

    // Pin all three UTC timestamps to 2026-11-21T17:30:00.000Z (= 2026-11-22 00:30:00 Asia/Ho_Chi_Minh)
    const midnightUtcIso = '2026-11-21T17:30:00.000Z';
    srv.db.prepare('UPDATE orders SET created_at = ? WHERE id = ?').run(midnightUtcIso, orderId);
    srv.db.prepare('UPDATE batch_writeoffs SET created_at = ?, approved_at = ? WHERE id = ?').run(
      midnightUtcIso,
      midnightUtcIso,
      wo.data.item.id,
    );
    srv.db.prepare('UPDATE stock_audits SET created_at = ?, approved_at = ? WHERE id = ?').run(
      midnightUtcIso,
      midnightUtcIso,
      audit.data.item.id,
    );

    // Query VN day 2026-11-22 -> MUST INCLUDE the midnight order, write-off, and audit shrinkage
    const repNov22 = await srv.reqJson('GET', '/api/reports/sales?fromDate=2026-11-22&toDate=2026-11-22&categoryCode=DM05', {
      token: managerToken,
    });
    assert.equal(repNov22.status, 200);
    assert.equal(repNov22.data.summary.orderCount - baseNov22.orderCount, 1);
    assert.equal(repNov22.data.summary.netRevenuePreTax - baseNov22.netRevenuePreTax, 80000);
    assert.equal(repNov22.data.summary.writeoffLoss - baseNov22.writeoffLoss, 15000);
    assert.equal(repNov22.data.summary.auditShrinkageLoss - baseNov22.auditShrinkageLoss, 15000);
    const nov22Bucket = repNov22.data.series.find((b) => b.key === '2026-11-22');
    assert.ok(nov22Bucket, 'Time series must bucket 2026-11-21T17:30:00.000Z under VN day 2026-11-22');
    assert.ok(nov22Bucket.netRevenuePreTax >= 80000);

    // Query VN day 2026-11-21 -> MUST STRICTLY EXCLUDE all three midnight records
    const repNov21 = await srv.reqJson('GET', '/api/reports/sales?fromDate=2026-11-21&toDate=2026-11-21&categoryCode=DM05', {
      token: managerToken,
    });
    assert.equal(repNov21.status, 200);
    assert.equal(repNov21.data.summary.orderCount, baseNov21.orderCount);
    assert.equal(repNov21.data.summary.netRevenuePreTax, baseNov21.netRevenuePreTax);
    assert.equal(repNov21.data.summary.writeoffLoss, baseNov21.writeoffLoss);
    assert.equal(repNov21.data.summary.auditShrinkageLoss, baseNov21.auditShrinkageLoss);
  } finally {
    await srv.close();
  }
});


