'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../server.js');
const { createRepositories } = require('../src/server/dal/repositories.js');
const { WarehouseService } = require('../src/server/bll/warehouseService.js');

function todayYmdVn() {
  return new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
}

function addDaysYmd(days) {
  const base = new Date(Date.now() + 7 * 3600000);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

async function startTestServer() {
  const server = createServer({ dbPath: ':memory:' });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  async function reqJson(method, urlPath, { token = null, body = undefined } = {}) {
    const headers = { Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${baseUrl}${urlPath}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }
    return { status: res.status, data };
  }

  async function loginAs(username, password = '123456') {
    const res = await reqJson('POST', '/api/auth/login', { body: { username, password } });
    assert.equal(res.status, 200, `Login ${username} failed: ${JSON.stringify(res.data)}`);
    return res.data.token;
  }

  function assertLedgerParity(productId, label = '') {
    const today = todayYmdVn();
    const prod = server.db.prepare('SELECT stock_qty FROM products WHERE id = ?').get(productId);
    const batchSum = server.db
      .prepare(
        `SELECT COALESCE(SUM(qty_remaining), 0) AS qty
         FROM product_batches
         WHERE product_id = ?
           AND qty_remaining > 0
           AND status NOT IN ('HetHan', 'DaHuy', 'DaHet')
           AND (expiry_date = '' OR expiry_date > ?)`,
      )
      .get(productId, today).qty;
    assert.equal(
      Number(prod.stock_qty),
      Number(batchSum),
      `Ledger parity violated for ${productId} (${label}): products.stock_qty=${prod.stock_qty} !== salable batch sum=${batchSum}`,
    );
    return Number(prod.stock_qty);
  }

  async function close() {
    await new Promise((resolve) => {
      server.close(() => {
        server.db.close();
        resolve();
      });
    });
  }

  return { server, baseUrl, db: server.db, reqJson, loginAs, assertLedgerParity, close };
}

async function createIsolatedProduct(srv, managerToken, {
  sku,
  barcode,
  name,
  categoryCode = 'DM01',
  supplierId = 'NCC001',
  salePrice = 20000,
  costPrice = 12000,
  stockQty = 0,
  hasExpiry = true,
  expiryDate = undefined,
}) {
  const res = await srv.reqJson('POST', '/api/products', {
    token: managerToken,
    body: {
      sku,
      barcode,
      name,
      categoryCode,
      unitCode: 'DVT01',
      supplierId,
      salePrice,
      costPrice,
      stockQty,
      minStock: 1,
      hasExpiry,
      expiryDate,
    },
  });
  assert.equal(res.status, 201, `Create product ${sku} failed: ${JSON.stringify(res.data)}`);
  return res.data.item;
}

// ============================================================================
// F-03: SINGLE SHARED SCOPED PROMOTION ENGINE (CATEGORY, PRODUCT, INVOICE)
// ============================================================================

test('P1-F03-01: Mixed cart + CATEGORY 20% promo — preview and checkout match identically (1,800 discount, 12,636 total) and exact CASH succeeds', async () => {
  const srv = await startTestServer();
  try {
    const managerToken = await srv.loginAs('quanly');
    const cashierToken = await srv.loginAs('thungan');
    assert.equal((await srv.reqJson('POST', '/api/shifts/open', { token: cashierToken, body: { openingCash: 500000 } })).status, 201);

    const pCat = await createIsolatedProduct(srv, managerToken, {
      sku: 'P1-F03-CAT',
      barcode: '8939000003011',
      name: 'Sản phẩm DM01 (9,000đ)',
      categoryCode: 'DM01',
      salePrice: 9000,
      costPrice: 5000,
      stockQty: 20,
    });
    const pOther = await createIsolatedProduct(srv, managerToken, {
      sku: 'P1-F03-OTH',
      barcode: '8939000003012',
      name: 'Sản phẩm DM05 (4,500đ)',
      categoryCode: 'DM05',
      salePrice: 4500,
      costPrice: 2500,
      stockQty: 20,
    });

    const promoRes = await srv.reqJson('POST', '/api/promotions', {
      token: managerToken,
      body: {
        code: 'P1CAT20',
        name: 'Giảm 20% danh mục DM01',
        discountType: 'PERCENT',
        discountValue: 20,
        minOrderAmount: 0,
        maxDiscount: 0,
        scope: 'CATEGORY',
        categoryCode: 'DM01',
        startDate: addDaysYmd(-1),
        endDate: addDaysYmd(30),
        usageLimit: 100,
        status: 'DangDienRa',
      },
    });
    assert.equal(promoRes.status, 201, JSON.stringify(promoRes.data));

    const cartItems = [
      { productId: pCat.id, qty: 1 },
      { productId: pOther.id, qty: 1 },
    ];
    const preview = await srv.reqJson('POST', '/api/promotions/validate', {
      token: cashierToken,
      body: { code: 'P1CAT20', subtotal: 13500, items: cartItems },
    });
    assert.equal(preview.status, 200, JSON.stringify(preview.data));
    assert.equal(preview.data.subtotal, 13500);
    assert.equal(preview.data.eligibleSubtotal, 9000);
    assert.equal(preview.data.discountAmount, 1800);
    assert.equal(preview.data.afterDiscount, 11700);
    assert.equal(preview.data.taxAmount, 936); // 8% of 11,700
    assert.equal(preview.data.totalAmount, 12636);
    assert.equal(preview.data.finalTotal, 12636);

    // Exact CASH tender matching preview.finalTotal MUST succeed 201 (never false 400)
    const ck = await srv.reqJson('POST', '/api/pos/checkout', {
      token: cashierToken,
      body: {
        items: cartItems,
        promotionCode: 'P1CAT20',
        paymentMethod: 'CASH',
        cashReceived: preview.data.finalTotal,
      },
    });
    assert.equal(ck.status, 201, JSON.stringify(ck.data));
    assert.equal(ck.data.item.invoiceDiscount, preview.data.discountAmount);
    assert.equal(ck.data.item.taxAmount, preview.data.taxAmount);
    assert.equal(ck.data.item.totalAmount, preview.data.finalTotal);
    assert.equal(ck.data.item.cashChange, 0);
  } finally {
    await srv.close();
  }
});

test('P1-F03-02: Mixed cart + PRODUCT 20% promo — preview and VIETQR checkout match identically (0 VND overcharge)', async () => {
  const srv = await startTestServer();
  try {
    const managerToken = await srv.loginAs('quanly');
    const cashierToken = await srv.loginAs('thungan');

    const pTarget = await createIsolatedProduct(srv, managerToken, {
      sku: 'P1-F03-PRD1',
      barcode: '8939000003021',
      name: 'Sản phẩm mục tiêu (9,000đ)',
      categoryCode: 'DM01',
      salePrice: 9000,
      costPrice: 5000,
      stockQty: 20,
    });
    const pNonTarget = await createIsolatedProduct(srv, managerToken, {
      sku: 'P1-F03-PRD2',
      barcode: '8939000003022',
      name: 'Sản phẩm ngoài phạm vi (4,500đ)',
      categoryCode: 'DM05',
      salePrice: 4500,
      costPrice: 2500,
      stockQty: 20,
    });

    const promoRes = await srv.reqJson('POST', '/api/promotions', {
      token: managerToken,
      body: {
        code: 'P1PROD20',
        name: 'Giảm 20% SP mục tiêu',
        discountType: 'PERCENT',
        discountValue: 20,
        minOrderAmount: 0,
        maxDiscount: 0,
        scope: 'PRODUCT',
        productIds: [pTarget.id],
        startDate: addDaysYmd(-1),
        endDate: addDaysYmd(30),
        usageLimit: 100,
        status: 'DangDienRa',
      },
    });
    assert.equal(promoRes.status, 201, JSON.stringify(promoRes.data));

    const cartItems = [
      { productId: pTarget.id, qty: 1 },
      { productId: pNonTarget.id, qty: 1 },
    ];
    const preview = await srv.reqJson('POST', '/api/promotions/validate', {
      token: cashierToken,
      body: { code: 'P1PROD20', subtotal: 13500, items: cartItems },
    });
    assert.equal(preview.status, 200, JSON.stringify(preview.data));
    assert.equal(preview.data.eligibleSubtotal, 9000);
    assert.equal(preview.data.discountAmount, 1800);
    assert.equal(preview.data.finalTotal, 12636);

    const qrCk = await srv.reqJson('POST', '/api/pos/checkout', {
      token: cashierToken,
      body: {
        items: cartItems,
        promotionCode: 'P1PROD20',
        paymentMethod: 'VIETQR',
        paymentRef: 'VCB-P1-F03-02',
      },
    });
    assert.equal(qrCk.status, 201, JSON.stringify(qrCk.data));
    assert.equal(qrCk.data.item.invoiceDiscount, preview.data.discountAmount);
    assert.equal(qrCk.data.item.totalAmount, preview.data.finalTotal);
  } finally {
    await srv.close();
  }
});

test('P1-F03-03: Order-wide (INVOICE) promo works identically both with and without items (backward compatible)', async () => {
  const srv = await startTestServer();
  try {
    const managerToken = await srv.loginAs('quanly');
    const cashierToken = await srv.loginAs('thungan');

    const p1 = await createIsolatedProduct(srv, managerToken, {
      sku: 'P1-F03-INV1',
      barcode: '8939000003031',
      name: 'SP Hóa đơn 100k',
      salePrice: 100000,
      costPrice: 60000,
      stockQty: 10,
    });

    // Legacy subtotal-only call (no items)
    const legacyPreview = await srv.reqJson('POST', '/api/promotions/validate', {
      token: cashierToken,
      body: { code: 'GIAM10', subtotal: 200000 },
    });
    assert.equal(legacyPreview.status, 200, JSON.stringify(legacyPreview.data));
    assert.equal(legacyPreview.data.discountAmount, 20000);
    assert.equal(legacyPreview.data.eligibleSubtotal, 200000);

    // With items
    const itemsPreview = await srv.reqJson('POST', '/api/promotions/validate', {
      token: cashierToken,
      body: { code: 'GIAM10', items: [{ productId: p1.id, qty: 2 }] },
    });
    assert.equal(itemsPreview.status, 200, JSON.stringify(itemsPreview.data));
    assert.equal(itemsPreview.data.discountAmount, legacyPreview.data.discountAmount);
    assert.equal(itemsPreview.data.finalTotal, legacyPreview.data.finalTotal);
  } finally {
    await srv.close();
  }
});

test('P1-F03-04: Scoped promo preview WITHOUT items is blocked (400 ITEMS_REQUIRED_FOR_SCOPED_PROMOTION), never over-discounting full subtotal', async () => {
  const srv = await startTestServer();
  try {
    const managerToken = await srv.loginAs('quanly');
    const cashierToken = await srv.loginAs('thungan');

    const promoRes = await srv.reqJson('POST', '/api/promotions', {
      token: managerToken,
      body: {
        code: 'P1NOITEMS',
        name: 'KM DM01 bắt buộc gửi items',
        discountType: 'PERCENT',
        discountValue: 20,
        minOrderAmount: 0,
        scope: 'CATEGORY',
        categoryCode: 'DM01',
        startDate: addDaysYmd(-1),
        endDate: addDaysYmd(30),
        usageLimit: 100,
        status: 'DangDienRa',
      },
    });
    assert.equal(promoRes.status, 201);

    const preview = await srv.reqJson('POST', '/api/promotions/validate', {
      token: cashierToken,
      body: { code: 'P1NOITEMS', subtotal: 13500 },
    });
    assert.equal(preview.status, 400);
    assert.equal(preview.data.error.code, 'ITEMS_REQUIRED_FOR_SCOPED_PROMOTION');
  } finally {
    await srv.close();
  }
});

test('P1-F03-05: Ineligible cart returns consistent 400 (0 discount) on both preview and checkout', async () => {
  const srv = await startTestServer();
  try {
    const managerToken = await srv.loginAs('quanly');
    const cashierToken = await srv.loginAs('thungan');

    const pOther = await createIsolatedProduct(srv, managerToken, {
      sku: 'P1-F03-INEL',
      barcode: '8939000003051',
      name: 'SP DM05 không thuộc KM DM01',
      categoryCode: 'DM05',
      salePrice: 15000,
      costPrice: 8000,
      stockQty: 10,
    });

    await srv.reqJson('POST', '/api/promotions', {
      token: managerToken,
      body: {
        code: 'P1DM01ONLY',
        name: 'Chỉ giảm DM01',
        discountType: 'PERCENT',
        discountValue: 20,
        minOrderAmount: 0,
        scope: 'CATEGORY',
        categoryCode: 'DM01',
        startDate: addDaysYmd(-1),
        endDate: addDaysYmd(30),
        usageLimit: 100,
        status: 'DangDienRa',
      },
    });

    const preview = await srv.reqJson('POST', '/api/promotions/validate', {
      token: cashierToken,
      body: { code: 'P1DM01ONLY', items: [{ productId: pOther.id, qty: 2 }] },
    });
    assert.equal(preview.status, 400);
    assert.equal(preview.data.error.code, 'INELIGIBLE_PROMOTION_CART');

    const ck = await srv.reqJson('POST', '/api/pos/checkout', {
      token: cashierToken,
      body: {
        items: [{ productId: pOther.id, qty: 2 }],
        promotionCode: 'P1DM01ONLY',
        paymentMethod: 'CASH',
        cashReceived: 50000,
      },
    });
    assert.equal(ck.status, 400);
    assert.equal(ck.data.error.code, 'INELIGIBLE_PROMOTION_CART');
  } finally {
    await srv.close();
  }
});

test('P1-F03-06 (Adversarial): Client spoofing unitPrice or categoryCode in preview payload is ignored — server resolves authoritative DB values', async () => {
  const srv = await startTestServer();
  try {
    const managerToken = await srv.loginAs('quanly');
    const cashierToken = await srv.loginAs('thungan');

    const pDm05 = await createIsolatedProduct(srv, managerToken, {
      sku: 'P1-F03-SPOOF',
      barcode: '8939000003061',
      name: 'SP DM05 giá thật 10,000đ',
      categoryCode: 'DM05',
      salePrice: 10000,
      costPrice: 5000,
      stockQty: 10,
    });
    const pDm01 = await createIsolatedProduct(srv, managerToken, {
      sku: 'P1-F03-REAL',
      barcode: '8939000003062',
      name: 'SP DM01 giá thật 10,000đ',
      categoryCode: 'DM01',
      salePrice: 10000,
      costPrice: 5000,
      stockQty: 10,
    });

    await srv.reqJson('POST', '/api/promotions', {
      token: managerToken,
      body: {
        code: 'P1SPOOF20',
        name: 'Giảm 20% DM01',
        discountType: 'PERCENT',
        discountValue: 20,
        minOrderAmount: 0,
        scope: 'CATEGORY',
        categoryCode: 'DM01',
        startDate: addDaysYmd(-1),
        endDate: addDaysYmd(30),
        usageLimit: 100,
        status: 'DangDienRa',
      },
    });

    // Attacker tries to pass inflated unitPrice=999999 and forged categoryCode='DM01' on DM05 product
    const preview = await srv.reqJson('POST', '/api/promotions/validate', {
      token: cashierToken,
      body: {
        code: 'P1SPOOF20',
        subtotal: 999999,
        items: [
          { productId: pDm05.id, qty: 1, unitPrice: 999999, categoryCode: 'DM01', categoryId: 'DM01' },
          { productId: pDm01.id, qty: 1, unitPrice: 500000 },
        ],
      },
    });
    assert.equal(preview.status, 200, JSON.stringify(preview.data));
    // True DB subtotal = 10,000 + 10,000 = 20,000; true DM01 eligible = 10,000 -> discount = 2,000
    assert.equal(preview.data.subtotal, 20000);
    assert.equal(preview.data.eligibleSubtotal, 10000);
    assert.equal(preview.data.discountAmount, 2000);
  } finally {
    await srv.close();
  }
});

// ============================================================================
// F-04: FEFO SOLD-LOT TRACEABILITY & FOOD-SAFETY RETURN RESTOCK
// ============================================================================

test('P1-F04-01: Sold-out +3d perishable returned while still unexpired restores exact original batch (+3d) with NO fabricated +180d lot', async () => {
  const srv = await startTestServer();
  try {
    const managerToken = await srv.loginAs('quanly');
    const cashierToken = await srv.loginAs('thungan');
    assert.equal((await srv.reqJson('POST', '/api/shifts/open', { token: cashierToken, body: { openingCash: 500000 } })).status, 201);
    const exp3d = addDaysYmd(3);

    const prod = await createIsolatedProduct(srv, managerToken, {
      sku: 'P1-F04-3D',
      barcode: '8939000004011',
      name: 'Sữa tươi hạn +3 ngày',
      salePrice: 30000,
      costPrice: 20000,
      stockQty: 2,
      hasExpiry: true,
      expiryDate: exp3d,
    });

    const batchesBefore = srv.db.prepare('SELECT * FROM product_batches WHERE product_id = ?').all(prod.id);
    assert.equal(batchesBefore.length, 1);
    const origBatchId = batchesBefore[0].id;
    assert.equal(batchesBefore[0].expiry_date, exp3d);

    // Sell out all 2 units
    const ck = await srv.reqJson('POST', '/api/pos/checkout', {
      token: cashierToken,
      body: {
        items: [{ productId: prod.id, qty: 2 }],
        paymentMethod: 'CASH',
        cashReceived: 100000,
      },
    });
    assert.equal(ck.status, 201, JSON.stringify(ck.data));
    assert.equal(srv.assertLedgerParity(prod.id, 'after sell-out'), 0);

    // Verify order_item_batches recorded exact allocation
    const allocs = srv.db.prepare('SELECT * FROM order_item_batches WHERE order_id = ? AND product_id = ?').all(ck.data.item.id, prod.id);
    assert.equal(allocs.length, 1);
    assert.equal(allocs[0].batch_id, origBatchId);
    assert.equal(allocs[0].expiry_date, exp3d);
    assert.equal(allocs[0].qty, 2);

    // Return 1 unit (good restock)
    const retCreate = await srv.reqJson('POST', '/api/returns', {
      token: cashierToken,
      body: {
        orderId: ck.data.item.id,
        reason: 'Khách đổi ý còn nguyên seal',
        restock: true,
        items: [{ productId: prod.id, qty: 1 }],
      },
    });
    assert.equal(retCreate.status, 201, JSON.stringify(retCreate.data));

    const retApprove = await srv.reqJson('POST', `/api/returns/${retCreate.data.item.id}/approve`, {
      token: managerToken,
    });
    assert.equal(retApprove.status, 200, JSON.stringify(retApprove.data));

    const batchesAfter = srv.db.prepare('SELECT * FROM product_batches WHERE product_id = ?').all(prod.id);
    assert.equal(batchesAfter.length, 1, 'Must NOT fabricate a new +180d batch');
    assert.equal(batchesAfter[0].id, origBatchId);
    assert.equal(batchesAfter[0].expiry_date, exp3d);
    assert.equal(batchesAfter[0].qty_remaining, 1);
    assert.notEqual(batchesAfter[0].status, 'DaHet');
    assert.equal(srv.assertLedgerParity(prod.id, 'after return restock'), 1);
  } finally {
    await srv.close();
  }
});

test('P1-F04-02: 2-lot perishable (+5d & +90d) — FEFO sells from +5d lot, return restores +5d lot ONLY (+90d untouched)', async () => {
  const srv = await startTestServer();
  try {
    const managerToken = await srv.loginAs('quanly');
    const cashierToken = await srv.loginAs('thungan');
    assert.equal((await srv.reqJson('POST', '/api/shifts/open', { token: cashierToken, body: { openingCash: 500000 } })).status, 201);
    const exp5d = addDaysYmd(5);
    const exp90d = addDaysYmd(90);

    const prod = await createIsolatedProduct(srv, managerToken, {
      sku: 'P1-F04-2LOT',
      barcode: '8939000004021',
      name: 'Sữa chua 2 lô (+5d và +90d)',
      salePrice: 25000,
      costPrice: 15000,
      stockQty: 0,
      hasExpiry: true,
    });

    const repos = createRepositories(srv.db);
    const lot5d = repos.batches.create({
      batchCode: 'LO-5D-TEST',
      productId: prod.id,
      mfgDate: addDaysYmd(-5),
      expiryDate: exp5d,
      initialQty: 2,
      qtyRemaining: 2,
      unitCost: 15000,
      status: 'CanDate',
    });
    const lot90d = repos.batches.create({
      batchCode: 'LO-90D-TEST',
      productId: prod.id,
      mfgDate: addDaysYmd(-1),
      expiryDate: exp90d,
      initialQty: 5,
      qtyRemaining: 5,
      unitCost: 15000,
      status: 'ConHan',
    });
    repos.batches.syncProductSalableStock(prod.id, todayYmdVn());
    assert.equal(srv.assertLedgerParity(prod.id, 'initial 2 lots'), 7);

    // Sell 1 unit -> FEFO takes from lot5d (2 -> 1), lot90d stays 5
    const ck = await srv.reqJson('POST', '/api/pos/checkout', {
      token: cashierToken,
      body: { items: [{ productId: prod.id, qty: 1 }], paymentMethod: 'CASH', cashReceived: 50000 },
    });
    assert.equal(ck.status, 201);
    assert.equal(repos.batches.findById(lot5d.id).qty_remaining, 1);
    assert.equal(repos.batches.findById(lot90d.id).qty_remaining, 5);

    // Return 1 unit -> MUST go back to lot5d (1 -> 2), NEVER lot90d (stays 5)
    const ret = await srv.reqJson('POST', '/api/returns', {
      token: cashierToken,
      body: { orderId: ck.data.item.id, reason: 'Trả nguyên vẹn', restock: true, items: [{ productId: prod.id, qty: 1 }] },
    });
    assert.equal(ret.status, 201);
    const app = await srv.reqJson('POST', `/api/returns/${ret.data.item.id}/approve`, { token: managerToken });
    assert.equal(app.status, 200);

    assert.equal(repos.batches.findById(lot5d.id).qty_remaining, 2, '+5d lot must be restored to 2');
    assert.equal(repos.batches.findById(lot90d.id).qty_remaining, 5, '+90d lot must remain completely untouched at 5');
    assert.equal(srv.assertLedgerParity(prod.id, 'after 2-lot return'), 7);
  } finally {
    await srv.close();
  }
});

test('P1-F04-03: Multi-lot sale spanning +5d and +90d restores exact allocated lots across sequential partial returns and blocks over-return', async () => {
  const srv = await startTestServer();
  try {
    const managerToken = await srv.loginAs('quanly');
    const cashierToken = await srv.loginAs('thungan');
    assert.equal((await srv.reqJson('POST', '/api/shifts/open', { token: cashierToken, body: { openingCash: 500000 } })).status, 201);
    const prod = await createIsolatedProduct(srv, managerToken, {
      sku: 'P1-F04-MULTI',
      barcode: '8939000004031',
      name: 'Bánh tươi đa lô',
      salePrice: 20000,
      costPrice: 12000,
      stockQty: 0,
      hasExpiry: true,
    });

    const repos = createRepositories(srv.db);
    const lotA = repos.batches.create({
      batchCode: 'LO-M-A',
      productId: prod.id,
      expiryDate: addDaysYmd(5),
      initialQty: 2,
      qtyRemaining: 2,
      unitCost: 12000,
      status: 'CanDate',
    });
    const lotB = repos.batches.create({
      batchCode: 'LO-M-B',
      productId: prod.id,
      expiryDate: addDaysYmd(90),
      initialQty: 4,
      qtyRemaining: 4,
      unitCost: 12000,
      status: 'ConHan',
    });
    repos.batches.syncProductSalableStock(prod.id, todayYmdVn());

    // Sell 4 units: 2 from lotA (2->0) + 2 from lotB (4->2)
    const ck = await srv.reqJson('POST', '/api/pos/checkout', {
      token: cashierToken,
      body: { items: [{ productId: prod.id, qty: 4 }], paymentMethod: 'CASH', cashReceived: 200000 },
    });
    assert.equal(ck.status, 201);
    assert.equal(repos.batches.findById(lotA.id).qty_remaining, 0);
    assert.equal(repos.batches.findById(lotB.id).qty_remaining, 2);

    // Partial return #1 (qty 2) -> restores lotA (0->2), lotB stays 2
    const ret1 = await srv.reqJson('POST', '/api/returns', {
      token: cashierToken,
      body: { orderId: ck.data.item.id, reason: 'Trả đợt 1', restock: true, items: [{ productId: prod.id, qty: 2 }] },
    });
    assert.equal((await srv.reqJson('POST', `/api/returns/${ret1.data.item.id}/approve`, { token: managerToken })).status, 200);
    assert.equal(repos.batches.findById(lotA.id).qty_remaining, 2);
    assert.equal(repos.batches.findById(lotB.id).qty_remaining, 2);

    // Partial return #2 (qty 2) -> restores lotB (2->4), lotA stays 2
    const ret2 = await srv.reqJson('POST', '/api/returns', {
      token: cashierToken,
      body: { orderId: ck.data.item.id, reason: 'Trả đợt 2', restock: true, items: [{ productId: prod.id, qty: 2 }] },
    });
    assert.equal((await srv.reqJson('POST', `/api/returns/${ret2.data.item.id}/approve`, { token: managerToken })).status, 200);
    assert.equal(repos.batches.findById(lotA.id).qty_remaining, 2);
    assert.equal(repos.batches.findById(lotB.id).qty_remaining, 4);
    assert.equal(srv.assertLedgerParity(prod.id, 'after full multi-lot return'), 6);

    // Returning again exceeds sold qty -> MUST reject 400
    const retOver = await srv.reqJson('POST', '/api/returns', {
      token: cashierToken,
      body: { orderId: ck.data.item.id, reason: 'Trả dư', restock: true, items: [{ productId: prod.id, qty: 1 }] },
    });
    assert.equal(retOver.status, 400);
  } finally {
    await srv.close();
  }
});

test('P1-F04-04: Perishable whose original sold lot is NOW expired is quarantined on return (salable stock NOT inflated, NO +180d lot)', async () => {
  const srv = await startTestServer();
  try {
    const managerToken = await srv.loginAs('quanly');
    const cashierToken = await srv.loginAs('thungan');
    assert.equal((await srv.reqJson('POST', '/api/shifts/open', { token: cashierToken, body: { openingCash: 500000 } })).status, 201);
    const prod = await createIsolatedProduct(srv, managerToken, {
      sku: 'P1-F04-EXP',
      barcode: '8939000004041',
      name: 'Sản phẩm cận date đã quá hạn lúc trả',
      salePrice: 30000,
      costPrice: 18000,
      stockQty: 2,
      hasExpiry: true,
      expiryDate: addDaysYmd(1),
    });

    const origBatch = srv.db.prepare('SELECT * FROM product_batches WHERE product_id = ?').get(prod.id);

    // Sell all 2 units while still valid (+1d)
    const ck = await srv.reqJson('POST', '/api/pos/checkout', {
      token: cashierToken,
      body: { items: [{ productId: prod.id, qty: 2 }], paymentMethod: 'CASH', cashReceived: 100000 },
    });
    assert.equal(ck.status, 201);
    assert.equal(srv.assertLedgerParity(prod.id, 'after sell'), 0);

    // Simulate time passing so original sold lot is now expired (yesterday)
    const expiredYmd = addDaysYmd(-1);
    srv.db.prepare('UPDATE product_batches SET expiry_date = ? WHERE id = ?').run(expiredYmd, origBatch.id);
    srv.db.prepare('UPDATE order_item_batches SET expiry_date = ? WHERE order_id = ? AND batch_id = ?').run(
      expiredYmd,
      ck.data.item.id,
      origBatch.id,
    );

    const ret = await srv.reqJson('POST', '/api/returns', {
      token: cashierToken,
      body: { orderId: ck.data.item.id, reason: 'Khách trả sau khi quá hạn', restock: true, items: [{ productId: prod.id, qty: 1 }] },
    });
    assert.equal(ret.status, 201);
    const app = await srv.reqJson('POST', `/api/returns/${ret.data.item.id}/approve`, { token: managerToken });
    assert.equal(app.status, 200, JSON.stringify(app.data));

    // Salable stock MUST stay 0; batch MUST be quarantined as HetHan; damaged_stock_qty incremented; NO new +180d batch
    const prodAfter = srv.db.prepare('SELECT stock_qty, damaged_stock_qty FROM products WHERE id = ?').get(prod.id);
    assert.equal(prodAfter.stock_qty, 0, 'Expired returned lot must NOT inflate salable stock');
    assert.equal(prodAfter.damaged_stock_qty, 1, 'Expired returned lot must be quarantined in damaged_stock_qty');
    const batchesAfter = srv.db.prepare('SELECT * FROM product_batches WHERE product_id = ?').all(prod.id);
    assert.equal(batchesAfter.length, 1, 'Must NOT create a fabricated +180d batch');
    assert.equal(batchesAfter[0].status, 'HetHan');
    assert.equal(batchesAfter[0].expiry_date, expiredYmd);
    assert.equal(srv.assertLedgerParity(prod.id, 'after expired return quarantine'), 0);

    const mov = srv.db
      .prepare("SELECT * FROM stock_movements WHERE product_id = ? AND doc_type = 'TRA_HANG_HET_HAN'")
      .get(prod.id);
    assert.ok(mov, 'Must log TRA_HANG_HET_HAN audit movement');
    assert.equal(mov.delta, 0);
  } finally {
    await srv.close();
  }
});

test('P1-F04-05: Non-expiry (has_expiry=0) product return restores exact no-expiry batch cleanly and preserves ledger parity', async () => {
  const srv = await startTestServer();
  try {
    const managerToken = await srv.loginAs('quanly');
    const cashierToken = await srv.loginAs('thungan');
    assert.equal((await srv.reqJson('POST', '/api/shifts/open', { token: cashierToken, body: { openingCash: 500000 } })).status, 201);
    const prod = await createIsolatedProduct(srv, managerToken, {
      sku: 'P1-F04-NOEXP',
      barcode: '8939000004051',
      name: 'Khăn giấy không hạn sử dụng',
      salePrice: 18000,
      costPrice: 10000,
      stockQty: 3,
      hasExpiry: false,
    });
    const origBatch = srv.db.prepare('SELECT * FROM product_batches WHERE product_id = ?').get(prod.id);
    assert.equal(origBatch.expiry_date, '');

    const ck = await srv.reqJson('POST', '/api/pos/checkout', {
      token: cashierToken,
      body: { items: [{ productId: prod.id, qty: 3 }], paymentMethod: 'CASH', cashReceived: 100000 },
    });
    assert.equal(ck.status, 201);
    assert.equal(srv.assertLedgerParity(prod.id, 'after no-expiry sell-out'), 0);

    const ret = await srv.reqJson('POST', '/api/returns', {
      token: cashierToken,
      body: { orderId: ck.data.item.id, reason: 'Trả hàng nguyên vẹn', restock: true, items: [{ productId: prod.id, qty: 2 }] },
    });
    assert.equal((await srv.reqJson('POST', `/api/returns/${ret.data.item.id}/approve`, { token: managerToken })).status, 200);

    const batchesAfter = srv.db.prepare('SELECT * FROM product_batches WHERE product_id = ?').all(prod.id);
    assert.equal(batchesAfter.length, 1);
    assert.equal(batchesAfter[0].id, origBatch.id);
    assert.equal(batchesAfter[0].expiry_date, '');
    assert.equal(batchesAfter[0].qty_remaining, 2);
    assert.equal(srv.assertLedgerParity(prod.id, 'after no-expiry return'), 2);
  } finally {
    await srv.close();
  }
});

// ============================================================================
// F-05A / F-05B / F-05C: SHIFT CASH REFUND ATTRIBUTION & UNCLAMPED DRAWER MATH
// ============================================================================

test('P1-F05-01: Same-cashier, same-shift cash refund deducts exactly once from that shift', async () => {
  const srv = await startTestServer();
  try {
    const managerToken = await srv.loginAs('quanly');
    const prod = await createIsolatedProduct(srv, managerToken, {
      sku: 'P1-F05-SAME',
      barcode: '8939000005011',
      name: 'SP test hoàn tiền cùng ca',
      salePrice: 50000,
      costPrice: 30000,
      stockQty: 10,
    });

    const shiftOpen = await srv.reqJson('POST', '/api/shifts/open', {
      token: managerToken,
      body: { openingCash: 100000, note: 'Ca test cùng người' },
    });
    assert.equal(shiftOpen.status, 201);
    const shiftId = shiftOpen.data.item.id;

    // Sell 1 unit CASH (50,000 + 8% VAT = 54,000)
    const ck = await srv.reqJson('POST', '/api/pos/checkout', {
      token: managerToken,
      body: { items: [{ productId: prod.id, qty: 1 }], paymentMethod: 'CASH', cashReceived: 100000 },
    });
    assert.equal(ck.status, 201);
    const totalPaid = ck.data.item.totalAmount;
    assert.equal(totalPaid, 54000);

    // F-08B SoD: Thu ngân lập phiếu trả, Quản lý (đang mở cùng ca shiftId) duyệt hoàn tiền mặt
    const cashierToken = await srv.loginAs('thungan');
    const ret = await srv.reqJson('POST', '/api/returns', {
      token: cashierToken,
      body: { orderId: ck.data.item.id, reason: 'Hoàn tiền cùng ca', restock: true, items: [{ productId: prod.id, qty: 1 }] },
    });
    assert.equal(ret.status, 201);
    const app = await srv.reqJson('POST', `/api/returns/${ret.data.item.id}/approve`, { token: managerToken });
    assert.equal(app.status, 200);
    assert.equal(app.data.item.refundShiftId, shiftId);

    const cur = await srv.reqJson('GET', '/api/shifts/current', { token: managerToken });
    assert.equal(cur.data.shift.cashSales, 54000);
    assert.equal(cur.data.shift.cashRefunds, 54000);
    assert.equal(cur.data.shift.expectedCash, 100000); // 100k + 54k - 54k
  } finally {
    await srv.close();
  }
});

test('P1-F05-02: Cross-cashier cash refund (thungan CA001 sold, quanly CA002 refunds 77,760) deducts ONLY from CA002 — zero double deduction on CA001', async () => {
  const srv = await startTestServer();
  try {
    const managerToken = await srv.loginAs('quanly');
    const cashierToken = await srv.loginAs('thungan');
    const prod = await createIsolatedProduct(srv, managerToken, {
      sku: 'P1-F05-XSHIFT',
      barcode: '8939000005021',
      name: 'SP test hoàn tiền chéo ca (72,000đ)',
      salePrice: 72000,
      costPrice: 40000,
      stockQty: 10,
    });

    const ca1Res = await srv.reqJson('POST', '/api/shifts/open', {
      token: cashierToken,
      body: { openingCash: 100000, note: 'Ca Thu ngân CA001' },
    });
    const ca2Res = await srv.reqJson('POST', '/api/shifts/open', {
      token: managerToken,
      body: { openingCash: 100000, note: 'Ca Quản lý CA002' },
    });
    assert.equal(ca1Res.status, 201);
    assert.equal(ca2Res.status, 201);
    const ca1Id = ca1Res.data.item.id;
    const ca2Id = ca2Res.data.item.id;

    // thungan sells 1 unit CASH -> 72,000 * 1.08 = 77,760
    const ck = await srv.reqJson('POST', '/api/pos/checkout', {
      token: cashierToken,
      body: { items: [{ productId: prod.id, qty: 1 }], paymentMethod: 'CASH', cashReceived: 100000 },
    });
    assert.equal(ck.status, 201);
    assert.equal(ck.data.item.totalAmount, 77760);
    assert.equal(ck.data.item.shiftId, ca1Id);

    // F-08B SoD: thungan creates return; quanly (CA002 open) approves and pays out cash refund from CA002
    const ret = await srv.reqJson('POST', '/api/returns', {
      token: cashierToken,
      body: { orderId: ck.data.item.id, reason: 'Quản lý chi hoàn tiền mặt tại quầy 2', restock: true, items: [{ productId: prod.id, qty: 1 }] },
    });
    assert.equal(ret.status, 201);
    const app = await srv.reqJson('POST', `/api/returns/${ret.data.item.id}/approve`, { token: managerToken });
    assert.equal(app.status, 200);
    assert.equal(app.data.item.refundShiftId, ca2Id);

    // Verify CA001 (thungan) is NOT double-deducted: cashRefunds = 0, expectedCash = 177,760
    const ca1Live = await srv.reqJson('GET', '/api/shifts/current', { token: cashierToken });
    assert.equal(ca1Live.data.shift.cashSales, 77760);
    assert.equal(ca1Live.data.shift.cashRefunds, 0, 'Original shift CA001 must NOT be deducted when CA002 paid out the cash refund');
    assert.equal(ca1Live.data.shift.expectedCash, 177760);

    // Verify CA002 (quanly) deducted exactly once: cashRefunds = 77,760, expectedCash = 22,240
    const ca2Live = await srv.reqJson('GET', '/api/shifts/current', { token: managerToken });
    assert.equal(ca2Live.data.shift.cashSales, 0);
    assert.equal(ca2Live.data.shift.cashRefunds, 77760);
    assert.equal(ca2Live.data.shift.expectedCash, 22240);
  } finally {
    await srv.close();
  }
});

test('P1-F05-03: Refund exceeding shift cash (20,000 - 77,760 = -57,760) reports true signed negative expectedCash and variance (NOT clamped to 0)', async () => {
  const srv = await startTestServer();
  try {
    const managerToken = await srv.loginAs('quanly');
    const cashierToken = await srv.loginAs('thungan');
    const prod = await createIsolatedProduct(srv, managerToken, {
      sku: 'P1-F05-NEG',
      barcode: '8939000005031',
      name: 'SP test âm két tiền (72,000đ)',
      salePrice: 72000,
      costPrice: 40000,
      stockQty: 10,
    });

    await srv.reqJson('POST', '/api/shifts/open', {
      token: cashierToken,
      body: { openingCash: 100000, note: 'Ca bán hàng' },
    });
    const ca2Res = await srv.reqJson('POST', '/api/shifts/open', {
      token: managerToken,
      body: { openingCash: 20000, note: 'Ca hoàn tiền quỹ nhỏ' },
    });
    const ca2Id = ca2Res.data.item.id;

    const ck = await srv.reqJson('POST', '/api/pos/checkout', {
      token: cashierToken,
      body: { items: [{ productId: prod.id, qty: 1 }], paymentMethod: 'CASH', cashReceived: 100000 },
    });
    assert.equal(ck.data.item.totalAmount, 77760);

    const ret = await srv.reqJson('POST', '/api/returns', {
      token: cashierToken,
      body: { orderId: ck.data.item.id, reason: 'Hoàn tiền vượt quỹ đầu ca', restock: true, items: [{ productId: prod.id, qty: 1 }] },
    });
    assert.equal(ret.status, 201);
    assert.equal((await srv.reqJson('POST', `/api/returns/${ret.data.item.id}/approve`, { token: managerToken })).status, 200);

    // Live check: expectedCash MUST be -57,760 (NOT clamped to 0)
    const ca2Live = await srv.reqJson('GET', '/api/shifts/current', { token: managerToken });
    assert.equal(ca2Live.data.shift.expectedCash, -57760);

    // Closing with actualCash = 0 -> variance = 0 - (-57,760) = +57,760 (requires explanation note since variance !== 0)
    const closeNoNote = await srv.reqJson('POST', `/api/shifts/${ca2Id}/close`, {
      token: managerToken,
      body: { actualCash: 0, note: '' },
    });
    assert.equal(closeNoNote.status, 400);

    const closeOk = await srv.reqJson('POST', `/api/shifts/${ca2Id}/close`, {
      token: managerToken,
      body: { actualCash: 0, note: 'Bù tiền mặt từ két tổng 57,760đ để chi hoàn khách' },
    });
    assert.equal(closeOk.status, 200, JSON.stringify(closeOk.data));
    assert.equal(closeOk.data.item.expectedCash, -57760);
    assert.equal(closeOk.data.item.actualCash, 0);
    assert.equal(closeOk.data.item.variance, 57760);
  } finally {
    await srv.close();
  }
});

test('P1-F05-04: VIETQR refund does NOT alter physical cash expectedCash of either shift', async () => {
  const srv = await startTestServer();
  try {
    const managerToken = await srv.loginAs('quanly');
    const cashierToken = await srv.loginAs('thungan');
    const prod = await createIsolatedProduct(srv, managerToken, {
      sku: 'P1-F05-QR',
      barcode: '8939000005041',
      name: 'SP test hoàn VietQR',
      salePrice: 50000,
      costPrice: 30000,
      stockQty: 10,
    });

    await srv.reqJson('POST', '/api/shifts/open', { token: cashierToken, body: { openingCash: 50000 } });
    await srv.reqJson('POST', '/api/shifts/open', { token: managerToken, body: { openingCash: 30000 } });

    const ck = await srv.reqJson('POST', '/api/pos/checkout', {
      token: cashierToken,
      body: { items: [{ productId: prod.id, qty: 1 }], paymentMethod: 'VIETQR', paymentRef: 'VCB-F05-QR-01' },
    });
    assert.equal(ck.status, 201);

    const ret = await srv.reqJson('POST', '/api/returns', {
      token: cashierToken,
      body: { orderId: ck.data.item.id, reason: 'Hoàn chuyển khoản', restock: true, items: [{ productId: prod.id, qty: 1 }] },
    });
    assert.equal(ret.status, 201);
    const app = await srv.reqJson('POST', `/api/returns/${ret.data.item.id}/approve`, { token: managerToken });
    assert.equal(app.status, 200);
    assert.equal(app.data.item.refundShiftId, null, 'Non-cash VIETQR refund must not bind to a physical cash shift');

    const ca1 = await srv.reqJson('GET', '/api/shifts/current', { token: cashierToken });
    const ca2 = await srv.reqJson('GET', '/api/shifts/current', { token: managerToken });
    assert.equal(ca1.data.shift.cashRefunds, 0);
    assert.equal(ca1.data.shift.expectedCash, 50000);
    assert.equal(ca2.data.shift.cashRefunds, 0);
    assert.equal(ca2.data.shift.expectedCash, 30000);
  } finally {
    await srv.close();
  }
});

test('P1-F05-05 (F-05C Enforced): Shiftless CASH checkout is rejected with 409 OPEN_SHIFT_REQUIRED, and succeeds once shift is opened', async () => {
  const srv = await startTestServer();
  try {
    const cashierToken = await srv.loginAs('thungan');
    const cur = await srv.reqJson('GET', '/api/shifts/current', { token: cashierToken });
    assert.equal(cur.data.shift, null);

    // F-05C enforced (ENFORCE_AND_UPDATE_17_TESTS): shiftless CASH checkout MUST fail with 409 OPEN_SHIFT_REQUIRED
    const blocked = await srv.reqJson('POST', '/api/pos/checkout', {
      token: cashierToken,
      body: { items: [{ productId: 'SP001', qty: 1 }], paymentMethod: 'CASH', cashReceived: 200000 },
    });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.data.error?.code, 'OPEN_SHIFT_REQUIRED');

    // Opening a shift immediately allows CASH checkout and binds shiftId
    const sh = await srv.reqJson('POST', '/api/shifts/open', {
      token: cashierToken,
      body: { openingCash: 100000 },
    });
    assert.equal(sh.status, 201);
    const ck = await srv.reqJson('POST', '/api/pos/checkout', {
      token: cashierToken,
      body: { items: [{ productId: 'SP001', qty: 1 }], paymentMethod: 'CASH', cashReceived: 200000 },
    });
    assert.equal(ck.status, 201);
    assert.equal(ck.data.item.shiftId, sh.data.item.id);
  } finally {
    await srv.close();
  }
});

