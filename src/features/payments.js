/* M4 + Phase 2: Modal Thanh toán POS (BR-04 & BR-05) — Thanh toán 100% một lần (Tiền mặt / VietQR / Thẻ), không bán chịu/tách đơn. */
'use strict';

const POS_PAYMENT_METHODS = [
  ['CASH', 'Tiền mặt', 'cash'],
  ['VIETQR', 'Chuyển khoản / VietQR', 'transfer'],
  ['CARD', 'Thẻ ngân hàng', 'card'],
];

function checkoutModal(method = 'CASH') {
  const normalizedMethod =
    method === 'cash' ? 'CASH' : method === 'transfer' ? 'VIETQR' : method === 'card' ? 'CARD' : method;
  if (!posCart.items.length) {
    throw new Error('Chọn tối thiểu 1 sản phẩm trước khi thanh toán.');
  }
  modalContext = { type: 'checkout', method: normalizedMethod };
  const t = computePosCartPricing();
  const totalQty = posCart.items.reduce((s, i) => s + i.qty, 0);
  const cfg = store.data.settings || {};
  const suggestedRef = `VQR${Date.now().toString().slice(-6)}`;

  showModal(
    'Thanh toán hóa đơn POS · 100% một lần (BR-05)',
    `<form id="checkout-form">
      <div class="modal-content">
        <div class="payment-breakdown" style="background:#f8fafc;padding:12px 14px;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:12px;font-size:12.5px;display:flex;flex-direction:column;gap:6px">
          <div class="between"><span class="muted">1. Tạm tính (${number(totalQty)} sản phẩm)</span><span class="money">${money(t.subtotal)}</span></div>
          ${
            t.invoiceDiscount > 0
              ? `<div class="between positive"><span>2. Giảm giá hóa đơn (${e(t.discountLabel || '')})</span><span class="money">−${money(t.invoiceDiscount)}</span></div>`
              : ''
          }
          <div class="between"><span class="muted">3. Tiền sau giảm</span><span class="money">${money(t.afterDiscount)}</span></div>
          <div class="between"><span class="muted">4. Thuế VAT (${t.taxRate}% · THAM_SO)</span><span class="money">${money(t.taxAmount)}</span></div>
        </div>
        <div class="payment-total">5. TỔNG THANH TOÁN ĐỦ 100%<b>${money(t.totalAmount)}</b></div>
        <div class="payment-methods">
          ${POS_PAYMENT_METHODS.map(
            ([key, label, ico]) =>
              `<button type="button" data-action="payment-method" data-method="${key}" class="${normalizedMethod === key ? 'active' : ''}">${icon(ico)}${label}</button>`,
          ).join('')}
        </div>
        <input type="hidden" name="paymentMethod" value="${normalizedMethod}">
        ${
          normalizedMethod === 'CASH'
            ? `<div class="stack">
                ${field('Tiền khách đưa (₫) (*)', 'cashReceived', t.totalAmount, 'number', 'id="cash-input" required min="0" step="1"')}
                <div class="cash-quick">
                  ${action('quick-cash-amount', 'Đúng số tiền', '', 'small primary', `data-amount="${t.totalAmount}"`)}
                  ${[50000, 100000, 200000, 500000, 1000000]
                    .map((n) => action('quick-cash-amount', number(n), '', 'small', `data-amount="${n}"`))
                    .join('')}
                </div>
                <div id="cash-warning" class="mt8" style="display:none"></div>
                <div class="between">
                  <span class="muted">Tiền thối lại cho khách</span>
                  <strong id="cash-change" class="positive money">0 ₫</strong>
                </div>
                <details>
                  <summary class="sub" style="cursor:pointer">Bàn phím số nhanh</summary>
                  <div class="numpad mt16">
                    ${['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫']
                      .map((n) => `<button type="button" data-action="numpad" data-key="${n}">${n}</button>`)
                      .join('')}
                  </div>
                </details>
              </div>`
            : `<div class="stack">
                ${
                  normalizedMethod === 'VIETQR'
                    ? `<div class="note">
                        <strong>Thông tin chuyển khoản VietQR (từ THAM_SO):</strong><br>
                        Ngân hàng: <strong>${e(cfg.bank || 'Vietcombank')}</strong> · STK: <strong>${e(cfg.bankAccount || '0123456789')}</strong><br>
                        Chủ tài khoản: <strong>${e(cfg.bankOwner || 'CUA HANG RETAILFLOW')}</strong><br>
                        Số tiền: <strong>${money(t.totalAmount)}</strong> · Nội dung gợi ý: <code>${suggestedRef}</code>
                      </div>`
                    : '<div class="note">Quẹt thẻ tại máy POS ngân hàng, sau đó nhập mã giao dịch / số phê duyệt trên biên lai.</div>'
                }
                ${field('Mã tham chiếu giao dịch (*)', 'paymentRef', normalizedMethod === 'VIETQR' ? suggestedRef : '', 'text', 'required minlength="3" maxlength="100" placeholder="Nhập mã giao dịch VietQR / thẻ…"')}
                <label class="check-label">
                  <input type="checkbox" name="confirmed" required>
                  <span>Tôi xác nhận cửa hàng đã nhận đủ 100% số tiền <strong>${money(t.totalAmount)}</strong>.</span>
                </label>
              </div>`
        }
        ${formError()}
      </div>
      <div class="modal-footer">
        ${action('close-modal', 'Hủy')}
        <button class="btn teal" type="submit">${icon('check')}Xác nhận thanh toán ${money(t.totalAmount)}</button>
      </div>
    </form>`,
  );
  if (normalizedMethod === 'CASH') updateCash();
}

function updateCash() {
  const input = $('#cash-input');
  if (!input) return;
  const t = computePosCartPricing();
  const received = Number(input.value) || 0;
  const warning = $('#cash-warning');
  const submitBtn = $('#checkout-form button[type="submit"]');
  const changeEl = $('#cash-change');

  if (received < t.totalAmount) {
    const shortage = t.totalAmount - received;
    if (warning) {
      warning.style.display = 'block';
      warning.innerHTML = `<span class="badge red">Tiền khách đưa chưa đủ — Còn thiếu ${money(shortage)} (Cửa hàng chỉ nhận thanh toán đủ 100%, không bán chịu)</span>`;
    }
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.title = `Tiền khách đưa còn thiếu ${money(shortage)}`;
    }
    if (changeEl) changeEl.textContent = '0 ₫';
  } else {
    if (warning) {
      warning.style.display = 'none';
      warning.innerHTML = '';
    }
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.title = '';
    }
    if (changeEl) changeEl.textContent = money(received - t.totalAmount);
  }
}
