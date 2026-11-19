/* Interactive offline Chart.js v4.6.1 visualizations for Dashboard & Financial Reports (BR-08). */
'use strict';

const _chartInstances = new Map();
let _pendingChartConfigs = [];

function destroyAllCharts() {
  for (const inst of _chartInstances.values()) {
    try {
      inst.destroy();
    } catch {
      // ignore destroy errors
    }
  }
  _chartInstances.clear();
}

function resetPendingCharts() {
  _pendingChartConfigs = [];
}

function mountCharts() {
  destroyAllCharts();
  const pending = _pendingChartConfigs;
  _pendingChartConfigs = [];
  if (typeof window === 'undefined' || typeof window.Chart !== 'function') return;

  window.Chart.defaults.font.family = "'Be Vietnam Pro', system-ui, -apple-system, sans-serif";
  window.Chart.defaults.color = '#64748b';

  for (const spec of pending) {
    const canvas = document.getElementById(spec.id);
    if (!canvas) continue;
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    const config = typeof spec.build === 'function' ? spec.build(ctx) : spec.config;
    if (!config) continue;
    try {
      const chart = new window.Chart(ctx, config);
      _chartInstances.set(spec.id, chart);
    } catch {
      // fail gracefully without disrupting view
    }
  }
}

/**
 * Biểu đồ đường + vùng tương tác (Chart.js): Xu hướng Doanh thu thuần trước VAT & Lợi nhuận gộp.
 */
function revenueTrendChart(
  series = [],
  { showProfit = true, ariaLabel = 'Biểu đồ doanh thu thuần trước VAT và lợi nhuận gộp', id = '' } = {},
) {
  if (!Array.isArray(series) || !series.length) {
    return empty('Chưa có dữ liệu doanh thu trong kỳ', 'Thử mở rộng khoảng thời gian lọc để xem xu hướng.', 'chart');
  }

  const canvasId = id || `rf-trend-${_pendingChartConfigs.length + 1}`;
  const labels = series.map((p) => p.label);
  const netRevenueData = series.map((p) => Math.max(0, Number(p.netRevenuePreTax ?? p.netRevenue) || 0));
  const grossProfitData = series.map((p) => Math.max(0, Number(p.grossProfit) || 0));
  const isSinglePoint = series.length === 1;

  _pendingChartConfigs.push({
    id: canvasId,
    build(ctx) {
      const gradIndigo = ctx.createLinearGradient(0, 0, 0, 260);
      gradIndigo.addColorStop(0, 'rgba(79, 70, 229, 0.22)');
      gradIndigo.addColorStop(1, 'rgba(79, 70, 229, 0.0)');

      const gradTeal = ctx.createLinearGradient(0, 0, 0, 260);
      gradTeal.addColorStop(0, 'rgba(13, 148, 136, 0.16)');
      gradTeal.addColorStop(1, 'rgba(13, 148, 136, 0.0)');

      const datasets = [
        {
          label: 'Doanh thu thuần (trước VAT)',
          data: netRevenueData,
          borderColor: '#4f46e5',
          backgroundColor: isSinglePoint ? 'rgba(79, 70, 229, 0.78)' : gradIndigo,
          borderWidth: 2.4,
          fill: !isSinglePoint,
          tension: 0.32,
          pointRadius: series.length <= 14 ? 4 : 2.5,
          pointHoverRadius: 6,
          pointBackgroundColor: '#4f46e5',
          pointBorderColor: '#ffffff',
          pointBorderWidth: 2,
          borderRadius: isSinglePoint ? 8 : 0,
        },
      ];

      if (showProfit) {
        datasets.push({
          label: 'Lợi nhuận gộp',
          data: grossProfitData,
          borderColor: '#0d9488',
          backgroundColor: isSinglePoint ? 'rgba(13, 148, 136, 0.78)' : gradTeal,
          borderWidth: 2.2,
          borderDash: isSinglePoint ? [] : [5, 4],
          fill: !isSinglePoint,
          tension: 0.32,
          pointRadius: series.length <= 14 ? 3.5 : 2,
          pointHoverRadius: 5.5,
          pointBackgroundColor: '#0d9488',
          pointBorderColor: '#ffffff',
          pointBorderWidth: 1.8,
          borderRadius: isSinglePoint ? 8 : 0,
        });
      }

      return {
        type: isSinglePoint ? 'bar' : 'line',
        data: { labels, datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: {
              display: true,
              position: 'top',
              align: 'end',
              labels: {
                usePointStyle: true,
                pointStyle: 'circle',
                boxWidth: 8,
                boxHeight: 8,
                padding: 16,
                font: { size: 12, weight: '600' },
                color: '#334155',
              },
            },
            tooltip: {
              backgroundColor: '#0f172a',
              titleColor: '#f8fafc',
              bodyColor: '#e2e8f0',
              borderColor: 'rgba(148, 163, 184, 0.25)',
              borderWidth: 1,
              padding: 12,
              cornerRadius: 10,
              displayColors: true,
              boxPadding: 5,
              callbacks: {
                title(items) {
                  const idx = items[0]?.dataIndex ?? 0;
                  const pt = series[idx];
                  return pt ? `${pt.label} · ${number(pt.orderCount || 0)} hóa đơn` : '';
                },
                label(item) {
                  return ` ${item.dataset.label}: ${money(item.parsed.y)}`;
                },
              },
            },
          },
          scales: {
            x: {
              grid: { display: false },
              border: { display: false },
              ticks: {
                color: '#64748b',
                font: { size: 11.5 },
                maxRotation: 0,
                autoSkip: true,
                maxTicksLimit: 8,
              },
            },
            y: {
              beginAtZero: true,
              border: { display: false },
              grid: { color: '#eef2f7' },
              ticks: {
                color: '#64748b',
                font: { size: 11.5 },
                maxTicksLimit: 5,
                callback(val) {
                  const num = Number(val) || 0;
                  if (num >= 1000000) return `${(num / 1000000).toFixed(num % 1000000 === 0 ? 0 : 1)}tr`;
                  if (num >= 1000) return `${Math.round(num / 1000)}k`;
                  return String(num);
                },
              },
            },
          },
        },
      };
    },
  });

  return `<div class="chart-canvas-wrap chart-trend-wrap">
    <canvas id="${canvasId}" role="img" aria-label="${e(ariaLabel)}"></canvas>
  </div>`;
}

