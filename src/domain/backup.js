(function (scope) {
  'use strict';
  const { assert, integer, ROLES, METHODS } =
    typeof module !== 'undefined' && module.exports ? require('./config.js') : scope.Retail;
  const { totals } =
    typeof module !== 'undefined' && module.exports ? require('./calculations.js') : scope.Retail;
  function validateBackup(s) {
    assert(s && s.schema === 1, 'Tệp sao lưu không đúng định dạng RetailFlow v1.');
    if (!Array.isArray(s.promotions)) s.promotions = [];
    if (!Array.isArray(s.vouchers)) s.vouchers = [];
    for (const key of [
      'products',
      'customers',
      'suppliers',
      'staff',
      'orders',
      'returns',
      'purchases',
      'movements',
      'audits',
      'held',
      'branches',
      'logs',
    ]) {
      assert(Array.isArray(s[key]), `Thiếu danh sách ${key}.`);
      const keys = s[key].map((x) => x.id);
      assert(
        keys.every((x) => typeof x === 'string' && x.length > 0) &&
          new Set(keys).size === keys.length,
        `Mã trong ${key} không hợp lệ hoặc trùng.`,
      );
    }
    for (const key of ['promotions', 'vouchers']) {
      const keys = s[key].map((x) => x.id);
      assert(
        keys.every((x) => typeof x === 'string' && x.length > 0) &&
          new Set(keys).size === keys.length,
        `Mã trong ${key} không hợp lệ hoặc trùng.`,
      );
    }
    assert(
      s.settings && typeof s.settings.name === 'string' && typeof s.settings.address === 'string',
      'Cấu hình cửa hàng không hợp lệ.',
    );
    integer(s.settings.taxRate, 'Thuế suất', 0, 100);
    const productIds = new Set(s.products.map((p) => p.id));
    const supplierIds = new Set(s.suppliers.map((p) => p.id));
    const barcodes = new Set();
    s.products.forEach((p) => {
      assert(
        typeof p.name === 'string' &&
          typeof p.category === 'string' &&
          typeof p.icon === 'string' &&
          typeof p.active === 'boolean',
        'Sản phẩm không hợp lệ.',
      );
      assert(supplierIds.has(p.supplierId), 'Nhà cung cấp của sản phẩm không tồn tại.');
      integer(p.price, 'Giá bán');
      if (p.cost === undefined && p.costPrice !== undefined) p.cost = p.costPrice;
      if (p.costPrice === undefined && p.cost !== undefined) p.costPrice = p.cost;
      integer(p.cost, 'Giá vốn');
      integer(p.costPrice, 'Giá vốn');
      integer(p.stock, 'Tồn kho');
      integer(p.minStock, 'Ngưỡng tồn');
      assert(typeof p.barcode === 'string' && !barcodes.has(p.barcode), 'Mã vạch bị trùng.');
      barcodes.add(p.barcode);
      if (p.batchCode === undefined) p.batchCode = `LO-${p.id || 'BATCH'}`;
      if (p.imageUrl === undefined) p.imageUrl = '';
      if (p.damagedStock === undefined) p.damagedStock = 0;
      if (p.inNearExpiryPromo === undefined) p.inNearExpiryPromo = false;
      if (p.mfgDate === undefined) p.mfgDate = new Date().toISOString().slice(0, 10);
      if (p.expiryDate === undefined) {
        const d = new Date();
        d.setDate(d.getDate() + 180);
        p.expiryDate = d.toISOString().slice(0, 10);
      }
      assert(typeof p.batchCode === 'string', 'Mã lô không hợp lệ.');
      assert(typeof p.imageUrl === 'string', 'Đường dẫn ảnh không hợp lệ.');
      assert(typeof p.mfgDate === 'string' && !isNaN(Date.parse(p.mfgDate)), 'Ngày sản xuất không hợp lệ.');
      assert(typeof p.expiryDate === 'string' && !isNaN(Date.parse(p.expiryDate)), 'Hạn sử dụng không hợp lệ.');
    });
    s.staff.forEach((u) =>
      assert(
        typeof u.username === 'string' &&
          typeof u.password === 'string' &&
          typeof u.name === 'string' &&
          ROLES[u.role] &&
          typeof u.active === 'boolean',
        'Tài khoản không hợp lệ.',
      ),
    );
    assert(
      new Set(s.staff.map((u) => u.username)).size === s.staff.length,
      'Tên đăng nhập bị trùng.',
    );
    assert(
      s.staff.some((u) => u.role === 'ADMIN' && u.active),
      'Cần ít nhất một quản trị viên đang hoạt động.',
    );
    const validItems = (items, checkReturned = false) => {
      assert(Array.isArray(items) && items.length, 'Danh sách hàng không hợp lệ.');
      assert(
        new Set(items.map((i) => i.id)).size === items.length,
        'Sản phẩm trong chứng từ bị trùng.',
      );
      items.forEach((i) => {
        assert(productIds.has(i.id), 'Sản phẩm trong chứng từ không tồn tại.');
        integer(i.qty, 'Số lượng', 1);
        integer(i.price, 'Đơn giá');
        if (checkReturned) {
          integer(i.returnedQty, 'Số lượng đã trả', 0, i.qty);
          integer(i.paidTotal, 'Giá trị đã trả tiền');
        }
      });
    };
    s.orders.forEach((o) => {
      validItems(o.items, true);
      assert(
        !isNaN(Date.parse(o.time)) &&
          METHODS[o.payment] &&
          ['completed', 'partial', 'refunded', 'cancelled'].includes(o.status),
        'Hóa đơn không hợp lệ.',
      );
      integer(o.total, 'Tổng hóa đơn');
      const t = totals(o.items, o.discount, o.taxRate);
      assert(
        t.total === o.total && o.items.reduce((a, i) => a + i.paidTotal, 0) === o.total,
        'Tổng tiền hóa đơn không khớp.',
      );
    });
    s.returns.forEach((r) => {
      assert(
        ['pending', 'approved', 'rejected'].includes(r.status) &&
          s.orders.some((o) => o.id === r.orderId),
        'Phiếu trả không hợp lệ.',
      );
      validItems(r.items);
      integer(r.amount, 'Tiền hoàn');
    });
    s.purchases.forEach((p) => {
      assert(
        supplierIds.has(p.supplierId) &&
          ['draft', 'pending', 'received', 'cancelled'].includes(p.status),
        'Phiếu nhập không hợp lệ.',
      );
      validItems(p.items);
      integer(p.total, 'Tổng tiền nhập');
      assert(
        p.total === p.items.reduce((a, i) => a + i.qty * i.price, 0),
        'Tổng phiếu nhập không khớp.',
      );
    });
    assert(s.held.length <= 5 && s.draft && Array.isArray(s.draft.items), 'Đơn tạm không hợp lệ.');
    for (const d of [s.draft, ...s.held]) {
      if (d.items.length) validItems(d.items);
      totals(d.items, d.discount, s.settings.taxRate);
    }
    s.customers.forEach((c) =>
      assert(typeof c.name === 'string' && typeof c.phone === 'string', 'Khách hàng không hợp lệ.'),
    );
    s.suppliers.forEach((c) =>
      assert(
        typeof c.name === 'string' && typeof c.areas === 'string',
        'Nhà cung cấp không hợp lệ.',
      ),
    );
    return s;
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { validateBackup };
  else scope.Retail.validateBackup = validateBackup;
})(globalThis);
