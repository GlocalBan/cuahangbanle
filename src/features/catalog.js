/* M2: Nhà cung cấp (SQLite Backend + RBAC) & Khách hàng. */
'use strict';

function suppliersApiView() {
  if (!apiState.suppliersLoaded && !apiState.loading.suppliers) {
    loadSuppliersData();
  }
  const canManage = store.hasPermission('SUPPLIER_MANAGE');
  const entries = apiState.suppliers || [];
  const list = entries.filter(
    (x) =>
      match(`${x.id} ${x.name} ${x.phone || ''} ${x.categoryGroup || ''} ${x.areas || ''}`, filters.suppliers || '') &&
      (!filters.supplierStatus || x.status === filters.supplierStatus),
  );
  const p = paginate(list, 'suppliers');
  const areasCount = new Set(
    entries
      .flatMap((s) => String(s.areas || '').split(',').map((x) => x.trim()))
      .filter(Boolean),
  ).size;

  const metrics = [
    ['Tổng nhà cung cấp', number(entries.length), 'Đồng bộ trực tiếp từ CSDL SQLite', 'truck'],
    [
      'Đang hợp tác',
      number(entries.filter((x) => x.active).length),
      'Có thể gắn vào sản phẩm & phiếu nhập',
      'check',
    ],
    [
      'Ngừng hợp tác',
      number(entries.filter((x) => !x.active).length),
      'Soft-Delete bảo toàn chứng từ',
      'lock',
    ],
    ['Vùng cung ứng', number(areasCount), 'Khu vực đối tác phục vụ', 'branch'],
  ];

  const rows = p.items.map((x) => {
    const actionsHtml = [
      action('supplier-api-history', 'Lịch sử', 'receipt', 'small', `data-id="${e(x.id)}" aria-label="Lịch sử nhập ${e(x.name)}"`),
      canManage
        ? action('supplier-edit', 'Sửa', 'edit', 'small', `data-id="${e(x.id)}" aria-label="Sửa ${e(x.name)}"`)
        : '',
      canManage
        ? action(
            'supplier-toggle-status',
            x.active ? 'Ngừng hợp tác' : 'Khôi phục',
            x.active ? 'lock' : 'unlock',
            x.active ? 'small danger' : 'small teal',
            `data-id="${e(x.id)}" data-next-status="${x.active ? 'NgungHopTac' : 'HoatDong'}" aria-label="${x.active ? 'Ngừng hợp tác' : 'Khôi phục'} ${e(x.name)}"`,
          )
        : '',
    ]
      .filter(Boolean)
      .join('');

    return `<tr>
      <td><code>${e(x.id)}</code></td>
      <td class="name">
        <div>${e(x.name)}</div>
        <div class="sub">${number(x.productCount)} SP · ${number(x.purchaseCount)} phiếu nhập</div>
      </td>
      <td>${e(x.categoryGroup || '—')}</td>
      <td>${e(x.phone || '—')}</td>
      <td>${e(x.areas || '—')}</td>
      <td>${x.active ? badge('Đang hợp tác', 'green') : badge('Ngừng hợp tác', 'gray')}</td>
      <td><div class="row gap8 wrap">${actionsHtml}</div></td>
    </tr>`;
  });

  return (
    heading(
      'KHUYẾN MÃI & ĐỐI TÁC / NHÀ CUNG CẤP',
      'Nhà cung cấp',
      'Quản lý hồ sơ đối tác cung ứng, vùng phân phối và trạng thái hợp tác (Soft-Delete).',
      canManage ? action('supplier-new', 'Thêm', 'plus', 'primary') : '',
    ) +
    stats(metrics) +
    `<section class="panel">
      <div class="panel-head">
        <h2>Danh sách nhà cung cấp (${number(list.length)})</h2>
        ${!canManage ? badge('Chế độ tra cứu (Chỉ đọc)', 'gray') : ''}
      </div>
      <div class="table-tools">
        ${filterInput('suppliers', 'Tìm mã NCC, tên đối tác, SĐT, nhóm hàng, khu vực…')}
        ${filterSelect('supplierStatus', [
          ['', 'Tất cả trạng thái'],
          ['HoatDong', 'Đang hợp tác'],
          ['NgungHopTac', 'Ngừng hợp tác'],
        ])}
      </div>
      ${
        apiState.loading.suppliers && !apiState.suppliersLoaded
          ? '<div class="panel-body"><div class="note">Đang tải danh sách nhà cung cấp…</div></div>'
          : table(
              ['Mã NCC', 'Tên đối tác', 'Nhóm hàng cung cấp', 'Điện thoại', 'Vùng cung ứng', 'Trạng thái', 'Thao tác'],
              rows,
            ) + p.foot
      }
    </section>`
  );
}