// ============================================================================
// F-06A / F-06B / F-06C / F-06E: SUPPLIER PAYABLES, CREDITS, OWNERSHIP & IDEMPOTENCY
// ============================================================================

async function createConfirmedPoWithPayable(srv, { warehouseToken, managerToken, supplierId, productId, qty, unitCost }) {
  const poRes = await srv.reqJson('POST', '/api/purchases', {
    token: warehouseToken,
    body: {
      supplierId,
      note: 'PO tạo công nợ kiểm thử F-06',
      items: [{ productId, qty, unitCost, expiryDate: addDaysYmd(180) }],
    },
  });
  assert.equal(poRes.status, 201, JSON.stringify(poRes.data));
  const poId = poRes.data.item.id;

  const confirmRes = await srv.reqJson('POST', `/api/purchases/${poId}/confirm`, { token: managerToken });
  assert.equal(confirmRes.status, 200, JSON.stringify(confirmRes.data));

  const payable = srv.db.prepare('SELECT * FROM supplier_payables WHERE purchase_id = ?').get(poId);
  assert.ok(payable, 'Payable must exist after PO confirm');
  const batch = srv.db.prepare('SELECT * FROM product_batches WHERE purchase_id = ? AND product_id = ?').get(poId, productId);
  assert.ok(batch, 'Batch must exist after PO confirm');
  return { poId, payableId: payable.id, batchId: batch.id };
}

