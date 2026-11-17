function handleInventoryAction(a) {
  switch (a.action) {
    case 'inventory-tab':
      inventoryTab = a.tab;
      filters = {};
      pagination = {};
      render();
      break;

    case 'audit-new':
      auditModal();
      break;

    case 'audit-expired-products': {
      confirmation(
        'Lập phiếu kiểm kê hủy hàng hết hạn?',
        'Toàn bộ sản phẩm đã hết hạn sử dụng còn tồn kho sẽ được đưa về 0, chuyển vào chi phí hao hụt và ghi nhận biên bản hủy hàng CVS.',
        () => {
          const auditRec = store.auditExpiredProducts();
          render();
          notify(`Đã lập biên bản hủy ${auditRec.items.length} mặt hàng hết hạn (${auditRec.id})!`);
        },
      );
      break;
    }

    case 'purchase-new':
      purchaseModal();
      break;

    case 'purchase-restock':
      purchaseModal(a.id);
      break;

    case 'purchase-add-suggestion':
      addSuggestedPurchase(a.id);
      break;

    case 'purchase-detail':
      purchaseDetail(a.id);
      break;

    case 'purchase-line-add': {
      const p = store.data.products.find((p) => p.id === $('#purchase-product').value);
      if (!p) throw new Error('Nhà cung cấp này chưa có sản phẩm đang bán.');
      const qty = Number($('#purchase-qty').value),
        price = Number($('#purchase-price').value);
      if (!Number.isInteger(qty) || qty < 1 || !Number.isInteger(price) || price < 0)
        throw new Error('Số lượng và giá nhập phải là số nguyên hợp lệ.');
      if (purchaseLines.some((i) => i.id === p.id))
        throw new Error('Sản phẩm đã có trong phiếu. Xóa dòng cũ để nhập lại.');
      purchaseLines.push({ id: p.id, name: p.name, qty, price });
      renderPurchaseLines();
      break;
    }

    case 'purchase-line-delete':
      purchaseLines.splice(Number(a.index), 1);
      renderPurchaseLines();
      break;

    case 'purchase-send':
      store.purchaseStatus(a.id, 'sent_to_supplier');
      purchaseDetail(a.id);
      render();
      notify('Đã gửi đơn đặt hàng tới NCC.');
      break;

    case 'open-supplier-response':
      supplierResponseModal(a.id);
      break;

    case 'approve-supplier-response': {
      const pid = a.id;
      confirmation(
        'Duyệt phản hồi từ Nhà cung cấp?',
        'Đơn hàng sẽ chuyển sang trạng thái sẵn sàng để nhân viên kho kiểm nhận GRN.',
        () => {
          store.approveSupplierResponse(pid);
          render();
          purchaseDetail(pid);
          notify('Đã phê duyệt phản hồi từ NCC.');
        },
      );
      break;
    }

    case 'open-purchase-receipt':
      purchaseReceiptModal(a.id);
      break;

    case 'purchase-receive': {
      const pid = a.id;
      confirmation(
        'Xác nhận đã nhận đủ hàng?',
        'Số lượng theo phiếu sẽ được cộng vào kho và giá vốn sẽ được cập nhật.',
        () => {
          store.receivePurchase(pid);
          render();
          purchaseDetail(pid);
          notify('Nhập kho thành công.');
        },
      );
      break;
    }

    case 'purchase-cancel': {
      const pid = a.id;
      confirmation(
        'Hủy phiếu nhập?',
        'Phiếu chưa nhận sẽ được chuyển sang trạng thái đã hủy.',
        () => {
          store.purchaseStatus(pid, 'cancelled');
          render();
          purchaseDetail(pid);
        },
      );
      break;
    }

    default:
      return false;
  }
  return true;
}
