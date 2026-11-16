function inventoryView() {
  const s = store.data;
  const low = s.products.filter((p) => p.active && p.stock <= p.minStock);
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
        'Ngưỡng tối thiểu',
        'Giá vốn',
        'Giá trị tồn',
        'Trạng thái',
      ],
      p.items.map(
        (p) =>
          `<tr><td class="name">${e(p.icon)} ${e(p.name)}</td><td>${e(p.id)}</td><td class="${p.stock <= p.minStock ? 'negative' : 'name'}">${p.stock}</td><td>${p.minStock}</td><td>${money(p.cost)}</td><td class="money">${money(p.stock * p.cost)}</td><td>${p.stock <= p.minStock ? badge('Cần nhập thêm', 'yellow') : badge('Đủ hàng')}</td></tr>`,
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
          productName: i.name,
          before: i.previous,
          counted: i.actual,
          delta: i.delta,
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
          'Tồn trước',
          'Thực tế',
          'Chênh lệch',
          'Lý do',
          'Nhân viên',
        ],
        p.items.map(
          (a) =>
            `<tr><td>${e(a.id)}</td><td>${date(a.time)}</td><td class="name">${e(a.productName)}</td><td>${a.before}</td><td>${a.counted}</td><td class="${a.delta >= 0 ? 'positive' : 'negative'}">${a.delta > 0 ? '+' : ''}${a.delta}</td><td>${e(a.reason)}</td><td>${e(a.actor)}</td></tr>`,
        ),
      ) + p.foot;
  }
  return (
    heading(
      'KHO HÀNG / KIỂM KÊ',
      'Kho & kiểm kê',
      'Theo dõi tồn kho thực tế và mọi biến động hàng hóa.',
      action('audit-new', 'Tạo phiếu kiểm kê', 'plus', 'primary'),
    ) +
    stats([
      [
        'Tổng số lượng tồn',
        number(s.products.reduce((a, p) => a + p.stock, 0)),
        'Sản phẩm trong kho',
        'warehouse',
      ],
      [
        'Giá trị tồn kho',
        money(s.products.reduce((a, p) => a + p.stock * p.cost, 0)),
        'Theo giá vốn hiện tại',
        'receipt',
      ],
      ['Sắp hết hàng', number(low.length), 'Bằng hoặc dưới ngưỡng', 'bell'],
      ['Phiếu kiểm kê', number(s.audits.length), 'Điều chỉnh có ghi nhận lý do', 'shield'],
    ]) +
    `<div class="tabs">${tabs.map(([key, label]) => `<button class="${inventoryTab === key ? 'active' : ''}" data-action="inventory-tab" data-tab="${key}">${label}</button>`).join('')}</div><section class="panel"><div class="panel-head"><h2>${tabs.find((t) => t[0] === inventoryTab)[1]}</h2></div>${content}</section>`
  );
}

function auditModal() {
  store.require('inventory');
  modalContext = { type: 'audit' };
  showModal(
    'Kiểm kê tồn kho',
    `<form id="audit-form"><div class="modal-content form-grid">${selectField(
      'Sản phẩm cần kiểm kê',
      'productId',
      store.data.products.map((p) => [p.id, `${p.name} (tồn ${p.stock})`]),
      store.data.products[0]?.id,
      'required',
      true,
    )}${field('Số lượng thực đếm', 'counted', 0, 'number', 'required min="0" step="1"', true)}${textField('Lý do điều chỉnh / biên bản', 'reason')}${formError()}<div class="note full">Xác nhận kiểm kê sẽ cập nhật tồn kho về số lượng thực đếm và lưu lại lịch sử điều chỉnh.</div></div>${foot('Xác nhận kiểm kê')}</form>`,
  );
}
