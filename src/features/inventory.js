function inventoryView() {
  const s = store.data;
  const low = s.products.filter((p) => p.active && p.stock <= p.minStock);
  const expiredCount = s.products.filter((p) => getExpiryInfo && getExpiryInfo(p.expiryDate).status === 'expired' && p.stock > 0).length;
  const tabs = [
    ['stock', 'Tồn kho'],
    ['movements', 'Lịch sử xuất nhập'],
    ['audits', 'Phiếu kiểm kê'],
  ];
  let content = '';
  if (inventoryTab === 'stock') {
    const list = s.products.filter(
      (p) =>
        match(`${p.name} ${p.id}`, filters.inventory || '') &&
        (!filters.low || p.stock <= p.minStock),
    );
    const p = paginate(list, 'stock');
    content = `<div class="table-tools">${filterInput('inventory', 'Tìm tên hoặc mã sản phẩm…')}${filterSelect(
      'low',
      [
        ['', 'Tất cả tồn kho'],
        ['yes', 'Hàng tồn thấp'],
      ],
    )}</div>${table(
      [
        'Sản phẩm',
        'Mã hàng',
        'Tồn hiện tại',
        'Hàng lỗi/hủy',
        'Ngưỡng tối thiểu',
        'Giá vốn',
        'Giá trị tồn',
        'Trạng thái',
      ],
      p.items.map(
        (p) =>
          `<tr><td class="name">${e(p.icon)} ${e(p.name)}</td><td>${e(p.id)}</td><td class="${p.stock <= p.minStock ? 'negative' : 'name'}">${p.stock}</td><td>${p.damagedStock || 0}</td><td>${p.minStock}</td><td>${money(p.costPrice !== undefined ? p.costPrice : p.cost)}</td><td class="money">${money(p.stock * (p.costPrice !== undefined ? p.costPrice : p.cost))}</td><td>${p.stock <= p.minStock ? badge('Cần nhập thêm', 'yellow') : badge('Đủ hàng')}</td></tr>`,
      ),
    )}${p.foot}`;
  }
  if (inventoryTab === 'movements') {
    const p = paginate(
      s.movements.filter((m) =>
        match(`${m.productName} ${m.reference} ${m.reason}`, filters.inventory || ''),
      ),
      'movements',
    );
    content = `<div class="table-tools">${filterInput('inventory', 'Tìm sản phẩm, mã chứng từ, loại giao dịch…')}</div>${table(
      ['Thời gian', 'Sản phẩm', 'Biến động', 'Tồn sau', 'Nghiệp vụ', 'Chứng từ', 'Người thực hiện'],
      p.items.map(
        (m) =>
          `<tr><td>${date(m.time)}</td><td class="name">${e(m.productName)}</td><td class="${m.delta > 0 ? 'positive' : 'negative'}">${m.delta > 0 ? '+' : ''}${m.delta}</td><td>${m.balance}</td><td>${e(m.reason)}</td><td>${e(m.reference)}</td><td>${e(m.actor)}</td></tr>`,
      ),
    )}${p.foot}`;
  }
  if (inventoryTab === 'audits') {
    const p = paginate(
      s.audits.flatMap((a) =>
        a.items.map((i) => ({
          ...a,
          auditId: a.id,
          auditStatus: a.status || 'resolved',
          productId: i.id,
          productName: i.name,
          before: i.previous,
          counted: i.actual,
          delta: i.delta,
          diffValue: i.diffValue || (Math.abs(i.delta) * (i.costPrice || 0)),
          resolution: i.resolutionAction || i.resolution || (i.delta < 0 ? 'damage_writeoff' : 'surplus_adjust'),
          resolutionLabel: i.resolutionLabel || '',
          responsibleStaff: i.responsibleStaff || a.actor || '',
          reason: a.note,
        })),
      ),
      'audits',
    );
    content =
      table(
        [
          'Mã kiểm kê',
          'Ngày',
          'Sản phẩm',
          'HSD',
          'Tồn trước',
          'Thực tế',
          'Lệch',
          'Trị giá lệch',
          'Phương án xử lý',
          'Lý do / Biên bản',
          'Người chịu trách nhiệm',
          'Trạng thái',
          'Thao tác',
        ],
        p.items.map((a) => {
          const prod = s.products.find((p) => p.id === a.productId || p.name === a.productName);
          const resBadge =
            a.resolution === 'damage_writeoff'
              ? '<span class="badge red">Xuất hủy hàng hỏng/hết date</span>'
              : a.resolution === 'staff_compensation'
                ? `<span class="badge yellow">NV bồi hoàn${a.responsibleStaff ? `: ${e(a.responsibleStaff)}` : ''}</span>`
                : a.resolution === 'natural_shrinkage'
                  ? '<span class="badge gray">Hao hụt tự nhiên</span>'
                  : a.resolution === 'supplier_bonus'
                    ? '<span class="badge blue">Hàng tặng NCC</span>'
                    : a.resolution === 'surplus_adjust'
                      ? '<span class="badge teal">Điều chỉnh tăng thừa</span>'
                      : '<span class="badge">Khớp số liệu</span>';
          const expCell = prod?.expiryDate && typeof getExpiryInfo === 'function'
            ? expiryBadge(prod.expiryDate)
            : '<span class="muted">Theo lô</span>';
          const prodCell = `
            <div class="product-cell">
              <div class="product-thumb">${productImage(prod || { name: a.productName, icon: '📦' }, 'product-thumb-img')}</div>
              <div>
                <strong>${e(a.productName)}</strong>
                <div class="sub">${e(prod?.barcode || a.productId)}</div>
              </div>
            </div>
          `;
          const statusBadge = a.auditStatus === 'pending_resolution' ? badge('Chờ duyệt', 'yellow') : badge('Đã giải quyết', 'green');
          const resolveAction = a.auditStatus === 'pending_resolution'
            ? action('resolve-inventory-audit', 'Phê duyệt', 'check', 'small teal', `data-id="${e(a.auditId)}"`)
            : '';
          return `<tr><td>${e(a.auditId)}</td><td>${date(a.time)}</td><td class="name">${prodCell}</td><td>${expCell}</td><td>${a.before}</td><td>${a.counted}</td><td class="${a.delta >= 0 ? 'positive' : 'negative'}"><strong>${a.delta > 0 ? '+' : ''}${a.delta}</strong></td><td class="money">${money(a.diffValue || 0)}</td><td>${resBadge}</td><td>${e(a.reason)}</td><td>${e(a.responsibleStaff || 'Ca trực kho')}</td><td>${statusBadge}</td><td>${resolveAction}</td></tr>`;
        }),
      ) + p.foot;
  }
  const totalWriteoff = s.audits.reduce((acc, a) => {
    return acc + (a.items || []).filter((i) => ['damage_writeoff', 'natural_shrinkage'].includes(i.resolution || (i.delta < 0 ? 'damage_writeoff' : ''))).reduce((sum, i) => sum + (i.diffValue || Math.abs(i.delta) * (i.costPrice || 0)), 0);
  }, 0);
  const totalCompensation = s.audits.reduce((acc, a) => {
    return acc + (a.items || []).filter((i) => i.resolution === 'staff_compensation').reduce((sum, i) => sum + (i.diffValue || Math.abs(i.delta) * (i.costPrice || 0)), 0);
  }, 0);
  const resolvedAuditsCount = s.audits.filter((a) => a.status === 'resolved' || !a.status).length;

  const currentStats = inventoryTab === 'audits'
    ? stats([
        ['Tổng phiếu đã xử lý', number(resolvedAuditsCount), 'Phiếu kiểm kê đã chốt', 'shield'],
        ['Xuất hủy hàng hỏng/hết hạn', money(totalWriteoff), 'Kết chuyển vào chi phí', 'trash'],
        ['Truy thu bồi thường', money(totalCompensation), 'Phải thu nhân viên/ca trực', 'receipt'],
        ['Hàng hết hạn cần xử lý', number(expiredCount), 'Sản phẩm hết hạn còn tồn kho', 'bell'],
      ])
    : stats([
        [
          'Tổng số lượng tồn',
          number(s.products.reduce((a, p) => a + p.stock, 0)),
          'Sản phẩm trong kho',
          'warehouse',
        ],
        [
          'Giá trị tồn kho',
          money(s.products.reduce((a, p) => a + p.stock * (p.costPrice !== undefined ? p.costPrice : p.cost), 0)),
          'Theo giá vốn hiện tại',
          'receipt',
        ],
        ['Sắp hết hàng', number(low.length), 'Bằng hoặc dưới ngưỡng', 'bell'],
        ['Phiếu kiểm kê', number(s.audits.length), 'Đã xử lý & giải quyết', 'shield'],
      ]);

  return (
    heading(
      'KHO HÀNG / KIỂM KÊ',
      'Kho & kiểm kê',
      'Quy trình kiểm kê 3 bước chuẩn CVS, xử lý hao hụt và hủy hàng hết hạn sử dụng.',
      action('audit-new', 'Tạo phiếu kiểm kê', 'plus', 'primary') +
        (expiredCount > 0
          ? action('audit-expired-products', `Lập phiếu hủy ${expiredCount} SP hết hạn`, 'trash', 'danger')
          : action('audit-expired-products', 'Kiểm tra hủy hàng hết hạn', 'trash', 'ghost')),
    ) +
    currentStats +
    `<div class="tabs">${tabs.map(([key, label]) => `<button class="${inventoryTab === key ? 'active' : ''}" data-action="inventory-tab" data-tab="${key}">${label}</button>`).join('')}</div><section class="panel"><div class="panel-head"><h2>${tabs.find((t) => t[0] === inventoryTab)[1]}</h2></div>${content}</section>`
  );
}

