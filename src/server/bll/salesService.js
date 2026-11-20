'use strict';
const { withTransaction } = require('../dal/database.js');
const { ConflictException, ForbiddenException, NotFoundException, assertRule } = require('./errors.js');

const PROMO_STATUS_LABELS = {
  SapDienRa: 'Sắp diễn ra',
  DangDienRa: 'Đang diễn ra',
  TamDung: 'Tạm dừng',
  KetThuc: 'Đã kết thúc',
  DaHuy: 'Đã hủy',
};

const ORDER_STATUS_LABELS = {
  DaThanhToan: 'Đã thanh toán',
  TraMotPhan: 'Trả một phần',
  DaHoanTra: 'Đã hoàn trả',
  DaHuy: 'Đã hủy',
};

const RETURN_STATUS_LABELS = {
  ChoDuyet: 'Chờ duyệt hoàn trả',
  DaXacNhan: 'Đã xác nhận hoàn tiền',
  TuChoi: 'Đã từ chối',
};

const PAYMENT_METHOD_LABELS = {
  CASH: 'Tiền mặt',
  VIETQR: 'Chuyển khoản / VietQR',
  CARD: 'Thẻ ngân hàng',
};

const VOUCHER_STATUS_LABELS = {
  SapDienRa: 'Sắp diễn ra',
  DangDienRa: 'Đang diễn ra',
  TamDung: 'Tạm dừng',
  KetThuc: 'Đã kết thúc',
  DaHuy: 'Đã hủy',
};

const PROMO_SCOPE_LABELS = {
  INVOICE: 'Toàn hóa đơn',
  CATEGORY: 'Theo danh mục',
  PRODUCT: 'Sản phẩm chỉ định',
  NEAR_EXPIRY: 'Hàng cận date (FEFO)',
};

const SHIFT_STATUS_LABELS = {
  DangMo: 'Đang mở ca',
  DaDong: 'Đã chốt ca',
};

function todayYmdVn(nowDate = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(nowDate);
}

function diffDaysYmd(fromYmd, toYmd) {
  if (!fromYmd || !toYmd) return null;
  const [y1, m1, d1] = String(fromYmd).split('-').map(Number);
  const [y2, m2, d2] = String(toYmd).split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

function validateDateRange(fromDate, toDate, labelFrom = 'Từ ngày', labelTo = 'Đến ngày') {
  const isoPattern = /^\d{4}-\d{2}-\d{2}$/;
  if (fromDate && !isoPattern.test(fromDate)) {
    assertRule(false, `Định dạng "${labelFrom}" không hợp lệ (YYYY-MM-DD).`, 400);
  }
  if (toDate && !isoPattern.test(toDate)) {
    assertRule(false, `Định dạng "${labelTo}" không hợp lệ (YYYY-MM-DD).`, 400);
  }
  if (fromDate && toDate && fromDate > toDate) {
    assertRule(false, `Khoảng thời gian không hợp lệ: "${labelFrom}" phải nhỏ hơn hoặc bằng "${labelTo}" (BR-08).`, 400);
  }
}

function parsePositiveInt(value, fieldLabel) {
  const num = Number(value);
  assertRule(
    value !== '' && value !== null && value !== undefined && Number.isSafeInteger(num) && num > 0,
    `${fieldLabel} phải là số nguyên dương lớn hơn 0.`,
    400,
  );
  return num;
}

function parseNonNegativeInt(value, fieldLabel) {
  const num = Number(value);
  assertRule(
    value !== '' && value !== null && value !== undefined && Number.isSafeInteger(num) && num >= 0,
    `${fieldLabel} phải là số nguyên không âm (>= 0).`,
    400,
  );
  return num;
}

/**
 * BR-04: Tính mức giảm giá khuyến mãi cho hóa đơn (không vượt quá Tạm tính).
 */
function computePromotionDiscount(promotion, subtotal) {
  if (!promotion || subtotal <= 0) return 0;
  const type = promotion.discount_type || promotion.discountType;
  const value = Math.max(0, Number(promotion.discount_value ?? promotion.discountValue) || 0);
  const maxDiscount = Math.max(0, Number(promotion.max_discount ?? promotion.maxDiscount) || 0);
  let raw = 0;
  if (type === 'PERCENT') {
    raw = Math.round((subtotal * value) / 100);
    if (maxDiscount > 0) {
      raw = Math.min(raw, maxDiscount);
    }
  } else {
    raw = Math.round(value);
  }
  return Math.max(0, Math.min(subtotal, raw));
}

/**
 * BR-04: Thứ tự tính tiền hóa đơn bắt buộc:
 * 1. TamTinh = SUM(SoLuong * DonGiaBan - GiamGiaDongHang)
 * 2. GiamGiaHoaDon = KhuyenMai(TamTinh) (<= TamTinh)
 * 3. TienSauGiam = TamTinh - GiamGiaHoaDon
 * 4. ThueVAT = TienSauGiam * TyLeVAT (đọc từ THAM_SO)
 * 5. TongThanhToan = MAX(0, TienSauGiam + ThueVAT)
 */
function calculateOrderPricing({ items = [], promotion = null, taxRate = 0 } = {}) {
  const safeTaxRate = Math.max(0, Number(taxRate) || 0);
  let subtotal = 0;
  for (const item of items) {
    const qty = Math.max(0, Number(item.qty) || 0);
    const unitPrice = Math.max(0, Number(item.unitPrice ?? item.unit_price_snapshot) || 0);
    const lineDiscount = Math.max(0, Number(item.lineDiscount ?? item.line_discount) || 0);
    const lineGross = qty * unitPrice;
    const clampedLineDiscount = Math.min(lineGross, lineDiscount);
    subtotal += lineGross - clampedLineDiscount;
  }
  const invoiceDiscount = computePromotionDiscount(promotion, subtotal);
  const afterDiscount = Math.max(0, subtotal - invoiceDiscount);
  const taxAmount = Math.round((afterDiscount * safeTaxRate) / 100);
  const totalAmount = Math.max(0, afterDiscount + taxAmount);

  return {
    subtotal,
    invoiceDiscount,
    afterDiscount,
    taxRate: safeTaxRate,
    taxAmount,
    totalAmount,
  };
}

/**
 * Phân bổ tổng số tiền thực trả (đã gồm giảm giá & VAT) về từng dòng hóa đơn để hoàn trả chính xác đến từng đồng.
 */
function allocateOrderPaidTotals(order) {
  const items = order.items || [];
  const totalAmount = Math.max(0, Number(order.total_amount) || 0);
  const lineBases = items.map((i) =>
    Math.max(0, Number(i.qty) * Number(i.unit_price_snapshot) - (Number(i.line_discount) || 0)),
  );
  const baseSum = lineBases.reduce((s, v) => s + v, 0);
  const map = new Map();
  let allocated = 0;
  items.forEach((item, idx) => {
    let paid = 0;
    if (idx === items.length - 1) {
      paid = Math.max(0, totalAmount - allocated);
    } else if (baseSum > 0) {
      paid = Math.floor((totalAmount * lineBases[idx]) / baseSum);
    }
    allocated += paid;
    map.set(item.product_id, paid);
  });
  return map;
}

function toPromotionDto(row, productIds = []) {
  const scope = row.scope || 'INVOICE';
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    discountType: row.discount_type,
    discountValue: Number(row.discount_value) || 0,
    minOrderAmount: Number(row.min_order_amount) || 0,
    maxDiscount: Number(row.max_discount) || 0,
    startDate: row.start_date,
    endDate: row.end_date,
    usageLimit: Number(row.usage_limit) || 0,
    usedCount: Number(row.used_count) || 0,
    remainingUses: Math.max(0, (Number(row.usage_limit) || 0) - (Number(row.used_count) || 0)),
    scope,
    scopeLabel: PROMO_SCOPE_LABELS[scope] || scope,
    categoryCode: row.category_code || '',
    nearExpiryDays: Number(row.near_expiry_days) || 14,
    productIds: Array.isArray(productIds) ? productIds : [],
    status: row.status,
    statusLabel: PROMO_STATUS_LABELS[row.status] || row.status,
    createdAt: row.created_at,
  };
}

function toVoucherDto(row) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    discountType: row.discount_type,
    discountValue: Number(row.discount_value) || 0,
    minOrderAmount: Number(row.min_order_amount) || 0,
    maxDiscount: Number(row.max_discount) || 0,
    startDate: row.start_date,
    endDate: row.end_date,
    usageLimit: Number(row.usage_limit) || 0,
    usedCount: Number(row.used_count) || 0,
    remainingUses: Math.max(0, (Number(row.usage_limit) || 0) - (Number(row.used_count) || 0)),
    maxUsesPerCustomer: Number(row.max_uses_per_customer) || 1,
    status: row.status,
    statusLabel: VOUCHER_STATUS_LABELS[row.status] || row.status,
    createdAt: row.created_at,
  };
}

function toShiftDto(row, liveMetrics = null) {
  if (!row) return null;
  const openingCash = Number(row.opening_cash) || 0;
  const cashSales = liveMetrics ? liveMetrics.cashSales : Number(row.cash_sales) || 0;
  const cashRefunds = liveMetrics ? liveMetrics.cashRefunds : Number(row.cash_refunds) || 0;
  const nonCashSales = liveMetrics ? liveMetrics.nonCashSales : Number(row.non_cash_sales) || 0;
  const orderCount = liveMetrics ? liveMetrics.orderCount : Number(row.order_count) || 0;
  const expectedCash =
    row.status === 'DangMo' ? Math.max(0, openingCash + cashSales - cashRefunds) : Number(row.expected_cash) || 0;
  return {
    id: row.id,
    cashierId: row.cashier_id,
    cashierName: row.cashier_name || '',
    cashierUsername: row.cashier_username || '',
    openedAt: row.opened_at,
    closedAt: row.closed_at || null,
    openingCash,
    expectedCash,
    actualCash: row.actual_cash !== null && row.actual_cash !== undefined ? Number(row.actual_cash) : null,
    variance: row.variance !== null && row.variance !== undefined ? Number(row.variance) : null,
    cashSales,
    cashRefunds,
    nonCashSales,
    totalSales: cashSales + nonCashSales,
    orderCount,
    status: row.status,
    statusLabel: SHIFT_STATUS_LABELS[row.status] || row.status,
    note: row.note || '',
  };
}

function toCustomerDto(row) {
  const gross = Number(row.gross_spent) || 0;
  const refunded = Number(row.refunded_total) || 0;
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email || '',
    status: row.status,
    active: row.status === 'HoatDong',
    orderCount: Number(row.order_count) || 0,
    netSpent: Math.max(0, gross - refunded),
    createdAt: row.created_at,
  };
}

