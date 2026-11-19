function loginScreen(initialError = '') {
  const errMsg = initialError || store.loadError || '';
  $('#root').innerHTML = `<main class="login">
    <section class="login-story">
      ${logo()}
      <h1>Quản lý thông minh.<br><span>Vận hành tinh gọn.</span></h1>
      <p>Hệ thống Quản lý Cửa hàng Bán lẻ kiến trúc 3 tầng chuẩn hướng đối tượng — bảo mật RBAC 3 lớp (DB · API · UI) và đồng bộ quy tắc nghiệp vụ bán lẻ.</p>
      <div class="login-preview">
        <div class="preview-bar"></div>
        <div class="preview-cards">
          <div><b>4 Vai trò</b><small>RBAC 3 lớp chặt chẽ</small></div>
          <div><b>THAM_SO</b><small>Cấu hình động từ CSDL</small></div>
          <div><b>Audit Log</b><small>Truy vết bất biến</small></div>
        </div>
        <svg viewBox="0 0 350 60"><path d="M0 45 Q40 52 80 44 T160 35 T250 28 T350 7" fill="none" stroke="#79d8cb" stroke-opacity=".5" stroke-width="1.5"/></svg>
      </div>
      <p style="font-size:9px;margin-top:35px;color:#6882a1">KIẾN TRÚC 3 TẦNG · BẢO MẬT RBAC · GIAO DỊCH NGUYÊN TỬ.</p>
    </section>
    <section class="login-form-wrap">
      <div class="login-form">
        ${logo()}
        <h2>Đăng nhập hệ thống</h2>
        <p>Xác thực tài khoản qua máy chủ để truy cập đúng phạm vi vai trò của bạn.</p>
        <form id="login-form">
          ${field('Tên đăng nhập (*)', 'username', 'admin', 'text', 'required autocomplete="username"')}
          ${field('Mật khẩu (*)', 'password', '123456', 'password', 'required autocomplete="current-password"')}
          <div id="login-error" class="error-text" role="alert">${e(errMsg)}</div>
          <button type="submit" class="btn primary wide">Đăng nhập ${icon('arrow')}</button>
        </form>
        <div class="login-hint">
          <div style="margin-bottom:8px"><strong>4 tài khoản mẫu (mật khẩu chung: <code>123456</code>):</strong></div>
          <div class="quick-roles">
            <button type="button" class="btn small" data-action="fill-login" data-username="admin">Admin (admin)</button>
            <button type="button" class="btn small" data-action="fill-login" data-username="quanly">Quản lý (quanly)</button>
            <button type="button" class="btn small" data-action="fill-login" data-username="thungan">Thu ngân (thungan)</button>
            <button type="button" class="btn small" data-action="fill-login" data-username="kho">Kho (kho)</button>
          </div>
        </div>
        <div class="login-footer">© 2026 RetailFlow · Hệ thống Quản lý Cửa hàng Bán lẻ</div>
      </div>
    </section>
  </main>`;
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
