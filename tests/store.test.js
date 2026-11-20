'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Store, KEY, clone, validateBackup, seed } = require('../store');
const { totals, calculateDiscounts, calculateProfitAndLoss } = require('../src/domain/calculations.js');
function fixture() {
  const map = new Map();
  const storage = { getItem: (k) => map.get(k) || null, setItem: (k, v) => map.set(k, v) };
  const s = new Store(storage);
  s.login('admin', '123456');
  return { s, storage };
}
function draft(s, qty = 2, discount = 0) {
  const p = s.data.products[0];
  s.saveDraft({
    items: [{ id: p.id, name: p.name, price: p.price, qty, icon: p.icon }],
    discount,
    customerId: 'KH001',
    note: 'Kiểm thử',
    demographic: 'Không ghi nhận',
  });
  return p;
}
test('seed and persisted data survive schema validation', () => {
  const { s, storage } = fixture();
  assert.ok(s.data.products.length >= 80, 'Dữ liệu mẫu có tối thiểu 80 sản phẩm');
  assert.equal(validateBackup(s.data), s.data);
  const reloaded = new Store(storage);
  assert.equal(reloaded.loadError, '');
  assert.equal(reloaded.data.orders.length, 28);
});
test('cash checkout enforces sufficient tender and updates inventory once', () => {
  const { s } = fixture();
  const p = draft(s),
    stock = p.stock;
  assert.throws(() => s.checkout({ payment: 'cash', received: 1 }), /chưa đủ/);
  assert.equal(s.data.products[0].stock, stock);
  const o = s.checkout({ payment: 'cash', received: 100000 });
  assert.equal(o.total, 72000);
  assert.equal(o.change, 28000);
  assert.equal(s.data.products[0].stock, stock - 2);
  assert.equal(s.data.draft.items.length, 0);
  assert.throws(() => s.checkout({ payment: 'cash', received: 100000 }), /trống/);
});
for (const payment of ['transfer', 'card'])
  test(`${payment} records the correct method and reference`, () => {
    const { s } = fixture();
    draft(s);
    assert.throws(() => s.checkout({ payment, paymentRef: 'REF' }), /xác nhận/);
    assert.throws(() => s.checkout({ payment, confirmed: true }), /tham chiếu/);
    const o = s.checkout({ payment, confirmed: true, paymentRef: 'REF123' });
    assert.equal(o.payment, payment);
    assert.equal(o.paymentRef, 'REF123');
    assert.equal(o.received, o.total);
  });
