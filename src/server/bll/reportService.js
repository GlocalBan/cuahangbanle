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

function isRestockedFlag(val) {
  return val === 1 || val === true || val === '1';
}

function getOrderPreTax(orderLike) {
  if (!orderLike) return 0;
  if (orderLike.subtotal !== undefined && orderLike.subtotal !== null) {
    return Math.max(0, (Number(orderLike.subtotal) || 0) - (Number(orderLike.invoice_discount) || 0));
  }
  if (orderLike.order_subtotal !== undefined && orderLike.order_subtotal !== null) {
    return Math.max(0, (Number(orderLike.order_subtotal) || 0) - (Number(orderLike.order_invoice_discount) || 0));
  }
  const total = Number(orderLike.total_amount ?? orderLike.order_total_amount) || 0;
  const tax = Number(orderLike.tax_amount ?? orderLike.order_tax_amount) || 0;
  return Math.max(0, total - tax);
}

/**
 * Tách một khoản tiền hoàn trả (đã gồm VAT) thành phần doanh thu trước thuế và phần thuế VAT hoàn lại.
 * Nếu hoàn 100% hóa đơn thì đảm bảo khớp chính xác orderPreTax.
 */
function splitRefundPreTaxAndTax(refundAmount, orderPreTax, orderTotal) {
  const amt = Math.max(0, Number(refundAmount) || 0);
  const oTotal = Math.max(0, Number(orderTotal) || 0);
  const oPre = Math.max(0, Number(orderPreTax) || 0);
  if (oTotal <= 0 || amt <= 0) {
    return { refundPreTax: 0, refundTax: 0 };
  }
  if (amt >= oTotal) {
    return { refundPreTax: oPre, refundTax: amt - oPre };
  }
  const refundPreTax = Math.round((amt * oPre) / oTotal);
  return { refundPreTax, refundTax: amt - refundPreTax };
}

/**
 * Phân bổ cả doanh thu trước thuế (orderPreTax) và tổng thu gồm VAT (orderTotal) về từng dòng hóa đơn
 * chính xác đến từng đồng sao cho tổng các dòng luôn khớp 100% với hóa đơn gốc.
 */
function allocateOrderItemFinancials(orderItems = [], orderById = new Map()) {
  const byOrder = new Map();
  for (const oi of orderItems) {
    if (!byOrder.has(oi.order_id)) byOrder.set(oi.order_id, []);
    byOrder.get(oi.order_id).push(oi);
  }
  const allocatedMap = new Map();
  for (const [orderId, items] of byOrder.entries()) {
    const order = orderById.get(orderId) || null;
    const orderTotal = Math.max(0, Number(order?.total_amount ?? items[0].order_total_amount) || 0);
    const orderPreTax = order ? getOrderPreTax(order) : getOrderPreTax(items[0]);
    const bases = items.map((i) =>
      Math.max(0, (Number(i.qty) || 0) * (Number(i.unit_price_snapshot) || 0) - (Number(i.line_discount) || 0)),
    );
    const baseSum = bases.reduce((s, v) => s + v, 0);
    let usedTotal = 0;
    let usedPreTax = 0;
    items.forEach((item, idx) => {
      let paidTotal = 0;
      let paidPreTax = 0;
      if (idx === items.length - 1) {
        paidTotal = Math.max(0, orderTotal - usedTotal);
        paidPreTax = Math.max(0, orderPreTax - usedPreTax);
      } else if (baseSum > 0) {
        paidTotal = Math.floor((orderTotal * bases[idx]) / baseSum);
        paidPreTax = Math.floor((orderPreTax * bases[idx]) / baseSum);
      }
      usedTotal += paidTotal;
      usedPreTax += paidPreTax;
      const key = item.id ?? `${item.order_id}:${item.product_id}`;
      allocatedMap.set(key, {
        preTax: paidPreTax,
        tax: paidTotal - paidPreTax,
        collected: paidTotal,
      });
    });
  }
  return allocatedMap;
}

