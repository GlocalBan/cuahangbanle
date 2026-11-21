/* M3 + Phase 2: Đặt hàng 2 chiều (PO & Thương lượng), Nhận hàng nhiều đợt (GRN), Công nợ NCC (AP), Trả hàng NCC & Cổng Nhà cung cấp. */
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
  const canPayable = store.hasPermission('PAYABLE_MANAGE');
  const canPurchaseCreate = store.hasPermission('PURCHASE_CREATE');
  if (canPurchaseCreate && !apiState.grnsLoaded && !apiState.loading.grns) {
    loadGrnsData();
  }
  if (canPayable && !apiState.payablesLoaded && !apiState.loading.payables) {
    loadPayablesData();
  }
  if (canPurchaseCreate && !apiState.supplierReturnsLoaded && !apiState.loading.supplierReturns) {
    loadSupplierReturnsData();
  }
  const tabs = [
    ['pos', 'PO & Thương lượng'],
    ['grns', 'Nhận hàng (GRN)'],
    ...(canPayable ? [['payables', 'Công nợ NCC (AP)']] : []),
    ['supplier-returns', 'Trả hàng NCC'],
  ];
  if (!tabs.some(([k]) => k === purchasesTab)) purchasesTab = 'pos';

  const summary = apiState.purchasesSummary || {};
  const paySum = apiState.payablesSummary || {};
  const grnSum = apiState.grnsSummary || {};
  const srSum = apiState.supplierReturnsSummary || {};

  let tabContent = '';
  if (purchasesTab === 'pos') {
    const list = apiState.purchases || [];
    const p = paginate(list, 'purchases');
    const supplierOptions = [['', 'Tất cả nhà cung cấp'], ...(apiState.suppliers || []).map((s) => [s.id, s.name])];
    tabContent = `${restockSuggestionsHTML()}
      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>Đơn đặt hàng (PO) &amp; Quy trình thương lượng 2 chiều</h2>
            <p class="sub">Luồng chuẩn: <code>Nháp → Gửi NCC → NCC phản hồi / Thương lượng → Đã thống nhất → Nhận hàng nhiều đợt (GRN) → Đã nhập đủ</code> (hoặc duyệt trực tiếp từ Nháp).</p>
          </div>
        </div>
        <div class="table-tools wrap">
          ${filterInput('purchases', 'Tìm mã phiếu, nhà cung cấp, người lập, ghi chú…')}
          ${filterSelect('purchaseSupplier', supplierOptions)}
          ${filterSelect('purchaseStatus', [
            ['', 'Tất cả trạng thái'],
            ['Draft', 'Phiếu nháp'],
            ['GuiNCC', 'Đã gửi NCC'],
            ['NCCPhanHoi', 'NCC phản hồi'],
            ['ThuongLuong', 'Đang thương lượng'],
            ['DaThongNhat', 'Đã thống nhất'],
            ['DangNhanHang', 'Đang nhận hàng (GRN)'],
            ['Confirmed', 'Đã nhập kho đủ'],
            ['Cancelled', 'Đã hủy'],
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
                ['Mã PO', 'Nhà cung cấp', 'Ngày lập', 'Mặt hàng / SL', 'Tổng tiền', 'Trạng thái', 'Thao tác'],
                p.items.map(
                  (po) => `<tr>
                    <td class="name"><code>${e(po.id)}</code>${po.expectedDeliveryDate ? `<div class="sub">Giao DK: ${dateOnly(po.expectedDeliveryDate)}</div>` : ''}</td>
                    <td class="name">${e(po.supplierName)}</td>
                    <td>${date(po.createdAt)}</td>
                    <td>${number(po.itemCount)} SP · <strong>${number(po.totalQty)}</strong> đv</td>
                    <td class="money">${money(po.totalAmount)}</td>
                    <td>${status(po.status)}</td>
                    <td>
                      <div class="action-group">
                        ${action('purchase-detail', 'Xem', 'eye', 'xs', `data-id="${e(po.id)}"`)}
                        ${po.status === 'Draft' ? action('purchase-edit', 'Sửa', 'edit', 'xs', `data-id="${e(po.id)}"`) : ''}
                        ${po.status === 'Draft' ? action('purchase-send', 'Gửi NCC', 'arrow', 'xs teal', `data-id="${e(po.id)}"`) : ''}
                        ${po.status === 'NCCPhanHoi' && canApprove ? action('purchase-counter', 'Thương lượng', 'edit', 'xs warning', `data-id="${e(po.id)}"`) : ''}
                        ${['GuiNCC', 'NCCPhanHoi', 'ThuongLuong'].includes(po.status) && canApprove ? action('purchase-agree', 'Chốt PO', 'check', 'xs teal', `data-id="${e(po.id)}"`) : ''}
                        ${['DaThongNhat', 'DangNhanHang'].includes(po.status) ? action('grn-new', 'Lập GRN', 'truck', 'xs primary', `data-purchase-id="${e(po.id)}"`) : ''}
                        ${po.status === 'Draft' && canApprove ? action('purchase-confirm', 'Duyệt nhập', 'check', 'xs primary', `data-id="${e(po.id)}"`) : ''}
                      </div>
                    </td>
                  </tr>`,
                ),
              ) + p.foot
        }
      </section>`;
  }

  if (purchasesTab === 'grns') {
    const grns = apiState.grns || [];
    const gp = paginate(grns, 'grns');
    tabContent = `<section class="panel">
      <div class="panel-head">
        <div>
          <h2>Phiếu nhận hàng thực tế theo đợt (GRN · ${number(grns.length)})</h2>
          <p class="sub">Cho phép nhận nhiều đợt từ 1 PO đã thống nhất, nhập HSD bắt buộc cho từng lô, tự động tạo công nợ NCC khi duyệt GRN.</p>
        </div>
        ${action('grn-new', 'Lập phiếu nhận hàng (GRN)', 'plus', 'primary small')}
      </div>
      <div class="table-tools">
        ${filterSelect('grnStatus', [
          ['', 'Tất cả trạng thái'],
          ['ChoDuyet', 'Chờ duyệt nhập kho'],
          ['DaDuyet', 'Đã duyệt nhập kho'],
        ])}
      </div>
      ${
        apiState.loading.grns && !apiState.grnsLoaded
          ? '<div class="panel-body"><div class="note">Đang tải danh sách phiếu nhận hàng (GRN)…</div></div>'
          : table(
              ['Mã GRN', 'Thuộc PO', 'Nhà cung cấp', 'Người nhận', 'SL nhận / Từ chối QC', 'Giá trị nhận', 'Trạng thái', 'Thao tác'],
              gp.items.map(
                (g) => `<tr>
                  <td class="name"><code>${e(g.id)}</code><div class="sub">${date(g.createdAt)}</div></td>
                  <td><button type="button" class="text-link" data-action="purchase-detail" data-id="${e(g.purchaseId)}"><code>${e(g.purchaseId)}</code></button></td>
                  <td class="name">${e(g.supplierName)}</td>
                  <td>${e(g.receivedByName)}</td>
                  <td><strong>${number(g.totalReceivedQty)}</strong> đv${g.totalRejectedQty ? ` · <span class="negative">QC loại ${number(g.totalRejectedQty)}</span>` : ''}</td>
                  <td class="money">${money(g.totalReceivedAmount)}</td>
                  <td>${status(g.status)}</td>
                  <td>
                    ${g.status === 'ChoDuyet' && canApprove ? action('grn-confirm', 'Duyệt GRN', 'check', 'xs primary', `data-id="${e(g.id)}"`) : '<span class="sub">Đã khóa</span>'}
                  </td>
                </tr>`,
              ),
            ) + gp.foot
      }
    </section>`;
  }

  if (purchasesTab === 'payables') {
    const payables = apiState.payables || [];
    const pp = paginate(payables, 'payables');
    tabContent = `<section class="panel">
      <div class="panel-head">
        <div>
          <h2>Công nợ phải trả Nhà cung cấp (AP · ${number(payables.length)})</h2>
          <p class="sub">Tự động sinh khi duyệt nhập kho / GRN; tự động giảm trừ khi duyệt phiếu Trả hàng NCC.</p>
        </div>
        <div class="row gap8">
          ${badge(`Dư nợ: ${money(paySum.totalBalance || 0)}`, paySum.totalBalance > 0 ? 'yellow' : 'green')}
          ${paySum.overdueCount ? badge(`${paySum.overdueCount} quá hạn`, 'red') : ''}
        </div>
      </div>
      <div class="table-tools">
        ${filterSelect('payableStatus', [
          ['', 'Tất cả trạng thái'],
          ['ChuaThanhToan', 'Chưa thanh toán'],
          ['ThanhToanMotPhan', 'Thanh toán một phần'],
          ['DaThanhToanNCC', 'Đã thanh toán đủ'],
        ])}
      </div>
      ${
        apiState.loading.payables && !apiState.payablesLoaded
          ? '<div class="panel-body"><div class="note">Đang tải sổ công nợ NCC…</div></div>'
          : table(
              ['Mã công nợ', 'Nhà cung cấp', 'PO / GRN', 'Tổng nợ', 'Đã trả', 'Còn phải trả', 'Hạn thanh toán', 'Trạng thái', 'Thao tác'],
              pp.items.map(
                (ap) => `<tr>
                  <td class="name"><code>${e(ap.id)}</code></td>
                  <td class="name">${e(ap.supplierName)}</td>
                  <td><code>${e(ap.purchaseId)}</code>${ap.receiptId ? `<div class="sub">GRN: <code>${e(ap.receiptId)}</code></div>` : ''}</td>
                  <td class="money">${money(ap.totalAmount)}</td>
                  <td class="money positive">${money(ap.paidAmount)}</td>
                  <td class="money ${ap.balanceAmount > 0 ? 'negative' : ''}"><strong>${money(ap.balanceAmount)}</strong></td>
                  <td>${dateOnly(ap.dueDate)}${ap.isOverdue ? '<div class="sub"><span class="badge red">Quá hạn</span></div>' : ''}</td>
                  <td>${status(ap.status)}</td>
                  <td>
                    ${
                      ap.balanceAmount > 0
                        ? action('payable-pay', 'Ghi nhận chi', 'cash', 'xs primary', `data-id="${e(ap.id)}"`)
                        : '<span class="sub">Đã tất toán</span>'
                    }
                  </td>
                </tr>`,
              ),
            ) + pp.foot
      }
    </section>`;
  }

  if (purchasesTab === 'supplier-returns') {
    const returns = apiState.supplierReturns || [];
    const srp = paginate(returns, 'supplier-returns');
    tabContent = `<section class="panel">
      <div class="panel-head">
        <div>
          <h2>Phiếu trả hàng về Nhà cung cấp (TRA_NCC · ${number(returns.length)})</h2>
          <p class="sub">Khi Quản lý duyệt trả hàng NCC: tự động trừ tồn lô, ghi Thẻ kho <code>TRA_NCC</code> và giảm trừ công nợ NCC trong 1 Transaction.</p>
        </div>
        ${action('supret-new', 'Lập phiếu trả NCC', 'plus', 'danger small')}
      </div>
      <div class="table-tools">
        ${filterSelect('supRetStatus', [
          ['', 'Tất cả trạng thái'],
          ['ChoDuyet', 'Chờ duyệt trả NCC'],
          ['DaDuyet', 'Đã duyệt trả NCC'],
        ])}
      </div>
      ${
        apiState.loading.supplierReturns && !apiState.supplierReturnsLoaded
          ? '<div class="panel-body"><div class="note">Đang tải phiếu trả hàng NCC…</div></div>'
          : table(
              ['Mã phiếu', 'Nhà cung cấp', 'PO gốc', 'Người lập', 'Tổng giá trị trả', 'Lý do', 'Trạng thái', 'Thao tác'],
              srp.items.map(
                (sr) => `<tr>
                  <td class="name"><code>${e(sr.id)}</code><div class="sub">${date(sr.createdAt)}</div></td>
                  <td class="name">${e(sr.supplierName)}</td>
                  <td>${sr.purchaseId ? `<code>${e(sr.purchaseId)}</code>` : '—'}</td>
                  <td>${e(sr.createdByName)}</td>
                  <td class="money">${money(sr.totalAmount)}</td>
                  <td class="wrap-cell">${e(sr.reason)}</td>
                  <td>${status(sr.status)}</td>
                  <td>
                    ${sr.status === 'ChoDuyet' && canApprove ? action('supret-approve', 'Duyệt trả NCC', 'check', 'xs primary', `data-id="${e(sr.id)}"`) : '<span class="sub">Đã xử lý</span>'}
                  </td>
                </tr>`,
              ),
            ) + srp.foot
      }
    </section>`;
  }

  return (
    heading(
      'QUẢN LÝ KHO / NHẬP HÀNG, GRN & CÔNG NỢ NCC',
      'Nhập hàng & Công nợ NCC',
      'Đặt hàng 2 chiều với NCC, nhận hàng nhiều đợt (GRN) kèm HSD, tự động hạch toán công nợ phải trả và xử lý trả hàng NCC.',
      action('purchase-new', 'Tạo đơn đặt hàng (PO)', 'plus', 'primary'),
    ) +
    stats([
      ['Tổng đơn đặt hàng (PO)', number(summary.total || 0), `${number(summary.draftCount || 0)} nháp · ${number(summary.confirmedCount || 0)} đã nhập đủ`, 'receipt'],
      ['Phiếu nhận hàng (GRN)', number(grnSum.total || 0), `${number(grnSum.pendingCount || 0)} chờ duyệt · ${number(grnSum.approvedCount || 0)} đã duyệt`, 'truck'],
      canPayable
        ? ['Dư nợ NCC hiện tại', money(paySum.totalBalance || 0), `${number(paySum.overdueCount || 0)} khoản quá hạn`, 'cash']
        : ['Tổng giá trị đã nhập', money(summary.totalConfirmedAmount || 0), 'Tính trên PO đã nhập kho', 'truck'],
      ['Phiếu trả hàng NCC', number(srSum.total || 0), `Đã duyệt: ${money(srSum.totalApprovedAmount || 0)}`, 'return'],
    ]) +
    `<div class="tabs">${tabs
      .map(
        ([k, label]) =>
          `<button type="button" class="${purchasesTab === k ? 'active' : ''}" data-action="purchases-tab" data-tab="${k}">${label}</button>`,
      )
      .join('')}</div>${tabContent}`
  );
}