test('checkout refuses stock shortages and stale prices without partial changes', () => {
  const { s } = fixture();
  draft(s, 999);
  const stock = s.data.products[0].stock;
  assert.throws(() => s.checkout({ payment: 'cash', received: 999999999 }), /chỉ còn/);
  assert.equal(s.data.products[0].stock, stock);
  draft(s, 1);
  s.data.products[0].price++;
  assert.throws(() => s.checkout({ payment: 'cash', received: 999999 }), /đã thay đổi/);
});
test('held orders are deep copies, limited to five, and do not overwrite a cart', () => {
  const { s, storage } = fixture();
  draft(s);
  const held = s.hold();
  assert.equal(s.data.held[0].items[0].qty, 2);
  draft(s, 1);
  assert.throws(() => s.restoreHeld(held.id), /giỏ hiện tại/);
  s.hold();
  for (let i = 0; i < 3; i++) {
    draft(s);
    s.hold();
  }
  draft(s);
  assert.throws(() => s.hold(), /tối đa 5/);
  s.saveDraft({ items: [], discount: 0, customerId: '', note: '', demographic: '' });
  s.restoreHeld(held.id);
  assert.equal(s.data.draft.items[0].qty, 2);
  assert.equal(new Store(storage).data.held.length, 4);
});
test('partial refunds including discounts and tax sum to the exact invoice total', () => {
  const { s } = fixture();
  s.saveSettings({ ...s.data.settings, taxRate: 8 });
  const p = draft(s, 3, 1001),
    stock = p.stock;
  const o = s.checkout({ payment: 'cash', received: 200000 });
  let returned = 0;
  for (let k = 0; k < 3; k++) {
    const r = s.createReturn(o.id, [{ id: p.id, qty: 1 }], 'Đổi ý', true);
    assert.equal(s.data.products[0].stock, stock - 3 + k);
    s.resolveReturn(r.id, true);
    returned += r.amount;
    assert.throws(() => s.resolveReturn(r.id, true), /đã được xử lý/);
  }
  assert.equal(returned, o.total);
  assert.equal(s.data.orders.find((x) => x.id === o.id).status, 'refunded');
  assert.equal(s.data.products[0].stock, stock);
  assert.throws(() => s.createReturn(o.id, [{ id: p.id, qty: 1 }], 'Tiếp tục', true), /Chỉ được/);
});
test('pending return reserves units; rejected and damaged returns never add stock', () => {
  const { s } = fixture();
  const p = draft(s, 2),
    stock = p.stock;
  const o = s.checkout({ payment: 'cash', received: 100000 });
  const r = s.createReturn(o.id, [{ id: p.id, qty: 2 }], 'Hàng lỗi', false);
  assert.equal(s.available(o.id, p.id), 0);
  assert.throws(() => s.createReturn(o.id, [{ id: p.id, qty: 1 }], 'Trùng', true), /vượt/);
  s.resolveReturn(r.id, false);
  assert.equal(s.available(o.id, p.id), 2);
  const next = s.createReturn(o.id, [{ id: p.id, qty: 2 }], 'Hỏng', false);
  s.resolveReturn(next.id, true);
  assert.equal(s.data.products[0].stock, stock - 2);
});
test('purchases require matching supplier, receive once, and drafts do not change stock', () => {
  const { s } = fixture();
  const p = s.data.products[0],
    stock = p.stock;
  assert.throws(
    () => s.createPurchase('NCC002', [{ id: p.id, qty: 1, price: 1000 }], 'x'),
    /không thuộc/,
  );
  const pn = s.createPurchase(
    p.supplierId,
    [{ id: p.id, qty: 5, price: 20000 }],
    'Kiểm thử',
    'draft',
  );
  assert.equal(p.stock, stock);
  assert.throws(() => s.receivePurchase(pn.id), /đang chờ/);
  s.purchaseStatus(pn.id, 'pending');
  s.receivePurchase(pn.id);
  assert.equal(s.data.products[0].stock, stock + 5);
  assert.equal(s.data.products[0].cost, 20000);
  assert.throws(() => s.receivePurchase(pn.id), /đang chờ/);
  assert.throws(() => s.purchaseStatus(pn.id, 'cancelled'), /đã nhận/);
});
test('cashiers cannot administer, warehouse cannot sell or approve refunds', () => {
  const { s } = fixture();
  s.login('nhanvien', '123456');
  assert.throws(() => s.saveSettings(s.data.settings), /không có quyền/);
  assert.throws(() => s.upsert('products', { name: 'Hàng thử' }), /không có quyền/);
  assert.throws(() => s.resolveReturn('bad', true), /không có quyền/);
  s.login('kho', '123456');
  assert.throws(() => draft(s), /không có quyền/);
  assert.throws(() => s.createReturn('bad', [], 'x', true), /không có quyền/);
});
test('audit persists actual count and records the difference', () => {
  const { s } = fixture();
  const p = s.data.products[0],
    before = p.stock;
  const a = s.audit([{ id: p.id, actual: 100 }], 'Kiểm kê cuối ngày');
  assert.equal(s.data.products[0].stock, 100);
  assert.equal(a.items[0].delta, 100 - before);
  assert.equal(s.data.movements[0].reference, a.id);
  assert.throws(() => s.audit([{ id: p.id, actual: -1 }], 'x'), /số nguyên/);
});
test('failed persistence rolls back invoice and stock', () => {
  const { s, storage } = fixture();
  draft(s);
  const before = clone(s.data);
  storage.setItem = () => {
    throw new Error('Quota exceeded');
  };
  assert.throws(() => s.checkout({ payment: 'cash', received: 100000 }), /Quota/);
  assert.deepEqual(s.data, before);
});
test('parallel tabs cannot overwrite a newer revision', () => {
  const { s, storage } = fixture();
  const other = new Store(storage);
  other.login('admin', '123456');
  draft(s);
  assert.throws(() => draft(other), /tab khác/);
  assert.equal(JSON.parse(storage.getItem(KEY)).draft.items.length, 1);
});
test('backup restore rejects malformed data and preserves a valid full history', () => {
  const { s } = fixture();
  draft(s);
  s.checkout({ payment: 'cash', received: 100000 });
  const data = clone(s.data);
  s.importBackup(data);
  assert.equal(s.data.orders.length, 29);
  const bad = clone(s.data);
  bad.products[0].stock = -1;
  assert.throws(() => s.importBackup(bad), /số nguyên/);
  const badTotal = clone(s.data);
  badTotal.orders[0].total++;
  assert.throws(() => validateBackup(badTotal), /không khớp/);
});
test('duplicate barcodes are rejected and one active administrator is retained', () => {
  const { s } = fixture();
  const p = clone(s.data.products[0]);
  delete p.id;
  assert.throws(() => s.upsert('products', p), /Mã vạch/);
  assert.throws(() => s.upsert('staff', { ...s.user, active: false }), /đang sử dụng/);
});
test('branch proposals require active supplier coverage', () => {
  const { s } = fixture();
  assert.throws(
    () => s.createBranch({ name: 'CN mới', address: '123 ABC', area: 'Điện Biên' }),
    /Chưa có nhà cung cấp/,
  );
  const b = s.createBranch({ name: 'CN mới', address: '123 ABC', area: 'TP. HCM' });
  assert.equal(b.status, 'proposed');
  assert.ok(b.supplierIds.length);
});

