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
      'Quy trình nhập hàng tương tác 2 chiều (Cửa hàng ⇄ NCC), đàm phán số lượng và kiểm nhận GRN.',
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
        'Đang xử lý / Chờ nhận',
        s.purchases.filter((p) => ['pending', 'sent_to_supplier', 'supplier_responded', 'store_approved'].includes(p.status)).length,
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
    `<section class="panel"><div class="panel-head"><h2>Danh sách phiếu nhập hàng</h2></div><div class="table-tools wrap">${filterInput('purchases', 'Tìm mã phiếu, nhà cung cấp…')}${filterSelect('status', [['', 'Tất cả trạng thái'], ...['draft', 'pending', 'sent_to_supplier', 'supplier_responded', 'store_approved', 'received', 'cancelled'].map((x) => [x, statusLabels[x] ? statusLabels[x][0] : x])])}</div>${table(
      ['Mã phiếu', 'Nhà cung cấp', 'Ngày lập', 'Số mặt hàng', 'Tổng tiền', 'Trạng thái', ''],
      p.items.map(
        (p) =>
          `<tr><td class="name">${e(p.id)}</td><td>${e(p.supplier)}</td><td>${date(p.time)}</td><td>${p.items.length}</td><td class="money">${money(p.total)}</td><td>${status(p.status)}</td><td>${action('purchase-detail', 'Xem', '', 'small', `data-id="${e(p.id)}"`)}</td></tr>`,
      ),
    )}${p.foot}</section><div class="note mt16">Phiếu qua các bước: Gửi NCC → NCC phản hồi xác nhận → Cửa hàng duyệt → Kiểm nhận kho thực tế (GRN). Chỉ số lượng đạt chuẩn mới cộng vào tồn kho và cập nhật giá vốn.</div>`
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
    'Tạo phiếu đặt / nhập hàng',
    `<form id="purchase-form"><div class="modal-content stack">${selectField(
      'Nhà cung cấp',
      'supplierId',
      suppliers.map((s) => [s.id, s.name]),
      chosen?.supplierId || suppliers[0]?.id,
      'id="purchase-supplier" required',
    )}<div id="purchase-restock-suggestions"></div><div class="form-grid">${selectField('Sản phẩm', 'productId', [], '', 'id="purchase-product"', true)}${field('Số lượng nhập', 'qty', 1, 'number', 'id="purchase-qty" min="1" step="1"')}${field('Đơn giá nhập (₫)', 'price', 0, 'number', 'id="purchase-price" min="0" step="1"')}</div>${action('purchase-line-add', 'Thêm mặt hàng', 'plus', 'small')}<div id="purchase-lines"></div>${textField('Ghi chú', 'note')}${selectField(
      'Quy trình xử lý phiếu',
      'status',
      [
        ['pending', 'Gửi phiếu chờ nhận hàng trực tiếp'],
        ['sent_to_supplier', 'Gửi đơn đặt hàng tới NCC (Chờ NCC xác nhận)'],
        ['draft', 'Lưu bản nháp'],
      ],
      'pending',
    )}${formError()}</div>${foot('Lưu & Gửi phiếu nhập')}</form>`,
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
  $('#purchase-price').value = products[0]?.costPrice !== undefined ? products[0].costPrice : (products[0]?.cost || 0);
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
    'Chi tiết phiếu nhập hàng (PO)',
    `<div class="modal-content"><div class="detail-grid"><div><small>Mã phiếu</small><strong>${e(p.id)}</strong></div><div><small>Trạng thái</small>${status(p.status)}</div><div><small>Nhà cung cấp</small><strong>${e(p.supplier)}</strong></div><div><small>Ngày lập</small><strong>${date(p.time)}</strong></div></div>${table(
      ['Sản phẩm', 'SL Cửa hàng đặt', 'Giá dự kiến', 'NCC Xác nhận', 'Giá NCC báo', 'Thực nhận (GRN)'],
      p.items.map(
        (i) =>
          `<tr><td class="name">${e(i.name)}</td><td>${i.qty}</td><td>${money(i.price)}</td><td>${i.confirmedQty !== undefined ? `<strong class="${i.confirmedQty !== i.qty ? 'warning' : ''}">${i.confirmedQty}</strong>` : '<span class="muted">Chờ NCC</span>'}</td><td>${i.confirmedCost !== undefined ? `<span class="${i.confirmedCost !== i.price ? 'negative' : ''}">${money(i.confirmedCost)}</span>` : money(i.price)}</td><td>${i.acceptedQty !== undefined ? `<span class="positive"><strong>${i.acceptedQty}</strong></span>${i.rejectedQty ? ` <span class="negative">(-${i.rejectedQty})</span>` : ''}` : '<span class="muted">Chưa nhận</span>'}</td></tr>`,
      ),
    )}<div class="right mt16"><strong>Tổng tiền: ${money(p.total)}</strong></div><p class="sub">${e(p.note || 'Không có ghi chú')}${p.supplierNote ? `<br><strong>Phản hồi NCC:</strong> ${e(p.supplierNote)}` : ''}${p.storeApprovalNote ? `<br><strong>Duyệt cửa hàng:</strong> ${e(p.storeApprovalNote)}` : ''}${p.receivedAt ? `<br>Nhập kho lúc ${date(p.receivedAt)} bởi ${e(p.receiver)}` : ''}</p></div><div class="modal-footer">${['draft', 'pending', 'sent_to_supplier', 'supplier_responded', 'store_approved'].includes(p.status) ? action('cancel-purchase', 'Từ chối & Hủy phiếu', '', 'danger', `data-id="${e(p.id)}" data-action="cancel-purchase" data-action-alt="purchase-cancel"`) : ''}${['draft', 'pending'].includes(p.status) ? action('send-po-to-supplier', 'Gửi yêu cầu đặt hàng cho NCC', 'truck', 'primary', `data-id="${e(p.id)}" data-action="send-po-to-supplier" data-action-alt="purchase-send"`) : ''}${['sent_to_supplier', 'pending'].includes(p.status) ? action('open-supplier-response', 'Cổng phản hồi NCC (Tương tác 2 chiều)', 'edit', 'warning', `data-id="${e(p.id)}" data-action="open-supplier-response"`) : ''}${p.status === 'supplier_responded' ? action('approve-supplier-response', 'Chấp nhận phương án NCC & Chờ nhận hàng', 'check', 'primary', `data-id="${e(p.id)}" data-action="approve-supplier-response"`) + action('open-supplier-response', 'Sửa phản hồi NCC', 'edit', 'ghost', `data-id="${e(p.id)}"`) : ''}${['store_approved', 'pending'].includes(p.status) ? action('confirm-purchase-receipt', 'Kiểm nhận thực tế & Nhập kho (GRN)', 'check', 'teal', `data-id="${e(p.id)}" data-action="confirm-purchase-receipt" data-action-alt="open-purchase-receipt"`) : ''}${['pending', 'store_approved'].includes(p.status) ? action('purchase-receive', 'Xác nhận nhập kho trực tiếp', 'check', 'teal', `data-id="${e(p.id)}"`) : ''}${action('close-modal', 'Đóng')}</div>`,
    true,
  );
}

