/* M2: Quản lý Hàng hóa, Danh mục, Đơn vị tính, Tra cứu đa tiêu chí & Thẻ kho (SQLite Backend). */
'use strict';

function productsView() {
  if (!apiState.categoriesLoaded || !apiState.unitsLoaded || !apiState.productImagesLoaded) {
    loadCatalogMeta();
  }
  if (!apiState.productsLoaded && !apiState.loading.products) {
    loadProductsData();
  }

  const canManage = store.hasPermission('PRODUCT_MANAGE');
  const canCatManage = store.hasPermission('CATEGORY_MANAGE');
  const canViewCost = store.hasPermission('PRODUCT_COST_VIEW');
  const canViewLedger = store.hasPermission('INVENTORY_VIEW');
  const canAdjustStock = store.hasPermission('INVENTORY_APPROVE');
  const canViewSupplier = store.hasPermission('SUPPLIER_VIEW');

  const summary = apiState.productsSummary || {};
  const tabs = [
    ['products', `Hàng hóa (${number(summary.total || apiState.products.length)})`],
    ['categories', `Danh mục (${number(apiState.categories.length)})`],
    ['units', `Đơn vị tính (${number(apiState.units.length)})`],
  ];

  const primaryAction =
    productsTab === 'categories'
      ? canCatManage
        ? action('category-new', 'Thêm', 'plus', 'primary')
        : ''
      : productsTab === 'units'
        ? canCatManage
          ? action('unit-new', 'Thêm', 'plus', 'primary')
          : ''
        : (canManage ? action('export-products-api', 'Xuất CSV', 'download') : '') +
          (canManage ? action('product-new', 'Thêm', 'plus', 'primary') : '');

  const kpiCards = stats([
    ['Tổng mặt hàng', number(summary.total || 0), 'Đồng bộ trực tiếp từ CSDL SQLite', 'box'],
    [
      'Đang kinh doanh',
      number(summary.activeCount || 0),
      `${number(summary.inactiveCount || 0)} ngừng kinh doanh (Soft-Delete)`,
      'check',
    ],
    [
      'Cảnh báo tồn thấp (BR-01)',
      number(summary.lowStockCount || 0),
      `Tồn hiện tại <= tồn tối thiểu (${number(summary.outOfStockCount || 0)} hết hàng)`,
      'bell',
    ],
    canViewCost
      ? [
          'Giá trị tồn kho',
          money(summary.totalInventoryValue || 0),
          `Tổng ${number(summary.totalStockQty || 0)} đơn vị tồn`,
          'receipt',
        ]
      : [
          'Tổng tồn khả dụng',
          number(summary.totalStockQty || 0),
          'Ẩn giá vốn theo phân quyền RBAC',
          'warehouse',
        ],
  ]);

  let tabContent = '';
  if (productsTab === 'products') {
    const p = paginate(apiState.products, 'products');
    const headers = [
      'Sản phẩm',
      'SKU / Mã vạch',
      'Danh mục & ĐVT',
      canViewCost ? 'Giá bán / Giá vốn' : 'Giá bán',
      'Tồn kho / Tối thiểu',
      'Trạng thái',
      'Thao tác',
    ];

    const rows = p.items.map((item) => {
      const stockBadge = item.isOutOfStock
        ? '<span class="badge red">Hết hàng</span>'
        : item.isLowStock
          ? '<span class="badge yellow">Sắp hết</span>'
          : '<span class="badge green">Đủ hàng</span>';

      const statusBadge = item.active
        ? badge('Đang kinh doanh', 'green')
        : badge('Ngừng kinh doanh', 'gray');

      const priceCell = canViewCost
        ? `<div><strong>${money(item.salePrice)}</strong></div><div class="sub">Vốn: ${money(item.costPrice)}</div>`
        : `<div><strong>${money(item.salePrice)}</strong></div>`;

      const rowActions = [
        canViewLedger
          ? action('product-ledger', 'Thẻ kho', 'clock', 'xs', `data-id="${e(item.id)}" aria-label="Xem thẻ kho ${e(item.name)}"`)
          : '',
        canAdjustStock
          ? action('product-stock-adjust', 'Tồn', 'warehouse', 'xs', `data-id="${e(item.id)}" aria-label="Điều chỉnh tồn ${e(item.name)}"`)
          : '',
        canManage
          ? action('product-edit', 'Sửa', 'edit', 'xs', `data-id="${e(item.id)}" aria-label="Sửa ${e(item.name)}"`)
          : '',
        canManage
          ? action(
              'product-toggle-status',
              item.active ? 'Ngừng bán' : 'Mở bán',
              item.active ? 'lock' : 'unlock',
              item.active ? 'xs danger' : 'xs teal',
              `data-id="${e(item.id)}" data-next-status="${item.active ? 'NgungKinhDoanh' : 'DangKinhDoanh'}" aria-label="${item.active ? 'Ngừng kinh doanh' : 'Mở bán lại'} ${e(item.name)}"`,
            )
          : '',
      ]
        .filter(Boolean)
        .join('');

      return `<tr>
        <td class="name">
          <div class="product-cell">
            <div class="product-thumb">${productImage(item, 'product-thumb-img')}</div>
            <div>
              <div><strong>${e(item.name)}</strong></div>
              <div class="sub">
                ${item.brand ? `<span class="badge gray">${e(item.brand)}</span>` : ''}
                ${item.packSize ? ` · ${e(item.packSize)}` : ''}
              </div>
            </div>
          </div>
        </td>
        <td>
          <div><code>${e(item.sku)}</code></div>
          <div class="sub">${e(item.barcode)}</div>
        </td>
        <td>
          <div>${e(item.categoryName)}</div>
          <div class="sub">ĐVT: <strong>${e(item.unitName)}</strong></div>
        </td>
        <td class="money name">${priceCell}</td>
        <td class="${item.isLowStock || item.isOutOfStock ? 'negative' : ''}">
          <div><strong>${number(item.stockQty)}</strong> / ${number(item.minStock)} ${e(item.unitName)}</div>
          <div style="margin-top:4px">${stockBadge}</div>
        </td>
        <td>${statusBadge}</td>
        <td><div class="action-group">${rowActions || '<span class="sub">Chỉ đọc</span>'}</div></td>
      </tr>`;
    });

    tabContent = `<section class="panel">
      <div class="panel-head">
        <h2>Tra cứu đa tiêu chí (${number(apiState.products.length)} kết quả)</h2>
        <div class="row gap8">
          ${action('product-reset-filters', 'Đặt lại lọc', 'return', 'small')}
        </div>
      </div>
      <div class="table-tools product-filters">
        ${filterInput('products', 'Tìm mã SKU, tên sản phẩm, mã vạch, thương hiệu…')}
        ${filterSelect('productCategory', [
          ['', 'Tất cả danh mục'],
          ...apiState.categories.map((c) => [c.code, `${c.code} · ${c.name}`]),
        ])}
        ${
          canViewSupplier
            ? filterSelect('productSupplier', [
                ['', 'Tất cả nhà cung cấp'],
                ...apiState.suppliers.map((s) => [s.id, s.name]),
              ])
            : ''
        }
        ${filterSelect('productStatus', [
          ['', 'Tất cả trạng thái'],
          ['DangKinhDoanh', 'Đang kinh doanh'],
          ['NgungKinhDoanh', 'Ngừng kinh doanh'],
        ])}
        ${filterSelect('productStock', [
          ['', 'Tất cả mức tồn'],
          ['low', 'Sắp hết (<= tồn tối thiểu)'],
          ['out', 'Hết hàng (= 0)'],
          ['ok', 'Đủ hàng (> tối thiểu)'],
        ])}
        <input id="filter-productMinPrice" data-filter="productMinPrice" type="number" min="0" step="1000" value="${e(filters.productMinPrice || '')}" placeholder="Giá từ (₫)" aria-label="Giá bán tối thiểu">
        <input id="filter-productMaxPrice" data-filter="productMaxPrice" type="number" min="0" step="1000" value="${e(filters.productMaxPrice || '')}" placeholder="Giá đến (₫)" aria-label="Giá bán tối đa">
      </div>
      ${apiState.productError ? `<div class="panel-body"><div class="note yellow" role="alert"><strong>Lỗi bộ lọc:</strong> ${e(apiState.productError)}</div></div>` : ''}
      ${
        apiState.loading.products && !apiState.productsLoaded
          ? '<div class="panel-body"><div class="note">Đang tải danh sách hàng hóa từ CSDL…</div></div>'
          : table(headers, rows) + p.foot
      }
    </section>`;
  } else if (productsTab === 'categories') {
    const list = apiState.categories.filter(
      (c) =>
        match(`${c.code} ${c.name} ${c.description}`, filters.catSearch || '') &&
        (!filters.catStatus || c.status === filters.catStatus),
    );
    const p = paginate(list, 'categories');
    tabContent = `<section class="panel">
      <div class="panel-head">
        <h2>Danh mục hàng hóa (${number(list.length)})</h2>
        ${badge('Bảng rời rạc DanhMuc · Soft-Delete', 'blue')}
      </div>
      <div class="table-tools">
        ${filterInput('catSearch', 'Tìm mã hoặc tên danh mục…')}
        ${filterSelect('catStatus', [
          ['', 'Tất cả trạng thái'],
          ['HoatDong', 'Hoạt động'],
          ['NgungSuDung', 'Ngừng sử dụng'],
        ])}
      </div>
      ${table(
        ['Mã DM', 'Tên danh mục', 'Mô tả', 'Số sản phẩm', 'Ngày tạo', 'Trạng thái', 'Thao tác'],
        p.items.map(
          (c) => `<tr>
            <td><code>${e(c.code)}</code></td>
            <td class="name">${e(c.name)}</td>
            <td>${e(c.description || '—')}</td>
            <td><strong>${number(c.productCount)}</strong></td>
            <td>${dateOnly(c.createdAt)}</td>
            <td>${c.active ? badge('Hoạt động', 'green') : badge('Ngừng sử dụng', 'gray')}</td>
            <td>
              <div class="row gap8">
                ${
                  canCatManage
                    ? action('category-edit', 'Sửa', 'edit', 'small', `data-code="${e(c.code)}"`) +
                      action(
                        'category-toggle-status',
                        c.active ? 'Ngừng dùng' : 'Khôi phục',
                        c.active ? 'lock' : 'unlock',
                        c.active ? 'small danger' : 'small teal',
                        `data-code="${e(c.code)}" data-next-status="${c.active ? 'NgungSuDung' : 'HoatDong'}"`,
                      )
                    : '<span class="sub">Chỉ đọc</span>'
                }
              </div>
            </td>
          </tr>`,
        ),
      )}
      ${p.foot}
    </section>`;
  } else if (productsTab === 'units') {
    const list = apiState.units.filter(
      (u) =>
        match(`${u.code} ${u.name}`, filters.unitSearch || '') &&
        (!filters.unitStatus || u.status === filters.unitStatus),
    );
    const p = paginate(list, 'units');
    tabContent = `<section class="panel">
      <div class="panel-head">
        <h2>Đơn vị tính (${number(list.length)})</h2>
        ${badge('Bảng rời rạc DonViTinh · Soft-Delete', 'blue')}
      </div>
      <div class="table-tools">
        ${filterInput('unitSearch', 'Tìm mã hoặc tên đơn vị tính…')}
        ${filterSelect('unitStatus', [
          ['', 'Tất cả trạng thái'],
          ['HoatDong', 'Hoạt động'],
          ['NgungSuDung', 'Ngừng sử dụng'],
        ])}
      </div>
      ${table(
        ['Mã ĐVT', 'Tên đơn vị tính', 'Số sản phẩm', 'Ngày tạo', 'Trạng thái', 'Thao tác'],
        p.items.map(
          (u) => `<tr>
            <td><code>${e(u.code)}</code></td>
            <td class="name">${e(u.name)}</td>
            <td><strong>${number(u.productCount)}</strong></td>
            <td>${dateOnly(u.createdAt)}</td>
            <td>${u.active ? badge('Hoạt động', 'green') : badge('Ngừng sử dụng', 'gray')}</td>
            <td>
              <div class="row gap8">
                ${
                  canCatManage
                    ? action('unit-edit', 'Sửa', 'edit', 'small', `data-code="${e(u.code)}"`) +
                      action(
                        'unit-toggle-status',
                        u.active ? 'Ngừng dùng' : 'Khôi phục',
                        u.active ? 'lock' : 'unlock',
                        u.active ? 'small danger' : 'small teal',
                        `data-code="${e(u.code)}" data-next-status="${u.active ? 'NgungSuDung' : 'HoatDong'}"`,
                      )
                    : '<span class="sub">Chỉ đọc</span>'
                }
              </div>
            </td>
          </tr>`,
        ),
      )}
      ${p.foot}
    </section>`;
  }

  return (
    heading(
      'QUẢN LÝ HÀNG HÓA / SẢN PHẨM & BẢNG GIÁ',
      'Sản phẩm, Danh mục & Đơn vị tính',
      'Quản lý hàng hóa chuẩn BR-01 & BR-06 (SKU/Barcode duy nhất, cảnh báo tồn tối thiểu, Soft-Delete & Thẻ kho bất biến).',
      primaryAction,
    ) +
    kpiCards +
    `<div class="tabs" role="tablist">${tabs
      .map(
        ([key, label]) =>
          `<button type="button" role="tab" aria-selected="${productsTab === key}" class="${productsTab === key ? 'active' : ''}" data-action="products-tab" data-tab="${key}">${label}</button>`,
      )
      .join('')}</div>` +
    tabContent
  );
}

