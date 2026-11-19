/* Phím tắt POS & quét mã nhanh bằng Enter (Ctrl+K, F2, F4, F8, Enter barcode). */
'use strict';

document.addEventListener('keydown', (event) => {
  const target = event.target;

  // Enter tại ô tìm kiếm / quét mã POS → tự động thêm sản phẩm khớp Barcode/SKU (hoặc duy nhất 1 kết quả)
  if (event.key === 'Enter' && target && target.id === 'filter-pos' && page === 'pos') {
    const query = String(target.value || '').trim();
    if (!query) return;
    event.preventDefault();
    const qLower = query.toLowerCase();
    const active = (apiState.products || []).filter((p) => p.status === 'DangKinhDoanh');
    let found = active.find(
      (p) =>
        String(p.barcode || '').toLowerCase() === qLower ||
        String(p.sku || '').toLowerCase() === qLower ||
        String(p.id || '').toLowerCase() === qLower,
    );
    if (!found) {
      const matched = active.filter((p) =>
        match(`${p.name} ${p.sku} ${p.barcode} ${p.brand || ''}`, query),
      );
      if (matched.length === 1) found = matched[0];
    }
    if (!found) {
      notify(`Không tìm thấy sản phẩm khớp duy nhất với "${query}".`, true);
      return;
    }
    try {
      addCart(found.id, 1);
      filters.pos = '';
      render();
      notify(`Đã quét thêm ${found.name} (${found.sku}).`);
      setTimeout(() => $('#filter-pos')?.focus(), 0);
    } catch (err) {
      notify(err.message, true);
    }
    return;
  }

  // Enter tại ô nhập mã khuyến mãi POS → áp dụng ngay
  if (event.key === 'Enter' && target && target.id === 'pos-promo-code' && page === 'pos') {
    event.preventDefault();
    applyPosPromoCode(target.value).catch((err) => notify(err.message, true));
    return;
  }

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    $('#global-search')?.focus();
  }
  if (event.key === 'F2' && store.can('pos')) {
    event.preventDefault();
    if (!$('#modal').open) navigate('pos');
  }
  if (event.key === 'F4' && page === 'pos' && !$('#modal').open) {
    event.preventDefault();
    try {
      holdCurrentPosOrder();
      notify('Đã lưu đơn tạm (F4).');
    } catch (err) {
      notify(err.message, true);
    }
  }
  if (event.key === 'F8' && page === 'pos' && !$('#modal').open) {
    event.preventDefault();
    if (posCart.items.length) checkoutModal('CASH');
  }
});

window.addEventListener('storage', (event) => {
  if (event.key === Retail.KEY)
    notify(
      'Dữ liệu đã thay đổi ở tab khác. Hãy tải lại trang để cập nhật trước khi thao tác tiếp.',
      true,
    );
});

$('#modal').addEventListener('click', (event) => {
  if (event.target === $('#modal')) {
    const r = event.target.getBoundingClientRect();
    if (
      event.clientX < r.left ||
      event.clientX > r.right ||
      event.clientY < r.top ||
      event.clientY > r.bottom
    )
      closeModal();
  }
});
