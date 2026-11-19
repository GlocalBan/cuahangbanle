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

function todayYmdVn(nowDate = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(nowDate);
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

function toPromotionDto(row) {
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
    status: row.status,
    statusLabel: PROMO_STATUS_LABELS[row.status] || row.status,
    createdAt: row.created_at,
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
    promotionId: row.promotion_id || null,
    promotionCode: row.promotion_code || '',
    promotionName: row.promotion_name || '',
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
      unitPrice: Number(i.unit_price_snapshot) || 0,
      qty,
      lineDiscount: Number(i.line_discount) || 0,
      lineTotal: Math.max(0, qty * (Number(i.unit_price_snapshot) || 0) - (Number(i.line_discount) || 0)),
      paidLineTotal: paidMap.get(i.product_id) || 0,
      returnedQty,
      pendingReturnQty: pendingQty,
      returnableQty: Math.max(0, qty - returnedQty - pendingQty),
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
      items: filtered.map(toPromotionDto),
      summary: {
        total: allRows.length,
        activeCount: allRows.filter((r) => r.status === 'DangDienRa').length,
        upcomingCount: allRows.filter((r) => r.status === 'SapDienRa').length,
        pausedCount: allRows.filter((r) => r.status === 'TamDung').length,
        endedCount: allRows.filter((r) => ['KetThuc', 'DaHuy'].includes(r.status)).length,
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

    assertRule(/^[A-Z0-9_-]{3,30}$/.test(code), 'Mã khuyến mãi chỉ gồm chữ in hoa, số, gạch ngang/dưới (3–30 ký tự).', 400);
    assertRule(name.length >= 3 && name.length <= 160, 'Tên chương trình khuyến mãi phải từ 3 đến 160 ký tự.', 400);
    assertRule(['PERCENT', 'FIXED'].includes(discountType), 'Loại giảm giá phải là PERCENT (%) hoặc FIXED (₫).', 400);
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
      this.repos.auditLogs.append({
        actor,
        action: 'PROMOTION_CREATE',
        entityType: 'Promotion',
        entityId: promo.id,
        detail: `Tạo khuyến mãi ${promo.code} (${promo.name})`,
        after: toPromotionDto(promo),
      });
      return promo;
    });
    return toPromotionDto(created);
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
      const promo = this.repos.promotions.update(id, clean);
      this.repos.auditLogs.append({
        actor,
        action: 'PROMOTION_UPDATE',
        entityType: 'Promotion',
        entityId: id,
        detail: `Cập nhật khuyến mãi ${promo.code} (${promo.status})`,
        before: toPromotionDto(existing),
        after: toPromotionDto(promo),
      });
      return promo;
    });
    return toPromotionDto(updated);
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
    return toPromotionDto(updated);
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
    return {
      promotion: toPromotionDto(promo),
      promoRow: promo,
      subtotal: safeSubtotal,
      discountAmount,
      afterDiscount,
      taxRate,
      taxAmount,
      totalAmount: Math.max(0, afterDiscount + taxAmount),
    };
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

    const rawMethod = String(input?.paymentMethod || input?.payment || 'CASH')
      .trim()
      .toUpperCase();
    const methodMap = { CASH: 'CASH', TIENMAT: 'CASH', VIETQR: 'VIETQR', TRANSFER: 'VIETQR', CARD: 'CARD' };
    const paymentMethod = methodMap[rawMethod] || '';
    assertRule(
      ['CASH', 'VIETQR', 'CARD'].includes(paymentMethod),
      'Phương thức thanh toán không hợp lệ (CASH / VIETQR / CARD).',
      400,
    );

    const promoInput = String(input?.promotionCode || input?.promotionId || '').trim();
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
        assertRule(
          qty <= availableStock,
          `Không đủ tồn kho cho "${product.name}" (${product.sku}): yêu cầu ${qty}, tồn khả dụng ${availableStock}. Nghiêm cấm xuất âm kho (BR-03).`,
          400,
        );

        const unitPriceSnapshot = Number(product.sale_price);
        const unitCostSnapshot = Number(product.cost_price);
        assertRule(
          lineDiscount <= qty * unitPriceSnapshot,
          `Giảm giá dòng hàng của "${product.name}" vượt quá thành tiền dòng hàng.`,
          400,
        );

        resolvedLines.push({
          product,
          qty,
          oldStock: availableStock,
          newStock: availableStock - qty,
          lineDiscount,
          unitPriceSnapshot,
          unitCostSnapshot,
        });
      }

      // Bước 2: Tính Tạm tính, kiểm tra lại Khuyến mãi & tính VAT từ THAM_SO (BR-04)
      const baseSubtotal = resolvedLines.reduce(
        (sum, l) => sum + (l.qty * l.unitPriceSnapshot - l.lineDiscount),
        0,
      );

      let appliedPromo = null;
      if (promoInput) {
        const validated = this.validatePromotionForSubtotal(promoInput, baseSubtotal);
        appliedPromo = validated.promoRow;
      }

      const taxRate = this._getTaxRate();
      const pricing = calculateOrderPricing({
        items: resolvedLines.map((l) => ({
          qty: l.qty,
          unitPrice: l.unitPriceSnapshot,
          lineDiscount: l.lineDiscount,
        })),
        promotion: appliedPromo,
        taxRate,
      });

      // Bước 3: Kiểm tra thanh toán (BR-05)
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

      // Bước 4: Lưu Hóa đơn & Chi tiết hóa đơn (Price Snapshot)
      const order = this.repos.orders.create(
        {
          customer_id: customerId,
          cashier_id: actor.id,
          promotion_id: appliedPromo ? appliedPromo.id : null,
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

      // Bước 5 & 6: Trừ tồn kho & ghi Thẻ kho bất biến (BAN_HANG)
      for (const l of resolvedLines) {
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

      // Bước 7: Tăng lượt dùng khuyến mãi (nếu có)
      if (appliedPromo) {
        this.repos.promotions.incrementUsedCount(appliedPromo.id);
      }

      // Hook kiểm thử rollback nguyên tử trong test nội bộ (không gọi từ HTTP)
      if (typeof options._beforeCommitHook === 'function') {
        options._beforeCommitHook();
      }

      this.repos.auditLogs.append({
        actor,
        action: 'ORDER_CHECKOUT',
        entityType: 'Order',
        entityId: order.id,
        detail: `Thanh toán POS ${order.id}: ${resolvedLines.length} mặt hàng, tổng ${pricing.totalAmount.toLocaleString('vi-VN')} ₫ (${PAYMENT_METHOD_LABELS[paymentMethod]}${appliedPromo ? `, KM ${appliedPromo.code}` : ''})`,
        after: {
          orderId: order.id,
          subtotal: pricing.subtotal,
          invoiceDiscount: pricing.invoiceDiscount,
          taxAmount: pricing.taxAmount,
          totalAmount: pricing.totalAmount,
          paymentMethod,
          promotionCode: appliedPromo?.code || null,
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

  createReturn(actor, input) {
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

      this._assertWithinReturnWindow(order);

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
   * (1) Kiểm tra lại hạn trả hàng & số lượng trả <= đã mua - đã trả
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
      this._assertWithinReturnWindow(order);

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
          this.repos.products.updateStock(product.id, newStock);
          this.repos.stockMovements.append({
            productId: product.id,
            stockBefore: oldStock,
            delta: qty,
            stockAfter: newStock,
            docType: 'TRA_HANG',
            docId: id,
            actorId: actor.id,
            actorName: actor.full_name,
            note: `Xác nhận trả hàng nguyên vẹn ${id} từ hóa đơn ${order.id}: ${existing.reason}`,
          });
          restockChanges.push({
            productId: product.id,
            sku: product.sku,
            oldStock,
            delta: qty,
            newStock,
          });
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
  ORDER_STATUS_LABELS,
  RETURN_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
};
