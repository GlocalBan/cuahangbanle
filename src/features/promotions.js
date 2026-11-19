/* M4: Quản lý Chương trình Khuyến mãi (BR-04) — 100% kết nối SQLite API + RBAC. */
'use strict';

function promotionsView() {
  if (!apiState.promotionsLoaded && !apiState.loading.promotions) {
    loadPromotionsData();
  }
  const summary = apiState.promotionsSummary || {};
  const list = apiState.promotions || [];
  const p = paginate(list, 'promotions');

  return (
    heading(
      'KHUYẾN MÃI & ĐỐI TÁC / KHUYẾN MÃI',
      'Quản lý khuyến mãi',
      'Thiết lập mã giảm theo % (có trần tối đa) hoặc giảm số tiền cố định, giới hạn lượt dùng và điều kiện giá trị đơn tối thiểu (BR-04).',
      action('promo-new', 'Thêm khuyến mãi', 'plus', 'primary'),
    ) +
    stats([
      ['Tổng chương trình', number(summary.total || 0), 'Đồng bộ từ bảng promotions', 'tag'],
      ['Đang diễn ra', number(summary.activeCount || 0), 'Sẵn sàng áp dụng tại POS', 'check'],
      ['Sắp diễn ra', number(summary.upcomingCount || 0), 'Chưa tới thời gian hiệu lực', 'clock'],
      ['Tạm dừng / Kết thúc', number((summary.pausedCount || 0) + (summary.endedCount || 0)), 'Ngừng áp dụng mới (Soft-Delete)', 'lock'],
    ]) +
    `<section class="panel">
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
              ['Mã KM', 'Tên chương trình', 'Mức giảm', 'Đơn tối thiểu', 'Hiệu lực', 'Lượt dùng', 'Trạng thái', 'Thao tác'],
              p.items.map((pr) => {
                const discText =
                  pr.discountType === 'PERCENT'
                    ? `-${pr.discountValue}%${pr.maxDiscount > 0 ? ` (tối đa ${money(pr.maxDiscount)})` : ''}`
                    : `-${money(pr.discountValue)}`;
                const nextStatus = pr.status === 'DangDienRa' ? 'TamDung' : 'DangDienRa';
                const toggleLabel = pr.status === 'DangDienRa' ? 'Tạm dừng' : 'Kích hoạt';
                return `<tr>
                  <td class="name"><code>${e(pr.code)}</code><div class="sub">${e(pr.id)}</div></td>
                  <td class="name wrap-cell">${e(pr.name)}</td>
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
      <strong>Quy tắc BR-04:</strong> Mã khuyến mãi chỉ hợp lệ khi <em>Đang diễn ra</em>, trong khung thời gian hiệu lực, còn lượt dùng (<code>SoLuotDaDung &lt; GioiHanLuotDung</code>) và thỏa <code>GiaTriDonToiThieu</code>. Hệ thống cấm xóa cứng khuyến mãi để bảo toàn lịch sử hóa đơn.
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
    discountType: 'PERCENT',
    discountValue: 10,
    maxDiscount: 50000,
    minOrderAmount: 100000,
    startDate: today,
    endDate: nextMonth,
    usageLimit: 200,
    status: 'DangDienRa',
  };

  modalContext = { type: 'promotion-api', id: promoId };
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
        ${field('Trần giảm tối đa (₫) (0 = không giới hạn, dùng cho %)', 'maxDiscount', v.maxDiscount, 'number', 'min="0" step="1000"')}
        ${field('Giá trị đơn tối thiểu (₫) (*)', 'minOrderAmount', v.minOrderAmount, 'number', 'required min="0" step="1000"')}
        ${field('Ngày bắt đầu (*)', 'startDate', v.startDate, 'date', 'required')}
        ${field('Ngày kết thúc (*)', 'endDate', v.endDate, 'date', 'required')}
        ${field('Giới hạn tổng lượt dùng (*)', 'usageLimit', v.usageLimit, 'number', 'required min="1" step="1"', true)}
        ${formError()}
      </div>
      <div class="modal-footer">
        ${action('close-modal', 'Hủy')}
        <button class="btn primary" type="submit">${icon('check')}Lưu</button>
      </div>
    </form>`,
    true,
  );
}