// ─── 5TH ROLE: SUPPLIER PORTAL VIEW (ncc01 / Admin) ──────────────────────────
function supplierPortalView() {
  if (!apiState.supplierPortalLoaded && !apiState.loading.supplierPortal) {
    loadSupplierPortalData();
  }
  const list = apiState.supplierPortalPurchases || [];
  const p = paginate(list, 'supplier-portal');
  const waiting = list.filter((x) => ['GuiNCC', 'ThuongLuong'].includes(x.status)).length;
  const agreed = list.filter((x) => ['DaThongNhat', 'DangNhanHang'].includes(x.status)).length;
  const done = list.filter((x) => x.status === 'Confirmed').length;

  return (
    heading(
      'CỔNG NHÀ CUNG CẤP (SUPPLIER PORTAL)',
      'Đơn đặt hàng từ RetailFlow',
      `Tài khoản NCC chỉ xem và phản hồi đúng các đơn hàng thuộc mã nhà cung cấp của mình (cách ly dữ liệu 3 lớp RBAC).`,
      action('portal-refresh', 'Tải lại đơn hàng', 'return', 'small'),
    ) +
    stats([
      ['Tổng đơn đặt hàng', number(list.length), 'Chỉ gồm đơn gửi tới NCC của bạn', 'receipt'],
      ['Chờ NCC phản hồi', number(waiting), 'Cần Chấp nhận / Đề xuất giá / Từ chối', 'clock'],
      ['Đã thống nhất giao', number(agreed), 'Đang chuẩn bị / giao hàng theo GRN', 'truck'],
      ['Đã hoàn tất nhập kho', number(done), 'Cửa hàng đã xác nhận nhận đủ', 'check'],
    ]) +
    `<section class="panel">
      <div class="panel-head">
        <div>
          <h2>Danh sách đơn đặt hàng (PO) gửi đến Nhà cung cấp</h2>
          <p class="sub">Bạn có thể xác nhận giao đủ (ACCEPT), đề xuất giá/số lượng mới (COUNTER) hoặc từ chối kèm lý do (REJECT).</p>
        </div>
      </div>
      <div class="table-tools">
        ${filterInput('portalSearch', 'Tìm theo mã PO, ghi chú…')}
        ${filterSelect('portalStatus', [
          ['', 'Tất cả trạng thái'],
          ['GuiNCC', 'Mới gửi — Chờ phản hồi'],
          ['ThuongLuong', 'Cửa hàng thương lượng lại'],
          ['NCCPhanHoi', 'Đã gửi đề xuất'],
          ['DaThongNhat', 'Đã thống nhất'],
          ['DangNhanHang', 'Đang giao nhận'],
          ['Confirmed', 'Hoàn tất'],
        ])}
      </div>
      ${
        apiState.loading.supplierPortal && !apiState.supplierPortalLoaded
          ? '<div class="panel-body"><div class="note">Đang tải danh sách đơn đặt hàng của nhà cung cấp…</div></div>'
          : table(
              ['Mã PO', 'Ngày tạo', 'Ngày giao DK', 'Mặt hàng / SL', 'Tổng giá trị', 'Trạng thái', 'Thao tác'],
              p.items.map(
                (po) => `<tr>
                  <td class="name"><code>${e(po.id)}</code></td>
                  <td>${date(po.createdAt)}</td>
                  <td>${po.expectedDeliveryDate ? dateOnly(po.expectedDeliveryDate) : '—'}</td>
                  <td>${number(po.itemCount)} SP · <strong>${number(po.totalQty)}</strong> đv</td>
                  <td class="money">${money(po.totalAmount)}</td>
                  <td>${status(po.status)}</td>
                  <td>
                    <div class="action-group">
                      ${action('portal-detail', 'Chi tiết', 'eye', 'xs', `data-id="${e(po.id)}"`)}
                      ${
                        ['GuiNCC', 'ThuongLuong'].includes(po.status)
                          ? action('portal-respond', 'Phản hồi PO', 'check', 'xs primary', `data-id="${e(po.id)}"`)
                          : ''
                      }
                    </div>
                  </td>
                </tr>`,
              ),
            ) + p.foot
      }
    </section>`
  );
}