test('seed products satisfy extended schema, stock thresholds, and HSD test sets', () => {
  const { s } = fixture();
  assert.ok(s.data.products.length >= 80, 'Có ít nhất 80 sản phẩm');
  for (const p of s.data.products) {
    assert.ok(p.id, 'Có id');
    assert.ok(p.barcode, 'Có barcode');
    assert.ok(p.name, 'Có name');
    assert.ok(p.category, 'Có category');
    assert.ok(typeof p.price === 'number' && p.price > 0, 'Có price hợp lệ');
    assert.ok(typeof p.cost === 'number' && p.cost > 0, 'Có cost hợp lệ');
    assert.ok(typeof p.costPrice === 'number' && p.costPrice > 0, 'Có costPrice hợp lệ');
    assert.equal(p.cost, p.costPrice, 'cost và costPrice đồng bộ');
    assert.ok(p.stock > 0 && p.stock <= 300, `Tồn kho hợp lệ: ${p.stock}`);
    assert.ok(p.batchCode, 'Có batchCode');
    assert.ok(p.mfgDate && !isNaN(Date.parse(p.mfgDate)), 'Có mfgDate hợp lệ');
    assert.ok(p.expiryDate && !isNaN(Date.parse(p.expiryDate)), 'Có expiryDate hợp lệ');
    assert.ok(p.expiryDate > p.mfgDate, 'Hạn sử dụng lớn hơn ngày sản xuất');
    assert.ok(typeof p.imageUrl === 'string' && p.imageUrl.length > 5, 'Có imageUrl');
    assert.ok(!p.imageUrl.includes('data:image/svg+xml') && !p.imageUrl.includes('<svg'), 'imageUrl không chứa svg');
    assert.ok(/\.(jpg|jpeg|png|webp)($|\?)/i.test(p.imageUrl), 'imageUrl là ảnh chụp thương mại thật (.jpg/.webp/.png)');
  }
  const regularStock = s.data.products.filter((p) => p.stock > p.minStock);
  assert.ok(regularStock.every((p) => p.stock >= 50 && p.stock <= 300), 'Mặt hàng thông thường có tồn kho 50-300');
  const expired = s.data.products.filter((p) => s.getExpiryInfo(p.expiryDate).status === 'expired');
  const nearExpiry = s.data.products.filter((p) => s.getExpiryInfo(p.expiryDate).status === 'near_expiry');
  assert.equal(expired.length, 4, 'Đúng 4 sản phẩm hết hạn');
  assert.equal(nearExpiry.length, 12, 'Đúng 12 sản phẩm cận date');
});

test('getExpiryInfo accurately classifies expired, near_expiry and valid items with boundary dates', () => {
  const { s } = fixture();
  const today = new Date();
  const fmt = (d) => d.toISOString().slice(0, 10);
  const addDays = (days) => {
    const d = new Date(today);
    d.setDate(d.getDate() + days);
    return fmt(d);
  };

  // Expired <= 0 days
  const expPast = s.getExpiryInfo(addDays(-5));
  assert.equal(expPast.status, 'expired');
  assert.equal(expPast.label, 'Hết hạn');
  assert.equal(expPast.color, 'red');

  const expToday = s.getExpiryInfo(addDays(0));
  assert.equal(expToday.status, 'expired');
  assert.equal(expToday.label, 'Hết hạn');
  assert.equal(expToday.color, 'red');

  // Near expiry: 1 <= days <= 30
  const near1 = s.getExpiryInfo(addDays(1));
  assert.equal(near1.status, 'near_expiry');
  assert.equal(near1.label, 'Cận date - còn 1 ngày');
  assert.equal(near1.color, 'yellow');

  const near15 = s.getExpiryInfo(addDays(15));
  assert.equal(near15.status, 'near_expiry');
  assert.equal(near15.daysRemaining, 15);
  assert.equal(near15.label, 'Cận date - còn 15 ngày');

  const near30 = s.getExpiryInfo(addDays(30));
  assert.equal(near30.status, 'near_expiry');
  assert.equal(near30.label, 'Cận date - còn 30 ngày');

  // Valid: > 30 days
  const valid31 = s.getExpiryInfo(addDays(31));
  assert.equal(valid31.status, 'valid');
  assert.equal(valid31.label, 'Còn hạn');
  assert.equal(valid31.color, 'green');

  const valid180 = s.getExpiryInfo(addDays(180));
  assert.equal(valid180.status, 'valid');
  assert.equal(valid180.label, 'Còn hạn');
});

test('product upsert enforces expiryDate > mfgDate and supports extended fields', () => {
  const { s } = fixture();
  // Invalid expiryDate <= mfgDate
  assert.throws(
    () =>
      s.upsert('products', {
        name: 'SP Hỏng Date',
        barcode: '8939999999999',
        category: 'Sữa & Đồ uống',
        supplierId: 'NCC001',
        price: 50000,
        costPrice: 35000,
        minStock: 10,
        stock: 100,
        icon: '🥛',
        mfgDate: '2026-12-01',
        expiryDate: '2026-11-01',
      }),
    /Hạn sử dụng phải sau ngày sản xuất/,
  );

  // Valid upsert
  const created = s.upsert('products', {
    name: 'SP Mới Chuẩn',
    barcode: '8939999999998',
    category: 'Sữa & Đồ uống',
    supplierId: 'NCC001',
    price: 50000,
    costPrice: 35000,
    minStock: 10,
    stock: 100,
    icon: '🥛',
    batchCode: 'LO-TEST-001',
    mfgDate: '2026-01-01',
    expiryDate: '2026-12-31',
    imageUrl: 'https://example.com/img.jpg',
  });
  assert.equal(created.name, 'SP Mới Chuẩn');
  assert.equal(created.costPrice, 35000);
  assert.equal(created.cost, 35000);
  assert.equal(created.batchCode, 'LO-TEST-001');
  assert.equal(created.imageUrl, 'https://example.com/img.jpg');
});

