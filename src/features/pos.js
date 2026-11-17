function posView() {
  const s = store.data,
    d = s.draft,
    categories = ['Tất cả', ...new Set(s.products.filter((p) => p.active).map((p) => p.category))];
  const products = s.products.filter(
    (p) =>
      p.active &&
      (activeCategory === 'Tất cả' || p.category === activeCategory) &&
      match(`${p.name} ${p.id} ${p.barcode}`, filters.pos || ''),
  );
  let t;
  try {
    t = totals(d.items, d.discount, s.settings.taxRate);
  } catch {
    t = { subtotal: d.items.reduce((a, i) => a + i.qty * i.price, 0), tax: 0, total: 0 };
  }
  return (
    heading(
      'BÁN HÀNG / POS',
      'Bán hàng tại quầy',
      'Chọn sản phẩm, tạo hóa đơn và thanh toán nhanh chóng.',
      action('held-orders', `Đơn tạm <span class="badge">${s.held.length}/5</span>`, 'clock'),
    ) +
    `<div class="pos-layout"><section class="panel"><div class="panel-head"><div><h2>Chọn sản phẩm</h2><p class="sub">${products.length} sản phẩm · Nhấn để thêm vào giỏ</p></div>${badge('Ca bán đang mở')}</div><div class="table-tools"><div class="pos-search">${icon('search')}${filterInput('pos', 'Nhập tên, mã vạch hoặc mã sản phẩm…')}</div>${action('scan', 'Quét mã', 'scan', 'small')}</div><div class="categories">${categories.map((c) => `<button class="${activeCategory === c ? 'active' : ''}" data-action="category" data-category="${e(c)}">${e(c)}</button>`).join('')}</div><div class="product-grid">${products.map((p) => {
      const exp = getExpiryInfo ? getExpiryInfo(p.expiryDate) : { status: 'valid' };
      const isExpired = exp.status === 'expired';
      const isDisabled = p.stock <= 0 || isExpired;
      const mallBadge = '<span class="mall-tag">Chính Hãng</span>';
      const expBadge = isExpired
        ? '<div class="expired-overlay"><span>HẾT HẠN</span></div>'
        : exp.status === 'near_expiry'
        ? `<span class="pos-exp-badge badge yellow">Cận ${exp.daysRemaining}d</span>`
        : '';
      const stockPct = Math.min(100, Math.max(8, Math.round((p.stock / 200) * 100)));
      const stockBar = `<div class="stock-bar ${p.stock <= p.minStock ? 'low' : ''}"><div class="stock-fill" style="width:${stockPct}%"></div></div>`;
      return `<button class="product-card ${isExpired ? 'card-expired' : ''}" data-action="add-cart" data-id="${e(p.id)}" ${isDisabled ? 'disabled' : ''}><div class="product-art">${mallBadge}${productImage(p, 'product-card-img')}${expBadge}</div><strong>${e(p.name)}</strong><div class="price money">${money(p.price)}</div><div class="stock ${p.stock <= p.minStock ? 'negative' : ''}">${p.stock > 0 ? `Còn ${p.stock} sản phẩm` : 'Đã hết hàng'}</div>${stockBar}<span class="add">+</span></button>`;
    }).join('') || `<div class="full">${empty('Không tìm thấy sản phẩm', 'Thử từ khóa hoặc danh mục khác.', 'search')}</div>`}</div></section><section class="panel cart-panel"><div class="panel-head"><div><h2>Đơn hàng hiện tại</h2><p class="sub">${d.items.reduce((s, i) => s + i.qty, 0)} sản phẩm trong giỏ</p></div>${action('clear-cart', 'Xóa giỏ', '', 'danger small', d.items.length ? '' : 'disabled')}</div><div class="cart-body">${customerLookupHTML()}<div class="cart-items">${d.items.length ? d.items.map((i) => `<div class="cart-item"><div class="product-thumb">${productImage(i, 'cart-thumb-img')}</div><div class="cart-item-info"><strong>${e(i.name)}</strong><small class="muted">${money(i.price)}</small><div class="row gap8" style="margin-top:8px">${action('cart-qty', '−', '', 'small', `data-id="${e(i.id)}" data-delta="-1"`)}<b>${i.qty}</b>${action('cart-qty', '+', '', 'small', `data-id="${e(i.id)}" data-delta="1"`)}</div></div><div class="right"><strong class="money">${money(i.qty * i.price)}</strong>${ib('remove-cart', 'close', 'Bỏ sản phẩm', `data-id="${e(i.id)}"`)}</div></div>`).join('') : empty('Chưa có sản phẩm trong giỏ', 'Chọn sản phẩm bên trái để bắt đầu.', 'cart')}</div><div class="cart-summary"><div class="between"><span>Tạm tính</span><span class="money">${money(t.subtotal)}</span></div><div class="between"><label for="cart-discount">Giảm giá (₫)</label><input id="cart-discount" type="number" min="0" max="${t.subtotal}" step="1" value="${d.discount}"></div><div class="between"><span>Thuế (${s.settings.taxRate}%)</span><span class="money">${money(t.tax)}</span></div></div><div class="mt16">${field('Ghi chú đơn hàng', 'cart-note', d.note, 'text', 'id="cart-note" placeholder="Ghi chú cho hóa đơn…"')}</div><div class="cart-total between"><span>Tổng thanh toán</span><span class="money">${money(t.total)}</span></div><div class="cart-actions">${action('hold', 'Lưu đơn', 'save', '', d.items.length ? '' : 'disabled')}${action('checkout', 'Thanh toán', 'card', 'teal', d.items.length ? '' : 'disabled')}</div><div class="cart-notice">${icon('shield')} Thanh toán được ghi nhận trên thiết bị</div></div><div class="held-banner"><span>${s.held.length} đơn tạm đang được lưu</span>${action('held-orders', 'Mở danh sách →', '', 'ghost small')}</div></section></div>`
  );
}

