/* M5: Báo cáo Doanh thu, Lợi nhuận, Top bán chạy & Tồn kho (BR-08 chuẩn kế toán) — 100% SQLite API + Xuất CSV/PDF. */
'use strict';

function buildPrintableReportHTML(sales, inv) {
  const st = sales.store || store.data.settings || {};
  const s = sales.summary || {};
  const invSum = inv?.summary || {};
  const f = sales.filters || {};
  const cats = sales.categoryBreakdown || [];
  const pays = sales.paymentBreakdown || [];
  const tops = sales.topProducts || [];
  const invCats = inv?.byCategory || [];

  const catTotals = cats.reduce(
    (a, c) => ({
      netQty: a.netQty + c.netQty,
      grossRevenuePreTax: a.grossRevenuePreTax + (c.grossRevenuePreTax ?? c.grossRevenue),
      refundPreTax: a.refundPreTax + (c.refundPreTax ?? 0),
      netRevenuePreTax: a.netRevenuePreTax + (c.netRevenuePreTax ?? c.netRevenue),
      netCogs: a.netCogs + c.netCogs,
      grossProfit: a.grossProfit + c.grossProfit,
    }),
    { netQty: 0, grossRevenuePreTax: 0, refundPreTax: 0, netRevenuePreTax: 0, netCogs: 0, grossProfit: 0 },
  );
  const payTotals = pays.reduce(
    (a, p) => ({
      orderCount: a.orderCount + p.orderCount,
      grossCollected: a.grossCollected + (p.grossCollected ?? p.grossRevenue),
      refundTotal: a.refundTotal + p.refundTotal,
      netCollected: a.netCollected + (p.netCollected ?? p.netRevenue),
      netRevenuePreTax: a.netRevenuePreTax + (p.netRevenuePreTax ?? 0),
      netTax: a.netTax + (p.netTax ?? 0),
    }),
    { orderCount: 0, grossCollected: 0, refundTotal: 0, netCollected: 0, netRevenuePreTax: 0, netTax: 0 },
  );

  return `<article class="report-print" style="padding:18px;font-family:system-ui,-apple-system,sans-serif;color:#0f172a;font-size:12px">
    <div style="border-bottom:2px solid #1e293b;padding-bottom:10px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:flex-start">
      <div>
        <h1 style="margin:0;font-size:18px">${e(st.name || 'RetailFlow Mart')}</h1>
        <div>${e(st.address || '')} · Hotline: ${e(st.phone || '')}</div>
      </div>
      <div style="text-align:right">
        <strong style="font-size:14px">BÁO CÁO KẾT QUẢ KINH DOANH &amp; TỒN KHO</strong>
        <div>Kỳ báo cáo: <strong>${dateOnly(f.fromDate)} – ${dateOnly(f.toDate)}</strong></div>
        <div>Ngày xuất: ${date(new Date().toISOString())} · Người lập: ${e(store.user?.fullName || '')}</div>
      </div>
    </div>

    <h3 style="margin:12px 0 6px">1. Tổng hợp Kết quả Kinh doanh chuẩn kế toán (BR-08)</h3>
    <table style="width:100%;border-collapse:collapse;margin-bottom:14px">
      <thead>
        <tr style="background:#f1f5f9">
          <th style="text-align:left;padding:6px;border:1px solid #cbd5e1">Chỉ tiêu</th>
          <th style="text-align:right;padding:6px;border:1px solid #cbd5e1">Giá trị (VNĐ)</th>
        </tr>
      </thead>
      <tbody>
        <tr><td style="padding:6px;border:1px solid #cbd5e1">1. Doanh thu gộp trước VAT (${number(s.orderCount || 0)} hóa đơn đã thanh toán)</td><td style="padding:6px;border:1px solid #cbd5e1;text-align:right">${money(s.grossRevenuePreTax || 0)}</td></tr>
        <tr><td style="padding:6px;border:1px solid #cbd5e1">2. Hoàn trả doanh thu trước VAT (${number(s.returnCount || 0)} phiếu trả đã xác nhận)</td><td style="padding:6px;border:1px solid #cbd5e1;text-align:right">−${money(s.refundPreTax || 0)}</td></tr>
        <tr style="background:#f8fafc;font-weight:700"><td style="padding:6px;border:1px solid #cbd5e1">3. Doanh thu thuần (trước VAT) = 1 − 2</td><td style="padding:6px;border:1px solid #cbd5e1;text-align:right">${money(s.netRevenuePreTax || 0)}</td></tr>
        <tr><td style="padding:6px;border:1px solid #cbd5e1">4. Giá vốn hàng bán ròng (chỉ trừ vốn hàng trả nhập lại kho: ${money(s.restockedReturnCogs || 0)})</td><td style="padding:6px;border:1px solid #cbd5e1;text-align:right">−${money(s.netCogs || 0)}</td></tr>
        ${
          s.nonRestockedReturnCogs > 0
            ? `<tr><td style="padding:6px;border:1px solid #cbd5e1"><em>   ↳ Trong đó: Hao hụt hàng lỗi không nhập kho (restock = 0, đã giữ nguyên trong Giá vốn)</em></td><td style="padding:6px;border:1px solid #cbd5e1;text-align:right"><em>${money(s.nonRestockedReturnCogs)}</em></td></tr>`
            : ''
        }
        <tr style="background:#ecfdf5;font-weight:700"><td style="padding:6px;border:1px solid #cbd5e1">5. Lợi nhuận gộp (trước VAT) = 3 − 4 · Biên LN ${s.grossMarginPct ?? 0}%</td><td style="padding:6px;border:1px solid #cbd5e1;text-align:right">${money(s.grossProfit || 0)}</td></tr>
        <tr><td style="padding:6px;border:1px solid #cbd5e1">6. Thuế VAT đầu ra ròng (VAT gộp ${money(s.grossTax || 0)} − VAT hoàn trả ${money(s.refundTax || 0)})</td><td style="padding:6px;border:1px solid #cbd5e1;text-align:right">${money(s.netTax || 0)}</td></tr>
        <tr style="background:#f8fafc;font-weight:700"><td style="padding:6px;border:1px solid #cbd5e1">7. Tổng thu ròng khách hàng (gồm VAT) = 3 + 6</td><td style="padding:6px;border:1px solid #cbd5e1;text-align:right">${money(s.netCollected || 0)}</td></tr>
      </tbody>
    </table>

    <h3 style="margin:12px 0 6px">2. Doanh thu thuần (trước VAT) &amp; Lợi nhuận gộp theo Danh mục</h3>
    <table style="width:100%;border-collapse:collapse;margin-bottom:14px">
      <thead>
        <tr style="background:#f1f5f9">
          <th style="text-align:left;padding:5px;border:1px solid #cbd5e1">Danh mục</th>
          <th style="text-align:right;padding:5px;border:1px solid #cbd5e1">SL ròng</th>
          <th style="text-align:right;padding:5px;border:1px solid #cbd5e1">DT gộp trước VAT</th>
          <th style="text-align:right;padding:5px;border:1px solid #cbd5e1">Hoàn trước VAT</th>
          <th style="text-align:right;padding:5px;border:1px solid #cbd5e1">DT thuần trước VAT</th>
          <th style="text-align:right;padding:5px;border:1px solid #cbd5e1">Giá vốn</th>
          <th style="text-align:right;padding:5px;border:1px solid #cbd5e1">LN gộp</th>
        </tr>
      </thead>
      <tbody>
        ${cats
          .map(
            (c) => `<tr>
              <td style="padding:5px;border:1px solid #cbd5e1">${e(c.categoryName)}</td>
              <td style="padding:5px;border:1px solid #cbd5e1;text-align:right">${number(c.netQty)}</td>
              <td style="padding:5px;border:1px solid #cbd5e1;text-align:right">${money(c.grossRevenuePreTax)}</td>
              <td style="padding:5px;border:1px solid #cbd5e1;text-align:right">${money(c.refundPreTax)}</td>
              <td style="padding:5px;border:1px solid #cbd5e1;text-align:right">${money(c.netRevenuePreTax)}</td>
              <td style="padding:5px;border:1px solid #cbd5e1;text-align:right">${money(c.netCogs)}</td>
              <td style="padding:5px;border:1px solid #cbd5e1;text-align:right">${money(c.grossProfit)}</td>
            </tr>`,
          )
          .join('')}
        <tr style="background:#f8fafc;font-weight:700">
          <td style="padding:5px;border:1px solid #cbd5e1">Tổng cộng</td>
          <td style="padding:5px;border:1px solid #cbd5e1;text-align:right">${number(catTotals.netQty)}</td>
          <td style="padding:5px;border:1px solid #cbd5e1;text-align:right">${money(catTotals.grossRevenuePreTax)}</td>
          <td style="padding:5px;border:1px solid #cbd5e1;text-align:right">${money(catTotals.refundPreTax)}</td>
          <td style="padding:5px;border:1px solid #cbd5e1;text-align:right">${money(catTotals.netRevenuePreTax)}</td>
          <td style="padding:5px;border:1px solid #cbd5e1;text-align:right">${money(catTotals.netCogs)}</td>
          <td style="padding:5px;border:1px solid #cbd5e1;text-align:right">${money(catTotals.grossProfit)}</td>
        </tr>
      </tbody>
    </table>

    <h3 style="margin:12px 0 6px">3. Phương thức Thanh toán (Tổng thu gồm VAT &amp; tách thuế)</h3>
    <table style="width:100%;border-collapse:collapse;margin-bottom:14px">
      <thead>
        <tr style="background:#f1f5f9">
          <th style="text-align:left;padding:5px;border:1px solid #cbd5e1">Phương thức</th>
          <th style="text-align:right;padding:5px;border:1px solid #cbd5e1">Số đơn</th>
          <th style="text-align:right;padding:5px;border:1px solid #cbd5e1">Tổng thu gộp</th>
          <th style="text-align:right;padding:5px;border:1px solid #cbd5e1">Hoàn khách</th>
          <th style="text-align:right;padding:5px;border:1px solid #cbd5e1">Tổng thu ròng</th>
          <th style="text-align:right;padding:5px;border:1px solid #cbd5e1">DT thuần trước VAT</th>
          <th style="text-align:right;padding:5px;border:1px solid #cbd5e1">Thuế VAT ròng</th>
        </tr>
      </thead>
      <tbody>
        ${pays
          .map(
            (p) => `<tr>
              <td style="padding:5px;border:1px solid #cbd5e1">${e(p.label)}</td>
              <td style="padding:5px;border:1px solid #cbd5e1;text-align:right">${number(p.orderCount)}</td>
              <td style="padding:5px;border:1px solid #cbd5e1;text-align:right">${money(p.grossCollected)}</td>
              <td style="padding:5px;border:1px solid #cbd5e1;text-align:right">${money(p.refundTotal)}</td>
              <td style="padding:5px;border:1px solid #cbd5e1;text-align:right">${money(p.netCollected)}</td>
              <td style="padding:5px;border:1px solid #cbd5e1;text-align:right">${money(p.netRevenuePreTax)}</td>
              <td style="padding:5px;border:1px solid #cbd5e1;text-align:right">${money(p.netTax)}</td>
            </tr>`,
          )
          .join('')}
        <tr style="background:#f8fafc;font-weight:700">
          <td style="padding:5px;border:1px solid #cbd5e1">Tổng cộng</td>
          <td style="padding:5px;border:1px solid #cbd5e1;text-align:right">${number(payTotals.orderCount)}</td>
          <td style="padding:5px;border:1px solid #cbd5e1;text-align:right">${money(payTotals.grossCollected)}</td>
          <td style="padding:5px;border:1px solid #cbd5e1;text-align:right">${money(payTotals.refundTotal)}</td>
          <td style="padding:5px;border:1px solid #cbd5e1;text-align:right">${money(payTotals.netCollected)}</td>
          <td style="padding:5px;border:1px solid #cbd5e1;text-align:right">${money(payTotals.netRevenuePreTax)}</td>
          <td style="padding:5px;border:1px solid #cbd5e1;text-align:right">${money(payTotals.netTax)}</td>
        </tr>
      </tbody>
    </table>

    <div style="margin-top:10px">
      <strong>Top sản phẩm bán chạy:</strong> ${number(tops.length)} SKU ·
      <strong>Giá trị tồn kho hiện tại (giá vốn):</strong> ${money(invSum.totalCostValue || 0)} (${number(invSum.totalStockQty || 0)} đv trên ${number(invCats.length)} danh mục · ${number(invSum.lowStockCount || 0)} SKU dưới ngưỡng tối thiểu).
    </div>
  </article>`;
}