/**
 * Tách phần trước thuế & VAT cho từng phiếu trả hàng (và phân bổ khớp từng đồng xuống từng return_item).
 * Đảm bảo khi nhiều phiếu trả từng phần cộng dồn bằng 100% hóa đơn thì tổng refundPreTax === orderPreTax.
 */
function allocateReturnFinancials(validReturns = [], validReturnItems = [], orderById = new Map()) {
  const returnSplitMap = new Map();
  const byOrder = new Map();
  for (const r of validReturns) {
    if (!byOrder.has(r.order_id)) byOrder.set(r.order_id, []);
    byOrder.get(r.order_id).push(r);
  }

  for (const [orderId, rets] of byOrder.entries()) {
    const ord = orderById.get(orderId) || null;
    const oTotal = Math.max(0, Number(ord?.total_amount ?? rets[0].order_total_amount) || 0);
    const oPreTax = ord ? getOrderPreTax(ord) : getOrderPreTax(rets[0]);
    const sumRefundAmt = rets.reduce((s, r) => s + (Number(r.refund_amount) || 0), 0);
    const isFullOrderRefund = oTotal > 0 && sumRefundAmt >= oTotal;
    let usedPreTax = 0;

    rets.forEach((r, idx) => {
      const amt = Math.max(0, Number(r.refund_amount) || 0);
      let split;
      if (isFullOrderRefund && idx === rets.length - 1) {
        const remPre = Math.max(0, oPreTax - usedPreTax);
        split = { refundPreTax: remPre, refundTax: amt - remPre };
      } else {
        split = splitRefundPreTaxAndTax(amt, oPreTax, oTotal);
      }
      usedPreTax += split.refundPreTax;
      returnSplitMap.set(r.id, {
        refundTotal: amt,
        refundPreTax: split.refundPreTax,
        refundTax: split.refundTax,
      });
    });
  }

  const returnItemSplitMap = new Map();
  const itemsByReturn = new Map();
  for (const ri of validReturnItems) {
    if (!itemsByReturn.has(ri.return_id)) itemsByReturn.set(ri.return_id, []);
    itemsByReturn.get(ri.return_id).push(ri);
  }

  for (const [returnId, items] of itemsByReturn.entries()) {
    const parentSplit = returnSplitMap.get(returnId);
    const parentAmt = parentSplit
      ? parentSplit.refundTotal
      : items.reduce((s, i) => s + (Number(i.refund_line_amount) || 0), 0);
    let parentPreTax;
    if (parentSplit) {
      parentPreTax = parentSplit.refundPreTax;
    } else {
      const ord = orderById.get(items[0].order_id) || null;
      const oTotal = Math.max(0, Number(ord?.total_amount ?? items[0].order_total_amount) || 0);
      const oPreTax = ord ? getOrderPreTax(ord) : getOrderPreTax(items[0]);
      parentPreTax = splitRefundPreTaxAndTax(parentAmt, oPreTax, oTotal).refundPreTax;
    }

    let usedPre = 0;
    items.forEach((ri, idx) => {
      const lineAmt = Math.max(0, Number(ri.refund_line_amount) || 0);
      let linePre = 0;
      if (idx === items.length - 1) {
        linePre = Math.max(0, parentPreTax - usedPre);
      } else if (parentAmt > 0) {
        linePre = Math.round((parentPreTax * lineAmt) / parentAmt);
      }
      usedPre += linePre;
      const key = ri.id ?? `${ri.return_id}:${ri.product_id}`;
      returnItemSplitMap.set(key, {
        refundTotal: lineAmt,
        refundPreTax: linePre,
        refundTax: lineAmt - linePre,
      });
    });
  }

  return { returnSplitMap, returnItemSplitMap };
}

