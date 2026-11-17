function orderTable(orders, compact = false) {
  return table(
    compact
      ? ['Mã đơn', 'Khách hàng', 'Tổng tiền', 'Trạng thái', '']
      : [
          'Mã đơn hàng',
          'Khách hàng',
          'Thời gian',
          'Thanh toán',
          'Tổng tiền',
          'Trạng thái',
          'Thao tác',
        ],
    orders.map(
      (o) =>
        `<tr><td class="name"><button class="text-link" data-action="order-detail" data-id="${e(o.id)}">${e(o.id)}</button></td><td>${e(o.customer)}</td>${compact ? '' : `<td>${date(o.time)}</td><td>${METHODS[o.payment]}</td>`}<td class="money name">${money(o.total)}</td><td>${status(o.status)}</td><td>${ib('order-detail', 'eye', 'Xem hóa đơn', `data-id="${e(o.id)}"`)}</td></tr>`,
    ),
  );
}

function ordersView() {
  const s = store.data;
  let list = s.orders.filter(
    (o) =>
      match(`${o.id} ${o.customer} ${o.staffName}`, filters.orders || '') &&
      (!filters.status || o.status === filters.status) &&
      (!filters.payment || o.payment === filters.payment) &&
      (!filters.from || dayKey(o.time) >= filters.from) &&
      (!filters.to || dayKey(o.time) <= filters.to),
  );
  const p = paginate(list, 'orders');
  return (
    heading(
      'BÁN HÀNG / ĐƠN HÀNG',
      'Lịch sử đơn hàng',
      'Tra cứu hóa đơn, xem chi tiết và theo dõi các lần hoàn trả.',
      action('export-orders', 'Xuất CSV', 'download'),
    ) +
    stats([
      ['Tổng đơn hàng', number(s.orders.length), 'Tất cả giao dịch đã lưu', 'receipt'],
      [
        'Đã thanh toán',
        number(s.orders.filter((o) => o.status === 'completed').length),
        'Hoàn tất, chưa trả hàng',
        'check',
      ],
      [
        'Có hoàn trả',
        number(s.orders.filter((o) => ['partial', 'refunded'].includes(o.status)).length),
        'Đã trả một phần hoặc toàn bộ',
        'return',
      ],
      [
        'Tổng giá trị hóa đơn',
        money(s.orders.filter((o) => o.status !== 'cancelled').reduce((a, o) => a + o.total, 0)),
        'Chưa trừ số tiền hoàn trả',
        'cash',
      ],
    ]) +
    `<section class="panel"><div class="panel-head"><h2>Danh sách đơn hàng</h2><span class="sub">Hóa đơn được lưu sau mỗi giao dịch</span></div><div class="table-tools wrap">${filterInput('orders', 'Tìm mã đơn, tên khách hàng, thu ngân…')}${filterSelect('status', [['', 'Tất cả trạng thái'], ...['completed', 'partial', 'refunded'].map((x) => [x, statusLabels[x][0]])])}${filterSelect('payment', [['', 'Tất cả thanh toán'], ...Object.entries(METHODS)])}<label class="date-filter">Từ <input type="date" id="filter-from" data-filter="from" value="${e(filters.from || '')}"></label><label class="date-filter">Đến <input type="date" id="filter-to" data-filter="to" value="${e(filters.to || '')}"></label></div>${orderTable(p.items)}${p.foot}</section>`
  );
}