test('P1-F06-01: Linked supplier return (40k) after full AP payment (180k) preserves 40k creditAmount & supplier_credits entry', async () => {
  const srv = await startTestServer();
  try {
    const warehouseToken = await srv.loginAs('kho');
    const managerToken = await srv.loginAs('quanly');
    const prod = await createIsolatedProduct(srv, managerToken, {
      sku: 'P1-F06-CR1',
      barcode: '8939000006011',
      name: 'SP test tín dụng NCC',
      supplierId: 'NCC001',
      salePrice: 30000,
      costPrice: 20000,
      stockQty: 0,
    });

    const { poId, payableId, batchId } = await createConfirmedPoWithPayable(srv, {
      warehouseToken,
      managerToken,
      supplierId: 'NCC001',
      productId: prod.id,
      qty: 9,
      unitCost: 20000, // 180,000 VND
    });

    // Pay full 180,000 VND
    const payRes = await srv.reqJson('POST', `/api/payables/${payableId}/pay`, {
      token: managerToken,
      body: { amount: 180000, paymentMethod: 'BANK_TRANSFER', paymentRef: 'PAY-F06-01-FULL' },
    });
    assert.equal(payRes.status, 200);
    assert.equal(payRes.data.item.balanceAmount, 0);
    assert.equal(payRes.data.item.paidAmount, 180000);

    // Return 2 units (40,000 VND) linked to PO
    const srRes = await srv.reqJson('POST', '/api/supplier-returns', {
      token: warehouseToken,
      body: {
        supplierId: 'NCC001',
        purchaseId: poId,
        reason: 'Lỗi bao bì sau khi đã thanh toán đủ',
        items: [{ productId: prod.id, batchId, qty: 2, unitCost: 20000 }],
      },
    });
    assert.equal(srRes.status, 201, JSON.stringify(srRes.data));
    const appRes = await srv.reqJson('POST', `/api/supplier-returns/${srRes.data.item.id}/approve`, {
      token: managerToken,
    });
    assert.equal(appRes.status, 200, JSON.stringify(appRes.data));
    assert.equal(appRes.data.item.createdCreditAmount, 40000);

    const payableAfter = (await srv.reqJson('GET', `/api/payables/${payableId}`, { token: managerToken })).data.item;
    assert.equal(payableAfter.totalAmount, 140000);
    assert.equal(payableAfter.paidAmount, 180000);
    assert.equal(payableAfter.balanceAmount, 0);
    assert.equal(payableAfter.creditAmount, 40000, 'Overpaid 40,000 VND credit MUST be preserved');

    const listRes = await srv.reqJson('GET', '/api/payables?supplierId=NCC001', { token: managerToken });
    assert.equal(listRes.data.summary.totalCredit, 40000);
    assert.equal(srv.assertLedgerParity(prod.id, 'after linked return F-06A'), 7);
  } finally {
    await srv.close();
  }
});

