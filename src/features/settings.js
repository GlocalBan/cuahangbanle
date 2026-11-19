function settingsView() {
  if (!apiState.thamSoLoaded && !apiState.loading.thamSo) {
    loadThamSoData();
  }
  const items = apiState.thamSo || [];
  const byCode = Object.fromEntries(items.map((x) => [x.maThamSo, x.giaTri]));
  const s = store.data.settings;

  const val = (code, fallback) => (byCode[code] !== undefined ? byCode[code] : fallback);

  const paramRows = items.map(
    (ts) => `<tr>
      <td><code>${e(ts.maThamSo)}</code></td>
      <td class="name">${e(ts.tenThamSo)}<div class="sub">${e(ts.moTa)}</div></td>
      <td>${badge(e(ts.kieuDuLieu), ts.kieuDuLieu === 'NUMBER' ? 'blue' : 'gray')}</td>
      <td class="${ts.kieuDuLieu === 'NUMBER' ? 'money name' : 'name'}">${e(ts.giaTri)}</td>
      <td>${ts.tinhTrang === 'ACTIVE' ? badge('Đang áp dụng', 'green') : badge('Ngưng áp dụng', 'gray')}</td>
      <td><div class="sub">${date(ts.updatedAt)}<br>${e(ts.updatedBy)}</div></td>
    </tr>`,
  );

  return (
    heading(
      'QUẢN TRỊ HỆ THỐNG / THAM SỐ & CẤU HÌNH',
      'Tham số hệ thống (THAM_SO) & Sao lưu',
      'Quản lý tập trung cấu hình cửa hàng, tỷ lệ VAT, ngưỡng tồn tối thiểu mặc định và hạn trả hàng theo bảng THAM_SO (BR-07).',
      action('navigate', 'Xem Nhật ký kiểm toán', 'shield', '', 'data-page="audit-logs"'),
    ) +
    `<div class="two-col">
      <section class="panel">
        <div class="panel-head">
          <h2>Biểu mẫu cập nhật bảng THAM_SO</h2>
          ${apiState.loading.thamSo ? badge('Đang tải…', 'yellow') : badge('Đồng bộ CSDL SQLite', 'green')}
        </div>
        <form id="tham-so-form">
          <div class="panel-body form-grid">
            ${field('Tên cửa hàng (*)', 'TenCuaHang', val('TenCuaHang', s.name), 'text', 'required maxlength="150"', true)}
            ${field('Hotline / Điện thoại (*)', 'HotlineCuaHang', val('HotlineCuaHang', s.phone), 'text', 'required maxlength="30"')}
            ${field('Tỷ lệ thuế VAT (%) (*)', 'TyLeVAT', val('TyLeVAT', s.taxRate), 'number', 'required min="0" max="100" step="0.5"')}
            ${field('Ngưỡng tồn tối thiểu mặc định (*)', 'TonToiThieuMacDinh', val('TonToiThieuMacDinh', 15), 'number', 'required min="0" max="100000" step="1"')}
            ${field('Số ngày cho phép trả hàng (*)', 'SoNgayChoPhepTraHang', val('SoNgayChoPhepTraHang', 7), 'number', 'required min="1" max="365" step="1"')}
            ${field('Địa chỉ kinh doanh (*)', 'DiaChiCuaHang', val('DiaChiCuaHang', s.address), 'text', 'required maxlength="250"', true)}
            ${field('Ngân hàng nhận VietQR', 'NganHangVietQR', val('NganHangVietQR', s.bank), 'text', 'maxlength="100"')}
            ${field('Số tài khoản VietQR', 'SoTaiKhoanVietQR', val('SoTaiKhoanVietQR', s.bankAccount), 'text', 'maxlength="60"')}
            ${field('Chủ tài khoản VietQR', 'ChuTaiKhoanVietQR', val('ChuTaiKhoanVietQR', s.bankOwner), 'text', 'maxlength="150"', true)}
            ${textField('Lời nhắn cuối hóa đơn', 'LoiNhanHoaDon', val('LoiNhanHoaDon', s.receiptNote))}
            <div class="full row gap8">
              <button class="btn primary" type="submit">${icon('check')}Lưu tham số hệ thống</button>
              ${action('tham-so-reload', 'Tải lại từ CSDL', 'clock', '')}
            </div>
            ${formError()}
          </div>
        </form>
      </section>
      <div class="stack">
        <section class="panel">
          <div class="panel-head"><h2>Quy tắc vận hành & Bảo mật</h2></div>
          <div class="panel-body rules">
            ${[
              ['shield', 'Phân quyền RBAC 3 lớp', 'Cơ sở dữ liệu · API Guard (401/403) · Giao diện'],
              ['lock', 'Bảo mật tài khoản', 'Mật khẩu băm scrypt; khóa tài khoản giữ nguyên chứng từ'],
              ['settings', 'Tham số động THAM_SO', 'Cập nhật tập trung VAT, tồn tối thiểu và hạn trả hàng'],
              ['receipt', 'Nhật ký kiểm toán bất biến', 'Chỉ ghi thêm (append-only), chặn mọi thao tác sửa/xóa'],
            ]
              .map(
                ([ico, title, desc]) =>
                  `<div class="rule"><span class="badge">${icon(ico)}</span><div><strong>${title}</strong><p class="sub">${desc}</p></div>${badge('Hoạt động')}</div>`,
              )
              .join('')}
          </div>
        </section>
        <section class="panel">
          <div class="panel-head"><h2>Sao lưu & khôi phục dữ liệu</h2></div>
          <div class="panel-body stack">
            <p class="sub">Tải bản sao lưu JSON định kỳ hoặc khôi phục từ bản sao lưu hợp lệ (chỉ dành cho Admin).</p>
            ${action('backup', 'Tải bản sao lưu JSON', 'download')}
            ${action('restore', 'Khôi phục từ bản sao lưu', 'upload')}
          </div>
        </section>
      </div>
    </div>
    <section class="panel mt16">
      <div class="panel-head">
        <h2>Chi tiết bảng THAM_SO dạng dòng (${items.length} tham số)</h2>
        ${badge('Cấu trúc chuẩn 9 quy tắc OOD', 'gray')}
      </div>
      ${table(['Mã tham số', 'Tên tham số & Mô tả', 'Kiểu dữ liệu', 'Giá trị hiện tại', 'Tình trạng', 'Cập nhật'], paramRows)}
    </section>`
  );
}
