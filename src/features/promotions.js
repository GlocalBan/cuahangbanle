/* M4 + Phase 2: Quản lý Chương trình Khuyến mãi (có KM cận date) & Quản lý Voucher (CRUD + Phát hành hàng loạt). */
'use strict';

const PROMO_SCOPE_LABELS = {
  INVOICE: 'Toàn hóa đơn',
  CATEGORY: 'Theo danh mục',
  PRODUCT: 'Theo sản phẩm',
  NEAR_EXPIRY: 'Xả hàng cận date',
};

function promotionsView() {
  if (!apiState.promotionsLoaded && !apiState.loading.promotions) {
    loadPromotionsData();
  }
  if (!apiState.categoriesLoaded && !apiState.loading.catalogMeta) {
    loadCatalogMeta();
  }
  if (promotionsTab === 'vouchers' && !apiState.vouchersLoaded && !apiState.loading.vouchers) {
    loadVouchersData();
  }

  const canVoucher = store.hasPermission('VOUCHER_MANAGE');
  const tabs = [
    ['promotions', 'Chương trình khuyến mãi'],
    ...(canVoucher ? [['vouchers', 'Quản lý Voucher']] : []),
  ];
  if (!tabs.some(([k]) => k === promotionsTab)) promotionsTab = 'promotions';

  if (promotionsTab === 'vouchers') {
    const vs = apiState.vouchersSummary || {};
    const list = apiState.vouchers || [];
    const p = paginate(list, 'vouchers');

    return (
      heading(
        'KHUYẾN MÃI & ĐỐI TÁC / VOUCHER',
        'Quản lý Khuyến mãi & Voucher',
        'Phát hành mã Voucher đơn lẻ hoặc hàng loạt (không cộng dồn với Chương trình KM trên cùng hóa đơn POS).',
        action('voucher-bulk', 'Phát hành hàng loạt', 'layers', 'teal') +
          action('voucher-new', 'Tạo Voucher', 'plus', 'primary'),
      ) +
      stats([
        ['Tổng mã Voucher', number(vs.total || 0), 'Lưu trữ trong bảng vouchers', 'tag'],
        ['Đang hiệu lực', number(vs.activeCount || 0), 'Khả dụng tại màn hình POS', 'check'],
        ['Tạm dừng / Kết thúc', number((vs.pausedCount || 0) + (vs.endedCount || 0)), 'Ngừng áp dụng mới', 'lock'],
        ['Tổng lượt quy đổi', number(vs.totalRedemptions || 0), 'Ghi nhận trong voucher_redemptions', 'receipt'],
      ]) +
      `<div class="tabs">${tabs
        .map(
          ([k, label]) =>
            `<button type="button" class="${promotionsTab === k ? 'active' : ''}" data-action="promotions-tab" data-tab="${k}">${label}</button>`,
        )
        .join('')}</div>
      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>Danh sách mã Voucher (${number(list.length)})</h2>
            <p class="sub">Mỗi hóa đơn POS chỉ chọn 1 hình thức giảm hóa đơn: Voucher HOẶC Chương trình KM.</p>
          </div>
        </div>
        <div class="table-tools">
          ${filterInput('vouchers', 'Tìm theo mã Voucher, tên hoặc đợt phát hành…')}
          ${filterSelect('voucherStatus', [
            ['', 'Tất cả trạng thái'],
            ['DangDienRa', 'Đang diễn ra'],
            ['SapDienRa', 'Sắp diễn ra'],
            ['TamDung', 'Tạm dừng'],
            ['KetThuc', 'Đã kết thúc'],
          ])}
          ${action('vouchers-reset', 'Đặt lại', 'return', 'small')}
        </div>
        ${
          apiState.loading.vouchers && !apiState.vouchersLoaded
            ? '<div class="panel-body"><div class="note">Đang tải danh sách Voucher từ CSDL…</div></div>'
            : table(
                ['Mã Voucher', 'Tên / Đợt phát hành', 'Mức giảm', 'Đơn tối thiểu', 'Hiệu lực', 'Lượt dùng', 'Trạng thái', 'Thao tác'],
                p.items.map((vc) => {
                  const discText =
                    vc.discountType === 'PERCENT'
                      ? `-${vc.discountValue}%${vc.maxDiscount > 0 ? ` (max ${money(vc.maxDiscount)})` : ''}`
                      : `-${money(vc.discountValue)}`;
                  const nextStatus = vc.status === 'DangDienRa' ? 'TamDung' : 'DangDienRa';
                  const toggleLabel = vc.status === 'DangDienRa' ? 'Tạm dừng' : 'Kích hoạt';
                  return `<tr>
                    <td class="name"><code>${e(vc.code)}</code><div class="sub">${e(vc.id)}</div></td>
                    <td class="name wrap-cell">${e(vc.name)}${vc.batchCode ? `<div class="sub">Đợt: <code>${e(vc.batchCode)}</code></div>` : ''}</td>
                    <td class="positive"><strong>${discText}</strong></td>
                    <td class="money">${money(vc.minOrderAmount)}</td>
                    <td>${dateOnly(vc.startDate)} – ${dateOnly(vc.endDate)}</td>
                    <td><strong>${number(vc.usedCount)}</strong> / ${number(vc.usageLimit)}</td>
                    <td>${status(vc.status)}</td>
                    <td>
                      <div class="action-group">
                        ${action('voucher-edit', 'Sửa', 'edit', 'xs', `data-id="${e(vc.id)}"`)}
                        ${
                          vc.status !== 'KetThuc'
                            ? action(
                                'voucher-toggle-status',
                                toggleLabel,
                                vc.status === 'DangDienRa' ? 'lock' : 'unlock',
                                vc.status === 'DangDienRa' ? 'xs warning' : 'xs teal',
                                `data-id="${e(vc.id)}" data-code="${e(vc.code)}" data-next-status="${nextStatus}"`,
                              )
                            : ''
                        }
                        ${
                          vc.status !== 'KetThuc'
                            ? action(
                                'voucher-toggle-status',
                                'Kết thúc',
                                'close',
                                'xs danger',
                                `data-id="${e(vc.id)}" data-code="${e(vc.code)}" data-next-status="KetThuc"`,
                              )
                            : ''
                        }
                      </div>
                    </td>
                  </tr>`;
                }),
              ) + p.foot
        }
      </section>`
    );
  }

  const summary = apiState.promotionsSummary || {};
  const list = apiState.promotions || [];
  const p = paginate(list, 'promotions');

  return (
    heading(
      'KHUYẾN MÃI & ĐỐI TÁC / KHUYẾN MÃI',
      'Quản lý Khuyến mãi & Voucher',
      'Thiết lập chương trình khuyến mãi toàn hóa đơn, theo danh mục hoặc xả hàng cận date (gợi ý tự động từ lô product_batches).',
      action('promo-new', 'Thêm khuyến mãi', 'plus', 'primary'),
    ) +
    stats([
      ['Tổng chương trình', number(summary.total || 0), 'Đồng bộ từ bảng promotions', 'tag'],
      ['Đang diễn ra', number(summary.activeCount || 0), 'Sẵn sàng áp dụng tại POS', 'check'],
      ['Sắp diễn ra', number(summary.upcomingCount || 0), 'Chưa tới thời gian hiệu lực', 'clock'],
      ['Tạm dừng / Kết thúc', number((summary.pausedCount || 0) + (summary.endedCount || 0)), 'Ngừng áp dụng mới (Soft-Delete)', 'lock'],
    ]) +
    `<div class="tabs">${tabs
      .map(
        ([k, label]) =>
          `<button type="button" class="${promotionsTab === k ? 'active' : ''}" data-action="promotions-tab" data-tab="${k}">${label}</button>`,
      )
      .join('')}</div>
    <section class="panel">
      <div class="panel-head">
        <div>
          <h2>Danh sách chương trình khuyến mãi</h2>
          <p class="sub">Chỉ vai trò Admin và Quản lý cửa hàng được tạo, chỉnh sửa hoặc thay đổi trạng thái khuyến mãi.</p>
        </div>
      </div>
      <div class="table-tools">
        ${filterInput('promotions', 'Tìm theo mã khuyến mãi, tên chương trình…')}
        ${filterSelect('promoStatus', [
          ['', 'Tất cả trạng thái'],
          ['DangDienRa', 'Đang diễn ra'],
          ['SapDienRa', 'Sắp diễn ra'],
          ['TamDung', 'Tạm dừng'],
          ['KetThuc', 'Đã kết thúc'],
        ])}
        ${action('promotions-reset', 'Đặt lại', 'return', 'small')}
      </div>
      ${
        apiState.loading.promotions && !apiState.promotionsLoaded
          ? '<div class="panel-body"><div class="note">Đang tải danh sách khuyến mãi từ CSDL…</div></div>'
          : table(
              ['Mã KM', 'Tên chương trình', 'Phạm vi', 'Mức giảm', 'Đơn tối thiểu', 'Hiệu lực', 'Lượt dùng', 'Trạng thái', 'Thao tác'],
              p.items.map((pr) => {
                const discText =
                  pr.discountType === 'PERCENT'
                    ? `-${pr.discountValue}%${pr.maxDiscount > 0 ? ` (tối đa ${money(pr.maxDiscount)})` : ''}`
                    : `-${money(pr.discountValue)}`;
                const nextStatus = pr.status === 'DangDienRa' ? 'TamDung' : 'DangDienRa';
                const toggleLabel = pr.status === 'DangDienRa' ? 'Tạm dừng' : 'Kích hoạt';
                const scopeBadge =
                  pr.scope === 'NEAR_EXPIRY'
                    ? badge(`Cận date (≤${pr.nearExpiryDays || 14} ngày)`, 'yellow')
                    : badge(PROMO_SCOPE_LABELS[pr.scope || 'INVOICE'] || pr.scope, 'blue');
                return `<tr>
                  <td class="name"><code>${e(pr.code)}</code><div class="sub">${e(pr.id)}</div></td>
                  <td class="name wrap-cell">${e(pr.name)}</td>
                  <td>${scopeBadge}</td>
                  <td class="positive"><strong>${discText}</strong></td>
                  <td class="money">${money(pr.minOrderAmount)}</td>
                  <td>${dateOnly(pr.startDate)} – ${dateOnly(pr.endDate)}</td>
                  <td><strong>${number(pr.usedCount)}</strong> / ${number(pr.usageLimit)}</td>
                  <td>${status(pr.status)}</td>
                  <td>
                    <div class="action-group">
                      ${action('promo-edit', 'Sửa', 'edit', 'xs', `data-id="${e(pr.id)}"`)}
                      ${
                        pr.status !== 'KetThuc'
                          ? action(
                              'promo-toggle-status',
                              toggleLabel,
                              pr.status === 'DangDienRa' ? 'lock' : 'unlock',
                              pr.status === 'DangDienRa' ? 'xs warning' : 'xs teal',
                              `data-id="${e(pr.id)}" data-code="${e(pr.code)}" data-next-status="${nextStatus}"`,
                            )
                          : ''
                      }
                      ${
                        pr.status !== 'KetThuc'
                          ? action(
                              'promo-toggle-status',
                              'Kết thúc',
                              'close',
                              'xs danger',
                              `data-id="${e(pr.id)}" data-code="${e(pr.code)}" data-next-status="KetThuc"`,
                            )
                          : ''
                      }
                    </div>
                  </td>
                </tr>`;
              }),
            ) + p.foot
      }
    </section>
    <div class="note mt16">
      <strong>Quy tắc BR-04:</strong> Mã khuyến mãi chỉ hợp lệ khi <em>Đang diễn ra</em>, trong khung thời gian hiệu lực, còn lượt dùng và thỏa <code>GiaTriDonToiThieu</code>. Chương trình <strong>Xả hàng cận date</strong> chỉ giảm trên các đơn vị thuộc lô sắp hết hạn.
    </div>`
  );
}

