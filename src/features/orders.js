/* M4: Lịch sử Hóa đơn, Chi tiết & In/Tải hóa đơn (BR-03, BR-04, BR-05, BR-08) — 100% SQLite API. */
'use strict';

function orderTable(orders, compact = false) {
  return table(
    compact
      ? ['Mã đơn', 'Khách hàng', 'Tổng tiền', 'Trạng thái', '']
      : [
          'Mã hóa đơn',
          'Khách hàng',
          'Thu ngân',
          'Thời gian',
          'Thanh toán',
          'Tổng thanh toán',
          'Trạng thái',
          'Thao tác',
        ],
    (orders || []).map((o) => {
      const cust = o.customerName ?? o.customer ?? 'Khách lẻ';
      const cashier = o.cashierName ?? o.staffName ?? '—';
      const ts = o.createdAt ?? o.time;
      const pm = o.paymentMethod ?? o.payment ?? 'CASH';
      const total = o.totalAmount ?? o.total ?? 0;
      return `<tr>
        <td class="name"><button type="button" class="text-link" data-action="order-detail" data-id="${e(o.id)}"><code>${e(o.id)}</code></button></td>
        <td>${e(cust)}${o.customerPhone ? `<div class="sub">${e(o.customerPhone)}</div>` : ''}</td>
        ${compact ? '' : `<td>${e(cashier)}</td><td>${date(ts)}</td><td>${e(METHODS[pm] || o.paymentMethodLabel || pm)}</td>`}
        <td class="money name">${money(total)}${o.refundedAmount > 0 ? `<div class="sub negative">Hoàn: −${money(o.refundedAmount)}</div>` : ''}</td>
        <td>${status(o.status)}</td>
        <td>
          <div class="action-group">
            ${ib('order-detail', 'eye', 'Xem hóa đơn', `data-id="${e(o.id)}"`)}
            ${compact ? '' : ib('print-invoice', 'print', 'In / Lưu PDF', `data-id="${e(o.id)}"`)}
          </div>
        </td>
      </tr>`;
    }),
  );
}

function ordersView() {
  if (!apiState.ordersLoaded && !apiState.loading.orders) {
    loadOrdersData();
  }
  const summary = apiState.ordersSummary || {};
  const list = apiState.orders || [];
  const p = paginate(list, 'orders');

  return (
    heading(
      'BÁN HÀNG / ĐƠN HÀNG',
      'Lịch sử hóa đơn bán hàng',
      'Tra cứu hóa đơn đã đóng băng giá (Price Snapshot), xem chi tiết, in/tải PDF và theo dõi tình trạng hoàn trả.',
      action('export-orders', 'Xuất CSV', 'download'),
    ) +
    stats([
      ['Tổng hóa đơn', number(summary.total || 0), 'Đồng bộ từ CSDL SQLite', 'receipt'],
      ['Đã thanh toán', number(summary.paidCount || 0), 'Hoàn tất, chưa phát sinh trả hàng', 'check'],
      ['Có hoàn trả', number(summary.returnedCount || 0), 'Trả một phần hoặc hoàn trả toàn bộ', 'return'],
      [
        'Doanh thu ròng (BR-08)',
        money(summary.netRevenue || 0),
        `Gộp ${money(summary.grossRevenue || 0)} − Hoàn ${money(summary.refundedTotal || 0)}`,
        'cash',
      ],
    ]) +
    `<section class="panel">
      <div class="panel-head">
        <div>
          <h2>Danh sách hóa đơn (${number(list.length)})</h2>
          <p class="sub">Hóa đơn đã thanh toán được khóa bất biến (BR-05): cấm thanh toán lặp, cấm sửa hoặc xóa.</p>
        </div>
      </div>
      <div class="table-tools wrap">
        ${filterInput('orders', 'Tìm mã hóa đơn, khách hàng, SĐT, thu ngân, mã KM…')}
        ${filterSelect('orderStatus', [
          ['', 'Tất cả trạng thái'],
          ['DaThanhToan', 'Đã thanh toán'],
          ['TraMotPhan', 'Trả một phần'],
          ['DaHoanTra', 'Đã hoàn trả'],
        ])}
        ${filterSelect('orderPayment', [
          ['', 'Tất cả thanh toán'],
          ['CASH', 'Tiền mặt'],
          ['VIETQR', 'Chuyển khoản / VietQR'],
          ['CARD', 'Thẻ ngân hàng'],
        ])}
        <label class="date-filter">Từ <input type="date" id="filter-orderFrom" data-filter="orderFrom" value="${e(filters.orderFrom || '')}"></label>
        <label class="date-filter">Đến <input type="date" id="filter-orderTo" data-filter="orderTo" value="${e(filters.orderTo || '')}"></label>
        ${action('orders-reset', 'Đặt lại', 'return', 'small')}
      </div>
      ${
        apiState.orderError
          ? `<div class="panel-body"><div class="note red" role="alert">${e(apiState.orderError)}</div></div>`
          : apiState.loading.orders && !apiState.ordersLoaded
            ? '<div class="panel-body"><div class="note">Đang tải danh sách hóa đơn từ SQLite…</div></div>'
            : orderTable(p.items) + p.foot
      }
    </section>`
  );
}

