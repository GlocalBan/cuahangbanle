'use strict';
const { assertRule } = require('./errors.js');

const PAID_STATUSES = new Set(['DaThanhToan', 'TraMotPhan', 'DaHoanTra']);

const PAYMENT_METHOD_LABELS = {
  CASH: 'Tiền mặt',
  VIETQR: 'Chuyển khoản / VietQR',
  CARD: 'Thẻ ngân hàng',
};

function isoDateKey(d = new Date()) {
  return new Date(d).toISOString().slice(0, 10);
}

function isValidCalendarYmd(ymd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function validateReportDateRange(fromDate, toDate) {
  if (fromDate) {
    assertRule(isValidCalendarYmd(fromDate), 'Định dạng "Từ ngày" không hợp lệ (YYYY-MM-DD) (BR-08).', 400);
  }
  if (toDate) {
    assertRule(isValidCalendarYmd(toDate), 'Định dạng "Đến ngày" không hợp lệ (YYYY-MM-DD) (BR-08).', 400);
  }
  if (fromDate && toDate && fromDate > toDate) {
    assertRule(
      false,
      'Khoảng thời gian không hợp lệ: "Từ ngày" phải nhỏ hơn hoặc bằng "Đến ngày" (BR-08).',
      400,
    );
  }
}

function addUtcDays(ymd, deltaDays) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return dt.toISOString().slice(0, 10);
}

function diffUtcDays(fromYmd, toYmd) {
  const [y1, m1, d1] = fromYmd.split('-').map(Number);
  const [y2, m2, d2] = toYmd.split('-').map(Number);
  const t1 = Date.UTC(y1, m1 - 1, d1);
  const t2 = Date.UTC(y2, m2 - 1, d2);
  return Math.round((t2 - t1) / 86400000);
}

function formatDayLabel(ymd) {
  const [, m, d] = ymd.split('-');
  return `${d}/${m}`;
}

function formatMonthLabel(ym) {
  const [y, m] = ym.split('-');
  return `Th${m}/${y}`;
}

/**
 * Phân bổ tổng tiền thực thu (đã gồm giảm giá & VAT) của từng hóa đơn về từng dòng hàng chính xác đến từng đồng.
 * Tổng các dòng trong 1 hóa đơn luôn bằng chính xác order.total_amount.
 */
function allocateOrderItemRevenues(orderItems = []) {
  const byOrder = new Map();
  for (const oi of orderItems) {
    if (!byOrder.has(oi.order_id)) byOrder.set(oi.order_id, []);
    byOrder.get(oi.order_id).push(oi);
  }
  const allocatedMap = new Map();
  for (const items of byOrder.values()) {
    const orderTotal = Math.max(0, Number(items[0].order_total_amount) || 0);
    const bases = items.map((i) =>
      Math.max(0, (Number(i.qty) || 0) * (Number(i.unit_price_snapshot) || 0) - (Number(i.line_discount) || 0)),
    );
    const baseSum = bases.reduce((s, v) => s + v, 0);
    let used = 0;
    items.forEach((item, idx) => {
      let paid = 0;
      if (idx === items.length - 1) {
        paid = Math.max(0, orderTotal - used);
      } else if (baseSum > 0) {
        paid = Math.floor((orderTotal * bases[idx]) / baseSum);
      }
      used += paid;
      allocatedMap.set(item.id ?? `${item.order_id}:${item.product_id}`, paid);
    });
  }
  return allocatedMap;
}

/**
 * BR-08 (Pure function — có thể kiểm thử đơn vị độc lập):
 * - DoanhThuGop: tổng total_amount các hóa đơn đã thanh toán (DaThanhToan, TraMotPhan, DaHoanTra), loại trừ nháp/đã hủy.
 * - TienHoanTra: tổng refund_amount các phiếu trả hàng đã xác nhận (DaXacNhan) trong kỳ.
 * - DoanhThuRong = DoanhThuGop - TienHoanTra.
 * - GiaVonHangBan = SUM(oi.qty * oi.unit_cost_snapshot) - SUM(ri.qty * oi.unit_cost_snapshot) (không trừ trùng).
 * - LoiNhuanGop = DoanhThuRong - GiaVonHangBan.
 */
