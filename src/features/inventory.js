/* M2 + M3: Tồn kho, Thẻ kho bất biến (LichSuTonKho) & Kiểm kê kho (BR-06) kết nối SQLite. */
'use strict';

function inventoryView() {
  if (!apiState.productsLoaded && !apiState.loading.products) {
    loadProductsData();
  }
  if (inventoryTab === 'movements' && !apiState.stockMovementsLoaded && !apiState.loading.stockMovements) {
    loadStockMovementsData();
  }
  if (inventoryTab === 'audits' && !apiState.stockAuditsLoaded && !apiState.loading.stockAudits) {
    loadStockAuditsData();
  }

  const canViewCost = store.hasPermission('PRODUCT_COST_VIEW');
  const canAuditCreate = store.hasPermission('INVENTORY_AUDIT');
  const canApprove = store.hasPermission('INVENTORY_APPROVE');
  const summary = apiState.productsSummary || {};
  const auditSummary = apiState.stockAuditsSummary || {};

  const tabs = [
    ['stock', 'Tồn kho hiện tại'],
    ['movements', 'Thẻ kho (LichSuTonKho)'],
    ['audits', `Phiếu kiểm kê${auditSummary.pendingCount ? ` (${auditSummary.pendingCount} chờ duyệt)` : ''}`],
  ];

  let content = '';
  if (inventoryTab === 'stock') {
    const list = apiState.products.filter(
      (p) =>
        match(`${p.name} ${p.sku} ${p.barcode}`, filters.inventory || '') &&
        (!filters.low || p.isLowStock || p.isOutOfStock),
    );
    const p = paginate(list, 'stock');
    const headers = [
      'Sản phẩm',
      'Mã SKU',
      'Tồn hiện tại',
      'Tồn tối thiểu',
      ...(canViewCost ? ['Giá vốn', 'Giá trị tồn'] : []),
      'Cảnh báo',
      'Thao tác',
    ];
    content = `<div class="table-tools">
      ${filterInput('inventory', 'Tìm tên, mã SKU hoặc mã vạch…')}
      ${filterSelect('low', [
        ['', 'Tất cả tồn kho'],
        ['yes', 'Sắp hết / Hết hàng (<= tối thiểu)'],
      ])}
    </div>
    ${table(
      headers,
      p.items.map((item) => {
        const alertBadge = item.isOutOfStock
          ? badge('Hết hàng', 'red')
          : item.isLowStock
            ? badge('Cần nhập thêm', 'yellow')
            : badge('Đủ hàng', 'green');
        return `<tr>
          <td class="name">
            <div class="product-cell">
              <div class="product-thumb">${productImage(item, 'product-thumb-img')}</div>
              <div>
                <strong>${e(item.name)}</strong>
                <div class="sub">${e(item.categoryName)} · ${e(item.unitName)}</div>
              </div>
            </div>
          </td>
          <td><code>${e(item.sku)}</code></td>
          <td class="${item.isLowStock || item.isOutOfStock ? 'negative' : 'name'}"><strong>${number(item.stockQty)}</strong> ${e(item.unitName)}</td>
          <td>${number(item.minStock)}</td>
          ${
            canViewCost
              ? `<td class="money">${money(item.costPrice)}</td><td class="money">${money(item.inventoryValue || item.stockQty * item.costPrice)}</td>`
              : ''
          }
          <td>${alertBadge}</td>
          <td>
            <div class="action-group">
              ${action('product-ledger', 'Thẻ kho', 'clock', 'xs', `data-id="${e(item.id)}"`)}
              ${canApprove ? action('product-stock-adjust', 'Điều chỉnh', 'edit', 'xs', `data-id="${e(item.id)}"`) : ''}
            </div>
          </td>
        </tr>`;
      }),
    )}${p.foot}`;
  }

  if (inventoryTab === 'movements') {
    const ledger = apiState.stockMovements || {
      items: [],
      total: 0,
      page: 1,
      totalPages: 1,
      docTypes: [],
      docTypeLabels: {},
    };
    const docOptions = [
      ['', 'Tất cả loại chứng từ'],
      ...(ledger.docTypes || []).map((dt) => [dt, ledger.docTypeLabels?.[dt] || dt]),
    ];
    content = `
      <div class="panel-body" style="padding-bottom:12px">
        <div class="note">
          <strong>Thẻ kho bất biến (LichSuTonKho):</strong> Mọi biến động khởi tạo tồn, nhập hàng (<code>NHAP_KHO</code>), kiểm kê (<code>KIEM_KE</code>), bán hàng, trả hàng đều được ghi tự động trong cùng Transaction và bảo vệ bất biến ở cả API lẫn SQLite Trigger.
        </div>
      </div>
      <div class="table-tools">
        ${filterInput('moveSearch', 'Tìm SKU, tên sản phẩm, mã chứng từ, ghi chú…')}
        ${filterSelect('moveDocType', docOptions)}
        <input id="filter-moveFrom" data-filter="moveFrom" type="date" value="${e(filters.moveFrom || '')}" aria-label="Từ ngày" title="Từ ngày">
        <input id="filter-moveTo" data-filter="moveTo" type="date" value="${e(filters.moveTo || '')}" aria-label="Đến ngày" title="Đến ngày">
        ${action('stock-movements-reset', 'Đặt lại', 'return', 'small')}
      </div>
      ${
        apiState.stockMovementError
          ? `<div class="panel-body"><div class="note yellow" role="alert"><strong>Lỗi bộ lọc:</strong> ${e(apiState.stockMovementError)}</div></div>`
          : ''
      }
      ${
        apiState.loading.stockMovements && !apiState.stockMovementsLoaded
          ? '<div class="panel-body"><div class="note">Đang tải dữ liệu Thẻ kho từ CSDL…</div></div>'
          : table(
              ['Thời gian', 'Sản phẩm / SKU', 'Tồn trước', 'Biến động', 'Tồn sau', 'Loại chứng từ', 'Mã CT', 'Người thực hiện', 'Ghi chú'],
              (ledger.items || []).map(
                (m) => `<tr>
                  <td>${date(m.createdAt)}</td>
                  <td class="name">
                    <div class="product-cell">
                      <div class="product-thumb">${productImage({ imageUrl: m.imageUrl, name: m.productName }, 'product-thumb-img')}</div>
                      <div>
                        <strong>${e(m.productName)}</strong>
                        <div class="sub"><code>${e(m.sku)}</code> · ${e(m.unitName)}</div>
                      </div>
                    </div>
                  </td>
                  <td>${number(m.stockBefore)}</td>
                  <td class="${m.delta >= 0 ? 'positive' : 'negative'}"><strong>${m.delta > 0 ? '+' : ''}${number(m.delta)}</strong></td>
                  <td><strong>${number(m.stockAfter)}</strong></td>
                  <td><span class="badge blue">${e(m.docTypeLabel)}</span></td>
                  <td><code>${e(m.docId)}</code></td>
                  <td>${e(m.actorName)}</td>
                  <td class="wrap-cell">${e(m.note || '—')}</td>
                </tr>`,
              ),
            ) +
            `<div class="table-foot">
              <span>Tổng ${number(ledger.total || 0)} dòng thẻ kho</span>
              <div class="row gap8">
                ${action('stock-movements-page', '←', '', 'small', `data-delta="-1" ${(ledger.page || 1) <= 1 ? 'disabled' : ''}`)}
                <span>Trang ${ledger.page || 1} / ${ledger.totalPages || 1}</span>
                ${action('stock-movements-page', '→', '', 'small', `data-delta="1" ${(ledger.page || 1) >= (ledger.totalPages || 1) ? 'disabled' : ''}`)}
              </div>
            </div>`
      }`;
  }

  if (inventoryTab === 'audits') {
    const audits = apiState.stockAudits || [];
    const p = paginate(audits, 'audits');
    const headers = [
      'Mã kiểm kê',
      'Ngày lập',
      'Người kiểm kê',
      'SL SP kiểm',
      'SP có lệch',
      'Tổng chênh lệch',
      ...(canViewCost ? ['Giá trị lệch'] : []),
      'Trạng thái',
      'Thao tác',
    ];
    content = `
      <div class="panel-body" style="padding-bottom:12px">
        <div class="note">
          <strong>Quy tắc kiểm kê BR-06:</strong> <code>ChenhLech = TonThucTe - TonHeThong</code>; bắt buộc nhập <em>Lý do chênh lệch</em> nếu có chênh lệch. Tồn kho chỉ được điều chỉnh &amp; ghi <code>LichSuTonKho</code> (<code>KIEM_KE</code>) khi Quản lý/Admin phê duyệt.
        </div>
      </div>
      <div class="table-tools">
        ${filterInput('auditListSearch', 'Tìm mã phiếu, sản phẩm, SKU, người lập, lý do…')}
        ${filterSelect('auditListStatus', [
          ['', 'Tất cả trạng thái'],
          ['ChoDuyet', 'Chờ duyệt kiểm kê'],
          ['DaDuyet', 'Đã duyệt điều chỉnh'],
          ['DaHuy', 'Đã hủy'],
        ])}
        <input id="filter-auditListFrom" data-filter="auditListFrom" type="date" value="${e(filters.auditListFrom || '')}" aria-label="Từ ngày" title="Từ ngày">
        <input id="filter-auditListTo" data-filter="auditListTo" type="date" value="${e(filters.auditListTo || '')}" aria-label="Đến ngày" title="Đến ngày">
        ${action('stock-audits-reset', 'Đặt lại', 'return', 'small')}
      </div>
      ${
        apiState.stockAuditError
          ? `<div class="panel-body"><div class="note yellow" role="alert"><strong>Lỗi bộ lọc:</strong> ${e(apiState.stockAuditError)}</div></div>`
          : ''
      }
      ${
        apiState.loading.stockAudits && !apiState.stockAuditsLoaded
          ? '<div class="panel-body"><div class="note">Đang tải danh sách phiếu kiểm kê từ CSDL…</div></div>'
          : table(
              headers,
              p.items.map(
                (a) => `<tr>
                  <td class="name"><code>${e(a.id)}</code></td>
                  <td>${date(a.createdAt)}</td>
                  <td>${e(a.createdByName)}</td>
                  <td>${number(a.itemCount)} SP</td>
                  <td>${a.diffItemCount > 0 ? badge(`${a.diffItemCount} SP lệch`, 'yellow') : badge('Khớp 100%', 'green')}</td>
                  <td class="${a.totalDiffQty === 0 ? '' : a.totalDiffQty > 0 ? 'positive' : 'negative'}"><strong>${a.totalDiffQty > 0 ? '+' : ''}${number(a.totalDiffQty)}</strong></td>
                  ${canViewCost ? `<td class="money">${money(a.totalAbsDiffValue || 0)}</td>` : ''}
                  <td>${status(a.status)}</td>
                  <td>
                    <div class="action-group">
                      ${action('audit-detail', 'Xem', '', 'xs', `data-id="${e(a.id)}"`)}
                      ${a.status === 'ChoDuyet' && canApprove ? action('audit-approve', 'Duyệt', 'check', 'xs primary', `data-id="${e(a.id)}"`) : ''}
                    </div>
                  </td>
                </tr>`,
              ),
            ) + p.foot
      }`;
  }

  const currentStats = stats([
    ['Tổng số lượng tồn', number(summary.totalStockQty || 0), 'Đơn vị đang lưu kho', 'warehouse'],
    canViewCost
      ? ['Giá trị tồn kho', money(summary.totalInventoryValue || 0), 'Tính theo giá vốn bình quân', 'receipt']
      : ['Mặt hàng quản lý', number(summary.total || 0), 'Đồng bộ từ CSDL', 'box'],
    [
      'Cảnh báo tồn thấp (BR-01)',
      number(summary.lowStockCount || 0),
      `${number(summary.outOfStockCount || 0)} mặt hàng hết tồn`,
      'bell',
    ],
    [
      'Phiếu kiểm kê chờ duyệt',
      number(auditSummary.pendingCount || 0),
      `Tổng ${number(auditSummary.total || 0)} phiếu kiểm kê`,
      'shield',
    ],
  ]);

  return (
    heading(
      'QUẢN LÝ KHO / TỒN KHO, THẺ KHO & KIỂM KÊ',
      'Kho & Kiểm kê',
      'Theo dõi tồn kho thực tế, cảnh báo ngưỡng tối thiểu BR-01, tra cứu Thẻ kho bất biến và lập/duyệt phiếu kiểm kê BR-06.',
      canAuditCreate ? action('audit-new', 'Tạo phiếu kiểm kê', 'plus', 'primary') : '',
    ) +
    currentStats +
    `<div class="tabs">${tabs
      .map(
        ([key, label]) =>
          `<button type="button" class="${inventoryTab === key ? 'active' : ''}" data-action="inventory-tab" data-tab="${key}">${label}</button>`,
      )
      .join('')}</div><section class="panel"><div class="panel-head"><h2>${tabs.find((t) => t[0] === inventoryTab)[1]}</h2></div>${content}</section>`
  );
}

