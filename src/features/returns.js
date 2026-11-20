/* M4: Trả hàng & Hoàn tiền (BR-05, BR-06, BR-08) — 100% SQLite API + RBAC 3 lớp. */
'use strict';

function returnsView() {
  if (!apiState.returnsLoaded && !apiState.loading.returns) {
    loadReturnsData();
  }
  const summary = apiState.returnsSummary || {};
  const list = apiState.returns || [];
  const p = paginate(list, 'returns');
  const canCreate = store.hasPermission('RETURN_CREATE');
  const canApprove = store.hasPermission('RETURN_APPROVE');
  const returnDays = Number(store.data.settings.returnWindowDays || 7);

  return (
    heading(
      'BÁN HÀNG / ĐỔI TRẢ',
      'Trả hàng & hoàn tiền',
      `Cho phép lập phiếu trả hàng cho hóa đơn Đã thanh toán trong hạn ${returnDays} ngày (đọc từ THAM_SO). Duyệt hoàn tiền do Quản lý/Admin xác nhận trong 1 Transaction.`,
      canCreate ? action('return-new', 'Tạo phiếu trả hàng', 'plus', 'primary') : '',
    ) +
    stats([
      ['Tổng phiếu trả', number(summary.total || 0), 'Đồng bộ từ CSDL SQLite', 'return'],
      ['Chờ duyệt', number(summary.pendingCount || 0), 'Chưa hoàn tồn kho / chưa tính hoàn tiền', 'bell'],
      ['Đã xác nhận', number(summary.approvedCount || 0), 'Đã hoàn tiền & ghi Thẻ kho TRA_HANG', 'check'],
      [
        'Tổng tiền đã hoàn',
        money(summary.totalRefunded || 0),
        'Chỉ tính phiếu ở trạng thái Đã xác nhận',
        'receipt',
      ],
    ]) +
    `<section class="panel">
      <div class="panel-head">
        <div>
          <h2>Lịch sử phiếu trả hàng (${number(list.length)})</h2>
          <p class="sub">${
            canApprove
              ? 'Bạn có quyền phê duyệt / từ chối phiếu trả hàng ở trạng thái Chờ duyệt.'
              : 'Thu ngân được lập phiếu trả hàng trong hạn; thao tác Duyệt hoàn tiền thuộc quyền Quản lý / Admin.'
          }</p>
        </div>
      </div>
      <div class="table-tools wrap">
        ${filterInput('returns', 'Tìm mã phiếu trả, mã hóa đơn gốc, khách hàng, lý do…')}
        ${filterSelect('returnStatus', [
          ['', 'Tất cả trạng thái'],
          ['ChoDuyet', 'Chờ duyệt'],
          ['DaXacNhan', 'Đã xác nhận'],
          ['TuChoi', 'Đã từ chối'],
        ])}
        <label class="date-filter">Từ <input type="date" id="filter-returnFrom" data-filter="returnFrom" value="${e(filters.returnFrom || '')}"></label>
        <label class="date-filter">Đến <input type="date" id="filter-returnTo" data-filter="returnTo" value="${e(filters.returnTo || '')}"></label>
        ${action('returns-reset', 'Đặt lại', 'return', 'small')}
      </div>
      ${
        apiState.returnError
          ? `<div class="panel-body"><div class="note red" role="alert">${e(apiState.returnError)}</div></div>`
          : apiState.loading.returns && !apiState.returnsLoaded
            ? '<div class="panel-body"><div class="note">Đang tải danh sách phiếu trả hàng…</div></div>'
            : table(
                ['Mã phiếu', 'Hóa đơn gốc', 'Khách hàng', 'Thời gian lập', 'Lý do', 'Tình trạng hàng', 'Tiền hoàn', 'Trạng thái', 'Thao tác'],
                p.items.map((item) => {
                  const condBadge = item.restock
                    ? badge('Nguyên vẹn (Hoàn kho)', 'green')
                    : badge('Lỗi / Hỏng (Không hoàn kho)', 'red');
                  return `<tr>
                    <td class="name"><code>${e(item.id)}</code></td>
                    <td><button type="button" class="text-link" data-action="order-detail" data-id="${e(item.orderId)}"><code>${e(item.orderId)}</code></button></td>
                    <td>${e(item.customerName || 'Khách lẻ')}</td>
                    <td>${date(item.createdAt)}</td>
                    <td class="wrap-cell">${e(item.reason)}</td>
                    <td>${condBadge}</td>
                    <td class="money name">${money(item.refundAmount)}</td>
                    <td>${status(item.status)}</td>
                    <td>${action('return-detail', 'Xem', 'eye', 'small', `data-id="${e(item.id)}"`)}</td>
                  </tr>`;
                }),
              ) + p.foot
      }
      <div class="panel-body">
        <div class="note yellow">
          <strong>Quy tắc BR-05 &amp; BR-06:</strong> Phiếu ở trạng thái <em>Chờ duyệt</em> chưa cộng tồn kho và chưa trừ doanh thu ròng. Khi Quản lý / Admin bấm <strong>Xác nhận hoàn tiền</strong>, hệ thống cộng hoàn tồn kho (nếu hàng nguyên vẹn) + ghi Thẻ kho <code>TRA_HANG</code> + cập nhật trạng thái hóa đơn trong <strong>1 Transaction nguyên tử</strong>.
        </div>
      </div>
    </section>`
  );
}