/**
 * BR-08 (Chuẩn kế toán — Pure function):
 * 1. Tách VAT khỏi Doanh thu thuần & Lợi nhuận gộp:
 *    - grossRevenuePreTax = SUM(subtotal - invoice_discount) của hóa đơn DaThanhToan / TraMotPhan / DaHoanTra.
 *    - grossTax = SUM(tax_amount); grossCollected = SUM(total_amount).
 *    - Với phiếu trả hàng DaXacNhan: tách refundPreTax & refundTax theo tỷ lệ hóa đơn gốc (100% hoàn -> khớp đúng orderPreTax).
 *    - netRevenuePreTax = grossRevenuePreTax - refundPreTax (Doanh thu thuần trước VAT).
 *    - netTax = grossTax - refundTax (Thuế VAT đầu ra ròng).
 *    - netCollected = grossCollected - refundTotal (Tổng thu ròng gồm VAT).
 * 2. Giá vốn hàng bán (COGS) theo trạng thái nhập lại kho:
 *    - grossCogs = SUM(order_items.qty * unit_cost_snapshot).
 *    - restockedReturnCogs = SUM(return_items.qty * unit_cost_snapshot) CHỈ với restock = 1.
 *    - nonRestockedReturnCogs = SUM(return_items.qty * unit_cost_snapshot) với restock = 0 (hao hụt hàng lỗi — KHÔNG trừ khỏi COGS).
 *    - netCogs = grossCogs - restockedReturnCogs.
 * 3. Lợi nhuận gộp:
 *    - grossProfit = netRevenuePreTax - netCogs (strictly trước VAT).
 *    - grossMarginPct = netRevenuePreTax > 0 ? Number(((grossProfit / netRevenuePreTax) * 100).toFixed(2)) : 0.
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
  const orderById = new Map(paidOrders.map((o) => [o.id, o]));
  const paidOrderIds = new Set(paidOrders.map((o) => o.id));
  const validOrderItems = orderItems.filter((oi) => paidOrderIds.has(oi.order_id));
  const validReturns = approvedReturns.filter((r) => r.status === 'DaXacNhan');
  const validReturnIds = new Set(validReturns.map((r) => r.id));
  const validReturnItems = approvedReturnItems.filter((ri) => validReturnIds.has(ri.return_id));

  const itemFinMap = allocateOrderItemFinancials(validOrderItems, orderById);
  const { returnSplitMap, returnItemSplitMap } = allocateReturnFinancials(validReturns, validReturnItems, orderById);

  const filteredOrderItems = cleanCat
    ? validOrderItems.filter((oi) => oi.category_code === cleanCat)
    : validOrderItems;
  const filteredReturnItems = cleanCat
    ? validReturnItems.filter((ri) => ri.category_code === cleanCat)
    : validReturnItems;

  const filteredOrderIds = new Set(filteredOrderItems.map((oi) => oi.order_id));
  const filteredReturnIds = new Set(filteredReturnItems.map((ri) => ri.return_id));

  let grossRevenuePreTax = 0;
  let grossTax = 0;
  let grossCollected = 0;
  let refundTotal = 0;
  let refundPreTax = 0;
  let refundTax = 0;
  let totalSubtotal = 0;
  let totalLineDiscount = 0;
  let totalInvoiceDiscount = 0;
  let orderCount = 0;
  let returnCount = 0;

  if (!cleanCat) {
    orderCount = paidOrders.length;
    returnCount = validReturns.length;
    for (const o of paidOrders) {
      grossRevenuePreTax += getOrderPreTax(o);
      grossTax += Number(o.tax_amount) || 0;
      grossCollected += Number(o.total_amount) || 0;
      totalSubtotal += Number(o.subtotal) || 0;
      totalInvoiceDiscount += Number(o.invoice_discount) || 0;
    }
    for (const oi of validOrderItems) {
      totalLineDiscount += Number(oi.line_discount) || 0;
    }
    for (const r of validReturns) {
      const sp = returnSplitMap.get(r.id) || { refundTotal: 0, refundPreTax: 0, refundTax: 0 };
      refundTotal += sp.refundTotal;
      refundPreTax += sp.refundPreTax;
      refundTax += sp.refundTax;
    }
  } else {
    orderCount = filteredOrderIds.size;
    returnCount = filteredReturnIds.size;
    for (const oi of filteredOrderItems) {
      const key = oi.id ?? `${oi.order_id}:${oi.product_id}`;
      const fin = itemFinMap.get(key) || { preTax: 0, tax: 0, collected: 0 };
      const lineDisc = Number(oi.line_discount) || 0;
      const lineNetBase = Math.max(0, (Number(oi.qty) || 0) * (Number(oi.unit_price_snapshot) || 0) - lineDisc);
      grossRevenuePreTax += fin.preTax;
      grossTax += fin.tax;
      grossCollected += fin.collected;
      totalSubtotal += lineNetBase;
      totalLineDiscount += lineDisc;
    }
    for (const ri of filteredReturnItems) {
      const key = ri.id ?? `${ri.return_id}:${ri.product_id}`;
      const sp = returnItemSplitMap.get(key) || { refundTotal: 0, refundPreTax: 0, refundTax: 0 };
      refundTotal += sp.refundTotal;
      refundPreTax += sp.refundPreTax;
      refundTax += sp.refundTax;
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

  let restockedReturnCogs = 0;
  let nonRestockedReturnCogs = 0;
  let returnedQtyTotal = 0;
  let restockedQtyTotal = 0;
  let nonRestockedQtyTotal = 0;
  for (const ri of filteredReturnItems) {
    const qty = Number(ri.qty) || 0;
    const cost = Number(ri.unit_cost_snapshot) || 0;
    returnedQtyTotal += qty;
    if (isRestockedFlag(ri.restock)) {
      restockedReturnCogs += qty * cost;
      restockedQtyTotal += qty;
    } else {
      nonRestockedReturnCogs += qty * cost;
      nonRestockedQtyTotal += qty;
    }
  }

  const netRevenuePreTax = grossRevenuePreTax - refundPreTax;
  const netTax = grossTax - refundTax;
  const netCollected = grossCollected - refundTotal;
  const netCogs = grossCogs - restockedReturnCogs;
  const grossProfit = netRevenuePreTax - netCogs;
  const grossMarginPct =
    netRevenuePreTax > 0 ? Number(((grossProfit / netRevenuePreTax) * 100).toFixed(2)) : 0;
  const avgOrderValue = orderCount > 0 ? Math.round(grossCollected / orderCount) : 0;

  // ── Time Series (Daily or Monthly) ─────────────────────────────────────────
  const bucketMap = new Map();
  const ensureBucket = (key) => {
    if (!bucketMap.has(key)) {
      bucketMap.set(key, {
        key,
        label: safeGroupBy === 'month' ? formatMonthLabel(key) : formatDayLabel(key),
        orderIds: new Set(),
        grossRevenuePreTax: 0,
        grossTax: 0,
        grossCollected: 0,
        refundTotal: 0,
        refundPreTax: 0,
        refundTax: 0,
        grossCogs: 0,
        restockedReturnCogs: 0,
        nonRestockedReturnCogs: 0,
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
      b.grossRevenuePreTax += getOrderPreTax(o);
      b.grossTax += Number(o.tax_amount) || 0;
      b.grossCollected += Number(o.total_amount) || 0;
    }
    for (const oi of validOrderItems) {
      const b = ensureBucket(bucketKeyOf(oi.order_created_at));
      b.grossCogs += (Number(oi.qty) || 0) * (Number(oi.unit_cost_snapshot) || 0);
    }
    for (const r of validReturns) {
      const b = ensureBucket(bucketKeyOf(r.effective_at || r.resolved_at || r.created_at));
      const sp = returnSplitMap.get(r.id) || { refundTotal: 0, refundPreTax: 0, refundTax: 0 };
      b.refundTotal += sp.refundTotal;
      b.refundPreTax += sp.refundPreTax;
      b.refundTax += sp.refundTax;
    }
    for (const ri of validReturnItems) {
      const b = ensureBucket(bucketKeyOf(ri.effective_at));
      const costVal = (Number(ri.qty) || 0) * (Number(ri.unit_cost_snapshot) || 0);
      if (isRestockedFlag(ri.restock)) b.restockedReturnCogs += costVal;
      else b.nonRestockedReturnCogs += costVal;
    }
  } else {
    for (const oi of filteredOrderItems) {
      const b = ensureBucket(bucketKeyOf(oi.order_created_at));
      const key = oi.id ?? `${oi.order_id}:${oi.product_id}`;
      const fin = itemFinMap.get(key) || { preTax: 0, tax: 0, collected: 0 };
      b.orderIds.add(oi.order_id);
      b.grossRevenuePreTax += fin.preTax;
      b.grossTax += fin.tax;
      b.grossCollected += fin.collected;
      b.grossCogs += (Number(oi.qty) || 0) * (Number(oi.unit_cost_snapshot) || 0);
    }
    for (const ri of filteredReturnItems) {
      const b = ensureBucket(bucketKeyOf(ri.effective_at));
      const key = ri.id ?? `${ri.return_id}:${ri.product_id}`;
      const sp = returnItemSplitMap.get(key) || { refundTotal: 0, refundPreTax: 0, refundTax: 0 };
      b.refundTotal += sp.refundTotal;
      b.refundPreTax += sp.refundPreTax;
      b.refundTax += sp.refundTax;
      const costVal = (Number(ri.qty) || 0) * (Number(ri.unit_cost_snapshot) || 0);
      if (isRestockedFlag(ri.restock)) b.restockedReturnCogs += costVal;
      else b.nonRestockedReturnCogs += costVal;
    }
  }

  const series = [...bucketMap.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((b) => {
      const bNetPreTax = b.grossRevenuePreTax - b.refundPreTax;
      const bNetTax = b.grossTax - b.refundTax;
      const bNetCollected = b.grossCollected - b.refundTotal;
      const bNetCogs = b.grossCogs - b.restockedReturnCogs;
      return {
        key: b.key,
        label: b.label,
        orderCount: b.orderIds.size,
        grossRevenuePreTax: b.grossRevenuePreTax,
        grossRevenue: b.grossRevenuePreTax,
        grossCollected: b.grossCollected,
        refundTotal: b.refundTotal,
        refundPreTax: b.refundPreTax,
        netRevenuePreTax: bNetPreTax,
        netRevenue: bNetPreTax,
        netTax: bNetTax,
        netCollected: bNetCollected,
        netCogs: bNetCogs,
        nonRestockedReturnCogs: b.nonRestockedReturnCogs,
        grossProfit: bNetPreTax - bNetCogs,
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
        restockedQty: 0,
        nonRestockedQty: 0,
        grossRevenuePreTax: 0,
        grossTax: 0,
        grossCollected: 0,
        refundTotal: 0,
        refundPreTax: 0,
        refundTax: 0,
        grossCogs: 0,
        restockedReturnCogs: 0,
        nonRestockedReturnCogs: 0,
      });
    }
    return catMap.get(code);
  };

  for (const oi of filteredOrderItems) {
    const c = ensureCat(oi.category_code, oi.category_name);
    const key = oi.id ?? `${oi.order_id}:${oi.product_id}`;
    const fin = itemFinMap.get(key) || { preTax: 0, tax: 0, collected: 0 };
    const qty = Number(oi.qty) || 0;
    c.soldQty += qty;
    c.grossRevenuePreTax += fin.preTax;
    c.grossTax += fin.tax;
    c.grossCollected += fin.collected;
    c.grossCogs += qty * (Number(oi.unit_cost_snapshot) || 0);
  }
  for (const ri of filteredReturnItems) {
    const c = ensureCat(ri.category_code, ri.category_name);
    const key = ri.id ?? `${ri.return_id}:${ri.product_id}`;
    const sp = returnItemSplitMap.get(key) || { refundTotal: 0, refundPreTax: 0, refundTax: 0 };
    const qty = Number(ri.qty) || 0;
    const costVal = qty * (Number(ri.unit_cost_snapshot) || 0);
    c.returnedQty += qty;
    c.refundTotal += sp.refundTotal;
    c.refundPreTax += sp.refundPreTax;
    c.refundTax += sp.refundTax;
    if (isRestockedFlag(ri.restock)) {
      c.restockedQty += qty;
      c.restockedReturnCogs += costVal;
    } else {
      c.nonRestockedQty += qty;
      c.nonRestockedReturnCogs += costVal;
    }
  }

  const categoryBreakdown = [...catMap.values()]
    .map((c) => {
      const cNetPreTax = c.grossRevenuePreTax - c.refundPreTax;
      const cNetTax = c.grossTax - c.refundTax;
      const cNetCollected = c.grossCollected - c.refundTotal;
      const cNetCogs = c.grossCogs - c.restockedReturnCogs;
      const cProfit = cNetPreTax - cNetCogs;
      return {
        categoryCode: c.categoryCode,
        categoryName: c.categoryName,
        soldQty: c.soldQty,
        returnedQty: c.returnedQty,
        restockedQty: c.restockedQty,
        nonRestockedQty: c.nonRestockedQty,
        netQty: c.soldQty - c.returnedQty,
        grossRevenuePreTax: c.grossRevenuePreTax,
        grossRevenue: c.grossRevenuePreTax,
        refundPreTax: c.refundPreTax,
        refundTotal: c.refundTotal,
        netRevenuePreTax: cNetPreTax,
        netRevenue: cNetPreTax,
        netTax: cNetTax,
        netCollected: cNetCollected,
        netCogs: cNetCogs,
        nonRestockedReturnCogs: c.nonRestockedReturnCogs,
        grossProfit: cProfit,
        sharePct: netRevenuePreTax > 0 ? Number(((cNetPreTax / netRevenuePreTax) * 100).toFixed(2)) : 0,
      };
    })
    .sort((a, b) => b.netRevenuePreTax - a.netRevenuePreTax);

  // ── Payment Method Breakdown (Customer Cashflow incl. VAT + Pre-Tax breakdown) ──
  const payMap = new Map(
    ['CASH', 'VIETQR', 'CARD'].map((code) => [
      code,
      {
        method: code,
        label: PAYMENT_METHOD_LABELS[code],
        orderIds: new Set(),
        grossRevenuePreTax: 0,
        grossTax: 0,
        grossCollected: 0,
        refundTotal: 0,
        refundPreTax: 0,
        refundTax: 0,
      },
    ]),
  );

  if (!cleanCat) {
    for (const o of paidOrders) {
      const p = payMap.get(o.payment_method) || payMap.get('CASH');
      p.orderIds.add(o.id);
      p.grossRevenuePreTax += getOrderPreTax(o);
      p.grossTax += Number(o.tax_amount) || 0;
      p.grossCollected += Number(o.total_amount) || 0;
    }
    for (const r of validReturns) {
      const p = payMap.get(r.payment_method) || payMap.get('CASH');
      const sp = returnSplitMap.get(r.id) || { refundTotal: 0, refundPreTax: 0, refundTax: 0 };
      p.refundTotal += sp.refundTotal;
      p.refundPreTax += sp.refundPreTax;
      p.refundTax += sp.refundTax;
    }
  } else {
    for (const oi of filteredOrderItems) {
      const p = payMap.get(oi.payment_method) || payMap.get('CASH');
      const key = oi.id ?? `${oi.order_id}:${oi.product_id}`;
      const fin = itemFinMap.get(key) || { preTax: 0, tax: 0, collected: 0 };
      p.orderIds.add(oi.order_id);
      p.grossRevenuePreTax += fin.preTax;
      p.grossTax += fin.tax;
      p.grossCollected += fin.collected;
    }
    for (const ri of filteredReturnItems) {
      const p = payMap.get(ri.payment_method) || payMap.get('CASH');
      const key = ri.id ?? `${ri.return_id}:${ri.product_id}`;
      const sp = returnItemSplitMap.get(key) || { refundTotal: 0, refundPreTax: 0, refundTax: 0 };
      p.refundTotal += sp.refundTotal;
      p.refundPreTax += sp.refundPreTax;
      p.refundTax += sp.refundTax;
    }
  }

  const paymentBreakdown = [...payMap.values()].map((p) => {
    const pNetCollected = p.grossCollected - p.refundTotal;
    const pNetPreTax = p.grossRevenuePreTax - p.refundPreTax;
    const pNetTax = p.grossTax - p.refundTax;
    return {
      method: p.method,
      label: p.label,
      orderCount: p.orderIds.size,
      grossCollected: p.grossCollected,
      grossRevenue: p.grossCollected,
      refundTotal: p.refundTotal,
      netCollected: pNetCollected,
      netRevenuePreTax: pNetPreTax,
      netTax: pNetTax,
      netRevenue: pNetCollected,
      sharePct: netCollected > 0 ? Number(((pNetCollected / netCollected) * 100).toFixed(2)) : 0,
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
        grossRevenuePreTax: 0,
        refundPreTax: 0,
        refundTotal: 0,
        grossCogs: 0,
        restockedReturnCogs: 0,
        nonRestockedReturnCogs: 0,
      });
    }
    return prodMap.get(row.product_id);
  };

  for (const oi of filteredOrderItems) {
    const p = ensureProd(oi);
    const key = oi.id ?? `${oi.order_id}:${oi.product_id}`;
    const fin = itemFinMap.get(key) || { preTax: 0, tax: 0, collected: 0 };
    const qty = Number(oi.qty) || 0;
    p.soldQty += qty;
    p.grossRevenuePreTax += fin.preTax;
    p.grossCogs += qty * (Number(oi.unit_cost_snapshot) || 0);
  }
  for (const ri of filteredReturnItems) {
    const p = ensureProd(ri);
    const key = ri.id ?? `${ri.return_id}:${ri.product_id}`;
    const sp = returnItemSplitMap.get(key) || { refundTotal: 0, refundPreTax: 0, refundTax: 0 };
    const qty = Number(ri.qty) || 0;
    const costVal = qty * (Number(ri.unit_cost_snapshot) || 0);
    p.returnedQty += qty;
    p.refundPreTax += sp.refundPreTax;
    p.refundTotal += sp.refundTotal;
    if (isRestockedFlag(ri.restock)) p.restockedReturnCogs += costVal;
    else p.nonRestockedReturnCogs += costVal;
  }

  const topProducts = [...prodMap.values()]
    .map((p) => {
      const pNetPreTax = p.grossRevenuePreTax - p.refundPreTax;
      const pNetCogs = p.grossCogs - p.restockedReturnCogs;
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
        grossRevenuePreTax: p.grossRevenuePreTax,
        grossRevenue: p.grossRevenuePreTax,
        refundPreTax: p.refundPreTax,
        refundTotal: p.refundTotal,
        netRevenuePreTax: pNetPreTax,
        netRevenue: pNetPreTax,
        netCogs: pNetCogs,
        nonRestockedReturnCogs: p.nonRestockedReturnCogs,
        grossProfit: pNetPreTax - pNetCogs,
      };
    })
    .sort((a, b) => b.netRevenuePreTax - a.netRevenuePreTax || b.netQty - a.netQty);

  return {
    summary: {
      orderCount,
      returnCount,
      soldQtyTotal,
      returnedQtyTotal,
      restockedQtyTotal,
      nonRestockedQtyTotal,
      netQtyTotal: soldQtyTotal - returnedQtyTotal,
      totalSubtotal,
      totalLineDiscount,
      totalInvoiceDiscount,
      // Standard accounting pre-tax / VAT / collected separation
      grossRevenuePreTax,
      grossTax,
      grossCollected,
      refundPreTax,
      refundTax,
      refundTotal,
      netRevenuePreTax,
      netTax,
      netCollected,
      // Aliases kept consistent with pre-tax revenue
      grossRevenue: grossRevenuePreTax,
      netRevenue: netRevenuePreTax,
      totalTax: grossTax,
      // COGS & damaged non-restocked tracking
      grossCogs,
      restockedReturnCogs,
      nonRestockedReturnCogs,
      returnedCogs: restockedReturnCogs,
      netCogs,
      // Gross profit strictly on pre-tax net revenue
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
  splitRefundPreTaxAndTax,
  validateReportDateRange,
  allocateOrderItemFinancials,
  isoDateKey,
};
