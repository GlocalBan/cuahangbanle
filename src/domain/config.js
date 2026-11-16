(function (scope) {
  'use strict';
  const KEY = 'retailflow.v1';
  const ROLES = { ADMIN: 'Quản trị viên', CASHIER: 'Thu ngân', WAREHOUSE: 'Nhân viên kho' };
  const METHODS = { cash: 'Tiền mặt', transfer: 'Chuyển khoản', card: 'Thẻ ngân hàng' };
  const ACCESS = {
    ADMIN: [
      'dashboard',
      'pos',
      'products',
      'orders',
      'inventory',
      'purchases',
      'suppliers',
      'customers',
      'staff',
      'returns',
      'reports',
      'branches',
      'settings',
    ],
    CASHIER: ['pos', 'orders', 'customers', 'returns'],
    WAREHOUSE: ['products', 'inventory', 'purchases', 'suppliers'],
  };
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const now = () => new Date().toISOString();
  const id = (prefix) =>
    `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const integer = (n, label, min = 0, max = 1000000000000) => {
    n = Number(n);
    assert(
      Number.isSafeInteger(n) && n >= min && n <= max,
      `${label} phải là số nguyên từ ${min.toLocaleString('vi-VN')} đến ${max.toLocaleString('vi-VN')}.`,
    );
    return n;
  };

  const api = { KEY, ROLES, METHODS, ACCESS, clone, now, id, assert, integer };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(scope.Retail || (scope.Retail = {}), api);
})(globalThis);
