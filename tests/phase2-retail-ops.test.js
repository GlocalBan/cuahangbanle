'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../server.js');
const { createRepositories } = require('../src/server/dal/repositories.js');
const { WarehouseService } = require('../src/server/bll/warehouseService.js');

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

  return {
    server,
    db: server.db,
    reqJson,
    loginAs,
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
  const d = new Date(Date.now() + days * 86400000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

test('P2-01 (2a): Voucher CRUD, bulk generation, pause/resume, POS XOR (Voucher vs Promotion) & per-customer usage cap', async () => {
  const srv = await startTestServer();
  try {
    const managerToken = await srv.loginAs('quanly');
    const cashierToken = await srv.loginAs('thungan');
    assert.equal((await srv.reqJson('POST', '/api/shifts/open', { token: cashierToken, body: { openingCash: 500000 } })).status, 201);

    // 1. Create single voucher
    const vCreate = await srv.reqJson('POST', '/api/vouchers', {
      token: managerToken,
      body: {
        code: 'VCH-TEST15',
        name: 'Voucher giảm 15.000đ',
        discountType: 'FIXED',
        discountValue: 15000,
        minOrderAmount: 50000,
        usageLimit: 5,
        maxUsesPerCustomer: 1,
        startDate: addDaysYmd(-1),
        endDate: addDaysYmd(30),
        status: 'DangDienRa',
      },
    });
    assert.equal(vCreate.status, 201, JSON.stringify(vCreate.data));
    assert.equal(vCreate.data.item.code, 'VCH-TEST15');

    // 2. Bulk generate 3 vouchers
    const bulkRes = await srv.reqJson('POST', '/api/vouchers/bulk', {
      token: managerToken,
      body: {
        prefix: 'TET26',
        count: 3,
        name: 'Voucher Tết hàng loạt',
        discountType: 'PERCENT',
        discountValue: 10,
        maxDiscount: 30000,
        minOrderAmount: 100000,
        usageLimit: 1,
        startDate: addDaysYmd(-1),
        endDate: addDaysYmd(15),
      },
    });
    assert.equal(bulkRes.status, 201, JSON.stringify(bulkRes.data));
    assert.equal(bulkRes.data.items.length, 3);
    assert.ok(bulkRes.data.items.every((v) => v.code.startsWith('TET26-')));

    // 3. Pause then resume voucher
    const paused = await srv.reqJson('PATCH', `/api/vouchers/${vCreate.data.item.id}/status`, {
      token: managerToken,
      body: { status: 'TamDung' },
    });
    assert.equal(paused.status, 200);
    assert.equal(paused.data.item.status, 'TamDung');

    const valPaused = await srv.reqJson('POST', '/api/vouchers/validate', {
      token: cashierToken,
      body: { code: 'VCH-TEST15', subtotal: 100000 },
    });
    assert.equal(valPaused.status, 400);

    const resumed = await srv.reqJson('PATCH', `/api/vouchers/${vCreate.data.item.id}/status`, {
      token: managerToken,
      body: { status: 'DangDienRa' },
    });
    assert.equal(resumed.status, 200);

    // 4. Hard-delete voucher is forbidden (403)
    assert.equal((await srv.reqJson('DELETE', `/api/vouchers/${vCreate.data.item.id}`, { token: managerToken })).status, 403);

    // 5. Find a product with stock & active promo for XOR check
    const promosRes = await srv.reqJson('GET', '/api/promotions?activeOnly=true', { token: cashierToken });
    assert.equal(promosRes.status, 200);
    const activePromo = promosRes.data.items.find((p) => p.scope === 'INVOICE' && p.usableNow) || promosRes.data.items[0];
    assert.ok(activePromo, 'Need an active seeded promotion');

    // XOR: sending BOTH voucherCode and promotionCode MUST fail 400
    const xorFail = await srv.reqJson('POST', '/api/pos/checkout', {
      token: cashierToken,
      body: {
        items: [{ productId: 'SP001', qty: 2 }],
        voucherCode: 'VCH-TEST15',
        promotionCode: activePromo.code,
        paymentMethod: 'CASH',
        cashReceived: 500000,
      },
    });
    assert.equal(xorFail.status, 400);
    assert.match(xorFail.data.error?.message || '', /Voucher|khuyến mãi/i);

    // 6. Valid checkout with Voucher ONLY for customer KH001
    const okCheckout = await srv.reqJson('POST', '/api/pos/checkout', {
      token: cashierToken,
      body: {
        customerId: 'KH001',
        items: [{ productId: 'SP001', qty: 3 }],
        voucherCode: 'VCH-TEST15',
        paymentMethod: 'CASH',
        cashReceived: 500000,
      },
    });
    assert.equal(okCheckout.status, 201, JSON.stringify(okCheckout.data));
    assert.equal(okCheckout.data.item.discountMode, 'VOUCHER');
    assert.equal(okCheckout.data.item.voucherCode, 'VCH-TEST15');
    assert.equal(okCheckout.data.item.invoiceDiscount, 15000);

    // 7. Second use by same customer KH001 MUST fail (maxUsesPerCustomer = 1)
    const repeatFail = await srv.reqJson('POST', '/api/pos/checkout', {
      token: cashierToken,
      body: {
        customerId: 'KH001',
        items: [{ productId: 'SP001', qty: 3 }],
        voucherCode: 'VCH-TEST15',
        paymentMethod: 'CASH',
        cashReceived: 500000,
      },
    });
    assert.equal(repeatFail.status, 400);
    assert.match(repeatFail.data.error?.message || '', /giới hạn|đã sử dụng/i);
  } finally {
    await srv.close();
  }
});

test('P2-02 (2b): Near-expiry promotion suggestions & NEAR_EXPIRY promo applies only to qualifying near-expiry batch units', async () => {
  const srv = await startTestServer();
  try {
    const managerToken = await srv.loginAs('quanly');
    const cashierToken = await srv.loginAs('thungan');
    assert.equal((await srv.reqJson('POST', '/api/shifts/open', { token: cashierToken, body: { openingCash: 500000 } })).status, 201);

    // 1. Query near-expiry suggestions from product_batches
    const sugRes = await srv.reqJson('GET', '/api/promotions/near-expiry-suggestions?days=30', { token: managerToken });
    assert.equal(sugRes.status, 200);
    assert.ok(Array.isArray(sugRes.data.items));
    assert.ok(sugRes.data.items.length > 0, 'Seeded DB must have near-expiry batches within 30 days');

    const candidate = sugRes.data.items[0];
    assert.ok(candidate.productId);
    assert.ok(candidate.nearExpiryQty > 0);
    assert.ok(candidate.suggestedDiscountPct >= 10);

    // Find a product with NO near-expiry batch within 14 days
    const allProds = (await srv.reqJson('GET', '/api/products?stockLevel=in_stock', { token: managerToken })).data.items;
    const nearSet = new Set(sugRes.data.items.map((x) => x.productId));
    const nonNearProd = allProds.find((p) => !nearSet.has(p.id) && p.stockQty >= 2);
    assert.ok(nonNearProd, 'Need a non-near-expiry product in stock');

    // 2. Create NEAR_EXPIRY promotion targeting candidate
    const promoRes = await srv.reqJson('POST', '/api/promotions', {
      token: managerToken,
      body: {
        code: 'XADATE30',
        name: 'Xả hàng cận date giảm 30%',
        discountType: 'PERCENT',
        discountValue: 30,
        maxDiscount: 100000,
        minOrderAmount: 0,
        scope: 'NEAR_EXPIRY',
        nearExpiryDays: 30,
        productIds: [candidate.productId],
        usageLimit: 20,
        startDate: addDaysYmd(-1),
        endDate: addDaysYmd(14),
        status: 'DangDienRa',
      },
    });
    assert.equal(promoRes.status, 201, JSON.stringify(promoRes.data));
    assert.equal(promoRes.data.item.scope, 'NEAR_EXPIRY');

    // 3. Checkout with ONLY non-near-expiry product -> MUST reject (400)
    const noMatch = await srv.reqJson('POST', '/api/pos/checkout', {
      token: cashierToken,
      body: {
        items: [{ productId: nonNearProd.id, qty: 1 }],
        promotionCode: 'XADATE30',
        paymentMethod: 'CASH',
        cashReceived: nonNearProd.salePrice * 2,
      },
    });
    assert.equal(noMatch.status, 400);

    // 4. Checkout with candidate (1 unit) + nonNearProd (1 unit) -> discount applies ONLY to candidate's near-expiry unit
    const candProd = (await srv.reqJson('GET', `/api/products/${candidate.productId}`, { token: managerToken })).data.item;
    const expectedDiscount = Math.min(100000, Math.round(candProd.salePrice * 0.3));
    const mixedCheckout = await srv.reqJson('POST', '/api/pos/checkout', {
      token: cashierToken,
      body: {
        items: [
          { productId: candidate.productId, qty: 1 },
          { productId: nonNearProd.id, qty: 1 },
        ],
        promotionCode: 'XADATE30',
        paymentMethod: 'CASH',
        cashReceived: (candProd.salePrice + nonNearProd.salePrice) * 2,
      },
    });
    assert.equal(mixedCheckout.status, 201, JSON.stringify(mixedCheckout.data));
    assert.equal(mixedCheckout.data.item.invoiceDiscount, expectedDiscount);
  } finally {
    await srv.close();
  }
});

test('P2-03 (2c): Cashier Shift open/close, cash reconciliation, duplicate open block & mandatory variance note', async () => {
  const srv = await startTestServer();
  try {
    const cashierToken = await srv.loginAs('thungan');
    const managerToken = await srv.loginAs('quanly');

    // Initially no open shift
    const cur0 = await srv.reqJson('GET', '/api/shifts/current', { token: cashierToken });
    assert.equal(cur0.status, 200);
    assert.equal(cur0.data.shift, null);

    // Open shift with 2,000,000 VND
    const opened = await srv.reqJson('POST', '/api/shifts/open', {
      token: cashierToken,
      body: { openingCash: 2000000, note: 'Ca sáng quầy 1' },
    });
    assert.equal(opened.status, 201, JSON.stringify(opened.data));
    const shiftId = opened.data.item.id;
    assert.equal(opened.data.item.openingCash, 2000000);
    assert.equal(opened.data.item.status, 'DangMo');

    // Duplicate open shift -> 409 Conflict
    const dup = await srv.reqJson('POST', '/api/shifts/open', {
      token: cashierToken,
      body: { openingCash: 1000000 },
    });
    assert.equal(dup.status, 409);

    // Perform 1 CASH order and 1 VIETQR order -> attached to open shift
    const cashOrder = await srv.reqJson('POST', '/api/pos/checkout', {
      token: cashierToken,
      body: {
        items: [{ productId: 'SP001', qty: 1 }],
        paymentMethod: 'CASH',
        cashReceived: 100000,
      },
    });
    assert.equal(cashOrder.status, 201);
    assert.equal(cashOrder.data.item.shiftId, shiftId);

    const qrOrder = await srv.reqJson('POST', '/api/pos/checkout', {
      token: cashierToken,
      body: {
        items: [{ productId: 'SP002', qty: 1 }],
        paymentMethod: 'VIETQR',
        paymentRef: 'VCB-SHIFT-001',
      },
    });
    assert.equal(qrOrder.status, 201);
    assert.equal(qrOrder.data.item.shiftId, shiftId);

    const expectedCash = 2000000 + cashOrder.data.item.totalAmount;

    // Live shift metrics check
    const cur1 = await srv.reqJson('GET', '/api/shifts/current', { token: cashierToken });
    assert.equal(cur1.status, 200);
    assert.equal(cur1.data.shift.orderCount, 2);
    assert.equal(cur1.data.shift.cashSales, cashOrder.data.item.totalAmount);
    assert.equal(cur1.data.shift.nonCashSales, qrOrder.data.item.totalAmount);
    assert.equal(cur1.data.shift.expectedCash, expectedCash);

    // Close shift with variance (-5000) and NO note -> 400
    const badClose = await srv.reqJson('POST', `/api/shifts/${shiftId}/close`, {
      token: cashierToken,
      body: { actualCash: expectedCash - 5000, note: '' },
    });
    assert.equal(badClose.status, 400);

    // Close shift with variance (-5000) and valid explanation -> 200
    const okClose = await srv.reqJson('POST', `/api/shifts/${shiftId}/close`, {
      token: cashierToken,
      body: { actualCash: expectedCash - 5000, note: 'Thối nhầm 5.000đ tiền lẻ cho khách' },
    });
    assert.equal(okClose.status, 200, JSON.stringify(okClose.data));
    assert.equal(okClose.data.item.status, 'DaDong');
    assert.equal(okClose.data.item.variance, -5000);
    assert.equal(okClose.data.item.expectedCash, expectedCash);

    // Double close -> 409
    assert.equal(
      (await srv.reqJson('POST', `/api/shifts/${shiftId}/close`, { token: cashierToken, body: { actualCash: expectedCash } })).status,
      409,
    );

    // Manager can view shift history
    const listShifts = await srv.reqJson('GET', '/api/shifts', { token: managerToken });
    assert.equal(listShifts.status, 200);
    assert.ok(listShifts.data.items.some((s) => s.id === shiftId && s.status === 'DaDong'));
  } finally {
    await srv.close();
  }
});

test('P2-04 (2d): Two-way PO negotiation with 5th role SUPPLIER (ncc01), partial GRN, auto AP payable, supplier return & atomic rollbacks', async () => {
  const srv = await startTestServer();
  try {
    const warehouseToken = await srv.loginAs('kho');
    const managerToken = await srv.loginAs('quanly');
    const supplierToken = await srv.loginAs('ncc01'); // supplier_id = NCC003

    // 1. Warehouse creates PO for NCC003 (10 units SP006) + PO for another supplier NCC001
    const poRes = await srv.reqJson('POST', '/api/purchases', {
      token: warehouseToken,
      body: {
        supplierId: 'NCC003',
        expectedDeliveryDate: addDaysYmd(3),
        note: 'Đặt lô cà phê G7',
        items: [{ productId: 'SP006', qty: 10, unitCost: 45000, expiryDate: addDaysYmd(300) }],
      },
    });
    assert.equal(poRes.status, 201);
    const poId = poRes.data.item.id;

    const otherPoRes = await srv.reqJson('POST', '/api/purchases', {
      token: warehouseToken,
      body: {
        supplierId: 'NCC001',
        note: 'Đơn NCC khác',
        items: [{ productId: 'SP001', qty: 5, unitCost: 22000, expiryDate: addDaysYmd(120) }],
      },
    });
    assert.equal(otherPoRes.status, 201);
    const otherPoId = otherPoRes.data.item.id;

    // 2. Send both POs to suppliers (Draft -> GuiNCC)
    const sent = await srv.reqJson('POST', `/api/purchases/${poId}/send`, {
      token: warehouseToken,
      body: { message: 'Đề nghị NCC xác nhận giá và lịch giao' },
    });
    assert.equal(sent.status, 200);
    assert.equal(sent.data.item.status, 'GuiNCC');

    await srv.reqJson('POST', `/api/purchases/${otherPoId}/send`, { token: warehouseToken, body: {} });

    // 3. Supplier portal isolation: ncc01 sees NCC003 PO only, gets 403 on NCC001 PO
    const portalList = await srv.reqJson('GET', '/api/supplier-portal/purchases', { token: supplierToken });
    assert.equal(portalList.status, 200);
    assert.ok(portalList.data.items.some((p) => p.id === poId));
    assert.ok(!portalList.data.items.some((p) => p.id === otherPoId));

    const crossRead = await srv.reqJson('GET', `/api/supplier-portal/purchases/${otherPoId}`, { token: supplierToken });
    assert.equal(crossRead.status, 403);
    const crossRespond = await srv.reqJson('POST', `/api/purchases/${otherPoId}/respond`, {
      token: supplierToken,
      body: { action: 'ACCEPT' },
    });
    assert.equal(crossRespond.status, 403);

    // 4. Multi-round negotiation: Supplier COUNTERs price to 47000 -> Store COUNTERs to 46000 -> Supplier ACCEPTs -> Manager AGREEs
    const supCounter = await srv.reqJson('POST', `/api/purchases/${poId}/respond`, {
      token: supplierToken,
      body: {
        action: 'COUNTER',
        message: 'Giá nguyên liệu tăng, đề xuất 47.000đ/hộp',
        items: [{ productId: 'SP006', qty: 10, unitCost: 47000 }],
      },
    });
    assert.equal(supCounter.status, 200, JSON.stringify(supCounter.data));
    assert.equal(supCounter.data.item.status, 'NCCPhanHoi');
    assert.equal(supCounter.data.item.negotiations.length, 2);

    const storeCounter = await srv.reqJson('POST', `/api/purchases/${poId}/counter`, {
      token: managerToken,
      body: {
        message: 'Chốt giá trung bình 46.000đ/hộp',
        items: [{ productId: 'SP006', qty: 10, unitCost: 46000 }],
      },
    });
    assert.equal(storeCounter.status, 200);
    assert.equal(storeCounter.data.item.status, 'ThuongLuong');

    const supAccept = await srv.reqJson('POST', `/api/purchases/${poId}/respond`, {
      token: supplierToken,
      body: { action: 'ACCEPT', message: 'Đồng ý giá 46.000đ' },
    });
    assert.equal(supAccept.status, 200);
    assert.equal(supAccept.data.item.status, 'DaThongNhat');
    assert.equal(supAccept.data.item.totalAmount, 460000);

    // 5. Partial GRN #1: Receive 6/10 units -> PO becomes DangNhanHang + AP Payable created (276,000)
    const sp6Before = (await srv.reqJson('GET', '/api/products/SP006', { token: managerToken })).data.item.stockQty;
    const grn1Create = await srv.reqJson('POST', '/api/grns', {
      token: warehouseToken,
      body: {
        purchaseId: poId,
        note: 'Giao đợt 1: 6 hộp',
        items: [{ productId: 'SP006', receivedQty: 6, unitCost: 46000, expiryDate: addDaysYmd(300) }],
      },
    });
    assert.equal(grn1Create.status, 201, JSON.stringify(grn1Create.data));
    const grn1Id = grn1Create.data.item.id;

    // Trying to receive 5 more (> remaining 4) MUST fail 400
    const overGrn = await srv.reqJson('POST', '/api/grns', {
      token: warehouseToken,
      body: {
        purchaseId: poId,
        items: [{ productId: 'SP006', receivedQty: 5, unitCost: 46000, expiryDate: addDaysYmd(300) }],
      },
    });
    assert.equal(overGrn.status, 400);

    const grn1Confirm = await srv.reqJson('POST', `/api/grns/${grn1Id}/confirm`, { token: managerToken });
    assert.equal(grn1Confirm.status, 200, JSON.stringify(grn1Confirm.data));
    assert.equal(grn1Confirm.data.item.status, 'DaDuyet');

    const poAfterGrn1 = (await srv.reqJson('GET', `/api/purchases/${poId}`, { token: managerToken })).data.item;
    assert.equal(poAfterGrn1.status, 'DangNhanHang');
    assert.equal((await srv.reqJson('GET', '/api/products/SP006', { token: managerToken })).data.item.stockQty, sp6Before + 6);

    // 6. Partial GRN #2: Receive remaining 4/10 units -> PO transitions to Confirmed
    const grn2Create = await srv.reqJson('POST', '/api/grns', {
      token: warehouseToken,
      body: {
        purchaseId: poId,
        note: 'Giao đợt 2: đủ 4 hộp còn lại',
        items: [{ productId: 'SP006', receivedQty: 4, unitCost: 46000, expiryDate: addDaysYmd(320) }],
      },
    });
    assert.equal(grn2Create.status, 201);
    const grn2Confirm = await srv.reqJson('POST', `/api/grns/${grn2Create.data.item.id}/confirm`, { token: managerToken });
    assert.equal(grn2Confirm.status, 200);
    const poAfterGrn2 = (await srv.reqJson('GET', `/api/purchases/${poId}`, { token: managerToken })).data.item;
    assert.equal(poAfterGrn2.status, 'Confirmed');

    // 7. AP Payables: verify auto-created payables & record partial + final payment
    const payablesRes = await srv.reqJson('GET', '/api/payables?supplierId=NCC003', { token: managerToken });
    assert.equal(payablesRes.status, 200);
    const payable1 = payablesRes.data.items.find((p) => p.receiptId === grn1Id);
    assert.ok(payable1, 'AP payable must be auto-created on GRN confirmation');
    assert.equal(payable1.totalAmount, 276000);
    assert.equal(payable1.status, 'ChuaThanhToan');

    const payPartial = await srv.reqJson('POST', `/api/payables/${payable1.id}/pay`, {
      token: managerToken,
      body: { amount: 100000, method: 'BANK_TRANSFER', referenceNo: 'FT-NCC003-01' },
    });
    assert.equal(payPartial.status, 200);
    assert.equal(payPartial.data.item.status, 'ThanhToanMotPhan');
    assert.equal(payPartial.data.item.balanceAmount, 176000);

    // 8. Supplier Return (TRA_NCC): return 2 units from GRN1 batch -> reduces stock (-2) & credits AP payable (-92,000)
    const grn1BatchCode = grn1Confirm.data.item.items[0].batchCode;
    const batches = (await srv.reqJson('GET', '/api/batches?productId=SP006', { token: managerToken })).data.items;
    const targetBatch = batches.find((b) => b.batchCode === grn1BatchCode);
    assert.ok(targetBatch, 'Confirmed GRN must create product_batch');

    const supRetCreate = await srv.reqJson('POST', '/api/supplier-returns', {
      token: warehouseToken,
      body: {
        supplierId: 'NCC003',
        purchaseId: poId,
        receiptId: grn1Id,
        reason: '2 hộp móp vỏ khi kiểm tra sau nhập',
        items: [{ productId: 'SP006', batchId: targetBatch.id, qty: 2, unitCost: 46000 }],
      },
    });
    assert.equal(supRetCreate.status, 201, JSON.stringify(supRetCreate.data));

    const supRetApprove = await srv.reqJson('POST', `/api/supplier-returns/${supRetCreate.data.item.id}/approve`, {
      token: managerToken,
    });
    assert.equal(supRetApprove.status, 200, JSON.stringify(supRetApprove.data));
    assert.equal(supRetApprove.data.item.status, 'DaDuyet');
    assert.equal((await srv.reqJson('GET', '/api/products/SP006', { token: managerToken })).data.item.stockQty, sp6Before + 10 - 2);

    const payableAfterReturn = (await srv.reqJson('GET', `/api/payables/${payable1.id}`, { token: managerToken })).data.item;
    assert.equal(payableAfterReturn.totalAmount, 276000 - 92000);
    assert.equal(payableAfterReturn.balanceAmount, 176000 - 92000);

    // 9. Atomic TX rollback test on confirmGoodsReceipt
    const repos = createRepositories(srv.db);
    const svc = new WarehouseService(srv.db, repos);
    const managerUser = repos.users.findByUsername('quanly');
    const warehouseUser = repos.users.findByUsername('kho');
    const rollbackPo = svc.createPurchase(warehouseUser, {
      supplierId: 'NCC003',
      items: [{ productId: 'SP006', qty: 3, unitCost: 46000, expiryDate: addDaysYmd(200) }],
    });
    svc.sendPurchaseToSupplier(warehouseUser, rollbackPo.id, {});
    svc.respondToPurchase(repos.users.findByUsername('ncc01'), rollbackPo.id, { action: 'ACCEPT' });
    const rollbackGrn = svc.createGoodsReceipt(warehouseUser, {
      purchaseId: rollbackPo.id,
      items: [{ productId: 'SP006', receivedQty: 3, unitCost: 46000, expiryDate: addDaysYmd(200) }],
    });
    const stockBeforeRollback = repos.products.findById('SP006').stock_qty;
    const payablesBeforeRollback = srv.db.prepare('SELECT COUNT(*) AS c FROM supplier_payables').get().c;
    assert.throws(() => {
      svc.confirmGoodsReceipt(managerUser, rollbackGrn.id, {
        _beforeCommitHook: () => {
          throw new Error('Simulated GRN rollback crash');
        },
      });
    }, /Simulated GRN rollback crash/);
    assert.equal(repos.products.findById('SP006').stock_qty, stockBeforeRollback);
    assert.equal(srv.db.prepare('SELECT COUNT(*) AS c FROM supplier_payables').get().c, payablesBeforeRollback);
  } finally {
    await srv.close();
  }
});

test('P2-05 (2e): Blind Stock Audit masking, Round 2 recount (different actor), no self-approval & Admin tier approval', async () => {
  const srv = await startTestServer();
  try {
    const warehouseToken = await srv.loginAs('kho');
    const managerToken = await srv.loginAs('quanly');
    const adminToken = await srv.loginAs('admin');

    const sp1 = (await srv.reqJson('GET', '/api/products/SP001', { token: managerToken })).data.item;

    // 1. Manager creates BLIND audit assigned to warehouse (NV004)
    const blindRes = await srv.reqJson('POST', '/api/stock-audits', {
      token: managerToken,
      body: {
        mode: 'BLIND',
        scopeType: 'CATEGORY',
        scopeValue: 'DM01',
        assignedTo: 'NV004',
        note: 'Kiểm kê mù đột xuất sữa tươi',
        items: [{ productId: 'SP001' }],
      },
    });
    assert.equal(blindRes.status, 201, JSON.stringify(blindRes.data));
    const auditId = blindRes.data.item.id;
    assert.equal(blindRes.data.item.status, 'DangDem');
    assert.equal(blindRes.data.item.assignedTo, 'NV004');

    // 2. Warehouse reads blind audit -> systemQty & diffQty MUST be masked (null)
    const maskedView = await srv.reqJson('GET', `/api/stock-audits/${auditId}`, { token: warehouseToken });
    assert.equal(maskedView.status, 200);
    assert.equal(maskedView.data.item.isBlindMasked, true);
    assert.equal(maskedView.data.item.items[0].systemQty, null);
    assert.equal(maskedView.data.item.items[0].diffQty, null);

    // 3. Warehouse submits Round 1 count with large variance (exceeding both NguongLechKiemKeSoLuong=5 & NguongDuyetKiemKeAdmin=2,000,000)
    const largeDelta = Math.min(Math.max(100, Math.ceil(2100000 / Math.max(1, sp1.costPrice || 25000))), sp1.stockQty);
    const round1 = await srv.reqJson('POST', `/api/stock-audits/${auditId}/count`, {
      token: warehouseToken,
      body: {
        items: [
          {
            productId: 'SP001',
            actualQty: sp1.stockQty - largeDelta,
            reasonCode: 'HU_HONG',
            reason: 'Lô sữa hư hỏng do mất điện kho lạnh',
          },
        ],
      },
    });
    assert.equal(round1.status, 200, JSON.stringify(round1.data));
    assert.equal(round1.data.item.status, 'ChoDemLai', 'Exceeding threshold must trigger Round 2 recount');

    // 4. Same actor (kho) tries Round 2 recount -> MUST be blocked 403
    const sameActorRecount = await srv.reqJson('POST', `/api/stock-audits/${auditId}/recount`, {
      token: warehouseToken,
      body: {
        items: [{ productId: 'SP001', actualQty: sp1.stockQty - largeDelta, reasonCode: 'HU_HONG' }],
      },
    });
    assert.equal(sameActorRecount.status, 403);

    // 5. Different actor (quanly) performs Round 2 recount -> ChoDuyet (requiresAdminApproval=true because value >= 500,000)
    const round2 = await srv.reqJson('POST', `/api/stock-audits/${auditId}/recount`, {
      token: managerToken,
      body: {
        items: [
          {
            productId: 'SP001',
            actualQty: sp1.stockQty - largeDelta,
            reasonCode: 'HU_HONG',
            reason: 'Xác nhận lại vòng 2 khớp số liệu',
          },
        ],
      },
    });
    assert.equal(round2.status, 200, JSON.stringify(round2.data));
    assert.equal(round2.data.item.status, 'ChoDuyet');
    assert.equal(round2.data.item.requiresAdminApproval, true);
    assert.equal(round2.data.item.rounds.length, 2);

    // 6. Manager tries to approve -> blocked 403 (both self-recount/creator AND requiresAdminApproval)
    const mgrApprove = await srv.reqJson('POST', `/api/stock-audits/${auditId}/approve`, { token: managerToken });
    assert.equal(mgrApprove.status, 403);

    // 7. Admin approves -> 200 DaDuyet & stock updated
    const admApprove = await srv.reqJson('POST', `/api/stock-audits/${auditId}/approve`, { token: adminToken });
    assert.equal(admApprove.status, 200, JSON.stringify(admApprove.data));
    assert.equal(admApprove.data.item.status, 'DaDuyet');
    assert.equal((await srv.reqJson('GET', '/api/products/SP001', { token: adminToken })).data.item.stockQty, sp1.stockQty - largeDelta);
  } finally {
    await srv.close();
  }
});

test('P2-06 (BƯỚC 3): POS blocks partial/split/debt payments completely; Returns block non_returnable=1 items', async () => {
  const srv = await startTestServer();
  try {
    const cashierToken = await srv.loginAs('thungan');
    const managerToken = await srv.loginAs('quanly');
    assert.equal((await srv.reqJson('POST', '/api/shifts/open', { token: cashierToken, body: { openingCash: 500000 } })).status, 201);

    // 1. Block all partial / split / debt checkout attempts with 400
    for (const badPayload of [
      { items: [{ productId: 'SP001', qty: 1 }], paymentMethod: 'CASH', cashReceived: 100000, partial: true },
      { items: [{ productId: 'SP001', qty: 1 }], paymentMethod: 'CASH', cashReceived: 100000, partialPayment: true },
      { items: [{ productId: 'SP001', qty: 1 }], paymentMethod: 'CASH', cashReceived: 100000, splitPayment: true },
      { items: [{ productId: 'SP001', qty: 1 }], paymentMethod: 'CASH', cashReceived: 100000, debt: true },
      { items: [{ productId: 'SP001', qty: 1 }], paymentMethod: 'PARTIAL', cashReceived: 100000 },
      { items: [{ productId: 'SP001', qty: 1 }], paymentMethod: 'CASH', cashReceived: 100000, paidAmount: 5000 },
    ]) {
      const r = await srv.reqJson('POST', '/api/pos/checkout', { token: cashierToken, body: badPayload });
      assert.equal(r.status, 400, `Expected 400 for payload ${JSON.stringify(badPayload)}, got ${r.status}`);
    }

    // 2. Find a seeded non_returnable = 1 product (e.g., DM14 fresh/frozen), buy it on POS, then attempt return -> 400
    const nonRetRow = srv.db.prepare('SELECT id, sale_price FROM products WHERE non_returnable = 1 AND stock_qty >= 2 LIMIT 1').get();
    assert.ok(nonRetRow, 'Seeded catalog must contain at least one non_returnable=1 product');

    const orderRes = await srv.reqJson('POST', '/api/pos/checkout', {
      token: cashierToken,
      body: {
        items: [
          { productId: nonRetRow.id, qty: 1 },
          { productId: 'SP001', qty: 1 },
        ],
        paymentMethod: 'CASH',
        cashReceived: (nonRetRow.sale_price + 100000) * 2,
      },
    });
    assert.equal(orderRes.status, 201, JSON.stringify(orderRes.data));
    const orderId = orderRes.data.item.id;

    // Order detail flags nonReturnable and returnableQty=0 for the fresh item
    const detail = (await srv.reqJson('GET', `/api/orders/${orderId}`, { token: cashierToken })).data.item;
    const nrLine = detail.items.find((i) => i.productId === nonRetRow.id);
    assert.equal(nrLine.nonReturnable, true);
    assert.equal(nrLine.returnableQty, 0);

    // Return of non_returnable item -> 400
    const badReturn = await srv.reqJson('POST', '/api/returns', {
      token: cashierToken,
      body: {
        orderId,
        reason: 'Khách đổi ý trả thực phẩm tươi sống',
        items: [{ productId: nonRetRow.id, qty: 1, restock: false }],
      },
    });
    assert.equal(badReturn.status, 400);
    assert.match(badReturn.data.error?.message || '', /không áp dụng đổi trả/i);

    // Partial item return of returnable SP001 on the SAME order still succeeds!
    const okReturn = await srv.reqJson('POST', '/api/returns', {
      token: cashierToken,
      body: {
        orderId,
        reason: 'Trả riêng sữa hộp nguyên vẹn',
        items: [{ productId: 'SP001', qty: 1, restock: true }],
      },
    });
    assert.equal(okReturn.status, 201, JSON.stringify(okReturn.data));
    const approveRet = await srv.reqJson('POST', `/api/returns/${okReturn.data.item.id}/approve`, { token: managerToken });
    assert.equal(approveRet.status, 200);
    assert.equal(approveRet.data.item.status, 'DaXacNhan');
  } finally {
    await srv.close();
  }
});

test('P2-07 (RBAC Matrix): 401/403/200 enforcement across all 5 roles (ADMIN, MANAGER, CASHIER, WAREHOUSE, SUPPLIER)', async () => {
  const srv = await startTestServer();
  try {
    const tokens = {
      ADMIN: await srv.loginAs('admin'),
      MANAGER: await srv.loginAs('quanly'),
      CASHIER: await srv.loginAs('thungan'),
      WAREHOUSE: await srv.loginAs('kho'),
      SUPPLIER: await srv.loginAs('ncc01'),
    };

    const matrix = [
      // [method, path, allowedRoles]
      ['GET', '/api/vouchers', ['ADMIN', 'MANAGER']],
      ['GET', '/api/vouchers?activeOnly=true', ['ADMIN', 'MANAGER', 'CASHIER']],
      ['GET', '/api/promotions/near-expiry-suggestions', ['ADMIN', 'MANAGER']],
      ['GET', '/api/shifts/current', ['ADMIN', 'MANAGER', 'CASHIER']],
      ['GET', '/api/supplier-portal/purchases', ['ADMIN', 'SUPPLIER']],
      ['GET', '/api/grns', ['ADMIN', 'MANAGER', 'WAREHOUSE']],
      ['GET', '/api/payables', ['ADMIN', 'MANAGER']],
      ['GET', '/api/supplier-returns', ['ADMIN', 'MANAGER', 'WAREHOUSE']],
      ['GET', '/api/batches/near-expiry', ['ADMIN', 'MANAGER', 'WAREHOUSE']],
      ['GET', '/api/reports/dashboard', ['ADMIN', 'MANAGER']],
      ['GET', '/api/staff', ['ADMIN']],
    ];

    for (const [method, urlPath, allowedRoles] of matrix) {
      // Unauthenticated -> 401
      const unauth = await srv.reqJson(method, urlPath);
      assert.equal(unauth.status, 401, `Expected 401 without token on ${method} ${urlPath}`);

      for (const [role, token] of Object.entries(tokens)) {
        const res = await srv.reqJson(method, urlPath, { token });
        const expected = allowedRoles.includes(role) ? 200 : 403;
        assert.equal(
          res.status,
          expected,
          `Role ${role} on ${method} ${urlPath}: expected ${expected}, got ${res.status} (${JSON.stringify(res.data)})`,
        );
      }
    }
  } finally {
    await srv.close();
  }
});
