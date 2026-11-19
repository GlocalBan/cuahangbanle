/* M4: Màn hình Bán hàng POS (BR-03, BR-04, BR-05) — 100% kết nối SQLite API. */
'use strict';

function computePosCartPricing() {
  const maxCashierPct = Number(store.data.settings.maxCashierLineDiscountPct ?? 10);
  const isCashier = store.user?.role === 'CASHIER';
  let grossBeforeLineDiscount = 0;
  let totalLineDiscount = 0;
  const lineViolations = [];

  for (const i of posCart.items || []) {
    const lineGross = Number(i.qty) * Number(i.salePrice);
    const rawLineDisc = Math.max(0, Math.round(Number(i.lineDiscount || 0)));
    const clampedLineDisc = Math.min(lineGross, rawLineDisc);
    grossBeforeLineDiscount += lineGross;
    totalLineDiscount += clampedLineDisc;

    if (isCashier && rawLineDisc > 0) {
      const maxAllowed = Math.round((lineGross * maxCashierPct) / 100);
      if (rawLineDisc > maxAllowed) {
        lineViolations.push({
          productId: i.productId,
          name: i.name,
          maxAllowed,
          message: `"${i.name}": Thu ngân chỉ được giảm tối đa ${maxCashierPct}% (${money(maxAllowed)}). Yêu cầu Quản lý/Admin thực hiện.`,
        });
      }
    }
  }

  const subtotal = Math.max(0, grossBeforeLineDiscount - totalLineDiscount);
  let invoiceDiscount = 0;
  let promoValid = false;
  let promoHint = posCart.promoError || '';
  const promo = posCart.appliedPromotion;

  if (promo && subtotal > 0) {
    if (subtotal < Number(promo.minOrderAmount || 0)) {
      promoHint = `Chưa đạt đơn tối thiểu ${money(promo.minOrderAmount)} để dùng mã ${promo.code}.`;
    } else {
      promoValid = true;
      if (promo.discountType === 'PERCENT') {
        let raw = Math.round((subtotal * Number(promo.discountValue || 0)) / 100);
        if (Number(promo.maxDiscount || 0) > 0) raw = Math.min(raw, Number(promo.maxDiscount));
        invoiceDiscount = Math.min(subtotal, raw);
      } else {
        invoiceDiscount = Math.min(subtotal, Math.round(Number(promo.discountValue || 0)));
      }
    }
  }

  const afterDiscount = Math.max(0, subtotal - invoiceDiscount);
  const taxRate = Number(store.data.settings.taxRate ?? 8);
  const taxAmount = Math.round((afterDiscount * taxRate) / 100);
  const totalAmount = Math.max(0, afterDiscount + taxAmount);

  return {
    grossBeforeLineDiscount,
    totalLineDiscount,
    subtotal,
    invoiceDiscount,
    afterDiscount,
    taxRate,
    taxAmount,
    totalAmount,
    promoValid,
    promoHint,
    maxCashierPct,
    lineViolations,
    hasLineDiscountViolation: lineViolations.length > 0,
  };
}

