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

    audit(lines, note, status = 'resolved') {
      this.require('inventory');
      assert(note.trim(), 'Nhập lý do kiểm kê.');
      assert(
        lines.length && new Set(lines.map((i) => i.id)).size === lines.length,
        'Chọn danh sách kiểm kê hợp lệ.',
      );
      assert(
        ['resolved', 'pending_resolution'].includes(status),
        'Trạng thái kiểm kê không hợp lệ.',
      );
      return this.commit('Xác nhận kiểm kê', note, () => {
        const a = {
          id: id('KK'),
          time: now(),
          actor: this.user.name,
          note,
          status,
          step: status === 'resolved' ? 3 : 2,
          items: [],
        };
        if (status === 'resolved') {
          a.resolvedAt = now();
          a.resolvedBy = this.user.name;
        }
        lines.forEach((l) => {
          const p = this.data.products.find((p) => p.id === l.id);
          assert(p, 'Sản phẩm không tồn tại.');
          const actual = integer(l.actual, 'Tồn thực tế');
          const previous = p.stock;
          const delta = actual - previous;
          const costPrice = p.costPrice !== undefined ? p.costPrice : (p.cost || 0);
          const diffValue = Math.abs(delta) * costPrice;
          const resolutionAction =
            delta < 0
              ? (l.resolutionAction || l.resolution || 'damage_writeoff')
              : delta > 0
                ? (l.resolutionAction || l.resolution || 'surplus_adjust')
                : 'matched';
          const resolutionLabel =
            resolutionAction === 'damage_writeoff'
              ? 'Xuất hủy hàng hỏng / hết hạn sử dụng'
              : resolutionAction === 'staff_compensation'
                ? 'Quy trách nhiệm & Yêu cầu nhân viên bồi thường'
                : resolutionAction === 'natural_shrinkage'
                  ? 'Hao hụt tự nhiên trong định mức'
                  : resolutionAction === 'surplus_adjust'
                    ? 'Điều chỉnh tăng thừa thực tế'
                    : resolutionAction === 'supplier_bonus'
                      ? 'Ghi nhận hàng tặng kèm NCC'
                      : 'Khớp số liệu';
          const responsibleStaff = l.responsibleStaff
            ? String(l.responsibleStaff).trim()
            : resolutionAction === 'staff_compensation'
              ? 'Ca trực kho'
              : '';

          a.items.push({
            id: p.id,
            name: p.name,
            previous,
            actual,
            delta,
            diffQty: delta,
            costPrice,
            diffValue,
            resolution: resolutionAction,
            resolutionAction,
            resolutionLabel,
            responsibleStaff,
          });

          if (status === 'resolved' && actual !== previous) {
            this.move(p.id, delta, 'Kiểm kê', a.id);
          }
        });
        a.totalDiffValue = a.items.reduce((s, i) => s + (i.diffValue || 0), 0);
        this.data.audits.unshift(a);
        return a;
      });
    },

    resolveAudit(auditId) {
      this.require('inventory');
      return this.commit('Phê duyệt xử lý kiểm kê', auditId, () => {
        const a = this.data.audits.find((x) => x.id === auditId);
        assert(a, 'Phiếu kiểm kê không tồn tại.');
        assert(a.status === 'pending_resolution', 'Phiếu kiểm kê đã được xử lý hoặc không hợp lệ.');
        a.items.forEach((i) => {
          const p = this.data.products.find((prod) => prod.id === i.id);
          assert(p, `Sản phẩm ${i.name} không tồn tại.`);
          const delta = i.delta;
          if (delta !== 0) {
            this.move(p.id, delta, 'Kiểm kê', a.id);
          }
        });
        a.status = 'resolved';
        a.step = 3;
        a.resolvedAt = now();
        a.resolvedBy = this.user.name;
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
