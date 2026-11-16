(function (scope) {
  'use strict';
  const { KEY, ROLES, METHODS, ACCESS, clone, now, id, assert, integer } =
    typeof module !== 'undefined' && module.exports ? require('./config.js') : scope.Retail;
  const { totals } =
    typeof module !== 'undefined' && module.exports ? require('./calculations.js') : scope.Retail;
  const { validateBackup } =
    typeof module !== 'undefined' && module.exports ? require('./backup.js') : scope.Retail;
  const methods = {
    saveDraft(draft) {
      this.require('pos');
      return this.commit('Cập nhật giỏ hàng', 'Đơn hàng hiện tại', () => {
        totals(draft.items, draft.discount, this.data.settings.taxRate);
        this.data.draft = clone(draft);
      });
    },
    hold() {
      this.require('pos');
      assert(this.data.draft.items.length, 'Chọn sản phẩm trước khi lưu đơn.');
      assert(this.data.held.length < 5, 'Chỉ được lưu tối đa 5 đơn tạm.');
      return this.commit('Lưu đơn tạm', 'Giữ giỏ hàng để thanh toán sau', () => {
        const held = { ...clone(this.data.draft), id: id('TAM'), time: now() };
        this.data.held.unshift(held);
        this.clearDraft();
        return held;
      });
    },
    clearDraft() {
      this.data.draft = {
        items: [],
        customerId: '',
        discount: 0,
        note: '',
        demographic: 'Không ghi nhận',
      };
    },
    restoreHeld(heldId) {
      this.require('pos');
      assert(
        !this.data.draft.items.length,
        'Hãy lưu hoặc xóa giỏ hiện tại trước khi mở lại đơn tạm.',
      );
      return this.commit('Mở lại đơn tạm', heldId, () => {
        const h = this.data.held.find((h) => h.id === heldId);
        assert(h, 'Đơn tạm không còn tồn tại.');
        this.data.draft = clone(h);
        this.data.held = this.data.held.filter((x) => x.id !== heldId);
      });
    },
    deleteHeld(heldId) {
      this.require('pos');
      this.commit('Xóa đơn tạm', heldId, () => {
        this.data.held = this.data.held.filter((x) => x.id !== heldId);
      });
    },
    checkout({ payment, received = 0, paymentRef = '', confirmed = false }) {
      this.require('pos');
      assert(METHODS[payment], 'Phương thức thanh toán không hợp lệ.');
      const d = this.data.draft;
      assert(d.items.length, 'Giỏ hàng đang trống.');
      const t = totals(d.items, d.discount, this.data.settings.taxRate);
      if (payment === 'cash') {
        received = integer(received, 'Tiền khách đưa');
        assert(received >= t.total, 'Tiền khách đưa chưa đủ thanh toán.');
      } else {
        assert(confirmed, 'Cần xác nhận đã nhận tiền qua chuyển khoản hoặc máy POS.');
        assert(paymentRef.trim(), 'Nhập mã tham chiếu giao dịch.');
        received = t.total;
      }
      return this.commit('Thanh toán đơn hàng', METHODS[payment], () => {
        const items = d.items.map((i) => {
          const p = this.data.products.find((p) => p.id === i.id);
          assert(p && p.active, `Sản phẩm ${i.name} đã ngừng bán.`);
          integer(i.qty, 'Số lượng', 1);
          assert(p.stock >= i.qty, `${p.name} chỉ còn ${p.stock} sản phẩm.`);
          assert(i.price === p.price, `Giá ${p.name} đã thay đổi. Hãy xóa và chọn lại sản phẩm.`);
          return { ...clone(i), cost: p.cost, category: p.category, returnedQty: 0 };
        });
        // Integer allocation preserves the invoice total, including discounts and tax.
        let allocated = 0;
        items.forEach((i, index) => {
          i.paidTotal =
            index === items.length - 1
              ? t.total - allocated
              : Math.floor((t.total * (i.price * i.qty)) / Math.max(t.subtotal, 1));
          allocated += i.paidTotal;
        });
        const customer = this.data.customers.find((c) => c.id === d.customerId);
        assert(!d.customerId || customer?.active, 'Khách hàng không còn hoạt động.');
        const order = {
          id: id('HD'),
          time: now(),
          items,
          ...t,
          customerId: customer?.id || '',
          customer: customer?.name || 'Khách lẻ',
          payment,
          received,
          change: received - t.total,
          paymentRef: paymentRef.trim(),
          status: 'completed',
          staffId: this.user.id,
          staffName: this.user.name,
          note: d.note,
          demographic: d.demographic,
          store: clone(this.data.settings),
          branchId: 'CN001',
        };
        items.forEach((i) => this.move(i.id, -i.qty, 'Bán hàng', order.id));
        this.data.orders.unshift(order);
        this.clearDraft();
        return order;
      });
    },
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = methods;
  else (scope.Retail.storeModules || (scope.Retail.storeModules = {})).sales = methods;
})(globalThis);