function supplierResponseModal(purchaseId) {
  const p = store.data.purchases.find((p) => p.id === purchaseId);
  if (!p) throw new Error('Không tìm thấy phiếu nhập.');
  modalContext = { type: 'supplier-response', purchaseId };
  showModal(
    'Cổng Phản hồi Nhà cung cấp (Tương tác 2 chiều NCC ⇄ Cửa hàng)',
    `<form id="supplier-response-form"><div class="modal-content stack">
      <div class="note yellow">NCC <strong>${e(p.supplier)}</strong> xác nhận số lượng thực giao, báo giá mới và khai báo HSD/Mã lô cho đơn đặt hàng <strong>${e(p.id)}</strong>.</div>
      ${table(
        ['Mặt hàng', 'SL Đặt', 'Khả năng cung ứng', 'SL Xác nhận', 'Giá vốn chốt (₫)', 'Hạn sử dụng', 'Mã lô NCC'],
        p.items.map((i, idx) => {
          const prod = store.data.products.find((x) => x.id === i.id);
          const defExp = i.expiryDate || prod?.expiryDate || '';
          const defBatch = i.batchCode || prod?.batchCode || '';
          return `<tr>
            <td class="name">${e(i.name)}<input type="hidden" name="item_id_${idx}" value="${e(i.id)}"></td>
            <td><strong>${i.qty}</strong></td>
            <td>
              <select class="purchase-line-input" name="supplier_status_${idx}" onchange="if(this.value==='out_of_stock'){const q=this.closest('tr').querySelector('[name^=confirmed_qty]');if(q)q.value=0;}">
                <option value="full" ${i.confirmedQty === i.qty ? 'selected' : ''}>Giao đủ</option>
                <option value="partial" ${(i.confirmedQty !== undefined && i.confirmedQty < i.qty && i.confirmedQty > 0) ? 'selected' : ''}>Giao một phần</option>
                <option value="out_of_stock" ${(i.confirmedQty === 0) ? 'selected' : ''}>Hết hàng (Không giao)</option>
              </select>
            </td>
            <td><input type="number" class="purchase-line-input" min="0" step="1" name="confirmed_qty_${idx}" value="${i.confirmedQty !== undefined ? i.confirmedQty : i.qty}" required></td>
            <td><input type="number" class="purchase-line-input purchase-line-price" min="0" step="1" name="confirmed_cost_${idx}" value="${i.confirmedCost !== undefined ? i.confirmedCost : i.price}" required></td>
            <td><input type="date" name="expiry_date_${idx}" value="${defExp}"></td>
            <td><input type="text" name="batch_code_${idx}" value="${e(defBatch)}" placeholder="Mã lô NCC"></td>
          </tr>`;
        }),
      )}
      ${textField('Ghi chú phản hồi của Nhà cung cấp', 'supplierNote', p.supplierNote || 'Xác nhận giao hàng đúng hẹn.')}
      ${formError()}
    </div>${foot('Gửi phản hồi xác nhận tới Cửa hàng', 'primary')}</form>`,
    true,
  );
}

