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
  assert.equal(s.data.products.length, 29);
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