function computeFinancialMetrics({
  orders = [],
  orderItems = [],
  approvedReturns = [],
  approvedReturnItems = [],
  categoryCode = '',
  fromDate = '',
  toDate = '',
  groupBy = 'day',
} = {}) {
  const cleanCat = String(categoryCode || '').trim();
  const safeGroupBy = groupBy === 'month' ? 'month' : 'day';

  // Strictly exclude drafts/cancelled orders and non-approved returns
  const paidOrders = orders.filter((o) => PAID_STATUSES.has(o.status));
  const paidOrderIds = new Set(paidOrders.map((o) => o.id));
  const validOrderItems = orderItems.filter((oi) => paidOrderIds.has(oi.order_id));
  const validReturns = approvedReturns.filter((r) => r.status === 'DaXacNhan');
  const validReturnIds = new Set(validReturns.map((r) => r.id));
  const validReturnItems = approvedReturnItems.filter((ri) => validReturnIds.has(ri.return_id));

  // Allocate paid revenue to every order item so category & product breakdowns reconcile exactly to total_amount
  const itemRevenueMap = allocateOrderItemRevenues(validOrderItems);

  const filteredOrderItems = cleanCat
    ? validOrderItems.filter((oi) => oi.category_code === cleanCat)
    : validOrderItems;
  const filteredReturnItems = cleanCat
    ? validReturnItems.filter((ri) => ri.category_code === cleanCat)
    : validReturnItems;

  const filteredOrderIds = new Set(filteredOrderItems.map((oi) => oi.order_id));
  const filteredReturnIds = new Set(filteredReturnItems.map((ri) => ri.return_id));

  let grossRevenue = 0;
  let refundTotal = 0;
  let totalSubtotal = 0;
  let totalLineDiscount = 0;
  let totalInvoiceDiscount = 0;
  let totalTax = 0;
  let orderCount = 0;
  let returnCount = 0;

  if (!cleanCat) {
    orderCount = paidOrders.length;
    returnCount = validReturns.length;
    for (const o of paidOrders) {
      grossRevenue += Number(o.total_amount) || 0;
      totalSubtotal += Number(o.subtotal) || 0;
      totalInvoiceDiscount += Number(o.invoice_discount) || 0;
      totalTax += Number(o.tax_amount) || 0;
    }
    for (const oi of validOrderItems) {
      totalLineDiscount += Number(oi.line_discount) || 0;
    }
    for (const r of validReturns) {
      refundTotal += Number(r.refund_amount) || 0;
    }
  } else {
    orderCount = filteredOrderIds.size;
    returnCount = filteredReturnIds.size;
    for (const oi of filteredOrderItems) {
      const key = oi.id ?? `${oi.order_id}:${oi.product_id}`;
      const lineRev = itemRevenueMap.get(key) || 0;
      const lineDisc = Number(oi.line_discount) || 0;
      const lineNetBase = Math.max(0, (Number(oi.qty) || 0) * (Number(oi.unit_price_snapshot) || 0) - lineDisc);
      grossRevenue += lineRev;
      totalSubtotal += lineNetBase;
      totalLineDiscount += lineDisc;
    }
    for (const ri of filteredReturnItems) {
      refundTotal += Number(ri.refund_line_amount) || 0;
    }
  }

  let grossCogs = 0;
  let soldQtyTotal = 0;
  for (const oi of filteredOrderItems) {
    const qty = Number(oi.qty) || 0;
    const cost = Number(oi.unit_cost_snapshot) || 0;
    grossCogs += qty * cost;
    soldQtyTotal += qty;
  }

  let returnedCogs = 0;
  let returnedQtyTotal = 0;
  for (const ri of filteredReturnItems) {
    const qty = Number(ri.qty) || 0;
    const cost = Number(ri.unit_cost_snapshot) || 0;
    returnedCogs += qty * cost;
    returnedQtyTotal += qty;
  }

  const netRevenue = grossRevenue - refundTotal;
  const netCogs = grossCogs - returnedCogs;
  const grossProfit = netRevenue - netCogs;
  const grossMarginPct = netRevenue > 0 ? Math.round((grossProfit / netRevenue) * 1000) / 10 : 0;
  const avgOrderValue = orderCount > 0 ? Math.round(grossRevenue / orderCount) : 0;

  // ── Time Series (Daily or Monthly) ─────────────────────────────────────────
  const bucketMap = new Map();
  const ensureBucket = (key) => {
    if (!bucketMap.has(key)) {
      bucketMap.set(key, {
        key,
        label: safeGroupBy === 'month' ? formatMonthLabel(key) : formatDayLabel(key),
        orderIds: new Set(),
        grossRevenue: 0,
        refundTotal: 0,
        grossCogs: 0,
        returnedCogs: 0,
      });
    }
    return bucketMap.get(key);
  };

  if (fromDate && toDate) {
    if (safeGroupBy === 'day') {
      const span = diffUtcDays(fromDate, toDate);
      if (span >= 0 && span <= 90) {
        for (let i = 0; i <= span; i++) {
          ensureBucket(addUtcDays(fromDate, i));
        }
      }
    } else {
      let [y, m] = fromDate.slice(0, 7).split('-').map(Number);
      const endYm = toDate.slice(0, 7);
      let guard = 0;
      while (`${y}-${String(m).padStart(2, '0')}` <= endYm && guard < 36) {
        ensureBucket(`${y}-${String(m).padStart(2, '0')}`);
        m += 1;
        if (m > 12) {
          m = 1;
          y += 1;
        }
        guard += 1;
      }
    }
  }

  const bucketKeyOf = (iso) => (safeGroupBy === 'month' ? String(iso || '').slice(0, 7) : String(iso || '').slice(0, 10));

  if (!cleanCat) {
    for (const o of paidOrders) {
      const b = ensureBucket(bucketKeyOf(o.created_at));
      b.orderIds.add(o.id);
      b.grossRevenue += Number(o.total_amount) || 0;
    }
    for (const oi of validOrderItems) {
      const b = ensureBucket(bucketKeyOf(oi.order_created_at));
      b.grossCogs += (Number(oi.qty) || 0) * (Number(oi.unit_cost_snapshot) || 0);
    }
    for (const r of validReturns) {
      const b = ensureBucket(bucketKeyOf(r.effective_at || r.resolved_at || r.created_at));
      b.refundTotal += Number(r.refund_amount) || 0;
    }
    for (const ri of validReturnItems) {
      const b = ensureBucket(bucketKeyOf(ri.effective_at));
      b.returnedCogs += (Number(ri.qty) || 0) * (Number(ri.unit_cost_snapshot) || 0);
    }
  } else {
    for (const oi of filteredOrderItems) {
      const b = ensureBucket(bucketKeyOf(oi.order_created_at));
      const key = oi.id ?? `${oi.order_id}:${oi.product_id}`;
      b.orderIds.add(oi.order_id);
      b.grossRevenue += itemRevenueMap.get(key) || 0;
      b.grossCogs += (Number(oi.qty) || 0) * (Number(oi.unit_cost_snapshot) || 0);
    }
    for (const ri of filteredReturnItems) {
      const b = ensureBucket(bucketKeyOf(ri.effective_at));
      b.refundTotal += Number(ri.refund_line_amount) || 0;
      b.returnedCogs += (Number(ri.qty) || 0) * (Number(ri.unit_cost_snapshot) || 0);
    }
  }

  const series = [...bucketMap.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((b) => {
      const bNetRev = b.grossRevenue - b.refundTotal;
      const bNetCogs = b.grossCogs - b.returnedCogs;
      return {
        key: b.key,
        label: b.label,
        orderCount: b.orderIds.size,
        grossRevenue: b.grossRevenue,
        refundTotal: b.refundTotal,
        netRevenue: bNetRev,
        netCogs: bNetCogs,
        grossProfit: bNetRev - bNetCogs,
      };
    });

  // ── Category Breakdown ─────────────────────────────────────────────────────
  const catMap = new Map();
  const ensureCat = (code, name) => {
    if (!catMap.has(code)) {
      catMap.set(code, {
        categoryCode: code,
        categoryName: name || code,
        soldQty: 0,
        returnedQty: 0,
        grossRevenue: 0,
        refundTotal: 0,
        grossCogs: 0,
        returnedCogs: 0,
      });
    }
    return catMap.get(code);
  };

  for (const oi of filteredOrderItems) {
    const c = ensureCat(oi.category_code, oi.category_name);
    const key = oi.id ?? `${oi.order_id}:${oi.product_id}`;
    const qty = Number(oi.qty) || 0;
    c.soldQty += qty;
    c.grossRevenue += itemRevenueMap.get(key) || 0;
    c.grossCogs += qty * (Number(oi.unit_cost_snapshot) || 0);
  }
  for (const ri of filteredReturnItems) {
    const c = ensureCat(ri.category_code, ri.category_name);
    const qty = Number(ri.qty) || 0;
    c.returnedQty += qty;
    c.refundTotal += Number(ri.refund_line_amount) || 0;
    c.returnedCogs += qty * (Number(ri.unit_cost_snapshot) || 0);
  }

  const categoryBreakdown = [...catMap.values()]
    .map((c) => {
      const cNetRev = c.grossRevenue - c.refundTotal;
      const cNetCogs = c.grossCogs - c.returnedCogs;
      const cProfit = cNetRev - cNetCogs;
      return {
        categoryCode: c.categoryCode,
        categoryName: c.categoryName,
        soldQty: c.soldQty,
        returnedQty: c.returnedQty,
        netQty: c.soldQty - c.returnedQty,
        grossRevenue: c.grossRevenue,
        refundTotal: c.refundTotal,
        netRevenue: cNetRev,
        netCogs: cNetCogs,
        grossProfit: cProfit,
        sharePct: netRevenue > 0 ? Math.round((cNetRev / netRevenue) * 1000) / 10 : 0,
      };
    })
    .sort((a, b) => b.netRevenue - a.netRevenue);

  // ── Payment Method Breakdown ───────────────────────────────────────────────
  const payMap = new Map(
    ['CASH', 'VIETQR', 'CARD'].map((code) => [
      code,
      {
        method: code,
        label: PAYMENT_METHOD_LABELS[code],
        orderIds: new Set(),
        grossRevenue: 0,
        refundTotal: 0,
      },
    ]),
  );

  if (!cleanCat) {
    for (const o of paidOrders) {
      const p = payMap.get(o.payment_method) || payMap.get('CASH');
      p.orderIds.add(o.id);
      p.grossRevenue += Number(o.total_amount) || 0;
    }
    for (const r of validReturns) {
      const p = payMap.get(r.payment_method) || payMap.get('CASH');
      p.refundTotal += Number(r.refund_amount) || 0;
    }
  } else {
    for (const oi of filteredOrderItems) {
      const p = payMap.get(oi.payment_method) || payMap.get('CASH');
      const key = oi.id ?? `${oi.order_id}:${oi.product_id}`;
      p.orderIds.add(oi.order_id);
      p.grossRevenue += itemRevenueMap.get(key) || 0;
    }
    for (const ri of filteredReturnItems) {
      const p = payMap.get(ri.payment_method) || payMap.get('CASH');
      p.refundTotal += Number(ri.refund_line_amount) || 0;
    }
  }

  const paymentBreakdown = [...payMap.values()].map((p) => {
    const pNet = p.grossRevenue - p.refundTotal;
    return {
      method: p.method,
      label: p.label,
      orderCount: p.orderIds.size,
      grossRevenue: p.grossRevenue,
      refundTotal: p.refundTotal,
      netRevenue: pNet,
      sharePct: netRevenue > 0 ? Math.round((pNet / netRevenue) * 1000) / 10 : 0,
    };
  });

  // ── Top Selling Products ───────────────────────────────────────────────────
  const prodMap = new Map();
  const ensureProd = (row) => {
    if (!prodMap.has(row.product_id)) {
      prodMap.set(row.product_id, {
        productId: row.product_id,
        sku: row.sku || row.product_id,
        productName: row.product_name_snapshot || row.product_name || row.product_id,
        categoryCode: row.category_code,
        categoryName: row.category_name,
        unitName: row.unit_name,
        soldQty: 0,
        returnedQty: 0,
        grossRevenue: 0,
        refundTotal: 0,
        grossCogs: 0,
        returnedCogs: 0,
      });
    }
    return prodMap.get(row.product_id);
  };

  for (const oi of filteredOrderItems) {
    const p = ensureProd(oi);
    const key = oi.id ?? `${oi.order_id}:${oi.product_id}`;
    const qty = Number(oi.qty) || 0;
    p.soldQty += qty;
    p.grossRevenue += itemRevenueMap.get(key) || 0;
    p.grossCogs += qty * (Number(oi.unit_cost_snapshot) || 0);
  }
  for (const ri of filteredReturnItems) {
    const p = ensureProd(ri);
    const qty = Number(ri.qty) || 0;
    p.returnedQty += qty;
    p.refundTotal += Number(ri.refund_line_amount) || 0;
    p.returnedCogs += qty * (Number(ri.unit_cost_snapshot) || 0);
  }

  const topProducts = [...prodMap.values()]
    .map((p) => {
      const pNetRev = p.grossRevenue - p.refundTotal;
      const pNetCogs = p.grossCogs - p.returnedCogs;
      return {
        productId: p.productId,
        sku: p.sku,
        productName: p.productName,
        categoryCode: p.categoryCode,
        categoryName: p.categoryName,
        unitName: p.unitName,
        soldQty: p.soldQty,
        returnedQty: p.returnedQty,
        netQty: p.soldQty - p.returnedQty,
        grossRevenue: p.grossRevenue,
        refundTotal: p.refundTotal,
        netRevenue: pNetRev,
        netCogs: pNetCogs,
        grossProfit: pNetRev - pNetCogs,
      };
    })
    .sort((a, b) => b.netRevenue - a.netRevenue || b.netQty - a.netQty);

  return {
    summary: {
      orderCount,
      returnCount,
      soldQtyTotal,
      returnedQtyTotal,
      netQtyTotal: soldQtyTotal - returnedQtyTotal,
      totalSubtotal,
      totalLineDiscount,
      totalInvoiceDiscount,
      totalTax,
      grossRevenue,
      refundTotal,
      netRevenue,
      grossCogs,
      returnedCogs,
      netCogs,
      grossProfit,
      grossMarginPct,
      avgOrderValue,
    },
    series,
    categoryBreakdown,
    paymentBreakdown,
    topProducts,
  };
}

class ReportService {
  constructor(db, repos, systemService) {
    this.db = db;
    this.repos = repos;
    this.systemService = systemService;
  }

  getDashboard({ days = 7, fromDate = '', toDate = '' } = {}) {
    const today = isoDateKey(new Date());
    let rangeFrom = String(fromDate || '').trim();
    let rangeTo = String(toDate || '').trim();
    let safeDays = Number(days) || 7;

    if (rangeFrom || rangeTo) {
      validateReportDateRange(rangeFrom, rangeTo);
      rangeTo = rangeTo || today;
      rangeFrom = rangeFrom || addUtcDays(rangeTo, -(Math.min(90, Math.max(1, safeDays)) - 1));
      safeDays = Math.max(1, diffUtcDays(rangeFrom, rangeTo) + 1);
    } else {
      assertRule(Number.isSafeInteger(safeDays) && safeDays >= 1 && safeDays <= 90, 'Số ngày thống kê phải từ 1 đến 90.', 400);
      rangeTo = today;
      rangeFrom = addUtcDays(today, -(safeDays - 1));
    }

    // Period metrics (7 or 30 days)
    const periodOrders = this.repos.reports.getPaidOrdersInRange({ fromDate: rangeFrom, toDate: rangeTo });
    const periodOrderItems = this.repos.reports.getPaidOrderItemsInRange({ fromDate: rangeFrom, toDate: rangeTo });
    const periodReturns = this.repos.reports.getApprovedReturnsInRange({ fromDate: rangeFrom, toDate: rangeTo });
    const periodReturnItems = this.repos.reports.getApprovedReturnItemsInRange({ fromDate: rangeFrom, toDate: rangeTo });

    const period = computeFinancialMetrics({
      orders: periodOrders,
      orderItems: periodOrderItems,
      approvedReturns: periodReturns,
      approvedReturnItems: periodReturnItems,
      fromDate: rangeFrom,
      toDate: rangeTo,
      groupBy: 'day',
    });

    // Today's metrics
    const todayOrders = periodOrders.filter((o) => String(o.created_at).slice(0, 10) === today);
    const todayOrderIds = new Set(todayOrders.map((o) => o.id));
    const todayOrderItems = periodOrderItems.filter((oi) => todayOrderIds.has(oi.order_id));
    const todayReturns = periodReturns.filter((r) => String(r.effective_at).slice(0, 10) === today);
    const todayReturnIds = new Set(todayReturns.map((r) => r.id));
    const todayReturnItems = periodReturnItems.filter((ri) => todayReturnIds.has(ri.return_id));

    const todayMetrics = computeFinancialMetrics({
      orders: todayOrders,
      orderItems: todayOrderItems,
      approvedReturns: todayReturns,
      approvedReturnItems: todayReturnItems,
      fromDate: today,
      toDate: today,
      groupBy: 'day',
    });

    const queues = this.repos.reports.getOperationalQueues();
    const recentOrders = this.repos.reports.getRecentPaidOrders(6).map((o) => ({
      id: o.id,
      customerName: o.customer_name || 'Khách lẻ',
      customerPhone: o.customer_phone || '',
      cashierName: o.cashier_name,
      paymentMethod: o.payment_method,
      paymentMethodLabel: PAYMENT_METHOD_LABELS[o.payment_method] || o.payment_method,
      totalAmount: Number(o.total_amount) || 0,
      refundedAmount: Number(o.refunded_amount) || 0,
      status: o.status,
      createdAt: o.created_at,
    }));

    return {
      period: {
        days: safeDays,
        fromDate: rangeFrom,
        toDate: rangeTo,
        today,
      },
      today: todayMetrics.summary,
      summary: period.summary,
      series: period.series,
      paymentBreakdown: period.paymentBreakdown,
      topCategories: period.categoryBreakdown.slice(0, 5),
      queues: {
        draftPurchases: queues.draftPurchases,
        pendingAudits: queues.pendingAudits,
        pendingReturns: queues.pendingReturns,
        activeProducts: queues.activeProducts,
        lowStockCount: queues.lowStockCount,
        outOfStockCount: queues.outOfStockCount,
        totalAttentionCount:
          queues.lowStockCount + queues.draftPurchases + queues.pendingAudits + queues.pendingReturns,
        lowStockProducts: queues.lowStockProducts.map((p) => ({
          id: p.id,
          sku: p.sku,
          name: p.name,
          stockQty: Number(p.stock_qty) || 0,
          minStock: Number(p.min_stock) || 0,
          unitName: p.unit_name,
          categoryName: p.category_name,
        })),
      },
      recentOrders,
    };
  }

  getSalesReport({ fromDate = '', toDate = '', categoryCode = '', groupBy = 'day' } = {}) {
    const today = isoDateKey(new Date());
    const cleanFrom = String(fromDate || '').trim() || addUtcDays(today, -29);
    const cleanTo = String(toDate || '').trim() || today;
    const cleanCat = String(categoryCode || '').trim();
    const cleanGroupBy = String(groupBy || 'day').trim().toLowerCase();

    validateReportDateRange(cleanFrom, cleanTo);
    assertRule(['day', 'month'].includes(cleanGroupBy), 'Kiểu gom nhóm thời gian phải là "day" hoặc "month".', 400);

    const orders = this.repos.reports.getPaidOrdersInRange({ fromDate: cleanFrom, toDate: cleanTo });
    const orderItems = this.repos.reports.getPaidOrderItemsInRange({ fromDate: cleanFrom, toDate: cleanTo });
    const approvedReturns = this.repos.reports.getApprovedReturnsInRange({ fromDate: cleanFrom, toDate: cleanTo });
    const approvedReturnItems = this.repos.reports.getApprovedReturnItemsInRange({
      fromDate: cleanFrom,
      toDate: cleanTo,
    });

    const metrics = computeFinancialMetrics({
      orders,
      orderItems,
      approvedReturns,
      approvedReturnItems,
      categoryCode: cleanCat,
      fromDate: cleanFrom,
      toDate: cleanTo,
      groupBy: cleanGroupBy,
    });

    const storeConfig = this.systemService ? this.systemService.getPublicStoreConfig() : null;

    return {
      filters: {
        fromDate: cleanFrom,
        toDate: cleanTo,
        categoryCode: cleanCat,
        groupBy: cleanGroupBy,
      },
      store: storeConfig,
      ...metrics,
      topProducts: metrics.topProducts.slice(0, 15),
    };
  }

  getInventoryReport({ categoryCode = '' } = {}) {
    const cleanCat = String(categoryCode || '').trim();
    const rows = this.repos.reports.getInventorySnapshot({ categoryCode: cleanCat });

    let totalStockQty = 0;
    let totalCostValue = 0;
    let totalRetailValue = 0;
    let activeSku = 0;
    let inactiveSku = 0;
    let lowStockCount = 0;
    let outOfStockCount = 0;

    const catMap = new Map();
    const lowStockItems = [];
    const items = [];

    for (const r of rows) {
      const stockQty = Number(r.stock_qty) || 0;
      const minStock = Number(r.min_stock) || 0;
      const costPrice = Number(r.cost_price) || 0;
      const salePrice = Number(r.sale_price) || 0;
      const costValue = stockQty * costPrice;
      const retailValue = stockQty * salePrice;
      const isActive = r.status === 'DangKinhDoanh';
      const isOut = isActive && stockQty <= 0;
      const isLow = isActive && stockQty <= minStock;

      if (isActive) activeSku += 1;
      else inactiveSku += 1;
      if (isOut) outOfStockCount += 1;
      if (isLow) lowStockCount += 1;

      totalStockQty += stockQty;
      totalCostValue += costValue;
      totalRetailValue += retailValue;

      if (!catMap.has(r.category_code)) {
        catMap.set(r.category_code, {
          categoryCode: r.category_code,
          categoryName: r.category_name,
          skuCount: 0,
          stockQty: 0,
          costValue: 0,
          retailValue: 0,
          lowStockCount: 0,
        });
      }
      const c = catMap.get(r.category_code);
      c.skuCount += 1;
      c.stockQty += stockQty;
      c.costValue += costValue;
      c.retailValue += retailValue;
      if (isLow) c.lowStockCount += 1;

      const dto = {
        id: r.id,
        sku: r.sku,
        barcode: r.barcode,
        name: r.name,
        categoryCode: r.category_code,
        categoryName: r.category_name,
        unitName: r.unit_name,
        supplierName: r.supplier_name,
        status: r.status,
        stockQty,
        minStock,
        deficit: Math.max(0, minStock - stockQty),
        costPrice,
        salePrice,
        costValue,
        retailValue,
        isLowStock: isLow,
        isOutOfStock: isOut,
      };
      items.push(dto);
      if (isLow) lowStockItems.push(dto);
    }

    const byCategory = [...catMap.values()].sort((a, b) => b.costValue - a.costValue);

    return {
      filters: { categoryCode: cleanCat },
      summary: {
        totalSku: rows.length,
        activeSku,
        inactiveSku,
        totalStockQty,
        totalCostValue,
        totalRetailValue,
        potentialMarginValue: totalRetailValue - totalCostValue,
        lowStockCount,
        outOfStockCount,
      },
      byCategory,
      lowStockItems,
      items,
    };
  }
}

module.exports = {
  ReportService,
  computeFinancialMetrics,
  validateReportDateRange,
  allocateOrderItemRevenues,
  isoDateKey,
};
