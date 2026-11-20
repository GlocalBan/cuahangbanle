function loginScreen(initialError = '') {
  if (typeof destroyAllCharts === 'function') destroyAllCharts();
  document.body.classList.remove('sidebar-collapsed', 'menu-open');
  const errMsg = initialError || store.loadError || '';
  const demoRoles = [
    {
      username: 'admin',
      label: 'Quản trị viên',
      badge: 'Admin',
      ico: 'shield',
      accent: 'indigo',
      scope: 'Toàn quyền hệ thống, nhân sự, THAM_SO, Audit Log & sao lưu',
    },
    {
      username: 'quanly',
      label: 'Quản lý cửa hàng',
      badge: 'Quản lý',
      ico: 'chart',
      accent: 'teal',
      scope: 'Hàng hóa, khuyến mãi, duyệt nhập/kiểm kê/trả hàng & báo cáo P&L',
    },
    {
      username: 'thungan',
      label: 'Thu ngân POS',
      badge: 'Thu ngân',
      ico: 'cart',
      accent: 'sky',
      scope: 'Bán hàng tại quầy, VietQR/tiền mặt, lập phiếu đổi trả trong hạn',
    },
    {
      username: 'kho',
      label: 'Nhân viên Kho',
      badge: 'Kho',
      ico: 'warehouse',
      accent: 'amber',
      scope: 'Tạo PO/GRN, đếm kiểm kê mù, cận date/hủy hàng & Thẻ kho',
    },
    {
      username: 'ncc01',
      label: 'Nhà cung cấp (NCC003)',
      badge: 'NCC',
      ico: 'truck',
      accent: 'teal',
      scope: 'Cổng NCC: xem đơn đặt hàng gửi tới mình, chấp nhận / báo giá ngược',
    },
  ];

  $('#root').innerHTML = `<main class="login">
    <section class="login-story">
      <div class="login-story-inner">
        ${logo()}
        <div class="login-kicker">RETAIL OPERATIONS PLATFORM · OOD 3-TIER</div>
        <h1>Quản trị bán lẻ chuẩn mực.<br><span>Chính xác đến từng giao dịch.</span></h1>
        <p class="login-lead">Kiến trúc 3 tầng tách biệt (Presentation · BLL · DAL), bảo mật RBAC 3 lớp (5 vai trò), xuất kho FEFO theo lô/HSD, giao dịch SQLite nguyên tử và chuẩn hạch toán tách VAT.</p>
        <div class="login-metrics">
          <div class="login-metric-card">
            <div class="login-metric-ico">${icon('shield')}</div>
            <div><b>RBAC 5 vai trò</b><small>Admin · QL · TN · Kho · NCC</small></div>
          </div>
          <div class="login-metric-card">
            <div class="login-metric-ico">${icon('box')}</div>
            <div><b>438 SKU thật</b><small>Ảnh 1:1 + FEFO lô &amp; HSD</small></div>
          </div>
          <div class="login-metric-card">
            <div class="login-metric-ico">${icon('receipt')}</div>
            <div><b>Transaction ACID</b><small>Chặn xuất âm &amp; khóa bất biến</small></div>
          </div>
        </div>
      </div>
      <div class="login-story-foot">RETAILFLOW · KIẾN TRÚC 3 TẦNG · BẢO MẬT RBAC · VẬN HÀNH 100% OFFLINE</div>
    </section>
    <section class="login-form-wrap">
      <div class="login-form">
        <div class="login-form-mobile-logo">${logo()}</div>
        <h2>Đăng nhập hệ thống</h2>
        <p class="login-sub">Xác thực tài khoản qua máy chủ để truy cập đúng phạm vi vai trò được phân quyền.</p>
        <form id="login-form">
          ${field('Tên đăng nhập (*)', 'username', 'admin', 'text', 'required autocomplete="username"')}
          ${field('Mật khẩu (*)', 'password', '123456', 'password', 'required autocomplete="current-password"')}
          <div id="login-error" class="error-text" role="alert">${e(errMsg)}</div>
          <button type="submit" class="btn primary wide login-submit">Đăng nhập ${icon('arrow')}</button>
        </form>
        <div class="login-hint">
          <div class="login-hint-head">
            <strong>5 tài khoản trải nghiệm theo vai trò</strong>
            <span class="badge gray">Mật khẩu chung: <code>123456</code></span>
          </div>
          <div class="role-cards">
            ${demoRoles
              .map(
                (r) => `<button type="button" class="role-card role-${r.accent}" data-action="fill-login" data-username="${r.username}">
                  <div class="role-card-icon">${icon(r.ico)}</div>
                  <div class="role-card-body">
                    <div class="role-card-top">
                      <strong>${r.label}</strong>
                      <code>${r.username}</code>
                    </div>
                    <small>${r.scope}</small>
                  </div>
                </button>`,
              )
              .join('')}
          </div>
        </div>
        <div class="login-footer">© 2026 RetailFlow · Hệ thống Quản lý Cửa hàng Bán lẻ</div>
      </div>
    </section>
  </main>`;
  if (typeof hydrateIcons === 'function') hydrateIcons();
}

function changePasswordModal() {
  if (!store.user) return;
  modalContext = { type: 'change-password' };
  const fields =
    field('Mật khẩu hiện tại (*)', 'currentPassword', '', 'password', 'required autocomplete="current-password"', true) +
    field('Mật khẩu mới (tối thiểu 6 ký tự) (*)', 'newPassword', '', 'password', 'required minlength="6" maxlength="100" autocomplete="new-password"', true) +
    field('Xác nhận mật khẩu mới (*)', 'confirmPassword', '', 'password', 'required minlength="6" maxlength="100" autocomplete="new-password"', true) +
    formError();
  showModal(
    `Đổi mật khẩu · ${e(store.user.username)}`,
    `<form id="change-password-form"><div class="modal-content form-grid">${fields}</div><div class="modal-footer">${action('close-modal', 'Hủy')}<button class="btn primary" type="submit">${icon('check')}Lưu mật khẩu mới</button></div></form>`,
  );
}
