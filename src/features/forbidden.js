function forbiddenView(attemptedPage = '') {
  const u = store.user;
  const homePage = (ACCESS[u?.role] || ['pos'])[0];
  const targetMeta = pages.find((p) => p[0] === attemptedPage);
  const targetLabel = targetMeta ? targetMeta[1] : attemptedPage || 'Chức năng không xác định';
  const requiredPerm = PAGE_PERMISSIONS[attemptedPage] || 'RESTRICTED';

  return `<section class="panel forbidden-panel" data-testid="forbidden-page">
    <div class="forbidden-wrap">
      <div class="forbidden-code">403</div>
      <div class="forbidden-badge">${badge('Truy cập bị từ chối (403 Forbidden)', 'red')}</div>
      <h1>Bạn không có quyền truy cập trang này</h1>
      <p class="sub">Tài khoản <strong>${e(u?.name || '')}</strong> (${e(ROLES[u?.role] || u?.role || '')}) không được cấp quyền truy cập màn hình <strong>${e(targetLabel)}</strong> (mã quyền yêu cầu: <code>${e(requiredPerm)}</code>).</p>
      <div class="forbidden-actions">
        ${action('navigate', 'Quay về trang chính của bạn', 'arrow', 'primary', `data-page="${e(homePage)}"`)}
        ${action('open-change-password', 'Đổi mật khẩu', 'key', '')}
      </div>
    </div>
  </section>`;
}
