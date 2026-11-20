/* M3: Quản lý Nhập hàng (BR-02 & BR-06) — 3 tầng OOD kết nối SQLite API. */
'use strict';

function purchasesView() {
  if (!apiState.catalogMetaLoaded && !apiState.suppliersLoaded && !apiState.loading.catalogMeta) {
    loadCatalogMeta();
  }
  if (!apiState.productsLoaded && !apiState.loading.products) {
    loadProductsData();
  }
  if (!apiState.purchasesLoaded && !apiState.loading.purchases) {
    loadPurchasesData();
  }

  const canApprove = store.hasPermission('PURCHASE_APPROVE');
  const summary = apiState.purchasesSummary || {};
  const list = apiState.purchases || [];
  const p = paginate(list, 'purchases');

  const supplierOptions = [
    ['', 'Tất cả nhà cung cấp'],
    ...(apiState.suppliers || []).map((s) => [s.id, s.name]),
  ];

  return (
    heading(
      'QUẢN LÝ KHO / NHẬP HÀNG',
      'Quản lý nhập hàng',
      'Lập phiếu nhập (Draft) từ NCC đang hoạt động; chỉ cộng tồn kho & tính giá vốn bình quân khi duyệt (Confirmed) trong 1 Transaction (BR-02).',
      action('purchase-new', 'Tạo phiếu nhập', 'plus', 'primary'),
    ) +
    stats([
      ['Tổng phiếu nhập', number(summary.total || 0), 'Lưu trữ trong SQLite', 'receipt'],
      ['Phiếu nháp (Chờ duyệt)', number(summary.draftCount || 0), 'Chưa ảnh hưởng tồn kho', 'clock'],
      ['Đã nhập kho (Confirmed)', number(summary.confirmedCount || 0), 'Đã cộng tồn & giá vốn BQ', 'check'],
      ['Tổng giá trị đã nhập', money(summary.totalConfirmedAmount || 0), 'Chỉ tính phiếu Confirmed', 'truck'],
    ]) +
    restockSuggestionsHTML() +
    `<section class="panel">
      <div class="panel-head">
        <div>
          <h2>Danh sách phiếu nhập hàng</h2>
          <p class="sub">${
            canApprove
              ? 'Bạn có quyền Quản lý/Admin: được lập nháp, sửa nháp, duyệt nhập kho hoặc hủy phiếu nháp.'
              : 'Vai trò Nhân viên kho: được lập & sửa phiếu nháp (Draft); cần Quản lý duyệt để cộng tồn kho.'
          }</p>
        </div>
      </div>
      <div class="table-tools">
        ${filterInput('purchases', 'Tìm mã phiếu, nhà cung cấp, người lập, ghi chú…')}
        ${filterSelect('purchaseSupplier', supplierOptions)}
        ${filterSelect('purchaseStatus', [
          ['', 'Tất cả trạng thái'],
          ['Draft', 'Phiếu nháp (Chờ duyệt)'],
          ['Confirmed', 'Đã nhập kho (Confirmed)'],
          ['Cancelled', 'Đã hủy (Cancelled)'],
        ])}
        <input id="filter-purchaseFrom" data-filter="purchaseFrom" type="date" value="${e(filters.purchaseFrom || '')}" aria-label="Từ ngày" title="Từ ngày">
        <input id="filter-purchaseTo" data-filter="purchaseTo" type="date" value="${e(filters.purchaseTo || '')}" aria-label="Đến ngày" title="Đến ngày">
        ${action('purchases-reset', 'Đặt lại', 'return', 'small')}
      </div>
      ${
        apiState.purchaseError
          ? `<div class="panel-body"><div class="note yellow" role="alert"><strong>Lỗi bộ lọc:</strong> ${e(apiState.purchaseError)}</div></div>`
          : ''
      }
      ${
        apiState.loading.purchases && !apiState.purchasesLoaded
          ? '<div class="panel-body"><div class="note">Đang tải danh sách phiếu nhập từ CSDL…</div></div>'
          : table(
              ['Mã phiếu', 'Nhà cung cấp', 'Ngày lập', 'Người lập', 'Mặt hàng / SL', 'Tổng tiền', 'Trạng thái', 'Thao tác'],
              p.items.map(
                (po) => `<tr>
                  <td class="name"><code>${e(po.id)}</code></td>
                  <td class="name">${e(po.supplierName)}</td>
                  <td>${date(po.createdAt)}</td>
                  <td>${e(po.createdByName)}</td>
                  <td>${number(po.itemCount)} SP · <strong>${number(po.totalQty)}</strong> đv</td>
                  <td class="money">${money(po.totalAmount)}</td>
                  <td>${status(po.status)}</td>
                  <td>
                    <div class="action-group">
                      ${action('purchase-detail', 'Xem', '', 'xs', `data-id="${e(po.id)}"`)}
                      ${po.status === 'Draft' ? action('purchase-edit', 'Sửa', '', 'xs', `data-id="${e(po.id)}"`) : ''}
                      ${
                        po.status === 'Draft' && canApprove
                          ? action('purchase-confirm', 'Duyệt nhập', 'check', 'xs primary', `data-id="${e(po.id)}"`)
                          : ''
                      }
                    </div>
                  </td>
                </tr>`,
              ),
            ) + p.foot
      }
    </section>
    <div class="note mt16">
      <strong>Quy tắc BR-02:</strong> Chỉ lập phiếu từ NCC trạng thái <em>Hoạt động</em>, tối thiểu 1 dòng chi tiết (SL &gt; 0, Đơn giá &ge; 0). Phiếu <em>Nháp (Draft)</em> chưa cộng tồn kho; khi Quản lý duyệt sang <em>Đã nhập kho (Confirmed)</em>, hệ thống cộng tồn kho, cập nhật giá vốn bình quân gia quyền, ghi <code>LichSuTonKho</code> (<code>NHAP_KHO</code>) trong 1 Transaction nguyên tử và khóa phiếu.
    </div>`
  );
}

