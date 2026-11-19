function auditLogsView() {
  if (!apiState.auditLogsLoaded && !apiState.loading.auditLogs) {
    loadAuditLogsData();
  }

  const data = apiState.auditLogs || { items: [], total: 0, page: 1, limit: 12, totalPages: 1, actions: [] };
  const rows = (data.items || []).map((log) => {
    const actionColor =
      log.action.includes('LOCK') || log.action.includes('CANCEL')
        ? 'red'
        : log.action.includes('UPDATE') || log.action.includes('CHANGE_PASSWORD')
          ? 'yellow'
          : 'green';
    return `<tr>
      <td class="money">${date(log.created_at)}</td>
      <td class="name">
        <div>${e(log.actor_name)}</div>
        <div class="sub"><code>${e(log.actor_username)}</code> · ${e(log.actor_role)}</div>
      </td>
      <td>${badge(e(log.action), actionColor)}</td>
      <td><code>${e(log.entity_type)}${log.entity_id ? ` #${e(log.entity_id)}` : ''}</code></td>
      <td style="white-space:normal;max-width:460px">${e(log.detail)}</td>
    </tr>`;
  });

  const actionOptions = [
    ['', 'Tất cả hành động'],
    ...(data.actions || []).map((act) => [act, act]),
  ];

  const current = data.page || 1;
  const totalPages = data.totalPages || 1;
  const startIdx = data.total ? (current - 1) * data.limit + 1 : 0;
  const endIdx = Math.min(current * data.limit, data.total || 0);

  return (
    heading(
      'QUẢN TRỊ HỆ THỐNG / NHẬT KÝ KIỂM TOÁN',
      'Nhật ký kiểm toán bất biến (Audit Log)',
      'Ghi nhận tự động mọi thao tác nhạy cảm: đăng nhập, đổi mật khẩu, tạo/sửa/khóa nhân viên và thay đổi THAM_SO (BR-07).',
      action('audit-refresh', 'Tải lại nhật ký', 'clock', 'primary'),
    ) +
    `<section class="panel">
      <div class="panel-head">
        <h2>Lịch sử thao tác hệ thống (${number(data.total)} bản ghi)</h2>
        ${badge('Chỉ đọc (Append-Only · Cấm sửa/xóa)', 'gray')}
      </div>
      <div class="table-tools">
        ${filterInput('auditSearch', 'Tìm theo người thực hiện, mã đối tượng, nội dung…')}
        ${filterSelect('auditAction', actionOptions)}
        <label class="date-filter">
          <span>Từ ngày</span>
          <input type="date" id="filter-auditFrom" data-filter="auditFrom" value="${e(filters.auditFrom || '')}" aria-label="Từ ngày" />
        </label>
        <label class="date-filter">
          <span>Đến ngày</span>
          <input type="date" id="filter-auditTo" data-filter="auditTo" value="${e(filters.auditTo || '')}" aria-label="Đến ngày" />
        </label>
        ${action('audit-apply-filter', 'Lọc dữ liệu', 'search', 'small primary')}
        ${action('audit-clear-filter', 'Xóa lọc', 'close', 'small')}
      </div>
      ${apiState.auditLogError ? `<div class="panel-body"><div class="note" style="background:#fef2f2;color:#991b1b;border:1px solid #fecaca" role="alert">${e(apiState.auditLogError)}</div></div>` : ''}
      ${table(['Thời gian', 'Người thực hiện', 'Hành động', 'Đối tượng', 'Chi tiết thao tác'], rows)}
      <div class="table-foot">
        <span>${data.total ? `${startIdx}–${endIdx}` : '0'} / ${number(data.total)} bản ghi</span>
        <div class="row gap8">
          ${action('audit-paginate', '←', '', 'small', `data-delta="-1" ${current <= 1 ? 'disabled' : ''}`)}
          <span>Trang ${current} / ${totalPages}</span>
          ${action('audit-paginate', '→', '', 'small', `data-delta="1" ${current >= totalPages ? 'disabled' : ''}`)}
        </div>
      </div>
    </section>`
  );
}
