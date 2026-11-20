/* M4 + Phase 2: Màn hình Bán hàng POS (BR-03, BR-04, BR-05) — Ca bán hàng, Voucher XOR KM, khóa trần tồn. */
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
  const mode = posCart.discountMode || 'NONE';
  let invoiceDiscount = 0;
  let discountLabel = '';
  let promoValid = false;
  let promoHint = posCart.promoError || '';
  let voucherValid = false;
  let voucherHint = posCart.voucherError || '';

  if (mode === 'PROMO' && posCart.appliedPromotion && subtotal > 0) {
    const promo = posCart.appliedPromotion;
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
      discountLabel = `KM ${promo.code}`;
    }
  } else if (mode === 'VOUCHER' && posCart.appliedVoucher && subtotal > 0) {
    const vc = posCart.appliedVoucher;
    if (subtotal < Number(vc.minOrderAmount || 0)) {
      voucherHint = `Chưa đạt đơn tối thiểu ${money(vc.minOrderAmount)} để dùng voucher ${vc.code}.`;
    } else {
      voucherValid = true;
      if (vc.discountType === 'PERCENT') {
        let raw = Math.round((subtotal * Number(vc.discountValue || 0)) / 100);
        if (Number(vc.maxDiscount || 0) > 0) raw = Math.min(raw, Number(vc.maxDiscount));
        invoiceDiscount = Math.min(subtotal, raw);
      } else {
        invoiceDiscount = Math.min(subtotal, Math.round(Number(vc.discountValue || 0)));
      }
      discountLabel = `Voucher ${vc.code}`;
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
    discountMode: mode,
    invoiceDiscount,
    discountLabel,
    afterDiscount,
    taxRate,
    taxAmount,
    totalAmount,
    promoValid,
    promoHint,
    voucherValid,
    voucherHint,
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
  const activeVouchers = apiState.activeVouchers || [];
  const totalQtyInCart = posCart.items.reduce((s, i) => s + i.qty, 0);
  const shift = apiState.currentShift;
  const canShift = store.hasPermission('SHIFT_MANAGE');
  const mode = posCart.discountMode || 'NONE';

  const shiftBar = canShift
    ? `<div class="shift-bar">
        <div class="row gap12 wrap">
          ${
            shift
              ? `${badge(`Ca đang mở · ${e(shift.id)}`, 'green')}
                 <span class="sub">Mở lúc ${date(shift.openedAt)} · Đầu ca: <strong>${money(shift.openingCash)}</strong> · Tiền mặt bán: <strong>${money(shift.cashSales || 0)}</strong> · Dự kiến két: <strong class="money">${money(shift.expectedCash ?? shift.openingCash)}</strong></span>`
              : `${badge('Chưa mở ca bán hàng', 'yellow')}
                 <span class="sub">Mở ca để ghi nhận tiền đầu ca, đối soát tiền mặt cuối ca và kiểm soát chênh lệch két.</span>`
          }
        </div>
        <div class="row gap8">
          ${
            shift
              ? action('shift-close', 'Chốt ca & Đối soát', 'lock', 'warning small')
              : action('shift-open', 'Mở ca bán hàng', 'unlock', 'primary small')
          }
        </div>
      </div>`
    : '';

  return (
    heading(
      'BÁN HÀNG / POS',
      'Bán hàng tại quầy (POS)',
      'Quét mã vạch hoặc nhấn Enter để thêm nhanh. Giá bán đóng băng từ CSDL, chọn 1 hình thức giảm hóa đơn (Voucher hoặc KM), thanh toán 100% nguyên tử 1 Transaction.',
      action('held-orders', `Đơn tạm <span class="badge">${posHeldOrders.length}/5</span>`, 'clock'),
    ) +
    shiftBar +
    `<div class="pos-layout">
      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>Chọn sản phẩm đang kinh doanh</h2>
            <p class="sub">${number(products.length)} mặt hàng · Quét barcode hoặc nhập SKU rồi nhấn <strong>Enter</strong> để thêm ngay</p>
          </div>
          ${shift ? badge(`Ca ${e(shift.id)}`, 'green') : badge('Sẵn sàng bán', 'blue')}
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
                    const salableStock = Number(p.stockQty) || 0;
                    const outOfStock = salableStock <= 0;
                    const lowStock = !outOfStock && salableStock <= Number(p.minStock || 15);
                    const stockPct = Math.min(100, Math.max(6, Math.round((salableStock / 200) * 100)));
                    const stockState =
                      outOfStock || lowStock ? 'low' : salableStock <= Number(p.minStock || 15) * 2 ? 'warning' : '';
                    return `<div class="product-card ${outOfStock ? 'card-expired' : ''}" data-id="${e(p.id)}">
                      <div class="product-art">
                        <span class="mall-tag">${e(p.sku)}</span>
                        ${productImage(p, 'product-card-img')}
                        ${outOfStock ? '<div class="expired-overlay"><span>HẾT HÀNG · CẤM BÁN ÂM KHO</span></div>' : ''}
                      </div>
                      <strong>${e(p.name)}</strong>
                      <div class="price money">${money(p.salePrice)}</div>
                      <div class="stock ${outOfStock || lowStock ? 'negative' : ''}">
                        ${outOfStock ? 'Hết hàng (0)' : `Tồn: ${number(salableStock)} ${e(p.unitName)}`}
                      </div>
                      <div class="stock-bar ${stockState}"><div class="stock-fill" style="width:${stockPct}%"></div></div>
                      ${
                        outOfStock
                          ? `<div class="pos-card-footer"><button type="button" class="btn small disabled wide" disabled title="Sản phẩm đã hết tồn kho khả dụng (BR-03)">${icon('close')} Hết tồn kho</button></div>`
                          : `<div class="pos-card-stepper-wrap">
                              <div class="pos-card-stepper">
                                <button type="button" class="stepper-btn" data-action="pos-card-qty-step" data-step="-1" data-id="${e(p.id)}" title="Giảm số lượng">−</button>
                                <input type="number" min="1" max="${salableStock}" value="1" class="stepper-input" data-input="pos-card-qty" data-id="${e(p.id)}" aria-label="Số lượng mua ${e(p.name)}">
                                <button type="button" class="stepper-btn" data-action="pos-card-qty-step" data-step="1" data-id="${e(p.id)}" ${salableStock <= 1 ? 'disabled title="Đã đạt tồn khả dụng tối đa"' : 'title="Tăng số lượng"'}>+</button>
                              </div>
                              <div class="pos-quick-chips">
                                <button type="button" class="chip-qty" data-action="pos-card-quick-qty" data-qty="1" data-id="${e(p.id)}">1</button>
                                <button type="button" class="chip-qty" data-action="pos-card-quick-qty" data-qty="5" data-id="${e(p.id)}" ${salableStock < 5 ? `disabled title="Chỉ còn tồn ${salableStock}"` : ''}>5</button>
                                <button type="button" class="chip-qty" data-action="pos-card-quick-qty" data-qty="10" data-id="${e(p.id)}" ${salableStock < 10 ? `disabled title="Chỉ còn tồn ${salableStock}"` : ''}>10</button>
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
          ${action('clear-cart', 'Xóa giỏ', 'trash', 'danger small', posCart.items.length ? '' : 'disabled title="Giỏ hàng đang trống"')}
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
                      const atMin = Number(i.qty) <= 1;
                      const atMax = Number(i.qty) >= maxStock;
                      const lineGross = Number(i.qty) * Number(i.salePrice);
                      const lineDisc = Math.min(lineGross, Math.max(0, Number(i.lineDiscount || 0)));
                      const lineNet = Math.max(0, lineGross - lineDisc);
                      const violation = t.lineViolations.find((v) => v.productId === i.productId);
                      return `<div class="cart-item">
                        <div class="product-thumb">${productImage(i, 'cart-thumb-img')}</div>
                        <div class="cart-item-info">
                          <strong>${e(i.name)}</strong>
                          <small class="muted"><code>${e(i.sku)}</code> · ${money(i.salePrice)} / ${e(i.unitName || 'đv')} · Tồn: ${number(maxStock)}</small>
                          <div class="row gap8" style="margin-top:8px;flex-wrap:wrap">
                            ${action(
                              'cart-qty',
                              '−',
                              '',
                              'small',
                              `data-id="${e(i.productId)}" data-delta="-1" ${atMin ? 'disabled title="Số lượng tối thiểu là 1 (dùng nút X để bỏ khỏi giỏ)"' : 'title="Giảm 1"'}`,
                            )}
                            <input type="number" class="cart-direct-input" min="1" max="${maxStock}" value="${i.qty}" data-input="cart-direct-qty" data-id="${e(i.productId)}" aria-label="Số lượng ${e(i.name)}">
                            ${action(
                              'cart-qty',
                              '+',
                              '',
                              'small',
                              `data-id="${e(i.productId)}" data-delta="1" ${atMax ? `disabled title="Đã đạt tồn khả dụng tối đa (${maxStock}) — cấm xuất âm kho"` : 'title="Tăng 1"'}`,
                            )}
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
            <div class="section-label"><span>${icon('tag')} Giảm giá hóa đơn (chọn 1 trong 2 · BR-04)</span></div>
            <div class="discount-mode-group" role="radiogroup" aria-label="Chọn hình thức giảm giá hóa đơn">
              <label class="discount-mode-option ${mode === 'NONE' ? 'active' : ''}" data-action="pos-discount-mode" data-mode="NONE">
                <input type="radio" name="posDiscountMode" value="NONE" ${mode === 'NONE' ? 'checked' : ''}>
                <span>Không giảm</span>
              </label>
              <label class="discount-mode-option ${mode === 'VOUCHER' ? 'active' : ''}" data-action="pos-discount-mode" data-mode="VOUCHER">
                <input type="radio" name="posDiscountMode" value="VOUCHER" ${mode === 'VOUCHER' ? 'checked' : ''}>
                <span>Mã Voucher</span>
              </label>
              <label class="discount-mode-option ${mode === 'PROMO' ? 'active' : ''}" data-action="pos-discount-mode" data-mode="PROMO">
                <input type="radio" name="posDiscountMode" value="PROMO" ${mode === 'PROMO' ? 'checked' : ''}>
                <span>Khuyến mãi</span>
              </label>
            </div>

            ${
              mode === 'VOUCHER'
                ? `<div class="mt8">
                    <div class="row gap8">
                      <input id="pos-voucher-code" type="text" value="${e(posCart.voucherCode || '')}" placeholder="Nhập mã Voucher (VD: VC-CHAO20)…" style="flex:1;height:40px;padding:0 10px;border:1px solid #d1d5db;border-radius:8px;text-transform:uppercase">
                      ${action('apply-voucher-code', 'Áp dụng', 'check', 'small primary', posCart.items.length ? '' : 'disabled title="Thêm sản phẩm vào giỏ trước"')}
                      ${posCart.appliedVoucher ? action('remove-voucher', 'Bỏ', 'close', 'small') : ''}
                    </div>
                    ${
                      activeVouchers.length
                        ? `<div class="voucher-list mt8">${activeVouchers
                            .map((vc) => {
                              const eligible = t.subtotal >= Number(vc.minOrderAmount || 0);
                              const isSelected = posCart.appliedVoucher?.code === vc.code;
                              const labelVal =
                                vc.discountType === 'PERCENT'
                                  ? `-${vc.discountValue}%${vc.maxDiscount ? ` (max ${money(vc.maxDiscount)})` : ''}`
                                  : `-${money(vc.discountValue)}`;
                              return `<div class="voucher-ticket ${isSelected ? 'selected' : ''} ${eligible ? 'eligible' : 'locked'}">
                                <div class="ticket-header">
                                  <strong class="ticket-code">${e(vc.code)}</strong>
                                  <span class="ticket-value">${labelVal}</span>
                                </div>
                                <div class="ticket-desc">${e(vc.name)} · Còn ${number(vc.remainingUses ?? Math.max(0, (vc.usageLimit || 0) - (vc.usedCount || 0)))} lượt</div>
                                <div class="ticket-footer">
                                  ${
                                    isSelected
                                      ? '<button type="button" class="ticket-btn remove" data-action="remove-voucher">Đang áp dụng (Bỏ)</button>'
                                      : eligible && posCart.items.length
                                        ? `<button type="button" class="ticket-btn apply" data-action="apply-voucher-pick" data-code="${e(vc.code)}">Áp dụng Voucher</button>`
                                        : `<span class="ticket-needed">Đơn từ ${money(vc.minOrderAmount)}</span>`
                                  }
                                </div>
                              </div>`;
                            })
                            .join('')}</div>`
                        : '<div class="sub mt8">Chưa có voucher đang hoạt động.</div>'
                    }
                    ${
                      posCart.appliedVoucher && t.voucherValid
                        ? `<div class="applied-tag green mt8"><span>Đang dùng Voucher <strong>${e(posCart.appliedVoucher.code)}</strong>:</span><strong>−${money(t.invoiceDiscount)}</strong></div>`
                        : t.voucherHint
                          ? `<div class="error-text mt8" role="alert">${e(t.voucherHint)}</div>`
                          : ''
                    }
                  </div>`
                : mode === 'PROMO'
                  ? `<div class="mt8">
                      <div class="row gap8">
                        <input id="pos-promo-code" type="text" value="${e(posCart.promotionCode || '')}" placeholder="Nhập mã KM (VD: GIAM10)…" style="flex:1;height:40px;padding:0 10px;border:1px solid #d1d5db;border-radius:8px;text-transform:uppercase">
                        ${action('apply-promo-code', 'Áp dụng', 'check', 'small primary', posCart.items.length ? '' : 'disabled title="Thêm sản phẩm vào giỏ trước"')}
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
                                          ? `<button type="button" class="ticket-btn apply" data-action="apply-promo-pick" data-code="${e(pr.code)}">Áp dụng KM</button>`
                                          : `<span class="ticket-needed">Đơn từ ${money(pr.minOrderAmount)}</span>`
                                    }
                                  </div>
                                </div>`;
                              })
                              .join('')}</div>`
                          : '<div class="sub mt8">Chưa có chương trình KM đang diễn ra.</div>'
                      }
                      ${
                        posCart.appliedPromotion && t.promoValid
                          ? `<div class="applied-tag green mt8"><span>Đang dùng KM <strong>${e(posCart.appliedPromotion.code)}</strong>:</span><strong>−${money(t.invoiceDiscount)}</strong></div>`
                          : t.promoHint
                            ? `<div class="error-text mt8" role="alert">${e(t.promoHint)}</div>`
                            : ''
                      }
                    </div>`
                  : '<div class="sub mt8">Hóa đơn không áp dụng giảm giá cấp hóa đơn. Chọn <em>Mã Voucher</em> hoặc <em>Chương trình KM</em> (không cộng dồn).</div>'
            }
          </div>

          <div class="cart-summary">
            <div class="between"><span>1. Tạm tính${t.totalLineDiscount > 0 ? ` (đã trừ giảm dòng ${money(t.totalLineDiscount)})` : ''}</span><span class="money">${money(t.subtotal)}</span></div>
            <div class="between ${t.invoiceDiscount ? 'positive' : ''}"><span>2. Giảm giá hóa đơn${t.discountLabel ? ` (${e(t.discountLabel)})` : ''}</span><span class="money">−${money(t.invoiceDiscount)}</span></div>
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
            <span>5. Tổng thanh toán (100%)</span>
            <span class="money">${money(t.totalAmount)}</span>
          </div>

          <div class="cart-actions">
            ${action('hold', 'Lưu đơn <kbd class="kbd-hint">F4</kbd>', 'save', '', posCart.items.length ? '' : 'disabled title="Chưa có sản phẩm trong giỏ"')}
            ${action(
              'checkout',
              'Thanh toán <kbd class="kbd-hint">F8</kbd>',
              'card',
              'teal',
              posCart.items.length && !t.hasLineDiscountViolation
                ? ''
                : `disabled title="${t.hasLineDiscountViolation ? 'Vượt hạn mức giảm giá Thu ngân' : 'Vui lòng chọn ít nhất 1 sản phẩm'}"`,
            )}
          </div>
          <div class="cart-notice">${icon('shield')} Thanh toán 100% nguyên tử trên SQLite · Cấm xuất âm kho · Xuất lô FEFO (BR-03)</div>
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
  posCart.voucherError = '';
  render();
}

