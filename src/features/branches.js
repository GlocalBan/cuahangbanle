function branchesView() {
  const s = store.data,
    b = s.branches.find((b) => b.status === 'active');
  return (
    heading(
      'QUẢN TRỊ / CHI NHÁNH',
      'Quản lý chi nhánh',
      'Thông tin chi nhánh chính và đề xuất mở rộng vùng phục vụ.',
      action('branch-new', 'Đề xuất chi nhánh', 'plus', 'primary'),
    ) +
    `<div class="two-col"><section class="panel"><div class="panel-head"><h2>Thông tin chi nhánh hiện tại</h2>${badge('Đang hoạt động')}</div><div class="panel-body stack"><div class="mini-card">Tên cửa hàng<strong>${e(s.settings.name)}</strong><p class="sub">${e(s.settings.address)}</p></div><div class="mini-cards"><div class="mini-card">Kho liên kết<strong>${e(b?.warehouse || 'Kho chính')}</strong></div><div class="mini-card">Nhà cung cấp hỗ trợ<strong>${s.suppliers.filter((x) => x.active).length} đối tác</strong></div></div><div class="note yellow">Hiện dữ liệu bán hàng và tồn kho vận hành tại chi nhánh chính. Đề xuất mở chi nhánh được lưu để tiếp tục phát triển; chưa tách kho hoặc chuyển đổi chi nhánh.</div></div></section><section class="panel"><div class="panel-head"><h2>Quy trình đề xuất chi nhánh</h2></div><div class="panel-body stack"><div class="mini-cards">${['01 · Đề xuất địa chỉ', '02 · Kiểm tra vùng cung ứng', '03 · Gắn đối tác phục vụ', '04 · Lưu đề xuất'].map((x) => `<div class="note">${x}</div>`).join('')}</div><p class="sub">Kiểm tra nhà cung cấp đang hoạt động và có vùng cung ứng phù hợp trước khi lưu đề xuất.</p>${action('branch-new', 'Bắt đầu kiểm tra địa chỉ', 'plus', 'primary')}</div></section></div><section class="panel mt16"><div class="panel-head"><h2>Danh sách đề xuất mở rộng</h2></div>${table(
      ['Chi nhánh đề xuất', 'Địa chỉ', 'Vùng phục vụ', 'Đối tác phù hợp', 'Trạng thái'],
      s.branches
        .filter((b) => b.status === 'proposed')
        .map(
          (b) =>
            `<tr><td class="name">${e(b.name)}</td><td>${e(b.address)}</td><td>${e(b.area)}</td><td>${b.supplierIds.map((id) => e(s.suppliers.find((s) => s.id === id)?.name || id)).join(', ')}</td><td>${badge('Đã đề xuất', 'yellow')}</td></tr>`,
        ),
    )}</section>`
  );
}

function branchModal() {
  store.admin();
  showModal(
    'Đề xuất chi nhánh mới',
    `<form id="branch-form"><div class="modal-content form-grid">${field('Tên chi nhánh', 'name', '', 'text', 'required maxlength="150"', true)}${field('Địa chỉ', 'address', '', 'text', 'required maxlength="250"', true)}${field('Vùng phục vụ (ví dụ: TP. HCM)', 'area', 'TP. HCM', 'text', 'required maxlength="100"', true)}<div class="note full">Nhà cung cấp phải có vùng cung ứng chứa địa danh này. Ví dụ: “TP. HCM”, “Bình Dương”, “Đồng Nai”.</div>${formError()}</div>${foot('Kiểm tra & lưu đề xuất')}</form>`,
  );
}