test('P1-F06-02: Linked supplier return (40k) on partially paid AP (180k total, 100k paid) -> total 140k, paid 100k, balance 40k, credit 0', async () => {
  const srv = await startTestServer();
  try {
    const warehouseToken = await srv.loginAs('kho');
    const managerToken = await srv.loginAs('quanly');
    const prod = await createIsolatedProduct(srv, managerToken, {
      sku: 'P1-F06-PART',
      barcode: '8939000006021',
      name: 'SP test trả NCC công nợ trả một phần',
      supplierId: 'NCC001',
      salePrice: 30000,
      costPrice: 20000,
      stockQty: 0,
    });

    const { poId, payableId, batchId } = await createConfirmedPoWithPayable(srv, {
      warehouseToken,
      managerToken,
      supplierId: 'NCC001',
      productId: prod.id,
      qty: 9,
      unitCost: 20000, // 180,000 VND
    });

    assert.equal(
      (
        await srv.reqJson('POST', `/api/payables/${payableId}/pay`, {
          token: managerToken,
          body: { amount: 100000, paymentMethod: 'BANK_TRANSFER', paymentRef: 'PAY-F06-02-PART' },
        })
      ).status,
      200,
    );

    const sr = await srv.reqJson('POST', '/api/supplier-returns', {
      token: warehouseToken,
      body: {
        supplierId: 'NCC001',
        purchaseId: poId,
        reason: 'Trả hàng hỏng nhẹ',
        items: [{ productId: prod.id, batchId, qty: 2, unitCost: 20000 }],
      },
    });
    const app = await srv.reqJson('POST', `/api/supplier-returns/${sr.data.item.id}/approve`, { token: managerToken });
    assert.equal(app.status, 200);
    assert.equal(app.data.item.createdCreditAmount, 0);

    const payableAfter = (await srv.reqJson('GET', `/api/payables/${payableId}`, { token: managerToken })).data.item;
    assert.equal(payableAfter.totalAmount, 140000);
    assert.equal(payableAfter.paidAmount, 100000);
    assert.equal(payableAfter.balanceAmount, 40000);
    assert.equal(payableAfter.creditAmount, 0);
    assert.equal(payableAfter.status, 'ThanhToanMotPhan');
  } finally {
    await srv.close();
  }
});