test('backup restore backfills legacy data and maintains valid schema', () => {
  const { s } = fixture();
  const legacyData = clone(s.data);
  // Strip new fields from products to simulate legacy backup
  legacyData.products = legacyData.products.slice(0, 10).map((p) => {
    const copy = { ...p };
    delete copy.costPrice;
    delete copy.batchCode;
    delete copy.mfgDate;
    delete copy.expiryDate;
    delete copy.imageUrl;
    return copy;
  });
  // Make sure validateBackup upgrades legacy data without throwing
  const validated = validateBackup(legacyData);
  assert.ok(validated.products[0].costPrice, 'costPrice được tự động nâng cấp');
  assert.ok(validated.products[0].batchCode, 'batchCode được tự động bổ sung');
  assert.ok(validated.products[0].expiryDate, 'expiryDate được tự động bổ sung');
  assert.ok(validated.products[0].mfgDate, 'mfgDate được tự động bổ sung');
});

test('Store auto-migrates legacy 29-product localStorage state and syncSeedCatalog updates catalog', () => {
  const legacyStorage = new Map();
  const legacyData = clone(seed());
  // Simulate old legacy state with only 29 products and no expiry/image
  legacyData.products = legacyData.products.slice(0, 29).map((p) => {
    const copy = { ...p };
    delete copy.expiryDate;
    delete copy.mfgDate;
    delete copy.imageUrl;
    return copy;
  });
  delete legacyData.promotions;
  delete legacyData.vouchers;
  legacyStorage.set(KEY, JSON.stringify(legacyData));

  // Initialize Store with legacy storage
  const s = new Store({
    getItem: (k) => legacyStorage.get(k) || null,
    setItem: (k, v) => legacyStorage.set(k, v),
  });
  s.login('admin', '123456');

  // Verify auto-migration kicked in immediately
  assert.ok(s.data.products.length >= 80, 'Tự động mở rộng lên >= 80 sản phẩm');
  assert.ok(s.data.products.every((p) => p.expiryDate && p.imageUrl), 'Mọi sản phẩm có expiryDate và imageUrl');
  const exp = s.data.products.filter((p) => s.getExpiryInfo(p.expiryDate).status === 'expired');
  const near = s.data.products.filter((p) => s.getExpiryInfo(p.expiryDate).status === 'near_expiry');
  assert.equal(exp.length, 4, 'Auto-migrate khôi phục đúng 4 sản phẩm hết hạn');
  assert.equal(near.length, 12, 'Auto-migrate khôi phục đúng 12 sản phẩm cận date');

  // Verify syncSeedCatalog method
  const count = s.syncSeedCatalog();
  assert.ok(count >= 80, 'syncSeedCatalog đồng bộ thành công >= 80 sản phẩm');
  assert.equal(s.data.products.length, count);
});

test('toggleNearDatePromo and applyAllNearDatePromo manage near-expiry items correctly', () => {
  const { s } = fixture();
  const nearItem = s.data.products.find((p) => s.getExpiryInfo(p.expiryDate).status === 'near_expiry');
  const validItem = s.data.products.find((p) => s.getExpiryInfo(p.expiryDate).status === 'valid');
  assert.ok(nearItem, 'Có sản phẩm cận date');

  // Valid item cannot be toggled into near-date promo
  assert.throws(() => s.toggleNearDatePromo(validItem.id), /không nằm trong diện cận date/);

  // Toggle nearItem
  const initialStatus = !!nearItem.inNearExpiryPromo;
  const toggled = s.toggleNearDatePromo(nearItem.id);
  assert.equal(toggled.inNearExpiryPromo, !initialStatus);

  // Apply all near date promo
  const count = s.applyAllNearDatePromo();
  assert.ok(count > 0, 'Đã áp dụng CTKM cho các sản phẩm cận date');
  const allNear = s.data.products.filter((p) => s.getExpiryInfo(p.expiryDate).status === 'near_expiry');
  assert.ok(allNear.every((p) => p.inNearExpiryPromo === true));
});

