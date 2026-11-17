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
      assert(
        ['draft', 'pending', 'sent_to_supplier'].includes(status),
        'Trạng thái phiếu không hợp lệ.',
      );
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

    supplierRespond(purchaseId, responseData = {}) {
      this.require('purchases');
      return this.commit('Phản hồi từ NCC', purchaseId, () => {
        const p = this.data.purchases.find((x) => x.id === purchaseId);
        assert(
          p && ['pending', 'sent_to_supplier'].includes(p.status),
          'Chỉ phản hồi cho phiếu đang chờ xác nhận từ NCC.',
        );
        const respLines = responseData.lines || [];
        p.items.forEach((item) => {
          const resp = respLines.find((l) => l.id === item.id) || {};
          item.confirmedQty =
            resp.confirmedQty !== undefined
              ? integer(resp.confirmedQty, 'Số lượng NCC giao', 0)
              : item.qty;
          item.confirmedCost =
            resp.confirmedCost !== undefined
              ? integer(resp.confirmedCost, 'Giá vốn xác nhận', 0)
              : item.price;
          if (resp.expiryDate) item.expiryDate = String(resp.expiryDate).trim();
          if (resp.batchCode) item.batchCode = String(resp.batchCode).trim();
          if (resp.note) item.supplierNote = String(resp.note).trim();
        });
        if (responseData.supplierNote) p.supplierNote = String(responseData.supplierNote).trim();
        p.status = 'supplier_responded';
        p.supplierRespondedAt = now();
        return p;
      });
    },

    approveSupplierResponse(purchaseId, note = '') {
      this.require('purchases');
      return this.commit('Duyệt phản hồi NCC', purchaseId, () => {
        const p = this.data.purchases.find((x) => x.id === purchaseId);
        assert(
          p && p.status === 'supplier_responded',
          'Chỉ duyệt phiếu đã có phản hồi từ nhà cung cấp.',
        );
        p.status = 'store_approved';
        p.storeApprovedAt = now();
        p.storeApprover = this.user.name;
        if (note) p.storeApprovalNote = String(note).trim();
        return p;
      });
    },

    confirmPurchaseReceipt(purchaseId, receiptData = {}) {
      this.require('purchases');
      return this.commit('Xác nhận nhập hàng thực tế', purchaseId, () => {
        const p = this.data.purchases.find((x) => x.id === purchaseId);
        assert(
          p && ['pending', 'store_approved'].includes(p.status),
          'Chỉ xác nhận nhập hàng cho phiếu đang chờ nhận hoặc đã duyệt NCC.',
        );
        const s = this.data.suppliers.find((s) => s.id === p.supplierId);
        assert(s?.active, 'Nhà cung cấp đã ngừng hợp tác.');

        const recLines = receiptData.lines || [];
        p.items.forEach((i) => {
          const prod = this.data.products.find((prod) => prod.id === i.id);
          assert(prod?.active, `Sản phẩm ${i.name} đã ngừng bán.`);

          const rec = recLines.find((l) => l.id === i.id);
          const defaultQty = i.confirmedQty !== undefined ? i.confirmedQty : i.qty;
          const defaultCost = i.confirmedCost !== undefined ? i.confirmedCost : i.price;
          const accepted =
            rec && rec.acceptedQty !== undefined
              ? integer(rec.acceptedQty, 'Số lượng đạt chuẩn', 0)
              : defaultQty;
          const rejected =
            rec && rec.rejectedQty !== undefined
              ? integer(rec.rejectedQty, 'Số lượng lỗi/trả lại', 0)
              : 0;

          i.acceptedQty = accepted;
          i.rejectedQty = rejected;
          i.confirmedCost = defaultCost;

          if (accepted > 0) {
            this.move(i.id, accepted, 'Nhập hàng', p.id);
            prod.cost = prod.costPrice = defaultCost;
            if (i.expiryDate) prod.expiryDate = i.expiryDate;
            if (i.batchCode) prod.batchCode = i.batchCode;
          }
        });

        p.total = p.items.reduce(
          (sum, i) =>
            sum + (i.acceptedQty !== undefined ? i.acceptedQty : i.qty) * (i.confirmedCost || i.price),
          0,
        );
        p.status = 'received';
        p.receivedAt = now();
        p.receiver = this.user.name;
        if (receiptData.receiverNote) p.receiverNote = String(receiptData.receiverNote).trim();
        return p;
      });
    },

    receivePurchase(purchaseId) {
      return this.confirmPurchaseReceipt(purchaseId);
    },

    purchaseStatus(purchaseId, status) {
      this.require('purchases');
      assert(
        ['pending', 'sent_to_supplier', 'supplier_responded', 'store_approved', 'cancelled'].includes(
          status,
        ),
        'Trạng thái không hợp lệ.',
      );
      this.commit('Cập nhật phiếu nhập', purchaseId, () => {
        const p = this.data.purchases.find((p) => p.id === purchaseId);
        assert(p && p.status !== 'received' && p.status !== 'cancelled', 'Phiếu đã nhận hoặc đã hủy.');
        assert(status !== 'pending' || p.status === 'draft', 'Phiếu đã ở trạng thái chờ nhận.');
        p.status = status;
      });
    },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = methods;
  else (scope.Retail.storeModules || (scope.Retail.storeModules = {})).purchases = methods;
})(globalThis);
