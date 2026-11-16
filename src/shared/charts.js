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
    left + (i * w) / (points.length - 1),
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
