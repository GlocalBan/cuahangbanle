/* M4: Click Actions cho Trả hàng & Hoàn tiền (SQLite API + Confirm Dialog + RBAC). */
'use strict';

function handleReturnsAction(a) {
  switch (a.action) {
    case 'return-new':
      returnModal(a.id || '');
      break;

    case 'return-search':
      searchReturn();
      break;

    case 'return-detail':
      returnDetail(a.id);
      break;

    case 'returns-reset':
      delete filters.returns;
      delete filters.returnStatus;
      delete filters.returnFrom;
      delete filters.returnTo;
      apiState.returnError = '';
      pagination.returns = 1;
      loadReturnsData(true);
      render();
      break;

    case 'return-approve': {
      const rid = a.id;
      if (!store.hasPermission('RETURN_APPROVE')) {
        notify('Bạn không có quyền duyệt phiếu trả hàng (RETURN_APPROVE).', true);
        return true;
      }
      confirmation(
        `Xác nhận duyệt hoàn tiền phiếu ${rid}?`,
        'Hệ thống sẽ thực thi trong <strong>1 Transaction nguyên tử</strong>: cập nhật số lượng đã trả trên hóa đơn, cộng hoàn tồn kho (nếu hàng nguyên vẹn), ghi Thẻ kho <code>TRA_HANG</code> và ghi nhận tiền hoàn. Thao tác không thể hoàn tác.',
        async () => {
          const res = await api.approveReturn(rid);
          notify(
            `Đã xác nhận hoàn tiền ${money(res.item.refundAmount)} cho phiếu ${rid}${res.item.restock ? ' và cộng hoàn tồn kho.' : '.'}`,
          );
          await Promise.all([
            loadReturnsData(true),
            loadOrdersData(true),
            apiState.productsLoaded ? loadProductsData(true) : Promise.resolve(),
            apiState.stockMovementsLoaded ? loadStockMovementsData(true) : Promise.resolve(),
          ]);
          returnDetail(rid);
        },
      );
      break;
    }

    case 'return-reject': {
      const rid = a.id;
      if (!store.hasPermission('RETURN_APPROVE')) {
        notify('Bạn không có quyền từ chối phiếu trả hàng (RETURN_APPROVE).', true);
        return true;
      }
      confirmation(
        `Từ chối phiếu trả hàng ${rid}?`,
        'Phiếu sẽ chuyển sang trạng thái <strong>Đã từ chối</strong> và không làm thay đổi tồn kho hay doanh thu.',
        async () => {
          await api.rejectReturn(rid, 'Không đáp ứng điều kiện kiểm tra hàng trả');
          notify(`Đã từ chối phiếu trả hàng ${rid}.`);
          await loadReturnsData(true);
          returnDetail(rid);
        },
      );
      break;
    }

    default:
      return false;
  }
  return true;
}