async function purchaseModal(prefillProductId = '', editPurchaseId = '') {
  if (!apiState.suppliersLoaded || !apiState.productsLoaded) {
    await Promise.all([loadCatalogMeta(true), loadProductsData(true)]);
  }
  let editingPo = null;
  if (editPurchaseId) {
    const res = await api.getPurchase(editPurchaseId);
    editingPo = res.item;
    if (!editingPo || editingPo.status !== 'Draft') {
      throw new Error('Chỉ được chỉnh sửa phiếu nhập đang ở trạng thái Nháp (Draft).');
    }
  }

  const activeSuppliers = (apiState.suppliers || []).filter((s) => s.status === 'HoatDong');
  if (!activeSuppliers.length) {
    throw new Error('Chưa có nhà cung cấp nào đang ở trạng thái Hoạt động (BR-02).');
  }

  const prefillProd = prefillProductId
    ? (apiState.products || []).find((p) => p.id === prefillProductId && p.status === 'DangKinhDoanh')
    : null;
  if (prefillProductId && (!prefillProd || !activeSuppliers.some((s) => s.id === prefillProd.supplierId))) {
    throw new Error('Sản phẩm hoặc nhà cung cấp đã ngừng hoạt động, không thể nhập hàng (BR-02).');
  }

  const defaultExp = new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10);
  const initialSupplierId = editingPo?.supplierId || prefillProd?.supplierId || activeSuppliers[0].id;
  purchaseLines = editingPo
    ? (editingPo.items || []).map((i) => ({
        productId: i.productId,
        sku: i.sku,
        name: i.productName,
        unitName: i.unitName,
        qty: i.qty,
        unitCost: i.unitCost,
        batchCode: i.batchCode || '',
        mfgDate: i.mfgDate || '',
        expiryDate: i.expiryDate || defaultExp,
        hasExpiry: i.hasExpiry !== false,
      }))
    : [];

  modalContext = { type: 'purchase-api', id: editingPo?.id || '' };
  showModal(
    editingPo ? `Sửa phiếu nhập nháp · ${e(editingPo.id)}` : 'Tạo phiếu nhập hàng (Draft)',
    `<form id="purchase-api-form">
      <div class="modal-content stack">
        <div class="note">
          Phiếu nhập được lưu ở trạng thái <strong>Nháp (Draft)</strong> — chưa cộng tồn kho cho đến khi Quản lý/Admin duyệt <strong>Xác nhận nhập kho (Confirmed)</strong>. Sản phẩm có quản lý HSD bắt buộc nhập <strong>Hạn sử dụng (*)</strong> lớn hơn ngày hiện tại để xuất bán FEFO.
        </div>
        ${selectField(
          'Nhà cung cấp đang hoạt động (*)',
          'supplierId',
          activeSuppliers.map((s) => [s.id, `${s.name} (${s.id})`]),
          initialSupplierId,
          'id="purchase-supplier" required',
        )}
        <div id="purchase-restock-suggestions"></div>
        <div class="form-grid">
          ${selectField('Sản phẩm thuộc NCC (*)', 'productId', [], '', 'id="purchase-product"', true)}
          ${field('Số lượng nhập (*)', 'qty', 10, 'number', 'id="purchase-qty" min="1" step="1"')}
          ${field('Đơn giá nhập (₫) (*)', 'unitCost', 0, 'number', 'id="purchase-price" min="0" step="100"')}
          ${field('Hạn sử dụng (*)', 'expiryDate', defaultExp, 'date', 'id="purchase-expiry"')}
          ${field('Ngày sản xuất', 'mfgDate', new Date().toISOString().slice(0, 10), 'date', 'id="purchase-mfg"')}
          ${field('Mã lô (tự sinh nếu trống)', 'batchCode', '', 'text', 'id="purchase-batch" placeholder="VD: LO-2026-01"')}
        </div>
        <div>
          ${action('purchase-line-add', 'Thêm vào phiếu', 'plus', 'small')}
        </div>
        <div id="purchase-lines"></div>
        ${textField('Ghi chú chứng từ nhập hàng', 'note', editingPo?.note || '')}
        ${formError()}
      </div>
      <div class="modal-footer">
        ${action('close-modal', 'Hủy')}
        <button class="btn primary" type="submit">${icon('check')}${editingPo ? 'Lưu thay đổi' : 'Lưu phiếu nháp'}</button>
      </div>
    </form>`,
    true,
  );

  updatePurchaseOptions(!editingPo);
  if (prefillProd && !editingPo) {
    addSuggestedPurchase(prefillProd.id);
  }
}