function toOrderSummaryDto(row) {
  return {
    id: row.id,
    customerId: row.customer_id || null,
    customerName: row.customer_name || 'Khách lẻ',
    customerPhone: row.customer_phone || '',
    cashierId: row.cashier_id,
    cashierName: row.cashier_name,
    shiftId: row.shift_id || null,
    discountMode: row.discount_mode || (row.voucher_id ? 'VOUCHER' : row.promotion_id ? 'PROMOTION' : 'NONE'),
    promotionId: row.promotion_id || null,
    promotionCode: row.promotion_code || '',
    promotionName: row.promotion_name || '',
    voucherId: row.voucher_id || null,
    voucherCode: row.voucher_code || '',
    voucherName: row.voucher_name || '',
    subtotal: Number(row.subtotal) || 0,
    invoiceDiscount: Number(row.invoice_discount) || 0,
    taxRate: Number(row.tax_rate) || 0,
    taxAmount: Number(row.tax_amount) || 0,
    totalAmount: Number(row.total_amount) || 0,
    refundedAmount: Number(row.refunded_amount) || 0,
    netAmount: Math.max(0, (Number(row.total_amount) || 0) - (Number(row.refunded_amount) || 0)),
    paymentMethod: row.payment_method,
    paymentMethodLabel: PAYMENT_METHOD_LABELS[row.payment_method] || row.payment_method,
    cashReceived: Number(row.cash_received) || 0,
    cashChange: Number(row.cash_change) || 0,
    paymentRef: row.payment_ref || '',
    status: row.status,
    statusLabel: ORDER_STATUS_LABELS[row.status] || row.status,
    itemCount: Number(row.item_count) || 0,
    totalQty: Number(row.total_qty) || 0,
    note: row.note || '',
    createdAt: row.created_at,
  };
}

function toOrderDetailDto(row, { canViewCost = false, storeConfig = null, pendingReturnMap = new Map() } = {}) {
  const paidMap = allocateOrderPaidTotals(row);
  const items = (row.items || []).map((i) => {
    const qty = Number(i.qty) || 0;
    const returnedQty = Number(i.returned_qty) || 0;
    const pendingQty = pendingReturnMap.get(i.product_id) || 0;
    const dto = {
      id: i.id,
      productId: i.product_id,
      sku: i.sku,
      barcode: i.barcode,
      productName: i.product_name_snapshot,
      unitName: i.unit_name,
      imageUrl: i.image_url,
      nonReturnable: Number(i.non_returnable) === 1,
      unitPrice: Number(i.unit_price_snapshot) || 0,
      qty,
      lineDiscount: Number(i.line_discount) || 0,
      lineTotal: Math.max(0, qty * (Number(i.unit_price_snapshot) || 0) - (Number(i.line_discount) || 0)),
      paidLineTotal: paidMap.get(i.product_id) || 0,
      returnedQty,
      pendingReturnQty: pendingQty,
      returnableQty: Number(i.non_returnable) === 1 ? 0 : Math.max(0, qty - returnedQty - pendingQty),
    };
    if (canViewCost) {
      dto.unitCost = Number(i.unit_cost_snapshot) || 0;
    }
    return dto;
  });

  const returns = (row.returns || []).map((r) => ({
    id: r.id,
    reason: r.reason,
    restock: Boolean(r.restock),
    refundAmount: Number(r.refund_amount) || 0,
    status: r.status,
    statusLabel: RETURN_STATUS_LABELS[r.status] || r.status,
    createdByName: r.created_by_name,
    approvedByName: r.approved_by_name || null,
    createdAt: r.created_at,
    resolvedAt: r.resolved_at || null,
  }));

  return {
    ...toOrderSummaryDto(row),
    itemCount: items.length,
    totalQty: items.reduce((s, i) => s + i.qty, 0),
    items,
    returns,
    store: storeConfig || undefined,
  };
}

function toReturnSummaryDto(row) {
  return {
    id: row.id,
    orderId: row.order_id,
    customerName: row.customer_name || 'Khách lẻ',
    orderPaymentMethod: row.order_payment_method,
    orderPaymentMethodLabel: PAYMENT_METHOD_LABELS[row.order_payment_method] || row.order_payment_method,
    orderTotalAmount: Number(row.order_total_amount) || 0,
    orderCreatedAt: row.order_created_at,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    approvedBy: row.approved_by || null,
    approvedByName: row.approved_by_name || null,
    reason: row.reason,
    restock: Boolean(row.restock),
    refundAmount: Number(row.refund_amount) || 0,
    status: row.status,
    statusLabel: RETURN_STATUS_LABELS[row.status] || row.status,
    itemCount: Number(row.item_count) || 0,
    totalQty: Number(row.total_qty) || 0,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at || null,
  };
}

function toReturnDetailDto(row) {
  const items = (row.items || []).map((i) => ({
    id: i.id,
    productId: i.product_id,
    sku: i.sku,
    productName: i.product_name,
    unitName: i.unit_name,
    imageUrl: i.image_url,
    qty: Number(i.qty) || 0,
    unitPriceSnapshot: Number(i.unit_price_snapshot) || 0,
    purchasedQty: Number(i.purchased_qty) || 0,
    refundLineAmount: Number(i.refund_line_amount) || 0,
  }));
  return {
    ...toReturnSummaryDto(row),
    itemCount: items.length,
    totalQty: items.reduce((s, i) => s + i.qty, 0),
    items,
  };
}

class SalesService {
  constructor(db, repos, systemService) {
    this.db = db;
    this.repos = repos;
    this.systemService = systemService;
  }

  _getTaxRate() {
    const row = this.repos.thamSo.findByCode('TyLeVAT');
    const parsed = row ? Number(row.gia_tri) : 8;
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 8;
  }

  _getReturnWindowDays() {
    const row = this.repos.thamSo.findByCode('SoNgayChoPhepTraHang');
    const parsed = row ? Number(row.gia_tri) : 7;
    return Number.isFinite(parsed) && parsed >= 1 ? parsed : 7;
  }

  _getMaxCashierLineDiscountPct() {
    const row = this.repos.thamSo.findByCode('TyLeGiamGiaDongToiDa');
    const parsed = row ? Number(row.gia_tri) : 10;
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : 10;
  }

  // ─── PROMOTIONS (BR-04) ────────────────────────────────────────────────────

  listPromotions(filters = {}, { activeOnly = false } = {}) {
    const rows = this.repos.promotions.list({
      search: filters.search || '',
      status: activeOnly ? 'DangDienRa' : filters.status || '',
    });
    const today = todayYmdVn();
    const filtered = activeOnly
      ? rows.filter(
          (p) =>
            p.status === 'DangDienRa' &&
            p.start_date <= today &&
            today <= p.end_date &&
            Number(p.used_count) < Number(p.usage_limit),
        )
      : rows;
    const allRows = this.repos.promotions.list({});
    return {
      items: filtered.map((r) => toPromotionDto(r, this.repos.promotions.getProductIds(r.id))),
      summary: {
        total: allRows.length,
        activeCount: allRows.filter((r) => r.status === 'DangDienRa').length,
        upcomingCount: allRows.filter((r) => r.status === 'SapDienRa').length,
        pausedCount: allRows.filter((r) => r.status === 'TamDung').length,
        endedCount: allRows.filter((r) => ['KetThuc', 'DaHuy'].includes(r.status)).length,
        nearExpiryCount: allRows.filter((r) => r.scope === 'NEAR_EXPIRY').length,
      },
    };
  }

  getNearExpiryPromoSuggestions(days = '') {
    const defaultDays = Number(this.repos.thamSo?.findByCode?.('SoNgayCanhBaoCanDate')?.gia_tri) || 14;
    const maxDays =
      days !== '' && days !== undefined && days !== null
        ? Math.max(1, Math.min(90, Math.round(Number(days) || defaultDays)))
        : defaultDays;
    const today = todayYmdVn();
    const rows = this.repos.batches.findNearExpiryAndExpired({
      maxDays,
      includeExpired: false,
      refDate: today,
    });
    const byProd = new Map();
    for (const r of rows) {
      const daysLeft = diffDaysYmd(today, r.expiry_date);
      if (daysLeft === null || daysLeft <= 0) continue;
      const qty = Number(r.qty_remaining) || 0;
      const unitCost = Number(r.unit_cost) || Number(r.cost_price) || 0;
      if (!byProd.has(r.product_id)) {
        byProd.set(r.product_id, {
          productId: r.product_id,
          sku: r.sku,
          productName: r.product_name,
          categoryCode: r.category_code,
          categoryName: r.category_name,
          unitName: r.unit_name,
          imageUrl: r.image_url,
          thumbUrl: r.thumb_url || '',
          salePrice: Number(r.sale_price) || 0,
          costPrice: unitCost,
          earliestExpiryDate: r.expiry_date,
          minDaysLeft: daysLeft,
          nearExpiryQty: 0,
          atRiskCostValue: 0,
          batches: [],
        });
      }
      const entry = byProd.get(r.product_id);
      entry.nearExpiryQty += qty;
      entry.atRiskCostValue += qty * unitCost;
      if (r.expiry_date < entry.earliestExpiryDate) {
        entry.earliestExpiryDate = r.expiry_date;
        entry.minDaysLeft = daysLeft;
      }
      entry.batches.push({
        batchId: r.id,
        batchCode: r.batch_code,
        expiryDate: r.expiry_date,
        daysLeft,
        qtyRemaining: qty,
      });
    }
    const items = Array.from(byProd.values())
      .map((e) => ({
        ...e,
        suggestedDiscountPct: e.minDaysLeft <= 3 ? 50 : e.minDaysLeft <= 7 ? 35 : 25,
      }))
      .sort((a, b) => a.minDaysLeft - b.minDaysLeft || b.atRiskCostValue - a.atRiskCostValue);
    return {
      maxDays,
      items,
      summary: {
        productCount: items.length,
        totalNearExpiryQty: items.reduce((s, i) => s + i.nearExpiryQty, 0),
        totalAtRiskCostValue: items.reduce((s, i) => s + i.atRiskCostValue, 0),
      },
    };
  }