async function productApiModal(recordId = '') {
  if (!store.hasPermission('PRODUCT_MANAGE')) {
    notify('Bạn không có quyền quản lý sản phẩm (PRODUCT_MANAGE).', true);
    return;
  }
  await loadCatalogMeta();
  let existing = recordId ? apiState.products.find((x) => x.id === recordId) : null;
  if (recordId && !existing) {
    try {
      const res = await api.getProduct(recordId);
      existing = res.item;
    } catch (err) {
      notify(err.message, true);
      return;
    }
  }
  const v = existing || {
    sku: '',
    barcode: '',
    name: '',
    brand: '',
    packSize: '',
    categoryCode: apiState.categories.find((c) => c.active)?.code || 'DM01',
    unitCode: apiState.units.find((u) => u.active)?.code || 'DVT01',
    supplierId: apiState.suppliers.find((s) => s.active)?.id || 'NCC001',
    salePrice: 0,
    costPrice: 0,
    stockQty: 0,
    minStock: store.data.settings.defaultMinStock || 15,
    imageUrl: 'assets/images/products/milk_vinamilk.jpg',
    status: 'DangKinhDoanh',
  };

  modalContext = { type: 'product-api', id: recordId };
  const imageOptions = apiState.productImages.map((img) => [img.path, `${img.label} (${img.filename})`]);
  const catOptions = apiState.categories
    .filter((c) => c.active || c.code === v.categoryCode)
    .map((c) => [c.code, `${c.code} · ${c.name}`]);
  const unitOptions = apiState.units
    .filter((u) => u.active || u.code === v.unitCode)
    .map((u) => [u.code, `${u.code} · ${u.name}`]);
  const supOptions = apiState.suppliers
    .filter((s) => s.active || s.id === v.supplierId)
    .map((s) => [s.id, `${s.id} · ${s.name}`]);

  showModal(
    recordId ? `Sửa sản phẩm · ${e(v.sku)}` : 'Thêm sản phẩm mới',
    `<form id="product-api-form">
      <div class="modal-content form-grid">
        <div class="full product-modal-preview">
          <div class="product-modal-img-wrap">
            <img id="product-modal-preview-img" class="product-modal-img" src="${e(v.imageUrl)}" alt="${e(v.name || 'Xem trước ảnh sản phẩm')}">
          </div>
          <div>
            <strong>Ảnh sản phẩm đối chứng 1-1</strong>
            <div class="sub" style="margin-top:4px">Chọn ảnh sản phẩm thực tế từ thư mục <code>assets/images/products/</code>.</div>
          </div>
        </div>
        ${field('Tên sản phẩm (*)', 'name', v.name, 'text', 'required minlength="2" maxlength="180"', true)}
        ${field('Mã SKU (để trống để tự sinh)', 'sku', v.sku, 'text', 'maxlength="32" placeholder="VD: SP094"')}
        ${field('Mã vạch / Barcode (*) (duy nhất)', 'barcode', v.barcode, 'text', 'required minlength="4" maxlength="64" placeholder="VD: 8935000000999"')}
        ${field('Thương hiệu', 'brand', v.brand, 'text', 'maxlength="80" placeholder="VD: Vinamilk"')}
        ${field('Quy cách đóng gói', 'packSize', v.packSize, 'text', 'maxlength="60" placeholder="VD: 1L, 75g"')}
        ${selectField('Danh mục (*)', 'categoryCode', catOptions, v.categoryCode, 'required')}
        ${selectField('Đơn vị tính (*)', 'unitCode', unitOptions, v.unitCode, 'required')}
        ${selectField('Nhà cung cấp (*)', 'supplierId', supOptions, v.supplierId, 'required', true)}
        ${field('Giá bán (₫) (*) (>= 0)', 'salePrice', v.salePrice, 'number', 'required min="0" step="100"')}
        ${field('Giá vốn (₫) (*) (>= 0)', 'costPrice', v.costPrice ?? 0, 'number', 'required min="0" step="100"')}
        ${field('Ngưỡng tồn tối thiểu (*) (BR-01)', 'minStock', v.minStock, 'number', 'required min="0" step="1"')}
        ${
          !recordId
            ? field('Tồn đầu kỳ (>= 0, tự ghi Thẻ kho)', 'stockQty', v.stockQty, 'number', 'required min="0" step="1"')
            : `<div class="note">Tồn hiện tại: <strong>${number(v.stockQty)} ${e(v.unitName || '')}</strong>. Dùng nút "Điều chỉnh tồn" để cập nhật tồn kèm Thẻ kho.</div>`
        }
        ${selectField('Ảnh sản phẩm thật (*)', 'imageUrl', imageOptions, v.imageUrl, 'id="product-image-select" required', true)}
        ${
          recordId
            ? selectField(
                'Trạng thái kinh doanh',
                'status',
                [
                  ['DangKinhDoanh', 'Đang kinh doanh'],
                  ['NgungKinhDoanh', 'Ngừng kinh doanh (Soft-Delete)'],
                ],
                v.status,
                '',
                true,
              )
            : ''
        }
        ${formError()}
      </div>
      <div class="modal-footer">
        ${action('close-modal', 'Hủy')}
        <button class="btn primary" type="submit">${icon('check')}Lưu</button>
      </div>
    </form>`,
    true,
  );

  const imgSelect = $('#product-image-select');
  const previewImg = $('#product-modal-preview-img');
  imgSelect?.addEventListener('change', () => {
    if (previewImg && imgSelect.value) previewImg.src = imgSelect.value;
  });
}

