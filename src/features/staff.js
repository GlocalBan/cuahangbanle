function staffView() {
  if (!apiState.staffLoaded && !apiState.loading.staff) {
    loadStaffData();
  }

  const allStaff = apiState.staff || [];
  const roles = apiState.roles || [];
  const searchQuery = filters.staffSearch || '';
  const roleFilter = filters.staffRole || '';
  const statusFilter = filters.staffStatus || '';

  const filtered = allStaff.filter((u) => {
    const okSearch = match(`${u.id} ${u.fullName || u.name} ${u.username} ${u.phone || ''} ${u.email || ''}`, searchQuery);
    const okRole = !roleFilter || u.role === roleFilter;
    const okStatus = !statusFilter || u.status === statusFilter;
    return okSearch && okRole && okStatus;
  });

  const p = paginate(filtered, 'staff');
  const activeCount = allStaff.filter((u) => u.status === 'ACTIVE').length;
  const lockedCount = allStaff.filter((u) => u.status === 'LOCKED').length;
  const managerAdminCount = allStaff.filter((u) => ['ADMIN', 'MANAGER'].includes(u.role)).length;

  const roleBadgeColor = (role) =>
    role === 'ADMIN' ? 'red' : role === 'MANAGER' ? 'blue' : role === 'CASHIER' ? 'green' : 'yellow';

  const rows = p.items.map((u) => {
    const isSelf = store.user && store.user.id === u.id;
    const isLocked = u.status === 'LOCKED';
    const lockBtn = isLocked
      ? action('staff-toggle-status', 'Mở khóa', 'unlock', 'small teal', `data-id="${e(u.id)}" data-status="ACTIVE" data-name="${e(u.fullName || u.name)}"`)
      : action(
          'staff-toggle-status',
          'Khóa',
          'lock',
          'small danger',
          `data-id="${e(u.id)}" data-status="LOCKED" data-name="${e(u.fullName || u.name)}" ${isSelf ? 'disabled title="Không thể tự khóa tài khoản đang đăng nhập"' : ''}`,
        );

    return `<tr>
      <td><code>${e(u.id)}</code></td>
      <td class="name">
        <div>${e(u.fullName || u.name)}${isSelf ? ' <span class="badge">Bạn</span>' : ''}</div>
        <div class="sub">${e(u.phone || u.email || 'Chưa cập nhật liên hệ')}</div>
      </td>
      <td><code>${e(u.username)}</code></td>
      <td>${badge(ROLE_SHORT[u.role] || u.role, roleBadgeColor(u.role))} <span class="sub">${e(u.role === 'ADMIN' ? 'Quản trị viên' : ROLES[u.role] || '')}</span></td>
      <td>${isLocked ? badge('Bị khóa', 'red') : badge('Đang hoạt động', 'green')}</td>
      <td>${u.lastLoginAt ? date(u.lastLoginAt) : '<span class="sub">Chưa đăng nhập</span>'}</td>
      <td>
        <div class="row gap8">
          ${action('staff-edit', 'Sửa', 'edit', 'small', `data-id="${e(u.id)}"`)}
          ${lockBtn}
        </div>
      </td>
    </tr>`;
  });

  const matrixRows = roles.map((r) => {
    const permsHtml = (r.permissions || [])
      .map((perm) => `<span class="perm-chip" title="${e(perm.description)}">${e(perm.code)}</span>`)
      .join('');
    return `<tr>
      <td class="name">${badge(r.short_name, roleBadgeColor(r.code))}<div class="sub" style="margin-top:4px">${e(r.display_name)}</div></td>
      <td style="white-space:normal;max-width:260px">${e(r.description)}</td>
      <td style="white-space:normal"><div class="perm-list">${permsHtml || '<span class="sub">—</span>'}</div></td>
    </tr>`;
  });

  return (
    heading(
      'QUẢN TRỊ HỆ THỐNG / NHÂN VIÊN & PHÂN QUYỀN',
      'Quản lý nhân viên & Ma trận RBAC',
      'Tạo, sửa, gán vai trò và khóa/mở khóa tài khoản nhân viên (Soft-Delete bảo toàn lịch sử chứng từ).',
      action('staff-refresh', 'Làm mới', 'clock', '') +
        action('staff-new', 'Thêm nhân viên', 'plus', 'primary'),
    ) +
    stats([
      ['Tổng tài khoản', number(allStaff.length), 'Tài khoản nhân sự toàn hệ thống', 'users'],
      ['Đang hoạt động', number(activeCount), 'Trạng thái ACTIVE — được phép đăng nhập', 'check'],
      ['Admin & Quản lý', number(managerAdminCount), 'Vai trò quản trị và điều hành cửa hàng', 'shield'],
      ['Tài khoản bị khóa', number(lockedCount), 'Trạng thái LOCKED — giữ nguyên lịch sử', 'lock'],
    ]) +
    `<section class="panel">
      <div class="panel-head">
        <h2>Danh sách tài khoản nhân viên</h2>
        ${apiState.loading.staff ? badge('Đang tải dữ liệu…', 'yellow') : badge('Phân quyền theo vai trò', 'gray')}
      </div>
      <div class="table-tools product-filters">
        ${filterInput('staffSearch', 'Tìm theo mã NV, họ tên, tên đăng nhập, SĐT…')}
        ${filterSelect('staffRole', [
          ['', 'Tất cả vai trò'],
          ['ADMIN', 'Admin (Quản trị viên)'],
          ['MANAGER', 'QuanLy (Quản lý cửa hàng)'],
          ['CASHIER', 'ThuNgan (Thu ngân)'],
          ['WAREHOUSE', 'NhanVienKho (Nhân viên kho)'],
        ])}
        ${filterSelect('staffStatus', [
          ['', 'Tất cả trạng thái'],
          ['ACTIVE', 'Đang hoạt động (ACTIVE)'],
          ['LOCKED', 'Bị khóa (LOCKED)'],
        ])}
      </div>
      ${table(
        ['Mã NV', 'Họ và tên', 'Tên đăng nhập', 'Vai trò', 'Trạng thái', 'Đăng nhập gần nhất', 'Thao tác'],
        rows,
      )}
      ${p.foot}
    </section>
    <section class="panel mt16">
      <div class="panel-head">
        <h2>Ma trận phân quyền RBAC 4 vai trò chuẩn (RolePermission)</h2>
        ${badge('Kiểm soát quyền độc lập theo vai trò', 'gray')}
      </div>
      ${table(['Vai trò', 'Phạm vi trách nhiệm', 'Danh sách mã quyền được cấp'], matrixRows)}
    </section>`
  );
}