function setPosDiscountMode(mode) {
  const valid = ['NONE', 'VOUCHER', 'PROMO'].includes(mode) ? mode : 'NONE';
  posCart.discountMode = valid;
  if (valid !== 'PROMO') {
    posCart.promotionCode = '';
    posCart.appliedPromotion = null;
    posCart.promoError = '';
  }
  if (valid !== 'VOUCHER') {
    posCart.voucherCode = '';
    posCart.appliedVoucher = null;
    posCart.voucherError = '';
  }
  render();
}

async function applyPosPromoCode(code) {
  const cleanCode = String(code || '').trim().toUpperCase();
  posCart.discountMode = 'PROMO';
  posCart.voucherCode = '';
  posCart.appliedVoucher = null;
  posCart.voucherError = '';
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
    notify(`Áp dụng KM ${res.promotion.code} thành công (−${money(res.discountAmount)}).`);
  } catch (err) {
    posCart.promotionCode = cleanCode;
    posCart.appliedPromotion = null;
    posCart.promoError = err.message;
    render();
    notify(err.message, true);
  }
}

async function applyPosVoucherCode(code) {
  const cleanCode = String(code || '').trim().toUpperCase();
  posCart.discountMode = 'VOUCHER';
  posCart.promotionCode = '';
  posCart.appliedPromotion = null;
  posCart.promoError = '';
  if (!cleanCode) {
    posCart.voucherCode = '';
    posCart.appliedVoucher = null;
    posCart.voucherError = '';
    render();
    return;
  }
  const t = computePosCartPricing();
  if (!posCart.items.length) {
    throw new Error('Vui lòng thêm sản phẩm vào giỏ trước khi áp dụng mã Voucher.');
  }
  try {
    const res = await api.validateVoucher(cleanCode, t.subtotal, posCart.customerId || null);
    posCart.voucherCode = res.voucher.code;
    posCart.appliedVoucher = res.voucher;
    posCart.voucherError = '';
    render();
    notify(`Áp dụng Voucher ${res.voucher.code} thành công (−${money(res.discountAmount)}).`);
  } catch (err) {
    posCart.voucherCode = cleanCode;
    posCart.appliedVoucher = null;
    posCart.voucherError = err.message;
    render();
    notify(err.message, true);
  }
}