function reportsView() {
  if (!apiState.categoriesLoaded && !apiState.loading.catalogMeta) {
    loadCatalogMeta();
  }
  if (!apiState.salesReportLoaded && !apiState.loading.reports) {
    loadReportsData();
  }

  const def = getDefaultReportRange(30);
  const fromVal = filters.reportFrom || def.fromDate;
  const toVal = filters.reportTo || def.toDate;
  const catVal = filters.reportCategory || '';
  const groupVal = filters.reportGroupBy || 'day';

  const catOptions = [['', 'Tất cả danh mục'], ...(apiState.categories || []).map((c) => [c.code, c.name])];
  const r = apiState.salesReport;
  const inv = apiState.inventoryReport;
  const s = r?.summary || {};
  const invSum = inv?.summary || {};

  const filterBar = `<section class="panel mb16">
    <div class="panel-head">
      <div>
        <h2>Bộ lọc báo cáo (BR-08)</h2>
        <p class="sub">Bắt buộc <code>Từ ngày &lt;= Đến ngày</code> · Mọi chỉ số kế toán, biểu đồ và tệp xuất Excel/PDF đồng bộ 100% theo bộ lọc này.</p>
      </div>
      <div class="row gap8">
        ${action('report-preset', '7 ngày', '', 'small', 'data-preset="7d"')}
        ${action('report-preset', '30 ngày', '', 'small', 'data-preset="30d"')}
        ${action('report-preset', 'Tháng này', '', 'small', 'data-preset="month"')}
      </div>
    </div>
    <div class="table-tools wrap">
      <label class="date-filter" style="white-space:nowrap">Từ ngày (*) <input type="date" id="filter-reportFrom" data-filter="reportFrom" value="${e(fromVal)}"></label>
      <label class="date-filter" style="white-space:nowrap">Đến ngày (*) <input type="date" id="filter-reportTo" data-filter="reportTo" value="${e(toVal)}"></label>
      ${filterSelect('reportCategory', catOptions)}
      ${filterSelect('reportGroupBy', [
        ['day', 'Gom theo Ngày'],
        ['month', 'Gom theo Tháng'],
      ])}
      ${action('reports-reset', 'Đặt lại', 'return', 'small')}
    </div>
    ${apiState.salesReportError ? `<div class="panel-body"><div class="note red" role="alert">${e(apiState.salesReportError)}</div></div>` : ''}
  </section>`;

  const headerHTML = heading(
    'BÁO CÁO & THỐNG KÊ / BR-08',
    'Báo cáo Doanh thu, Lợi nhuận & Tồn kho',
    'Tách bạch doanh thu thuần trước VAT, thuế VAT đầu ra ròng, tổng thu khách hàng, giá vốn hàng bán (theo restock) và lợi nhuận gộp từ SQLite.',
    `<div class="row gap8">
      ${action('print-report', 'In / Xuất PDF', 'print', '', r ? '' : 'disabled')}
      ${action('export-report', 'Xuất Excel / CSV', 'download', 'primary', r ? '' : 'disabled')}
    </div>`,
  );

  if (!r || apiState.salesReportError) {
    return (
      headerHTML +
      filterBar +
      (!apiState.salesReportError
        ? '<section class="panel"><div class="panel-body"><div class="note">Đang tổng hợp dữ liệu báo cáo từ SQLite…</div></div></section>'
        : '')
    );
  }

  const cats = r.categoryBreakdown || [];
  const catTotals = cats.reduce(
    (a, c) => ({
      soldQty: a.soldQty + c.soldQty,
      returnedQty: a.returnedQty + c.returnedQty,
      netQty: a.netQty + c.netQty,
      grossRevenuePreTax: a.grossRevenuePreTax + (c.grossRevenuePreTax ?? c.grossRevenue),
      refundPreTax: a.refundPreTax + (c.refundPreTax ?? 0),
      netRevenuePreTax: a.netRevenuePreTax + (c.netRevenuePreTax ?? c.netRevenue),
      netCogs: a.netCogs + c.netCogs,
      grossProfit: a.grossProfit + c.grossProfit,
    }),
    { soldQty: 0, returnedQty: 0, netQty: 0, grossRevenuePreTax: 0, refundPreTax: 0, netRevenuePreTax: 0, netCogs: 0, grossProfit: 0 },
  );

  const pays = r.paymentBreakdown || [];
  const payTotals = pays.reduce(
    (a, p) => ({
      orderCount: a.orderCount + p.orderCount,
      grossCollected: a.grossCollected + (p.grossCollected ?? p.grossRevenue),
      refundTotal: a.refundTotal + p.refundTotal,
      netCollected: a.netCollected + (p.netCollected ?? p.netRevenue),
      netRevenuePreTax: a.netRevenuePreTax + (p.netRevenuePreTax ?? 0),
      netTax: a.netTax + (p.netTax ?? 0),
    }),
    { orderCount: 0, grossCollected: 0, refundTotal: 0, netCollected: 0, netRevenuePreTax: 0, netTax: 0 },
  );

  const tops = r.topProducts || [];
  const topTotals = tops.reduce(
    (a, p) => ({
      soldQty: a.soldQty + p.soldQty,
      returnedQty: a.returnedQty + p.returnedQty,
      netQty: a.netQty + p.netQty,
      netRevenuePreTax: a.netRevenuePreTax + (p.netRevenuePreTax ?? p.netRevenue),
      netCogs: a.netCogs + p.netCogs,
      grossProfit: a.grossProfit + p.grossProfit,
    }),
    { soldQty: 0, returnedQty: 0, netQty: 0, netRevenuePreTax: 0, netCogs: 0, grossProfit: 0 },
  );

  const invCats = inv?.byCategory || [];
  const invLow = inv?.lowStockItems || [];
  const invLowTotalCost = invLow.reduce((sum, x) => sum + (Number(x.costValue) || 0), 0);
  const invLowTotalDeficit = invLow.reduce((sum, x) => sum + (Number(x.deficit) || 0), 0);

  return (
    headerHTML +
    filterBar +
    stats([
      [
        'Doanh thu thuần (trước VAT)',
        money(s.netRevenuePreTax ?? 0),
        `Gộp trước VAT ${money(s.grossRevenuePreTax || 0)} − Hoàn ${money(s.refundPreTax || 0)}`,
        'receipt',
      ],
      [
        'Lợi nhuận gộp (trước VAT)',
        money(s.grossProfit || 0),
        `Biên LN gộp: ${s.grossMarginPct ?? 0}% · Giá vốn ${money(s.netCogs || 0)}`,
        'chart',
      ],
      [
        'Thuế VAT ròng & Tổng thu',
        money(s.netCollected ?? 0),
        `Thuế VAT đầu ra ròng: ${money(s.netTax || 0)} (Hoàn VAT −${money(s.refundTax || 0)})`,
        'cash',
      ],
      [
        'Giá trị tồn kho (Giá vốn)',
        money(invSum.totalCostValue || 0),
        `${number(invSum.totalStockQty || 0)} đv · ${number(invSum.lowStockCount || 0)} SKU tồn thấp`,
        'warehouse',
      ],
    ]) +
    // P&L Table
    `<section class="panel mb16">
      <div class="panel-head">
        <div>
          <h2>1. Bảng Kết quả Kinh doanh (P&amp;L chuẩn kế toán &amp; BR-08)</h2>
          <p class="sub">Kỳ ${dateOnly(r.filters?.fromDate)} – ${dateOnly(r.filters?.toDate)}${catVal ? ` · Danh mục: ${e(catVal)}` : ' · Toàn cửa hàng'} · Tách VAT khỏi Doanh thu &amp; Lợi nhuận gộp; chỉ khấu trừ Giá vốn khi hàng trả nhập lại kho (<code>restock = 1</code>).</p>
        </div>
        ${badge(s.grossProfit >= 0 ? 'Kinh doanh có lãi' : 'Đang ghi nhận lỗ gộp', s.grossProfit >= 0 ? 'green' : 'red')}
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Chỉ tiêu kế toán</th>
              <th>Công thức &amp; Ý nghĩa nghiệp vụ (BR-08)</th>
              <th style="text-align:right">Số tiền (VNĐ)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="name"><strong>1. Doanh thu gộp (trước VAT)</strong></td>
              <td><code>SUM(subtotal − invoice_discount)</code> trên ${number(s.orderCount || 0)} hóa đơn <code>DaThanhToan / TraMotPhan / DaHoanTra</code></td>
              <td class="money right"><strong>${money(s.grossRevenuePreTax || 0)}</strong></td>
            </tr>
            <tr>
              <td class="name muted">2. Giảm trừ hàng bán bị trả lại (trước VAT)</td>
              <td>Phần doanh thu trước thuế của ${number(s.returnCount || 0)} phiếu trả <code>DaXacNhan</code> (${number(s.returnedQtyTotal || 0)} đv)</td>
              <td class="money right negative">−${money(s.refundPreTax || 0)}</td>
            </tr>
            <tr style="background:#f8fafc">
              <td class="name"><strong>3. DOANH THU THUẦN (TRƯỚC VAT)</strong></td>
              <td><strong>netRevenuePreTax = Doanh thu gộp trước VAT − Hoàn trả trước VAT (1 − 2)</strong></td>
              <td class="money right"><strong>${money(s.netRevenuePreTax || 0)}</strong></td>
            </tr>
            <tr>
              <td class="name">4. Giá vốn hàng bán ròng (Net COGS)</td>
              <td>Giá vốn gốc ${money(s.grossCogs || 0)} (${number(s.soldQtyTotal || 0)} đv) trừ vốn hàng trả nhập lại kho ${money(s.restockedReturnCogs || 0)} (${number(s.restockedQtyTotal || 0)} đv <code>restock = 1</code>)</td>
              <td class="money right negative">−${money(s.netCogs || 0)}</td>
            </tr>
            ${
              s.nonRestockedReturnCogs > 0
                ? `<tr style="background:#fffbeb">
                    <td class="name"><em>↳ Theo dõi: Hao hụt hàng lỗi không nhập kho (restock = 0)</em></td>
                    <td><em>${number(s.nonRestockedQtyTotal || 0)} đv hàng trả hỏng/hết hạn không nhập lại kho — không trừ khỏi COGS để phản ánh đúng chi phí hao hụt</em></td>
                    <td class="money right negative"><em>${money(s.nonRestockedReturnCogs)}</em></td>
                  </tr>`
                : ''
            }
            <tr style="background:#ecfdf5">
              <td class="name"><strong>5. LỢI NHUẬN GỘP (Gross Profit)</strong></td>
              <td><strong>grossProfit = Doanh thu thuần trước VAT − Giá vốn hàng bán (3 − 4) · Biên LN gộp: ${s.grossMarginPct ?? 0}%</strong></td>
              <td class="money right"><strong class="${s.grossProfit >= 0 ? 'positive' : 'negative'}">${money(s.grossProfit || 0)}</strong></td>
            </tr>
            <tr>
              <td class="name">6. Thuế VAT đầu ra ròng (Net Output VAT)</td>
              <td>VAT hóa đơn ${money(s.grossTax || 0)} trừ VAT hoàn trả ${money(s.refundTax || 0)} (hạch toán riêng, không cộng vào Lợi nhuận gộp)</td>
              <td class="money right">${money(s.netTax || 0)}</td>
            </tr>
            <tr style="background:#f1f5f9">
              <td class="name"><strong>7. TỔNG THU RÒNG KHÁCH HÀNG (Gồm VAT)</strong></td>
              <td><strong>netCollected = Thu gộp ${money(s.grossCollected || 0)} − Hoàn khách ${money(s.refundTotal || 0)} (bằng mục 3 + mục 6)</strong></td>
              <td class="money right"><strong>${money(s.netCollected || 0)}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>` +
    // Charts grid
    `<div class="dashboard-grid mb16">
      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>2. Biểu đồ Xu hướng Doanh thu thuần &amp; Lợi nhuận gộp</h2>
            <p class="sub">Gom nhóm theo ${groupVal === 'month' ? 'Tháng' : 'Ngày'} · Trước thuế VAT · Đơn vị nghìn đồng (k)</p>
          </div>
        </div>
        <div class="panel-body">
          ${revenueTrendChart(r.series || [], { showProfit: true, ariaLabel: 'Biểu đồ doanh thu thuần trước VAT và lợi nhuận gộp theo kỳ lọc' })}
        </div>
      </section>
      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>3. Cơ cấu Doanh thu thuần theo Danh mục</h2>
            <p class="sub">Tỷ trọng doanh thu thuần trước VAT trên từng nhóm hàng</p>
          </div>
        </div>
        <div class="panel-body">
          ${categoryBarChart(cats)}
        </div>
      </section>
    </div>` +
    // Category breakdown table
    `<section class="panel mb16">
      <div class="panel-head">
        <div>
          <h2>4. Chi tiết Doanh thu thuần (trước VAT) &amp; Lợi nhuận theo Danh mục</h2>
          <p class="sub">Phân bổ doanh thu trước thuế chính xác đến từng đồng · Chỉ trừ giá vốn hàng trả nhập kho (<code>restock = 1</code>)</p>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Danh mục</th>
              <th style="text-align:right">SL bán</th>
              <th style="text-align:right">SL trả</th>
              <th style="text-align:right">SL ròng</th>
              <th style="text-align:right">DT gộp trước VAT</th>
              <th style="text-align:right">Hoàn trước VAT</th>
              <th style="text-align:right">DT thuần trước VAT</th>
              <th style="text-align:right">Giá vốn</th>
              <th style="text-align:right">Lợi nhuận gộp</th>
            </tr>
          </thead>
          <tbody>
            ${
              cats.length
                ? cats
                    .map(
                      (c) => `<tr>
                        <td class="name">${e(c.categoryName)} <small class="muted">(${c.sharePct}%)</small></td>
                        <td class="right">${number(c.soldQty)}</td>
                        <td class="right">${number(c.returnedQty)}</td>
                        <td class="right"><strong>${number(c.netQty)}</strong></td>
                        <td class="money right">${money(c.grossRevenuePreTax)}</td>
                        <td class="money right negative">${money(c.refundPreTax)}</td>
                        <td class="money right"><strong>${money(c.netRevenuePreTax)}</strong></td>
                        <td class="money right">${money(c.netCogs)}</td>
                        <td class="money right ${c.grossProfit >= 0 ? 'positive' : 'negative'}"><strong>${money(c.grossProfit)}</strong></td>
                      </tr>`,
                    )
                    .join('') +
                  `<tr style="background:#f8fafc;font-weight:700">
                    <td>Tổng cộng (${cats.length} danh mục)</td>
                    <td class="right">${number(catTotals.soldQty)}</td>
                    <td class="right">${number(catTotals.returnedQty)}</td>
                    <td class="right">${number(catTotals.netQty)}</td>
                    <td class="money right">${money(catTotals.grossRevenuePreTax)}</td>
                    <td class="money right negative">${money(catTotals.refundPreTax)}</td>
                    <td class="money right">${money(catTotals.netRevenuePreTax)}</td>
                    <td class="money right">${money(catTotals.netCogs)}</td>
                    <td class="money right ${catTotals.grossProfit >= 0 ? 'positive' : 'negative'}">${money(catTotals.grossProfit)}</td>
                  </tr>`
                : `<tr><td colspan="9">${empty('Chưa có phát sinh bán hàng trong kỳ', 'Thử chọn khoảng ngày khác.', 'search')}</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </section>` +
    // Payment methods table
    `<section class="panel mb16">
      <div class="panel-head">
        <div>
          <h2>5. Dòng tiền theo Phương thức Thanh toán</h2>
          <p class="sub">Đối soát Tổng thu gồm VAT, Tiền hoàn khách, Doanh thu thuần trước VAT &amp; Thuế VAT ròng</p>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Phương thức thanh toán</th>
              <th style="text-align:right">Số đơn</th>
              <th style="text-align:right">Tổng thu gộp</th>
              <th style="text-align:right">Hoàn khách</th>
              <th style="text-align:right">Tổng thu ròng (gồm VAT)</th>
              <th style="text-align:right">DT thuần trước VAT</th>
              <th style="text-align:right">Thuế VAT ròng</th>
              <th style="text-align:right">Tỷ trọng</th>
            </tr>
          </thead>
          <tbody>
            ${pays
              .map(
                (p) => `<tr>
                  <td class="name">${e(p.label)}</td>
                  <td class="right">${number(p.orderCount)}</td>
                  <td class="money right">${money(p.grossCollected)}</td>
                  <td class="money right negative">${money(p.refundTotal)}</td>
                  <td class="money right"><strong>${money(p.netCollected)}</strong></td>
                  <td class="money right">${money(p.netRevenuePreTax)}</td>
                  <td class="money right">${money(p.netTax)}</td>
                  <td class="right">${p.sharePct}%</td>
                </tr>`,
              )
              .join('')}
            <tr style="background:#f8fafc;font-weight:700">
              <td>Tổng cộng</td>
              <td class="right">${number(payTotals.orderCount)}</td>
              <td class="money right">${money(payTotals.grossCollected)}</td>
              <td class="money right negative">${money(payTotals.refundTotal)}</td>
              <td class="money right">${money(payTotals.netCollected)}</td>
              <td class="money right">${money(payTotals.netRevenuePreTax)}</td>
              <td class="money right">${money(payTotals.netTax)}</td>
              <td class="right">100%</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>` +
    // Top selling products table
    `<section class="panel mb16">
      <div class="panel-head">
        <div>
          <h2>6. Top Sản phẩm Bán chạy trong kỳ</h2>
          <p class="sub">Xếp hạng theo Doanh thu thuần trước VAT và Lợi nhuận gộp thực tế</p>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>SKU</th>
              <th>Tên sản phẩm</th>
              <th>Danh mục</th>
              <th style="text-align:right">SL bán</th>
              <th style="text-align:right">SL trả</th>
              <th style="text-align:right">SL ròng</th>
              <th style="text-align:right">DT thuần trước VAT</th>
              <th style="text-align:right">Giá vốn</th>
              <th style="text-align:right">Lợi nhuận gộp</th>
            </tr>
          </thead>
          <tbody>
            ${
              tops.length
                ? tops
                    .map(
                      (p, idx) => `<tr>
                        <td>${idx + 1}</td>
                        <td><code>${e(p.sku)}</code></td>
                        <td class="name">${e(p.productName)}</td>
                        <td>${e(p.categoryName)}</td>
                        <td class="right">${number(p.soldQty)}</td>
                        <td class="right">${number(p.returnedQty)}</td>
                        <td class="right"><strong>${number(p.netQty)}</strong></td>
                        <td class="money right"><strong>${money(p.netRevenuePreTax)}</strong></td>
                        <td class="money right">${money(p.netCogs)}</td>
                        <td class="money right ${p.grossProfit >= 0 ? 'positive' : 'negative'}"><strong>${money(p.grossProfit)}</strong></td>
                      </tr>`,
                    )
                    .join('') +
                  `<tr style="background:#f8fafc;font-weight:700">
                    <td colspan="4">Tổng cộng (Top ${tops.length} sản phẩm)</td>
                    <td class="right">${number(topTotals.soldQty)}</td>
                    <td class="right">${number(topTotals.returnedQty)}</td>
                    <td class="right">${number(topTotals.netQty)}</td>
                    <td class="money right">${money(topTotals.netRevenuePreTax)}</td>
                    <td class="money right">${money(topTotals.netCogs)}</td>
                    <td class="money right ${topTotals.grossProfit >= 0 ? 'positive' : 'negative'}">${money(topTotals.grossProfit)}</td>
                  </tr>`
                : `<tr><td colspan="10">${empty('Chưa có sản phẩm bán chạy trong kỳ', 'Thử mở rộng bộ lọc thời gian.', 'box')}</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </section>` +
    // Inventory valuation + low-stock report
    `<div class="dashboard-grid">
      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>7. Định giá Tồn kho theo Danh mục</h2>
            <p class="sub">Tính theo Giá vốn bình quân gia quyền hiện hành</p>
          </div>
          ${badge(`${number(invSum.totalSku || 0)} SKU`, 'blue')}
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Danh mục</th>
                <th style="text-align:right">SKU</th>
                <th style="text-align:right">Tổng tồn</th>
                <th style="text-align:right">Giá trị vốn</th>
                <th style="text-align:right">Giá trị bán lẻ</th>
                <th style="text-align:right">Tồn thấp</th>
              </tr>
            </thead>
            <tbody>
              ${invCats
                .map(
                  (c) => `<tr>
                    <td class="name">${e(c.categoryName)}</td>
                    <td class="right">${number(c.skuCount)}</td>
                    <td class="right">${number(c.stockQty)}</td>
                    <td class="money right"><strong>${money(c.costValue)}</strong></td>
                    <td class="money right">${money(c.retailValue)}</td>
                    <td class="right">${c.lowStockCount > 0 ? badge(number(c.lowStockCount), 'yellow') : '0'}</td>
                  </tr>`,
                )
                .join('')}
              <tr style="background:#f8fafc;font-weight:700">
                <td>Tổng cộng</td>
                <td class="right">${number(invSum.totalSku || 0)}</td>
                <td class="right">${number(invSum.totalStockQty || 0)}</td>
                <td class="money right">${money(invSum.totalCostValue || 0)}</td>
                <td class="money right">${money(invSum.totalRetailValue || 0)}</td>
                <td class="right">${number(invSum.lowStockCount || 0)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>8. Sản phẩm dưới Tồn tối thiểu (BR-01)</h2>
            <p class="sub">Các mặt hàng <code>DangKinhDoanh</code> có <code>TonHienTai &lt;= TonToiThieu</code></p>
          </div>
          ${badge(`${number(invLow.length)} mặt hàng`, invLow.length > 0 ? 'yellow' : 'green')}
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>SKU</th>
                <th>Sản phẩm</th>
                <th style="text-align:right">Tồn</th>
                <th style="text-align:right">Tối thiểu</th>
                <th style="text-align:right">Thiếu</th>
                <th style="text-align:right">Giá trị vốn</th>
              </tr>
            </thead>
            <tbody>
              ${
                invLow.length
                  ? invLow
                      .slice(0, 15)
                      .map(
                        (p) => `<tr>
                          <td><code>${e(p.sku)}</code></td>
                          <td class="name">${e(p.name)}</td>
                          <td class="right negative"><strong>${number(p.stockQty)}</strong></td>
                          <td class="right">${number(p.minStock)}</td>
                          <td class="right">${number(p.deficit)}</td>
                          <td class="money right">${money(p.costValue)}</td>
                        </tr>`,
                      )
                      .join('') +
                    `<tr style="background:#f8fafc;font-weight:700">
                      <td colspan="4">Tổng cộng (${invLow.length} SKU cảnh báo)</td>
                      <td class="right">${number(invLowTotalDeficit)}</td>
                      <td class="money right">${money(invLowTotalCost)}</td>
                    </tr>`
                  : `<tr><td colspan="6">${empty('Không có sản phẩm dưới tồn tối thiểu', 'Tất cả sản phẩm đang ở mức tồn an toàn.', 'check')}</td></tr>`
              }
            </tbody>
          </table>
        </div>
      </section>
    </div>`
  );
}