function updatePurchaseOptions(resetLines = true) {
  const sid = $('#purchase-supplier')?.value || '';
  const products = (apiState.products || []).filter(
    (p) => p.status === 'DangKinhDoanh' && p.supplierId === sid,
  );
  const select = $('#purchase-product');
  if (select) {
    select.innerHTML = products.length
      ? products
          .map(
            (p) =>
              `<option value="${e(p.id)}">${e(p.sku)} · ${e(p.name)} (Tồn: ${number(p.stockQty)} ${e(p.unitName)})</option>`,
          )
          .join('')
      : '<option value="">— NCC này chưa có sản phẩm đang kinh doanh —</option>';
  }
  const priceInput = $('#purchase-price');
  if (priceInput) {
    priceInput.value = products[0] ? Number(products[0].costPrice || 0) : 0;
  }
  if (resetLines) {
    purchaseLines = [];
  }
  renderPurchaseLines();
}

function renderPurchaseLines() {
  const host = $('#purchase-lines');
  if (!host) return;
  const totalAmount = purchaseLines.reduce((sum, i) => sum + i.qty * i.unitCost, 0);
  host.innerHTML =
    table(
      ['Mã SKU', 'Mặt hàng', 'SL (*)', 'Đơn giá (₫) (*)', 'Hạn sử dụng (*)', 'Mã lô', 'Thành tiền', ''],
      purchaseLines.map(
        (i, index) => `<tr>
          <td><code>${e(i.sku)}</code></td>
          <td class="name">${e(i.name)}</td>
          <td><input class="purchase-line-input" type="number" min="1" step="1" required value="${i.qty}" data-purchase-field="qty" data-index="${index}" aria-label="Số lượng nhập ${e(i.name)}"></td>
          <td><input class="purchase-line-input purchase-line-price" type="number" min="0" step="100" required value="${i.unitCost}" data-purchase-field="unitCost" data-index="${index}" aria-label="Đơn giá nhập ${e(i.name)}"></td>
          <td><input type="date" ${i.hasExpiry !== false ? 'required' : ''} value="${e(i.expiryDate || '')}" data-purchase-field="expiryDate" data-index="${index}" aria-label="Hạn sử dụng ${e(i.name)}"></td>
          <td><input type="text" style="width:110px" value="${e(i.batchCode || '')}" data-purchase-field="batchCode" data-index="${index}" placeholder="Tự sinh" aria-label="Mã lô ${e(i.name)}"></td>
          <td class="money">${money(i.qty * i.unitCost)}</td>
          <td>${ib('purchase-line-delete', 'trash', 'Xóa dòng hàng', `data-index="${index}"`)}</td>
        </tr>`,
      ),
    ) +
    `<div class="right mt16"><strong>Tổng tiền phiếu nhập: ${money(totalAmount)}</strong></div>`;
  renderSupplierRestockSuggestions();
}