/**
 * Biểu đồ Doughnut tương tác (Chart.js): Cơ cấu thanh toán theo tổng thu ròng gồm VAT.
 */
function paymentDonutChart(methods = [], orderCount = 0, { id = '' } = {}) {
  if (!Array.isArray(methods) || !methods.length) {
    return empty('Chưa có giao dịch thanh toán', 'Số liệu sẽ hiển thị sau khi phát sinh hóa đơn.', 'card');
  }
  const canvasId = id || `rf-donut-${_pendingChartConfigs.length + 1}`;
  const payColors = { CASH: '#4f46e5', VIETQR: '#0d9488', CARD: '#f59e0b' };
  const enriched = methods.map((m) => ({
    ...m,
    color: m.color || payColors[m.method] || '#64748b',
    value: Math.max(0, Number(m.netCollected ?? m.netRevenue) || 0),
  }));
  const hasPositive = enriched.some((m) => m.value > 0);

  _pendingChartConfigs.push({
    id: canvasId,
    config: {
      type: 'doughnut',
      data: {
        labels: enriched.map((m) => m.label),
        datasets: [
          {
            data: hasPositive ? enriched.map((m) => m.value) : [1],
            backgroundColor: hasPositive ? enriched.map((m) => m.color) : ['#e2e8f0'],
            borderColor: '#ffffff',
            borderWidth: 3,
            hoverOffset: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '68%',
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: hasPositive,
            backgroundColor: '#0f172a',
            titleColor: '#f8fafc',
            bodyColor: '#e2e8f0',
            padding: 10,
            cornerRadius: 9,
            callbacks: {
              label(ctx) {
                const m = enriched[ctx.dataIndex];
                if (!m) return '';
                return ` ${m.label}: ${money(m.value)} (${m.sharePct}% · ${number(m.orderCount)} đơn)`;
              },
            },
          },
        },
      },
    },
  });

  return `<div class="donut-wrap">
    <div class="donut-canvas-box">
      <canvas id="${canvasId}" role="img" aria-label="Biểu đồ cơ cấu phương thức thanh toán"></canvas>
      <div class="donut-center-overlay">
        <b class="money">${number(orderCount)}</b>
        <small>hóa đơn</small>
      </div>
    </div>
    <div class="legend">
      ${enriched
        .map(
          (m) => `<div>
            <i class="dot" style="color:${m.color}"></i>
            <span>${e(m.label)} <small class="muted">(${number(m.orderCount)} đơn)</small></span>
            <strong class="money">${money(m.value)} <small class="muted">(${m.sharePct}%)</small></strong>
          </div>`,
        )
        .join('')}
    </div>
  </div>`;
}

