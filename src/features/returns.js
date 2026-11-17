function returnsView() {
  const s = store.data,
    r = s.returns;
  const p = paginate(
    r.filter(
      (r) =>
        match(`${r.id} ${r.orderId} ${r.reason}`, filters.returns || '') &&
        (!filters.status || r.status === filters.status),
    ),
    'returns',
  );
  return (
    heading(
      'BÁN HÀNG / ĐỔI TRẢ',
      'Đổi trả & hoàn tiền',
      'Quy trình đổi trả CVS: Phân loại hàng nguyên tem nhập lại kho và hàng lỗi/hết date đưa vào kho chờ hủy.',
      action('return-new', 'Tạo yêu cầu đổi trả', 'plus', 'primary'),
    ) +
    stats([
      ['Yêu cầu đổi trả', r.length, 'Đã tiếp nhận', 'return'],
      [
        'Đã giải quyết',
        r.filter((r) => r.status === 'approved').length,
        'Đã ghi nhận hoàn tiền',
        'check',
      ],
      [
        'Chờ phê duyệt',
        r.filter((r) => r.status === 'pending').length,
        'Quản trị viên cần xác nhận',
        'bell',
      ],
      [
        'Tổng tiền hoàn',
        money(r.filter((r) => r.status === 'approved').reduce((a, r) => a + r.amount, 0)),
        'Chỉ tính phiếu đã duyệt',
        'receipt',
      ],
    ]) +
    `<section class="panel"><div class="panel-head"><h2>Lịch sử yêu cầu trả hàng</h2></div><div class="table-tools">${filterInput('returns', 'Tìm mã phiếu, hóa đơn gốc, lý do…')}${filterSelect('status', [['', 'Tất cả trạng thái'], ...['pending', 'approved', 'rejected'].map((x) => [x, statusLabels[x][0]])])}</div>${table(
      ['Mã phiếu', 'Hóa đơn gốc', 'Ngày tạo', 'Lý do', 'Tình trạng hàng', 'Tiền hoàn', 'Trạng thái', ''],
      p.items.map((item) => {
        const isDamaged = item.returnCondition === 'damaged_or_expired' || item.restock === false;
        const condBadge = isDamaged
          ? '<span class="badge red">Hàng lỗi/Chờ hủy</span>'
          : '<span class="badge green">Nguyên tem (Nhập kho)</span>';
        return `<tr><td class="name">${e(item.id)}</td><td>${e(item.orderId)}</td><td>${date(item.time)}</td><td>${e(item.reason)}</td><td>${condBadge}</td><td class="money">${money(item.amount)}</td><td>${status(item.status)}</td><td>${action('return-detail', 'Xem', '', 'small', `data-id="${e(item.id)}"`)}</td></tr>`;
      }),
    )}${p.foot}<div class="panel-body"><div class="note yellow">Yêu cầu chờ duyệt chưa hoàn tiền và chưa cập nhật kho. Hàng nguyên vẹn mới được cộng lại vào tồn kho bán; hàng hỏng hoặc hết hạn sẽ được ghi nhận vào kho chờ hủy và tính vào chi phí hao hụt P&L.</div></div></section>`
  );
}

function returnModal(orderId = '') {
  store.require('returns');
  modalContext = { type: 'return', orderId };
  showModal(
    'Tạo yêu cầu trả hàng',
    `<form id="return-form"><div class="modal-content stack"><div class="row"><input id="return-order-search" name="orderId" placeholder="Nhập mã hóa đơn gốc…" value="${e(orderId)}" required aria-label="Mã hóa đơn gốc">${action('return-search', 'Tra cứu', 'search')}</div><div id="return-items"></div>${textField('Lý do trả hàng', 'reason')}<div class="field full"><span>Phân loại tình trạng hàng trả:</span><div class="row gap16 mt8"><label class="check-label"><input type="radio" name="restock" value="good_restock" checked> <span><strong>Nguyên vẹn:</strong> Đủ điều kiện nhập lại kho bán</span></label><label class="check-label"><input type="radio" name="restock" value="damaged_or_expired"> <span><strong>Lỗi / Hết date / Hư hỏng:</strong> Chuyển kho chờ hủy (không nhập lại kho bán)</span></label></div></div>${formError()}<div class="note">Chọn số lượng cần trả. Giá trị hoàn tiền được tính theo số tiền thực trả trên hóa đơn sau giảm giá và thuế.</div></div>${foot('Gửi yêu cầu trả hàng')}</form>`,
    true,
  );
  if (orderId) searchReturn();
}

