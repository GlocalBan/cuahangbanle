(function (scope) {
  'use strict';
  const { KEY, ROLES, METHODS, ACCESS, clone, now, id, assert, integer } =
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
      return u;
    },
    can(page) {
      return !!this.user && ACCESS[this.user.role].includes(page);
    },
    require(page) {
      assert(this.can(page), 'Bạn không có quyền thực hiện thao tác này.');
    },
    admin() {
      this.require('settings');
    },
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = methods;
  else (scope.Retail.storeModules || (scope.Retail.storeModules = {})).auth = methods;
})(globalThis);
