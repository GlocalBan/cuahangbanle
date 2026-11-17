'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Store, KEY, clone, validateBackup } = require('../store');
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
    () => s.createBranch({ name: 'CN mới', address: '123 ABC', area: 'Hà Nội' }),
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
  assert.ok(nearExpiry.length >= 10 && nearExpiry.length <= 15, 'Có 10-15 sản phẩm cận date');
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