function supplierApiModal(recordId = '') {
  if (!store.hasPermission('SUPPLIER_MANAGE')) {
    notify('Bạn không có quyền quản lý nhà cung cấp (SUPPLIER_MANAGE).', true);
    return;
  }
  const v = (recordId && apiState.suppliers.find((s) => s.id === recordId)) || {
    name: '',
    phone: '',
    categoryGroup: '',
    areas: 'TP. HCM',
    status: 'HoatDong',
  };
  modalContext = { type: 'supplier-api', id: recordId };
  showModal(
    recordId ? `Sửa nhà cung cấp · ${e(v.id)}` : 'Thêm nhà cung cấp mới',
    `<form id="supplier-api-form">
      <div class="modal-content form-grid">
        ${field('Tên nhà cung cấp (*)', 'name', v.name, 'text', 'required minlength="2" maxlength="150"', true)}
        ${field('Số điện thoại (*)', 'phone', v.phone, 'tel', 'required minlength="8" maxlength="24"')}
        ${field('Nhóm hàng cung cấp (*)', 'categoryGroup', v.categoryGroup, 'text', 'required minlength="2" maxlength="120"')}
        ${field('Vùng cung ứng (*) (phân tách bằng dấu phẩy)', 'areas', v.areas, 'text', 'required minlength="2" maxlength="250"', true)}
        ${
          recordId
            ? selectField(
                'Trạng thái hợp tác',
                'status',
                [
                  ['HoatDong', 'Đang hợp tác'],
                  ['NgungHopTac', 'Ngừng hợp tác (Soft-Delete)'],
                ],
                v.status,
                '',
                true,
              )
            : ''
        }
        ${formError()}
      </div>
      <div class="modal-footer">
        ${action('close-modal', 'Hủy')}
        <button class="btn primary" type="submit">${icon('check')}Lưu</button>
      </div>
    </form>`,
  );
}

async function supplierApiHistory(supplierId) {
  if (!store.hasPermission('SUPPLIER_VIEW')) {
    notify('Bạn không có quyền xem lịch sử nhà cung cấp (SUPPLIER_VIEW).', true);
    return;
  }
  try {
    const res = await api.getSupplierHistory(supplierId);
    const sup = res.supplier;
    const purchases = res.purchases || [];
    showModal(
      `Lịch sử hợp tác · ${e(sup.name)}`,
      `<div class="modal-content stack">
        <div class="note">
          <strong>${e(sup.id)}</strong> · SĐT: ${e(sup.phone)} · Vùng: ${e(sup.areas)} ·
          Đang cung cấp <strong>${number(sup.productCount)}</strong> mặt hàng.
        </div>
        ${table(
          ['Mã phiếu nhập', 'Ngày tạo', 'Giá trị', 'Người lập', 'Trạng thái'],
          purchases.map(
            (o) =>
              `<tr><td><code>${e(o.id)}</code></td><td>${date(o.created_at)}</td><td class="money">${money(o.total_amount)}</td><td>${e(o.created_by_name || '—')}</td><td>${status(o.status)}</td></tr>`,
          ),
        )}
      </div>
      <div class="modal-footer">${action('close-modal', 'Đóng')}</div>`,
      true,
    );
  } catch (err) {
    notify(err.message, true);
  }
}