function posView() {
  if (!apiState.productsLoaded && !apiState.loading.pos) {
    loadPosData();
  }
  const activeProducts = (apiState.products || []).filter((p) => p.status === 'DangKinhDoanh');
  const categories = ['Tất cả', ...new Set(activeProducts.map((p) => p.categoryName).filter(Boolean))];
  const products = activeProducts.filter(
    (p) =>
      (activeCategory === 'Tất cả' || p.categoryName === activeCategory) &&
      match(`${p.name} ${p.sku} ${p.barcode} ${p.brand || ''}`, filters.pos || ''),
  );
  const t = computePosCartPricing();
  const activePromos = apiState.activePromotions || [];
  const totalQtyInCart = posCart.items.reduce((s, i) => s + i.qty, 0);

  return (
    heading(
      'BÁN HÀNG / POS',
      'Bán hàng tại quầy (POS)',
      'Quét mã vạch hoặc nhấn Enter để thêm nhanh. Giá bán đóng băng từ CSDL, tính tiền chuẩn BR-04 với VAT từ THAM_SO và thanh toán nguyên tử 1 Transaction.',
      action('held-orders', `Đơn tạm <span class="badge">${posHeldOrders.length}/5</span>`, 'clock'),
    ) +
    `<div class="pos-layout">
      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>Chọn sản phẩm đang kinh doanh</h2>
            <p class="sub">${number(products.length)} mặt hàng · Quét barcode hoặc nhập SKU rồi nhấn <strong>Enter</strong> để thêm ngay</p>
          </div>
          ${badge('Ca bán đang mở', 'green')}
        </div>
        <div class="table-tools">
          <div class="pos-search">
            ${icon('search')}
            ${filterInput('pos', 'Quét mã vạch / nhập SKU hoặc tên sản phẩm rồi nhấn Enter…')}
          </div>
          ${action('scan', 'Quét mã', 'scan', 'small')}
        </div>
        <div class="categories">
          ${categories
            .map(
              (c) =>
                `<button type="button" class="${activeCategory === c ? 'active' : ''}" data-action="category" data-category="${e(c)}">${e(c)}</button>`,
            )
            .join('')}
        </div>
        ${
          apiState.loading.pos && !apiState.productsLoaded
            ? '<div class="panel-body"><div class="note">Đang tải danh mục hàng hóa thực tế từ SQLite…</div></div>'
            : `<div class="product-grid">${
                products
                  .map((p) => {
                    const outOfStock = Number(p.stockQty) <= 0;
                    const lowStock = !outOfStock && Number(p.stockQty) <= Number(p.minStock || 15);
                    const stockPct = Math.min(100, Math.max(6, Math.round((Number(p.stockQty) / 200) * 100)));
                    const stockState = outOfStock || lowStock ? 'low' : Number(p.stockQty) <= Number(p.minStock || 15) * 2 ? 'warning' : '';
                    return `<div class="product-card ${outOfStock ? 'card-expired' : ''}" data-id="${e(p.id)}">
                      <div class="product-art">
                        <span class="mall-tag">${e(p.sku)}</span>
                        ${productImage(p, 'product-card-img')}
                        ${outOfStock ? '<div class="expired-overlay"><span>HẾT HÀNG · CẤM BÁN ÂM KHO</span></div>' : ''}
                      </div>
                      <strong>${e(p.name)}</strong>
                      <div class="price money">${money(p.salePrice)}</div>
                      <div class="stock ${outOfStock || lowStock ? 'negative' : ''}">
                        ${outOfStock ? 'Hết hàng (0)' : `Tồn: ${number(p.stockQty)} ${e(p.unitName)}`}
                      </div>
                      <div class="stock-bar ${stockState}"><div class="stock-fill" style="width:${stockPct}%"></div></div>
                      ${
                        outOfStock
                          ? `<div class="pos-card-footer"><button type="button" class="btn small disabled wide" disabled>${icon('close')} Hết tồn kho</button></div>`
                          : `<div class="pos-card-stepper-wrap">
                              <div class="pos-card-stepper">
                                <button type="button" class="stepper-btn" data-action="pos-card-qty-step" data-step="-1" data-id="${e(p.id)}">−</button>
                                <input type="number" min="1" max="${p.stockQty}" value="1" class="stepper-input" data-input="pos-card-qty" data-id="${e(p.id)}" aria-label="Số lượng mua ${e(p.name)}">
                                <button type="button" class="stepper-btn" data-action="pos-card-qty-step" data-step="1" data-id="${e(p.id)}">+</button>
                              </div>
                              <div class="pos-quick-chips">
                                <button type="button" class="chip-qty" data-action="pos-card-quick-qty" data-qty="1" data-id="${e(p.id)}">1</button>
                                <button type="button" class="chip-qty" data-action="pos-card-quick-qty" data-qty="5" data-id="${e(p.id)}">5</button>
                                <button type="button" class="chip-qty" data-action="pos-card-quick-qty" data-qty="10" data-id="${e(p.id)}">10</button>
                              </div>
                            </div>
                            <div class="pos-card-footer">
                              <button type="button" class="btn primary small wide add-btn" data-action="add-cart" data-id="${e(p.id)}">${icon('cart')} Thêm vào giỏ</button>
                            </div>`
                      }
                    </div>`;
                  })
                  .join('') ||
                `<div class="full">${empty('Không tìm thấy sản phẩm', 'Thử từ khóa SKU/Barcode hoặc danh mục khác.', 'search')}</div>`
              }</div>`
        }
      </section>

      <section class="panel cart-panel">
        <div class="panel-head">
          <div>
            <h2>Đơn hàng hiện tại</h2>
            <p class="sub">${number(totalQtyInCart)} sản phẩm · ${number(posCart.items.length)} dòng hàng</p>
          </div>
          ${action('clear-cart', 'Xóa giỏ', 'trash', 'danger small', posCart.items.length ? '' : 'disabled')}
        </div>
        <div class="cart-body">
          ${customerLookupHTML()}
          <div class="cart-items">
            ${
              posCart.items.length
                ? posCart.items
                    .map((i) => {
                      const prod = activeProducts.find((p) => p.id === i.productId);
                      const maxStock = prod ? Number(prod.stockQty) : i.maxStock || 999;
                      const lineGross = Number(i.qty) * Number(i.salePrice);
                      const lineDisc = Math.min(lineGross, Math.max(0, Number(i.lineDiscount || 0)));
                      const lineNet = Math.max(0, lineGross - lineDisc);
                      const violation = t.lineViolations.find((v) => v.productId === i.productId);
                      return `<div class="cart-item">
                        <div class="product-thumb">${productImage(i, 'cart-thumb-img')}</div>
                        <div class="cart-item-info">
                          <strong>${e(i.name)}</strong>
                          <small class="muted"><code>${e(i.sku)}</code> · ${money(i.salePrice)} / ${e(i.unitName || 'đv')}</small>
                          <div class="row gap8" style="margin-top:8px;flex-wrap:wrap">
                            ${action('cart-qty', '−', '', 'small', `data-id="${e(i.productId)}" data-delta="-1"`)}
                            <input type="number" class="cart-direct-input" min="1" max="${maxStock}" value="${i.qty}" data-input="cart-direct-qty" data-id="${e(i.productId)}" aria-label="Số lượng ${e(i.name)}">
                            ${action('cart-qty', '+', '', 'small', `data-id="${e(i.productId)}" data-delta="1"`)}
                            <label class="row gap4" style="font-size:11.5px;color:#475569;margin-left:auto" title="Giảm giá dòng hàng (₫)${store.user?.role === 'CASHIER' ? ` · Thu ngân tối đa ${t.maxCashierPct}%` : ''}">
                              <span>Giảm:</span>
                              <input type="number" min="0" max="${lineGross}" step="1000" value="${Number(i.lineDiscount || 0)}" data-input="cart-line-discount" data-id="${e(i.productId)}" aria-label="Giảm giá dòng hàng ${e(i.name)}" style="width:76px;height:28px;padding:0 6px;border:1px solid ${violation ? '#dc2626' : '#cbd5e1'};border-radius:6px;text-align:right;font-size:12px">
                            </label>
                          </div>
                          ${violation ? `<div class="error-text" style="margin-top:4px;font-size:11.5px" role="alert">${e(violation.message)}</div>` : ''}
                        </div>
                        <div class="right">
                          <strong class="money">${money(lineNet)}</strong>
                          ${lineDisc > 0 ? `<div class="sub positive" style="font-size:11px">−${money(lineDisc)}</div>` : ''}
                          ${ib('remove-cart', 'close', 'Bỏ sản phẩm', `data-id="${e(i.productId)}"`)}
                        </div>
                      </div>`;
                    })
                    .join('')
                : empty('Chưa có sản phẩm trong giỏ', 'Chọn mặt hàng bên trái hoặc quét mã vạch (Enter).', 'cart')
            }
          </div>

          <div class="promo-section">
            <label class="section-label" for="pos-promo-code"><span>${icon('tag')} Mã khuyến mãi (BR-04)</span></label>
            <div class="row gap8">
              <input id="pos-promo-code" type="text" value="${e(posCart.promotionCode || '')}" placeholder="Nhập mã KM (VD: GIAM10)…" style="flex:1;height:36px;padding:0 10px;border:1px solid #d1d5db;border-radius:8px;text-transform:uppercase">
              ${action('apply-promo-code', 'Áp dụng', 'check', 'small primary', posCart.items.length ? '' : 'disabled')}
              ${posCart.appliedPromotion ? action('remove-promo', 'Bỏ', 'close', 'small') : ''}
            </div>
            ${
              activePromos.length
                ? `<div class="voucher-list mt8">${activePromos
                    .map((pr) => {
                      const eligible = t.subtotal >= Number(pr.minOrderAmount || 0);
                      const isSelected = posCart.appliedPromotion?.code === pr.code;
                      const labelVal =
                        pr.discountType === 'PERCENT'
                          ? `-${pr.discountValue}%${pr.maxDiscount ? ` (max ${money(pr.maxDiscount)})` : ''}`
                          : `-${money(pr.discountValue)}`;
                      return `<div class="voucher-ticket ${isSelected ? 'selected' : ''} ${eligible ? 'eligible' : 'locked'}">
                        <div class="ticket-header">
                          <strong class="ticket-code">${e(pr.code)}</strong>
                          <span class="ticket-value">${labelVal}</span>
                        </div>
                        <div class="ticket-desc">${e(pr.name)} · Còn ${number(pr.remainingUses)} lượt</div>
                        <div class="ticket-footer">
                          ${
                            isSelected
                              ? '<button type="button" class="ticket-btn remove" data-action="remove-promo">Đang áp dụng (Bỏ)</button>'
                              : eligible && posCart.items.length
                                ? `<button type="button" class="ticket-btn apply" data-action="apply-promo-pick" data-code="${e(pr.code)}">Áp dụng ngay</button>`
                                : `<span class="ticket-needed">Đơn từ ${money(pr.minOrderAmount)}</span>`
                          }
                        </div>
                      </div>`;
                    })
                    .join('')}</div>`
                : ''
            }
            ${
              posCart.appliedPromotion && t.promoValid
                ? `<div class="applied-tag green mt8"><span>Đang dùng <strong>${e(posCart.appliedPromotion.code)}</strong>:</span><strong>−${money(t.invoiceDiscount)}</strong></div>`
                : t.promoHint
                  ? `<div class="error-text mt8" role="alert">${e(t.promoHint)}</div>`
                  : ''
            }
          </div>

          <div class="cart-summary">
            <div class="between"><span>1. Tạm tính${t.totalLineDiscount > 0 ? ` (đã trừ giảm dòng ${money(t.totalLineDiscount)})` : ''}</span><span class="money">${money(t.subtotal)}</span></div>
            <div class="between ${t.invoiceDiscount ? 'positive' : ''}"><span>2. Giảm giá hóa đơn</span><span class="money">−${money(t.invoiceDiscount)}</span></div>
            <div class="between"><span>3. Tiền sau giảm</span><span class="money">${money(t.afterDiscount)}</span></div>
            <div class="between"><span>4. Thuế VAT (${t.taxRate}% · THAM_SO)</span><span class="money">${money(t.taxAmount)}</span></div>
          </div>

          ${
            t.hasLineDiscountViolation
              ? `<div class="note red mt8" role="alert"><strong>Vượt hạn mức giảm giá Thu ngân (${t.maxCashierPct}%):</strong> Vui lòng giảm mức chiết khấu dòng hàng về trong hạn mức hoặc nhờ Quản lý / Admin duyệt thanh toán.</div>`
              : ''
          }

          <div class="mt16">
            ${field('Ghi chú hóa đơn', 'cart-note', posCart.note || '', 'text', 'id="cart-note" placeholder="Ghi chú giao hàng / xuất hóa đơn…"')}
          </div>

          <div class="cart-total between">
            <span>5. Tổng thanh toán</span>
            <span class="money">${money(t.totalAmount)}</span>
          </div>

          <div class="cart-actions">
            ${action('hold', 'Lưu đơn <kbd class="kbd-hint">F4</kbd>', 'save', '', posCart.items.length ? '' : 'disabled')}
            ${action('checkout', 'Thanh toán <kbd class="kbd-hint">F8</kbd>', 'card', 'teal', posCart.items.length && !t.hasLineDiscountViolation ? '' : 'disabled')}
          </div>
          <div class="cart-notice">${icon('shield')} Checkout lưu nguyên tử trên SQLite · Cấm xuất âm kho (BR-03)</div>
        </div>
        <div class="held-banner">
          <span>${posHeldOrders.length} đơn tạm đang giữ</span>
          ${action('held-orders', 'Mở danh sách →', '', 'ghost small')}
        </div>
      </section>
    </div>`
  );
}