test('dual-stream discount engine calculates promotion and voucher discounts correctly', () => {
  const { s } = fixture();

  const validProd = s.data.products.find((p) => s.getExpiryInfo(p.expiryDate).status === 'valid');
  const nearProd = s.data.products.find((p) => s.getExpiryInfo(p.expiryDate).status === 'near_expiry');
  nearProd.inNearExpiryPromo = true;

  const items = [
    { id: validProd.id, name: validProd.name, price: 100000, qty: 2 }, // 200,000đ
    { id: nearProd.id, name: nearProd.name, price: 50000, qty: 1 },    // 50,000đ (near date)
  ];

  const promoNearDate = (s.data.promotions || []).find((p) => p.id === 'promo-neardate');
  const voucher30k = (s.data.vouchers || []).find((v) => v.id === 'vouch-app30k');

  // Test discount calculation
  const disc = calculateDiscounts(items, 10000, {
    promotion: promoNearDate,
    voucher: voucher30k,
    products: s.data.products,
  });

  // promoNearDate is 35% on near-date items (50,000 * 35% = 17,500)
  assert.equal(disc.promotionDiscount, 17500);
  // voucher30k is 30,000 on orders >= 200,000
  assert.equal(disc.voucherDiscount, 30000);
  assert.equal(disc.manualDiscount, 10000);
  assert.equal(disc.totalDiscount, 57500);

  // Test totals
  const t = totals(items, 10000, s.data.settings.taxRate, {
    promotion: promoNearDate,
    voucher: voucher30k,
    products: s.data.products,
  });
  assert.equal(t.subtotal, 250000);
  assert.equal(t.promotionDiscount, 17500);
  assert.equal(t.voucherDiscount, 30000);
  assert.equal(t.discount, 57500);
  const taxable = 250000 - 57500;
  const expectedTax = Math.round((taxable * s.data.settings.taxRate) / 100);
  assert.equal(t.tax, expectedTax);
  assert.equal(t.total, taxable + expectedTax);
});

test('sales checkout strictly blocks expired products and partial payments', () => {
  const { s } = fixture();
  const expiredProd = s.data.products.find((p) => s.getExpiryInfo(p.expiryDate).status === 'expired');
  const validProd = s.data.products.find((p) => s.getExpiryInfo(p.expiryDate).status === 'valid');
  assert.ok(expiredProd, 'Có sản phẩm hết hạn');

  // Try checkout with expired product
  s.saveDraft({
    items: [{ id: expiredProd.id, name: expiredProd.name, price: expiredProd.price, qty: 1 }],
    discount: 0,
    note: '',
  });
  assert.throws(() => s.checkout({ payment: 'cash', received: expiredProd.price * 2 }), /đã hết hạn sử dụng/);

  // Valid draft but underpaid
  s.saveDraft({
    items: [{ id: validProd.id, name: validProd.name, price: validProd.price, qty: 1 }],
    discount: 0,
    note: '',
  });
  const t = totals(s.data.draft.items, 0, s.data.settings.taxRate);

  // Partial payment throws
  assert.throws(() => s.checkout({ payment: 'cash', received: t.total - 1 }), /chưa đủ/);

  // Full single payment succeeds
  const order = s.checkout({ payment: 'cash', received: t.total });
  assert.equal(order.status, 'completed');
  assert.equal(order.received, t.total);
  assert.equal(order.change, 0);
});

test('3-step inventory audit supports practical resolutions and expired write-off', () => {
  const { s } = fixture();
  const p = s.data.products[0];
  const initialStock = p.stock;
  const cost = p.costPrice || p.cost;

  // Audit with staff compensation resolution
  const audit1 = s.audit(
    [
      {
        id: p.id,
        actual: initialStock - 5,
        resolution: 'staff_compensation',
        responsibleStaff: 'Nguyễn Văn Thu Ngân',
      },
    ],
    'Kiểm kê mất hàng ca tối',
  );
  assert.equal(s.data.products[0].stock, initialStock - 5);
  assert.equal(audit1.items[0].resolution, 'staff_compensation');
  assert.equal(audit1.items[0].responsibleStaff, 'Nguyễn Văn Thu Ngân');
  assert.equal(audit1.items[0].diffValue, 5 * cost);

  // auditExpiredProducts finds all expired items and zeros their stock
  const expiredBefore = s.data.products.filter(
    (x) => s.getExpiryInfo(x.expiryDate).status === 'expired' && x.stock > 0,
  );
  assert.ok(expiredBefore.length > 0, 'Có sản phẩm hết hạn còn tồn kho');

  const expAudit = s.auditExpiredProducts();
  assert.equal(expAudit.status, 'resolved');
  assert.equal(expAudit.items.length, expiredBefore.length);
  assert.ok(expAudit.items.every((i) => i.actual === 0 && i.resolution === 'damage_writeoff'));

  // All expired items now have stock 0
  const expiredAfter = s.data.products.filter(
    (x) => s.getExpiryInfo(x.expiryDate).status === 'expired' && x.stock > 0,
  );
  assert.equal(expiredAfter.length, 0, 'Không còn sản phẩm hết hạn nào có tồn kho');

  // Second call throws because no expired items remain in stock
  assert.throws(() => s.auditExpiredProducts(), /Không có sản phẩm hết hạn/);

  // Audit with pending_resolution: stock is not moved until resolved
  const p2 = s.data.products[1];
  const initialStock2 = p2.stock;
  const auditPending = s.audit(
    [
      {
        id: p2.id,
        actual: initialStock2 + 3,
        resolution: 'surplus_adjust',
      },
    ],
    'Kiểm kê thừa hàng chờ duyệt',
    'pending_resolution',
  );
  assert.equal(s.data.products[1].stock, initialStock2, 'Chưa đổi kho khi pending_resolution');
  assert.equal(auditPending.status, 'pending_resolution');

  // Resolve audit: moves stock and marks resolved
  s.resolveAudit(auditPending.id);
  assert.equal(s.data.products[1].stock, initialStock2 + 3, 'Đã cập nhật kho sau khi resolve');
  assert.equal(auditPending.status, 'resolved');
});