  _validatePromotionInput(input, existing = null) {
    const code = String(input?.code ?? existing?.code ?? '')
      .trim()
      .toUpperCase();
    const name = String(input?.name ?? existing?.name ?? '').trim();
    const discountType = String(input?.discountType ?? existing?.discount_type ?? 'PERCENT')
      .trim()
      .toUpperCase();
    const status = String(input?.status ?? existing?.status ?? 'DangDienRa').trim();
    const startDate = String(input?.startDate ?? existing?.start_date ?? '').trim();
    const endDate = String(input?.endDate ?? existing?.end_date ?? '').trim();
    const scope = String(input?.scope ?? existing?.scope ?? 'INVOICE')
      .trim()
      .toUpperCase();
    const categoryCode = String(input?.categoryCode ?? existing?.category_code ?? '').trim();
    const nearExpiryDays = parsePositiveInt(
      input?.nearExpiryDays !== undefined ? input.nearExpiryDays : existing?.near_expiry_days ?? 14,
      'Ngưỡng ngày cận date',
    );
    const productIds = Array.isArray(input?.productIds)
      ? [...new Set(input.productIds.map((p) => String(p || '').trim()).filter(Boolean))]
      : undefined;

    assertRule(/^[A-Z0-9_-]{3,30}$/.test(code), 'Mã khuyến mãi chỉ gồm chữ in hoa, số, gạch ngang/dưới (3–30 ký tự).', 400);
    assertRule(name.length >= 3 && name.length <= 160, 'Tên chương trình khuyến mãi phải từ 3 đến 160 ký tự.', 400);
    assertRule(['PERCENT', 'FIXED'].includes(discountType), 'Loại giảm giá phải là PERCENT (%) hoặc FIXED (₫).', 400);
    assertRule(
      ['INVOICE', 'CATEGORY', 'PRODUCT', 'NEAR_EXPIRY'].includes(scope),
      'Phạm vi khuyến mãi không hợp lệ (INVOICE / CATEGORY / PRODUCT / NEAR_EXPIRY).',
      400,
    );
    if (scope === 'CATEGORY') {
      assertRule(categoryCode.length > 0, 'Khuyến mãi theo danh mục bắt buộc chọn mã danh mục.', 400);
    }
    assertRule(
      ['SapDienRa', 'DangDienRa', 'TamDung', 'KetThuc'].includes(status),
      'Trạng thái khuyến mãi không hợp lệ (SapDienRa / DangDienRa / TamDung / KetThuc).',
      400,
    );

    const discountValue = parseNonNegativeInt(
      input?.discountValue !== undefined ? input.discountValue : existing?.discount_value,
      'Giá trị giảm',
    );
    if (discountType === 'PERCENT') {
      assertRule(discountValue >= 1 && discountValue <= 100, 'Tỷ lệ giảm (%) phải nằm trong khoảng 1 đến 100%.', 400);
    } else {
      assertRule(discountValue >= 1000 || discountValue === 0, 'Số tiền giảm cố định phải >= 0 ₫.', 400);
    }

    const minOrderAmount = parseNonNegativeInt(
      input?.minOrderAmount !== undefined ? input.minOrderAmount : existing?.min_order_amount ?? 0,
      'Giá trị đơn tối thiểu',
    );
    const maxDiscount = parseNonNegativeInt(
      input?.maxDiscount !== undefined ? input.maxDiscount : existing?.max_discount ?? 0,
      'Trần giảm tối đa',
    );
    const usageLimit = parsePositiveInt(
      input?.usageLimit !== undefined ? input.usageLimit : existing?.usage_limit ?? 100,
      'Giới hạn lượt dùng',
    );

    assertRule(/^\d{4}-\d{2}-\d{2}$/.test(startDate), 'Ngày bắt đầu không hợp lệ (YYYY-MM-DD).', 400);
    assertRule(/^\d{4}-\d{2}-\d{2}$/.test(endDate), 'Ngày kết thúc không hợp lệ (YYYY-MM-DD).', 400);
    assertRule(startDate <= endDate, 'Ngày bắt đầu phải nhỏ hơn hoặc bằng Ngày kết thúc (BR-04).', 400);

    if (existing && usageLimit < Number(existing.used_count)) {
      assertRule(
        false,
        `Giới hạn lượt dùng (${usageLimit}) không được nhỏ hơn số lượt đã sử dụng (${existing.used_count}).`,
        400,
      );
    }

    return {
      code,
      name,
      discount_type: discountType,
      discount_value: discountValue,
      min_order_amount: minOrderAmount,
      max_discount: discountType === 'PERCENT' ? maxDiscount : 0,
      start_date: startDate,
      end_date: endDate,
      usage_limit: usageLimit,
      scope,
      category_code: scope === 'CATEGORY' || scope === 'NEAR_EXPIRY' ? categoryCode : '',
      near_expiry_days: Math.min(365, nearExpiryDays),
      product_ids: productIds,
      status,
    };
  }

  createPromotion(actor, input) {
    const clean = this._validatePromotionInput(input);
    const dup = this.repos.promotions.findByCode(clean.code);
    if (dup) {
      throw new ConflictException(`Mã khuyến mãi "${clean.code}" đã tồn tại trong hệ thống.`);
    }

    const created = withTransaction(this.db, () => {
      const promo = this.repos.promotions.create(clean);
      const pids = this.repos.promotions.getProductIds(promo.id);
      this.repos.auditLogs.append({
        actor,
        action: 'PROMOTION_CREATE',
        entityType: 'Promotion',
        entityId: promo.id,
        detail: `Tạo khuyến mãi ${promo.code} (${promo.name} · phạm vi ${promo.scope})`,
        after: toPromotionDto(promo, pids),
      });
      return { promo, pids };
    });
    return toPromotionDto(created.promo, created.pids);
  }

  updatePromotion(actor, id, input) {
    const existing = this.repos.promotions.findById(id);
    if (!existing) throw new NotFoundException(`Không tìm thấy chương trình khuyến mãi "${id}".`);
    const clean = this._validatePromotionInput(input, existing);
    const dup = this.repos.promotions.findByCode(clean.code);
    if (dup && dup.id !== id) {
      throw new ConflictException(`Mã khuyến mãi "${clean.code}" đã được chương trình khác sử dụng.`);
    }

    const updated = withTransaction(this.db, () => {
      const oldPids = this.repos.promotions.getProductIds(id);
      const promo = this.repos.promotions.update(id, clean);
      const newPids = this.repos.promotions.getProductIds(id);
      this.repos.auditLogs.append({
        actor,
        action: 'PROMOTION_UPDATE',
        entityType: 'Promotion',
        entityId: id,
        detail: `Cập nhật khuyến mãi ${promo.code} (${promo.status})`,
        before: toPromotionDto(existing, oldPids),
        after: toPromotionDto(promo, newPids),
      });
      return { promo, pids: newPids };
    });
    return toPromotionDto(updated.promo, updated.pids);
  }

  setPromotionStatus(actor, id, nextStatus) {
    const existing = this.repos.promotions.findById(id);
    if (!existing) throw new NotFoundException(`Không tìm thấy chương trình khuyến mãi "${id}".`);
    const cleanStatus = String(nextStatus || '').trim();
    assertRule(
      ['SapDienRa', 'DangDienRa', 'TamDung', 'KetThuc'].includes(cleanStatus),
      'Trạng thái khuyến mãi không hợp lệ (SapDienRa / DangDienRa / TamDung / KetThuc).',
      400,
    );

    const updated = withTransaction(this.db, () => {
      const promo = this.repos.promotions.update(id, { status: cleanStatus });
      this.repos.auditLogs.append({
        actor,
        action: 'PROMOTION_STATUS',
        entityType: 'Promotion',
        entityId: id,
        detail: `Chuyển trạng thái khuyến mãi ${promo.code}: ${existing.status} → ${cleanStatus}`,
        before: { status: existing.status },
        after: { status: cleanStatus },
      });
      return promo;
    });
    return toPromotionDto(updated, this.repos.promotions.getProductIds(id));
  }

  validatePromotionForSubtotal(codeOrId, subtotal, nowDate = new Date()) {
    const key = String(codeOrId || '').trim();
    assertRule(key.length > 0, 'Vui lòng nhập hoặc chọn mã khuyến mãi.', 400);
    const promo = this.repos.promotions.findByCode(key) || this.repos.promotions.findById(key);
    assertRule(Boolean(promo), `Mã khuyến mãi "${key}" không tồn tại trong hệ thống (BR-04).`, 400);

    const safeSubtotal = parseNonNegativeInt(subtotal, 'Tạm tính hóa đơn');
    assertRule(
      promo.status === 'DangDienRa',
      `Mã khuyến mãi "${promo.code}" hiện ở trạng thái "${PROMO_STATUS_LABELS[promo.status] || promo.status}", không thể áp dụng (BR-04).`,
      400,
    );

    const today = todayYmdVn(nowDate);
    assertRule(
      today >= promo.start_date,
      `Mã khuyến mãi "${promo.code}" chưa đến ngày bắt đầu (${promo.start_date}) (BR-04).`,
      400,
    );
    assertRule(
      today <= promo.end_date,
      `Mã khuyến mãi "${promo.code}" đã hết hạn sử dụng (${promo.end_date}) (BR-04).`,
      400,
    );
    assertRule(
      Number(promo.used_count) < Number(promo.usage_limit),
      `Mã khuyến mãi "${promo.code}" đã hết lượt sử dụng (${promo.used_count}/${promo.usage_limit}) (BR-04).`,
      400,
    );
    assertRule(
      safeSubtotal >= Number(promo.min_order_amount),
      `Đơn hàng chưa đạt giá trị tối thiểu ${Number(promo.min_order_amount).toLocaleString('vi-VN')} ₫ để áp dụng mã "${promo.code}" (cần thêm ${(Number(promo.min_order_amount) - safeSubtotal).toLocaleString('vi-VN')} ₫) (BR-04).`,
      400,
    );

    const discountAmount = computePromotionDiscount(promo, safeSubtotal);
    const taxRate = this._getTaxRate();
    const afterDiscount = Math.max(0, safeSubtotal - discountAmount);
    const taxAmount = Math.round((afterDiscount * taxRate) / 100);
    const pids = this.repos.promotions.getProductIds(promo.id);
    return {
      promotion: toPromotionDto(promo, pids),
      promoRow: promo,
      productIds: pids,
      subtotal: safeSubtotal,
      discountAmount,
      afterDiscount,
      taxRate,
      taxAmount,
      totalAmount: Math.max(0, afterDiscount + taxAmount),
    };
  }

  _computeEligibleSubtotalForPromotion(promo, productIds, resolvedLines, today) {
    const scope = promo.scope || 'INVOICE';
    const fullSubtotal = resolvedLines.reduce(
      (s, l) => s + Math.max(0, l.qty * l.unitPriceSnapshot - l.lineDiscount),
      0,
    );
    if (scope === 'INVOICE') return fullSubtotal;

    const pidSet = new Set(productIds || []);
    if (scope === 'CATEGORY') {
      return resolvedLines
        .filter((l) => l.product.category_code === promo.category_code)
        .reduce((s, l) => s + Math.max(0, l.qty * l.unitPriceSnapshot - l.lineDiscount), 0);
    }
    if (scope === 'PRODUCT') {
      return resolvedLines
        .filter((l) => pidSet.has(l.product.id))
        .reduce((s, l) => s + Math.max(0, l.qty * l.unitPriceSnapshot - l.lineDiscount), 0);
    }
    if (scope === 'NEAR_EXPIRY') {
      const maxDays = Number(promo.near_expiry_days) || 14;
      let eligible = 0;
      for (const l of resolvedLines) {
        if (pidSet.size > 0 && !pidSet.has(l.product.id)) continue;
        if (promo.category_code && l.product.category_code !== promo.category_code) continue;
        // Chỉ giảm giá cho số đơn vị thực sự xuất từ lô cận date (0 < daysLeft <= maxDays)
        const nearQty = (l.batchDeductions || []).reduce((acc, bd) => {
          if (!bd.expiryDate) return acc;
          const dl = diffDaysYmd(today, bd.expiryDate);
          if (dl !== null && dl > 0 && dl <= maxDays) {
            return acc + bd.takeQty;
          }
          return acc;
        }, 0);
        if (nearQty > 0 && l.qty > 0) {
          const lineNet = Math.max(0, l.qty * l.unitPriceSnapshot - l.lineDiscount);
          eligible += Math.round((lineNet * nearQty) / l.qty);
        }
      }
      return eligible;
    }
    return fullSubtotal;
  }

