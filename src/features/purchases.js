function purchasesView() {
  const s = store.data,
    p = paginate(
      s.purchases.filter(
        (p) =>
          match(`${p.id} ${p.supplier}`, filters.purchases || '') &&
          (!filters.status || p.status === filters.status),
      ),
      'purchases',
    );
  return (
    heading(
      'KHO HÀNG / NHẬP HÀNG',
      'Quản lý nhập hàng',
      'Lập phiếu nhập, kiểm tra hàng thực nhận và cập nhật tồn kho.',
      action('purchase-new', 'Tạo phiếu nhập', 'plus', 'primary'),
    ) +
    stats([
      ['Phiếu nhập', s.purchases.length, 'Tất cả phiếu đã lập', 'receipt'],
      [
        'Đã nhập kho',
        s.purchases.filter((p) => p.status === 'received').length,
        'Đã cộng số lượng vào kho',
        'check',
      ],
      [
        'Đang chờ nhận',
        s.purchases.filter((p) => p.status === 'pending').length,
        'Chưa ảnh hưởng tồn kho',
        'truck',
      ],
      [
        'Phiếu nháp',
        s.purchases.filter((p) => p.status === 'draft').length,
        'Có thể gửi xác nhận',
        'box',
      ],
    ]) +
    restockSuggestionsHTML() +
    `<section class="panel"><div class="panel-head"><h2>Danh sách phiếu nhập</h2></div><div class="table-tools">${filterInput('purchases', 'Tìm mã phiếu, nhà cung cấp…')}${filterSelect('status', [['', 'Tất cả trạng thái'], ...['draft', 'pending', 'received', 'cancelled'].map((x) => [x, statusLabels[x][0]])])}</div>${table(
      ['Mã phiếu', 'Nhà cung cấp', 'Ngày lập', 'Số mặt hàng', 'Tổng tiền', 'Trạng thái', ''],
      p.items.map(
        (p) =>
          `<tr><td class="name">${e(p.id)}</td><td>${e(p.supplier)}</td><td>${date(p.time)}</td><td>${p.items.length}</td><td class="money">${money(p.total)}</td><td>${status(p.status)}</td><td>${action('purchase-detail', 'Xem', '', 'small', `data-id="${e(p.id)}"`)}</td></tr>`,
      ),
    )}${p.foot}</section><div class="note mt16">Phiếu nháp và phiếu chờ nhận chưa làm tăng tồn kho. Chỉ thao tác “Xác nhận nhập kho” mới cập nhật số lượng và giá vốn.</div>`
  );
}

function purchaseModal(productId = '') {
  store.require('purchases');
  purchaseLines = [];
  modalContext = { type: 'purchase' };
  const suppliers = store.data.suppliers.filter((s) => s.active);
  const chosen = store.data.products.find((p) => p.id === productId && p.active);
  if (productId && (!chosen || !suppliers.some((s) => s.id === chosen.supplierId)))
    throw new Error('Mặt hàng hoặc nhà cung cấp không còn hoạt động.');
  showModal(
    'Tạo phiếu nhập hàng',
    `<form id="purchase-form"><div class="modal-content stack">${selectField(
      'Nhà cung cấp',
      'supplierId',
      suppliers.map((s) => [s.id, s.name]),
      chosen?.supplierId || suppliers[0]?.id,
      'id="purchase-supplier" required',
    )}<div id="purchase-restock-suggestions"></div><div class="form-grid">${selectField('Sản phẩm', 'productId', [], '', 'id="purchase-product"', true)}${field('Số lượng nhập', 'qty', 1, 'number', 'id="purchase-qty" min="1" step="1"')}${field('Đơn giá nhập (₫)', 'price', 0, 'number', 'id="purchase-price" min="0" step="1"')}</div>${action('purchase-line-add', 'Thêm mặt hàng', 'plus', 'small')}<div id="purchase-lines"></div>${textField('Ghi chú', 'note')}${selectField(
      'Trạng thái lập phiếu',
      'status',
      [
        ['pending', 'Gửi phiếu chờ nhận hàng'],
        ['draft', 'Lưu bản nháp'],
      ],
      'pending',
    )}${formError()}</div>${foot('Lưu phiếu nhập')}</form>`,
    true,
  );
  updatePurchaseOptions();
  if (chosen) addSuggestedPurchase(chosen.id);
}

function updatePurchaseOptions() {
  const sid = $('#purchase-supplier').value;
  const products = store.data.products.filter((p) => p.active && p.supplierId === sid);
  $('#purchase-product').innerHTML = products
    .map((p) => `<option value="${e(p.id)}">${e(p.name)} · Tồn ${p.stock}</option>`)
    .join('');
  $('#purchase-price').value = products[0]?.cost || 0;
  purchaseLines = [];
  renderPurchaseLines();
}

function renderPurchaseLines() {
  $('#purchase-lines').innerHTML =
    table(
      ['Mặt hàng', 'SL', 'Đơn giá', 'Thành tiền', ''],
      purchaseLines.map(
        (i, index) =>
          `<tr><td>${e(i.name)}</td><td><input class="purchase-line-input" type="number" min="1" step="1" required value="${i.qty}" data-purchase-field="qty" data-index="${index}" aria-label="Số lượng nhập ${e(i.name)}"></td><td><input class="purchase-line-input purchase-line-price" type="number" min="0" step="1" required value="${i.price}" data-purchase-field="price" data-index="${index}" aria-label="Giá nhập ${e(i.name)}"></td><td>${money(i.price * i.qty)}</td><td>${ib('purchase-line-delete', 'trash', 'Xóa mặt hàng', `data-index="${index}"`)}</td></tr>`,
      ),
    ) +
    `<div class="right mt16"><strong>Tổng nhập: ${money(purchaseLines.reduce((s, i) => s + i.qty * i.price, 0))}</strong></div>`;
  renderSupplierRestockSuggestions();
}

function purchaseDetail(purchaseId) {
  const p = store.data.purchases.find((p) => p.id === purchaseId);
  if (!p) throw new Error('Không tìm thấy phiếu nhập.');
  showModal(
    'Chi tiết phiếu nhập',
    `<div class="modal-content"><div class="detail-grid"><div><small>Mã phiếu</small><strong>${e(p.id)}</strong></div><div><small>Trạng thái</small>${status(p.status)}</div><div><small>Nhà cung cấp</small><strong>${e(p.supplier)}</strong></div><div><small>Ngày lập</small><strong>${date(p.time)}</strong></div></div>${table(
      ['Sản phẩm', 'SL', 'Giá nhập', 'Thành tiền'],
      p.items.map(
        (i) =>
          `<tr><td>${e(i.name)}</td><td>${i.qty}</td><td>${money(i.price)}</td><td>${money(i.qty * i.price)}</td></tr>`,
      ),
    )}<div class="right mt16"><strong>Tổng tiền: ${money(p.total)}</strong></div><p class="sub">${e(p.note || 'Không có ghi chú')}${p.receivedAt ? `<br>Nhập kho lúc ${date(p.receivedAt)} bởi ${e(p.receiver)}` : ''}</p></div><div class="modal-footer">${['draft', 'pending'].includes(p.status) ? action('purchase-cancel', 'Hủy phiếu', '', 'danger', `data-id="${e(p.id)}"`) : ''}${p.status === 'draft' ? action('purchase-send', 'Gửi chờ nhận', 'truck', 'primary', `data-id="${e(p.id)}"`) : p.status === 'pending' ? action('purchase-receive', 'Xác nhận nhập kho', 'check', 'teal', `data-id="${e(p.id)}"`) : action('close-modal', 'Đóng')}</div>`,
    true,
  );
}