async function supplierRespondModal(purchaseId, isStoreCounter = false) {
  const res = isStoreCounter ? await api.getPurchase(purchaseId) : await api.getSupplierPortalPurchase(purchaseId);
  const po = res.item;
  if (!po) throw new Error('Không tìm thấy đơn đặt hàng.');
  modalContext = { type: isStoreCounter ? 'purchase-counter' : 'portal-respond', id: po.id };

  showModal(
    isStoreCounter ? `Cửa hàng thương lượng lại · ${e(po.id)}` : `Nhà cung cấp phản hồi PO · ${e(po.id)}`,
    `<form id="${isStoreCounter ? 'purchase-counter-form' : 'portal-respond-form'}">
      <div class="modal-content stack">
        <div class="note">
          Nhà cung cấp: <strong>${e(po.supplierName)}</strong> · Tổng hiện tại: <strong class="money">${money(po.totalAmount)}</strong>
        </div>
        ${
          !isStoreCounter
            ? selectField(
                'Quyết định phản hồi (*)',
                'action',
                [
                  ['ACCEPT', 'ACCEPT — Chấp nhận giao đủ theo điều khoản PO'],
                  ['COUNTER', 'COUNTER — Đề xuất điều chỉnh đơn giá / số lượng'],
                  ['REJECT', 'REJECT — Từ chối đơn đặt hàng (bắt buộc nhập lý do)'],
                ],
                'ACCEPT',
                'required',
              )
            : ''
        }
        ${field('Ngày giao hàng dự kiến', 'expectedDeliveryDate', po.expectedDeliveryDate || new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10), 'date')}
        ${table(
          ['SKU', 'Sản phẩm', 'SL đặt/đề xuất', 'Đơn giá (₫)'],
          (po.items || []).map(
            (i) => `<tr>
              <td><code>${e(i.sku)}</code></td>
              <td class="name">${e(i.productName)}</td>
              <td><input type="number" min="1" step="1" value="${i.qty}" data-nego-qty="${e(i.productId)}" style="width:88px"></td>
              <td><input type="number" min="0" step="1" value="${i.unitCost}" data-nego-cost="${e(i.productId)}" style="width:110px"></td>
            </tr>`,
          ),
        )}
        <label class="field full">
          <span>Ghi chú thương lượng / Lý do</span>
          <textarea name="note" placeholder="${isStoreCounter ? 'Nhập đề xuất điều chỉnh của cửa hàng…' : 'Ghi chú xác nhận / đề xuất giá / lý do từ chối…'}"></textarea>
        </label>
        ${formError()}
      </div>
      <div class="modal-footer">
        ${action('close-modal', 'Hủy')}
        <button class="btn primary" type="submit">${icon('check')}${isStoreCounter ? 'Gửi thương lượng' : 'Gửi phản hồi'}</button>
      </div>
    </form>`,
    true,
  );
}

