/* M2: Tồn kho & Thẻ kho bất biến (LichSuTonKho) kết nối SQLite + chuẩn bị Kiểm kê M3. */
'use strict';

function inventoryView() {
  if (!apiState.productsLoaded && !apiState.loading.products) {
    loadProductsData();
  }
  if (inventoryTab === 'movements' && !apiState.stockMovementsLoaded && !apiState.loading.stockMovements) {
    loadStockMovementsData();
  }

  const s = store.data;
  const canViewCost = store.hasPermission('PRODUCT_COST_VIEW');
  const canAdjustStock = store.hasPermission('INVENTORY_APPROVE');
  const summary = apiState.productsSummary || {};
  const expiredCount = s.products.filter(
    (p) => getExpiryInfo && getExpiryInfo(p.expiryDate).status === 'expired' && p.stock > 0,
  ).length;

  const tabs = [
    ['stock', 'Tồn kho hiện tại'],
    ['movements', 'Thẻ kho (LichSuTonKho)'],
    ['audits', 'Phiếu kiểm kê'],
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
            <div class="row gap8">
              ${action('product-ledger', 'Thẻ kho', 'clock', 'small', `data-id="${e(item.id)}"`)}
              ${canAdjustStock ? action('product-stock-adjust', 'Điều chỉnh', 'edit', 'small', `data-id="${e(item.id)}"`) : ''}
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
          <strong>Thẻ kho bất biến (LichSuTonKho):</strong> Mọi biến động khởi tạo tồn, điều chỉnh, nhập hàng, bán hàng, trả hàng, kiểm kê đều được ghi tự động trong cùng Transaction và nghiêm cấm sửa/xóa.
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
    const p = paginate(
      s.audits.flatMap((a) =>
        a.items.map((i) => ({
          ...a,
          auditId: a.id,
          auditStatus: a.status || 'resolved',
          productId: i.id,
          productName: i.name,
          before: i.previous,
          counted: i.actual,
          delta: i.delta,
          diffValue: i.diffValue || Math.abs(i.delta) * (i.costPrice || 0),
          resolution: i.resolutionAction || i.resolution || (i.delta < 0 ? 'damage_writeoff' : 'surplus_adjust'),
          responsibleStaff: i.responsibleStaff || a.actor || '',
          reason: a.note,
        })),
      ),
      'audits',
    );
    content =
      table(
        [
          'Mã kiểm kê',
          'Ngày',
          'Sản phẩm',
          'Tồn trước',
          'Thực tế',
          'Lệch',
          'Trị giá lệch',
          'Lý do / Biên bản',
          'Người thực hiện',
          'Trạng thái',
        ],
        p.items.map(
          (a) =>
            `<tr><td>${e(a.auditId)}</td><td>${date(a.time)}</td><td class="name">${e(a.productName)}</td><td>${a.before}</td><td>${a.counted}</td><td class="${a.delta >= 0 ? 'positive' : 'negative'}"><strong>${a.delta > 0 ? '+' : ''}${a.delta}</strong></td><td class="money">${money(a.diffValue || 0)}</td><td>${e(a.reason)}</td><td>${e(a.responsibleStaff || 'Ca trực kho')}</td><td>${a.auditStatus === 'pending_resolution' ? badge('Chờ duyệt', 'yellow') : badge('Đã duyệt', 'green')}</td></tr>`,
        ),
      ) + p.foot;
  }

  const currentStats = stats([
    ['Tổng số lượng tồn', number(summary.totalStockQty || 0), 'Đơn vị đang lưu kho', 'warehouse'],
    canViewCost
      ? ['Giá trị tồn kho', money(summary.totalInventoryValue || 0), 'Tính theo giá vốn hiện tại', 'receipt']
      : ['Mặt hàng quản lý', number(summary.total || 0), 'Đồng bộ từ CSDL', 'box'],
    [
      'Cảnh báo tồn thấp (BR-01)',
      number(summary.lowStockCount || 0),
      `${number(summary.outOfStockCount || 0)} mặt hàng hết tồn`,
      'bell',
    ],
    ['Dòng Thẻ kho', number(apiState.stockMovements.total || summary.total || 0), 'LichSuTonKho bất biến', 'shield'],
  ]);

  return (
    heading(
      'QUẢN LÝ KHO / TỒN KHO & THẺ KHO',
      'Kho & Kiểm kê',
      'Theo dõi tồn kho thực tế, cảnh báo ngưỡng tối thiểu BR-01 và tra cứu Thẻ kho (LichSuTonKho) bất biến.',
      action('audit-new', 'Tạo phiếu kiểm kê', 'plus', 'primary') +
        (expiredCount > 0
          ? action('audit-expired-products', `Kiểm tra ${expiredCount} SP hết hạn`, 'trash', 'danger')
          : ''),
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

function auditModal() {
  store.require('inventory');
  modalContext = { type: 'audit' };
  const firstProd = store.data.products[0];
  showModal(
    'Kiểm kê tồn kho',
    `<form id="audit-form"><div class="modal-content stack">
      <div class="form-grid">
        ${selectField(
          'Chọn sản phẩm cần kiểm kê (*)',
          'productId',
          store.data.products.map((p) => [p.id, `${p.name} (Tồn HT: ${p.stock})`]),
          firstProd?.id,
          'id="audit-product-select" required',
          true,
        )}
        ${field('Số lượng thực đếm (*)', 'counted', firstProd?.stock || 0, 'number', 'id="audit-counted-input" required min="0" step="1"', true)}
      </div>
      <div>${textField('Lý do chi tiết & Số biên bản kiểm kê (*)', 'reason', 'Kiểm kê định kỳ cửa hàng')}</div>
      ${formError()}
    </div><div class="modal-footer">${action('close-modal', 'Hủy')}<button class="btn primary" type="submit">${icon('check')}Lưu</button></div></form>`,
  );
}