function addCart(productId, delta = 1) {
  const p = (apiState.products || []).find((x) => x.id === productId && x.status === 'DangKinhDoanh');
  if (!p) throw new Error('Sản phẩm không tồn tại hoặc đã ngừng kinh doanh (BR-03).');
  const available = Number(p.stockQty) || 0;
  if (available <= 0) throw new Error(`Sản phẩm "${p.name}" đã hết hàng — cấm xuất âm kho (BR-03).`);

  const existing = posCart.items.find((i) => i.productId === p.id);
  const nextQty = (existing?.qty || 0) + delta;
  if (nextQty > available) {
    throw new Error(`"${p.name}" chỉ còn tồn ${available} ${p.unitName} — cấm xuất âm kho (BR-03).`);
  }
  if (nextQty <= 0) {
    posCart.items = posCart.items.filter((i) => i.productId !== p.id);
  } else if (existing) {
    existing.qty = nextQty;
    existing.salePrice = Number(p.salePrice);
    existing.maxStock = available;
  } else {
    posCart.items.push({
      productId: p.id,
      sku: p.sku,
      barcode: p.barcode,
      name: p.name,
      unitName: p.unitName,
      salePrice: Number(p.salePrice),
      qty: nextQty,
      lineDiscount: 0,
      maxStock: available,
      imageUrl: p.imageUrl,
    });
  }
  posCart.promoError = '';
  render();
}