function returnModal(orderId = '') {
  if (!store.hasPermission('RETURN_CREATE')) {
    notify('Bạn không có quyền lập phiếu trả hàng (RETURN_CREATE).', true);
    return;
  }
  const returnDays = Number(store.data.settings.returnWindowDays || 7);
  modalContext = { type: 'return', orderId: '', order: null };
  showModal(
    'Lập phiếu trả hàng trong hạn (BR-05)',
    `<form id="return-form">
      <div class="modal-content stack">
        <div class="row gap8">
          <input id="return-order-search" name="orderId" placeholder="Nhập mã hóa đơn gốc (VD: HD0001)…" value="${e(orderId)}" required aria-label="Mã hóa đơn gốc" style="flex:1;height:40px;padding:0 12px;border:1px solid #d1d5db;border-radius:8px;text-transform:uppercase">
          ${action('return-search', 'Tra cứu hóa đơn', 'search', 'primary')}
        </div>
        <div id="return-items">
          <div class="note">Nhập mã hóa đơn gốc đã thanh toán (trong hạn ${returnDays} ngày) và bấm <strong>Tra cứu hóa đơn</strong> để chọn sản phẩm cần trả.</div>
        </div>
        ${textField('Lý do trả hàng (*)', 'reason', '', 'required minlength="3" maxlength="300" placeholder="VD: Khách đổi ý, bao bì nguyên vẹn hoặc sản phẩm lỗi…"')}
        <div class="field full">
          <span>Phân loại tình trạng hàng trả (*):</span>
          <div class="row gap16 mt8 wrap">
            <label class="check-label">
              <input type="radio" name="restock" value="good_restock" checked>
              <span><strong>Hàng nguyên vẹn:</strong> Cộng hoàn lại tồn kho bán &amp; ghi Thẻ kho <code>TRA_HANG</code></span>
            </label>
            <label class="check-label">
              <input type="radio" name="restock" value="damaged_or_expired">
              <span><strong>Hàng lỗi / Hư hỏng:</strong> Không cộng lại tồn kho bán</span>
            </label>
          </div>
        </div>
        ${formError()}
      </div>
      <div class="modal-footer">
        ${action('close-modal', 'Hủy')}
        <button class="btn primary" type="submit">${icon('check')}Gửi phiếu trả hàng</button>
      </div>
    </form>`,
    true,
  );
  if (orderId) {
    searchReturn();
  }
}

async function searchReturn() {
  const input = $('#return-order-search');
  const box = $('#return-items');
  const errBox = $('#form-error', $('#return-form'));
  if (!input || !box) return;
  const code = input.value.trim().toUpperCase();
  if (!code) {
    if (errBox) errBox.textContent = 'Vui lòng nhập mã hóa đơn gốc cần tra cứu.';
    return;
  }
  if (errBox) errBox.textContent = '';
  box.innerHTML = '<div class="note">Đang tra cứu hóa đơn từ CSDL SQLite…</div>';
  try {
    const res = await api.getOrder(code);
    const o = res.item;
    if (!['DaThanhToan', 'TraMotPhan'].includes(o.status)) {
      throw new Error(`Hóa đơn ${o.id} ở trạng thái "${o.statusLabel}", không còn hàng hợp lệ để trả.`);
    }
    const returnDays = Number(store.data.settings.returnWindowDays || 7);
    const elapsedDays = (Date.now() - new Date(o.createdAt).getTime()) / 86400000;
    if (elapsedDays > returnDays) {
      throw new Error(
        `Hóa đơn ${o.id} đã quá hạn trả hàng ${returnDays} ngày (đã qua ${Math.floor(elapsedDays)} ngày theo THAM_SO) (BR-05).`,
      );
    }
    modalContext.orderId = o.id;
    modalContext.order = o;
    input.value = o.id;

    box.innerHTML = `<div class="note green mb16">
      <strong>${e(o.id)}</strong> · Khách hàng: <strong>${e(o.customerName)}</strong> · ${date(o.createdAt)} · ${badge(METHODS[o.paymentMethod] || o.paymentMethod, 'blue')}<br>
      Tổng hóa đơn: <strong class="money">${money(o.totalAmount)}</strong> (đã gồm KM/Voucher &amp; VAT ${o.taxRate}%) · Còn lại tối đa ${Math.max(0, Math.ceil(returnDays - elapsedDays))} ngày trong hạn trả.
    </div>
    ${table(
      ['Sản phẩm', 'Đơn giá gốc', 'Đã mua', 'Đã trả / Chờ duyệt', 'Có thể trả', 'SL trả'],
      (o.items || []).map((i) => {
        const isNonReturnable = Boolean(i.nonReturnable);
        const available = isNonReturnable ? 0 : Number(i.returnableQty) || 0;
        return `<tr>
          <td class="name">
            ${e(i.productName)}
            <div class="sub"><code>${e(i.sku)}</code> ${isNonReturnable ? badge('Không áp dụng đổi trả (hàng tươi/đông lạnh)', 'red') : ''}</div>
          </td>
          <td class="money">${money(i.unitPrice)}</td>
          <td>${number(i.qty)}</td>
          <td>${number(i.returnedQty)}${i.pendingReturnQty ? ` (+${number(i.pendingReturnQty)} chờ duyệt)` : ''}</td>
          <td><strong>${number(available)}</strong></td>
          <td>
            <input class="return-qty" type="number" data-return-id="${e(i.productId)}" min="0" max="${available}" step="1" value="0" ${
              available
                ? ''
                : `disabled title="${isNonReturnable ? 'Mặt hàng tươi sống/đông lạnh không áp dụng đổi trả' : 'Không còn số lượng có thể trả'}"`
            } aria-label="Số lượng trả ${e(i.productName)}">
          </td>
        </tr>`;
      }),
    )}`;
  } catch (err) {
    modalContext.orderId = '';
    modalContext.order = null;
    box.innerHTML = `<div class="note red" role="alert">${e(err.message)}</div>`;
  }
}

