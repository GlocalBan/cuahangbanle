(function (scope) {
  'use strict';
  const { KEY, ROLES, METHODS, ACCESS, clone, now, id, assert, integer } =
    typeof module !== 'undefined' && module.exports ? require('./config.js') : scope.Retail;
  const { totals } =
    typeof module !== 'undefined' && module.exports ? require('./calculations.js') : scope.Retail;
  const { validateBackup } =
    typeof module !== 'undefined' && module.exports ? require('./backup.js') : scope.Retail;
  const methods = {
    createPurchase(supplierId, lines, note, status = 'pending') {
      this.require('purchases');
      const supplier = this.data.suppliers.find((s) => s.id === supplierId && s.active);
      assert(supplier, 'Nhà cung cấp không hoạt động.');
      assert(['draft', 'pending'].includes(status), 'Trạng thái phiếu không hợp lệ.');
      assert(lines.length, 'Thêm ít nhất một mặt hàng.');
      assert(new Set(lines.map((i) => i.id)).size === lines.length, 'Không thêm trùng sản phẩm.');
      const items = lines.map((i) => {
        const p = this.data.products.find((p) => p.id === i.id && p.supplierId === supplierId);
        assert(p && p.active, 'Sản phẩm không thuộc nhà cung cấp hoặc đã ngừng bán.');
        return {
          id: p.id,
          name: p.name,
          qty: integer(i.qty, 'Số lượng nhập', 1),
          price: integer(i.price, 'Giá nhập'),
        };
      });
      return this.commit('Tạo phiếu nhập', supplier.name, () => {
        const p = {
          id: id('PN'),
          time: now(),
          supplierId,
          supplier: supplier.name,
          items,
          total: items.reduce((s, i) => s + i.qty * i.price, 0),
          note,
          status,
          actor: this.user.name,
        };
        this.data.purchases.unshift(p);
        return p;
      });
    },
    receivePurchase(purchaseId) {
      this.require('purchases');
      return this.commit('Xác nhận nhập hàng', purchaseId, () => {
        const p = this.data.purchases.find((p) => p.id === purchaseId);
        assert(p && p.status === 'pending', 'Chỉ xác nhận phiếu đang chờ nhận.');
        const s = this.data.suppliers.find((s) => s.id === p.supplierId);
        assert(s?.active, 'Nhà cung cấp đã ngừng hợp tác.');
        p.items.forEach((i) => {
          assert(this.data.products.find((p) => p.id === i.id)?.active, 'Sản phẩm đã ngừng bán.');
          this.move(i.id, i.qty, 'Nhập hàng', p.id);
          this.data.products.find((p) => p.id === i.id).cost = i.price;
        });
        p.status = 'received';
        p.receivedAt = now();
        p.receiver = this.user.name;
        return p;
      });
    },
    purchaseStatus(purchaseId, status) {
      this.require('purchases');
      assert(['pending', 'cancelled'].includes(status), 'Trạng thái không hợp lệ.');
      this.commit('Cập nhật phiếu nhập', purchaseId, () => {
        const p = this.data.purchases.find((p) => p.id === purchaseId);
        assert(p && ['draft', 'pending'].includes(p.status), 'Phiếu đã nhận hoặc đã hủy.');
        assert(status !== 'pending' || p.status === 'draft', 'Phiếu đã ở trạng thái chờ nhận.');
        p.status = status;
      });
    },
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = methods;
  else (scope.Retail.storeModules || (scope.Retail.storeModules = {})).purchases = methods;
})(globalThis);