async function applyPosPromoCode(code) {
  const cleanCode = String(code || '').trim().toUpperCase();
  if (!cleanCode) {
    posCart.promotionCode = '';
    posCart.appliedPromotion = null;
    posCart.promoError = '';
    render();
    return;
  }
  const t = computePosCartPricing();
  if (!posCart.items.length) {
    throw new Error('Vui lòng thêm sản phẩm vào giỏ trước khi áp dụng khuyến mãi.');
  }
  try {
    const res = await api.validatePromotion(cleanCode, t.subtotal);
    posCart.promotionCode = res.promotion.code;
    posCart.appliedPromotion = res.promotion;
    posCart.promoError = '';
    render();
    notify(`Áp dụng mã ${res.promotion.code} thành công (−${money(res.discountAmount)}).`);
  } catch (err) {
    posCart.promotionCode = cleanCode;
    posCart.appliedPromotion = null;
    posCart.promoError = err.message;
    render();
    notify(err.message, true);
  }
}

function resetPosCart() {
  posCart = {
    items: [],
    customerId: '',
    promotionCode: '',
    appliedPromotion: null,
    promoError: '',
    note: '',
  };
  customerSearchState.query = '';
  customerSearchState.customerId = '';
}

function holdCurrentPosOrder() {
  if (!posCart.items.length) throw new Error('Giỏ hàng trống, không thể lưu đơn tạm.');
  if (posHeldOrders.length >= 5) throw new Error('Chỉ được giữ tối đa 5 đơn tạm cùng lúc.');
  posHeldOrders.unshift({
    id: `TAM-${String(Date.now()).slice(-5)}`,
    time: new Date().toISOString(),
    cart: JSON.parse(JSON.stringify(posCart)),
  });
  resetPosCart();
  render();
}