function promotionModal(promoId = '') {
  if (!store.hasPermission('PROMOTION_MANAGE')) {
    notify('Bạn không có quyền quản lý chương trình khuyến mãi (PROMOTION_MANAGE).', true);
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  const nextMonth = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const v = (promoId && (apiState.promotions || []).find((x) => x.id === promoId)) || {
    code: '',
    name: '',
    scope: 'INVOICE',
    categoryCode: '',
    nearExpiryDays: 14,
    productIds: [],
    discountType: 'PERCENT',
    discountValue: 10,
    maxDiscount: 50000,
    minOrderAmount: 100000,
    startDate: today,
    endDate: nextMonth,
    usageLimit: 200,
    status: 'DangDienRa',
  };

  const catOptions = [['', '— Chọn danh mục (nếu phạm vi Danh mục) —'], ...(apiState.categories || []).map((c) => [c.code, `${c.name} (${c.code})`])];
  modalContext = { type: 'promotion-api', id: promoId, selectedProductIds: [...(v.productIds || [])] };
  showModal(
    promoId ? `Sửa khuyến mãi · ${e(v.code)}` : 'Thêm chương trình khuyến mãi mới',
    `<form id="promotion-api-form">
      <div class="modal-content form-grid">
        ${field('Mã khuyến mãi (*) (VD: GIAM10)', 'code', v.code, 'text', 'required minlength="3" maxlength="30" style="text-transform:uppercase"')}
        ${selectField(
          'Trạng thái (*)',
          'status',
          [
            ['DangDienRa', 'Đang diễn ra'],
            ['SapDienRa', 'Sắp diễn ra'],
            ['TamDung', 'Tạm dừng'],
            ['KetThuc', 'Đã kết thúc'],
          ],
          v.status,
          'required',
        )}
        ${field('Tên chương trình khuyến mãi (*)', 'name', v.name, 'text', 'required minlength="3" maxlength="160"', true)}
        ${selectField(
          'Phạm vi áp dụng (*)',
          'scope',
          [
            ['INVOICE', 'Toàn hóa đơn'],
            ['NEAR_EXPIRY', 'Xả hàng cận date (lô sắp hết hạn)'],
            ['CATEGORY', 'Theo danh mục hàng'],
            ['PRODUCT', 'Theo danh sách sản phẩm'],
          ],
          v.scope || 'INVOICE',
          'id="promo-scope-select" required',
        )}
        ${field('Ngưỡng ngày cận date (dùng cho KM cận date)', 'nearExpiryDays', v.nearExpiryDays || 14, 'number', 'id="promo-near-days" min="1" max="180" step="1"')}
        ${selectField('Danh mục áp dụng (nếu chọn Theo danh mục)', 'categoryCode', catOptions, v.categoryCode || '', '', true)}
        ${selectField(
          'Loại giảm giá (*)',
          'discountType',
          [
            ['PERCENT', 'Giảm theo phần trăm (%)'],
            ['FIXED', 'Giảm số tiền cố định (₫)'],
          ],
          v.discountType,
          'id="promo-discount-type" required',
        )}
        ${field('Giá trị giảm (*) (% hoặc ₫)', 'discountValue', v.discountValue, 'number', 'required min="0" step="1"')}
        ${field('Trần giảm tối đa (₫) (0 = không giới hạn)', 'maxDiscount', v.maxDiscount, 'number', 'min="0" step="1"')}
        ${field('Giá trị đơn tối thiểu (₫) (*)', 'minOrderAmount', v.minOrderAmount, 'number', 'required min="0" step="1"')}
        ${field('Ngày bắt đầu (*)', 'startDate', v.startDate, 'date', 'required')}
        ${field('Ngày kết thúc (*)', 'endDate', v.endDate, 'date', 'required')}
        ${field('Giới hạn tổng lượt dùng (*)', 'usageLimit', v.usageLimit, 'number', 'required min="1" step="1"', true)}
        <div class="full">
          <div class="between mb8">
            <span class="sub"><strong>Gợi ý sản phẩm cận date từ product_batches:</strong></span>
            ${action('promo-load-near-expiry', 'Tải gợi ý SP cận date', 'clock', 'small teal')}
          </div>
          <div id="promo-near-expiry-box">
            ${
              (v.productIds || []).length
                ? `<div class="note">Đang gắn ${v.productIds.length} mã sản phẩm: <code>${e(v.productIds.join(', '))}</code></div>`
                : '<div class="sub">Bấm "Tải gợi ý SP cận date" để chọn nhanh các lô sắp hết hạn cần giảm giá xả hàng.</div>'
            }
          </div>
        </div>
        ${formError()}
      </div>
      <div class="modal-footer">
        ${action('close-modal', 'Hủy')}
        <button class="btn primary" type="submit">${icon('check')}Lưu chương trình</button>
      </div>
    </form>`,
    true,
  );
}

async function loadNearExpiryPromoSuggestionsIntoModal() {
  const box = $('#promo-near-expiry-box');
  if (!box) return;
  const days = Number($('#promo-near-days')?.value || 14);
  box.innerHTML = '<div class="note">Đang quét các lô hàng cận date từ CSDL…</div>';
  try {
    const res = await api.getNearExpiryPromoSuggestions(days);
    const items = res.items || [];
    apiState.nearExpirySuggestions = items;
    if (!items.length) {
      box.innerHTML = `<div class="note">Không có sản phẩm nào có lô cận date trong vòng ${days} ngày tới.</div>`;
      return;
    }
    const selectedSet = new Set(modalContext.selectedProductIds || []);
    box.innerHTML = `<div class="note yellow mb8">Tìm thấy <strong>${items.length}</strong> sản phẩm có lô cận date (≤${days} ngày). Tích chọn để gắn vào chương trình:</div>
      <div style="max-height:190px;overflow:auto;border:1px solid #e2e8f0;border-radius:8px;padding:8px;display:flex;flex-direction:column;gap:6px">
        ${items
          .map(
            (s) => `<label class="check-label" style="justify-content:space-between;padding:4px 6px;border-bottom:1px solid #f1f5f9">
              <span class="row gap8">
                <input type="checkbox" name="promoProductId" value="${e(s.productId)}" ${selectedSet.has(s.productId) || !selectedSet.size ? 'checked' : ''}>
                <strong>${e(s.productName)}</strong> <code>${e(s.sku)}</code>
              </span>
              <span class="sub">Tồn cận date: <strong>${number(s.nearExpiryQty)}</strong> · HSD sớm nhất: ${dateOnly(s.earliestExpiry)} · Gợi ý giảm ${s.suggestedDiscountPct || 25}%</span>
            </label>`,
          )
          .join('')}
      </div>`;
  } catch (err) {
    box.innerHTML = `<div class="note red">${e(err.message)}</div>`;
  }
}

function voucherModal(voucherId = '') {
  if (!store.hasPermission('VOUCHER_MANAGE')) {
    notify('Bạn không có quyền quản lý Voucher (VOUCHER_MANAGE).', true);
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  const nextMonth = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const v = (voucherId && (apiState.vouchers || []).find((x) => x.id === voucherId)) || {
    code: '',
    name: '',
    discountType: 'FIXED',
    discountValue: 20000,
    maxDiscount: 0,
    minOrderAmount: 100000,
    startDate: today,
    endDate: nextMonth,
    usageLimit: 50,
    perCustomerLimit: 1,
    status: 'DangDienRa',
  };
  modalContext = { type: 'voucher-api', id: voucherId };
  showModal(
    voucherId ? `Sửa Voucher · ${e(v.code)}` : 'Tạo mã Voucher mới',
    `<form id="voucher-api-form">
      <div class="modal-content form-grid">
        ${field('Mã Voucher (*) (VD: VC-CHAO20)', 'code', v.code, 'text', 'required minlength="3" maxlength="40" style="text-transform:uppercase"')}
        ${selectField(
          'Trạng thái (*)',
          'status',
          [
            ['DangDienRa', 'Đang diễn ra'],
            ['SapDienRa', 'Sắp diễn ra'],
            ['TamDung', 'Tạm dừng'],
            ['KetThuc', 'Đã kết thúc'],
          ],
          v.status,
          'required',
        )}
        ${field('Tên Voucher (*)', 'name', v.name, 'text', 'required minlength="3" maxlength="160"', true)}
        ${selectField(
          'Loại giảm giá (*)',
          'discountType',
          [
            ['FIXED', 'Giảm số tiền cố định (₫)'],
            ['PERCENT', 'Giảm theo phần trăm (%)'],
          ],
          v.discountType,
          'required',
        )}
        ${field('Giá trị giảm (*)', 'discountValue', v.discountValue, 'number', 'required min="1" step="1"')}
        ${field('Trần giảm tối đa (₫) (dùng cho %)', 'maxDiscount', v.maxDiscount || 0, 'number', 'min="0" step="1"')}
        ${field('Đơn hàng tối thiểu (₫) (*)', 'minOrderAmount', v.minOrderAmount || 0, 'number', 'required min="0" step="1"')}
        ${field('Ngày bắt đầu (*)', 'startDate', v.startDate, 'date', 'required')}
        ${field('Ngày kết thúc (*)', 'endDate', v.endDate, 'date', 'required')}
        ${field('Tổng lượt dùng (*)', 'usageLimit', v.usageLimit || 1, 'number', 'required min="1" step="1"')}
        ${field('Giới hạn / khách hàng (*)', 'perCustomerLimit', v.perCustomerLimit || 1, 'number', 'required min="1" step="1"')}
        ${formError()}
      </div>
      <div class="modal-footer">
        ${action('close-modal', 'Hủy')}
        <button class="btn primary" type="submit">${icon('check')}Lưu Voucher</button>
      </div>
    </form>`,
    true,
  );
}

function voucherBulkModal() {
  if (!store.hasPermission('VOUCHER_MANAGE')) {
    notify('Bạn không có quyền phát hành Voucher (VOUCHER_MANAGE).', true);
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  const nextMonth = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  modalContext = { type: 'voucher-bulk' };
  showModal(
    'Phát hành hàng loạt mã Voucher',
    `<form id="voucher-bulk-form">
      <div class="modal-content form-grid">
        ${field('Tiền tố mã (*) (VD: TET26)', 'prefix', 'RF26', 'text', 'required minlength="2" maxlength="12" style="text-transform:uppercase"')}
        ${field('Số lượng mã cần phát hành (*) (1–200)', 'quantity', 10, 'number', 'required min="1" max="200" step="1"')}
        ${field('Tên đợt phát hành (*)', 'name', 'Voucher tri ân khách hàng', 'text', 'required minlength="3" maxlength="160"', true)}
        ${selectField(
          'Loại giảm giá (*)',
          'discountType',
          [
            ['FIXED', 'Giảm số tiền cố định (₫)'],
            ['PERCENT', 'Giảm theo phần trăm (%)'],
          ],
          'FIXED',
          'required',
        )}
        ${field('Giá trị giảm (*)', 'discountValue', 15000, 'number', 'required min="1" step="1"')}
        ${field('Trần giảm tối đa (₫)', 'maxDiscount', 0, 'number', 'min="0" step="1"')}
        ${field('Đơn tối thiểu (₫) (*)', 'minOrderAmount', 100000, 'number', 'required min="0" step="1"')}
        ${field('Ngày bắt đầu (*)', 'startDate', today, 'date', 'required')}
        ${field('Ngày kết thúc (*)', 'endDate', nextMonth, 'date', 'required')}
        ${field('Lượt dùng / mỗi mã (*)', 'usageLimit', 1, 'number', 'required min="1" step="1"')}
        ${field('Giới hạn / khách hàng (*)', 'perCustomerLimit', 1, 'number', 'required min="1" step="1"')}
        ${formError()}
      </div>
      <div class="modal-footer">
        ${action('close-modal', 'Hủy')}
        <button class="btn teal" type="submit">${icon('layers')}Phát hành ngay</button>
      </div>
    </form>`,
    true,
  );
}