async function createGrnModal(prefillPurchaseId = '') {
  if (!apiState.purchasesLoaded) await loadPurchasesData(true);
  const eligiblePos = (apiState.purchases || []).filter((p) => ['DaThongNhat', 'DangNhanHang'].includes(p.status));
  if (!eligiblePos.length) {
    throw new Error('Không có đơn đặt hàng (PO) nào ở trạng thái Đã thống nhất / Đang nhận hàng để lập GRN.');
  }
  const targetPoId = (prefillPurchaseId && eligiblePos.some((p) => p.id === prefillPurchaseId) && prefillPurchaseId) || eligiblePos[0].id;
  const detailRes = await api.getPurchase(targetPoId);
  const po = detailRes.item;
  const defaultExp = new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10);
  modalContext = { type: 'grn-create', purchaseId: po.id };

  showModal(
    `Lập phiếu nhận hàng (GRN) · PO ${e(po.id)}`,
    `<form id="grn-api-form">
      <div class="modal-content stack">
        ${selectField(
          'Đơn đặt hàng (PO) (*)',
          'purchaseId',
          eligiblePos.map((x) => [x.id, `${x.id} · ${x.supplierName} (${x.statusLabel})`]),
          po.id,
          'id="grn-po-select" required',
          true,
        )}
        <div class="note">
          Nhập số lượng thực nhận cho đợt này (có thể nhận một phần). Sản phẩm quản lý hạn dùng bắt buộc nhập <strong>Hạn sử dụng (*)</strong>.
        </div>
        ${table(
          ['Sản phẩm', 'Đặt / Đã nhận', 'SL nhận đợt này (*)', 'Đơn giá (₫)', 'HSD (*)', 'Mã lô'],
          (po.items || []).map(
            (i) => `<tr>
              <td class="name"><strong>${e(i.productName)}</strong><div class="sub"><code>${e(i.sku)}</code></div></td>
              <td>${number(i.qty)} / <strong>${number(i.receivedQty || 0)}</strong> (còn ${number(i.remainingQty)})</td>
              <td><input type="number" min="0" max="${i.remainingQty}" step="1" value="${i.remainingQty}" data-grn-qty="${e(i.productId)}" style="width:82px"></td>
              <td><input type="number" min="0" step="1" value="${i.unitCost}" data-grn-cost="${e(i.productId)}" style="width:105px"></td>
              <td><input type="date" value="${e(i.expiryDate || defaultExp)}" data-grn-exp="${e(i.productId)}" ${i.hasExpiry !== false ? 'required' : ''}></td>
              <td><input type="text" value="${e(i.batchCode || '')}" data-grn-batch="${e(i.productId)}" placeholder="Tự sinh" style="width:105px"></td>
            </tr>`,
          ),
        )}
        ${textField('Ghi chú nhận hàng / Kiểm tra QC', 'note', 'Kiểm đếm thực nhận tại kho cửa hàng')}
        ${formError()}
      </div>
      <div class="modal-footer">
        ${action('close-modal', 'Hủy')}
        <button class="btn primary" type="submit">${icon('check')}Tạo phiếu nhận hàng (GRN)</button>
      </div>
    </form>`,
    true,
  );
}

