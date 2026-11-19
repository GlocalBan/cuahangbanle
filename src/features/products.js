function productsView() {
  const s = store.data;
  const categories = [...new Set(s.products.map((p) => p.category))];
  const list = s.products.filter(
    (p) =>
      match(`${p.id} ${p.name} ${p.barcode} ${p.batchCode || ''}`, filters.products || '') &&
      (!filters.category || p.category === filters.category) &&
      (!filters.active || (filters.active === 'yes' ? p.active : !p.active)) &&
      (!filters.expiry || (getExpiryInfo ? getExpiryInfo(p.expiryDate).status === filters.expiry : true)),
  );
  const p = paginate(list, 'products');
  const alertHSD = s.products.filter((x) => getExpiryInfo && getExpiryInfo(x.expiryDate).status !== 'valid');
  const expCount = s.products.filter((x) => getExpiryInfo && getExpiryInfo(x.expiryDate).status === 'expired').length;
  const nearCount = s.products.filter((x) => getExpiryInfo && getExpiryInfo(x.expiryDate).status === 'near_expiry').length;

  const isAdmin = store.user && store.user.role === 'ADMIN';
  const canManage = store.hasPermission('PRODUCT_MANAGE');
  const canViewCost = store.hasPermission('PRODUCT_COST_VIEW');
  const canPromo = store.hasPermission('PROMOTION_MANAGE');

  return (
    heading(
      'QUẢN LÝ HÀNG HÓA / SẢN PHẨM',
      'Quản lý sản phẩm & Lô hàng FEFO',
      'Chuẩn hóa sản phẩm CVS 93 SKU, phân cấp 3 tầng, quản lý Lô hàng (Batches), GTIN EAN-13 và đối chứng CSV.',
      (isAdmin
        ? action('sync-seed-catalog', 'Đồng bộ danh mục mẫu', 'layers', 'ghost') +
          action('import-reference-csv', 'Nạp CSV Đối chứng (1-1)', 'upload', 'ghost')
        : '') +
        (canManage ? action('export-products', 'Xuất CSV', 'download') : '') +
        (canManage
          ? action('entity-new', 'Thêm sản phẩm', 'plus', 'primary', 'data-type="products"')
          : ''),
    ) +
    stats([
      ['Tổng mặt hàng', number(s.products.length), '93 SKU chuẩn CVS', 'box'],
      [
        'Đang kinh doanh',
        number(s.products.filter((p) => p.active).length),
        'Có thể chọn tại POS',
        'check',
      ],
      [
        'Sắp hết hàng',
        number(s.products.filter((p) => p.active && p.stock <= p.minStock).length),
        'Tồn kho chạm ngưỡng cảnh báo',
        'bell',
      ],
      [
        'Cận date / Hết hạn',
        number(alertHSD.length),
        `${expCount} hết hạn · ${nearCount} cận date`,
        'clock',
      ],
    ]) +
    `<section class="panel">
      <div class="panel-head">
        <h2>Danh sách sản phẩm (${s.products.length} mặt hàng)</h2>
        <div class="row gap8 align-center">
          ${canManage ? `<button type="button" class="btn small ghost" data-action="sweep-expired-batches" title="Quét các lô quá hạn sang kho cách ly">${icon('shield')} Quét lô hết hạn FEFO</button>` : ''}
          ${canPromo && nearCount > 0 ? `<button type="button" class="btn warning small" data-action="apply-all-neardate-promo">${icon('clock')} Đưa tất cả SP Cận Date vào CTKM (-35%)</button>` : ''}
        </div>
      </div>
      <div class="table-tools product-filters">
        ${filterInput('products', 'Tìm tên, thương hiệu, GTIN, barcode, mã lô…')}
        ${filterSelect('category', [['', 'Tất cả danh mục'], ...categories.map((c) => [c, c])])}
        ${filterSelect(
          'expiry',
          [
            ['', 'Hạn sử dụng: Tất cả'],
            ['valid', 'Còn hạn'],
            ['near_expiry', 'Cận date'],
            ['expired', 'Hết hạn'],
          ],
        )}
        ${filterSelect(
          'active',
          [
            ['', 'Trạng thái kinh doanh'],
            ['yes', 'Đang kinh doanh'],
            ['no', 'Ngừng kinh doanh'],
          ],
        )}
      </div>
      ${table(
        ['Sản phẩm & Thương hiệu', 'Mã GTIN / SKU', 'Phân cấp ngành hàng', 'Giá bán / VAT', 'Tồn kho / Cách ly', 'Lô & HSD (FEFO)', 'Trạng thái', ''],
        p.items.map((item) => {
          const exp = getExpiryInfo ? getExpiryInfo(item.expiryDate) : { status: 'valid' };
          const promoBtn =
            canPromo && exp.status === 'near_expiry'
              ? `<button type="button" class="btn ${item.inNearExpiryPromo ? 'teal' : 'warning'} small" data-action="toggle-neardate-promo" data-id="${e(item.id)}" title="Bật/tắt CTKM Xả Cận Date -35%">${item.inNearExpiryPromo ? 'CTKM (-35%)' : '+ CTKM'}</button>`
              : '';
          const promoTag = item.inNearExpiryPromo ? '<span class="badge teal">CTKM -35%</span>' : '';

          const batchCount = Array.isArray(item.batches) ? item.batches.length : 1;
          const refSourceTag =
            item.referenceSource?.status === 'csv_verified'
              ? '<span class="badge green" title="Đã đối chứng dữ liệu 1-1 từ CSV">CSV ✓</span>'
              : '<span class="badge gray" title="Dữ liệu mẫu khởi tạo">Seed</span>';

          const catPath = item.categoryL1
            ? `${e(item.categoryL1)} &gt; ${e(item.categoryL2 || item.category)}`
            : e(item.category);

          const damagedBadge =
            item.damagedStock > 0
              ? `<div class="sub text-danger" title="Hàng hết hạn / lỗi bị cách ly">Hủy: ${item.damagedStock}</div>`
              : '';

          return `<tr>
            <td class="name">
              <div class="product-cell">
                <div class="product-thumb">${productImage(item, 'product-thumb-img')}</div>
                <div>
                  <div><strong>${e(item.name)}</strong> ${promoTag} ${refSourceTag}</div>
                  <div class="sub">
                    <span class="badge gray">${e(item.brand || 'Generic')}</span>
                    ${item.packSize ? ` · ${e(item.packSize)}` : ''}
                  </div>
                </div>
              </div>
            </td>
            <td>
              <div><code>${e(item.gtin || item.barcode)}</code></div>
              <div class="sub">${e(item.id)}</div>
            </td>
            <td>
              <div style="font-size:0.85rem">${catPath}</div>
              ${item.categoryL3 ? `<div class="sub">${e(item.categoryL3)}</div>` : ''}
            </td>
            <td class="money name">
              <div>${money(item.price)}</div>
              <div class="sub">VAT: ${item.vatRate ?? 10}%${canViewCost ? ` · Vốn: ${money(item.costPrice || item.cost)}` : ''}</div>
            </td>
            <td class="${item.stock <= item.minStock ? 'negative' : ''}">
              <div><strong>${item.stock}</strong> ${item.stock <= item.minStock ? '<span class="badge yellow">Thấp</span>' : ''}</div>
              ${damagedBadge}
            </td>
            <td>
              <div class="expiry-cell">
                <span class="sub">${item.expiryDate || 'N/A'}</span>
                <div>${expiryBadge(item.expiryDate)}</div>
                <div class="sub" style="margin-top:2px">
                  <a href="#" data-action="view-product-batches" data-id="${e(item.id)}" title="Xem chi tiết các lô hàng">${batchCount} lô (FEFO)</a>
                </div>
              </div>
            </td>
            <td>${item.active ? badge('Đang bán') : badge('Ngừng bán', 'gray')}</td>
            <td>
              <div class="row gap8 align-center justify-end">
                ${promoBtn}
                ${canManage ? ibEntity('products', item.id) : ''}
              </div>
            </td>
          </tr>`;
        }),
      )}
      ${p.foot}
    </section>`
  );
}

function ibEntity(type, id) {
  return ib('entity-edit', 'settings', 'Chỉnh sửa', `data-type="${type}" data-id="${e(id)}"`);
}
