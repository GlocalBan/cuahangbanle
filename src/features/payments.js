function checkoutModal(method = 'cash') {
  modalContext = { type: 'checkout', method };
  const d = store.data.draft;
  const promo = (store.data.promotions || []).find((p) => p.id === d.promotionId);
  const vouch = (store.data.vouchers || []).find((v) => v.id === d.voucherId);
  const t = totals(d.items, d.discount, store.data.settings.taxRate, {
    promotion: promo,
    voucher: vouch,
    products: store.data.products,
  });
  showModal(
    'Thanh toán đơn hàng',
    `<form id="checkout-form"><div class="modal-content"><div class="payment-breakdown" style="background:#f8fafc;padding:10px 14px;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:12px;font-size:12.5px;display:flex;flex-direction:column;gap:5px"><div class="between"><span class="muted">Tạm tính (${d.items.reduce((s,i)=>s+i.qty,0)} sản phẩm)</span><span class="money">${money(t.subtotal)}</span></div>${t.promotionDiscount ? `<div class="between positive"><span>Giảm giá CTKM ${promo ? `(${e(promo.code)})` : ''}</span><span class="money">−${money(t.promotionDiscount)}</span></div>` : ''}${t.voucherDiscount ? `<div class="between positive"><span>Giảm giá App Voucher ${vouch ? `(${e(vouch.code)})` : ''}</span><span class="money">−${money(t.voucherDiscount)}</span></div>` : ''}${t.tax ? `<div class="between"><span class="muted">Thuế (${store.data.settings.taxRate}%)</span><span class="money">${money(t.tax)}</span></div>` : ''}</div><div class="payment-total">TỔNG SỐ TIỀN THANH TOÁN<b>${money(t.total)}</b></div><div class="payment-methods">${Object.entries(
      METHODS,
    )
      .map(
        ([key, label]) =>
          `<button type="button" data-action="payment-method" data-method="${key}" class="${method === key ? 'active' : ''}">${icon(key === 'cash' ? 'cash' : key === 'card' ? 'card' : 'transfer')}${label}</button>`,
      )
      .join(
        '',
      )}</div><input type="hidden" name="payment" value="${method}">${
      method === 'cash'
        ? `<div class="stack">${field('Tiền khách đưa (₫)', 'received', t.total, 'number', 'id="cash-input" required min="0" step="1"')}<div class="cash-quick">${action('quick-cash-amount', 'Đúng số tiền', '', 'small primary', `data-amount="${t.total}" data-action="quick-cash-amount"`)}${[50000, 100000, 200000, 500000, 1000000].map((n) => action('quick-cash-amount', number(n), '', 'small', `data-amount="${n}" data-action="quick-cash-amount"`)).join('')}</div><div id="cash-warning" class="mt8" style="display:none"></div><div class="between"><span class="muted">Tiền trả lại</span><strong id="cash-change" class="positive money">0 ₫</strong></div><details><summary class="sub" style="cursor:pointer">Bàn phím số</summary><div class="numpad mt16">${['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].map((n) => `<button type="button" data-action="numpad" data-key="${n}">${n}</button>`).join('')}</div></details></div>`
        : `<div class="stack">${method === 'transfer' ? `<div class="note">Chuyển khoản tới <strong>${e(store.data.settings.bank)}</strong><br>STK: <strong>${e(store.data.settings.bankAccount)}</strong><br>Chủ tài khoản: ${e(store.data.settings.bankOwner)}<br>Nội dung gợi ý: RF ${Date.now().toString().slice(-6)}</div>` : '<div class="note">Thực hiện giao dịch trên máy POS của cửa hàng, sau đó nhập mã tham chiếu trên biên lai.</div>'}${field('Mã tham chiếu giao dịch', 'paymentRef', '', 'text', 'required maxlength="100" placeholder="Nhập mã giao dịch đã nhận…"')}<label class="check-label"><input type="checkbox" name="confirmed" required><span>Tôi đã kiểm tra và xác nhận cửa hàng nhận đủ <strong>${money(t.total)}</strong>.</span></label><p class="sub">Đây là bước ghi nhận thủ công, chưa kết nối ngân hàng hoặc cổng thanh toán.</p></div>`
    }<div class="mt16">${selectField(
      'Nhóm khách hàng (không bắt buộc)',
      'demographic',
      ['Không ghi nhận', 'Nam', 'Nữ', 'Khác'].map((x) => [x, x]),
      store.data.draft.demographic,
    )}</div>${formError()}</div>${foot('Xác nhận thanh toán', 'teal')}</form>`,
  );
  if (method === 'cash') updateCash();
}

function updateCash() {
  const input = $('#cash-input');
  if (input) {
    const d = store.data.draft;
    const promo = (store.data.promotions || []).find((p) => p.id === d.promotionId);
    const vouch = (store.data.vouchers || []).find((v) => v.id === d.voucherId);
    const t = totals(d.items, d.discount, store.data.settings.taxRate, {
      promotion: promo,
      voucher: vouch,
      products: store.data.products,
    });
    const received = Number(input.value) || 0;
    const warning = $('#cash-warning');
    const submitBtn = $('#checkout-form button[type="submit"]');
    const changeEl = $('#cash-change');

    if (received < t.total) {
      const shortage = t.total - received;
      if (warning) {
        warning.style.display = 'block';
        warning.innerHTML = `<span class="badge red">Không hỗ trợ trả 1 phần — Khách còn thiếu: ${money(shortage)}</span>`;
      }
      if (submitBtn) submitBtn.disabled = true;
      if (changeEl) changeEl.textContent = '0 ₫';
    } else {
      if (warning) {
        warning.style.display = 'none';
        warning.innerHTML = '';
      }
      if (submitBtn) submitBtn.disabled = false;
      if (changeEl) changeEl.textContent = money(received - t.total);
    }
  }
}
