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
        const a = {
          id: id('KK'),
          time: now(),
          actor: this.user.name,
          note,
          status: 'resolved',
          step: 3,
          items: [],
        };
        lines.forEach((l) => {
          const p = this.data.products.find((p) => p.id === l.id);
          assert(p, 'Sản phẩm không tồn tại.');
          const actual = integer(l.actual, 'Tồn thực tế');
          const previous = p.stock;
          const delta = actual - previous;
          const costPrice = p.costPrice !== undefined ? p.costPrice : (p.cost || 0);
          const diffValue = Math.abs(delta) * costPrice;
          const resolution =
            delta < 0
              ? l.resolution || 'damage_writeoff'
              : delta > 0
                ? l.resolution || 'surplus_adjust'
                : 'matched';
          const responsibleStaff = l.responsibleStaff ? String(l.responsibleStaff).trim() : '';

          a.items.push({
            id: p.id,
            name: p.name,
            previous,
            actual,
            delta,
            costPrice,
            diffValue,
            resolution,
            responsibleStaff,
          });

          if (actual !== previous) this.move(p.id, delta, 'Kiểm kê', a.id);
        });
        a.totalDiffValue = a.items.reduce((s, i) => s + (i.diffValue || 0), 0);
        this.data.audits.unshift(a);
        return a;
      });
    },

    auditExpiredProducts() {
      this.require('inventory');
      const getExp =
        scope.Retail?.getExpiryInfo ||
        (typeof require !== 'undefined' ? require('./catalog.js').getExpiryInfo : null);
      assert(getExp, 'Hàm kiểm tra hạn sử dụng không sẵn sàng.');
      const expiredItems = this.data.products.filter((p) => {
        const exp = getExp(p.expiryDate);
        return exp && exp.status === 'expired' && p.stock > 0;
      });
      assert(
        expiredItems.length > 0,
        'Không có sản phẩm hết hạn nào còn tồn kho để lập phiếu hủy.',
      );
      const lines = expiredItems.map((p) => ({
        id: p.id,
        actual: 0,
        resolution: 'damage_writeoff',
        responsibleStaff: '',
      }));
      return this.audit(
        lines,
        'Phiếu kiểm kê hủy bỏ hàng hết hạn sử dụng (Quy trình chuẩn CVS)',
      );
    },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = methods;
  else (scope.Retail.storeModules || (scope.Retail.storeModules = {})).inventory = methods;
})(globalThis);
