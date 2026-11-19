/* M4: Click Actions cho Hóa đơn (SQLite API). */
'use strict';

function handleOrdersAction(a) {
  switch (a.action) {
    case 'order-detail':
      orderDetail(a.id);
      break;

    case 'download-invoice':
      invoiceDownload(a.id);
      break;

    case 'print-invoice':
      printInvoice(a.id);
      break;

    case 'orders-reset':
      delete filters.orders;
      delete filters.orderStatus;
      delete filters.orderPayment;
      delete filters.orderFrom;
      delete filters.orderTo;
      apiState.orderError = '';
      pagination.orders = 1;
      loadOrdersData(true);
      render();
      break;

    case 'export-orders': {
      if (!store.hasPermission('ORDER_VIEW')) {
        notify('Bạn không có quyền xuất danh sách hóa đơn.', true);
        return true;
      }
      const list = apiState.orders || [];
      exportCSV(
        [
          [
            'Mã hóa đơn',
            'Thời gian',
            'Khách hàng',
            'Thu ngân',
            'Phương thức',
            'Tạm tính',
            'Giảm giá KM',
            'Thuế VAT',
            'Tổng thanh toán',
            'Đã hoàn tiền',
            'Trạng thái',
          ],
          ...list.map((o) => [
            o.id,
            date(o.createdAt),
            o.customerName,
            o.cashierName,
            METHODS[o.paymentMethod] || o.paymentMethod,
            o.subtotal,
            o.invoiceDiscount,
            o.taxAmount,
            o.totalAmount,
            o.refundedAmount,
            o.statusLabel || statusLabels[o.status]?.[0] || o.status,
          ]),
        ],
        'RetailFlow-hoa-don.csv',
      );
      break;
    }

    default:
      return false;
  }
  return true;
}