  // ─── VOUCHERS (PHASE 2 — BƯỚC 2a) ─────────────────────────────────────────

  listVouchers(filters = {}, { activeOnly = false } = {}) {
    const rows = this.repos.vouchers.list({
      search: filters.search || '',
      status: activeOnly ? 'DangDienRa' : filters.status || '',
    });
    const today = todayYmdVn();
    const filtered = activeOnly
      ? rows.filter(
          (v) =>
            v.status === 'DangDienRa' &&
            v.start_date <= today &&
            today <= v.end_date &&
            Number(v.used_count) < Number(v.usage_limit),
        )
      : rows;
    const allRows = this.repos.vouchers.list({});
    return {
      items: filtered.map(toVoucherDto),
      summary: {
        total: allRows.length,
        activeCount: allRows.filter((r) => r.status === 'DangDienRa').length,
        pausedCount: allRows.filter((r) => r.status === 'TamDung').length,
        endedCount: allRows.filter((r) => ['KetThuc', 'DaHuy'].includes(r.status)).length,
        totalRedeemed: allRows.reduce((s, r) => s + (Number(r.used_count) || 0), 0),
      },
    };
  }

  _validateVoucherInput(input, existing = null) {
    const code = String(input?.code ?? existing?.code ?? '')
      .trim()
      .toUpperCase();
    const name = String(input?.name ?? existing?.name ?? '').trim();
    const discountType = String(input?.discountType ?? existing?.discount_type ?? 'FIXED')
      .trim()
      .toUpperCase();
    const status = String(input?.status ?? existing?.status ?? 'DangDienRa').trim();
    const startDate = String(input?.startDate ?? existing?.start_date ?? '').trim();
    const endDate = String(input?.endDate ?? existing?.end_date ?? '').trim();

    assertRule(/^[A-Z0-9_-]{3,32}$/.test(code), 'Mã Voucher chỉ gồm chữ in hoa, số, gạch ngang/dưới (3–32 ký tự).', 400);
    assertRule(name.length >= 3 && name.length <= 160, 'Tên Voucher phải từ 3 đến 160 ký tự.', 400);
    assertRule(['PERCENT', 'FIXED'].includes(discountType), 'Loại giảm giá Voucher phải là PERCENT (%) hoặc FIXED (₫).', 400);
    assertRule(
      ['SapDienRa', 'DangDienRa', 'TamDung', 'KetThuc'].includes(status),
      'Trạng thái Voucher không hợp lệ (SapDienRa / DangDienRa / TamDung / KetThuc).',
      400,
    );

    const discountValue = parseNonNegativeInt(
      input?.discountValue !== undefined ? input.discountValue : existing?.discount_value,
      'Giá trị giảm Voucher',
    );
    if (discountType === 'PERCENT') {
      assertRule(discountValue >= 1 && discountValue <= 100, 'Tỷ lệ giảm Voucher (%) phải từ 1 đến 100%.', 400);
    } else {
      assertRule(discountValue >= 1000, 'Số tiền giảm Voucher cố định phải tối thiểu 1.000 ₫.', 400);
    }

    const minOrderAmount = parseNonNegativeInt(
      input?.minOrderAmount !== undefined ? input.minOrderAmount : existing?.min_order_amount ?? 0,
      'Giá trị đơn tối thiểu',
    );
    const maxDiscount = parseNonNegativeInt(
      input?.maxDiscount !== undefined ? input.maxDiscount : existing?.max_discount ?? (discountType === 'FIXED' ? discountValue : 0),
      'Trần giảm tối đa',
    );
    const usageLimit = parsePositiveInt(
      input?.usageLimit !== undefined ? input.usageLimit : existing?.usage_limit ?? 100,
      'Giới hạn lượt dùng Voucher',
    );
    const maxUsesPerCustomer = parsePositiveInt(
      input?.maxUsesPerCustomer !== undefined ? input.maxUsesPerCustomer : existing?.max_uses_per_customer ?? 1,
      'Số lần dùng tối đa / khách',
    );

    assertRule(/^\d{4}-\d{2}-\d{2}$/.test(startDate), 'Ngày bắt đầu Voucher không hợp lệ (YYYY-MM-DD).', 400);
    assertRule(/^\d{4}-\d{2}-\d{2}$/.test(endDate), 'Ngày kết thúc Voucher không hợp lệ (YYYY-MM-DD).', 400);
    assertRule(startDate <= endDate, 'Ngày bắt đầu Voucher phải nhỏ hơn hoặc bằng Ngày kết thúc.', 400);

    if (existing && usageLimit < Number(existing.used_count)) {
      assertRule(false, `Giới hạn lượt dùng (${usageLimit}) không được nhỏ hơn lượt đã dùng (${existing.used_count}).`, 400);
    }

    return {
      code,
      name,
      discount_type: discountType,
      discount_value: discountValue,
      min_order_amount: minOrderAmount,
      max_discount: discountType === 'PERCENT' ? maxDiscount : discountValue,
      start_date: startDate,
      end_date: endDate,
      usage_limit: usageLimit,
      max_uses_per_customer: maxUsesPerCustomer,
      status,
    };
  }

  createVoucher(actor, input) {
    const clean = this._validateVoucherInput(input);
    if (this.repos.vouchers.findByCode(clean.code)) {
      throw new ConflictException(`Mã Voucher "${clean.code}" đã tồn tại trong hệ thống.`);
    }
    const created = withTransaction(this.db, () => {
      const v = this.repos.vouchers.create(clean);
      this.repos.auditLogs.append({
        actor,
        action: 'VOUCHER_CREATE',
        entityType: 'Voucher',
        entityId: v.id,
        detail: `Tạo mã Voucher ${v.code} (${v.name})`,
        after: toVoucherDto(v),
      });
      return v;
    });
    return toVoucherDto(created);
  }

  bulkGenerateVouchers(actor, input) {
    const prefix = String(input?.prefix || 'RFVC')
      .trim()
      .toUpperCase();
    assertRule(/^[A-Z0-9_-]{2,14}$/.test(prefix), 'Tiền tố phát hành hàng loạt gồm 2–14 ký tự chữ hoa/số.', 400);
    const count = parsePositiveInt(input?.count ?? 5, 'Số lượng Voucher cần phát hành');
    assertRule(count <= 100, 'Mỗi đợt phát hành hàng loạt tối đa 100 mã Voucher.', 400);

    const template = this._validateVoucherInput({
      ...input,
      code: `${prefix}-SAMPLE01`,
      usageLimit: input?.usageLimit ?? 1,
      maxUsesPerCustomer: input?.maxUsesPerCustomer ?? 1,
    });

    const created = withTransaction(this.db, () => {
      const batch = [];
      for (let idx = 1; idx <= count; idx += 1) {
        let code = '';
        for (let attempt = 0; attempt < 20; attempt += 1) {
          const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
          const candidate = `${prefix}-${String(idx).padStart(2, '0')}${rand}`;
          if (!this.repos.vouchers.findByCode(candidate)) {
            code = candidate;
            break;
          }
        }
        assertRule(code.length > 0, 'Không thể sinh mã Voucher duy nhất, vui lòng đổi tiền tố.', 409);
        const v = this.repos.vouchers.create({
          ...template,
          code,
          name: `${template.name} (#${idx})`,
        });
        batch.push(toVoucherDto(v));
      }
      this.repos.auditLogs.append({
        actor,
        action: 'VOUCHER_BULK_CREATE',
        entityType: 'Voucher',
        entityId: prefix,
        detail: `Phát hành hàng loạt ${batch.length} mã Voucher (tiền tố ${prefix})`,
        after: { prefix, count: batch.length, sampleCodes: batch.slice(0, 5).map((b) => b.code) },
      });
      return batch;
    });

    return { items: created, count: created.length };
  }

  updateVoucher(actor, id, input) {
    const existing = this.repos.vouchers.findById(id);
    if (!existing) throw new NotFoundException(`Không tìm thấy Voucher mã "${id}".`);
    const clean = this._validateVoucherInput(input, existing);
    const updated = withTransaction(this.db, () => {
      const v = this.repos.vouchers.update(id, clean);
      this.repos.auditLogs.append({
        actor,
        action: 'VOUCHER_UPDATE',
        entityType: 'Voucher',
        entityId: id,
        detail: `Cập nhật Voucher ${v.code} (${v.status})`,
        before: toVoucherDto(existing),
        after: toVoucherDto(v),
      });
      return v;
    });
    return toVoucherDto(updated);
  }

  setVoucherStatus(actor, id, nextStatus) {
    const existing = this.repos.vouchers.findById(id);
    if (!existing) throw new NotFoundException(`Không tìm thấy Voucher mã "${id}".`);
    const cleanStatus = String(nextStatus || '').trim();
    assertRule(
      ['SapDienRa', 'DangDienRa', 'TamDung', 'KetThuc'].includes(cleanStatus),
      'Trạng thái Voucher không hợp lệ (SapDienRa / DangDienRa / TamDung / KetThuc).',
      400,
    );
    const updated = withTransaction(this.db, () => {
      const v = this.repos.vouchers.update(id, { status: cleanStatus });
      this.repos.auditLogs.append({
        actor,
        action: 'VOUCHER_STATUS',
        entityType: 'Voucher',
        entityId: id,
        detail: `Chuyển trạng thái Voucher ${v.code}: ${existing.status} → ${cleanStatus}`,
        before: { status: existing.status },
        after: { status: cleanStatus },
      });
      return v;
    });
    return toVoucherDto(updated);
  }

  validateVoucher(codeOrId, subtotal, customerId = null, nowDate = new Date()) {
    const key = String(codeOrId || '').trim();
    assertRule(key.length > 0, 'Vui lòng nhập mã Voucher.', 400);
    const v = this.repos.vouchers.findByCode(key) || this.repos.vouchers.findById(key);
    assertRule(Boolean(v), `Mã Voucher "${key}" không tồn tại trong hệ thống.`, 400);

    const safeSubtotal = parseNonNegativeInt(subtotal, 'Tạm tính hóa đơn');
    assertRule(
      v.status === 'DangDienRa',
      `Mã Voucher "${v.code}" hiện ở trạng thái "${VOUCHER_STATUS_LABELS[v.status] || v.status}", không thể áp dụng.`,
      400,
    );
    const today = todayYmdVn(nowDate);
    assertRule(today >= v.start_date, `Mã Voucher "${v.code}" chưa đến ngày hiệu lực (${v.start_date}).`, 400);
    assertRule(today <= v.end_date, `Mã Voucher "${v.code}" đã hết hạn sử dụng (${v.end_date}).`, 400);
    assertRule(
      Number(v.used_count) < Number(v.usage_limit),
      `Mã Voucher "${v.code}" đã hết lượt sử dụng (${v.used_count}/${v.usage_limit}).`,
      400,
    );
    assertRule(
      safeSubtotal >= Number(v.min_order_amount),
      `Đơn hàng chưa đạt giá trị tối thiểu ${Number(v.min_order_amount).toLocaleString('vi-VN')} ₫ để áp dụng Voucher "${v.code}".`,
      400,
    );
    if (customerId) {
      const custUses = this.repos.vouchers.countCustomerUses(v.id, customerId);
      assertRule(
        custUses < Number(v.max_uses_per_customer || 1),
        `Khách hàng đã sử dụng hết giới hạn Voucher "${v.code}" (${custUses}/${v.max_uses_per_customer}).`,
        400,
      );
    }

    const discountAmount = computePromotionDiscount(v, safeSubtotal);
    const taxRate = this._getTaxRate();
    const afterDiscount = Math.max(0, safeSubtotal - discountAmount);
    const taxAmount = Math.round((afterDiscount * taxRate) / 100);
    return {
      voucher: toVoucherDto(v),
      voucherRow: v,
      subtotal: safeSubtotal,
      discountAmount,
      afterDiscount,
      taxRate,
      taxAmount,
      totalAmount: Math.max(0, afterDiscount + taxAmount),
    };
  }