function receiptHTML(o) {
  const returned = store.data.returns
    .filter((r) => r.orderId === o.id && r.status === 'approved')
    .reduce((a, r) => a + r.amount, 0);
  return `<article class="receipt"><div class="receipt-head"><h2>${e(o.store.name)}</h2><p>${e(o.store.address)}</p><p>Điện thoại: ${e(o.store.phone)}</p><h3>HÓA ĐƠN BÁN HÀNG</h3><p>${e(o.id)} · ${date(o.time)}</p></div><div class="detail-grid"><div>Khách hàng: <strong>${e(o.customer)}</strong><br>Thu ngân: ${e(o.staffName)}</div><div>Thanh toán: ${METHODS[o.payment]}<br>${o.paymentRef ? `Tham chiếu: ${e(o.paymentRef)}` : ''}</div></div>${table(
    ['Sản phẩm', 'SL', 'Đơn giá', 'Thành tiền'],
    o.items.map(
      (i) =>
        `<tr><td>${e(i.name)}${i.returnedQty ? `<div class="negative">Đã trả ${i.returnedQty}/${i.qty}</div>` : ''}</td><td>${i.qty}</td><td class="money">${money(i.price)}</td><td class="money right">${money(i.qty * i.price)}</td></tr>`,
    ),
  )}<div class="receipt-total"><div class="between"><span>Tạm tính</span><span>${money(o.subtotal)}</span></div>${o.promotionDiscount ? `<div class="between positive"><span>Giảm giá CTKM ${o.promotionCode ? `(${e(o.promotionCode)})` : ''}</span><span>− ${money(o.promotionDiscount)}</span></div>` : ''}${o.voucherDiscount ? `<div class="between positive"><span>Giảm giá App Voucher ${o.voucherCode ? `(${e(o.voucherCode)})` : ''}</span><span>− ${money(o.voucherDiscount)}</span></div>` : ''}${(o.discount - (o.promotionDiscount || 0) - (o.voucherDiscount || 0)) > 0 ? `<div class="between positive"><span>Giảm giá khác</span><span>− ${money(o.discount - (o.promotionDiscount || 0) - (o.voucherDiscount || 0))}</span></div>` : (!o.promotionDiscount && !o.voucherDiscount && o.discount > 0 ? `<div class="between positive"><span>Giảm giá</span><span>− ${money(o.discount)}</span></div>` : '')}<div class="between"><span>Thuế (${o.taxRate}%)</span><span>${money(o.tax)}</span></div><div class="between grand"><span>Tổng thanh toán</span><span>${money(o.total)}</span></div><div class="between"><span>Khách đưa / Đã nhận</span><span>${money(o.received)}</span></div><div class="between"><span>Tiền trả lại</span><span>${money(o.change)}</span></div>${returned ? `<div class="between negative"><span>Đã hoàn tiền</span><span>${money(returned)}</span></div><div class="between"><strong>Giá trị còn lại</strong><strong>${money(o.total - returned)}</strong></div>` : ''}</div>${o.note ? `<p class="sub">Ghi chú: ${e(o.note)}</p>` : ''}<div class="receipt-foot">${e(o.store.receiptNote)}<br>Hóa đơn nội bộ · Không thay thế hóa đơn điện tử theo quy định.</div></article>`;
}

function orderDetail(orderId) {
  const o = store.data.orders.find((o) => o.id === orderId);
  if (!o) throw new Error('Không tìm thấy hóa đơn.');
  modalContext = { type: 'order', id: o.id };
  showModal(
    'Chi tiết hóa đơn',
    `<div class="modal-content">${receiptHTML(o)}${
      store.data.returns.some((r) => r.orderId === o.id)
        ? `<div class="mt16"><h3>Lịch sử yêu cầu hoàn trả</h3>${store.data.returns
            .filter((r) => r.orderId === o.id)
            .map(
              (r) =>
                `<div class="activity"><i class="dot"></i><div><p>${e(r.id)} · ${status(r.status)} · ${money(r.amount)}</p><small>${date(r.time)} · ${e(r.reason)}</small></div></div>`,
            )
            .join('')}</div>`
        : ''
    }</div><div class="modal-footer wrap">${store.can('returns') && ['completed', 'partial'].includes(o.status) ? action('return-new', 'Trả hàng', 'return', '', `data-id="${e(o.id)}"`) : ''}${action('download-invoice', 'Tải hóa đơn', 'download', '', `data-id="${e(o.id)}"`)}${action('print-invoice', 'In / Lưu PDF', 'print', 'primary', `data-id="${e(o.id)}"`)}</div>`,
    true,
  );
}

function printInvoice(orderId) {
  const o = store.data.orders.find((o) => o.id === orderId);
  $('#print-area').innerHTML = receiptHTML(o);
  window.print();
}

function invoiceDownload(orderId) {
  const o = store.data.orders.find((o) => o.id === orderId);
  const html = `<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${e(o.id)}</title><style>body{max-width:720px;margin:40px auto;padding:20px;font-family:Arial,sans-serif;font-size:13px;color:#26354c}.receipt-head,.receipt-foot{text-align:center}.receipt-head{margin-bottom:30px}.detail-grid{display:flex;justify-content:space-between;margin:20px 0}table{border-collapse:collapse;width:100%}td,th{padding:12px 5px;border-bottom:1px solid #eee;text-align:left}.between{display:flex;justify-content:space-between;gap:25px;margin-top:8px}.receipt-total{margin:25px 0}.grand{font-size:18px}.sub,.receipt-foot{font-size:11px;color:#738097}.receipt-foot{margin-top:30px}@media print{body{margin:0}}</style>${receiptHTML(o)}</html>`;
  download(html, `${o.id}.html`, 'text/html;charset=utf-8');
  notify('Đã tải hóa đơn. Mở tệp để xem hoặc in lại.');
}
