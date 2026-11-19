/* SVG charts for Dashboard & Financial Reports (M5 SQLite API + legacy helpers preserved). */
'use strict';

function periodData(days) {
  const start = new Date();
  start.setDate(start.getDate() - days + 1);
  start.setHours(0, 0, 0, 0);
  const orders = store.data.orders.filter(
    (o) => o.status !== 'cancelled' && dayKey(o.time) >= dayKey(start),
  );
  const refunds = store.data.returns.filter(
    (r) => r.status === 'approved' && dayKey(r.resolvedAt) >= dayKey(start),
  );
  return {
    orders,
    refunds,
    gross: orders.reduce((s, o) => s + o.total, 0),
    refund: refunds.reduce((s, r) => s + r.amount, 0),
  };
}

function lineChart(days = 7) {
  const points = [];
  for (let n = days - 1; n >= 0; n--) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    const key = dayKey(d);
    points.push({
      label: d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }),
      value: store.data.orders
        .filter((o) => o.status !== 'cancelled' && dayKey(o.time) === key)
        .reduce((s, o) => s + o.total, 0),
    });
  }
  const max = Math.max(...points.map((p) => p.value), 100000),
    top = 30,
    left = 48,
    w = 620,
    h = 175;
  const coordinates = points.map((p, i) => [
    left + (i * w) / Math.max(1, points.length - 1),
    top + h - (p.value / max) * h,
  ]);
  const path = coordinates.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join(' ');
  return `<svg class="chart" viewBox="0 0 700 245" role="img" aria-label="Biểu đồ doanh thu ${days} ngày"><defs><linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#7770df" stop-opacity=".2"/><stop offset="100%" stop-color="#7770df" stop-opacity="0"/></linearGradient></defs>${[
    0, 1, 2, 3,
  ]
    .map((i) => {
      const y = top + (i * h) / 3;
      return `<path class="chart-grid" d="M${left} ${y}H680"/><text x="0" y="${y + 4}" class="chart-label">${number(Math.round((max * (1 - i / 3)) / 1000))}k</text>`;
    })
    .join(
      '',
    )}<path d="${path}L${left + w},${top + h}H${left}Z" fill="url(#chart-fill)"/><path d="${path}" fill="none" stroke="#7971db" stroke-width="2.5" stroke-linejoin="round"/>${coordinates.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${days === 7 ? 3.5 : 2}" fill="#7971db" stroke="white" stroke-width="1.7"><title>${points[i].label}: ${money(points[i].value)}</title></circle>`).join('')}${points.map((p, i) => (i % Math.ceil(days / 7) === 0 ? `<text x="${coordinates[i][0]}" y="231" class="chart-label" text-anchor="middle">${p.label}</text>` : '')).join('')}</svg>`;
}

/**
 * M5: Biểu đồ SVG Xu hướng Doanh thu ròng & Lợi nhuận gộp từ dữ liệu SQLite (hỗ trợ gom theo ngày hoặc tháng).
 */
function revenueTrendChart(series = [], { showProfit = true, ariaLabel = 'Biểu đồ doanh thu ròng và lợi nhuận gộp' } = {}) {
  if (!Array.isArray(series) || !series.length) {
    return empty('Chưa có dữ liệu doanh thu trong kỳ', 'Thử mở rộng khoảng thời gian lọc để xem xu hướng.', 'chart');
  }
  const values = series.flatMap((p) =>
    showProfit ? [Math.max(0, Number(p.netRevenue) || 0), Math.max(0, Number(p.grossProfit) || 0)] : [Math.max(0, Number(p.netRevenue) || 0)],
  );
  const maxVal = Math.max(...values, 100000);
  const top = 34;
  const left = 56;
  const w = 616;
  const h = 172;
  const baseY = top + h;
  const n = series.length;
  const gradId = `rev-grad-${n}-${showProfit ? 'p' : 'r'}`;

  const xAt = (i) => (n === 1 ? left + w / 2 : left + (i * w) / (n - 1));
  const yAt = (v) => baseY - (Math.max(0, Number(v) || 0) / maxVal) * h;

  const revCoords = series.map((p, i) => [xAt(i), yAt(p.netRevenue)]);
  const profCoords = series.map((p, i) => [xAt(i), yAt(p.grossProfit)]);
  const revPath = revCoords.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const profPath = profCoords.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const labelStep = Math.max(1, Math.ceil(n / 7));

  const areaSVG =
    n > 1
      ? `<path d="${revPath}L${revCoords[n - 1][0].toFixed(1)},${baseY}H${revCoords[0][0].toFixed(1)}Z" fill="url(#${gradId})"/>`
      : `<rect x="${(revCoords[0][0] - 24).toFixed(1)}" y="${revCoords[0][1].toFixed(1)}" width="48" height="${Math.max(2, baseY - revCoords[0][1]).toFixed(1)}" rx="6" fill="url(#${gradId})" stroke="#5b54d6" stroke-width="1.5"/>`;

  const linesSVG =
    n > 1
      ? `<path d="${revPath}" fill="none" stroke="#5b54d6" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>${
          showProfit
            ? `<path d="${profPath}" fill="none" stroke="#16a394" stroke-width="2.2" stroke-dasharray="5 3" stroke-linejoin="round" stroke-linecap="round"/>`
            : ''
        }`
      : '';

  const legendSVG = `<g transform="translate(410, 12)">
    <rect x="0" y="0" width="12" height="4" rx="2" fill="#5b54d6"/><text x="17" y="5" class="chart-label">Doanh thu ròng</text>
    ${showProfit ? '<rect x="122" y="0" width="12" height="4" rx="2" fill="#16a394"/><text x="139" y="5" class="chart-label">Lợi nhuận gộp</text>' : ''}
  </g>`;

  const gridSVG = [0, 1, 2, 3]
    .map((i) => {
      const y = top + (i * h) / 3;
      const tick = Math.round((maxVal * (1 - i / 3)) / 1000);
      return `<path class="chart-grid" d="M${left} ${y.toFixed(1)}H680"/><text x="0" y="${(y + 4).toFixed(1)}" class="chart-label">${number(tick)}k</text>`;
    })
    .join('');

  const dotRadius = n <= 12 ? 3.8 : 2.3;
  const dotsSVG = revCoords
    .map(([x, y], i) => {
      const p = series[i];
      const tip = `${p.label} · ${number(p.orderCount)} đơn · DT ròng: ${money(p.netRevenue)} · LN gộp: ${money(p.grossProfit)}`;
      const profDot = showProfit
        ? `<circle cx="${profCoords[i][0].toFixed(1)}" cy="${profCoords[i][1].toFixed(1)}" r="${Math.max(2, dotRadius - 0.6)}" fill="#16a394" stroke="#fff" stroke-width="1.4"><title>${e(tip)}</title></circle>`
        : '';
      return `${profDot}<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${dotRadius}" fill="#5b54d6" stroke="#fff" stroke-width="1.6"><title>${e(tip)}</title></circle>`;
    })
    .join('');

  const xLabelsSVG = series
    .map((p, i) =>
      i % labelStep === 0 || i === n - 1
        ? `<text x="${xAt(i).toFixed(1)}" y="232" class="chart-label" text-anchor="middle">${e(p.label)}</text>`
        : '',
    )
    .join('');

  return `<svg class="chart" viewBox="0 0 700 248" role="img" aria-label="${e(ariaLabel)}">
    <defs>
      <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#5b54d6" stop-opacity=".22"/>
        <stop offset="100%" stop-color="#5b54d6" stop-opacity="0"/>
      </linearGradient>
    </defs>
    ${legendSVG}
    ${gridSVG}
    ${areaSVG}
    ${linesSVG}
    ${dotsSVG}
    ${xLabelsSVG}
  </svg>`;
}

/**
 * M5: Biểu đồ thanh ngang cơ cấu doanh thu ròng theo Danh mục (từ SQLite).
 */
function categoryBarChart(categories = []) {
  if (!Array.isArray(categories) || !categories.length) {
    return empty('Chưa có doanh thu theo danh mục', 'Chưa có đơn hàng đã thanh toán khớp bộ lọc.', 'box');
  }
  const highest = Math.max(...categories.map((c) => Math.max(0, Number(c.netRevenue) || 0)), 1);
  return categories
    .slice(0, 8)
    .map((c) => {
      const pctWidth = Math.max(2, Math.min(100, Math.round((Math.max(0, c.netRevenue) / highest) * 100)));
      return `<div class="progress-row">
        <div class="between">
          <strong>${e(c.categoryName)} <small class="muted">(${number(c.netQty)} đv)</small></strong>
          <span class="money">${money(c.netRevenue)} <small class="muted">(${c.sharePct}%)</small></span>
        </div>
        <div class="progress"><div style="width:${pctWidth}%"></div></div>
      </div>`;
    })
    .join('');
}