  // ─── CASHIER SHIFTS (PHASE 2 — BƯỚC 2c) ───────────────────────────────────

  getCurrentShift(actor) {
    const open = this.repos.shifts.findOpenByCashier(actor.id);
    if (!open) return { shift: null };
    const metrics = this.repos.shifts.computeShiftMetrics(open.id, open.cashier_id, open.opened_at);
    return { shift: toShiftDto(open, metrics) };
  }

  listShifts(actor, filters = {}) {
    const cashierId = actor.role_code === 'CASHIER' ? actor.id : String(filters.cashierId || '').trim();
    const rows = this.repos.shifts.list({
      cashierId,
      status: String(filters.status || '').trim(),
      limit: filters.limit || 30,
    });
    const items = rows.map((r) => {
      if (r.status === 'DangMo') {
        const metrics = this.repos.shifts.computeShiftMetrics(r.id, r.cashier_id, r.opened_at);
        return toShiftDto(r, metrics);
      }
      return toShiftDto(r);
    });
    return {
      items,
      summary: {
        total: items.length,
        openCount: items.filter((s) => s.status === 'DangMo').length,
        closedCount: items.filter((s) => s.status === 'DaDong').length,
      },
    };
  }

  openShift(actor, input = {}) {
    const existing = this.repos.shifts.findOpenByCashier(actor.id);
    if (existing) {
      throw new ConflictException(`Thu ngân "${actor.full_name}" đang có ca mở (${existing.id}). Vui lòng chốt ca hiện tại trước khi mở ca mới.`);
    }
    const openingCash = parseNonNegativeInt(input?.openingCash ?? 0, 'Tiền đầu ca');
    const note = String(input?.note || '').trim().slice(0, 300);

    const created = withTransaction(this.db, () => {
      const s = this.repos.shifts.open({ cashierId: actor.id, openingCash, note });
      this.repos.auditLogs.append({
        actor,
        action: 'SHIFT_OPEN',
        entityType: 'CashierShift',
        entityId: s.id,
        detail: `Mở ca thu ngân ${s.id} · Tiền đầu ca ${openingCash.toLocaleString('vi-VN')} ₫`,
        after: { shiftId: s.id, openingCash },
      });
      return s;
    });
    return toShiftDto(created, { orderCount: 0, cashSales: 0, nonCashSales: 0, cashRefunds: 0 });
  }

  closeShift(actor, shiftId, input = {}) {
    const closed = withTransaction(this.db, () => {
      const existing = this.repos.shifts.findById(shiftId);
      if (!existing) throw new NotFoundException(`Không tìm thấy ca thu ngân mã "${shiftId}".`);
      if (existing.status !== 'DangMo') {
        throw new ConflictException(`Ca thu ngân "${shiftId}" đã được chốt trước đó.`);
      }
      if (actor.role_code === 'CASHIER' && existing.cashier_id !== actor.id) {
        throw new ForbiddenException('Thu ngân chỉ được chốt ca do chính mình mở.');
      }

      const actualCash = parseNonNegativeInt(input?.actualCash, 'Tiền mặt thực đếm cuối ca');
      const note = String(input?.note || '').trim().slice(0, 300);
      const metrics = this.repos.shifts.computeShiftMetrics(existing.id, existing.cashier_id, existing.opened_at);
      const expectedCash = Math.max(0, Number(existing.opening_cash) + metrics.cashSales - metrics.cashRefunds);
      const variance = actualCash - expectedCash;

      if (variance !== 0) {
        assertRule(
          note.length >= 3,
          `Tiền mặt cuối ca lệch ${variance > 0 ? `+${variance.toLocaleString('vi-VN')}` : variance.toLocaleString('vi-VN')} ₫ so với dự kiến (${expectedCash.toLocaleString('vi-VN')} ₫): bắt buộc nhập ghi chú giải trình tối thiểu 3 ký tự.`,
          400,
        );
      }

      const finalNote = note || existing.note || '';
      const updated = this.repos.shifts.close(existing.id, {
        expectedCash,
        actualCash,
        variance,
        cashSales: metrics.cashSales,
        cashRefunds: metrics.cashRefunds,
        nonCashSales: metrics.nonCashSales,
        orderCount: metrics.orderCount,
        note: finalNote,
      });

      this.repos.auditLogs.append({
        actor,
        action: 'SHIFT_CLOSE',
        entityType: 'CashierShift',
        entityId: updated.id,
        detail: `Chốt ca ${updated.id}: dự kiến ${expectedCash.toLocaleString('vi-VN')} ₫, thực đếm ${actualCash.toLocaleString('vi-VN')} ₫, chênh lệch ${variance.toLocaleString('vi-VN')} ₫ (${metrics.orderCount} đơn)`,
        after: {
          shiftId: updated.id,
          expectedCash,
          actualCash,
          variance,
          orderCount: metrics.orderCount,
          note: finalNote,
        },
      });
      return updated;
    });
    return toShiftDto(closed);
  }

  // ─── CUSTOMERS ─────────────────────────────────────────────────────────────

  listCustomers(filters = {}) {
    const rows = this.repos.customers.list({
      search: filters.search || '',
      status: filters.status || '',
    });
    return { items: rows.map(toCustomerDto) };
  }

  createCustomer(actor, input) {
    const name = String(input?.name || '').trim();
    const phone = String(input?.phone || '').trim();
    const email = String(input?.email || '').trim();
    assertRule(name.length >= 2 && name.length <= 150, 'Họ tên khách hàng phải từ 2 đến 150 ký tự.', 400);
    assertRule(/^[0-9+\s().-]{8,20}$/.test(phone), 'Số điện thoại khách hàng không hợp lệ (8–20 ký tự số).', 400);
    if (this.repos.customers.findByPhone(phone)) {
      throw new ConflictException(`Số điện thoại "${phone}" đã tồn tại ở khách hàng khác.`);
    }

    const created = withTransaction(this.db, () => {
      const cust = this.repos.customers.create({ name, phone, email, status: 'HoatDong' });
      this.repos.auditLogs.append({
        actor,
        action: 'CUSTOMER_CREATE',
        entityType: 'Customer',
        entityId: cust.id,
        detail: `Thêm khách hàng ${cust.name} (${cust.phone})`,
        after: { id: cust.id, name: cust.name, phone: cust.phone },
      });
      return cust;
    });
    return toCustomerDto(created);
  }

  updateCustomer(actor, id, input) {
    const existing = this.repos.customers.findById(id);
    if (!existing) throw new NotFoundException(`Không tìm thấy khách hàng mã "${id}".`);
    const name = String(input?.name ?? existing.name).trim();
    const phone = String(input?.phone ?? existing.phone).trim();
    const email = String(input?.email ?? existing.email).trim();
    const status = String(input?.status ?? existing.status).trim();
    assertRule(name.length >= 2 && name.length <= 150, 'Họ tên khách hàng phải từ 2 đến 150 ký tự.', 400);
    assertRule(/^[0-9+\s().-]{8,20}$/.test(phone), 'Số điện thoại khách hàng không hợp lệ.', 400);
    assertRule(['HoatDong', 'TamNgung'].includes(status), 'Trạng thái khách hàng không hợp lệ.', 400);
    const dup = this.repos.customers.findByPhone(phone);
    if (dup && dup.id !== id) {
      throw new ConflictException(`Số điện thoại "${phone}" đã thuộc về khách hàng khác.`);
    }

    const updated = withTransaction(this.db, () => {
      const cust = this.repos.customers.update(id, { name, phone, email, status });
      this.repos.auditLogs.append({
        actor,
        action: 'CUSTOMER_UPDATE',
        entityType: 'Customer',
        entityId: id,
        detail: `Cập nhật khách hàng ${cust.name} (${cust.status})`,
      });
      return cust;
    });
    return toCustomerDto(updated);
  }

  getCustomerHistory(id) {
    const cust = this.repos.customers.findById(id);
    if (!cust) throw new NotFoundException(`Không tìm thấy khách hàng mã "${id}".`);
    const orders = this.repos.orders.list({ customerId: id }).map(toOrderSummaryDto);
    return {
      customer: toCustomerDto(cust),
      orders,
    };
  }

  // ─── POS CHECKOUT & ORDERS (BR-03, BR-04, BR-05, BR-06) ────────────────────

  listOrders(filters = {}) {
    const fromDate = String(filters.fromDate || '').trim();
    const toDate = String(filters.toDate || '').trim();
    validateDateRange(fromDate, toDate);

    const rows = this.repos.orders.list({
      search: filters.search || '',
      status: filters.status || '',
      paymentMethod: filters.paymentMethod || '',
      customerId: filters.customerId || '',
      fromDate,
      toDate,
    });
    const allRows = this.repos.orders.list({});
    const activeOrders = allRows.filter((o) => o.status !== 'DaHuy');
    const grossTotal = activeOrders.reduce((s, o) => s + (Number(o.total_amount) || 0), 0);
    const refundedTotal = activeOrders.reduce((s, o) => s + (Number(o.refunded_amount) || 0), 0);

    return {
      items: rows.map(toOrderSummaryDto),
      summary: {
        total: allRows.length,
        paidCount: allRows.filter((o) => o.status === 'DaThanhToan').length,
        returnedCount: allRows.filter((o) => ['TraMotPhan', 'DaHoanTra'].includes(o.status)).length,
        grossRevenue: grossTotal,
        refundedTotal,
        netRevenue: Math.max(0, grossTotal - refundedTotal),
      },
    };
  }

  getOrder(id, { canViewCost = false } = {}) {
    const found = this.repos.orders.findById(id);
    if (!found) throw new NotFoundException(`Không tìm thấy hóa đơn mã "${id}".`);
    const pendingReturnMap = this.repos.returns.getPendingQtyMap(id);
    const storeConfig = this.systemService ? this.systemService.getPublicStoreConfig() : null;
    return toOrderDetailDto(found, { canViewCost, storeConfig, pendingReturnMap });
  }