test('P1-F06-03: Unlinked supplier return (purchaseId: null) automatically offsets oldest open AP and records excess in supplier_credits', async () => {
  const srv = await startTestServer();
  try {
    const warehouseToken = await srv.loginAs('kho');
    const managerToken = await srv.loginAs('quanly');
    const prod = await createIsolatedProduct(srv, managerToken, {
      sku: 'P1-F06-UNL',
      barcode: '8939000006031',
      name: 'SP NCC002 test trả không gắn PO',
      supplierId: 'NCC002',
      salePrice: 30000,
      costPrice: 20000,
      stockQty: 0,
    });

    // Create 100,000 VND open payable for NCC002 (5 units * 20,000) + extra 3 units in a second batch via another PO paid in full
    const po1 = await createConfirmedPoWithPayable(srv, {
      warehouseToken,
      managerToken,
      supplierId: 'NCC002',
      productId: prod.id,
      qty: 5,
      unitCost: 20000, // 100,000 open AP
    });
    const po2 = await createConfirmedPoWithPayable(srv, {
      warehouseToken,
      managerToken,
      supplierId: 'NCC002',
      productId: prod.id,
      qty: 3,
      unitCost: 20000, // 60,000 AP -> pay full so only po1 (100k) remains open
    });
    assert.equal(
      (
        await srv.reqJson('POST', `/api/payables/${po2.payableId}/pay`, {
          token: managerToken,
          body: { amount: 60000, paymentRef: 'PAY-NCC002-PO2-FULL' },
        })
      ).status,
      200,
    );

    // Unlinked return #1 (40,000 VND) -> reduces po1 open AP from 100k to 60k
    const sr1 = await srv.reqJson('POST', '/api/supplier-returns', {
      token: warehouseToken,
      body: {
        supplierId: 'NCC002',
        purchaseId: null,
        reason: 'Trả hàng không gắn PO đợt 1',
        items: [{ productId: prod.id, batchId: po1.batchId, qty: 2, unitCost: 20000 }],
      },
    });
    assert.equal(sr1.status, 201, JSON.stringify(sr1.data));
    const app1 = await srv.reqJson('POST', `/api/supplier-returns/${sr1.data.item.id}/approve`, { token: managerToken });
    assert.equal(app1.status, 200, JSON.stringify(app1.data));

    const ap1Mid = (await srv.reqJson('GET', `/api/payables/${po1.payableId}`, { token: managerToken })).data.item;
    assert.equal(ap1Mid.balanceAmount, 60000, 'Open AP must drop from 100k to 60k');

    // Unlinked return #2 (100,000 VND = 5 units * 20k: 3 from po1 + 2 from po2) -> clears remaining 60k AP + records 40k supplier_credit
    const sr2 = await srv.reqJson('POST', '/api/supplier-returns', {
      token: warehouseToken,
      body: {
        supplierId: 'NCC002',
        purchaseId: null,
        reason: 'Trả hàng không gắn PO đợt 2 vượt dư nợ',
        items: [
          { productId: prod.id, batchId: po1.batchId, qty: 3, unitCost: 20000 },
          { productId: prod.id, batchId: po2.batchId, qty: 2, unitCost: 20000 },
        ],
      },
    });
    assert.equal(sr2.status, 201, JSON.stringify(sr2.data));
    const app2 = await srv.reqJson('POST', `/api/supplier-returns/${sr2.data.item.id}/approve`, { token: managerToken });
    assert.equal(app2.status, 200, JSON.stringify(app2.data));
    assert.equal(app2.data.item.createdCreditAmount, 40000);

    const ap1End = (await srv.reqJson('GET', `/api/payables/${po1.payableId}`, { token: managerToken })).data.item;
    assert.equal(ap1End.balanceAmount, 0);
    assert.equal(ap1End.status, 'DaThanhToanNCC');

    const ncc2List = await srv.reqJson('GET', '/api/payables?supplierId=NCC002', { token: managerToken });
    assert.equal(ncc2List.data.summary.totalCredit, 40000, 'Excess 40k from unlinked return must be preserved in supplier_credits');
    assert.equal(srv.assertLedgerParity(prod.id, 'after unlinked supplier returns'), 1);
  } finally {
    await srv.close();
  }
});

