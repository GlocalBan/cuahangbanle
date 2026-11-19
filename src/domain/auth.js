(function (scope) {
  'use strict';
  const { KEY, ROLES, METHODS, ACCESS, PAGE_PERMISSIONS, clone, now, id, assert, integer } =
    typeof module !== 'undefined' && module.exports ? require('./config.js') : scope.Retail;
  const { totals } =
    typeof module !== 'undefined' && module.exports ? require('./calculations.js') : scope.Retail;
  const { validateBackup } =
    typeof module !== 'undefined' && module.exports ? require('./backup.js') : scope.Retail;
  const methods = {
    login(username, password) {
      const u = this.data.staff.find(
        (s) => s.username === username && s.password === password && s.active,
      );
      assert(u, 'Tên đăng nhập hoặc mật khẩu chưa đúng, hoặc tài khoản đã bị khóa.');
      this.userId = u.id;
      this.authUser = null;
      return u;
    },
    setAuthenticatedUser(user) {
      this.authUser = user || null;
      this.userId = user ? user.id : null;
    },
    hasPermission(permissionCode) {
      const u = this.user;
      if (!u) return false;
      if (Array.isArray(u.permissions)) {
        return u.permissions.includes(permissionCode);
      }
      if (u.role === 'ADMIN') return true;
      if (u.role === 'MANAGER') {
        return !['STAFF_MANAGE', 'THAM_SO_MANAGE', 'AUDIT_LOG_VIEW', 'BACKUP_MANAGE', 'POS_SELL'].includes(
          permissionCode,
        );
      }
      if (u.role === 'CASHIER') {
        return ['POS_SELL', 'ORDER_VIEW', 'RETURN_CREATE', 'PRODUCT_VIEW', 'CUSTOMER_MANAGE'].includes(
          permissionCode,
        );
      }
      if (u.role === 'WAREHOUSE') {
        return ['PRODUCT_VIEW', 'PRODUCT_COST_VIEW', 'INVENTORY_VIEW', 'INVENTORY_AUDIT', 'PURCHASE_CREATE', 'SUPPLIER_VIEW'].includes(
          permissionCode,
        );
      }
      return false;
    },
    can(page) {
      const u = this.user;
      if (!u) return false;
      const rolePages = ACCESS[u.role] || [];
      if (Array.isArray(u.permissions)) {
        const requiredPerm = PAGE_PERMISSIONS[page];
        if (!requiredPerm) return false;
        return u.permissions.includes(requiredPerm) && rolePages.includes(page);
      }
      return rolePages.includes(page);
    },
    require(page) {
      assert(this.can(page), 'Bạn không có quyền thực hiện thao tác này.');
    },
    requirePermission(permissionCode) {
      assert(this.hasPermission(permissionCode), 'Bạn không có quyền thực hiện thao tác này.');
    },
    admin() {
      assert(
        this.user && this.user.role === 'ADMIN',
        'Bạn không có quyền thực hiện thao tác này (chỉ dành cho Quản trị viên).',
      );
    },
    managerOrAdmin() {
      assert(
        this.user && ['ADMIN', 'MANAGER'].includes(this.user.role),
        'Bạn không có quyền thực hiện thao tác này.',
      );
    },
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = methods;
  else (scope.Retail.storeModules || (scope.Retail.storeModules = {})).auth = methods;
})(globalThis);