  /**
   * BR-03, BR-04, BR-05, BR-06: Thanh toán POS trong 1 Transaction nguyên tử ở DAL:
   * (1) Khóa & kiểm tra sản phẩm DangKinhDoanh + tồn khả dụng (CẤM xuất âm kho), đóng băng giá bán từ DB
   * (2) Kiểm tra lại khuyến mãi hợp lệ (nếu có) & tính tiền đúng thứ tự BR-04 với VAT từ THAM_SO
   * (3) Xác thực thanh toán Tiền mặt (>= TongThanhToan) hoặc VietQR/Thẻ (có mã tham chiếu)
   * (4) Lưu orders + order_items
   * (5) Trừ stock_qty từng sản phẩm
   * (6) Ghi stock_movements (BAN_HANG)
   * (7) Tăng used_count khuyến mãi & ghi audit_logs (ORDER_CHECKOUT)
   */
  checkout(actor, input, options = {}) {
    const rawItems = input?.items;
    assertRule(Array.isArray(rawItems) && rawItems.length >= 1, 'Giỏ hàng trống: vui lòng chọn tối thiểu 1 sản phẩm để thanh toán (BR-03).', 400);

    // BƯỚC 3: Khóa chặt KHÔNG cho phép thanh toán một phần, tách nhiều phương thức hoặc ghi nợ tại POS
    const hasForbiddenPartial =
      Boolean(input?.partial) ||
      Boolean(input?.isPartial) ||
      Boolean(input?.partialPayment) ||
      Boolean(input?.splitPayment) ||
      Boolean(input?.debt) ||
      Boolean(input?.allowDebt) ||
      Array.isArray(input?.payments);
    assertRule(
      !hasForbiddenPartial,
      'POS bán lẻ chỉ hỗ trợ thanh toán đủ 100% một lần — nghiêm cấm thanh toán một phần, chia đợt hoặc ghi nợ khách lẻ.',
      400,
    );

    const rawMethod = String(input?.paymentMethod || input?.payment || 'CASH')
      .trim()
      .toUpperCase();
    assertRule(
      !/(PARTIAL|DEBT|SPLIT|CONG_NO)/.test(rawMethod),
      'POS bán lẻ chỉ hỗ trợ thanh toán đủ 100% một lần — không hỗ trợ ghi nợ hay trả góp.',
      400,
    );
    const methodMap = { CASH: 'CASH', TIENMAT: 'CASH', VIETQR: 'VIETQR', TRANSFER: 'VIETQR', CARD: 'CARD' };
    const paymentMethod = methodMap[rawMethod] || '';
    assertRule(
      ['CASH', 'VIETQR', 'CARD'].includes(paymentMethod),
      'Phương thức thanh toán không hợp lệ (CASH / VIETQR / CARD).',
      400,
    );

    const promoInput = String(input?.promotionCode || input?.promotionId || '').trim();
    const voucherInput = String(input?.voucherCode || input?.voucherId || '').trim();
    // BƯỚC 2a: Chỉ cho phép MỘT trong hai hình thức giảm giá hóa đơn (XOR)
    assertRule(
      !(promoInput && voucherInput),
      'Mỗi hóa đơn chỉ được áp dụng MỘT hình thức giảm giá hóa đơn: Mã Voucher HOẶC Chương trình khuyến mãi (không được dùng đồng thời cả hai).',
      400,
    );

    const customerId = String(input?.customerId || '').trim() || null;
    const note = String(input?.note || '').trim();
    const paymentRef = String(input?.paymentRef || '').trim();

    const createdOrder = withTransaction(this.db, () => {
      if (customerId) {
        const cust = this.repos.customers.findById(customerId);
        assertRule(Boolean(cust), `Khách hàng mã "${customerId}" không tồn tại.`, 400);
        assertRule(cust.status === 'HoatDong', `Khách hàng "${cust.name}" đang tạm ngừng, không thể gắn hóa đơn.`, 400);
      }

      // Bước 1: Kiểm tra tồn kho khả dụng + đóng băng giá bán & giá vốn trực tiếp từ DB (không tin giá từ client)
      const seen = new Set();
      const resolvedLines = [];
      for (const raw of rawItems) {
        const productId = String(raw?.productId || raw?.product_id || raw?.id || '').trim();
        assertRule(productId.length > 0, 'Thiếu mã sản phẩm trong đơn hàng.', 400);
        assertRule(!seen.has(productId), `Sản phẩm "${productId}" bị trùng dòng trong cùng đơn hàng.`, 400);
        seen.add(productId);

        const qty = parsePositiveInt(raw?.qty, `Số lượng bán của ${productId}`);
        const lineDiscount = parseNonNegativeInt(raw?.lineDiscount ?? 0, `Giảm giá dòng hàng ${productId}`);

        const product = this.repos.products.findById(productId);
        assertRule(Boolean(product), `Sản phẩm mã "${productId}" không tồn tại.`, 400);
        assertRule(
          product.status === 'DangKinhDoanh',
          `Sản phẩm "${product.name}" (${product.sku}) đã ngừng kinh doanh, không thể bán (BR-03).`,
          400,
        );

        const availableStock = Number(product.stock_qty) || 0;
        const today = todayYmdVn();
        const fefoBatches = this.repos.batches ? this.repos.batches.findSalableFefo(product.id, today) : [];
        const expiredBatches = this.repos.batches ? this.repos.batches.findExpiredByProduct(product.id, today) : [];
        const salableBatchQty = fefoBatches.reduce((s, b) => s + (Number(b.qty_remaining) || 0), 0);
        const expiredQty = expiredBatches.reduce((s, b) => s + (Number(b.qty_remaining) || 0), 0);

        if (fefoBatches.length > 0 || expiredBatches.length > 0) {
          if (qty > salableBatchQty) {
            if (expiredQty > 0) {
              assertRule(
                false,
                `Sản phẩm "${product.name}" (${product.sku}) chỉ còn ${salableBatchQty} đv còn hạn sử dụng (đã khóa bán ${expiredQty} đv hết hạn — cần xuất hủy lô hết hạn). Không thể bán ${qty} đv.`,
                400,
              );
            }
            assertRule(
              false,
              `Không đủ tồn kho khả dụng cho "${product.name}" (${product.sku}): yêu cầu ${qty}, tồn còn hạn ${salableBatchQty}. Nghiêm cấm xuất âm kho (BR-03).`,
              400,
            );
          }
        } else {
          assertRule(
            qty <= availableStock,
            `Không đủ tồn kho cho "${product.name}" (${product.sku}): yêu cầu ${qty}, tồn khả dụng ${availableStock}. Nghiêm cấm xuất âm kho (BR-03).`,
            400,
          );
        }

        const unitPriceSnapshot = Number(product.sale_price);
        const unitCostSnapshot = Number(product.cost_price);
        const lineGross = qty * unitPriceSnapshot;
        assertRule(
          lineDiscount <= lineGross,
          `Giảm giá dòng hàng của "${product.name}" vượt quá thành tiền dòng hàng.`,
          400,
        );

        // M4 Patch (Điểm 1): Giới hạn giảm giá dòng hàng theo RBAC & THAM_SO (TyLeGiamGiaDongToiDa)
        if (lineDiscount > 0 && actor.role_code === 'CASHIER') {
          const maxPct = this._getMaxCashierLineDiscountPct();
          const maxAllowed = Math.round((lineGross * maxPct) / 100);
          if (lineDiscount > maxAllowed) {
            throw new ForbiddenException(
              `Vượt hạn mức giảm giá tay của Thu ngân cho "${product.name}": tối đa ${maxPct}% (${maxAllowed.toLocaleString('vi-VN')} ₫ theo THAM_SO.TyLeGiamGiaDongToiDa). Yêu cầu Quản lý / Admin thực hiện.`,
            );
          }
        }

        // Lập kế hoạch trừ lô theo nguyên tắc FEFO (hạn sử dụng gần nhất xuất trước)
        const batchDeductions = [];
        if (fefoBatches.length > 0) {
          let remain = qty;
          for (const b of fefoBatches) {
            if (remain <= 0) break;
            const take = Math.min(remain, Number(b.qty_remaining) || 0);
            if (take > 0) {
              batchDeductions.push({
                batchId: b.id,
                batchCode: b.batch_code,
                expiryDate: b.expiry_date || '',
                beforeQty: Number(b.qty_remaining) || 0,
                takeQty: take,
                afterQty: (Number(b.qty_remaining) || 0) - take,
                status: b.status,
              });
              remain -= take;
            }
          }
        }

        resolvedLines.push({
          product,
          qty,
          oldStock: availableStock,
          newStock: availableStock - qty,
          batchDeductions,
          lineDiscount,
          unitPriceSnapshot,
          unitCostSnapshot,
        });
      }

      // Bước 2: Tính Tạm tính, kiểm tra lại Voucher HOẶC Khuyến mãi (XOR) & tính VAT từ THAM_SO (BR-04)
      const baseSubtotal = resolvedLines.reduce(
        (sum, l) => sum + (l.qty * l.unitPriceSnapshot - l.lineDiscount),
        0,
      );

      let appliedPromo = null;
      let appliedVoucher = null;
      let discountMode = 'NONE';
      let invoiceDiscount = 0;

      if (voucherInput) {
        const validatedV = this.validateVoucher(voucherInput, baseSubtotal, customerId);
        appliedVoucher = validatedV.voucherRow;
        discountMode = 'VOUCHER';
        invoiceDiscount = validatedV.discountAmount;
      } else if (promoInput) {
        const validatedP = this.validatePromotionForSubtotal(promoInput, baseSubtotal);
        appliedPromo = validatedP.promoRow;
        discountMode = 'PROMOTION';
        const today = todayYmdVn();
        const eligibleSubtotal = this._computeEligibleSubtotalForPromotion(
          appliedPromo,
          validatedP.productIds,
          resolvedLines,
          today,
        );
        if (appliedPromo.scope === 'NEAR_EXPIRY') {
          assertRule(
            eligibleSubtotal > 0,
            `Giỏ hàng không có sản phẩm/lô hàng cận date (<= ${appliedPromo.near_expiry_days || 14} ngày) hợp lệ cho chương trình "${appliedPromo.code}".`,
            400,
          );
        } else if (appliedPromo.scope !== 'INVOICE') {
          assertRule(
            eligibleSubtotal > 0,
            `Giỏ hàng không có sản phẩm thuộc phạm vi áp dụng của chương trình "${appliedPromo.code}".`,
            400,
          );
        }
        invoiceDiscount = computePromotionDiscount(appliedPromo, eligibleSubtotal);
      }

      const taxRate = this._getTaxRate();
      const afterDiscount = Math.max(0, baseSubtotal - invoiceDiscount);
      const taxAmount = Math.round((afterDiscount * taxRate) / 100);
      const totalAmount = Math.max(0, afterDiscount + taxAmount);
      const pricing = {
        subtotal: baseSubtotal,
        invoiceDiscount,
        afterDiscount,
        taxRate,
        taxAmount,
        totalAmount,
      };

      // Bước 3: Kiểm tra thanh toán đủ 100% một lần (BR-05 & BƯỚC 3)
      if (input?.paidAmount !== undefined && input?.paidAmount !== null && input?.paidAmount !== '') {
        const paidAmt = parseNonNegativeInt(input.paidAmount, 'Số tiền thanh toán');
        assertRule(
          paidAmt >= pricing.totalAmount,
          `POS chỉ hỗ trợ thanh toán đủ 100% một lần (${pricing.totalAmount.toLocaleString('vi-VN')} ₫), không hỗ trợ thanh toán một phần (${paidAmt.toLocaleString('vi-VN')} ₫).`,
          400,
        );
      }

      let cashReceived = pricing.totalAmount;
      let cashChange = 0;
      if (paymentMethod === 'CASH') {
        cashReceived = parseNonNegativeInt(
          input?.cashReceived !== undefined ? input.cashReceived : input?.received,
          'Tiền khách đưa',
        );
        assertRule(
          cashReceived >= pricing.totalAmount,
          `Tiền khách đưa (${cashReceived.toLocaleString('vi-VN')} ₫) nhỏ hơn Tổng thanh toán (${pricing.totalAmount.toLocaleString('vi-VN')} ₫). Thiếu ${(pricing.totalAmount - cashReceived).toLocaleString('vi-VN')} ₫ (BR-05).`,
          400,
        );
        cashChange = cashReceived - pricing.totalAmount;
      } else {
        assertRule(
          paymentRef.length >= 3 && paymentRef.length <= 100,
          `Thanh toán ${PAYMENT_METHOD_LABELS[paymentMethod]} bắt buộc nhập Mã tham chiếu giao dịch (tối thiểu 3 ký tự) (BR-05).`,
          400,
        );
      }

      // Gắn ca thu ngân đang mở (nếu có)
      const openShift = this.repos.shifts ? this.repos.shifts.findOpenByCashier(actor.id) : null;

      // Bước 4: Lưu Hóa đơn & Chi tiết hóa đơn (Price Snapshot)
      const order = this.repos.orders.create(
        {
          customer_id: customerId,
          cashier_id: actor.id,
          shift_id: openShift ? openShift.id : null,
          discount_mode: discountMode,
          promotion_id: appliedPromo ? appliedPromo.id : null,
          voucher_id: appliedVoucher ? appliedVoucher.id : null,
          subtotal: pricing.subtotal,
          invoice_discount: pricing.invoiceDiscount,
          tax_rate: pricing.taxRate,
          tax_amount: pricing.taxAmount,
          total_amount: pricing.totalAmount,
          payment_method: paymentMethod,
          cash_received: cashReceived,
          cash_change: cashChange,
          payment_ref: paymentRef,
          status: 'DaThanhToan',
          note,
          created_at: options._createdAtOverride || undefined,
        },
        resolvedLines.map((l) => ({
          product_id: l.product.id,
          product_name_snapshot: l.product.name,
          unit_price_snapshot: l.unitPriceSnapshot,
          unit_cost_snapshot: l.unitCostSnapshot,
          qty: l.qty,
          line_discount: l.lineDiscount,
        })),
      );

      // Bước 5 & 6: Trừ tồn kho theo FEFO (mỗi lô 1 dòng Thẻ kho BAN_HANG kèm mã lô)
      for (const l of resolvedLines) {
        if (l.batchDeductions && l.batchDeductions.length > 0 && this.repos.batches) {
          let runningStock = l.oldStock;
          for (const bd of l.batchDeductions) {
            const nextStatus = bd.afterQty === 0 ? 'DaHet' : bd.status;
            this.repos.batches.updateQtyAndStatus(bd.batchId, bd.afterQty, nextStatus);
            const afterStep = runningStock - bd.takeQty;
            this.repos.stockMovements.append({
              productId: l.product.id,
              stockBefore: runningStock,
              delta: -bd.takeQty,
              stockAfter: afterStep,
              docType: 'BAN_HANG',
              docId: order.id,
              batchCode: bd.batchCode,
              actorId: actor.id,
              actorName: actor.full_name,
              note: `Bán hàng POS (FEFO) · HĐ ${order.id} · Lô ${bd.batchCode}${bd.expiryDate ? ` (HSD ${bd.expiryDate})` : ''} (${PAYMENT_METHOD_LABELS[paymentMethod]})`,
            });
            runningStock = afterStep;
          }
          this.repos.products.updateStock(l.product.id, l.newStock);
        } else {
          this.repos.products.updateStock(l.product.id, l.newStock);
          this.repos.stockMovements.append({
            productId: l.product.id,
            stockBefore: l.oldStock,
            delta: -l.qty,
            stockAfter: l.newStock,
            docType: 'BAN_HANG',
            docId: order.id,
            actorId: actor.id,
            actorName: actor.full_name,
            note: `Bán hàng POS · Hóa đơn ${order.id} (${PAYMENT_METHOD_LABELS[paymentMethod]})`,
          });
        }
      }

      // Bước 7: Tăng lượt dùng khuyến mãi hoặc ghi nhận sử dụng Voucher
      if (appliedPromo) {
        this.repos.promotions.incrementUsedCount(appliedPromo.id);
      }
      if (appliedVoucher) {
        this.repos.vouchers.recordRedemption({
          voucherId: appliedVoucher.id,
          orderId: order.id,
          customerId,
          discountAmount: pricing.invoiceDiscount,
        });
      }

      // Hook kiểm thử rollback nguyên tử trong test nội bộ (không gọi từ HTTP)
      if (typeof options._beforeCommitHook === 'function') {
        options._beforeCommitHook();
      }

      const totalLineDiscount = resolvedLines.reduce((s, l) => s + l.lineDiscount, 0);
      this.repos.auditLogs.append({
        actor,
        action: 'ORDER_CHECKOUT',
        entityType: 'Order',
        entityId: order.id,
        detail: `Thanh toán POS ${order.id}: ${resolvedLines.length} mặt hàng, tổng ${pricing.totalAmount.toLocaleString('vi-VN')} ₫ (${PAYMENT_METHOD_LABELS[paymentMethod]}${appliedVoucher ? `, Voucher ${appliedVoucher.code}` : appliedPromo ? `, KM ${appliedPromo.code}` : ''}${totalLineDiscount > 0 ? `, giảm dòng hàng ${totalLineDiscount.toLocaleString('vi-VN')} ₫` : ''})`,
        after: {
          orderId: order.id,
          shiftId: openShift?.id || null,
          discountMode,
          subtotal: pricing.subtotal,
          totalLineDiscount,
          invoiceDiscount: pricing.invoiceDiscount,
          taxAmount: pricing.taxAmount,
          totalAmount: pricing.totalAmount,
          paymentMethod,
          promotionCode: appliedPromo?.code || null,
          voucherCode: appliedVoucher?.code || null,
        },
      });

      return order;
    });

    const storeConfig = this.systemService ? this.systemService.getPublicStoreConfig() : null;
    return toOrderDetailDto(createdOrder, { canViewCost: false, storeConfig });
  }