async function returnDetail(returnId) {
  try {
    const res = await api.getReturn(returnId);
    const r = res.item;
    if (!r) throw new Error('Không tìm thấy phiếu trả hàng.');
    const canApprove = store.hasPermission('RETURN_APPROVE');
    modalContext = { type: 'return-detail', id: r.id, item: r };

    showModal(
      `Chi tiết phiếu trả hàng · ${e(r.id)}`,
      `<div class="modal-content">
        <div class="detail-grid">
          <div><small>Mã phiếu trả</small><strong><code>${e(r.id)}</code></strong></div>
          <div><small>Hóa đơn gốc</small><strong><code>${e(r.orderId)}</code></strong></div>
          <div><small>Khách hàng</small><strong>${e(r.customerName)}</strong></div>
          <div><small>Trạng thái</small>${status(r.status)}</div>
        </div>
        ${table(
          ['SKU', 'Sản phẩm', 'SL trả / Đã mua', 'Đơn giá gốc', 'Tiền hoàn dòng'],
          (r.items || []).map(
            (i) => `<tr>
              <td><code>${e(i.sku)}</code></td>
              <td class="name">${e(i.productName)}</td>
              <td><strong>${number(i.qty)}</strong> / ${number(i.purchasedQty)} ${e(i.unitName || '')}</td>
              <td class="money">${money(i.unitPriceSnapshot)}</td>
              <td class="money name">${money(i.refundLineAmount)}</td>
            </tr>`,
          ),
        )}
        <div class="stack mt16">
          <div class="between">
            <strong>${r.status === 'DaXacNhan' ? 'Tổng tiền đã hoàn' : 'Tổng tiền hoàn dự kiến'}:</strong>
            <strong class="money" style="font-size:18px;color:#0f766e">${money(r.refundAmount)}</strong>
          </div>
          <p class="sub">
            Lý do: <strong>${e(r.reason)}</strong><br>
            Tình trạng hàng trả: <strong>${r.restock ? 'Hàng nguyên vẹn (Cộng hoàn tồn kho & ghi Thẻ kho TRA_HANG)' : 'Hàng lỗi / Hư hỏng (Không cộng tồn kho bán)'}</strong><br>
            Phương thức thanh toán gốc: ${e(METHODS[r.orderPaymentMethod] || r.orderPaymentMethod)}<br>
            Người lập: ${e(r.createdByName || '—')} · ${date(r.createdAt)}
            ${r.resolvedAt ? `<br>Người xử lý: ${e(r.approvedByName || '—')} · ${date(r.resolvedAt)}` : ''}
          </p>
          ${
            r.status === 'ChoDuyet'
              ? `<div class="note yellow">
                  ${
                    canApprove
                      ? 'Kiểm tra tình trạng hàng thực nhận trước khi duyệt. Thao tác Xác nhận sẽ cập nhật tồn kho, Thẻ kho và tiền hoàn trong 1 Transaction nguyên tử.'
                      : 'Phiếu đang chờ Quản lý cửa hàng hoặc Quản trị viên phê duyệt hoàn tiền.'
                  }
                </div>`
              : ''
          }
        </div>
      </div>
      <div class="modal-footer wrap">
        ${action('order-detail', 'Xem hóa đơn gốc', 'receipt', '', `data-id="${e(r.orderId)}"`)}
        ${
          r.status === 'ChoDuyet' && canApprove
            ? action('return-reject', 'Từ chối', 'close', 'danger', `data-id="${e(r.id)}"`) +
              action('return-approve', 'Xác nhận hoàn tiền', 'check', 'teal', `data-id="${e(r.id)}"`)
            : ''
        }
        ${action('close-modal', 'Đóng')}
      </div>`,
      true,
    );
  } catch (err) {
    notify(err.message, true);
  }
}
