/* M4: Click Actions cho Bán hàng POS, Đơn tạm & Quản lý Khuyến mãi (SQLite API). */
'use strict';

function handleSalesAction(a) {
  switch (a.action) {
    case 'customer-select':
      selectPhoneCustomer(a.id);
      break;

    case 'customer-clear':
      clearPhoneCustomer();
      break;

    case 'category':
      activeCategory = a.category;
      render();
      break;

    case 'pos-card-qty-step': {
      const input = document.querySelector(`input[data-input="pos-card-qty"][data-id="${a.id}"]`);
      if (input) {
        const val = (Number(input.value) || 1) + Number(a.step || 1);
        const max = Number(input.max) || 999;
        input.value = Math.max(1, Math.min(max, val));
      }
      break;
    }

    case 'pos-card-quick-qty': {
      const input = document.querySelector(`input[data-input="pos-card-qty"][data-id="${a.id}"]`);
      if (input) {
        const val = Number(a.qty) || 1;
        const max = Number(input.max) || 999;
        input.value = Math.max(1, Math.min(max, val));
      }
      break;
    }

    case 'add-to-cart':
    case 'add-cart': {
      const input = document.querySelector(`input[data-input="pos-card-qty"][data-id="${a.id}"]`);
      const qty = input ? Math.max(1, Number(input.value) || 1) : 1;
      addCart(a.id, qty);
      break;
    }

    case 'cart-qty':
      addCart(a.id, Number(a.delta));
      break;

    case 'cart-minus':
      addCart(a.id, -1);
      break;

    case 'remove-cart':
    case 'cart-remove':
      posCart.items = posCart.items.filter((i) => i.productId !== a.id);
      if (!posCart.items.length) {
        posCart.appliedPromotion = null;
        posCart.promoError = '';
      }
      render();
      break;

    case 'clear-cart':
      confirmation(
        'Xóa toàn bộ giỏ hàng?',
        `Giỏ hàng hiện tại (${posCart.items.length} dòng hàng) sẽ được làm trống.`,
        () => {
          resetPosCart();
          render();
          notify('Đã làm trống giỏ hàng POS.');
        },
      );
      break;

    case 'apply-promo-code': {
      const code = $('#pos-promo-code')?.value || posCart.promotionCode || '';
      applyPosPromoCode(code).catch((err) => notify(err.message, true));
      break;
    }

    case 'apply-promo-pick':
      applyPosPromoCode(a.code || '').catch((err) => notify(err.message, true));
      break;

    case 'remove-promo':
      posCart.promotionCode = '';
      posCart.appliedPromotion = null;
      posCart.promoError = '';
      render();
      notify('Đã gỡ mã khuyến mãi khỏi hóa đơn.');
      break;

    case 'hold':
      holdCurrentPosOrder();
      notify('Đã lưu đơn tạm. Bạn có thể lập đơn hàng mới ngay.');
      break;

    case 'held-orders':
      heldModal();
      break;

    case 'restore-held': {
      const idx = posHeldOrders.findIndex((h) => h.id === a.id);
      if (idx === -1) throw new Error('Đơn tạm không còn tồn tại.');
      const [held] = posHeldOrders.splice(idx, 1);
      posCart = JSON.parse(JSON.stringify(held.cart));
      customerSearchState.customerId = posCart.customerId || '';
      closeModal();
      render();
      notify(`Đã mở lại đơn tạm ${held.id}.`);
      break;
    }

    case 'delete-held': {
      const hid = a.id;
      confirmation('Xóa đơn tạm?', `Đơn tạm <strong>${e(hid)}</strong> sẽ bị xóa khỏi danh sách.`, () => {
        posHeldOrders = posHeldOrders.filter((h) => h.id !== hid);
        render();
        heldModal();
        notify(`Đã xóa đơn tạm ${hid}.`);
      });
      break;
    }

    case 'checkout':
      if (!posCart.items.length) throw new Error('Vui lòng chọn ít nhất 1 sản phẩm trước khi thanh toán.');
      checkoutModal('CASH');
      break;

    case 'payment-method':
      checkoutModal(a.method || 'CASH');
      break;

    case 'quick-cash-amount':
    case 'quick-cash':
      if ($('#cash-input')) {
        $('#cash-input').value = a.amount;
        updateCash();
      }
      break;

    case 'numpad': {
      const input = $('#cash-input');
      if (input) {
        input.value =
          a.key === 'C'
            ? ''
            : a.key === '⌫'
              ? input.value.slice(0, -1)
              : (input.value === '0' ? '' : input.value) + a.key;
        updateCash();
      }
      break;
    }

    case 'scan':
      modalContext = { type: 'scan' };
      showModal(
        'Quét / nhập mã vạch hoặc SKU',
        `<form id="scan-form">
          <div class="modal-content stack">
            ${field('Mã vạch (Barcode) hoặc SKU (*)', 'code', '', 'text', 'required autofocus autocomplete="off" placeholder="VD: 8934588012228 hoặc NUOC-001"')}
            <div class="note">Quét bằng máy đọc mã vạch USB hoặc gõ mã rồi nhấn <strong>Enter</strong> để thêm nhanh 1 sản phẩm vào giỏ POS.</div>
            ${formError()}
          </div>
          <div class="modal-footer">
            ${action('close-modal', 'Hủy')}
            <button class="btn primary" type="submit">${icon('cart')}Thêm vào giỏ</button>
          </div>
        </form>`,
      );
      break;

    case 'search-product':
      navigate('pos');
      try {
        addCart(a.id, 1);
      } catch (err) {
        notify(err.message, true);
      }
      if ($('#global-search')) $('#global-search').value = '';
      $('#global-results')?.remove();
      break;

    // ─── PROMOTIONS MANAGEMENT (M4) ────────────────────────────────────
    case 'promo-new':
      promotionModal('');
      break;

    case 'promo-edit':
      promotionModal(a.id);
      break;

    case 'promo-toggle-status': {
      const targetId = a.id;
      const targetCode = a.code || targetId;
      const nextStatus = a.nextStatus;
      const labelMap = {
        DangDienRa: 'Kích hoạt (Đang diễn ra)',
        TamDung: 'Tạm dừng',
        KetThuc: 'Kết thúc chương trình (không thể áp dụng mới)',
      };
      confirmation(
        `Chuyển trạng thái khuyến mãi ${targetCode}?`,
        `Chương trình khuyến mãi <strong>${e(targetCode)}</strong> sẽ chuyển sang trạng thái <strong>${e(labelMap[nextStatus] || nextStatus)}</strong>. Các hóa đơn cũ đã áp dụng mã này vẫn được giữ nguyên lịch sử.`,
        async () => {
          await api.setPromotionStatus(targetId, nextStatus);
          notify(`Đã chuyển trạng thái mã ${targetCode} → ${statusLabels[nextStatus]?.[0] || nextStatus}.`);
          await loadPromotionsData(true);
        },
      );
      break;
    }

    case 'promotions-reset':
      delete filters.promotions;
      delete filters.promoStatus;
      pagination.promotions = 1;
      loadPromotionsData(true);
      render();
      break;

    default:
      return false;
  }
  return true;
}