async function purchaseDetail(purchaseId) {
  const res = await api.getPurchase(purchaseId);
  const po = res.item;
  if (!po) throw new Error('Không tìm thấy phiếu nhập hàng.');
  const canApprove = store.hasPermission('PURCHASE_APPROVE');
  const isDraft = po.status === 'Draft';

  showModal(
    `Chi tiết phiếu nhập hàng · ${e(po.id)}`,
    `<div class="modal-content stack">
      <div class="detail-grid">
        <div><small>Mã phiếu nhập</small><strong><code>${e(po.id)}</code></strong></div>
        <div><small>Trạng thái</small><div>${status(po.status)}</div></div>
        <div><small>Nhà cung cấp</small><strong>${e(po.supplierName)}</strong></div>
        <div><small>Người lập phiếu</small><strong>${e(po.createdByName)}</strong></div>
        <div><small>Thời gian lập</small><strong>${date(po.createdAt)}</strong></div>
        <div><small>${po.status === 'Cancelled' ? 'Người / Ngày hủy' : 'Người / Ngày duyệt'}</small><strong>${
          po.approvedByName ? `${e(po.approvedByName)} · ${date(po.confirmedAt)}` : 'Chưa duyệt'
        }</strong></div>
      </div>
      ${table(
        ['Sản phẩm', 'Mã SKU', 'ĐVT', 'SL nhập', 'Đơn giá nhập', 'Lô / HSD', 'Thành tiền'],
        (po.items || []).map(
          (i) => `<tr>
            <td class="name">
              <div class="product-cell">
                <div class="product-thumb">${productImage({ imageUrl: i.imageUrl, name: i.productName }, 'product-thumb-img')}</div>
                <div><strong>${e(i.productName)}</strong></div>
              </div>
            </td>
            <td><code>${e(i.sku)}</code></td>
            <td>${e(i.unitName)}</td>
            <td class="right"><strong>${number(i.qty)}</strong></td>
            <td class="money">${money(i.unitCost)}</td>
            <td>${i.batchCode ? `<code>${e(i.batchCode)}</code><br>` : ''}<small>${i.expiryDate ? `HSD: ${dateOnly(i.expiryDate)}` : 'Không hạn'}</small></td>
            <td class="money"><strong>${money(i.lineTotal)}</strong></td>
          </tr>`,
        ),
      )}
      <div class="right"><strong>Tổng cộng (${number(po.totalQty)} sản phẩm): ${money(po.totalAmount)}</strong></div>
      <p class="sub"><strong>Ghi chú:</strong> ${e(po.note || 'Không có ghi chú.')}</p>
      ${
        po.status === 'Confirmed'
          ? '<div class="note green"><strong>Đã khóa chứng từ (BR-02):</strong> Phiếu đã xác nhận nhập kho, cộng tồn, cập nhật giá vốn bình quân và ghi Thẻ kho bất biến — không được sửa hoặc hủy.</div>'
          : isDraft && !canApprove
            ? '<div class="note yellow">Phiếu đang ở trạng thái <strong>Nháp (Draft)</strong>. Đang chờ <strong>Quản lý cửa hàng</strong> hoặc <strong>Admin</strong> duyệt xác nhận nhập kho.</div>'
            : ''
      }
    </div>
    <div class="modal-footer">
      ${isDraft ? action('purchase-edit', 'Sửa phiếu nháp', 'edit', '', `data-id="${e(po.id)}"`) : ''}
      ${isDraft && canApprove ? action('purchase-cancel', 'Hủy phiếu', 'trash', 'danger', `data-id="${e(po.id)}"`) : ''}
      ${isDraft && canApprove ? action('purchase-confirm', 'Duyệt nhập kho', 'check', 'primary', `data-id="${e(po.id)}"`) : ''}
      ${action('close-modal', 'Đóng')}
    </div>`,
    true,
  );
}
