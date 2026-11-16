(function (scope) {
  'use strict';
  const { KEY, ROLES, METHODS, ACCESS, clone, now, id, assert, integer } =
    typeof module !== 'undefined' && module.exports ? require('./config.js') : scope.Retail;
  const { totals } =
    typeof module !== 'undefined' && module.exports ? require('./calculations.js') : scope.Retail;
  const { validateBackup } =
    typeof module !== 'undefined' && module.exports ? require('./backup.js') : scope.Retail;
  const methods = {
    move(productId, delta, reason, reference) {
      const p = this.data.products.find((p) => p.id === productId);
      assert(p, 'Sản phẩm không tồn tại.');
      integer(p.stock + delta, 'Tồn kho sau cập nhật');
      p.stock += delta;
      this.data.movements.unshift({
        id: id('GD'),
        time: now(),
        productId,
        productName: p.name,
        delta,
        balance: p.stock,
        reason,
        reference,
        actor: this.user?.name || 'Hệ thống',
      });
    },
    audit(lines, note) {
      this.require('inventory');
      assert(note.trim(), 'Nhập lý do kiểm kê.');
      assert(
        lines.length && new Set(lines.map((i) => i.id)).size === lines.length,
        'Chọn danh sách kiểm kê hợp lệ.',
      );
      return this.commit('Xác nhận kiểm kê', note, () => {
        const a = { id: id('KK'), time: now(), actor: this.user.name, note, items: [] };
        lines.forEach((l) => {
          const p = this.data.products.find((p) => p.id === l.id);
          assert(p, 'Sản phẩm không tồn tại.');
          const actual = integer(l.actual, 'Tồn thực tế');
          const previous = p.stock;
          a.items.push({ id: p.id, name: p.name, previous, actual, delta: actual - previous });
          if (actual !== previous) this.move(p.id, actual - previous, 'Kiểm kê', a.id);
        });
        this.data.audits.unshift(a);
        return a;
      });
    },
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = methods;
  else (scope.Retail.storeModules || (scope.Retail.storeModules = {})).inventory = methods;
})(globalThis);