function stockAdjustModal(productId) {
  if (!store.hasPermission('INVENTORY_APPROVE')) {
    notify('Bạn không có quyền điều chỉnh tồn kho trực tiếp (INVENTORY_APPROVE).', true);
    return;
  }
  const prod = apiState.products.find((p) => p.id === productId);
  if (!prod) return;
  modalContext = { type: 'stock-adjust', id: productId };
  showModal(
    `Điều chỉnh tồn kho · ${e(prod.sku)}`,
    `<form id="stock-adjust-form">
      <div class="modal-content form-grid">
        <div class="full product-modal-preview">
          <div class="product-modal-img-wrap">${productImage(prod, 'product-modal-img')}</div>
          <div>
            <strong>${e(prod.name)}</strong>
            <div class="sub" style="margin-top:4px">Tồn hiện tại: <strong>${number(prod.stockQty)} ${e(prod.unitName)}</strong> · Ngưỡng tối thiểu: ${number(prod.minStock)}</div>
          </div>
        </div>
        ${field('Số lượng tồn mới (*) (>= 0, BR-06)', 'newStock', prod.stockQty, 'number', 'required min="0" step="1"', true)}
        ${field('Mã chứng từ tham chiếu', 'docId', '', 'text', 'maxlength="40" placeholder="Để trống để hệ thống tự sinh ADJ-..."', true)}
        <label class="field full">
          <span>Lý do điều chỉnh (*) (lưu bất biến vào LichSuTonKho)</span>
          <textarea name="note" required minlength="3" maxlength="250" placeholder="VD: Bổ sung tồn đầu kỳ sau rà soát kho…"></textarea>
        </label>
        ${formError()}
      </div>
      <div class="modal-footer">
        ${action('close-modal', 'Hủy')}
        <button class="btn primary" type="submit">${icon('check')}Lưu</button>
      </div>
    </form>`,
  );
}