async function auditModal() {
  if (!apiState.productsLoaded) {
    await loadProductsData(true);
  }
  const products = apiState.products || [];
  if (!products.length) throw new Error('Chưa có sản phẩm nào để kiểm kê.');

  auditLines = [];
  modalContext = { type: 'audit-api' };
  const firstProd = products[0];

  showModal(
    'Lập phiếu kiểm kê kho (BR-06)',
    `<form id="audit-api-form">
      <div class="modal-content stack">
        <div class="note">
          Chọn một hoặc nhiều sản phẩm để kiểm đếm. Hệ thống tự tính <strong>Chênh lệch = Tồn thực tế − Tồn hệ thống</strong>; bắt buộc nhập <strong>Lý do chênh lệch (*)</strong> nếu chênh lệch khác 0. Phiếu lưu ở trạng thái <strong>Chờ duyệt</strong>.
        </div>
        <div class="form-grid">
          ${selectField(
            'Chọn sản phẩm cần kiểm kê (*)',
            'productId',
            products.map((p) => [p.id, `${p.sku} · ${p.name} (Tồn HT: ${number(p.stockQty)} ${p.unitName})`]),
            firstProd.id,
            'id="audit-product-select"',
            true,
          )}
          ${field('Tồn thực tế đếm được (*)', 'actualQty', firstProd.stockQty, 'number', 'id="audit-actual-input" min="0" step="1"')}
          ${field('Lý do chênh lệch (bắt buộc nếu lệch)', 'lineReason', '', 'text', 'id="audit-reason-input" placeholder="VD: Hỏng bao bì, thất thoát, đếm thừa…"')}
        </div>
        <div>
          ${action('audit-line-add', 'Thêm sản phẩm vào phiếu', 'plus', 'small')}
        </div>
        <div id="audit-lines"></div>
        ${textField('Ghi chú / Số biên bản kiểm kê', 'note', 'Kiểm kê định kỳ kho cửa hàng')}
        ${formError()}
      </div>
      <div class="modal-footer">
        ${action('close-modal', 'Hủy')}
        <button class="btn primary" type="submit">${icon('check')}Lưu phiếu kiểm kê</button>
      </div>
    </form>`,
    true,
  );
  renderAuditLines();
}

