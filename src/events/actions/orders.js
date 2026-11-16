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

    case 'export-orders':
      store.require('orders');
      exportCSV(
        [
          [
            'Mã hóa đơn',
            'Thời gian',
            'Khách hàng',
            'Thu ngân',
            'Thanh toán',
            'Tổng tiền',
            'Trạng thái',
          ],
          ...store.data.orders.map((o) => [
            o.id,
            date(o.time),
            o.customer,
            o.staffName,
            METHODS[o.payment],
            o.total,
            statusLabels[o.status][0],
          ]),
        ],
        'RetailFlow-hoa-don.csv',
      );
      break;

    default:
      return false;
  }
  return true;
}