function openShiftModal() {
  modalContext = { type: 'shift-open' };
  showModal(
    'Mở ca bán hàng (Cashier Shift)',
    `<form id="shift-open-form">
      <div class="modal-content stack">
        <div class="note">
          Khai báo số tiền mặt đầu ca trong két thu ngân. Hệ thống tự động cộng dồn doanh thu tiền mặt, hoàn tiền mặt và đối soát cuối ca.
        </div>
        ${field('Tiền mặt đầu ca trong két (₫) (*)', 'openingCash', 1000000, 'number', 'required min="0" step="1000"')}
        ${textField('Ghi chú mở ca', 'note', 'Bàn giao tiền lẻ đầu ca')}
        ${formError()}
      </div>
      <div class="modal-footer">
        ${action('close-modal', 'Hủy')}
        <button class="btn primary" type="submit">${icon('unlock')}Mở ca ngay</button>
      </div>
    </form>`,
  );
}

async function closeShiftModal() {
  try {
    const res = await api.getCurrentShift();
    const s = res.shift;
    apiState.currentShift = s || null;
    if (!s) {
      notify('Hiện không có ca bán hàng nào đang mở.', true);
      render();
      return;
    }
    const expected = Number(s.expectedCash ?? s.openingCash ?? 0);
    modalContext = { type: 'shift-close', id: s.id, expectedCash: expected };
    showModal(
      `Chốt ca & Đối soát két · ${e(s.id)}`,
      `<form id="shift-close-form">
        <div class="modal-content stack">
          <div class="detail-grid">
            <div><small>Thu ngân mở ca</small><strong>${e(s.cashierName || store.user?.fullName || '')}</strong></div>
            <div><small>Thời gian mở ca</small><strong>${date(s.openedAt)}</strong></div>
            <div><small>Tiền mặt đầu ca</small><strong class="money">${money(s.openingCash)}</strong></div>
            <div><small>Số hóa đơn trong ca</small><strong>${number(s.orderCount || 0)} đơn</strong></div>
            <div><small>Thu tiền mặt</small><strong class="money positive">+${money(s.cashSales || 0)}</strong></div>
            <div><small>Chi hoàn tiền mặt</small><strong class="money negative">−${money(s.cashRefunds || 0)}</strong></div>
            <div><small>Thanh toán VietQR / Thẻ</small><strong class="money">${money(s.nonCashSales || 0)}</strong></div>
            <div><small>Tiền mặt dự kiến trong két</small><strong class="money" style="font-size:16px;color:#0f766e">${money(expected)}</strong></div>
          </div>
          ${field('Tiền mặt thực đếm cuối ca (₫) (*)', 'actualCash', expected, 'number', 'id="shift-actual-cash" required min="0" step="1000"')}
          <div id="shift-variance-box" class="note green">Chênh lệch két: <strong>0 ₫ (Khớp 100%)</strong></div>
          <label class="field full">
            <span>Ghi chú chốt ca / Giải trình chênh lệch <span id="shift-note-req"></span></span>
            <textarea id="shift-close-note" name="note" placeholder="Bắt buộc nhập lý do nếu tiền thực đếm khác tiền dự kiến…"></textarea>
          </label>
          ${formError()}
        </div>
        <div class="modal-footer">
          ${action('close-modal', 'Hủy')}
          <button class="btn primary" type="submit">${icon('lock')}Xác nhận chốt ca</button>
        </div>
      </form>`,
      true,
    );
  } catch (err) {
    notify(err.message, true);
  }
}