test('P1-F06-04: Cross-supplier batch return (NCC001 batch returned to NCC002) is strictly rejected (400/409 BATCH_SUPPLIER_MISMATCH)', async () => {
  const srv = await startTestServer();
  try {
    const warehouseToken = await srv.loginAs('kho');
    const managerToken = await srv.loginAs('quanly');
    const prodNcc1 = await createIsolatedProduct(srv, managerToken, {
      sku: 'P1-F06-OWN1',
      barcode: '8939000006041',
      name: 'SP thuộc NCC001',
      supplierId: 'NCC001',
      salePrice: 30000,
      costPrice: 20000,
      stockQty: 0,
    });

    const { batchId } = await createConfirmedPoWithPayable(srv, {
      warehouseToken,
      managerToken,
      supplierId: 'NCC001',
      productId: prodNcc1.id,
      qty: 5,
      unitCost: 20000,
    });

    const stockBefore = srv.assertLedgerParity(prodNcc1.id, 'before cross-supplier attack');
    const apCountBefore = srv.db.prepare('SELECT COUNT(*) AS c FROM supplier_payables').get().c;

    // Attempt to return NCC001's batch to NCC002 -> MUST fail 400 BATCH_SUPPLIER_MISMATCH
    const badCreate = await srv.reqJson('POST', '/api/supplier-returns', {
      token: warehouseToken,
      body: {
        supplierId: 'NCC002',
        reason: 'Trả nhầm lô NCC001 cho NCC002',
        items: [{ productId: prodNcc1.id, batchId, qty: 2, unitCost: 20000 }],
      },
    });
    assert.equal(badCreate.status, 400);
    assert.equal(badCreate.data.error.code, 'BATCH_SUPPLIER_MISMATCH');

    // Defense-in-depth: even if a pre-existing cross-supplier return row exists in DB, approve MUST reject 409
    const khoUser = srv.db.prepare("SELECT id FROM users WHERE username = 'kho'").get();
    const repos = createRepositories(srv.db);
    const badSr = repos.supplierOps.createSupplierReturn(
      { supplier_id: 'NCC002', purchase_id: null, created_by: khoUser.id, total_amount: 40000, reason: 'Legacy mismatch' },
      [{ product_id: prodNcc1.id, batch_id: batchId, batch_code: 'BAD', qty: 2, unit_cost: 20000, line_total: 40000 }],
    );
    const badApprove = await srv.reqJson('POST', `/api/supplier-returns/${badSr.id}/approve`, { token: managerToken });
    assert.equal(badApprove.status, 409);
    assert.equal(badApprove.data.error.code, 'BATCH_SUPPLIER_MISMATCH');

    // Adversarial: duplicate batchId lines in one createSupplierReturn must be rejected 400
    const dupBatchCreate = await srv.reqJson('POST', '/api/supplier-returns', {
      token: warehouseToken,
      body: {
        supplierId: 'NCC001',
        reason: 'Trùng dòng lô hàng',
        items: [
          { productId: prodNcc1.id, batchId, qty: 3, unitCost: 20000 },
          { productId: prodNcc1.id, batchId, qty: 3, unitCost: 20000 },
        ],
      },
    });
    assert.equal(dupBatchCreate.status, 400);

    assert.equal(srv.assertLedgerParity(prodNcc1.id, 'after blocked cross-supplier return'), stockBefore);
    assert.equal(srv.db.prepare('SELECT COUNT(*) AS c FROM supplier_payables').get().c, apCountBefore);
  } finally {
    await srv.close();
  }
});