function heldModal() {
  showModal(
    'Đơn hàng lưu tạm',
    `<div class="modal-content stack">${
      posHeldOrders.length
        ? posHeldOrders
            .map((h) => {
              const qty = h.cart.items.reduce((s, i) => s + i.qty, 0);
              const sub = h.cart.items.reduce((s, i) => s + i.qty * i.salePrice, 0);
              return `<div class="panel" style="padding:15px">
                <div class="between">
                  <div>
                    <h3>${e(h.id)}</h3>
                    <p class="sub">${date(h.time)} · ${number(qty)} sản phẩm</p>
                  </div>
                  <strong class="money">${money(sub)}</strong>
                </div>
                <p class="sub">${e(h.cart.items.map((i) => `${i.name} ×${i.qty}`).join(', '))}</p>
                <div class="row mt16">
                  ${action('restore-held', 'Tiếp tục bán', 'cart', 'primary small', `data-id="${e(h.id)}"`)}
                  ${action('delete-held', 'Xóa đơn', 'trash', 'danger small', `data-id="${e(h.id)}"`)}
                </div>
              </div>`;
            })
            .join('')
        : empty('Chưa có đơn tạm', 'Lưu đơn từ màn hình POS để xử lý sau.', 'clock')
    }</div>
    <div class="modal-footer">${action('close-modal', 'Đóng')}</div>`,
  );
}