function updateShiftVariancePreview() {
  const input = $('#shift-actual-cash');
  const box = $('#shift-variance-box');
  const noteEl = $('#shift-close-note');
  const reqEl = $('#shift-note-req');
  if (!input || !box) return;
  const expected = Number(modalContext.expectedCash || 0);
  const actual = Number(input.value || 0);
  const diff = actual - expected;
  if (diff === 0) {
    box.className = 'note green';
    box.innerHTML = 'Chênh lệch két: <strong>0 ₫ (Khớp 100%)</strong>';
    if (noteEl) noteEl.required = false;
    if (reqEl) reqEl.textContent = '';
  } else {
    box.className = diff < 0 ? 'note red' : 'note yellow';
    box.innerHTML = `Chênh lệch két: <strong>${diff > 0 ? '+' : ''}${money(diff)}</strong> — Bắt buộc nhập ghi chú giải trình trước khi chốt ca.`;
    if (noteEl) noteEl.required = true;
    if (reqEl) reqEl.textContent = '(*)';
  }
}

function resetPosCart() {
  posCart = {
    items: [],
    customerId: '',
    discountMode: 'NONE',
    promotionCode: '',
    appliedPromotion: null,
    promoError: '',
    voucherCode: '',
    appliedVoucher: null,
    voucherError: '',
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