async function payablePayModal(payableId) {
  const res = await api.getPayable(payableId);
  const ap = res.item;
  if (!ap) throw new Error('Không tìm thấy phiếu công nợ NCC.');
  modalContext = { type: 'payable-pay', id: ap.id };

  showModal(
    `Thanh toán công nợ NCC · ${e(ap.id)}`,
    `<form id="payable-pay-form">
      <div class="modal-content stack">
        <div class="detail-grid">
          <div><small>Nhà cung cấp</small><strong>${e(ap.supplierName)}</strong></div>
          <div><small>Chứng từ gốc</small><strong><code>${e(ap.purchaseId)}</code>${ap.receiptId ? ` / ${e(ap.receiptId)}` : ''}</strong></div>
          <div><small>Tổng nợ / Đã trả</small><strong>${money(ap.totalAmount)} / ${money(ap.paidAmount)}</strong></div>
          <div><small>Dư nợ còn lại</small><strong class="money negative">${money(ap.balanceAmount)}</strong></div>
        </div>
        ${field('Số tiền thanh toán đợt này (₫) (*)', 'amount', ap.balanceAmount, 'number', `required min="1" max="${ap.balanceAmount}" step="1"`)}
        ${selectField(
          'Phương thức chi (*)',
          'paymentMethod',
          [
            ['BANK_TRANSFER', 'Chuyển khoản ngân hàng'],
            ['CASH', 'Tiền mặt tại quầy'],
          ],
          'BANK_TRANSFER',
          'required',
        )}
        ${field('Mã ủy nhiệm chi / tham chiếu', 'paymentRef', `UNC${Date.now().toString().slice(-6)}`, 'text', 'maxlength="100"')}
        ${textField('Ghi chú thanh toán', 'note', `Thanh toán công nợ ${ap.id}`)}
        ${formError()}
      </div>
      <div class="modal-footer">
        ${action('close-modal', 'Hủy')}
        <button class="btn primary" type="submit">${icon('check')}Ghi nhận thanh toán</button>
      </div>
    </form>`,
  );
}

