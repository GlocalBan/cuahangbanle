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

    case 'purchase-new':
      purchaseModal();
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
      store.purchaseStatus(a.id, 'pending');
      purchaseDetail(a.id);
      render();
      notify('Đã gửi phiếu chờ nhận hàng.');
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
