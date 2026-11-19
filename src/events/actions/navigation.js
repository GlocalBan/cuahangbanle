function handleNavigationAction(a) {
  switch (a.action) {
    case 'navigate':
      navigate(a.page);
      $('#global-results')?.remove();
      break;

    case 'fill-login': {
      const form = $('#login-form');
      if (form) {
        const userIn = form.querySelector('input[name="username"]');
        const passIn = form.querySelector('input[name="password"]');
        if (userIn) userIn.value = a.username || 'admin';
        if (passIn) passIn.value = '123456';
        userIn?.focus();
      }
      break;
    }

    case 'open-change-password':
      changePasswordModal();
      break;

    case 'logout': {
      const unsavedCount = (posCart?.items?.length || 0);
      const hasUnsavedPos = store.can('pos') && unsavedCount > 0;
      const bodyMsg = hasUnsavedPos
        ? `Cảnh báo: Đang có <strong>${unsavedCount} dòng sản phẩm</strong> trong giỏ POS chưa thanh toán. Bạn có chắc chắn muốn đăng xuất khỏi tài khoản <strong>${e(store.user?.username || '')}</strong>?`
        : `Bạn có chắc chắn muốn đăng xuất khỏi tài khoản <strong>${e(store.user?.fullName || store.user?.name || '')}</strong>? Phiên làm việc hiện tại sẽ bị thu hồi.`;
      confirmation('Xác nhận đăng xuất?', bodyMsg, async () => {
        try {
          await api.logout();
        } catch {
          // Always clear local session even if token already expired
        }
        setAuthToken('');
        store.setAuthenticatedUser(null);
        resetApiCaches();
        if (typeof resetPosCart === 'function') resetPosCart();
        posHeldOrders = [];
        productsTab = 'products';
        inventoryTab = 'stock';
        window.location.hash = '';
        loginScreen();
        notify('Bạn đã đăng xuất an toàn.');
      });
      break;
    }

    case 'mobile-menu': {
      const nextOpen = !$('.sidebar')?.classList.contains('open');
      $('.sidebar')?.classList.toggle('open', nextOpen);
      document.body.classList.toggle('menu-open', nextOpen);
      break;
    }

    case 'toggle-sidebar': {
      setSidebarCollapsed(!sidebarCollapsed);
      const toggleBtn = $('[data-action="toggle-sidebar"]');
      if (toggleBtn) {
        toggleBtn.innerHTML = icon(sidebarCollapsed ? 'collapse-right' : 'collapse-left');
        toggleBtn.title = sidebarCollapsed ? 'Mở rộng menu bên trái' : 'Thu gọn menu bên trái';
        toggleBtn.setAttribute('aria-label', toggleBtn.title);
        hydrateIcons();
      }
      break;
    }

    case 'close-modal':
      closeModal();
      break;

    case 'confirm': {
      const fn = modalContext.onConfirm;
      closeModal();
      if (typeof fn === 'function') {
        Promise.resolve()
          .then(() => fn())
          .catch((err) => notify(err?.message || 'Thao tác thất bại.', true));
      }
      break;
    }

    case 'chart-period':
      chartDays = Number(a.days) || 7;
      loadDashboardData(true);
      break;

    case 'paginate':
      pagination[a.key] = (pagination[a.key] || 1) + Number(a.delta);
      render();
      break;

    case 'notifications': {
      const lowList = apiState.productsLoaded
        ? (apiState.products || []).filter((p) => p.status === 'DangKinhDoanh' && Number(p.stockQty) <= Number(p.minStock || 15))
        : (apiState.dashboardData?.queues?.lowStockProducts || []);
      showModal(
        'Thông báo cửa hàng',
        `<div class="modal-content stack">${
          lowList
            .slice(0, 12)
            .map(
              (p) =>
                `<div class="note yellow"><strong>${e(p.name)}</strong> · Tồn hiện tại: ${number(p.stockQty)} / tối thiểu ${number(p.minStock || 15)}.</div>`,
            )
            .join('') || empty('Kho hàng đủ hàng', 'Không có mặt hàng nào ở mức tồn kho tối thiểu.')
        }<div class="row gap8 wrap">${store.can('purchases') ? action('navigate-modal', 'Xem phiếu nhập', 'truck', '', 'data-page="purchases"') : ''}${store.can('returns') ? action('navigate-modal', 'Xem phiếu trả hàng', 'return', '', 'data-page="returns"') : ''}</div></div>`,
      );
      break;
    }

    case 'navigate-modal':
      closeModal();
      navigate(a.page);
      break;

    default:
      return false;
  }
  return true;
}