async function supplierReturnModal() {
  if (!apiState.suppliersLoaded) await loadCatalogMeta(true);
  const batchesRes = await api.listBatches({});
  const batches = (batchesRes.items || []).filter((b) => Number(b.qtyRemaining) > 0 && b.status !== 'DaHuy');
  const activeSuppliers = (apiState.suppliers || []).filter((s) => s.status === 'HoatDong');
  if (!activeSuppliers.length || !batches.length) {
    throw new Error('Cần có nhà cung cấp hoạt động và lô hàng còn tồn để lập phiếu trả NCC.');
  }
  const firstBatch = batches[0];
  modalContext = { type: 'supret-create' };

  showModal(
    'Lập phiếu trả hàng về Nhà cung cấp (TRA_NCC)',
    `<form id="supret-api-form">
      <div class="modal-content stack">
        <div class="note yellow">
          Phiếu trả NCC sau khi Quản lý duyệt sẽ trừ tồn lô hàng, ghi Thẻ kho <code>TRA_NCC</code> và tự động giảm trừ công nợ NCC (nếu gắn PO/GRN).
        </div>
        ${selectField(
          'Nhà cung cấp (*)',
          'supplierId',
          activeSuppliers.map((s) => [s.id, `${s.name} (${s.id})`]),
          activeSuppliers[0].id,
          'required',
          true,
        )}
        ${selectField(
          'Lô hàng xuất trả (*)',
          'batchId',
          batches.map((b) => [b.id, `${b.batchCode} · ${b.productName} (${b.sku}) · Tồn lô: ${b.qtyRemaining} · Vốn: ${money(b.unitCost)}`]),
          firstBatch.id,
          'required',
          true,
        )}
        <div class="form-grid">
          ${field('Số lượng trả NCC (*)', 'qty', 1, 'number', 'required min="1" step="1"')}
          ${field('Mã PO gốc (tùy chọn, để giảm công nợ)', 'purchaseId', firstBatch.purchaseId || '', 'text', 'placeholder="VD: PN0001"')}
        </div>
        <label class="field full">
          <span>Lý do trả hàng NCC (*)</span>
          <textarea name="reason" required minlength="3" maxlength="300" placeholder="VD: Hàng lỗi nhà sản xuất, giao sai quy cách, bao bì móp méo…"></textarea>
        </label>
        ${formError()}
      </div>
      <div class="modal-footer">
        ${action('close-modal', 'Hủy')}
        <button class="btn danger" type="submit">${icon('return')}Gửi phiếu trả NCC</button>
      </div>
    </form>`,
    true,
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
    editingPo ? `Sửa đơn đặt hàng nháp · ${e(editingPo.id)}` : 'Tạo đơn đặt hàng / phiếu nhập (Draft)',
    `<form id="purchase-api-form">
      <div class="modal-content stack">
        <div class="note">
          Phiếu lưu ở trạng thái <strong>Nháp (Draft)</strong> — có thể gửi qua Cổng NCC để thương lượng 2 chiều hoặc Quản lý duyệt nhập kho trực tiếp. Sản phẩm có HSD bắt buộc nhập <strong>Hạn sử dụng (*)</strong>.
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
          ${field('Đơn giá nhập (₫) (*)', 'unitCost', 0, 'number', 'id="purchase-price" min="0" step="1"')}
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
  const products = (apiState.products || []).filter((p) => p.status === 'DangKinhDoanh' && p.supplierId === sid);
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
          <td><input class="purchase-line-input purchase-line-price" type="number" min="0" step="1" required value="${i.unitCost}" data-purchase-field="unitCost" data-index="${index}" aria-label="Đơn giá nhập ${e(i.name)}"></td>
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

async function purchaseDetail(purchaseId, isPortal = false) {
  const res = isPortal ? await api.getSupplierPortalPurchase(purchaseId) : await api.getPurchase(purchaseId);
  const po = res.item;
  if (!po) throw new Error('Không tìm thấy đơn đặt hàng.');
  const canApprove = store.hasPermission('PURCHASE_APPROVE');
  const isDraft = po.status === 'Draft';

  showModal(
    `Chi tiết đơn đặt hàng (PO) · ${e(po.id)}`,
    `<div class="modal-content stack">
      <div class="detail-grid">
        <div><small>Mã PO</small><strong><code>${e(po.id)}</code></strong></div>
        <div><small>Trạng thái</small><div>${status(po.status)}</div></div>
        <div><small>Nhà cung cấp</small><strong>${e(po.supplierName)}</strong></div>
        <div><small>Người lập phiếu</small><strong>${e(po.createdByName)}</strong></div>
        <div><small>Ngày lập / Giao DK</small><strong>${date(po.createdAt)}${po.expectedDeliveryDate ? ` · Giao: ${dateOnly(po.expectedDeliveryDate)}` : ''}</strong></div>
        <div><small>Tiến độ nhận hàng</small><strong>${number(po.totalReceivedQty || 0)} / ${number(po.totalQty)} đv</strong></div>
      </div>
      ${table(
        ['Sản phẩm', 'Mã SKU', 'Đặt / Đã nhận', 'Đơn giá', 'Lô / HSD', 'Thành tiền'],
        (po.items || []).map(
          (i) => `<tr>
            <td class="name">
              <div class="product-cell">
                <div class="product-thumb">${productImage({ imageUrl: i.imageUrl, name: i.productName }, 'product-thumb-img')}</div>
                <div><strong>${e(i.productName)}</strong><div class="sub">${e(i.unitName)}</div></div>
              </div>
            </td>
            <td><code>${e(i.sku)}</code></td>
            <td class="right"><strong>${number(i.qty)}</strong> / ${number(i.receivedQty || 0)}</td>
            <td class="money">${money(i.unitCost)}</td>
            <td>${i.batchCode ? `<code>${e(i.batchCode)}</code><br>` : ''}<small>${i.expiryDate ? `HSD: ${dateOnly(i.expiryDate)}` : 'Không hạn'}</small></td>
            <td class="money"><strong>${money(i.lineTotal)}</strong></td>
          </tr>`,
        ),
      )}
      <div class="right"><strong>Tổng cộng (${number(po.totalQty)} sản phẩm): ${money(po.totalAmount)}</strong></div>
      ${
        (po.negotiations || []).length
          ? `<div class="note"><strong>Lịch sử thương lượng 2 chiều (${po.negotiations.length} vòng):</strong><br>${po.negotiations
              .map(
                (n) =>
                  `• Vòng ${n.roundNo} · <code>${e(n.action)}</code> bởi <strong>${e(n.actorName)}</strong> (${date(n.createdAt)}): ${e(n.note || '—')}`,
              )
              .join('<br>')}</div>`
          : ''
      }
      <p class="sub"><strong>Ghi chú:</strong> ${e(po.note || 'Không có ghi chú.')}</p>
    </div>
    <div class="modal-footer wrap">
      ${!isPortal && isDraft ? action('purchase-edit', 'Sửa nháp', 'edit', '', `data-id="${e(po.id)}"`) : ''}
      ${!isPortal && isDraft ? action('purchase-send', 'Gửi NCC', 'arrow', 'teal', `data-id="${e(po.id)}"`) : ''}
      ${!isPortal && po.status === 'NCCPhanHoi' && canApprove ? action('purchase-counter', 'Thương lượng lại', 'edit', 'warning', `data-id="${e(po.id)}"`) : ''}
      ${!isPortal && ['GuiNCC', 'NCCPhanHoi', 'ThuongLuong'].includes(po.status) && canApprove ? action('purchase-agree', 'Chốt thỏa thuận', 'check', 'teal', `data-id="${e(po.id)}"`) : ''}
      ${!isPortal && ['DaThongNhat', 'DangNhanHang'].includes(po.status) ? action('grn-new', 'Lập phiếu nhận (GRN)', 'truck', 'primary', `data-purchase-id="${e(po.id)}"`) : ''}
      ${!isPortal && isDraft && canApprove ? action('purchase-cancel', 'Hủy phiếu', 'trash', 'danger', `data-id="${e(po.id)}"`) : ''}
      ${!isPortal && isDraft && canApprove ? action('purchase-confirm', 'Duyệt nhập trực tiếp', 'check', 'primary', `data-id="${e(po.id)}"`) : ''}
      ${isPortal && ['GuiNCC', 'ThuongLuong'].includes(po.status) ? action('portal-respond', 'Phản hồi đơn hàng', 'check', 'primary', `data-id="${e(po.id)}"`) : ''}
      ${action('close-modal', 'Đóng')}
    </div>`,
    true,
  );
}