test('two-way purchase workflow handles negotiation and partial GRN receipt', () => {
  const { s } = fixture();
  const p = s.data.products.find((prod) => prod.supplierId === 'NCC001');
  const initialStock = p.stock;

  // 1. Store creates PO with status sent_to_supplier
  const po = s.createPurchase('NCC001', [{ id: p.id, qty: 20, price: 50000 }], 'Đặt hàng tuần 48', 'sent_to_supplier');
  assert.equal(po.status, 'sent_to_supplier');
  assert.equal(s.data.products.find((x) => x.id === p.id).stock, initialStock, 'Chưa thay đổi kho');

  // 2. Supplier responds: only has 15 items, confirmed cost 52,000, new expiry and batch
  s.supplierRespond(po.id, {
    lines: [
      {
        id: p.id,
        confirmedQty: 15,
        confirmedCost: 52000,
        expiryDate: '2027-06-30',
        batchCode: 'LO-NCC-NEW',
        note: 'Kho chỉ còn 15 thùng',
      },
    ],
    supplierNote: 'Giao đợt 1 vào sáng thứ Hai',
  });
  assert.equal(po.status, 'supplier_responded');
  assert.equal(po.items[0].confirmedQty, 15);
  assert.equal(po.items[0].confirmedCost, 52000);
  assert.equal(po.items[0].expiryDate, '2027-06-30');

  // 3. Store approves supplier response
  s.approveSupplierResponse(po.id, 'Đồng ý nhận 15 thùng với giá 52.000đ');
  assert.equal(po.status, 'store_approved');

  // 4. Warehouse receives GRN: accepts 13, rejects 2 damaged
  s.confirmPurchaseReceipt(po.id, {
    lines: [{ id: p.id, acceptedQty: 13, rejectedQty: 2 }],
    receiverNote: 'Nhận 13 thùng nguyên vẹn, 2 thùng bẹp góc trả lại tài xế',
  });
  assert.equal(po.status, 'received');
  const updatedProd = s.data.products.find((x) => x.id === p.id);
  assert.equal(updatedProd.stock, initialStock + 13, 'Chỉ 13 thùng đạt chuẩn được cộng vào kho');
  assert.equal(updatedProd.costPrice, 52000, 'Giá vốn được cập nhật theo giá NCC chốt');
  assert.equal(updatedProd.cost, 52000);
  assert.equal(updatedProd.expiryDate, '2027-06-30');
  assert.equal(updatedProd.batchCode, 'LO-NCC-NEW');
  assert.equal(po.total, 13 * 52000, 'Tổng tiền thanh toán chỉ tính trên hàng đạt chuẩn');
});

test('return condition classification correctly routes goods to salable stock vs damagedStock', () => {
  const { s } = fixture();
  const o = s.data.orders[0];
  const item = o.items[0];
  const prod = s.data.products.find((p) => p.id === item.id);
  const initialStock = prod.stock;
  const initialDamaged = prod.damagedStock || 0;

  // 1. Defective / damaged return: does NOT add to salable stock, increments damagedStock
  const retDamaged = s.createReturn(o.id, [{ id: item.id, qty: 1 }], 'Hàng bẹp vỡ khi mở hộp', 'damaged_or_expired');
  assert.equal(retDamaged.restock, false);
  assert.equal(retDamaged.returnCondition, 'damaged_or_expired');
  s.resolveReturn(retDamaged.id, true);

  assert.equal(prod.stock, initialStock, 'Hàng hỏng không được cộng vào kho bán');
  assert.equal(prod.damagedStock, initialDamaged + 1, 'Hàng hỏng được đưa vào damagedStock chờ hủy');

  // 2. Good condition return: restocks into salable stock
  const retGood = s.createReturn(o.id, [{ id: item.id, qty: 1 }], 'Khách đổi ý muốn mua loại khác', 'good_restock');
  assert.equal(retGood.restock, true);
  assert.equal(retGood.returnCondition, 'good_restock');
  s.resolveReturn(retGood.id, true);

  assert.equal(prod.stock, initialStock + 1, 'Hàng nguyên tem được cộng lại kho bán lẻ');
});