function entitiesView(type) {
  if (type === 'suppliers') {
    return suppliersApiView();
  }
  const s = store.data,
    config = {
      customers: [
        'KHUYẾN MÃI & ĐỐI TÁC / KHÁCH HÀNG',
        'Khách hàng',
        'Lưu hồ sơ khách hàng và tra cứu lịch sử mua sắm.',
        'Thêm',
      ],
      staff: [
        'QUẢN TRỊ / NHÂN VIÊN',
        'Nhân viên & tài khoản',
        'Quản lý hồ sơ, trạng thái và quyền truy cập theo vai trò.',
        'Thêm',
      ],
    }[type];
  const entries = s[type],
    list = entries.filter((x) =>
      match(`${x.name} ${x.id} ${x.phone || ''} ${x.username || ''}`, filters[type] || ''),
    );
  const p = paginate(list, type);
  const metrics =
    type === 'customers'
      ? [
          ['Khách hàng', entries.length, 'Hồ sơ đang lưu', 'users'],
          [
            'Đang hoạt động',
            entries.filter((x) => x.active).length,
            'Có thể gắn vào đơn hàng',
            'check',
          ],
          [
            'Khách quay lại',
            entries.filter((c) => s.orders.filter((o) => o.customerId === c.id).length > 1)
              .length,
            'Đã có trên một đơn hàng',
            'return',
          ],
          [
            'Giá trị đơn trung bình',
            money(
              Math.round(
                s.orders.reduce((a, o) => a + o.total, 0) / Math.max(s.orders.length, 1),
              ),
            ),
            'Trên tất cả hóa đơn đã lưu',
            'receipt',
          ],
        ]
      : [
          ['Tổng nhân viên', entries.length, 'Hồ sơ nhân sự', 'users'],
          [
            'Đang hoạt động',
            entries.filter((x) => x.active).length,
            'Tài khoản được đăng nhập',
            'check',
          ],
          [
            'Quản trị viên',
            entries.filter((x) => x.role === 'ADMIN').length,
            'Quyền quản trị hệ thống',
            'shield',
          ],
          [
            'Tài khoản khóa',
            entries.filter((x) => !x.active).length,
            'Không thể đăng nhập',
            'logout',
          ],
        ];
  let headers, rows;
  if (type === 'customers') {
    headers = ['Mã KH', 'Họ tên', 'Điện thoại', 'Số đơn', 'Tổng mua ròng', 'Trạng thái', ''];
    rows = p.items.map((x) => {
      const orders = s.orders.filter((o) => o.customerId === x.id);
      const refunds = s.returns
        .filter((r) => r.status === 'approved' && orders.some((o) => o.id === r.orderId))
        .reduce((a, r) => a + r.amount, 0);
      return `<tr><td>${e(x.id)}</td><td class="name">${e(x.name)}</td><td>${e(x.phone)}</td><td>${orders.length}</td><td class="money name">${money(orders.reduce((a, o) => a + o.total, 0) - refunds)}</td><td>${x.active ? badge('Hoạt động') : badge('Tạm ngừng', 'gray')}</td><td>${ibEntity(type, x.id)}${ib('customer-history', 'receipt', 'Lịch sử mua hàng', `data-id="${e(x.id)}"`)}</td></tr>`;
    });
  }
  return (
    heading(
      config[0],
      config[1],
      config[2],
      action('entity-new', config[3], 'plus', 'primary', `data-type="${type}"`),
    ) +
    stats(metrics) +
    `<section class="panel"><div class="panel-head"><h2>Danh sách khách hàng</h2></div><div class="table-tools">${filterInput(type, 'Tìm kiếm theo tên, mã hoặc số điện thoại…')}</div>${table(headers, rows)}${p.foot}</section>`
  );
}

function entityModal(type, recordId = '') {
  if (type === 'products') {
    productApiModal(recordId);
    return;
  }
  if (type === 'suppliers') {
    supplierApiModal(recordId);
    return;
  }
  store.require(type === 'staff' ? 'staff' : type);
  const v = store.data[type].find((x) => x.id === recordId) || { active: true };
  modalContext = { type: 'entity', entity: type, id: recordId };
  let fields = field(
    'Tên / Họ tên (*)',
    'name',
    v.name || '',
    'text',
    'required maxlength="150"',
    true,
  );
  if (type === 'customers')
    fields +=
      field('Số điện thoại (*)', 'phone', v.phone || '', 'tel', 'required maxlength="18"') +
      field('Email (không bắt buộc)', 'email', v.email || '', 'email', 'maxlength="150"');
  fields +=
    selectField(
      'Trạng thái',
      'active',
      [
        ['true', 'Đang hoạt động'],
        ['false', 'Tạm ngừng'],
      ],
      String(v.active),
      '',
      true,
    ) + formError();
  showModal(
    `${recordId ? 'Sửa' : 'Thêm'} khách hàng`,
    `<form id="entity-form"><div class="modal-content form-grid">${fields}</div><div class="modal-footer">${action('close-modal', 'Hủy')}<button class="btn primary" type="submit">${icon('check')}Lưu</button></div></form>`,
  );
}

function customerHistory(customerId) {
  const c = store.data.customers.find((c) => c.id === customerId);
  const orders = store.data.orders.filter((o) => o.customerId === customerId);
  showModal(
    `Lịch sử mua hàng · ${e(c.name)}`,
    `<div class="modal-content"><p class="sub mb16">${e(c.phone)} · ${orders.length} đơn hàng</p>${orderTable(orders)}</div><div class="modal-footer">${action('close-modal', 'Đóng')}</div>`,
    true,
  );
}

function supplierHistory(supplierId) {
  supplierApiHistory(supplierId);
}