function receiptHTML(o) {
  const st = o.store || store.data.settings || {};
  const pm = o.paymentMethod ?? o.payment ?? 'CASH';
  const subtotal = Number(o.subtotal || 0);
  const invoiceDiscount = Number(o.invoiceDiscount ?? o.discount ?? 0);
  const afterDiscount = Math.max(0, subtotal - invoiceDiscount);
  const taxRate = Number(o.taxRate ?? 0);
  const taxAmount = Number(o.taxAmount ?? o.tax ?? 0);
  const totalAmount = Number(o.totalAmount ?? o.total ?? 0);
  const cashReceived = Number(o.cashReceived ?? o.received ?? totalAmount);
  const cashChange = Number(o.cashChange ?? o.change ?? 0);
  const refundedAmount = Number(o.refundedAmount || 0);
  const netAmount = Math.max(0, totalAmount - refundedAmount);
  const items = o.items || [];

  return `<article class="receipt">
    <div class="receipt-head">
      <h2>${e(st.name || 'RetailFlow Mart')}</h2>
      <p>${e(st.address || '')}</p>
      <p>Hotline: ${e(st.phone || '')}</p>
      <h3>HÓA ĐƠN BÁN HÀNG</h3>
      <p><strong>${e(o.id)}</strong> · ${date(o.createdAt || o.time)} · ${status(o.status)}</p>
    </div>
    <div class="detail-grid">
      <div>
        Khách hàng: <strong>${e(o.customerName || o.customer || 'Khách lẻ')}</strong>${o.customerPhone ? ` (${e(o.customerPhone)})` : ''}<br>
        Thu ngân: <strong>${e(o.cashierName || o.staffName || '—')}</strong>
      </div>
      <div>
        Thanh toán: <strong>${e(METHODS[pm] || o.paymentMethodLabel || pm)}</strong><br>
        ${o.paymentRef ? `Mã tham chiếu: <code>${e(o.paymentRef)}</code>` : 'Thanh toán trực tiếp tại quầy'}
      </div>
    </div>
    ${table(
      ['Sản phẩm (Giá đóng băng)', 'SL', 'Đơn giá', 'Thành tiền'],
      items.map((i) => {
        const name = i.productName || i.name || '';
        const unitPrice = Number(i.unitPrice ?? i.price ?? 0);
        const lineTotal = Number(i.lineTotal ?? i.qty * unitPrice);
        return `<tr>
          <td>
            <strong>${e(name)}</strong>
            ${i.sku ? `<div class="sub"><code>${e(i.sku)}</code></div>` : ''}
            ${i.returnedQty ? `<div class="negative">Đã hoàn trả ${i.returnedQty}/${i.qty}</div>` : ''}
          </td>
          <td>${number(i.qty)}</td>
          <td class="money">${money(unitPrice)}</td>
          <td class="money right">${money(lineTotal)}</td>
        </tr>`;
      }),
    )}
    <div class="receipt-total">
      <div class="between"><span>1. Tạm tính</span><span class="money">${money(subtotal)}</span></div>
      ${
        invoiceDiscount > 0
          ? `<div class="between positive"><span>2. Giảm giá hóa đơn ${o.promotionCode ? `(${e(o.promotionCode)})` : ''}</span><span class="money">− ${money(invoiceDiscount)}</span></div>`
          : ''
      }
      <div class="between"><span>3. Tiền sau giảm</span><span class="money">${money(afterDiscount)}</span></div>
      <div class="between"><span>4. Thuế VAT (${taxRate}%)</span><span class="money">${money(taxAmount)}</span></div>
      <div class="between grand"><span>5. Tổng thanh toán</span><span class="money">${money(totalAmount)}</span></div>
      <div class="between"><span>Khách đưa / Đã nhận</span><span class="money">${money(cashReceived)}</span></div>
      <div class="between"><span>Tiền thối lại</span><span class="money">${money(cashChange)}</span></div>
      ${
        refundedAmount > 0
          ? `<div class="between negative"><span>Đã hoàn tiền (Phiếu trả đã duyệt)</span><span class="money">− ${money(refundedAmount)}</span></div>
             <div class="between"><strong>Giá trị thực thu còn lại</strong><strong class="money">${money(netAmount)}</strong></div>`
          : ''
      }
    </div>
    ${o.note ? `<p class="sub">Ghi chú: ${e(o.note)}</p>` : ''}
    <div class="receipt-foot">
      ${e(st.receiptNote || 'Cảm ơn quý khách đã mua sắm tại RetailFlow!')}
      <br>Đơn giá bán trên hóa đơn đã đóng băng theo thời điểm phát hành (BR-03).
    </div>
  </article>`;
}