function renderAuditLines() {
  const host = $('#audit-lines');
  if (!host) return;
  host.innerHTML = table(
    ['Mã SKU', 'Sản phẩm', 'Tồn HT', 'Tồn thực tế (*)', 'Chênh lệch', 'Lý do chênh lệch', ''],
    auditLines.map((line, index) => {
      const diff = line.actualQty - line.systemQty;
      const diffCls = diff === 0 ? '' : diff > 0 ? 'positive' : 'negative';
      return `<tr>
        <td><code>${e(line.sku)}</code></td>
        <td class="name">${e(line.name)}</td>
        <td><strong>${number(line.systemQty)}</strong></td>
        <td><input class="purchase-line-input" type="number" min="0" step="1" required value="${line.actualQty}" data-audit-field="actualQty" data-index="${index}" aria-label="Tồn thực tế ${e(line.name)}"></td>
        <td class="${diffCls}"><strong>${diff > 0 ? '+' : ''}${number(diff)}</strong></td>
        <td><input type="text" value="${e(line.reason || '')}" data-audit-field="reason" data-index="${index}" placeholder="${diff !== 0 ? 'Bắt buộc nhập lý do (*)' : 'Không bắt buộc (khớp)'}" ${diff !== 0 ? 'required' : ''} aria-label="Lý do chênh lệch ${e(line.name)}"></td>
        <td>${ib('audit-line-delete', 'trash', 'Xóa dòng kiểm kê', `data-index="${index}"`)}</td>
      </tr>`;
    }),
  );
}