test('P1-F06-05: Duplicate paymentRef (including case/whitespace variants) on supplier payment returns 409 DUPLICATE_PAYMENT_REF with zero second ledger mutation', async () => {
  const srv = await startTestServer();
  try {
    const warehouseToken = await srv.loginAs('kho');
    const managerToken = await srv.loginAs('quanly');
    const prod = await createIsolatedProduct(srv, managerToken, {
      sku: 'P1-F06-DUP',
      barcode: '8939000006051',
      name: 'SP test trùng mã thanh toán NCC',
      supplierId: 'NCC001',
      salePrice: 30000,
      costPrice: 20000,
      stockQty: 0,
    });

    const { payableId } = await createConfirmedPoWithPayable(srv, {
      warehouseToken,
      managerToken,
      supplierId: 'NCC001',
      productId: prod.id,
      qty: 10,
      unitCost: 20000, // 200,000 VND
    });

    const first = await srv.reqJson('POST', `/api/payables/${payableId}/pay`, {
      token: managerToken,
      body: { amount: 50000, paymentMethod: 'BANK_TRANSFER', paymentRef: 'DUP-REF-001' },
    });
    assert.equal(first.status, 200);
    assert.equal(first.data.item.paidAmount, 50000);
    assert.equal(first.data.item.balanceAmount, 150000);

    // Exact duplicate -> 409 Conflict
    const dupExact = await srv.reqJson('POST', `/api/payables/${payableId}/pay`, {
      token: managerToken,
      body: { amount: 50000, paymentMethod: 'BANK_TRANSFER', paymentRef: 'DUP-REF-001' },
    });
    assert.equal(dupExact.status, 409);
    assert.equal(dupExact.data.error.code, 'DUPLICATE_PAYMENT_REF');

    // Case & whitespace variant -> ALSO 409 Conflict
    const dupVariant = await srv.reqJson('POST', `/api/payables/${payableId}/pay`, {
      token: managerToken,
      body: { amount: 50000, method: 'BANK_TRANSFER', referenceNo: '  dup-ref-001  ' },
    });
    assert.equal(dupVariant.status, 409);
    assert.equal(dupVariant.data.error.code, 'DUPLICATE_PAYMENT_REF');

    const payCount = srv.db.prepare('SELECT COUNT(*) AS c FROM supplier_payments WHERE payable_id = ?').get(payableId).c;
    assert.equal(payCount, 1);
    const apAfter = (await srv.reqJson('GET', `/api/payables/${payableId}`, { token: managerToken })).data.item;
    assert.equal(apAfter.paidAmount, 50000);
    assert.equal(apAfter.balanceAmount, 150000);
  } finally {
    await srv.close();
  }
});

