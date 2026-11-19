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

function customersApiView() {
  if (!apiState.customersLoaded && !apiState.loading.customers) {
    loadCustomersData();
  }
  const entries = apiState.customers || [];
  const p = paginate(entries, 'customers');
  const activeCount = entries.filter((x) => x.active).length;
  const repeatCount = entries.filter((x) => Number(x.orderCount || 0) > 1).length;
  const totalNet = entries.reduce((s, x) => s + Number(x.netSpent || 0), 0);

  return (
    heading(
      'KHUYẾN MÃI & ĐỐI TÁC / KHÁCH HÀNG',
      'Khách hàng',
      'Quản lý hồ sơ khách hàng thân thiết (SQLite) và tra cứu lịch sử hóa đơn mua sắm.',
      action('customer-new', 'Thêm khách hàng', 'plus', 'primary'),
    ) +
    stats([
      ['Tổng khách hàng', number(entries.length), 'Đồng bộ từ CSDL SQLite', 'users'],
      ['Đang hoạt động', number(activeCount), 'Có thể gắn vào hóa đơn POS', 'check'],
      ['Khách quay lại', number(repeatCount), 'Đã phát sinh từ 2 hóa đơn trở lên', 'return'],
      ['Tổng chi tiêu ròng', money(totalNet), 'Đã trừ tiền hoàn trả xác nhận', 'receipt'],
    ]) +
    `<section class="panel">
      <div class="panel-head"><h2>Danh sách khách hàng (${number(entries.length)})</h2></div>
      <div class="table-tools">
        ${filterInput('customers', 'Tìm mã KH, họ tên, số điện thoại, email…')}
        ${filterSelect('customerStatus', [
          ['', 'Tất cả trạng thái'],
          ['HoatDong', 'Đang hoạt động'],
          ['TamNgung', 'Tạm ngừng'],
        ])}
      </div>
      ${
        apiState.loading.customers && !apiState.customersLoaded
          ? '<div class="panel-body"><div class="note">Đang tải danh sách khách hàng…</div></div>'
          : table(
              ['Mã KH', 'Họ tên', 'Điện thoại', 'Email', 'Số hóa đơn', 'Tổng mua ròng', 'Trạng thái', 'Thao tác'],
              p.items.map(
                (x) => `<tr>
                  <td><code>${e(x.id)}</code></td>
                  <td class="name">${e(x.name)}</td>
                  <td>${e(x.phone)}</td>
                  <td>${e(x.email || '—')}</td>
                  <td>${number(x.orderCount || 0)}</td>
                  <td class="money name">${money(x.netSpent || 0)}</td>
                  <td>${x.active ? badge('Hoạt động', 'green') : badge('Tạm ngừng', 'gray')}</td>
                  <td>
                    <div class="action-group">
                      ${action('customer-edit', 'Sửa', 'edit', 'xs', `data-id="${e(x.id)}"`)}
                      ${action('customer-history', 'Lịch sử', 'receipt', 'xs', `data-id="${e(x.id)}"`)}
                    </div>
                  </td>
                </tr>`,
              ),
            ) + p.foot
      }
    </section>`
  );
}

function customerApiModal(recordId = '') {
  if (!store.hasPermission('CUSTOMER_MANAGE')) {
    notify('Bạn không có quyền quản lý khách hàng (CUSTOMER_MANAGE).', true);
    return;
  }
  const v = (recordId && (apiState.customers || []).find((x) => x.id === recordId)) || {
    name: '',
    phone: '',
    email: '',
    status: 'HoatDong',
  };
  modalContext = { type: 'customer-api', id: recordId };
  showModal(
    recordId ? `Sửa khách hàng · ${e(v.id)}` : 'Thêm khách hàng mới',
    `<form id="customer-api-form">
      <div class="modal-content form-grid">
        ${field('Họ và tên (*)', 'name', v.name, 'text', 'required minlength="2" maxlength="150"', true)}
        ${field('Số điện thoại (*)', 'phone', v.phone, 'tel', 'required minlength="8" maxlength="20"')}
        ${field('Email (không bắt buộc)', 'email', v.email || '', 'email', 'maxlength="150"')}
        ${
          recordId
            ? selectField(
                'Trạng thái',
                'status',
                [
                  ['HoatDong', 'Đang hoạt động'],
                  ['TamNgung', 'Tạm ngừng'],
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

function entitiesView(type) {
  if (type === 'suppliers') {
    return suppliersApiView();
  }
  if (type === 'customers') {
    return customersApiView();
  }
  return '';
}

async function customerHistory(customerId) {
  if (!store.hasPermission('CUSTOMER_MANAGE')) {
    notify('Bạn không có quyền xem lịch sử khách hàng.', true);
    return;
  }
  try {
    const res = await api.getCustomerHistory(customerId);
    const c = res.customer;
    const orders = res.orders || [];
    showModal(
      `Lịch sử mua hàng · ${e(c.name)}`,
      `<div class="modal-content">
        <div class="note mb16">
          <strong>${e(c.id)}</strong> · SĐT: ${e(c.phone)} · ${number(orders.length)} hóa đơn · Tổng mua ròng: <strong class="money">${money(c.netSpent)}</strong>
        </div>
        ${orderTable(orders)}
      </div>
      <div class="modal-footer">${action('close-modal', 'Đóng')}</div>`,
      true,
    );
  } catch (err) {
    notify(err.message, true);
  }
}

