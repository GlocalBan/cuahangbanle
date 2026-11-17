function reportsView() {
  const p = periodData(reportDays),
    categorySales = {};
  p.orders.forEach((o) =>
    o.items.forEach((i) => {
      categorySales[i.category] = (categorySales[i.category] || 0) + i.paidTotal;
    }),
  );
  const categories = Object.entries(categorySales).sort((a, b) => b[1] - a[1]);
  const highest = Math.max(...Object.values(categorySales), 1);
  const pnl =
    typeof calculateProfitAndLoss === 'function'
      ? calculateProfitAndLoss(store.data, reportDays)
      : null;

  const pnlHTML = pnl
    ? `<section class="panel mb16"><div class="panel-head"><div><h2>Báo cáo Lãi lỗ toàn diện (P&L Statement)</h2><p class="sub">Kết quả kinh doanh chuỗi bán lẻ ${reportDays} ngày gần nhất · Đơn vị VNĐ</p></div><span class="badge ${pnl.netProfit >= 0 ? 'green' : 'red'}">${pnl.netProfit >= 0 ? 'Kinh doanh có lãi' : 'Đang thâm hụt'}</span></div><div class="table-wrap"><table><thead><tr><th>Chỉ tiêu tài chính</th><th>Ý nghĩa nghiệp vụ</th><th style="text-align:right">Giá trị (VNĐ)</th></tr></thead><tbody>
      <tr><td class="name"><strong>1. Doanh thu gộp (Gross Sales)</strong></td><td>Tổng giá trị hàng hóa ghi nhận trước chiết khấu</td><td class="money right"><strong>${money(pnl.grossRevenue)}</strong></td></tr>
      <tr><td class="name muted">2. Giảm giá & Khuyến mãi (CTKM + App Voucher)</td><td>Ưu đãi giảm giá đã cấp cho khách hàng</td><td class="money right negative">-${money(pnl.totalDiscounts)}</td></tr>
      <tr><td class="name muted">3. Hoàn trả hàng (Refunds)</td><td>Tổng tiền hoàn từ các đơn hàng đổi trả</td><td class="money right negative">-${money(pnl.refunds)}</td></tr>
      <tr style="background:var(--bg-panel)"><td class="name"><strong>4. Doanh thu thuần (Net Revenue)</strong></td><td>Doanh thu thực tế sau chiết khấu & hoàn hàng (1 - 2 - 3)</td><td class="money right"><strong>${money(pnl.netRevenue)}</strong></td></tr>
      <tr><td class="name">5. Giá vốn hàng bán (COGS)</td><td>Giá gốc nhập kho của số hàng đã bán</td><td class="money right negative">-${money(pnl.cogs)}</td></tr>
      <tr style="background:var(--bg-panel)"><td class="name"><strong>6. Lợi nhuận gộp (Gross Profit)</strong></td><td>Lợi nhuận gộp từ bán hàng (4 - 5)</td><td class="money right"><strong class="${pnl.grossProfit >= 0 ? 'positive' : 'negative'}">${money(pnl.grossProfit)}</strong></td></tr>
      <tr><td class="name muted">7. Chi phí hủy hàng & Hao hụt (Write-off Loss)</td><td>Hàng hết date hủy bỏ + Hao hụt kho + Hàng trả hỏng</td><td class="money right negative">-${money(pnl.totalLoss)}</td></tr>
      <tr><td class="name muted">8. Khoản thu hồi bồi hoàn trách nhiệm</td><td>Tiền bồi hoàn từ nhân viên chịu trách nhiệm hao hụt</td><td class="money right positive">+${money(pnl.staffCompensation)}</td></tr>
      <tr style="background:var(--bg-subtle,#f8fafc);font-size:1.1em"><td class="name"><strong>9. LỢI NHUẬN RÒNG (NET PROFIT)</strong></td><td><strong>Lợi nhuận thực tế cuối cùng (6 - 7 + 8)</strong></td><td class="money right"><strong class="${pnl.netProfit >= 0 ? 'positive' : 'negative'}" style="font-size:1.2em">${money(pnl.netProfit)}</strong></td></tr>
    </tbody></table></div></section>`
    : '';

  return (
    heading(
      'THỐNG KÊ / DOANH THU',
      'Báo cáo kinh doanh & Lãi lỗ (P&L)',
      'Tổng hợp doanh thu, giá vốn, chi phí hao hụt hàng hóa và lợi nhuận thực tế.',
      action('export-report', 'Xuất báo cáo CSV', 'download', 'primary'),
    ) +
    `<div class="row mb16"><span class="muted">Kỳ báo cáo</span><select id="report-period" style="width:140px">${[1, 7, 30, 90].map((n) => `<option value="${n}" ${n === reportDays ? 'selected' : ''}>${n === 1 ? 'Hôm nay' : n + ' ngày gần nhất'}</option>`).join('')}</select><span class="sub">Doanh thu từ hóa đơn đã thanh toán · Hoàn tiền theo ngày xử lý</span></div>` +
    stats([
      ['Doanh thu gộp', money(pnl ? pnl.grossRevenue : p.gross), `${reportDays} ngày gần nhất`, 'receipt'],
      ['Giá vốn COGS', money(pnl ? pnl.cogs : 0), 'Giá gốc hàng đã bán', 'box'],
      ['Chi phí hủy & hao hụt', money(pnl ? pnl.totalLoss : 0), 'Hết date & mất mát', 'trash'],
      ['Lợi nhuận ròng', money(pnl ? pnl.netProfit : (p.gross - p.refund)), pnl && pnl.netProfit >= 0 ? 'Đang có lãi' : 'Cần tối ưu chi phí', 'chart'],
    ]) +
    pnlHTML +
    `<div class="dashboard-grid"><section class="panel"><div class="panel-head"><div><h2>Biểu đồ doanh thu</h2><p class="sub">Doanh thu gộp theo ngày · Đơn vị nghìn đồng</p></div></div><div class="panel-body">${lineChart(reportDays === 1 ? 7 : reportDays)}</div></section><section class="panel"><div class="panel-head"><h2>Danh mục bán chạy</h2></div><div class="panel-body">${
      categories
        .slice(0, 6)
        .map(
          ([label, value]) =>
            `<div class="progress-row"><div class="between"><strong>${e(label)}</strong><span class="muted">${p.gross ? Math.round((value / p.gross) * 100) : 0}%</span></div><div class="progress"><div style="width:${(value / highest) * 100}%"></div></div></div>`,
        )
        .join('') || empty()
    }</div></section></div><section class="panel"><div class="panel-head"><h2>Doanh thu theo phương thức thanh toán</h2></div>${table(
      [
        'Phương thức',
        'Số giao dịch',
        'Tổng thu trong kỳ',
        'Tiền hoàn trong kỳ',
        'Chênh lệch thu hoàn',
      ],
      Object.entries(METHODS).map(([key, label]) => {
        const orders = p.orders.filter((o) => o.payment === key);
        const gross = orders.reduce((a, o) => a + o.total, 0),
          refund = p.refunds.filter((r) => r.payment === key).reduce((a, r) => a + r.amount, 0);
        return `<tr><td class="name">${label}</td><td>${orders.length}</td><td class="money">${money(gross)}</td><td class="money negative">${money(refund)}</td><td class="money name">${money(gross - refund)}</td></tr>`;
      }),
    )}</section>`
  );
}