async function productLedgerModal(productId) {
  if (!store.hasPermission('INVENTORY_VIEW')) {
    notify('Bạn không có quyền xem Thẻ kho (INVENTORY_VIEW).', true);
    return;
  }
  try {
    const [prodRes, moveRes] = await Promise.all([
      api.getProduct(productId),
      api.queryStockMovements({ productId, page: 1, limit: 30 }),
    ]);
    const prod = prodRes.item;
    const movements = moveRes.items || [];
    showModal(
      `Thẻ kho (LichSuTonKho) · ${e(prod.sku)} — ${e(prod.name)}`,
      `<div class="modal-content stack">
        <div class="product-modal-preview" style="margin-bottom:0">
          <div class="product-modal-img-wrap">${productImage(prod, 'product-modal-img')}</div>
          <div>
            <strong>${e(prod.name)}</strong>
            <div class="sub" style="margin-top:4px">
              SKU: <code>${e(prod.sku)}</code> · Barcode: <code>${e(prod.barcode)}</code> ·
              Tồn hiện tại: <strong>${number(prod.stockQty)} ${e(prod.unitName)}</strong>
              ${prod.isLowStock ? ' <span class="badge yellow">Sắp hết</span>' : ''}
            </div>
          </div>
        </div>
        <div class="note">Thẻ kho bất biến (chỉ thêm mới trong Transaction). Hiển thị tối đa 30 biến động gần nhất.</div>
        ${table(
          ['Thời gian', 'Tồn trước', 'Biến động', 'Tồn sau', 'Loại chứng từ', 'Mã CT', 'Người thực hiện', 'Ghi chú'],
          movements.map(
            (m) => `<tr>
              <td>${date(m.createdAt)}</td>
              <td>${number(m.stockBefore)}</td>
              <td class="${m.delta >= 0 ? 'positive' : 'negative'}"><strong>${m.delta > 0 ? '+' : ''}${number(m.delta)}</strong></td>
              <td><strong>${number(m.stockAfter)}</strong></td>
              <td><span class="badge blue">${e(m.docTypeLabel)}</span></td>
              <td><code>${e(m.docId)}</code></td>
              <td>${e(m.actorName)}</td>
              <td>${e(m.note || '—')}</td>
            </tr>`,
          ),
        )}
      </div>
      <div class="modal-footer">${action('close-modal', 'Đóng')}</div>`,
      true,
    );
  } catch (err) {
    notify(err.message, true);
  }
}