test('P&L financial reporting calculates revenue, COGS, shrinkage loss, and net profit', () => {
  const { s } = fixture();
  const pnl = calculateProfitAndLoss(s.data, 90);

  assert.ok(typeof pnl.grossRevenue === 'number' && pnl.grossRevenue > 0, 'Có grossRevenue');
  assert.ok(typeof pnl.totalDiscounts === 'number', 'Có totalDiscounts');
  assert.ok(typeof pnl.refunds === 'number', 'Có refunds');
  assert.ok(typeof pnl.netRevenue === 'number' && pnl.netRevenue > 0, 'Có netRevenue');
  assert.equal(pnl.netRevenue, Math.max(0, pnl.grossRevenue - pnl.totalDiscounts - pnl.refunds));

  assert.ok(typeof pnl.cogs === 'number' && pnl.cogs > 0, 'Có cogs');
  assert.equal(pnl.grossProfit, pnl.netRevenue - pnl.cogs);

  assert.ok(typeof pnl.totalLoss === 'number', 'Có totalLoss');
  assert.ok(typeof pnl.staffCompensation === 'number', 'Có staffCompensation');
  assert.equal(pnl.netProfit, pnl.grossProfit - pnl.totalLoss + pnl.staffCompensation);
});

// ==============================================================================
// PHASE 4 ENHANCEMENT TESTS: PRODUCT+BATCH FEFO, EAN-13, CSV IMPORT & PROTECTION
// ==============================================================================

test('Test 1: all seed products pass EAN-13 check-digit validation and have unique GTIN', () => {
  const { s } = fixture();
  const products = s.data.products;
  assert.ok(products.length >= 80, 'Có tối thiểu 80 sản phẩm');

  const gtins = products.map((p) => p.gtin);
  assert.equal(new Set(gtins).size, products.length, '100% mã GTIN là duy nhất (0 cặp trùng GTIN)');

  products.forEach((p) => {
    assert.ok(p.gtin, `Sản phẩm ${p.id} phải có GTIN`);
    assert.equal(p.gtin.length, 13, `GTIN ${p.gtin} phải đủ 13 chữ số`);
    assert.equal(
      s.isValidEan13(p.gtin),
      true,
      `GTIN ${p.gtin} của sản phẩm ${p.name} (${p.id}) phải chuẩn EAN-13 check-digit`,
    );
  });
});

test('Test 2: no duplicate product names or SKUs and all referenced packshot images have unique MD5', () => {
  const { s } = fixture();
  const fs = require('fs');
  const path = require('path');
  const crypto = require('crypto');

  const products = s.data.products;
  const names = products.map((p) => p.name.trim().toLowerCase());
  const ids = products.map((p) => p.id);

  assert.equal(new Set(names).size, products.length, '0 cặp sản phẩm nào trùng tên trong catalog');
  assert.equal(new Set(ids).size, products.length, '0 cặp SKU nào trùng mã');

  // Kiểm tra tính duy nhất của MD5 các file ảnh packshot
  const imgDir = path.resolve(__dirname, '../assets/images/products');
  if (fs.existsSync(imgDir)) {
    const files = fs.readdirSync(imgDir).filter((f) => /\.(jpg|png|webp)$/i.test(f));
    const hashes = {};
    files.forEach((f) => {
      const buf = fs.readFileSync(path.join(imgDir, f));
      const hash = crypto.createHash('md5').update(buf).digest('hex');
      (hashes[hash] = hashes[hash] || []).push(f);
    });
    const dupGroups = Object.entries(hashes).filter(([, group]) => group.length > 1);
    assert.equal(dupGroups.length, 0, '100% file ảnh packshot thương mại có MD5 duy nhất (0 cặp trùng MD5)');
  }
});

test('Test 3: FEFO sales allocation deducts from earliest-expiry batch first and new purchases preserve legacy batches', () => {
  const { s } = fixture();
  const p = s.data.products[0];

  // Chuẩn bị 2 lô hàng cho sản phẩm: Lô A (HSD 2027-01-01, 5 SP), Lô B (HSD 2027-06-01, 10 SP)
  p.batches = [
    {
      id: 'BAT-TEST-001',
      productId: p.id,
      batchCode: 'LO-FEFO-01',
      mfgDate: '2026-01-01',
      expiryDate: '2027-01-01',
      costPrice: 20000,
      initialQty: 5,
      remainingQty: 5,
      status: 'active',
    },
    {
      id: 'BAT-TEST-002',
      productId: p.id,
      batchCode: 'LO-FEFO-02',
      mfgDate: '2026-06-01',
      expiryDate: '2027-06-01',
      costPrice: 22000,
      initialQty: 10,
      remainingQty: 10,
      status: 'active',
    },
  ];
  p.stock = 15;

  // Bán 7 sản phẩm: FEFO phải trừ hết 5 từ Lô A và 2 từ Lô B
  s.saveDraft({
    items: [{ id: p.id, name: p.name, price: p.price, qty: 7 }],
    discount: 0,
    customerId: '',
    note: 'Test FEFO',
    demographic: 'Không ghi nhận',
  });
  const o = s.checkout({ payment: 'cash', received: 7 * p.price });
  assert.equal(o.status, 'completed');

  const batchA = p.batches.find((b) => b.id === 'BAT-TEST-001');
  const batchB = p.batches.find((b) => b.id === 'BAT-TEST-002');
  assert.equal(batchA.remainingQty, 0, 'Lô A hết hạn sớm hơn bị trừ hết trước');
  assert.equal(batchA.status, 'depleted', 'Lô A chuyển trạng thái depleted');
  assert.equal(batchB.remainingQty, 8, 'Lô B chỉ bị trừ phần còn thiếu (2 SP)');
  assert.equal(p.stock, 8, 'Tồn kho tổng còn 8');

  // Kiểm tra batchAllocations trong hóa đơn lưu đúng vết
  const checkoutItem = o.items.find((i) => i.id === p.id);
  assert.ok(Array.isArray(checkoutItem.batchAllocations), 'Hóa đơn lưu chi tiết phân bổ lô');
  assert.equal(checkoutItem.batchAllocations.length, 2);
  assert.equal(checkoutItem.batchAllocations[0].batchCode, 'LO-FEFO-01');
  assert.equal(checkoutItem.batchAllocations[0].qty, 5);
  assert.equal(checkoutItem.batchAllocations[1].batchCode, 'LO-FEFO-02');
  assert.equal(checkoutItem.batchAllocations[1].qty, 2);

  // Nhập thêm hàng: tạo lô mới không được ghi đè HSD của Lô B
  const purchase = s.createPurchase(p.supplierId, [{ id: p.id, qty: 20, price: 21000 }], 'Nhập lô C');
  s.supplierRespond(purchase.id, {
    lines: [{ id: p.id, confirmedQty: 20, confirmedCost: 21000, expiryDate: '2028-01-01', batchCode: 'LO-FEFO-03' }],
  });
  s.approveSupplierResponse(purchase.id);
  s.confirmPurchaseReceipt(purchase.id);

  assert.equal(batchB.expiryDate, '2027-06-01', 'HSD của lô cũ không bị ghi đè');
  assert.equal(p.batches.length, 3, 'Tạo thành công lô mới thứ 3');
  assert.equal(p.stock, 28, 'Tồn kho tăng đúng 20 đơn vị');
});