function purchaseReceiptModal(purchaseId) {
  const p = store.data.purchases.find((p) => p.id === purchaseId);
  if (!p) throw new Error('Không tìm thấy phiếu nhập.');
  modalContext = { type: 'purchase-receipt', purchaseId };
  showModal(
    'Kiểm nhận thực tế tại cửa hàng (GRN / Goods Receipt Note)',
    `<form id="purchase-receipt-form"><div class="modal-content stack">
      <div class="note teal">Nhân viên kho kiểm tra quy cách, date và số lượng hàng thực nhận cho phiếu <strong>${e(p.id)}</strong>. Chỉ số lượng đạt chuẩn mới được nhập vào tồn kho bán lẻ.</div>
      ${table(
        ['Mặt hàng', 'NCC Xác nhận', 'Giá chốt', 'SL Đạt chuẩn (Nhập kho)', 'SL Lỗi (Trả lại NCC)', 'Lý do từ chối', 'Hạn dùng'],
        p.items.map((i, idx) => {
          const expectedQty = i.confirmedQty !== undefined ? i.confirmedQty : i.qty;
          const cost = i.confirmedCost !== undefined ? i.confirmedCost : i.price;
          return `<tr>
            <td class="name">${e(i.name)}<input type="hidden" name="rec_item_id_${idx}" value="${e(i.id)}"></td>
            <td><strong>${expectedQty}</strong></td>
            <td class="money">${money(cost)}</td>
            <td><input type="number" class="purchase-line-input" min="0" max="${expectedQty}" step="1" name="accepted_qty_${idx}" value="${expectedQty}" required></td>
            <td><input type="number" class="purchase-line-input" min="0" max="${expectedQty}" step="1" name="rejected_qty_${idx}" value="${i.rejectedQty || 0}"></td>
            <td><input type="text" class="purchase-line-input" name="reject_reason_${idx}" value="${e(i.rejectReason || '')}" placeholder="Lý do lỗi/trả lại"></td>
            <td>${i.expiryDate ? `<span class="badge ${getExpiryInfo ? getExpiryInfo(i.expiryDate).color : 'green'}">${i.expiryDate}</span>` : '<span class="muted">Theo lô</span>'}</td>
          </tr>`;
        }),
      )}
      ${textField('Ghi chú kiểm nhận của kho', 'receiverNote', 'Kiểm nhận đầy đủ, chất lượng đạt chuẩn.')}
      ${formError()}
    </div>${foot('Hoàn tất kiểm nhận & Cập nhật kho (GRN)', 'teal')}</form>`,
    true,
  );
}