/**
 * Biểu đồ cột ngang tương tác (Chart.js): Cơ cấu doanh thu thuần trước VAT theo Danh mục.
 */
function categoryBarChart(categories = [], { id = '' } = {}) {
  if (!Array.isArray(categories) || !categories.length) {
    return empty('Chưa có doanh thu theo danh mục', 'Chưa có đơn hàng đã thanh toán khớp bộ lọc.', 'box');
  }
  const topCats = categories.slice(0, 8);
  const canvasId = id || `rf-catbar-${_pendingChartConfigs.length + 1}`;
  const palette = ['#4f46e5', '#0d9488', '#0284c7', '#7c3aed', '#d97706', '#059669', '#e11d48', '#475569'];

  _pendingChartConfigs.push({
    id: canvasId,
    config: {
      type: 'bar',
      data: {
        labels: topCats.map((c) => c.categoryName),
        datasets: [
          {
            label: 'DT thuần (trước VAT)',
            data: topCats.map((c) => Math.max(0, Number(c.netRevenuePreTax ?? c.netRevenue) || 0)),
            backgroundColor: topCats.map((_, idx) => palette[idx % palette.length]),
            borderRadius: 6,
            barThickness: 18,
            maxBarThickness: 22,
          },
        ],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#0f172a',
            titleColor: '#f8fafc',
            bodyColor: '#e2e8f0',
            padding: 11,
            cornerRadius: 9,
            callbacks: {
              label(ctx) {
                const c = topCats[ctx.dataIndex];
                if (!c) return '';
                return [
                  ` DT thuần: ${money(c.netRevenuePreTax ?? c.netRevenue)} (${c.sharePct}%)`,
                  ` Lợi nhuận gộp: ${money(c.grossProfit)} · SL ròng: ${number(c.netQty)} đv`,
                ];
              },
            },
          },
        },
        scales: {
          x: {
            beginAtZero: true,
            border: { display: false },
            grid: { color: '#eef2f7' },
            ticks: {
              color: '#64748b',
              font: { size: 11 },
              maxTicksLimit: 5,
              callback(val) {
                const num = Number(val) || 0;
                if (num >= 1000000) return `${(num / 1000000).toFixed(num % 1000000 === 0 ? 0 : 1)}tr`;
                if (num >= 1000) return `${Math.round(num / 1000)}k`;
                return String(num);
              },
            },
          },
          y: {
            border: { display: false },
            grid: { display: false },
            ticks: {
              color: '#334155',
              font: { size: 12, weight: '500' },
            },
          },
        },
      },
    },
  });

  const dynamicHeight = Math.max(220, topCats.length * 36 + 32);
  return `<div class="chart-canvas-wrap" style="height:${dynamicHeight}px">
    <canvas id="${canvasId}" role="img" aria-label="Biểu đồ cơ cấu doanh thu thuần theo danh mục"></canvas>
  </div>`;
}
