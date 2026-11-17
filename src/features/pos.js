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
  const promo = (s.promotions || []).find((pr) => pr.id === d.promotionId && pr.active);
  const vouch = (s.vouchers || []).find((vr) => vr.id === d.voucherId && vr.active);
  let t;
  try {
    t = totals(d.items, d.discount, s.settings.taxRate, {
      promotion: promo,
      voucher: vouch,
      products: s.products,
    });
  } catch {
    t = {
      subtotal: d.items.reduce((a, i) => a + i.qty * i.price, 0),
      discount: 0,
      promotionDiscount: 0,
      voucherDiscount: 0,
      tax: 0,
      total: 0,
    };
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
      const mallBadge = '<span class="mall-tag">Chính Hãng</span>';
      const promoRibbon = p.inNearExpiryPromo ? '<span class="promo-ribbon">-35% XẢ CẬN DATE</span>' : '';
      const expBadge = isExpired
        ? '<div class="expired-overlay"><span>ĐÃ HẾT HẠN - NGỪNG BÁN</span></div>'
        : exp.status === 'near_expiry'
        ? `<span class="pos-exp-badge badge yellow">Cận ${exp.daysRemaining}d</span>`
        : '';
      const effectivePrice = p.inNearExpiryPromo ? Math.round(p.price * 0.65) : p.price;
      const priceDisplay = p.inNearExpiryPromo
        ? `<div class="price money">${money(effectivePrice)}<span class="original-price">${money(p.price)}</span></div>`
        : `<div class="price money">${money(p.price)}</div>`;
      const stockPct = Math.min(100, Math.max(8, Math.round((p.stock / 200) * 100)));
      const stockState = p.stock <= p.minStock ? 'low' : p.stock <= p.minStock * 2 ? 'warning' : '';
      const stockBar = `<div class="stock-bar ${stockState}"><div class="stock-fill" style="width:${stockPct}%"></div></div>`;
      return `
        <div class="product-card ${isExpired ? 'card-expired' : ''}" data-id="${e(p.id)}">
          <div class="product-art">
            ${mallBadge}
            ${promoRibbon}
            ${productImage(p, 'product-card-img')}
            ${expBadge}
          </div>
          <strong>${e(p.name)}</strong>
          ${priceDisplay}
          <div class="stock ${p.stock <= p.minStock ? 'negative' : ''}">
            ${p.stock > 0 ? `Còn ${p.stock} sản phẩm` : 'Đã hết hàng'}
          </div>
          ${stockBar}
          ${isExpired
            ? `<div class="pos-card-footer"><button type="button" class="btn small disabled wide" disabled>${icon('close')} ĐÃ HẾT HẠN - NGỪNG BÁN</button></div>`
            : `
              <div class="pos-card-stepper-wrap">
                <div class="pos-card-stepper">
                  <button type="button" class="stepper-btn" data-action="pos-card-qty-step" data-step="-1" data-id="${e(p.id)}">−</button>
                  <input type="number" min="1" max="${p.stock}" value="1" class="stepper-input" data-input="pos-card-qty" data-id="${e(p.id)}">
                  <button type="button" class="stepper-btn" data-action="pos-card-qty-step" data-step="1" data-id="${e(p.id)}">+</button>
                </div>
                <div class="pos-quick-chips">
                  <button type="button" class="chip-qty" data-action="pos-card-quick-qty" data-qty="1" data-id="${e(p.id)}">+1</button>
                  <button type="button" class="chip-qty" data-action="pos-card-quick-qty" data-qty="5" data-id="${e(p.id)}">+5</button>
                  <button type="button" class="chip-qty" data-action="pos-card-quick-qty" data-qty="10" data-id="${e(p.id)}">+10</button>
                </div>
              </div>
              <div class="pos-card-footer">
                <button type="button" class="btn primary small wide add-btn" data-action="add-cart" data-action-alt="add-to-cart" data-id="${e(p.id)}">${icon('cart')} Thêm vào giỏ</button>
              </div>
            `}
        </div>
      `;
    }).join('') || `<div class="full">${empty('Không tìm thấy sản phẩm', 'Thử từ khóa hoặc danh mục khác.', 'search')}</div>`}</div></section><section class="panel cart-panel"><div class="panel-head"><div><h2>Đơn hàng hiện tại</h2><p class="sub">${d.items.reduce((s, i) => s + i.qty, 0)} sản phẩm trong giỏ</p></div>${action('clear-cart', 'Xóa giỏ', '', 'danger small', d.items.length ? '' : 'disabled')}</div><div class="cart-body">${customerLookupHTML()}<div class="cart-items">${d.items.length ? d.items.map((i) => {
      const prod = s.products.find((p) => p.id === i.id);
      return `<div class="cart-item"><div class="product-thumb">${productImage(i, 'cart-thumb-img')}</div><div class="cart-item-info"><strong>${e(i.name)}</strong><small class="muted">${money(i.price)}</small><div class="row gap8" style="margin-top:8px">${action('cart-qty', '−', '', 'small', `data-id="${e(i.id)}" data-delta="-1"`)}<input type="number" class="cart-direct-input" min="1" max="${prod?.stock || 999}" value="${i.qty}" data-input="cart-direct-qty" data-id="${e(i.id)}"><b style="display:none">${i.qty}</b>${action('cart-qty', '+', '', 'small', `data-id="${e(i.id)}" data-delta="1"`)}</div></div><div class="right"><strong class="money">${money(i.qty * i.price)}</strong>${ib('remove-cart', 'close', 'Bỏ sản phẩm', `data-id="${e(i.id)}"`)}</div></div>`;
    }).join('') : empty('Chưa có sản phẩm trong giỏ', 'Chọn sản phẩm bên trái để bắt đầu.', 'cart')}</div><div class="promo-section"><label class="section-label"><span>${icon('clock')} Chương trình Khuyến mãi (CTKM)</span></label><select id="promo-select" class="promo-dropdown" data-action="select-promo" data-input="pos-select-promotion"><option value="">-- Không áp dụng CTKM --</option>${(s.promotions || []).map((pr) => `<option value="${e(pr.id)}" ${d.promotionId === pr.id ? 'selected' : ''}>${e(pr.name)} ${pr.nearExpiryOnly ? '(Flash sale cận date)' : ''}</option>`).join('')}</select>${promo && t.promotionDiscount > 0 ? `<div class="applied-tag green"><span>Đã giảm CTKM:</span><strong>-${money(t.promotionDiscount)}</strong></div>` : ''}</div><div class="voucher-section"><label class="section-label"><span>${icon('card')} Ví App Voucher (${(s.vouchers || []).length} mã)</span></label><div class="voucher-list">${(s.vouchers || []).map((v) => {
      const eligible = t.subtotal >= v.minOrderAmount;
      const isSelected = d.voucherId === v.id;
      return `<div class="voucher-ticket ${isSelected ? 'selected' : ''} ${eligible ? 'eligible' : 'locked'}" data-input="pos-select-voucher" data-id="${e(v.id)}"><div class="ticket-header"><strong class="ticket-code">${e(v.code)}</strong><span class="ticket-value">${v.type === 'percent' ? `-${v.value}%` : `-${money(v.value)}`}</span></div><div class="ticket-desc">${e(v.name)} · Đơn từ ${money(v.minOrderAmount)}</div><div class="ticket-footer">${isSelected ? '<button type="button" class="ticket-btn remove" data-action="remove-voucher">Đang dùng (Bỏ)</button>' : eligible ? `<button type="button" class="ticket-btn apply" data-action="apply-voucher" data-action-alt="select-pos-voucher" data-id="${e(v.id)}">Dùng ngay</button>` : `<span class="ticket-needed">Mua thêm ${money(v.minOrderAmount - t.subtotal)}</span>`}</div></div>`;
    }).join('')}</div></div><div class="cart-summary"><div class="between"><span>Tạm tính</span><span class="money">${money(t.subtotal)}</span></div>${t.promotionDiscount ? `<div class="between positive"><span>Giảm giá CTKM</span><span class="money">-${money(t.promotionDiscount)}</span></div>` : ''}${t.voucherDiscount ? `<div class="between positive"><span>Giảm giá App Voucher</span><span class="money">-${money(t.voucherDiscount)}</span></div>` : ''}<div class="between"><label for="cart-discount">Giảm giá thêm (₫)</label><input id="cart-discount" type="number" min="0" max="${t.subtotal}" step="1" value="${d.discount}"></div><div class="between"><span>Thuế (${s.settings.taxRate}%)</span><span class="money">${money(t.tax)}</span></div></div><div class="mt16">${field('Ghi chú đơn hàng', 'cart-note', d.note, 'text', 'id="cart-note" placeholder="Ghi chú cho hóa đơn…"')}</div><div class="cart-total between"><span>Tổng thanh toán</span><span class="money">${money(t.total)}</span></div><div class="cart-actions">${action('hold', 'Lưu đơn', 'save', '', d.items.length ? '' : 'disabled')}${action('checkout', 'Thanh toán', 'card', 'teal', d.items.length ? '' : 'disabled')}</div><div class="cart-notice">${icon('shield')} Thanh toán được ghi nhận trên thiết bị</div></div><div class="held-banner"><span>${s.held.length} đơn tạm đang được lưu</span>${action('held-orders', 'Mở danh sách →', '', 'ghost small')}</div></section></div>`
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
  const exp = getExpiryInfo ? getExpiryInfo(p.expiryDate) : null;
  if (exp && exp.status === 'expired') {
    throw new Error(`Sản phẩm ${p.name} đã hết hạn sử dụng. Không thể bán.`);
  }
  changeDraft((d) => {
    let i = d.items.find((i) => i.id === p.id);
    const qty = (i?.qty || 0) + delta;
    if (qty > p.stock) throw new Error(`${p.name} chỉ còn ${p.stock} sản phẩm.`);
    if (qty <= 0) {
      d.items = d.items.filter((i) => i.id !== p.id);
      return;
    }
    const price = p.inNearExpiryPromo ? Math.round(p.price * 0.65) : p.price;
    if (i) {
      i.qty = qty;
      i.price = price;
    } else {
      d.items.push({
        id: p.id,
        name: p.name,
        price,
        qty,
        icon: p.icon,
        imageUrl: p.imageUrl,
        category: p.category,
      });
    }
    if ((p.inNearExpiryPromo || (exp && exp.status === 'near_expiry')) && !d.promotionId) {
      const nearPromo = (store.data.promotions || []).find((pr) => pr.id === 'promo-neardate' && pr.active);
      if (nearPromo) {
        d.promotionId = nearPromo.id;
      }
    }
  });
}

function heldModal() {
  showModal(
    'Đơn hàng lưu tạm',
    `<div class="modal-content stack">${store.data.held.length ? store.data.held.map((h) => `<div class="panel" style="padding:15px"><div class="between"><div><h3>${e(h.id)}</h3><p class="sub">${date(h.time)} · ${h.items.reduce((s, i) => s + i.qty, 0)} sản phẩm</p></div><strong class="money">${money(totals(h.items, h.discount, store.data.settings.taxRate).total)}</strong></div><p class="sub">${e(h.items.map((i) => `${i.name} ×${i.qty}`).join(', '))}</p><div class="row mt16">${action('restore-held', 'Tiếp tục bán', 'cart', 'primary small', `data-id="${e(h.id)}"`)}${action('delete-held', 'Xóa đơn', 'trash', 'danger small', `data-id="${e(h.id)}"`)}</div></div>`).join('') : empty('Chưa có đơn tạm', 'Lưu đơn từ màn hình bán hàng để xử lý sau.', 'clock')}</div>`,
  );
}