  /**
   * BR-05: Cấm thanh toán lặp lần 2 trên hóa đơn đã thanh toán.
   */
  payOrder(_actor, orderId) {
    const existing = this.repos.orders.findById(orderId);
    if (!existing) throw new NotFoundException(`Không tìm thấy hóa đơn mã "${orderId}".`);
    if (['DaThanhToan', 'TraMotPhan', 'DaHoanTra'].includes(existing.status)) {
      throw new ConflictException(
        `Hóa đơn "${orderId}" đã được thanh toán (${ORDER_STATUS_LABELS[existing.status] || existing.status}) — nghiêm cấm thanh toán lặp lần 2 (BR-05).`,
      );
    }
    throw new ConflictException(`Hóa đơn "${orderId}" ở trạng thái ${existing.status}, không thể thanh toán.`);
  }

  forbidOrderMutation(orderId) {
    const existing = this.repos.orders.findById(orderId);
    if (!existing) throw new NotFoundException(`Không tìm thấy hóa đơn mã "${orderId}".`);
    throw new ForbiddenException(
      `Hóa đơn "${orderId}" đã thanh toán — nghiêm cấm chỉnh sửa hoặc xóa hóa đơn đã phát hành (BR-05).`,
    );
  }

  // ─── RETURNS (BR-05, BR-06, BR-07, BR-08) ──────────────────────────────────

  listReturns(filters = {}) {
    const fromDate = String(filters.fromDate || '').trim();
    const toDate = String(filters.toDate || '').trim();
    validateDateRange(fromDate, toDate);

    const rows = this.repos.returns.list({
      search: filters.search || '',
      status: filters.status || '',
      orderId: filters.orderId || '',
      fromDate,
      toDate,
    });
    const allRows = this.repos.returns.list({});
    return {
      items: rows.map(toReturnSummaryDto),
      summary: {
        total: allRows.length,
        pendingCount: allRows.filter((r) => r.status === 'ChoDuyet').length,
        approvedCount: allRows.filter((r) => r.status === 'DaXacNhan').length,
        rejectedCount: allRows.filter((r) => r.status === 'TuChoi').length,
        totalRefunded: allRows
          .filter((r) => r.status === 'DaXacNhan')
          .reduce((s, r) => s + (Number(r.refund_amount) || 0), 0),
      },
    };
  }

  getReturn(id) {
    const found = this.repos.returns.findById(id);
    if (!found) throw new NotFoundException(`Không tìm thấy phiếu trả hàng mã "${id}".`);
    return toReturnDetailDto(found);
  }

  _assertWithinReturnWindow(order, nowDate = new Date()) {
    const windowDays = this._getReturnWindowDays();
    const orderMs = new Date(order.created_at).getTime();
    const elapsedDays = (nowDate.getTime() - orderMs) / 86400000;
    assertRule(
      elapsedDays <= windowDays,
      `Hóa đơn "${order.id}" đã quá thời hạn trả hàng ${windowDays} ngày (đã qua ${Math.floor(elapsedDays)} ngày theo cấu hình SoNgayChoPhepTraHang trong THAM_SO) (BR-05).`,
      400,
    );
  }