function changeDraft(fn) {
  const d = clone(store.data.draft);
  fn(d);
  store.saveDraft(d);
  render();
}

function addCart(productId, delta = 1) {
  const p = store.data.products.find((p) => p.id === productId && p.active);
  if (!p) throw new Error('Sản phẩm không còn bán.');
  changeDraft((d) => {
    let i = d.items.find((i) => i.id === p.id);
    const qty = (i?.qty || 0) + delta;
    if (qty > p.stock) throw new Error(`${p.name} chỉ còn ${p.stock} sản phẩm.`);
    if (qty <= 0) {
      d.items = d.items.filter((i) => i.id !== p.id);
      d.discount = Math.min(
        d.discount,
        d.items.reduce((a, i) => a + i.qty * i.price, 0),
      );
      return;
    }
    if (i) i.qty = qty;
    else d.items.push({ id: p.id, name: p.name, price: p.price, qty, icon: p.icon, imageUrl: p.imageUrl, category: p.category });
  });
}

function heldModal() {
  showModal(
    'Đơn hàng lưu tạm',
    `<div class="modal-content stack">${store.data.held.length ? store.data.held.map((h) => `<div class="panel" style="padding:15px"><div class="between"><div><h3>${e(h.id)}</h3><p class="sub">${date(h.time)} · ${h.items.reduce((s, i) => s + i.qty, 0)} sản phẩm</p></div><strong class="money">${money(totals(h.items, h.discount, store.data.settings.taxRate).total)}</strong></div><p class="sub">${e(h.items.map((i) => `${i.name} ×${i.qty}`).join(', '))}</p><div class="row mt16">${action('restore-held', 'Tiếp tục bán', 'cart', 'primary small', `data-id="${e(h.id)}"`)}${action('delete-held', 'Xóa đơn', 'trash', 'danger small', `data-id="${e(h.id)}"`)}</div></div>`).join('') : empty('Chưa có đơn tạm', 'Lưu đơn từ màn hình bán hàng để xử lý sau.', 'clock')}</div>`,
  );
}
