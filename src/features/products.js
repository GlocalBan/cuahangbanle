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

  return (
    heading(
      'DANH MỤC / SẢN PHẨM',
      'Quản lý sản phẩm',
      'Quản lý danh mục, giá bán, mã hàng, tồn kho và theo dõi hạn sử dụng.',
      action('export-products', 'Xuất CSV', 'download') +
        (store.user.role === 'ADMIN'
          ? action('entity-new', 'Thêm sản phẩm', 'plus', 'primary', 'data-type="products"')
          : ''),
    ) +
    stats([
      ['Tổng mặt hàng', number(s.products.length), 'Đang có trong danh mục', 'box'],
      [
        'Đang kinh doanh',
        number(s.products.filter((p) => p.active).length),
        'Có thể chọn tại POS',
        'check',
      ],
      [
        'Sắp hết hàng',
        number(s.products.filter((p) => p.active && p.stock <= p.minStock).length),
        'Cần kiểm tra và nhập thêm',
        'bell',
      ],
      [
        'Cận date / Hết hạn',
        number(alertHSD.length),
        `${expCount} hết hạn · ${nearCount} cận date`,
        'clock',
      ],
    ]) +
    `<section class="panel"><div class="panel-head"><h2>Danh sách sản phẩm</h2><div class="row gap8 align-center"><span class="sub">${s.products.length} mặt hàng</span>${nearCount > 0 ? `<button type="button" class="btn warning small" data-action="apply-all-neardate-promo">${icon('clock')} Đưa tất cả SP Cận Date vào CTKM (-35%)</button>` : ''}</div></div><div class="table-tools wrap">${filterInput('products', 'Tìm tên, mã sản phẩm, mã vạch, mã lô…')}${filterSelect('category', [['', 'Tất cả danh mục'], ...categories.map((c) => [c, c])])}${filterSelect(
      'expiry',
      [
        ['', 'Tất cả HSD'],
        ['valid', 'Còn hạn'],
        ['near_expiry', 'Cận date'],
        ['expired', 'Hết hạn'],
      ],
    )}${filterSelect(
      'active',
      [
        ['', 'Tất cả trạng thái'],
        ['yes', 'Đang kinh doanh'],
        ['no', 'Ngừng kinh doanh'],
      ],
    )}</div>${table(
      ['Sản phẩm', 'Mã sản phẩm', 'Danh mục', 'Giá bán', 'Tồn kho', 'Hạn sử dụng (HSD)', 'Trạng thái', ''],
      p.items.map(
        (item) => {
          const exp = getExpiryInfo ? getExpiryInfo(item.expiryDate) : { status: 'valid' };
          const promoBtn = exp.status === 'near_expiry'
            ? `<button type="button" class="btn ${item.inNearExpiryPromo ? 'teal' : 'warning'} small" data-action="toggle-neardate-promo" data-id="${e(item.id)}" title="Bật/tắt CTKM Xả Cận Date -35%">${item.inNearExpiryPromo ? 'Đã trong CTKM (-35%)' : 'Đưa vào CTKM (-35%)'}</button>`
            : '';
          const promoTag = item.inNearExpiryPromo ? '<span class="badge teal">CTKM -35%</span>' : '';
          return `<tr><td class="name"><div class="product-cell"><div class="product-thumb">${productImage(item, 'product-thumb-img')}</div><div><div><strong>${e(item.name)}</strong> ${promoTag}</div><div class="sub">${e(item.barcode)}${item.batchCode ? ` · Lô: ${e(item.batchCode)}` : ''}</div></div></div></td><td>${e(item.id)}</td><td>${e(item.category)}</td><td class="money name">${money(item.price)}</td><td class="${item.stock <= item.minStock ? 'negative' : ''}">${item.stock} ${item.stock <= item.minStock ? '<span class="badge yellow">Thấp</span>' : ''}</td><td><div class="expiry-cell"><span class="sub">${item.expiryDate || 'N/A'}</span><div>${expiryBadge(item.expiryDate)}</div></div></td><td>${item.active ? badge('Đang bán') : badge('Ngừng bán', 'gray')}</td><td><div class="row gap8 align-center justify-end">${promoBtn}${store.user.role === 'ADMIN' ? ibEntity('products', item.id) : ''}</div></td></tr>`;
        },
      ),
    )}${p.foot}</section>`
  );
}

function ibEntity(type, id) {
  return ib('entity-edit', 'settings', 'Chỉnh sửa', `data-type="${type}" data-id="${e(id)}"`);
}