function searchReturn() {
  const code = $('#return-order-search').value.trim();
  const o = store.data.orders.find((o) => o.id.toLowerCase() === code.toLowerCase());
  if (!o) throw new Error('Không tìm thấy hóa đơn. Kiểm tra lại mã trong lịch sử đơn hàng.');
  if (!['completed', 'partial'].includes(o.status))
    throw new Error('Hóa đơn này không còn hàng hợp lệ để trả.');
  modalContext.orderId = o.id;
  $('#return-items').innerHTML =
    `<div class="note mb16">${e(o.customer)} · ${date(o.time)} · ${METHODS[o.payment]}<br>Hóa đơn: <strong>${money(o.total)}</strong></div>${table(
      ['Sản phẩm', 'Đã mua', 'Đã trả', 'Có thể trả', 'SL yêu cầu'],
      o.items.map((i) => {
        const available = store.available(o.id, i.id);
        return `<tr><td class="name">${e(i.name)}</td><td>${i.qty}</td><td>${i.returnedQty}</td><td>${available}</td><td><input class="return-qty" type="number" data-return-id="${e(i.id)}" min="0" max="${available}" step="1" value="0" ${available ? '' : 'disabled'} aria-label="Số lượng trả ${e(i.name)}"></td></tr>`;
      }),
    )}`;
}

function returnDetail(returnId) {
  const r = store.data.returns.find((r) => r.id === returnId);
  if (!r) throw new Error('Phiếu trả không tồn tại.');
  const o = store.data.orders.find((o) => o.id === r.orderId);
  const estimate = r.items.reduce((a, item) => {
    const i = o.items.find((i) => i.id === item.id);
    return (
      a +
      Math.floor((i.paidTotal * (i.returnedQty + item.qty)) / i.qty) -
      Math.floor((i.paidTotal * i.returnedQty) / i.qty)
    );
  }, 0);
  const isDamaged = r.returnCondition === 'damaged_or_expired' || r.restock === false;
  showModal(
    'Chi tiết yêu cầu trả hàng',
    `<div class="modal-content"><div class="detail-grid"><div><small>Mã phiếu</small><strong>${e(r.id)}</strong></div><div><small>Hóa đơn gốc</small><strong>${e(r.orderId)}</strong></div><div><small>Khách hàng</small><strong>${e(o.customer)}</strong></div><div><small>Trạng thái</small>${status(r.status)}</div></div>${table(
      ['Sản phẩm', 'SL trả', 'Đơn giá gốc'],
      r.items.map(
        (i) => `<tr><td>${e(i.name)}</td><td>${i.qty}</td><td>${money(i.price)}</td></tr>`,
      ),
    )}<div class="stack mt16"><p><strong>${r.status === 'approved' ? 'Đã hoàn tiền' : 'Dự kiến hoàn'}: ${money(r.status === 'approved' ? r.amount : estimate)}</strong></p><p class="sub">Lý do: ${e(r.reason)}<br>Phân loại hàng trả: <strong>${isDamaged ? 'Hàng hỏng / hết date (Kho chờ hủy - Không cộng tồn bán)' : 'Hàng nguyên tem (Cộng lại kho bán)'}</strong><br>Phương thức hoàn: ${METHODS[r.payment]}<br>Người tạo: ${e(r.actor)} · ${date(r.time)}${r.resolvedAt ? `<br>Xử lý bởi ${e(r.approver)} · ${date(r.resolvedAt)}` : ''}</p>${r.status === 'pending' ? '<div class="note yellow">Trước khi phê duyệt, kiểm tra hàng thực nhận và thực hiện hoàn tiền cho khách bằng phương thức gốc. Ứng dụng ghi nhận kết quả thủ công.</div>' : ''}</div></div><div class="modal-footer">${action('order-detail', 'Xem hóa đơn gốc', 'receipt', '', `data-id="${e(o.id)}"`)}${r.status === 'pending' && store.user.role === 'ADMIN' ? action('return-reject', 'Từ chối', '', 'danger', `data-id="${e(r.id)}"`) + action('return-approve', 'Xác nhận đã hoàn tiền', 'check', 'teal', `data-id="${e(r.id)}"`) : ''}</div>`,
    true,
  );
}