function auditModal() {
  store.require('inventory');
  modalContext = { type: 'audit' };
  const firstProd = store.data.products[0];
  showModal(
    'Kiểm kê tồn kho (Quy trình 3 bước CVS)',
    `<form id="audit-form"><div class="modal-content stack">
      <div class="audit-stepper mb16">
        <div class="audit-step active"><span class="step-num">1</span> <strong>Kiểm đếm & Định giá</strong></div>
        <div class="audit-step-divider">→</div>
        <div class="audit-step active"><span class="step-num">2</span> <strong>Phương án xử lý</strong></div>
        <div class="audit-step-divider">→</div>
        <div class="audit-step active"><span class="step-num">3</span> <strong>Phê duyệt & Điều chỉnh</strong></div>
      </div>
      <div class="form-grid">
        ${selectField(
          'Bước 1: Chọn sản phẩm cần kiểm kê',
          'productId',
          store.data.products.map((p) => [p.id, `${p.name} (Tồn HT: ${p.stock} | Giá vốn: ${money(p.costPrice !== undefined ? p.costPrice : p.cost)})`]),
          firstProd?.id,
          'id="audit-product-select" required',
          true,
        )}
        ${field('Số lượng thực đếm', 'counted', firstProd?.stock || 0, 'number', 'id="audit-counted-input" required min="0" step="1"', true)}
      </div>
      <div id="audit-diff-card" class="panel p12 bg-light mb8">
        <div class="between">
          <span>Chênh lệch số lượng: <strong id="audit-diff-qty" class="positive">0</strong></span>
          <span>Trị giá chênh lệch: <strong id="audit-diff-value" class="money">0 ₫</strong></span>
        </div>
      </div>
      <div class="form-grid">
        ${selectField(
          'Bước 2: Phương án giải quyết thực tế',
          'resolution',
          [
            ['damage_writeoff', 'Hủy hao hụt hàng hóa / hư hại (Đưa vào chi phí)'],
            ['staff_compensation', 'Bồi hoàn trách nhiệm nhân viên ca trực'],
            ['natural_shrinkage', 'Hao hụt tự nhiên trong định mức cho phép'],
            ['surplus_adjust', 'Điều chỉnh tăng do thừa thực tế (quên quét bán/nhập thiếu)'],
            ['supplier_bonus', 'Hàng tặng kèm / khuyến mãi bổ sung từ NCC'],
          ],
          'damage_writeoff',
          'id="audit-resolution-select"',
        )}
        <div id="audit-staff-group">
          ${field('Nhân viên chịu trách nhiệm bồi hoàn', 'responsibleStaff', '', 'text', 'placeholder="Họ tên nhân viên phụ trách ca"')}
        </div>
      </div>
      <div>
        ${textField('Bước 3: Lý do chi tiết & Số biên bản kiểm kê', 'reason', 'Kiểm kê định kỳ cửa hàng')}
      </div>
      <div class="form-grid">
        ${selectField(
          'Quy trình phê duyệt phiếu kiểm kê',
          'status',
          [
            ['resolved', 'Phê duyệt & Cân bằng kho ngay (Resolved)'],
            ['pending_resolution', 'Lưu phiếu chờ quản trị viên duyệt (Pending Resolution)'],
          ],
          'resolved',
          'id="audit-status-select"',
        )}
      </div>
      ${formError()}
      <div class="note">Hệ thống sẽ cập nhật tồn kho về số lượng thực đếm, phân bổ chi phí hao hụt vào Báo cáo Lãi lỗ (P&L) và lưu vết kiểm toán.</div>
    </div>${foot('Xác nhận & Giải quyết kiểm kê', 'teal')}</form>`,
  );

  const prodSelect = $('#audit-product-select');
  const countInput = $('#audit-counted-input');
  const diffQtyEl = $('#audit-diff-qty');
  const diffValEl = $('#audit-diff-value');
  const resSelect = $('#audit-resolution-select');

  function updateAuditDiff() {
    if (!prodSelect || !countInput) return;
    const prod = store.data.products.find((p) => p.id === prodSelect.value);
    if (!prod) return;
    const counted = Number(countInput.value) || 0;
    const delta = counted - prod.stock;
    const cost = prod.costPrice !== undefined ? prod.costPrice : (prod.cost || 0);
    const diffVal = Math.abs(delta) * cost;

    if (diffQtyEl) {
      diffQtyEl.textContent = `${delta > 0 ? '+' : ''}${delta}`;
      diffQtyEl.className = delta > 0 ? 'positive' : delta < 0 ? 'negative' : '';
    }
    if (diffValEl) {
      diffValEl.textContent = money(diffVal);
      diffValEl.className = `money ${delta > 0 ? 'positive' : delta < 0 ? 'negative' : ''}`;
    }
  }

  prodSelect?.addEventListener('change', () => {
    const prod = store.data.products.find((p) => p.id === prodSelect.value);
    if (prod && countInput) {
      countInput.value = prod.stock;
      updateAuditDiff();
    }
  });
  countInput?.addEventListener('input', updateAuditDiff);
  updateAuditDiff();
}
