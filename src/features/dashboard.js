/* M5: Tổng quan cửa hàng (Dashboard) — 100% kết nối SQLite API (/api/reports/dashboard, BR-08 chuẩn kế toán). */
'use strict';

function dashboardView() {
  if (!apiState.dashboardLoaded && !apiState.loading.dashboard) {
    loadDashboardData();
  }
  const dateLabel = new Intl.DateTimeFormat('vi-VN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(new Date());

  const headerHTML = heading(
    e(dateLabel),
    'Tổng quan cửa hàng',
    'Tổng hợp doanh thu thuần trước VAT, thuế VAT ròng, lợi nhuận gộp, cơ cấu thu tiền và cảnh báo vận hành trực tiếp từ SQLite (BR-08).',
    `<div class="row gap8">
      ${store.can('reports') ? action('navigate', 'Báo cáo chi tiết', 'chart', '', 'data-page="reports"') : ''}
      ${store.can('pos') ? action('navigate', 'Tạo đơn bán mới', 'plus', 'primary', 'data-page="pos"') : ''}
    </div>`,
  );

  if (apiState.dashboardError) {
    return headerHTML + `<div class="note red" role="alert">${e(apiState.dashboardError)}</div>`;
  }
  if (!apiState.dashboardData) {
    return headerHTML + '<section class="panel"><div class="panel-body"><div class="note">Đang tải số liệu tổng quan từ SQLite…</div></div></section>';
  }

  const d = apiState.dashboardData;
  const today = d.today || {};
  const summary = d.summary || {};
  const queues = d.queues || {};
  const days = d.period?.days || chartDays || 7;
  const methods = d.paymentBreakdown || [];
  const lowList = queues.lowStockProducts || [];

  return (
    headerHTML +
    stats([
      [
        `DT thuần trước VAT (${days} ngày)`,
        money(summary.netRevenuePreTax ?? summary.netRevenue ?? 0),
        `Hôm nay: ${money(today.netRevenuePreTax ?? today.netRevenue ?? 0)} · VAT ròng: ${money(summary.netTax || 0)}`,
        'receipt',
      ],
      [
        `Lợi nhuận gộp (${days} ngày)`,
        money(summary.grossProfit || 0),
        `Biên LN ${summary.grossMarginPct ?? 0}% · Giá vốn ${money(summary.netCogs || 0)}${summary.totalShrinkageLoss > 0 ? ` · Hao hụt kho ${money(summary.totalShrinkageLoss)}` : summary.nonRestockedReturnCogs > 0 ? ` · Hao hụt ${money(summary.nonRestockedReturnCogs)}` : ''}`,
        'chart',
      ],
      [
        `Tổng thu gồm VAT (${days} ngày)`,
        money(summary.netCollected ?? 0),
        `${number(summary.orderCount || 0)} đơn · Hoàn ${number(summary.returnCount || 0)} phiếu (−${money(summary.refundTotal || 0)})`,
        'cart',
      ],
      [
        'Mặt hàng đang kinh doanh',
        number(queues.activeProducts || 0),
        `Bán ròng ${number(summary.netQtyTotal || 0)} đv trong kỳ`,
        'box',
      ],
      [
        'Cảnh báo tồn tối thiểu',
        number(queues.lowStockCount || 0),
        `${number(queues.outOfStockCount || 0)} hết hàng · Cần nhập bổ sung`,
        'bell',
      ],
    ]) +
    `<div class="dashboard-grid">
      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>Xu hướng doanh thu thuần &amp; lợi nhuận gộp</h2>
            <p class="sub">Kỳ ${dateOnly(d.period?.fromDate)} – ${dateOnly(d.period?.toDate)} · Tính trước thuế VAT &amp; đã trừ giá vốn hàng bán (BR-08)</p>
          </div>
          <div class="segmented">
            ${[7, 30]
              .map(
                (n) =>
                  `<button type="button" class="${days === n ? 'active' : ''}" data-action="chart-period" data-days="${n}">${n} ngày</button>`,
              )
              .join('')}
          </div>
        </div>
        <div class="panel-body">
          ${revenueTrendChart(d.series || [], { showProfit: true, ariaLabel: `Xu hướng doanh thu thuần trước VAT và lợi nhuận gộp ${days} ngày` })}
        </div>
      </section>

      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>Cơ cấu thanh toán</h2>
            <p class="sub">Theo tổng thu ròng gồm VAT (${days} ngày gần nhất)</p>
          </div>
          ${icon('card')}
        </div>
        <div class="panel-body">
          ${paymentDonutChart(methods, summary.orderCount || 0)}
        </div>
      </section>
    </div>

    <div class="dashboard-grid">
      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>Đơn hàng gần đây</h2>
            <p class="sub">Hóa đơn đã thanh toán mới nhất trong SQLite</p>
          </div>
          ${store.can('orders') ? action('navigate', 'Xem tất cả →', '', 'ghost small', 'data-page="orders"') : ''}
        </div>
        ${orderTable(d.recentOrders || [], true)}
      </section>

      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>Hàng đợi cần xử lý</h2>
            <p class="sub">Đồng bộ trạng thái kho, nhập hàng &amp; hoàn trả</p>
          </div>
          <span class="badge ${queues.totalAttentionCount > 0 ? 'yellow' : 'green'}">${number(queues.totalAttentionCount || 0)} cần xử lý</span>
        </div>
        <div class="panel-body">
          ${
            queues.draftPurchases > 0
              ? `<div class="alert-item">
                  <div class="stat-icon">${icon('truck')}</div>
                  <div><strong>${number(queues.draftPurchases)} phiếu nhập nháp (Draft)</strong><small>Chờ Quản lý kiểm tra và xác nhận cộng tồn kho</small></div>
                  ${store.can('purchases') ? ib('navigate', 'arrow', 'Mở Nhập hàng', 'data-page="purchases"') : ''}
                </div>`
              : ''
          }
          ${
            queues.pendingAudits > 0
              ? `<div class="alert-item">
                  <div class="stat-icon">${icon('warehouse')}</div>
                  <div><strong>${number(queues.pendingAudits)} phiếu kiểm kê chờ duyệt</strong><small>Cần Quản lý rà soát chênh lệch và duyệt điều chỉnh</small></div>
                  ${store.can('inventory') ? ib('navigate', 'arrow', 'Mở Kiểm kê', 'data-page="inventory"') : ''}
                </div>`
              : ''
          }
          ${
            queues.pendingReturns > 0
              ? `<div class="alert-item">
                  <div class="stat-icon">${icon('return')}</div>
                  <div><strong>${number(queues.pendingReturns)} phiếu trả hàng chờ duyệt</strong><small>Cần Quản lý xác nhận hoàn tiền &amp; hoàn tồn kho</small></div>
                  ${store.can('returns') ? ib('navigate', 'arrow', 'Mở Đổi trả', 'data-page="returns"') : ''}
                </div>`
              : ''
          }
          ${
            queues.expiredBatchCount > 0
              ? `<div class="alert-item">
                  <div class="stat-icon">${icon('bell')}</div>
                  <div>
                    <strong>${number(queues.expiredBatchCount)} lô hàng đã hết hạn sử dụng</strong>
                    <small>Đã tự động loại khỏi tồn bán POS · Cần lập phiếu xuất hủy (HUY_HANG)</small>
                  </div>
                  ${badge('Hết hạn', 'red')}
                  ${store.can('inventory') ? ib('navigate', 'arrow', 'Mở Kho & Hủy hàng', 'data-page="inventory"') : ''}
                </div>`
              : ''
          }
          ${
            queues.nearExpiryBatchCount > 0
              ? `<div class="alert-item">
                  <div class="stat-icon">${icon('clock')}</div>
                  <div>
                    <strong>${number(queues.nearExpiryBatchCount)} lô hàng cận date (trong ${number(d.nearExpirySummary?.warnDays || 14)} ngày)</strong>
                    <small>Giá trị vốn rủi ro: ${money(d.nearExpirySummary?.atRiskCostValue || 0)} · Nên ưu tiên xả hàng / KM cận date</small>
                  </div>
                  ${badge('Cận date', 'yellow')}
                  ${store.can('inventory') ? ib('navigate', 'arrow', 'Xem lô cận date', 'data-page="inventory"') : ''}
                </div>`
              : ''
          }
          ${lowList
            .slice(0, 4)
            .map(
              (p) => `<div class="alert-item">
                <div class="stat-icon">${icon('box')}</div>
                <div>
                  <strong>${e(p.name)} <small class="muted">(${e(p.sku)})</small></strong>
                  <small>Tồn hiện tại: ${number(p.stockQty)} ${e(p.unitName)} · Tối thiểu: ${number(p.minStock)}</small>
                </div>
                ${badge(p.stockQty <= 0 ? 'Hết hàng' : 'Tồn thấp', p.stockQty <= 0 ? 'red' : 'yellow')}
              </div>`,
            )
            .join('')}
          ${
            !queues.totalAttentionCount && !queues.nearExpiryBatchCount
              ? empty('Vận hành ổn định', 'Không có chứng từ chờ duyệt, lô hết hạn hay sản phẩm dưới ngưỡng tồn tối thiểu.', 'check')
              : ''
          }
        </div>
      </section>
    </div>`
  );
}