test('Test 4: sweepExpiredBatches quarantines expired batches into damagedStock and excludes from salable stock', () => {
  const { s } = fixture();
  const p = s.data.products[1];

  // Giả lập 1 lô đã hết hạn
  p.batches = [
    {
      id: 'BAT-EXP-01',
      productId: p.id,
      batchCode: 'LO-EXPIRED',
      mfgDate: '2024-01-01',
      expiryDate: '2025-01-01',
      costPrice: p.costPrice,
      initialQty: 10,
      remainingQty: 10,
      status: 'active',
    },
    {
      id: 'BAT-VALID-01',
      productId: p.id,
      batchCode: 'LO-VALID',
      mfgDate: '2026-01-01',
      expiryDate: '2027-12-31',
      costPrice: p.costPrice,
      initialQty: 25,
      remainingQty: 25,
      status: 'active',
    },
  ];
  p.stock = 35;
  p.damagedStock = 0;

  // Thực hiện quét lô hết hạn
  const res = s.sweepExpiredBatches(new Date('2026-11-17'));
  assert.ok(res.quarantinedBatchesCount >= 1, 'Đã phát hiện và cách ly lô hết hạn');

  const expBatch = p.batches.find((b) => b.id === 'BAT-EXP-01');
  assert.equal(expBatch.status, 'expired_quarantined', 'Lô hết hạn chuyển sang expired_quarantined');
  assert.equal(p.stock, 25, 'Tồn kho khả dụng loại trừ hoàn toàn 10 đơn vị hết hạn');
  assert.equal(p.damagedStock, 10, 'Hàng hết hạn được đưa vào kho cách ly damagedStock');
});

test('Test 5: autoMigrate preserves user-customized fields and syncSeedCatalog requires admin authorization', () => {
  const { s } = fixture();

  // 1. autoMigrate bảo vệ dữ liệu người dùng
  const oldData = {
    schema: 1,
    products: [
      {
        id: 'SP001',
        barcode: '8935000000001',
        name: 'Sữa Tươi Đặc Biệt Của Cửa Hàng',
        price: 99000,
        costPrice: 50000,
        stock: 77,
        category: 'Sữa & Đồ uống',
        active: true,
      },
    ],
    promotions: [],
    vouchers: [],
  };

  const migrated = s.autoMigrate(oldData);
  const p1 = migrated.products.find((x) => x.id === 'SP001');
  assert.equal(p1.name, 'Sữa Tươi Đặc Biệt Của Cửa Hàng', 'Giữ nguyên tên do người dùng sửa');
  assert.equal(p1.price, 99000, 'Giữ nguyên giá bán do người dùng sửa');
  assert.equal(p1.costPrice, 50000, 'Giữ nguyên giá vốn');
  assert.equal(p1.stock, 77, 'Giữ nguyên tồn kho người dùng');
  assert.ok(p1.gtin, 'Được backfill trường gtin mới');
  assert.ok(p1.brand, 'Được backfill brand');

  // 2. syncSeedCatalog chặn người dùng không phải ADMIN
  s.login('nhanvien', '123456'); // CASHIER
  assert.throws(() => s.syncSeedCatalog(), /không có quyền|quản trị viên/i);

  s.login('admin', '123456'); // ADMIN
  const count = s.syncSeedCatalog();
  assert.ok(count >= 80, 'ADMIN đồng bộ thành công');
});



