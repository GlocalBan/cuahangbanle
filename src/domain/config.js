(function (scope) {
  'use strict';
  const KEY = 'retailflow.v1';
  const ROLES = {
    ADMIN: 'Admin (Quản trị viên)',
    MANAGER: 'Quản lý cửa hàng',
    CASHIER: 'Thu ngân',
    WAREHOUSE: 'Nhân viên kho',
    SUPPLIER: 'Nhà cung cấp (Portal)',
  };
  const ROLE_SHORT = {
    ADMIN: 'Admin',
    MANAGER: 'QuanLy',
    CASHIER: 'ThuNgan',
    WAREHOUSE: 'NhanVienKho',
    SUPPLIER: 'NCC',
  };
  const METHODS = {
    cash: 'Tiền mặt',
    transfer: 'Chuyển khoản / VietQR',
    card: 'Thẻ ngân hàng',
    CASH: 'Tiền mặt',
    VIETQR: 'Chuyển khoản / VietQR',
    CARD: 'Thẻ ngân hàng',
  };
  const ACCESS = {
    ADMIN: [
      'dashboard',
      'pos',
      'products',
      'orders',
      'inventory',
      'purchases',
      'promotions',
      'suppliers',
      'supplier-portal',
      'customers',
      'staff',
      'returns',
      'reports',
      'branches',
      'settings',
      'audit-logs',
    ],
    MANAGER: [
      'dashboard',
      'pos',
      'products',
      'orders',
      'inventory',
      'purchases',
      'promotions',
      'suppliers',
      'customers',
      'returns',
      'reports',
      'branches',
    ],
    CASHIER: ['pos', 'orders', 'products', 'customers', 'returns'],
    WAREHOUSE: ['products', 'inventory', 'purchases', 'suppliers'],
    SUPPLIER: ['supplier-portal'],
  };
  const PAGE_PERMISSIONS = {
    dashboard: 'DASHBOARD_VIEW',
    pos: 'POS_SELL',
    orders: 'ORDER_VIEW',
    returns: 'RETURN_CREATE',
    products: 'PRODUCT_VIEW',
    inventory: 'INVENTORY_VIEW',
    purchases: 'PURCHASE_CREATE',
    promotions: 'PROMOTION_MANAGE',
    suppliers: 'SUPPLIER_VIEW',
    'supplier-portal': 'SUPPLIER_PORTAL',
    customers: 'CUSTOMER_MANAGE',
    reports: 'REPORT_VIEW',
    branches: 'REPORT_VIEW',
    staff: 'STAFF_MANAGE',
    settings: 'THAM_SO_MANAGE',
    'audit-logs': 'AUDIT_LOG_VIEW',
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

  const api = { KEY, ROLES, ROLE_SHORT, METHODS, ACCESS, PAGE_PERMISSIONS, clone, now, id, assert, integer };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(scope.Retail || (scope.Retail = {}), api);
})(globalThis);
