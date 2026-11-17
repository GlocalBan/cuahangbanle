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

    case 'select-pos-promotion':
    case 'select-promo':
      changeDraft((d) => {
        d.promotionId = a.id || null;
      });
      break;

    case 'select-pos-voucher':
    case 'apply-voucher':
      changeDraft((d) => {
        d.voucherId = a.id;
      });
      notify('Đã áp dụng App Voucher!');
      break;

    case 'remove-voucher':
      changeDraft((d) => {
        d.voucherId = null;
      });
      notify('Đã bỏ mã voucher.');
      break;

    case 'toggle-neardate-promo':
      store.toggleNearDatePromo(a.id);
      render();
      notify('Đã cập nhật trạng thái CTKM cận date.');
      break;

    case 'apply-all-neardate-promo': {
      const count = store.applyAllNearDatePromo();
      render();
      notify(`Đã đưa ${count} sản phẩm cận date vào CTKM -35%!`);
      break;
    }

    case 'cart-qty':
      addCart(a.id, Number(a.delta));
      break;

    case 'remove-cart':
      changeDraft((d) => {
        d.items = d.items.filter((i) => i.id !== a.id);
        d.discount = Math.min(
          d.discount,
          d.items.reduce((s, i) => s + i.qty * i.price, 0),
        );
      });
      break;

    case 'cart-minus':
      addCart(a.id, -1);
      break;

    case 'cart-remove':
      changeDraft((d) => {
        d.items = d.items.filter((i) => i.id !== a.id);
        d.discount = Math.min(
          d.discount,
          d.items.reduce((s, i) => s + i.qty * i.price, 0),
        );
      });
      break;

    case 'clear-cart':
      confirmation('Xóa giỏ hàng?', 'Giỏ hàng hiện tại sẽ được xóa.', () => {
        changeDraft((d) => {
          d.items = [];
          d.discount = 0;
        });
      });
      break;

    case 'hold':
      store.hold();
      render();
      notify('Đã lưu đơn tạm. Bạn có thể tạo đơn tiếp theo.');
      break;

    case 'held-orders':
      heldModal();
      break;

    case 'restore-held':
      store.restoreHeld(a.id);
      closeModal();
      render();
      notify('Đã mở lại đơn tạm.');
      break;

    case 'delete-held': {
      const hid = a.id;
      confirmation('Xóa đơn tạm?', 'Đơn tạm này sẽ được xóa khỏi danh sách.', () => {
        store.deleteHeld(hid);
        render();
        heldModal();
      });
      break;
    }

    case 'checkout':
      if (!store.data.draft.items.length) throw new Error('Chọn sản phẩm trước khi thanh toán.');
      checkoutModal();
      break;

    case 'payment-method':
      checkoutModal(a.method);
      break;

    case 'quick-cash-amount':
    case 'quick-cash':
      $('#cash-input').value = a.amount;
      updateCash();
      break;

    case 'numpad': {
      const input = $('#cash-input');
      input.value =
        a.key === 'C'
          ? ''
          : a.key === '⌫'
            ? input.value.slice(0, -1)
            : (input.value === '0' ? '' : input.value) + a.key;
      updateCash();
      break;
    }

    case 'scan':
      modalContext = { type: 'scan' };
      showModal(
        'Quét / nhập mã sản phẩm',
        `<form id="scan-form"><div class="modal-content stack">${field('Mã vạch hoặc mã sản phẩm', 'code', '', 'text', 'required autofocus autocomplete="off"')}<div class="note">Dùng máy quét mã vạch USB hoặc nhập mã và nhấn Enter. Không cần bật camera.</div>${formError()}</div>${foot('Thêm vào giỏ')}</form>`,
      );
      break;

    case 'search-product':
      navigate('pos');
      addCart(a.id);
      $('#global-search').value = '';
      $('#global-results')?.remove();
      break;
    default:
      return false;
  }
  return true;
}