function categoryApiModal(code = '') {
  if (!store.hasPermission('CATEGORY_MANAGE')) {
    notify('Bạn không có quyền quản lý danh mục (CATEGORY_MANAGE).', true);
    return;
  }
  const existing = code ? apiState.categories.find((c) => c.code === code) : null;
  modalContext = { type: 'category-api', code };
  showModal(
    code ? `Sửa danh mục · ${e(code)}` : 'Thêm danh mục hàng hóa',
    `<form id="category-api-form">
      <div class="modal-content form-grid">
        ${
          !code
            ? field('Mã danh mục (để trống để tự sinh)', 'code', '', 'text', 'maxlength="20" placeholder="VD: DM07"', true)
            : `<div class="note full">Mã danh mục: <code>${e(existing.code)}</code> · Đang có ${number(existing.productCount)} sản phẩm.</div>`
        }
        ${field('Tên danh mục (*)', 'name', existing?.name || '', 'text', 'required minlength="2" maxlength="100"', true)}
        ${field('Mô tả', 'description', existing?.description || '', 'text', 'maxlength="200"', true)}
        ${formError()}
      </div>
      <div class="modal-footer">
        ${action('close-modal', 'Hủy')}
        <button class="btn primary" type="submit">${icon('check')}Lưu</button>
      </div>
    </form>`,
  );
}

