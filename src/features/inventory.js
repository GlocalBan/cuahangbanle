/* M2 + M3 + Phase 2: Tồn kho, Hàng cận date & Hủy hàng, Thẻ kho bất biến (có Mã lô) & Kiểm kê mù/2 vòng (BR-06). */
'use strict';

const AUDIT_REASON_OPTIONS = [
  ['', '— Chọn mã lý do chuẩn —'],
  ['MAT_HANG', 'MAT_HANG · Mất hàng / Thất thoát'],
  ['HU_HONG', 'HU_HONG · Hư hỏng / Bể vỡ'],
  ['HET_HAN', 'HET_HAN · Hết hạn sử dụng'],
  ['NHAP_XUAT_SAI', 'NHAP_XUAT_SAI · Sai sót nhập/xuất sổ sách'],
  ['NHAM_DEM', 'NHAM_DEM · Nhầm lẫn đếm kiểm kê'],
  ['KHAC', 'KHAC · Lý do khác (nhập chi tiết)'],
];

function inventoryView() {
  if (!apiState.productsLoaded && !apiState.loading.products) {
    loadProductsData();
  }
  if (!apiState.categoriesLoaded && !apiState.loading.catalogMeta) {
    loadCatalogMeta();
  }
  if (!apiState.nearExpiryLoaded && !apiState.loading.nearExpiry) {
    loadNearExpiryData();
  }
  if (inventoryTab === 'movements' && !apiState.stockMovementsLoaded && !apiState.loading.stockMovements) {
    loadStockMovementsData();
  }
  if (!apiState.stockAuditsLoaded && !apiState.loading.stockAudits) {
    loadStockAuditsData();
  }

  const canViewCost = store.hasPermission('PRODUCT_COST_VIEW');
  const canAuditCreate = store.hasPermission('INVENTORY_AUDIT');
  const canApprove = store.hasPermission('INVENTORY_APPROVE');
  const summary = apiState.productsSummary || {};
  const auditSummary = apiState.stockAuditsSummary || {};
  const nearSummary = apiState.nearExpiry?.summary || {};
  const woSummary = apiState.writeoffsSummary || {};

  const tabs = [
    ['stock', 'Tồn kho hiện tại'],
    [
      'near-expiry',
      `Hàng cận date & Hủy hàng${nearSummary.expiredCount || nearSummary.nearExpiryCount ? ` (${(nearSummary.expiredCount || 0) + (nearSummary.nearExpiryCount || 0)})` : ''}`,
    ],
    ['movements', 'Thẻ kho (LichSuTonKho)'],
    [
      'audits',
      `Phiếu kiểm kê${auditSummary.pendingCount || auditSummary.countingCount || auditSummary.recountCount ? ` (${(auditSummary.pendingCount || 0) + (auditSummary.countingCount || 0) + (auditSummary.recountCount || 0)})` : ''}`,
    ],
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
      'Tồn khả dụng',
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

  if (inventoryTab === 'near-expiry') {
    const batches = apiState.nearExpiry?.items || [];
    const bp = paginate(batches, 'near-expiry');
    const writeoffs = apiState.writeoffs || [];
    const wp = paginate(writeoffs, 'writeoffs');
    const catOptions = [['', 'Tất cả danh mục'], ...(apiState.categories || []).map((c) => [c.code, c.name])];

    content = `
      <div class="panel-body" style="padding-bottom:10px">
        <div class="stats" style="margin-bottom:12px">
          <div class="panel stat"><div class="stat-label">Lô đã hết hạn (khóa POS)</div><div class="money"><h2 class="stat-value negative">${number(nearSummary.expiredCount || 0)} lô</h2></div><p class="sub stat-foot">${number(nearSummary.expiredQty || 0)} đv${canViewCost ? ` · Vốn ${money(nearSummary.expiredCostValue || 0)}` : ''}</p></div>
          <div class="panel stat"><div class="stat-label">Lô cận date (≤${nearSummary.warnDays || 14} ngày)</div><div class="money"><h2 class="stat-value">${number(nearSummary.nearExpiryCount || 0)} lô</h2></div><p class="sub stat-foot">${number(nearSummary.nearExpiryQty || 0)} đv${canViewCost ? ` · Vốn ${money(nearSummary.nearExpiryCostValue || 0)}` : ''}</p></div>
          ${
            canViewCost
              ? `<div class="panel stat"><div class="stat-label">Tổng vốn rủi ro (Hết hạn + Cận date)</div><div class="money"><h2 class="stat-value negative">${money(nearSummary.atRiskCostValue || 0)}</h2></div><p class="sub stat-foot">Nên xả KM cận date hoặc lập phiếu hủy</p></div>`
              : `<div class="panel stat"><div class="stat-label">Tổng SL rủi ro</div><div class="money"><h2 class="stat-value">${number(nearSummary.totalQty || 0)} đv</h2></div><p class="sub stat-foot">Theo dõi xuất bán FEFO</p></div>`
          }
          <div class="panel stat"><div class="stat-label">Phiếu hủy hàng chờ duyệt</div><div class="money"><h2 class="stat-value">${number(woSummary.pendingCount || 0)} phiếu</h2></div><p class="sub stat-foot">${canViewCost ? `Đã duyệt hủy: ${money(woSummary.totalApprovedLoss || 0)}` : `Tổng ${number(woSummary.total || 0)} phiếu`}</p></div>
        </div>
        <div class="note yellow">
          <strong>FEFO &amp; Khóa bán hàng hết hạn:</strong> Lô <code>HetHan</code> bị tự động khóa khỏi tồn khả dụng POS (không thể bán cho khách). Lập <strong>Phiếu hủy hàng</strong> và chờ Quản lý/Admin duyệt để xuất hủy (<code>HUY_HANG</code>) và hạch toán hao hụt.
        </div>
      </div>
      <div class="table-tools wrap">
        ${filterSelect('nearExpiryDays', [
          ['', 'Mặc định (THAM_SO)'],
          ['7', 'Trong 7 ngày tới'],
          ['14', 'Trong 14 ngày tới'],
          ['30', 'Trong 30 ngày tới'],
          ['60', 'Trong 60 ngày tới'],
        ])}
        ${filterSelect('nearExpiryCategory', catOptions)}
        ${filterSelect('nearExpiryIncludeExpired', [
          ['yes', 'Gồm cả lô đã hết hạn'],
          ['no', 'Chỉ lô cận date (chưa hết hạn)'],
        ])}
        ${canAuditCreate ? action('writeoff-new', 'Lập phiếu hủy hàng', 'trash', 'danger small') : ''}
      </div>
      ${
        apiState.loading.nearExpiry && !apiState.nearExpiryLoaded
          ? '<div class="panel-body"><div class="note">Đang tải danh sách lô cận date &amp; hết hạn…</div></div>'
          : table(
              ['Sản phẩm', 'Mã lô', 'HSD', 'Còn lại', 'SL tồn lô', ...(canViewCost ? ['Giá trị vốn'] : []), 'Trạng thái', 'Thao tác'],
              bp.items.map((b) => {
                const daysTxt =
                  b.daysLeft === null
                    ? '—'
                    : b.daysLeft <= 0
                      ? `<span class="negative"><strong>Quá hạn ${Math.abs(b.daysLeft)} ngày</strong></span>`
                      : `<strong>${b.daysLeft} ngày</strong>`;
                return `<tr>
                  <td class="name">
                    <div class="product-cell">
                      <div class="product-thumb">${productImage({ imageUrl: b.imageUrl, thumbUrl: b.thumbUrl, name: b.productName }, 'product-thumb-img')}</div>
                      <div><strong>${e(b.productName)}</strong><div class="sub"><code>${e(b.sku)}</code> · ${e(b.categoryName || '')}</div></div>
                    </div>
                  </td>
                  <td><code>${e(b.batchCode)}</code></td>
                  <td>${dateOnly(b.expiryDate)}</td>
                  <td>${daysTxt}</td>
                  <td><strong>${number(b.qtyRemaining)}</strong> ${e(b.unitName || '')}</td>
                  ${canViewCost ? `<td class="money">${money(b.atRiskCostValue)}</td>` : ''}
                  <td>${status(b.status)}</td>
                  <td>
                    ${
                      canAuditCreate && b.qtyRemaining > 0
                        ? action('writeoff-new', 'Lập hủy', 'trash', 'xs danger', `data-batch-id="${e(b.id)}"`)
                        : '<span class="sub">—</span>'
                    }
                  </td>
                </tr>`;
              }),
            ) + bp.foot
      }
      <div class="panel-head" style="border-top:1px solid #e2e8f0;margin-top:8px">
        <div>
          <h3>Danh sách phiếu xuất hủy hàng (${number(writeoffs.length)})</h3>
          <p class="sub">Duyệt phiếu hủy sẽ trừ tồn lô, đồng bộ tồn sản phẩm, ghi Thẻ kho <code>HUY_HANG</code> trong 1 Transaction.</p>
        </div>
        ${filterSelect('writeoffStatus', [
          ['', 'Tất cả trạng thái'],
          ['ChoDuyet', 'Chờ duyệt hủy'],
          ['DaDuyet', 'Đã duyệt hủy'],
          ['DaHuy', 'Đã hủy phiếu'],
        ])}
      </div>
      ${
        table(
          ['Mã phiếu hủy', 'Ngày lập', 'Người lập', 'SL hủy', ...(canViewCost ? ['Giá trị hao hụt'] : []), 'Lý do', 'Trạng thái', 'Thao tác'],
          wp.items.map(
            (wo) => `<tr>
              <td class="name"><code>${e(wo.id)}</code></td>
              <td>${date(wo.createdAt)}</td>
              <td>${e(wo.createdByName)}</td>
              <td><strong>${number(wo.totalQty)}</strong> đv (${wo.itemCount} lô)</td>
              ${canViewCost ? `<td class="money negative">${money(wo.totalValue)}</td>` : ''}
              <td class="wrap-cell">${e(wo.reason)}</td>
              <td>${status(wo.status)}</td>
              <td>
                <div class="action-group">
                  ${wo.status === 'ChoDuyet' && canApprove ? action('writeoff-approve', 'Duyệt hủy', 'check', 'xs primary', `data-id="${e(wo.id)}"`) : ''}
                  ${wo.status === 'ChoDuyet' && canApprove ? action('writeoff-cancel', 'Hủy phiếu', 'close', 'xs danger', `data-id="${e(wo.id)}"`) : ''}
                  ${wo.status !== 'ChoDuyet' ? '<span class="sub">Đã khóa</span>' : !canApprove ? '<span class="sub">Chờ QL duyệt</span>' : ''}
                </div>
              </td>
            </tr>`,
          ),
        ) + wp.foot
      }`;
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
          <strong>Thẻ kho bất biến (LichSuTonKho):</strong> Mọi biến động nhập kho (<code>NHAP_KHO</code>), bán hàng FEFO (<code>BAN_HANG</code>), trả hàng, xuất hủy (<code>HUY_HANG</code>), trả NCC (<code>TRA_NCC</code>), kiểm kê (<code>KIEM_KE</code>) đều gắn <strong>Mã lô</strong> và bảo vệ bất biến bởi SQLite Trigger.
        </div>
      </div>
      <div class="table-tools">
        ${filterInput('moveSearch', 'Tìm SKU, tên sản phẩm, mã lô, mã chứng từ, ghi chú…')}
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
              ['Thời gian', 'Sản phẩm / SKU', 'Mã lô', 'Tồn trước', 'Biến động', 'Tồn sau', 'Loại CT', 'Mã CT', 'Người TH', 'Ghi chú'],
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
                  <td>${m.batchCode ? `<code>${e(m.batchCode)}</code>` : '<span class="sub">—</span>'}</td>
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
      'Người lập / Kiểm',
      'SL SP',
      'SP có lệch',
      'Tổng chênh lệch',
      ...(canViewCost ? ['Giá trị lệch'] : []),
      'Trạng thái',
      'Thao tác',
    ];
    content = `
      <div class="panel-body" style="padding-bottom:12px">
        <div class="note">
          <strong>Kiểm kê mù &amp; Tách biệt nhiệm vụ (BR-06):</strong> Phiếu kiểm mù (<code>DangDem</code>) ẩn tồn hệ thống với nhân viên đếm; lệch vượt ngưỡng tự chuyển <strong>Đếm lại vòng 2</strong> (bắt buộc người khác đếm); <strong>cấm tự duyệt</strong>; lệch ≥ 2.000.000 ₫ yêu cầu Admin duyệt; tự đối chiếu biến động phát sinh sau chốt sổ khi duyệt.
        </div>
      </div>
      <div class="table-tools wrap">
        ${filterInput('auditListSearch', 'Tìm mã phiếu, sản phẩm, SKU, người lập, lý do…')}
        ${filterSelect('auditListStatus', [
          ['', 'Tất cả trạng thái'],
          ['DangDem', 'Đang đếm mù (Vòng 1)'],
          ['ChoDemLai', 'Chờ đếm lại (Vòng 2)'],
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
              p.items.map((a) => {
                const isBlind = a.status === 'DangDem';
                const canDoCount = isBlind && canAuditCreate;
                const canDoRecount = a.status === 'ChoDemLai' && canAuditCreate;
                const canDoApprove = a.status === 'ChoDuyet' && canApprove;
                return `<tr>
                  <td class="name"><code>${e(a.id)}</code>${a.requiresAdminApproval ? '<div class="sub"><span class="badge red">Cần Admin duyệt</span></div>' : ''}</td>
                  <td>${date(a.createdAt)}</td>
                  <td>${e(a.createdByName)}${a.assignedToName ? `<div class="sub">Đếm: ${e(a.assignedToName)}</div>` : ''}</td>
                  <td>${number(a.itemCount)} SP</td>
                  <td>${isBlind ? badge('Ẩn khi đếm mù', 'blue') : a.diffItemCount > 0 ? badge(`${a.diffItemCount} SP lệch`, 'yellow') : badge('Khớp 100%', 'green')}</td>
                  <td class="${isBlind || a.totalDiffQty === 0 ? '' : a.totalDiffQty > 0 ? 'positive' : 'negative'}"><strong>${isBlind ? '—' : `${a.totalDiffQty > 0 ? '+' : ''}${number(a.totalDiffQty)}`}</strong></td>
                  ${canViewCost ? `<td class="money">${isBlind ? '—' : money(a.totalAbsDiffValue || 0)}</td>` : ''}
                  <td>${status(a.status)}</td>
                  <td>
                    <div class="action-group">
                      ${action('audit-detail', 'Xem', 'eye', 'xs', `data-id="${e(a.id)}"`)}
                      ${canDoCount ? action('audit-count', 'Nhập đếm V1', 'edit', 'xs primary', `data-id="${e(a.id)}"`) : ''}
                      ${canDoRecount ? action('audit-recount', 'Đếm lại V2', 'return', 'xs warning', `data-id="${e(a.id)}"`) : ''}
                      ${canDoApprove ? action('audit-approve', 'Duyệt', 'check', 'xs primary', `data-id="${e(a.id)}"`) : ''}
                    </div>
                  </td>
                </tr>`;
              }),
            ) + p.foot
      }`;
  }

  const currentStats = stats([
    ['Tổng số lượng tồn', number(summary.totalStockQty || 0), 'Đơn vị khả dụng đang lưu kho', 'warehouse'],
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
      'Kiểm kê đang xử lý',
      number((auditSummary.countingCount || 0) + (auditSummary.recountCount || 0) + (auditSummary.pendingCount || 0)),
      `${number(auditSummary.pendingCount || 0)} chờ duyệt · ${number(auditSummary.total || 0)} tổng phiếu`,
      'shield',
    ],
  ]);

  const headActions =
    (canAuditCreate ? action('audit-new-blind', 'Tạo kiểm kê mù', 'shield', 'teal') : '') +
    (canAuditCreate ? action('audit-new', 'Kiểm kê nhanh', 'plus', 'primary') : '');

  return (
    heading(
      'QUẢN LÝ KHO / TỒN KHO, LÔ HSD, THẺ KHO & KIỂM KÊ',
      'Kho & Kiểm kê',
      'Quản lý tồn khả dụng, lô cận date & phiếu hủy hàng, Thẻ kho bất biến theo mã lô và quy trình kiểm kê mù 2 vòng phân cấp duyệt.',
      headActions,
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

async function writeOffModal(prefillBatchId = '') {
  if (!apiState.nearExpiryLoaded) await loadNearExpiryData(true);
  const res = await api.listBatches({});
  const batches = (res.items || []).filter((b) => Number(b.qtyRemaining) > 0 && b.status !== 'DaHuy');
  if (!batches.length) throw new Error('Không còn lô hàng nào có tồn để lập phiếu xuất hủy.');
  const selected = (prefillBatchId && batches.find((b) => b.id === prefillBatchId)) || batches[0];
  modalContext = { type: 'writeoff-api' };

  showModal(
    'Lập phiếu xuất hủy hàng (Cận date / Hết hạn / Hư hỏng)',
    `<form id="writeoff-api-form">
      <div class="modal-content stack">
        <div class="note yellow">
          Phiếu hủy được tạo ở trạng thái <strong>Chờ duyệt</strong>. Khi Quản lý/Admin phê duyệt, hệ thống trừ tồn lô, đồng bộ tồn sản phẩm và ghi Thẻ kho <code>HUY_HANG</code> trong 1 Transaction.
        </div>
        ${selectField(
          'Chọn lô hàng cần xuất hủy (*)',
          'batchId',
          batches.map((b) => [
            b.id,
            `${b.batchCode} · ${b.productName} (${b.sku}) · HSD: ${b.expiryDate || 'Không hạn'} · Tồn lô: ${b.qtyRemaining}`,
          ]),
          selected.id,
          'id="writeoff-batch-select" required',
          true,
        )}
        ${field('Số lượng xuất hủy (*)', 'qty', selected.qtyRemaining, 'number', `id="writeoff-qty" required min="1" max="${selected.qtyRemaining}" step="1"`)}
        <label class="field full">
          <span>Lý do xuất hủy hàng (*)</span>
          <textarea name="reason" required minlength="3" maxlength="300" placeholder="VD: Hết hạn sử dụng, bao bì rách/hư hỏng trong kho…">${selected.isExpired ? 'Hàng hết hạn sử dụng — xuất hủy theo quy trình kho' : ''}</textarea>
        </label>
        ${formError()}
      </div>
      <div class="modal-footer">
        ${action('close-modal', 'Hủy')}
        <button class="btn danger" type="submit">${icon('trash')}Gửi phiếu hủy hàng</button>
      </div>
    </form>`,
    true,
  );
}

async function blindAuditModal() {
  if (!apiState.productsLoaded) await loadProductsData(true);
  if (!apiState.categoriesLoaded) await loadCatalogMeta(true);
  const catOptions = [['', '— Chọn danh mục —'], ...(apiState.categories || []).map((c) => [c.code, `${c.name} (${c.code})`])];
  const products = (apiState.products || []).filter((p) => p.status === 'DangKinhDoanh').slice(0, 60);
  modalContext = { type: 'audit-blind-create' };

  showModal(
    'Tạo phiếu kiểm kê mù (Blind Count · Ẩn tồn hệ thống)',
    `<form id="audit-blind-form">
      <div class="modal-content stack">
        <div class="note">
          Hệ thống đóng băng <strong>tồn sổ sách (snapshot)</strong> tại thời điểm tạo phiếu nhưng <strong>ẩn hoàn toàn số tồn hệ thống</strong> với nhân viên kho khi đếm vòng 1. Chênh lệch lớn sẽ tự động yêu cầu người khác đếm lại vòng 2.
        </div>
        <div class="form-grid">
          ${selectField(
            'Phạm vi kiểm kê (*)',
            'scopeType',
            [
              ['TUY_CHON', 'Chọn sản phẩm cụ thể bên dưới'],
              ['DANH_MUC', 'Theo danh mục hàng hóa'],
              ['TOAN_KHO', 'Mẫu toàn kho (tối đa 50 SKU)'],
            ],
            'TUY_CHON',
            'id="blind-scope-type" required',
          )}
          ${selectField('Danh mục (nếu chọn Theo danh mục)', 'scopeValue', catOptions, '', '')}
        </div>
        <div class="field full">
          <span>Chọn sản phẩm kiểm đếm (dùng cho Phạm vi tùy chọn):</span>
          <div style="max-height:200px;overflow:auto;border:1px solid #e2e8f0;border-radius:8px;padding:8px;display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:6px">
            ${products
              .map(
                (p, idx) => `<label class="check-label" style="font-size:12.5px">
                  <input type="checkbox" name="blindProductId" value="${e(p.id)}" ${idx < 3 ? 'checked' : ''}>
                  <span><code>${e(p.sku)}</code> · ${e(p.name)}</span>
                </label>`,
              )
              .join('')}
          </div>
        </div>
        ${textField('Ghi chú biên bản kiểm kê mù', 'note', 'Kiểm kê mù định kỳ ca kho')}
        ${formError()}
      </div>
      <div class="modal-footer">
        ${action('close-modal', 'Hủy')}
        <button class="btn teal" type="submit">${icon('shield')}Tạo phiếu kiểm mù</button>
      </div>
    </form>`,
    true,
  );
}

async function auditCountModal(auditId, isRecount = false) {
  const res = await api.getStockAudit(auditId);
  const a = res.item;
  if (!a) throw new Error('Không tìm thấy phiếu kiểm kê.');
  modalContext = { type: isRecount ? 'audit-recount' : 'audit-count', id: a.id };

  showModal(
    isRecount ? `Đếm lại vòng 2 · ${e(a.id)}` : `Nhập số lượng đếm mù vòng 1 · ${e(a.id)}`,
    `<form id="${isRecount ? 'audit-recount-form' : 'audit-count-form'}">
      <div class="modal-content stack">
        <div class="note ${isRecount ? 'yellow' : ''}">
          ${
            isRecount
              ? '<strong>Đếm lại vòng 2 (Độc lập):</strong> Bắt buộc người đếm vòng 2 KHÁC người đếm vòng 1. Chọn <strong>Mã lý do chuẩn</strong> cho mọi sản phẩm có chênh lệch.'
              : '<strong>Chế độ Kiểm mù (Blind Count):</strong> Số tồn sổ sách được ẩn để đảm bảo đếm thực tế khách quan. Nhập đúng số lượng đếm được trên kệ/kho.'
          }
        </div>
        ${table(
          isRecount
            ? ['Sản phẩm', 'Đếm V1', 'Số đếm V2 (*)', 'Mã lý do chuẩn', 'Chi tiết lý do']
            : ['Sản phẩm', 'SKU', 'ĐVT', 'Số lượng thực đếm (*)'],
          (a.items || []).map((i) =>
            isRecount
              ? `<tr>
                  <td class="name"><strong>${e(i.productName)}</strong><div class="sub"><code>${e(i.sku)}</code></div></td>
                  <td><strong>${i.round1Qty ?? '—'}</strong></td>
                  <td><input type="number" min="0" step="1" required value="${i.actualQty ?? i.round1Qty ?? 0}" data-recount-qty="${e(i.productId)}" style="width:90px"></td>
                  <td>
                    <select data-recount-reason-code="${e(i.productId)}">
                      ${AUDIT_REASON_OPTIONS.map(([val, lbl]) => `<option value="${val}" ${(i.reasonCode || '') === val ? 'selected' : ''}>${lbl}</option>`).join('')}
                    </select>
                  </td>
                  <td><input type="text" value="${e(i.reason || '')}" data-recount-reason="${e(i.productId)}" placeholder="Mô tả thêm (bắt buộc nếu KHAC)"></td>
                </tr>`
              : `<tr>
                  <td class="name"><strong>${e(i.productName)}</strong></td>
                  <td><code>${e(i.sku)}</code></td>
                  <td>${e(i.unitName)}</td>
                  <td><input type="number" min="0" step="1" required value="${i.actualQty ?? 0}" data-count-qty="${e(i.productId)}" style="width:100px" aria-label="Số đếm thực tế ${e(i.productName)}"></td>
                </tr>`,
          ),
        )}
        ${textField('Ghi chú vòng đếm', 'note', isRecount ? 'Hoàn tất đối chiếu vòng 2' : 'Hoàn tất đếm thực tế vòng 1')}
        ${formError()}
      </div>
      <div class="modal-footer">
        ${action('close-modal', 'Hủy')}
        <button class="btn primary" type="submit">${icon('check')}${isRecount ? 'Nộp kết quả vòng 2' : 'Nộp kết quả đếm vòng 1'}</button>
      </div>
    </form>`,
    true,
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
    'Lập phiếu kiểm kê nhanh (BR-06)',
    `<form id="audit-api-form">
      <div class="modal-content stack">
        <div class="note">
          Chọn một hoặc nhiều sản phẩm để kiểm đếm. Hệ thống tự tính <strong>Chênh lệch = Tồn thực tế − Tồn hệ thống</strong>; bắt buộc chọn <strong>Mã lý do chuẩn</strong> hoặc nhập lý do nếu chênh lệch khác 0.
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
          ${selectField('Mã lý do chênh lệch', 'lineReasonCode', AUDIT_REASON_OPTIONS, '', 'id="audit-reason-code-input"')}
          ${field('Chi tiết lý do chênh lệch', 'lineReason', '', 'text', 'id="audit-reason-input" placeholder="VD: Hỏng bao bì, thất thoát, đếm thừa…"', true)}
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
    ['Mã SKU', 'Sản phẩm', 'Tồn HT', 'Tồn thực tế (*)', 'Chênh lệch', 'Mã lý do / Diễn giải', ''],
    auditLines.map((line, index) => {
      const diff = line.actualQty - line.systemQty;
      const diffCls = diff === 0 ? '' : diff > 0 ? 'positive' : 'negative';
      return `<tr>
        <td><code>${e(line.sku)}</code></td>
        <td class="name">${e(line.name)}</td>
        <td><strong>${number(line.systemQty)}</strong></td>
        <td><input class="purchase-line-input" type="number" min="0" step="1" required value="${line.actualQty}" data-audit-field="actualQty" data-index="${index}" aria-label="Tồn thực tế ${e(line.name)}"></td>
        <td class="${diffCls}"><strong>${diff > 0 ? '+' : ''}${number(diff)}</strong></td>
        <td>
          ${line.reasonCode ? `<span class="badge blue" style="margin-bottom:4px">${e(line.reasonCode)}</span><br>` : ''}
          <input type="text" value="${e(line.reason || '')}" data-audit-field="reason" data-index="${index}" placeholder="${diff !== 0 ? 'Bắt buộc nhập lý do (*)' : 'Không bắt buộc (khớp)'}" ${diff !== 0 && !line.reasonCode ? 'required' : ''} aria-label="Lý do chênh lệch ${e(line.name)}">
        </td>
        <td>${ib('audit-line-delete', 'trash', 'Xóa dòng kiểm kê', `data-index="${index}"`)}</td>
      </tr>`;
    }),
  );
}

async function auditDetailModal(auditId) {
  const res = await api.getStockAudit(auditId);
  const a = res.item;
  if (!a) throw new Error('Không tìm thấy phiếu kiểm kê.');
  const canAuditCreate = store.hasPermission('INVENTORY_AUDIT');
  const canApprove = store.hasPermission('INVENTORY_APPROVE');
  const canViewCost = store.hasPermission('PRODUCT_COST_VIEW');
  const isBlindMasked = Boolean(a.isBlindMasked);
  const isPending = a.status === 'ChoDuyet';

  const headers = isBlindMasked
    ? ['Sản phẩm', 'SKU', 'Số đếm thực tế', 'Trạng thái kiểm mù']
    : [
        'Sản phẩm',
        'SKU',
        'Tồn chốt sổ',
        'Biến động sau chốt',
        'Tồn HT quy đổi',
        'Tồn thực tế',
        'Chênh lệch',
        ...(canViewCost ? ['Giá trị lệch'] : []),
        'Mã / Lý do',
      ];

  showModal(
    `Chi tiết phiếu kiểm kê · ${e(a.id)}`,
    `<div class="modal-content stack">
      <div class="detail-grid">
        <div><small>Mã phiếu kiểm kê</small><strong><code>${e(a.id)}</code></strong></div>
        <div><small>Trạng thái</small><div>${status(a.status)}</div></div>
        <div><small>Người lập phiếu</small><strong>${e(a.createdByName)}</strong></div>
        <div><small>Thời điểm chốt sổ</small><strong>${date(a.snapshotAt || a.createdAt)}</strong></div>
        <div><small>Người đếm V1 / V2</small><strong>${e(a.assignedToName || '—')}${a.recountByName ? ` / V2: ${e(a.recountByName)}` : ''}</strong></div>
        <div><small>${a.status === 'DaHuy' ? 'Người / Ngày hủy' : 'Người / Ngày duyệt'}</small><strong>${
          a.approvedByName ? `${e(a.approvedByName)} · ${date(a.approvedAt)}` : 'Chưa duyệt'
        }</strong></div>
      </div>
      ${
        isBlindMasked
          ? '<div class="note"><strong>Chế độ Kiểm mù:</strong> Cột tồn sổ sách và chênh lệch đang được ẩn với vai trò kiểm đếm cho đến khi nộp kết quả vòng 1.</div>'
          : ''
      }
      ${
        a.requiresAdminApproval && isPending
          ? '<div class="note red"><strong>Phân cấp duyệt Admin:</strong> Tổng giá trị chênh lệch vượt ngưỡng <code>NguongDuyetKiemKeAdmin</code> — chỉ Quản trị viên (Admin) khác người lập/đếm mới được phê duyệt.</div>'
          : ''
      }
      ${table(
        headers,
        (a.items || []).map((i) =>
          isBlindMasked
            ? `<tr>
                <td class="name">
                  <div class="product-cell">
                    <div class="product-thumb">${productImage({ imageUrl: i.imageUrl, name: i.productName }, 'product-thumb-img')}</div>
                    <div><strong>${e(i.productName)}</strong><div class="sub">${e(i.unitName)}</div></div>
                  </div>
                </td>
                <td><code>${e(i.sku)}</code></td>
                <td><strong>${i.actualQty === null || i.actualQty === undefined ? 'Chưa đếm' : number(i.actualQty)}</strong></td>
                <td>${badge('Đang ẩn số sổ sách', 'blue')}</td>
              </tr>`
            : `<tr>
                <td class="name">
                  <div class="product-cell">
                    <div class="product-thumb">${productImage({ imageUrl: i.imageUrl, name: i.productName }, 'product-thumb-img')}</div>
                    <div><strong>${e(i.productName)}</strong><div class="sub">${e(i.unitName)}</div></div>
                  </div>
                </td>
                <td><code>${e(i.sku)}</code></td>
                <td>${number(i.systemQty)}</td>
                <td>${i.movementsSinceSnapshot ? `<strong>${i.movementsSinceSnapshot > 0 ? '+' : ''}${number(i.movementsSinceSnapshot)}</strong>` : '0'}</td>
                <td>${number(i.effectiveSystemQty ?? i.systemQty)}</td>
                <td><strong>${i.actualQty === null || i.actualQty === undefined ? '—' : number(i.actualQty)}</strong></td>
                <td class="${i.diffQty === 0 ? '' : i.diffQty > 0 ? 'positive' : 'negative'}"><strong>${i.diffQty > 0 ? '+' : ''}${number(i.diffQty)}</strong></td>
                ${canViewCost ? `<td class="money">${money(i.diffValue || 0)}</td>` : ''}
                <td class="wrap-cell">${i.reasonCode ? `<code>${e(i.reasonCode)}</code> · ` : ''}${e(i.reason || 'Khớp hệ thống')}</td>
              </tr>`,
        ),
      )}
      ${
        (a.rounds || []).length
          ? `<div class="note"><strong>Lịch sử các vòng kiểm đếm:</strong><br>${a.rounds
              .map((r) => `• Vòng ${r.roundNo}: <strong>${e(r.countedByName)}</strong> (${date(r.countedAt)})${r.note ? ` — ${e(r.note)}` : ''}`)
              .join('<br>')}</div>`
          : ''
      }
      ${
        a.status === 'DaDuyet'
          ? '<div class="note green"><strong>Đã hoàn tất điều chỉnh tồn kho:</strong> Hệ thống đã tự đối chiếu biến động phát sinh sau chốt sổ, cập nhật lô hàng, tồn sản phẩm và ghi Thẻ kho (<code>KIEM_KE</code>) trong 1 Transaction.</div>'
          : isPending && !canApprove
            ? '<div class="note yellow">Phiếu đang <strong>Chờ duyệt</strong>. Cần Quản lý hoặc Admin (khác người lập/đếm) xác nhận.</div>'
            : ''
      }
    </div>
    <div class="modal-footer wrap">
      ${!isBlindMasked ? action('audit-print', 'In biên bản A4', 'print', '', `data-id="${e(a.id)}"`) : ''}
      ${a.status === 'DangDem' && canAuditCreate ? action('audit-count', 'Nhập đếm vòng 1', 'edit', 'primary', `data-id="${e(a.id)}"`) : ''}
      ${a.status === 'ChoDemLai' && canAuditCreate ? action('audit-recount', 'Đếm lại vòng 2', 'return', 'warning', `data-id="${e(a.id)}"`) : ''}
      ${isPending && canApprove ? action('audit-cancel', 'Hủy phiếu', 'trash', 'danger', `data-id="${e(a.id)}"`) : ''}
      ${isPending && canApprove ? action('audit-approve', 'Duyệt & Điều chỉnh tồn', 'check', 'primary', `data-id="${e(a.id)}"`) : ''}
      ${action('close-modal', 'Đóng')}
    </div>`,
    true,
  );
}

async function printAuditReport(auditId) {
  const res = await api.getStockAudit(auditId);
  const a = res.item;
  if (!a) return;
  const cfg = store.data.settings || {};
  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) {
    window.print();
    return;
  }
  const rows = (a.items || [])
    .map(
      (i, idx) => `<tr>
        <td>${idx + 1}</td>
        <td>${e(i.sku)}</td>
        <td>${e(i.productName)}</td>
        <td style="text-align:right">${number(i.systemQty)}</td>
        <td style="text-align:right">${number(i.actualQty ?? 0)}</td>
        <td style="text-align:right">${i.diffQty > 0 ? '+' : ''}${number(i.diffQty ?? 0)}</td>
        <td>${e(i.reasonCode ? `[${i.reasonCode}] ${i.reason || ''}` : i.reason || 'Khớp')}</td>
      </tr>`,
    )
    .join('');
  win.document.write(`<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Biên bản kiểm kê ${e(a.id)}</title>
    <style>body{font-family:Arial,sans-serif;padding:24px;color:#0f172a;font-size:13px}h1{font-size:18px;margin:0 0 4px}table{width:100%;border-collapse:collapse;margin-top:16px}th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:left}th{background:#f1f5f9}.signs{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;margin-top:40px;text-align:center}</style></head>
    <body>
      <div><strong>${e(cfg.name || 'RetailFlow')}</strong> · ${e(cfg.address || '')}</div>
      <h1>BIÊN BẢN KIỂM KÊ KHO HÀNG — ${e(a.id)}</h1>
      <div>Trạng thái: <strong>${e(a.statusLabel || a.status)}</strong> · Ngày lập: ${date(a.createdAt)} · Người lập: ${e(a.createdByName)}</div>
      <div>Ghi chú: ${e(a.note || '—')}</div>
      <table><thead><tr><th>#</th><th>SKU</th><th>Tên sản phẩm</th><th>Tồn sổ sách</th><th>Tồn thực tế</th><th>Chênh lệch</th><th>Lý do</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="signs">
        <div><strong>Người kiểm đếm V1</strong><br><br><br>${e(a.assignedToName || a.createdByName || '')}</div>
        <div><strong>Người đối chiếu V2</strong><br><br><br>${e(a.recountByName || '..................')}</div>
        <div><strong>Người phê duyệt</strong><br><br><br>${e(a.approvedByName || '..................')}</div>
      </div>
      <script>window.print();</script>
    </body></html>`);
  win.document.close();
}
