document.addEventListener('keydown', (event) => {
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
      store.hold();
      render();
      notify('Đã lưu đơn tạm.');
    } catch (e) {
      notify(e.message, true);
    }
  }
  if (event.key === 'F8' && page === 'pos' && !$('#modal').open) {
    event.preventDefault();
    if (store.data.draft.items.length) checkoutModal();
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