test('P1-F06-06: Mid-transaction failure in approveSupplierReturn and recordSupplierPayment rolls back 100% atomically', async () => {
  const srv = await startTestServer();
  try {
    const warehouseToken = await srv.loginAs('kho');
    const managerToken = await srv.loginAs('quanly');
    const prod = await createIsolatedProduct(srv, managerToken, {
      sku: 'P1-F06-RB',
      barcode: '8939000006061',
      name: 'SP test rollback F-06',
      supplierId: 'NCC001',
      salePrice: 30000,
      costPrice: 20000,
      stockQty: 0,
    });

    const { poId, payableId, batchId } = await createConfirmedPoWithPayable(srv, {
      warehouseToken,
      managerToken,
      supplierId: 'NCC001',
      productId: prod.id,
      qty: 5,
      unitCost: 20000, // 100,000 VND
    });

    const repos = createRepositories(srv.db);
    const whSvc = new WarehouseService(srv.db, repos);
    const managerUser = repos.users.findByUsername('quanly');

    // 1) Rollback test on recordSupplierPayment
    assert.throws(
      () =>
        whSvc.recordSupplierPayment(
          managerUser,
          payableId,
          { amount: 50000, paymentRef: 'RB-PAY-001' },
          {
            _beforeCommitHook: () => {
              throw new Error('Simulated payment mid-TX failure');
            },
          },
        ),
      /Simulated payment mid-TX failure/,
    );
    assert.equal(srv.db.prepare('SELECT COUNT(*) AS c FROM supplier_payments WHERE payable_id = ?').get(payableId).c, 0);
    assert.equal(repos.supplierOps.findPayableById(payableId).balance_amount, 100000);

    // 2) Rollback test on approveSupplierReturn (unlinked return -> stock + AP + credits must all roll back)
    const sr = await srv.reqJson('POST', '/api/supplier-returns', {
      token: warehouseToken,
      body: {
        supplierId: 'NCC001',
        purchaseId: poId,
        reason: 'Test rollback duyệt trả NCC',
        items: [{ productId: prod.id, batchId, qty: 2, unitCost: 20000 }],
      },
    });
    assert.equal(sr.status, 201);
    const srId = sr.data.item.id;
    const movesBefore = srv.db.prepare('SELECT COUNT(*) AS c FROM stock_movements WHERE product_id = ?').get(prod.id).c;
    const creditsBefore = srv.db.prepare('SELECT COUNT(*) AS c FROM supplier_credits').get().c;

    assert.throws(
      () =>
        whSvc.approveSupplierReturn(managerUser, srId, {
          _beforeCommitHook: () => {
            throw new Error('Simulated supplier return mid-TX failure');
          },
        }),
      /Simulated supplier return mid-TX failure/,
    );

    assert.equal(srv.assertLedgerParity(prod.id, 'after rollback approveSupplierReturn'), 5);
    assert.equal(repos.supplierOps.findPayableById(payableId).balance_amount, 100000);
    assert.equal(repos.supplierOps.findSupplierReturnById(srId).status, 'ChoDuyet');
    assert.equal(srv.db.prepare('SELECT COUNT(*) AS c FROM stock_movements WHERE product_id = ?').get(prod.id).c, movesBefore);
    assert.equal(srv.db.prepare('SELECT COUNT(*) AS c FROM supplier_credits').get().c, creditsBefore);
  } finally {
    await srv.close();
  }
});