async function auditDetailModal(auditId) {
  const res = await api.getStockAudit(auditId);
  const a = res.item;
  if (!a) throw new Error('Không tìm thấy phiếu kiểm kê.');
  const canApprove = store.hasPermission('INVENTORY_APPROVE');
  const canViewCost = store.hasPermission('PRODUCT_COST_VIEW');
  const isPending = a.status === 'ChoDuyet';

  const headers = [
    'Sản phẩm',
    'SKU',
    'Tồn HT (lúc kiểm)',
    'Tồn thực tế',
    'Chênh lệch',
    ...(canViewCost ? ['Giá trị lệch'] : []),
    'Lý do chênh lệch',
  ];

  showModal(
    `Chi tiết phiếu kiểm kê · ${e(a.id)}`,
    `<div class="modal-content stack">
      <div class="detail-grid">
        <div><small>Mã phiếu kiểm kê</small><strong><code>${e(a.id)}</code></strong></div>
        <div><small>Trạng thái</small><div>${status(a.status)}</div></div>
        <div><small>Người lập kiểm kê</small><strong>${e(a.createdByName)}</strong></div>
        <div><small>Thời gian lập</small><strong>${date(a.createdAt)}</strong></div>
        <div><small>${a.status === 'DaHuy' ? 'Người / Ngày hủy' : 'Người / Ngày duyệt'}</small><strong>${
          a.approvedByName ? `${e(a.approvedByName)} · ${date(a.approvedAt)}` : 'Chưa duyệt'
        }</strong></div>
        <div><small>Ghi chú biên bản</small><strong>${e(a.note || '—')}</strong></div>
      </div>
      ${table(
        headers,
        (a.items || []).map(
          (i) => `<tr>
            <td class="name">
              <div class="product-cell">
                <div class="product-thumb">${productImage({ imageUrl: i.imageUrl, name: i.productName }, 'product-thumb-img')}</div>
                <div><strong>${e(i.productName)}</strong><div class="sub">${e(i.unitName)}</div></div>
              </div>
            </td>
            <td><code>${e(i.sku)}</code></td>
            <td>${number(i.systemQty)}</td>
            <td><strong>${number(i.actualQty)}</strong></td>
            <td class="${i.diffQty === 0 ? '' : i.diffQty > 0 ? 'positive' : 'negative'}"><strong>${i.diffQty > 0 ? '+' : ''}${number(i.diffQty)}</strong></td>
            ${canViewCost ? `<td class="money">${money(i.diffValue || 0)}</td>` : ''}
            <td class="wrap-cell">${e(i.reason || 'Khớp hệ thống')}</td>
          </tr>`,
        ),
      )}
      ${
        a.status === 'DaDuyet'
          ? '<div class="note green"><strong>Đã hoàn tất điều chỉnh tồn kho:</strong> Các dòng có chênh lệch đã cập nhật tồn thực tế và ghi Thẻ kho (<code>KIEM_KE</code>) trong 1 Transaction.</div>'
          : isPending && !canApprove
            ? '<div class="note yellow">Phiếu đang <strong>Chờ duyệt</strong>. Cần <strong>Quản lý cửa hàng</strong> hoặc <strong>Admin</strong> xác nhận để điều chỉnh tồn kho.</div>'
            : ''
      }
    </div>
    <div class="modal-footer">
      ${isPending && canApprove ? action('audit-cancel', 'Hủy phiếu', 'trash', 'danger', `data-id="${e(a.id)}"`) : ''}
      ${isPending && canApprove ? action('audit-approve', 'Duyệt kiểm kê & Điều chỉnh tồn', 'check', 'primary', `data-id="${e(a.id)}"`) : ''}
      ${action('close-modal', 'Đóng')}
    </div>`,
    true,
  );
}