function staffModal(staffId = '') {
  store.requirePermission('STAFF_MANAGE');
  const existing = staffId ? apiState.staff.find((x) => x.id === staffId) : null;
  modalContext = { type: 'staff-api', id: staffId };

  const roleOptions = [
    ['ADMIN', 'Admin — Quản trị viên hệ thống'],
    ['MANAGER', 'QuanLy — Quản lý cửa hàng'],
    ['CASHIER', 'ThuNgan — Thu ngân POS'],
    ['WAREHOUSE', 'NhanVienKho — Nhân viên kho'],
  ];

  const isSelf = Boolean(existing && store.user && existing.id === store.user.id);

  const fields =
    field('Họ và tên (*)', 'fullName', existing?.fullName || existing?.name || '', 'text', 'required minlength="2" maxlength="150"', true) +
    field(
      'Tên đăng nhập (*)',
      'username',
      existing?.username || '',
      'text',
      `required minlength="3" maxlength="40" pattern="[a-zA-Z0-9_.\\-]{3,40}" autocomplete="off" ${existing ? 'readonly' : ''}`,
    ) +
    field(
      existing ? 'Mật khẩu mới (để trống nếu giữ nguyên)' : 'Mật khẩu (*)',
      'password',
      '',
      'password',
      `${existing ? '' : 'required'} minlength="6" maxlength="100" autocomplete="new-password"`,
    ) +
    field('Số điện thoại', 'phone', existing?.phone || '', 'tel', 'maxlength="18" placeholder="VD: 0901234567"') +
    field('Email', 'email', existing?.email || '', 'email', 'maxlength="150" placeholder="ten@retailflow.vn"') +
    selectField(
      'Vai trò (*)',
      'role',
      roleOptions,
      existing?.role || 'CASHIER',
      `required ${isSelf ? 'disabled' : ''}`,
      false,
    ) +
    (isSelf ? `<input type="hidden" name="role" value="${e(existing.role)}">` : '') +
    selectField(
      'Trạng thái tài khoản (*)',
      'status',
      [
        ['ACTIVE', 'Đang hoạt động (ACTIVE)'],
        ['LOCKED', 'Bị khóa (LOCKED)'],
      ],
      existing?.status || 'ACTIVE',
      `required ${isSelf ? 'disabled' : ''}`,
      false,
    ) +
    (isSelf ? '<input type="hidden" name="status" value="ACTIVE">' : '') +
    `<div class="note full">Ghi chú bảo mật: Mật khẩu được băm bằng thuật toán <strong>scrypt</strong> kèm salt ngẫu nhiên trước khi lưu vào CSDL. Khóa tài khoản sẽ thu hồi phiên truy cập nhưng vẫn giữ toàn bộ lịch sử hóa đơn/phiếu nhập.</div>` +
    formError();

  showModal(
    existing ? `Cập nhật nhân viên · ${e(existing.id)}` : 'Thêm tài khoản nhân viên mới',
    `<form id="staff-api-form"><div class="modal-content form-grid">${fields}</div><div class="modal-footer">${action('close-modal', 'Hủy')}<button class="btn primary" type="submit">${icon('check')}Lưu</button></div></form>`,
    true,
  );
}