  createReturn(actor, input, options = {}) {
    const orderId = String(input?.orderId || '').trim();
    const reason = String(input?.reason || '').trim();
    const restock = input?.restock !== false && input?.restock !== 'damaged_or_expired' && input?.restock !== 0;
    const rawItems = input?.items;

    assertRule(orderId.length > 0, 'Vui lòng nhập mã hóa đơn gốc cần trả hàng (*).', 400);
    assertRule(reason.length >= 3 && reason.length <= 300, 'Vui lòng nhập lý do trả hàng (tối thiểu 3 ký tự) (*).', 400);
    assertRule(Array.isArray(rawItems) && rawItems.length >= 1, 'Vui lòng chọn ít nhất 1 sản phẩm và số lượng cần trả (> 0).', 400);

    const created = withTransaction(this.db, () => {
      const order = this.repos.orders.findById(orderId);
      if (!order) throw new NotFoundException(`Không tìm thấy hóa đơn gốc mã "${orderId}".`);
      assertRule(
        ['DaThanhToan', 'TraMotPhan'].includes(order.status),
        `Hóa đơn "${orderId}" ở trạng thái ${ORDER_STATUS_LABELS[order.status] || order.status}, không đủ điều kiện lập phiếu trả hàng (BR-05).`,
        400,
      );

      const refNow = options._createdAtOverride ? new Date(options._createdAtOverride) : new Date();
      this._assertWithinReturnWindow(order, refNow);

      const pendingMap = this.repos.returns.getPendingQtyMap(orderId);
      const paidMap = allocateOrderPaidTotals(order);
      const orderItemMap = new Map((order.items || []).map((i) => [i.product_id, i]));

      const seen = new Set();
      const returnLines = [];
      let totalRefund = 0;

      for (const raw of rawItems) {
        const productId = String(raw?.productId || raw?.product_id || raw?.id || '').trim();
        assertRule(productId.length > 0, 'Thiếu mã sản phẩm trong phiếu trả hàng.', 400);
        assertRule(!seen.has(productId), `Sản phẩm "${productId}" bị trùng lặp trong phiếu trả hàng.`, 400);
        seen.add(productId);

        const orderItem = orderItemMap.get(productId);
        assertRule(Boolean(orderItem), `Sản phẩm "${productId}" không nằm trong hóa đơn "${orderId}".`, 400);
        // BƯỚC 3: Chặn trả hàng cho sản phẩm không hỗ trợ đổi trả (non_returnable = 1)
        const prodRow = this.repos.products.findById(productId);
        assertRule(
          Number(orderItem.non_returnable) !== 1 && Number(prodRow?.non_returnable) !== 1,
          `Sản phẩm "${orderItem.product_name_snapshot}" thuộc nhóm không áp dụng đổi trả (hàng tươi sống / dễ hỏng / chính sách không đổi trả).`,
          400,
        );

        const qty = parsePositiveInt(raw?.qty, `Số lượng trả của ${orderItem.product_name_snapshot}`);
        const purchased = Number(orderItem.qty) || 0;
        const alreadyReturned = Number(orderItem.returned_qty) || 0;
        const pendingQty = pendingMap.get(productId) || 0;
        const maxReturnable = Math.max(0, purchased - alreadyReturned - pendingQty);

        assertRule(
          qty <= maxReturnable,
          `Số lượng trả của "${orderItem.product_name_snapshot}" (${qty}) vượt quá số lượng còn có thể trả (${maxReturnable} = đã mua ${purchased} − đã trả ${alreadyReturned}${pendingQty ? ` − đang chờ duyệt ${pendingQty}` : ''}) (BR-05).`,
          400,
        );

        const paidLineTotal = paidMap.get(productId) || 0;
        const effectiveBefore = alreadyReturned + pendingQty;
        const refundLineAmount =
          Math.floor((paidLineTotal * (effectiveBefore + qty)) / purchased) -
          Math.floor((paidLineTotal * effectiveBefore) / purchased);

        totalRefund += refundLineAmount;
        returnLines.push({
          product_id: productId,
          qty,
          refund_line_amount: refundLineAmount,
        });
      }

      const ret = this.repos.returns.create(
        {
          order_id: orderId,
          created_by: actor.id,
          reason,
          restock,
          refund_amount: totalRefund,
          created_at: options._createdAtOverride || undefined,
        },
        returnLines,
      );

      this.repos.auditLogs.append({
        actor,
        action: 'RETURN_CREATE',
        entityType: 'Return',
        entityId: ret.id,
        detail: `Lập phiếu trả hàng ${ret.id} cho hóa đơn ${orderId} (${returnLines.length} mặt hàng, dự kiến hoàn ${totalRefund.toLocaleString('vi-VN')} ₫ — Chờ duyệt)`,
        after: { returnId: ret.id, orderId, restock, refundAmount: totalRefund, status: 'ChoDuyet' },
      });

      return ret;
    });

    return toReturnDetailDto(created);
  }

  /**
   * BR-05 & BR-06: Xác nhận phiếu trả hàng trong 1 Transaction nguyên tử:
   * (1) Kiểm tra lại hạn trả hàng theo mốc lập phiếu (returnSlip.created_at) & số lượng trả <= đã mua - đã trả
   * (2) Cập nhật returned_qty trên order_items và trạng thái hóa đơn (TraMotPhan / DaHoanTra)
   * (3) Nếu hàng nguyên vẹn (restock=1): cộng hoàn tồn kho + ghi LichSuTonKho (TRA_HANG)
   * (4) Chuyển phiếu trả sang DaXacNhan + ghi AuditLog (RETURN_APPROVE)
   */
  approveReturn(actor, id, options = {}) {
    const approved = withTransaction(this.db, () => {
      const existing = this.repos.returns.findById(id);
      if (!existing) throw new NotFoundException(`Không tìm thấy phiếu trả hàng mã "${id}".`);
      if (existing.status !== 'ChoDuyet') {
        throw new ConflictException(
          `Chỉ được duyệt phiếu trả hàng ở trạng thái Chờ duyệt. Phiếu "${id}" hiện ở trạng thái ${existing.status}.`,
        );
      }

      const order = this.repos.orders.findById(existing.order_id);
      if (!order) throw new NotFoundException(`Không tìm thấy hóa đơn gốc "${existing.order_id}".`);
      // M4 Patch (Điểm 2): Chốt hạn trả hàng theo thời điểm lập phiếu (existing.created_at) thay vì now
      this._assertWithinReturnWindow(order, new Date(existing.created_at));

      const orderItemMap = new Map((order.items || []).map((i) => [i.product_id, i]));
      const restockChanges = [];

      for (const item of existing.items) {
        const orderItem = orderItemMap.get(item.product_id);
        assertRule(Boolean(orderItem), `Sản phẩm "${item.product_id}" không còn thuộc hóa đơn gốc.`, 400);
        const purchased = Number(orderItem.qty) || 0;
        const alreadyReturned = Number(orderItem.returned_qty) || 0;
        const qty = Number(item.qty);
        assertRule(
          qty <= purchased - alreadyReturned,
          `Số lượng trả (${qty}) của "${item.product_name}" vượt quá số lượng còn lại có thể trả (${purchased - alreadyReturned}) (BR-05).`,
          400,
        );

        this.repos.orders.incrementItemReturnedQty(order.id, item.product_id, qty);

        if (existing.restock) {
          const product = this.repos.products.findById(item.product_id);
          assertRule(Boolean(product), `Sản phẩm "${item.product_id}" không tồn tại.`, 400);
          const oldStock = Number(product.stock_qty) || 0;
          const newStock = oldStock + qty;
          let restockBatchCode = '';
          if (this.repos.batches) {
            const today = todayYmdVn();
            const salable = this.repos.batches.findSalableFefo(product.id, today);
            if (salable.length > 0) {
              const targetBatch = salable[salable.length - 1];
              this.repos.batches.updateQtyAndStatus(
                targetBatch.id,
                Number(targetBatch.qty_remaining) + qty,
                targetBatch.status === 'DaHet' ? 'ConHan' : targetBatch.status,
              );
              restockBatchCode = targetBatch.batch_code;
            } else {
              const defaultExp = new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10);
              const createdBatch = this.repos.batches.create({
                batchCode: `LO-TH-${id}-${product.sku}`,
                productId: product.id,
                mfgDate: today,
                expiryDate: Number(product.has_expiry) === 1 ? defaultExp : '',
                initialQty: qty,
                qtyRemaining: qty,
                unitCost: Number(product.cost_price) || 0,
                status: 'ConHan',
              });
              restockBatchCode = createdBatch.batch_code;
            }
          }
          this.repos.products.updateStock(product.id, newStock);
          this.repos.stockMovements.append({
            productId: product.id,
            stockBefore: oldStock,
            delta: qty,
            stockAfter: newStock,
            docType: 'TRA_HANG',
            docId: id,
            batchCode: restockBatchCode,
            actorId: actor.id,
            actorName: actor.full_name,
            note: `Xác nhận trả hàng nguyên vẹn ${id} từ hóa đơn ${order.id}${restockBatchCode ? ` · Lô ${restockBatchCode}` : ''}: ${existing.reason}`,
          });
          restockChanges.push({
            productId: product.id,
            sku: product.sku,
            batchCode: restockBatchCode,
            oldStock,
            delta: qty,
            newStock,
          });
        } else {
          // Hàng lỗi/hư hỏng không nhập lại kho bán được -> cộng vào kho hàng lỗi (damaged_stock_qty)
          if (typeof this.repos.products.addDamagedStock === 'function') {
            this.repos.products.addDamagedStock(item.product_id, qty);
          }
        }
      }

      const refreshedOrder = this.repos.orders.findById(order.id);
      const allReturned = (refreshedOrder.items || []).every(
        (i) => Number(i.returned_qty) >= Number(i.qty),
      );
      this.repos.orders.updateStatus(order.id, allReturned ? 'DaHoanTra' : 'TraMotPhan');

      if (typeof options._beforeCommitHook === 'function') {
        options._beforeCommitHook();
      }

      const finalRet = this.repos.returns.updateStatus(id, 'DaXacNhan', {
        approved_by: actor.id,
        resolved_at: new Date().toISOString(),
      });

      this.repos.auditLogs.append({
        actor,
        action: 'RETURN_APPROVE',
        entityType: 'Return',
        entityId: id,
        detail: `Xác nhận trả hàng ${id} (HĐ ${order.id}, hoàn ${Number(existing.refund_amount).toLocaleString('vi-VN')} ₫, ${existing.restock ? 'đã cộng hoàn tồn kho' : 'hàng lỗi không hoàn tồn'})`,
        before: { status: 'ChoDuyet' },
        after: {
          status: 'DaXacNhan',
          orderStatus: allReturned ? 'DaHoanTra' : 'TraMotPhan',
          refundAmount: Number(existing.refund_amount) || 0,
          restockChanges,
        },
      });

      return finalRet;
    });

    return toReturnDetailDto(approved);
  }

  rejectReturn(actor, id, rejectReason = '') {
    const rejected = withTransaction(this.db, () => {
      const existing = this.repos.returns.findById(id);
      if (!existing) throw new NotFoundException(`Không tìm thấy phiếu trả hàng mã "${id}".`);
      if (existing.status !== 'ChoDuyet') {
        throw new ConflictException(`Phiếu trả hàng "${id}" không ở trạng thái Chờ duyệt, không thể từ chối.`);
      }
      const clean = String(rejectReason || '').trim();
      const nextReason = clean ? `${existing.reason} · Lý do từ chối: ${clean}` : existing.reason;

      const updated = this.repos.returns.updateStatus(id, 'TuChoi', {
        approved_by: actor.id,
        resolved_at: new Date().toISOString(),
        reason: nextReason,
      });

      this.repos.auditLogs.append({
        actor,
        action: 'RETURN_REJECT',
        entityType: 'Return',
        entityId: id,
        detail: `Từ chối phiếu trả hàng ${id} (HĐ ${existing.order_id})${clean ? `: ${clean}` : ''}`,
        before: { status: 'ChoDuyet' },
        after: { status: 'TuChoi', rejectReason: clean },
      });
      return updated;
    });
    return toReturnDetailDto(rejected);
  }
}

module.exports = {
  SalesService,
  calculateOrderPricing,
  computePromotionDiscount,
  PROMO_STATUS_LABELS,
  PROMO_SCOPE_LABELS,
  VOUCHER_STATUS_LABELS,
  SHIFT_STATUS_LABELS,
  ORDER_STATUS_LABELS,
  RETURN_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
};