function unitApiModal(code = '') {
  if (!store.hasPermission('CATEGORY_MANAGE')) {
    notify('Bạn không có quyền quản lý đơn vị tính (CATEGORY_MANAGE).', true);
    return;
  }
  const existing = code ? apiState.units.find((u) => u.code === code) : null;
  modalContext = { type: 'unit-api', code };
  showModal(
    code ? `Sửa đơn vị tính · ${e(code)}` : 'Thêm đơn vị tính',
    `<form id="unit-api-form">
      <div class="modal-content form-grid">
        ${
          !code
            ? field('Mã ĐVT (để trống để tự sinh)', 'code', '', 'text', 'maxlength="20" placeholder="VD: DVT15"', true)
            : `<div class="note full">Mã ĐVT: <code>${e(existing.code)}</code> · Đang có ${number(existing.productCount)} sản phẩm.</div>`
        }
        ${field('Tên đơn vị tính (*)', 'name', existing?.name || '', 'text', 'required minlength="1" maxlength="50" placeholder="VD: thùng, kg, bộ"', true)}
        ${formError()}
      </div>
      <div class="modal-footer">
        ${action('close-modal', 'Hủy')}
        <button class="btn primary" type="submit">${icon('check')}Lưu</button>
      </div>
    </form>`,
  );
}

function ibEntity(type, id) {
  return ib('entity-edit', 'settings', 'Chỉnh sửa', `data-type="${type}" data-id="${e(id)}"`);
}