async function orderDetail(orderId) {
  try {
    const res = await api.getOrder(orderId);
    const o = res.item;
    if (!o) throw new Error('Không tìm thấy hóa đơn.');
    modalContext = { type: 'order', id: o.id, order: o };
    const canReturn =
      store.hasPermission('RETURN_CREATE') &&
      ['DaThanhToan', 'TraMotPhan'].includes(o.status) &&
      (o.items || []).some((i) => Number(i.returnableQty) > 0);
    const returnsList = o.returns || [];

    showModal(
      `Chi tiết hóa đơn · ${e(o.id)}`,
      `<div class="modal-content">
        ${receiptHTML(o)}
        ${
          returnsList.length
            ? `<div class="mt16">
                <h3>Lịch sử yêu cầu trả hàng (${returnsList.length})</h3>
                ${returnsList
                  .map(
                    (r) => `<div class="activity">
                      <i class="dot"></i>
                      <div>
                        <p>
                          <button type="button" class="text-link" data-action="return-detail" data-id="${e(r.id)}"><code>${e(r.id)}</code></button>
                          · ${status(r.status)} · <strong class="money">${money(r.refundAmount)}</strong>
                        </p>
                        <small>${date(r.createdAt)} · ${e(r.reason)} · Lập bởi ${e(r.createdByName || '—')}</small>
                      </div>
                    </div>`,
                  )
                  .join('')}
              </div>`
            : ''
        }
      </div>
      <div class="modal-footer wrap">
        ${canReturn ? action('return-new', 'Lập phiếu trả hàng', 'return', '', `data-id="${e(o.id)}"`) : ''}
        ${action('download-invoice', 'Tải hóa đơn', 'download', '', `data-id="${e(o.id)}"`)}
        ${action('print-invoice', 'In / Lưu PDF', 'print', 'primary', `data-id="${e(o.id)}"`)}
        ${action('close-modal', 'Đóng')}
      </div>`,
      true,
    );
  } catch (err) {
    notify(err.message, true);
  }
}

async function printInvoice(orderId) {
  try {
    const o =
      modalContext.order && modalContext.order.id === orderId
        ? modalContext.order
        : (await api.getOrder(orderId)).item;
    if (!o) throw new Error('Không tìm thấy hóa đơn để in.');
    $('#print-area').innerHTML = receiptHTML(o);
    window.print();
  } catch (err) {
    notify(err.message, true);
  }
}

async function invoiceDownload(orderId) {
  try {
    const o =
      modalContext.order && modalContext.order.id === orderId
        ? modalContext.order
        : (await api.getOrder(orderId)).item;
    if (!o) throw new Error('Không tìm thấy hóa đơn để tải.');
    const html = `<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Hoa don ${e(o.id)}</title><style>body{max-width:720px;margin:40px auto;padding:20px;font-family:Arial,sans-serif;font-size:13px;color:#26354c}.receipt-head,.receipt-foot{text-align:center}.receipt-head{margin-bottom:24px}.detail-grid{display:flex;justify-content:space-between;gap:20px;margin:20px 0}table{border-collapse:collapse;width:100%}td,th{padding:10px 6px;border-bottom:1px solid #e5e7eb;text-align:left}.money,.right{text-align:right;font-variant-numeric:tabular-nums}.between{display:flex;justify-content:space-between;gap:24px;margin-top:8px}.receipt-total{margin:24px 0}.grand{font-size:18px;font-weight:700}.positive{color:#059669}.negative{color:#dc2626}.sub,.receipt-foot{font-size:11px;color:#64748b}.receipt-foot{margin-top:28px}@media print{body{margin:0}}</style>${receiptHTML(o)}</html>`;
    download(html, `${o.id}.html`, 'text/html;charset=utf-8');
    notify(`Đã tải hóa đơn ${o.id}. Mở tệp để xem hoặc lưu PDF.`);
  } catch (err) {
    notify(err.message, true);
  }
}
