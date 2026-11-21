'use strict';
const { withTransaction } = require('../dal/database.js');
const { ConflictException, ForbiddenException, NotFoundException, assertRule } = require('./errors.js');

const PURCHASE_STATUS_LABELS = {
  Draft: 'Phiếu nháp (Chờ duyệt)',
  GuiNCC: 'Đã gửi NCC',
  NCCPhanHoi: 'NCC phản hồi',
  ThuongLuong: 'Đang thương lượng',
  DaThongNhat: 'Đã thống nhất',
  DangNhanHang: 'Đang nhận hàng (Nhiều đợt)',
  Confirmed: 'Đã nhập kho đủ',
  Cancelled: 'Đã hủy',
};

const AUDIT_STATUS_LABELS = {
  DangDem: 'Đang kiểm đếm (Kiểm mù)',
  ChoDemLai: 'Chờ đếm lại vòng 2',
  ChoDuyet: 'Chờ duyệt kiểm kê',
  DaDuyet: 'Đã duyệt điều chỉnh',
  DaHuy: 'Đã hủy',
};

const AUDIT_REASON_CODES = {
  MAT_HANG: 'Mất hàng / Thất thoát',
  HU_HONG: 'Hư hỏng / Bể vỡ',
  HET_HAN: 'Hết hạn sử dụng',
  NHAP_XUAT_SAI: 'Sai sót nhập/xuất sổ sách',
  NHAM_DEM: 'Nhầm lẫn đếm kiểm kê',
  KHAC: 'Lý do khác',
};

const GRN_STATUS_LABELS = {
  ChoDuyet: 'Chờ duyệt nhập kho',
  DaDuyet: 'Đã duyệt nhập kho',
  DaHuy: 'Đã hủy',
};

const PAYABLE_STATUS_LABELS = {
  ChuaThanhToan: 'Chưa thanh toán',
  ThanhToanMotPhan: 'Thanh toán một phần',
  DaThanhToanNCC: 'Đã thanh toán đủ',
};

const SUPPLIER_RETURN_STATUS_LABELS = {
  ChoDuyet: 'Chờ duyệt trả NCC',
  DaDuyet: 'Đã duyệt trả NCC',
  DaHuy: 'Đã hủy',
};

const WRITEOFF_STATUS_LABELS = {
  ChoDuyet: 'Chờ duyệt hủy hàng',
  DaDuyet: 'Đã duyệt hủy hàng',
  DaHuy: 'Đã hủy phiếu',
};

const BATCH_STATUS_LABELS = {
  ConHan: 'Còn hạn',
  CanDate: 'Cận date',
  HetHan: 'Hết hạn (Khóa bán)',
  DaHet: 'Đã bán hết',
  DaHuy: 'Đã xuất hủy',
};

function todayYmdVn(nowDate = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(nowDate);
}

function isValidIsoYmd(val) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(val || ''))) return false;
  const [y, m, d] = String(val).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function diffDaysYmd(fromYmd, toYmd) {
  if (!fromYmd || !toYmd) return null;
  const [y1, m1, d1] = fromYmd.split('-').map(Number);
  const [y2, m2, d2] = toYmd.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

function validateDateRange(fromDate, toDate) {
  const isoPattern = /^\d{4}-\d{2}-\d{2}$/;
  if (fromDate && !isoPattern.test(fromDate)) {
    assertRule(false, 'Định dạng "Từ ngày" không hợp lệ (YYYY-MM-DD).', 400);
  }
  if (toDate && !isoPattern.test(toDate)) {
    assertRule(false, 'Định dạng "Đến ngày" không hợp lệ (YYYY-MM-DD).', 400);
  }
  if (fromDate && toDate && fromDate > toDate) {
    assertRule(false, 'Khoảng thời gian không hợp lệ: "Từ ngày" phải nhỏ hơn hoặc bằng "Đến ngày" (BR-08).', 400);
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
 * BR-02: Tính giá vốn bình quân gia quyền khi xác nhận nhập kho (Confirmed).
 */
function computeWeightedAverageCost(oldStock, oldCost, importQty, importCost) {
  const safeOldStock = Math.max(0, Number(oldStock) || 0);
  const safeOldCost = Math.max(0, Number(oldCost) || 0);
  const safeQty = Math.max(0, Number(importQty) || 0);
  const safeImportCost = Math.max(0, Number(importCost) || 0);
  const totalQty = safeOldStock + safeQty;
  if (totalQty <= 0 || safeOldStock === 0) {
    return Math.round(safeImportCost);
  }
  return Math.round((safeOldStock * safeOldCost + safeQty * safeImportCost) / totalQty);
}

function addDaysYmd(ymd, days) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function toPurchaseSummaryDto(row) {
  return {
    id: row.id,
    supplierId: row.supplier_id,
    supplierName: row.supplier_name,
    supplierStatus: row.supplier_status,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    approvedBy: row.approved_by || null,
    approvedByName: row.approved_by_name || null,
    totalAmount: Number(row.total_amount) || 0,
    expectedDeliveryDate: row.expected_delivery_date || '',
    itemCount: Number(row.item_count) || 0,
    totalQty: Number(row.total_qty) || 0,
    note: row.note || '',
    status: row.status,
    statusLabel: PURCHASE_STATUS_LABELS[row.status] || row.status,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at || null,
  };
}

function toPurchaseDetailDto(row, extra = {}) {
  const receivedMap = extra.receivedMap || new Map();
  const items = (row.items || []).map((i) => {
    const qty = Number(i.qty) || 0;
    const receivedQty = receivedMap.get(i.product_id) || 0;
    return {
      id: i.id,
      productId: i.product_id,
      sku: i.sku,
      productName: i.product_name,
      unitName: i.unit_name,
      imageUrl: i.image_url,
      qty,
      receivedQty,
      remainingQty: Math.max(0, qty - receivedQty),
      unitCost: Number(i.unit_cost) || 0,
      lineTotal: qty * (Number(i.unit_cost) || 0),
      batchCode: i.batch_code || '',
      mfgDate: i.mfg_date || '',
      expiryDate: i.expiry_date || '',
      hasExpiry: i.has_expiry === undefined ? true : Number(i.has_expiry) === 1,
      currentStockQty: Number(i.current_stock_qty) || 0,
      currentCostPrice: Number(i.current_cost_price) || 0,
      productStatus: i.product_status,
    };
  });
  return {
    id: row.id,
    supplierId: row.supplier_id,
    supplierName: row.supplier_name,
    supplierPhone: row.supplier_phone || '',
    supplierStatus: row.supplier_status,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    approvedBy: row.approved_by || null,
    approvedByName: row.approved_by_name || null,
    totalAmount: Number(row.total_amount) || 0,
    expectedDeliveryDate: row.expected_delivery_date || '',
    itemCount: items.length,
    totalQty: items.reduce((s, i) => s + i.qty, 0),
    totalReceivedQty: items.reduce((s, i) => s + i.receivedQty, 0),
    note: row.note || '',
    status: row.status,
    statusLabel: PURCHASE_STATUS_LABELS[row.status] || row.status,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at || null,
    items,
    negotiations: (extra.negotiations || []).map((n) => {
      let proposedItems = [];
      try {
        proposedItems = JSON.parse(n.proposed_items_json || '[]');
      } catch {
        proposedItems = [];
      }
      return {
        id: n.id,
        roundNo: Number(n.round_no) || 1,
        actorId: n.actor_id,
        actorRole: n.actor_role,
        actorName: n.actor_name,
        action: n.action,
        proposedItems,
        expectedDeliveryDate: n.expected_delivery_date || '',
        note: n.note || '',
        createdAt: n.created_at,
      };
    }),
    receipts: extra.receipts || [],
    payable: extra.payable || null,
  };
}

function toAuditSummaryDto(row) {
  return {
    id: row.id,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    assignedTo: row.assigned_to || null,
    assignedToName: row.assigned_to_name || null,
    recountBy: row.recount_by || null,
    recountByName: row.recount_by_name || null,
    approvedBy: row.approved_by || null,
    approvedByName: row.approved_by_name || null,
    scopeType: row.scope_type || 'TOAN_KHO',
    scopeValue: row.scope_value || '',
    snapshotAt: row.snapshot_at || row.created_at,
    requiresRecount: Number(row.requires_recount) === 1,
    requiresAdminApproval: Number(row.requires_admin_approval) === 1,
    note: row.note || '',
    status: row.status,
    statusLabel: AUDIT_STATUS_LABELS[row.status] || row.status,
    itemCount: Number(row.item_count) || 0,
    diffItemCount: row.status === 'DangDem' ? null : Number(row.diff_item_count) || 0,
    totalDiffQty: row.status === 'DangDem' ? null : Number(row.total_diff_qty) || 0,
    totalAbsDiffValue: row.status === 'DangDem' ? null : Number(row.total_abs_diff_value) || 0,
    createdAt: row.created_at,
    approvedAt: row.approved_at || null,
  };
}

function toAuditDetailDto(row, { blindMask = false } = {}) {
  const items = (row.items || []).map((i) => {
    const sysQty = Number(i.system_qty) || 0;
    const actQty = Number(i.actual_qty) || 0;
    const diffQty = Number(i.diff_qty) || 0;
    const costPrice = Number(i.cost_price) || 0;
    const base = {
      id: i.id,
      productId: i.product_id,
      sku: i.sku,
      productName: i.product_name,
      unitName: i.unit_name,
      imageUrl: i.image_url,
      batchId: i.batch_id || null,
      batchCode: i.batch_code || '',
      expiryDate: i.expiry_date || '',
      actualQty: row.status === 'DangDem' && i.round1_qty === null ? null : actQty,
      round1Qty: i.round1_qty !== null && i.round1_qty !== undefined ? Number(i.round1_qty) : null,
      round2Qty: i.round2_qty !== null && i.round2_qty !== undefined ? Number(i.round2_qty) : null,
      reasonCode: i.reason_code || '',
      reasonCodeLabel: AUDIT_REASON_CODES[i.reason_code] || '',
      reason: i.reason || '',
      isBlindMasked: blindMask,
    };
    if (blindMask) {
      return {
        ...base,
        systemQty: null,
        diffQty: null,
        liveStockQty: null,
        movementsSinceSnapshot: null,
        effectiveSystemQty: null,
        costPrice: null,
        diffValue: null,
      };
    }
    return {
      ...base,
      systemQty: sysQty,
      diffQty,
      liveStockQty: Number(i.live_stock_qty) || 0,
      movementsSinceSnapshot: Number(i.movements_since_snapshot) || 0,
      effectiveSystemQty:
        i.effective_system_qty !== null && i.effective_system_qty !== undefined
          ? Number(i.effective_system_qty)
          : Number(i.live_stock_qty) || sysQty,
      costPrice,
      diffValue: Math.abs(diffQty) * costPrice,
    };
  });

  const rounds = (row.rounds || []).map((r) => {
    let parsedItems = [];
    try {
      parsedItems = JSON.parse(r.items_json || '[]');
    } catch {
      parsedItems = [];
    }
    return {
      id: r.id,
      roundNo: Number(r.round_no) || 1,
      countedBy: r.counted_by,
      countedByName: r.counted_by_name,
      items: parsedItems,
      note: r.note || '',
      createdAt: r.created_at,
    };
  });

  return {
    id: row.id,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    assignedTo: row.assigned_to || null,
    assignedToName: row.assigned_to_name || null,
    recountBy: row.recount_by || null,
    recountByName: row.recount_by_name || null,
    approvedBy: row.approved_by || null,
    approvedByName: row.approved_by_name || null,
    scopeType: row.scope_type || 'TOAN_KHO',
    scopeValue: row.scope_value || '',
    snapshotAt: row.snapshot_at || row.created_at,
    requiresRecount: Number(row.requires_recount) === 1,
    requiresAdminApproval: Number(row.requires_admin_approval) === 1,
    isBlindMasked: blindMask,
    note: row.note || '',
    status: row.status,
    statusLabel: AUDIT_STATUS_LABELS[row.status] || row.status,
    itemCount: items.length,
    diffItemCount: blindMask ? null : items.filter((i) => i.diffQty !== 0).length,
    totalDiffQty: blindMask ? null : items.reduce((s, i) => s + (i.diffQty || 0), 0),
    totalAbsDiffValue: blindMask ? null : items.reduce((s, i) => s + (i.diffValue || 0), 0),
    createdAt: row.created_at,
    approvedAt: row.approved_at || null,
    items,
    rounds,
    reasonCodes: AUDIT_REASON_CODES,
  };
}

class WarehouseService {
  constructor(db, repos) {
    this.db = db;
    this.repos = repos;
  }

  // ─── PURCHASES (BR-02 & BR-06) ─────────────────────────────────────────────

  listPurchases(filters = {}) {
    const fromDate = String(filters.fromDate || '').trim();
    const toDate = String(filters.toDate || '').trim();
    validateDateRange(fromDate, toDate);

    const rows = this.repos.purchases.list({
      search: filters.search || '',
      supplierId: filters.supplierId || '',
      status: filters.status || '',
      fromDate,
      toDate,
    });
    const allRows = this.repos.purchases.list({});
    const items = rows.map(toPurchaseSummaryDto);
    return {
      items,
      summary: {
        total: allRows.length,
        draftCount: allRows.filter((r) => r.status === 'Draft').length,
        confirmedCount: allRows.filter((r) => r.status === 'Confirmed').length,
        cancelledCount: allRows.filter((r) => r.status === 'Cancelled').length,
        totalConfirmedAmount: allRows
          .filter((r) => r.status === 'Confirmed')
          .reduce((s, r) => s + (Number(r.total_amount) || 0), 0),
      },
    };
  }

  _hydratePurchaseDetail(found) {
    const receivedMap = this.repos.purchases.getCumulativeReceivedMap(found.id, { approvedOnly: true });
    const negotiations = this.repos.supplierOps ? this.repos.supplierOps.listNegotiations(found.id) : [];
    const receipts = this.repos.supplierOps ? this.repos.supplierOps.listGrns({ purchaseId: found.id }) : [];
    const payable = this.repos.supplierOps ? this.repos.supplierOps.findPayableByPurchase(found.id) : null;
    return toPurchaseDetailDto(found, { receivedMap, negotiations, receipts, payable });
  }

  getPurchase(id) {
    const found = this.repos.purchases.findById(id);
    if (!found) throw new NotFoundException(`Không tìm thấy phiếu nhập mã "${id}".`);
    return this._hydratePurchaseDetail(found);
  }

  _validatePurchasePayload(supplierId, rawItems) {
    const cleanSupplierId = String(supplierId || '').trim();
    assertRule(cleanSupplierId.length > 0, 'Vui lòng chọn nhà cung cấp (*).', 400);
    const supplier = this.repos.suppliers.findById(cleanSupplierId);
    assertRule(Boolean(supplier), `Nhà cung cấp "${cleanSupplierId}" không tồn tại.`, 400);
    assertRule(
      supplier.status === 'HoatDong',
      `Không thể lập phiếu nhập: Nhà cung cấp "${supplier.name}" đang ở trạng thái Ngừng hợp tác (BR-02).`,
      400,
    );

    assertRule(
      Array.isArray(rawItems) && rawItems.length >= 1,
      'Phiếu nhập hàng bắt buộc có tối thiểu 1 dòng sản phẩm (BR-02).',
      400,
    );

    const seen = new Set();
    const normalizedItems = [];
    let totalAmount = 0;

    for (const raw of rawItems) {
      const productId = String(raw?.productId || raw?.product_id || '').trim();
      assertRule(productId.length > 0, 'Thiếu mã sản phẩm trong chi tiết phiếu nhập.', 400);
      assertRule(!seen.has(productId), `Sản phẩm "${productId}" bị trùng lặp dòng trong cùng phiếu nhập.`, 400);
      seen.add(productId);

      const product = this.repos.products.findById(productId);
      assertRule(Boolean(product), `Sản phẩm mã "${productId}" không tồn tại.`, 400);
      assertRule(
        product.status === 'DangKinhDoanh',
        `Sản phẩm "${product.name}" đã ngừng kinh doanh, không thể nhập hàng (BR-02).`,
        400,
      );
      assertRule(
        product.supplier_id === cleanSupplierId,
        `Sản phẩm "${product.name}" không thuộc nhà cung cấp "${supplier.name}".`,
        400,
      );

      const qty = parsePositiveInt(raw?.qty, `Số lượng nhập của ${product.name}`);
      const unitCost = parseNonNegativeInt(
        raw?.unitCost !== undefined ? raw.unitCost : raw?.unit_cost,
        `Đơn giá nhập của ${product.name}`,
      );
      const batchCode = String(raw?.batchCode ?? raw?.batch_code ?? '').trim().slice(0, 60);
      const mfgDate = String(raw?.mfgDate ?? raw?.mfg_date ?? '').trim();
      const expiryDate = String(raw?.expiryDate ?? raw?.expiry_date ?? '').trim();
      const hasExpiry = product.has_expiry === undefined ? 1 : Number(product.has_expiry);
      const today = todayYmdVn();

      if (hasExpiry === 1) {
        assertRule(
          isValidIsoYmd(expiryDate),
          `Sản phẩm "${product.name}" (${product.sku}) có quản lý hạn sử dụng: bắt buộc nhập Hạn sử dụng hợp lệ (YYYY-MM-DD).`,
          400,
        );
        assertRule(
          expiryDate > today,
          `Hạn sử dụng (${expiryDate}) của "${product.name}" phải lớn hơn ngày hiện tại (${today}) — nghiêm cấm nhập hàng đã hết hạn.`,
          400,
        );
      } else if (expiryDate) {
        assertRule(isValidIsoYmd(expiryDate), `Hạn sử dụng của "${product.name}" không đúng định dạng YYYY-MM-DD.`, 400);
      }
      if (mfgDate) {
        assertRule(isValidIsoYmd(mfgDate), `Ngày sản xuất của "${product.name}" không đúng định dạng YYYY-MM-DD.`, 400);
        if (expiryDate) {
          assertRule(mfgDate <= expiryDate, `Ngày sản xuất (${mfgDate}) phải nhỏ hơn hoặc bằng Hạn sử dụng (${expiryDate}).`, 400);
        }
      }

      totalAmount += qty * unitCost;
      normalizedItems.push({
        product_id: productId,
        qty,
        unit_cost: unitCost,
        batch_code: batchCode,
        mfg_date: mfgDate,
        expiry_date: expiryDate,
        productName: product.name,
        sku: product.sku,
      });
    }

    return { supplier, normalizedItems, totalAmount };
  }

  createPurchase(actor, input) {
    const note = String(input?.note || '').trim();
    const expectedDeliveryDate = String(input?.expectedDeliveryDate || input?.expected_delivery_date || '').trim();
    if (expectedDeliveryDate) {
      assertRule(isValidIsoYmd(expectedDeliveryDate), 'Ngày giao dự kiến không đúng định dạng YYYY-MM-DD.', 400);
    }
    const { supplier, normalizedItems, totalAmount } = this._validatePurchasePayload(
      input?.supplierId,
      input?.items,
    );

    const created = withTransaction(this.db, () => {
      const po = this.repos.purchases.create(
        {
          supplier_id: supplier.id,
          created_by: actor.id,
          total_amount: totalAmount,
          expected_delivery_date: expectedDeliveryDate,
          note,
        },
        normalizedItems,
      );
      this.repos.auditLogs.append({
        actor,
        action: 'PURCHASE_CREATE',
        entityType: 'Purchase',
        entityId: po.id,
        detail: `Tạo phiếu nhập nháp ${po.id} từ NCC ${supplier.name} (${normalizedItems.length} mặt hàng, tổng ${totalAmount.toLocaleString('vi-VN')} ₫ — chưa cộng tồn kho)`,
        after: {
          id: po.id,
          supplierId: supplier.id,
          status: po.status,
          totalAmount,
          itemCount: normalizedItems.length,
        },
      });
      return po;
    });

    return this._hydratePurchaseDetail(created);
  }

  updateDraftPurchase(actor, id, input) {
    const existing = this.repos.purchases.findById(id);
    if (!existing) throw new NotFoundException(`Không tìm thấy phiếu nhập mã "${id}".`);
    if (existing.status !== 'Draft') {
      throw new ConflictException(
        `Phiếu nhập "${id}" đang ở trạng thái ${PURCHASE_STATUS_LABELS[existing.status] || existing.status}, bị khóa chỉnh sửa (BR-02).`,
      );
    }

    const supplierId = input?.supplierId !== undefined ? input.supplierId : existing.supplier_id;
    const note = input?.note !== undefined ? String(input.note).trim() : existing.note;
    const { supplier, normalizedItems, totalAmount } = this._validatePurchasePayload(supplierId, input?.items);

    const updated = withTransaction(this.db, () => {
      const po = this.repos.purchases.updateDraft(
        id,
        { supplier_id: supplier.id, total_amount: totalAmount, note },
        normalizedItems,
      );
      this.repos.auditLogs.append({
        actor,
        action: 'PURCHASE_UPDATE',
        entityType: 'Purchase',
        entityId: id,
        detail: `Cập nhật phiếu nhập nháp ${id} (${normalizedItems.length} mặt hàng, tổng ${totalAmount.toLocaleString('vi-VN')} ₫)`,
        before: { totalAmount: existing.total_amount, itemCount: existing.items.length },
        after: { totalAmount, itemCount: normalizedItems.length },
      });
      return po;
    });

    return toPurchaseDetailDto(updated);
  }

  /**
   * BR-02 & BR-06: Duyệt phiếu nhập (Draft -> Confirmed) trong 1 Transaction nguyên tử:
   * (1) Cộng tồn kho, (2) Cập nhật giá vốn bình quân gia quyền,
   * (3) Ghi Thẻ kho bất biến LichSuTonKho (NHAP_KHO), (4) Khóa phiếu thành Confirmed, (5) Ghi AuditLog.
   */
  confirmPurchase(actor, id, options = {}) {
    const confirmed = withTransaction(this.db, () => {
      const existing = this.repos.purchases.findById(id);
      if (!existing) throw new NotFoundException(`Không tìm thấy phiếu nhập mã "${id}".`);
      if (existing.status !== 'Draft') {
        throw new ConflictException(
          `Chỉ được duyệt phiếu ở trạng thái Nháp (Draft). Phiếu "${id}" hiện đang ở trạng thái ${existing.status}.`,
        );
      }

      // F-01A: Mutual exclusion — block direct PO receiving if any active GRN or AP payable already exists
      const activeGrns = this.repos.supplierOps
        ? this.repos.supplierOps.listGrns({ purchaseId: id }).filter((g) => g.status !== 'DaHuy')
        : [];
      if (activeGrns.length > 0) {
        throw new ConflictException(
          `Phiếu nhập "${id}" đã có ${activeGrns.length} phiếu nhận hàng (GRN), không thể duyệt nhập kho trực tiếp theo PO để tránh ghi nhận tồn kho và công nợ hai lần (F-01A).`,
        );
      }
      const existingPayable = this.repos.supplierOps ? this.repos.supplierOps.findPayableByPurchase(id) : null;
      if (existingPayable) {
        throw new ConflictException(
          `Phiếu nhập "${id}" đã phát sinh công nợ NCC (${existingPayable.id}), không thể xác nhận nhập kho lặp lại (F-01A).`,
        );
      }

      const supplier = this.repos.suppliers.findById(existing.supplier_id);
      assertRule(
        supplier && supplier.status === 'HoatDong',
        `Nhà cung cấp của phiếu "${id}" đã ngừng hợp tác, không thể duyệt nhập kho (BR-02).`,
        400,
      );
      assertRule(existing.items.length > 0, `Phiếu nhập "${id}" không có dòng sản phẩm hợp lệ.`, 400);

      const nowIso = new Date().toISOString();
      const movementChanges = [];

      for (const item of existing.items) {
        const product = this.repos.products.findById(item.product_id);
        assertRule(Boolean(product), `Sản phẩm "${item.product_id}" không tồn tại.`, 400);
        assertRule(
          product.status === 'DangKinhDoanh',
          `Sản phẩm "${product.name}" đã ngừng kinh doanh, không thể xác nhận nhập kho.`,
          400,
        );

        const oldStock = Number(product.stock_qty) || 0;
        const oldCost = Number(product.cost_price) || 0;
        const importQty = Number(item.qty);
        const importCost = Number(item.unit_cost);
        const newStock = oldStock + importQty;
        const newCost = computeWeightedAverageCost(oldStock, oldCost, importQty, importCost);

        // Tạo lô hàng (product_batches) với HSD & mã lô để xuất bán theo FEFO
        const warnDays = this._getNearExpiryWarnDays();
        const today = todayYmdVn();
        const expDate = String(item.expiry_date || '').trim();
        let batchStatus = 'ConHan';
        if (expDate) {
          const daysLeft = diffDaysYmd(today, expDate);
          if (daysLeft <= 0) batchStatus = 'HetHan';
          else if (daysLeft <= warnDays) batchStatus = 'CanDate';
        }
        const batchCode =
          String(item.batch_code || '').trim() ||
          `LO-${today.replace(/-/g, '')}-${id}-${product.sku}`;
        let createdBatch = null;
        if (this.repos.batches) {
          createdBatch = this.repos.batches.create({
            batchCode,
            productId: product.id,
            mfgDate: item.mfg_date || '',
            expiryDate: expDate,
            initialQty: importQty,
            qtyRemaining: importQty,
            unitCost: importCost,
            purchaseId: id,
            status: batchStatus,
            createdAt: nowIso,
          });
        }

        this.repos.products.updateStock(product.id, newStock);
        this.repos.products.update(product.id, { cost_price: newCost });

        this.repos.stockMovements.append({
          productId: product.id,
          stockBefore: oldStock,
          delta: importQty,
          stockAfter: newStock,
          docType: 'NHAP_KHO',
          docId: id,
          batchCode: createdBatch?.batch_code || batchCode,
          actorId: actor.id,
          actorName: actor.full_name,
          note: `Duyệt phiếu nhập ${id} từ ${supplier.name} · Lô ${createdBatch?.batch_code || batchCode}${expDate ? ` (HSD ${expDate})` : ''} · Đơn giá nhập ${importCost.toLocaleString('vi-VN')} ₫ (Giá vốn BQ: ${oldCost.toLocaleString('vi-VN')} → ${newCost.toLocaleString('vi-VN')} ₫)`,
        });

        movementChanges.push({
          productId: product.id,
          sku: product.sku,
          qty: importQty,
          batchCode: createdBatch?.batch_code || batchCode,
          expiryDate: expDate,
          oldStock,
          newStock,
          oldCost,
          newCost,
        });
      }

      // Hook kiểm thử rollback nguyên tử trong test nội bộ (không kích hoạt từ API công khai)
      if (typeof options._beforeCommitHook === 'function') {
        options._beforeCommitHook();
      }

      const finalPo = this.repos.purchases.updateStatus(id, 'Confirmed', {
        approved_by: actor.id,
        confirmed_at: nowIso,
      });

      // Tự động ghi nhận công nợ phải trả NCC (AP) khi xác nhận nhập kho
      if (this.repos.supplierOps && Number(existing.total_amount) > 0) {
        const dueDate = addDaysYmd(todayYmdVn(), 15);
        this.repos.supplierOps.createPayable({
          supplierId: existing.supplier_id,
          purchaseId: id,
          receiptId: null,
          totalAmount: Number(existing.total_amount),
          dueDate,
          note: `Công nợ phát sinh từ phiếu nhập ${id}`,
        });
      }

      this.repos.auditLogs.append({
        actor,
        action: 'PURCHASE_CONFIRM',
        entityType: 'Purchase',
        entityId: id,
        detail: `Duyệt nhập kho phiếu ${id} (NCC ${supplier.name}, tổng ${Number(existing.total_amount).toLocaleString('vi-VN')} ₫, ${movementChanges.length} SKU đã cộng tồn & cập nhật giá vốn bình quân)`,
        before: { status: 'Draft' },
        after: { status: 'Confirmed', changes: movementChanges },
      });

      return finalPo;
    });

    return this._hydratePurchaseDetail(confirmed);
  }

  cancelPurchase(actor, id, reason = '') {
    const cancelled = withTransaction(this.db, () => {
      const existing = this.repos.purchases.findById(id);
      if (!existing) throw new NotFoundException(`Không tìm thấy phiếu nhập mã "${id}".`);
      if (existing.status === 'Confirmed') {
        throw new ConflictException(
          `Phiếu nhập "${id}" đã được xác nhận nhập kho (Confirmed) và bị khóa vĩnh viễn, không thể hủy (BR-02).`,
        );
      }
      if (existing.status === 'Cancelled') {
        throw new ConflictException(`Phiếu nhập "${id}" đã bị hủy trước đó.`);
      }

      // F-01B: Block cancellation once partial/full receipt or AP payable exists
      const approvedReceivedMap = this.repos.purchases.getCumulativeReceivedMap(id, { approvedOnly: true });
      let totalApprovedReceivedQty = 0;
      for (const qty of approvedReceivedMap.values()) totalApprovedReceivedQty += Number(qty) || 0;
      const existingGrns = this.repos.supplierOps ? this.repos.supplierOps.listGrns({ purchaseId: id }) : [];
      const hasApprovedGrn = existingGrns.some((g) => g.status === 'DaDuyet');
      const existingPayable = this.repos.supplierOps ? this.repos.supplierOps.findPayableByPurchase(id) : null;
      if (existing.status === 'DangNhanHang' || totalApprovedReceivedQty > 0 || hasApprovedGrn || existingPayable) {
        throw new ConflictException(
          `Phiếu nhập "${id}" đã phát sinh nhận hàng (SL đã nhận: ${totalApprovedReceivedQty}) hoặc công nợ NCC${existingPayable ? ` (${existingPayable.id})` : ''}, không thể hủy sang trạng thái Cancelled để tránh mồ côi tồn kho và công nợ (F-01B).`,
        );
      }

      // Cancel any remaining unapproved (ChoDuyet) GRNs atomically so none linger on a Cancelled PO
      for (const pendingGrn of existingGrns.filter((g) => g.status === 'ChoDuyet')) {
        this.repos.supplierOps.updateGrnStatus(pendingGrn.id, 'DaHuy', {
          approved_by: actor.id,
          confirmed_at: new Date().toISOString(),
        });
      }

      const cleanReason = String(reason || '').trim();
      const nextNote = cleanReason
        ? `${existing.note ? `${existing.note} · ` : ''}Lý do hủy: ${cleanReason}`
        : existing.note;

      const updated = this.repos.purchases.updateStatus(id, 'Cancelled', {
        approved_by: actor.id,
        confirmed_at: new Date().toISOString(),
        note: nextNote,
      });

      this.repos.auditLogs.append({
        actor,
        action: 'PURCHASE_CANCEL',
        entityType: 'Purchase',
        entityId: id,
        detail: `Hủy phiếu nhập ${id} (từ ${existing.status})${cleanReason ? ` (Lý do: ${cleanReason})` : ''}`,
        before: { status: existing.status },
        after: { status: 'Cancelled', reason: cleanReason },
      });

      return updated;
    });

    return toPurchaseDetailDto(cancelled);
  }

  getRestockSuggestions() {
    const lowRows = this.repos.products.list({ status: 'DangKinhDoanh', stockLevel: 'low' });
    const pendingMap = this.repos.purchases.getPendingQtyByProduct();
    const suppliersById = new Map(this.repos.suppliers.list({}).map((s) => [s.id, s]));

    const items = lowRows
      .map((p) => {
        const sup = suppliersById.get(p.supplier_id);
        const pendingDraftQty = pendingMap.get(p.id) || 0;
        const target = Math.max(1, (Number(p.min_stock) || 15) * 2);
        const recommendedQty = Math.max(0, target - (Number(p.stock_qty) || 0) - pendingDraftQty);
        return {
          productId: p.id,
          sku: p.sku,
          name: p.name,
          imageUrl: p.image_url,
          unitName: p.unit_name,
          categoryName: p.category_name,
          supplierId: p.supplier_id,
          supplierName: sup?.name || p.supplier_name || 'Chưa rõ NCC',
          supplierActive: sup ? sup.status === 'HoatDong' : false,
          stockQty: Number(p.stock_qty) || 0,
          minStock: Number(p.min_stock) || 0,
          costPrice: Number(p.cost_price) || 0,
          pendingDraftQty,
          recommendedQty,
        };
      })
      .sort((a, b) => a.stockQty - b.stockQty || a.name.localeCompare(b.name, 'vi'));

    return { items, total: items.length };
  }

  // ─── STOCK AUDITS (BR-06, BR-07 & PHASE 2 BƯỚC 2e) ────────────────────────

  _getAuditThresholds() {
    const qtyRow = this.repos.thamSo?.findByCode?.('NguongLechKiemKeSoLuong');
    const valRow = this.repos.thamSo?.findByCode?.('NguongLechKiemKeGiaTri');
    const adminRow = this.repos.thamSo?.findByCode?.('NguongDuyetKiemKeAdmin');
    return {
      recountQtyThreshold: Math.max(1, Number(qtyRow?.gia_tri) || 5),
      recountValueThreshold: Math.max(0, Number(valRow?.gia_tri) || 500000),
      adminApprovalThreshold: Math.max(0, Number(adminRow?.gia_tri) || 2000000),
    };
  }

  _shouldBlindMask(auditRow, actor) {
    if (!auditRow || auditRow.status !== 'DangDem') return false;
    if (!actor) return false;
    // Nhân viên kho hoặc người được giao kiểm đếm không phải Admin/Manager sẽ bị ẩn số sổ sách khi đang đếm mù
    if (actor.role_code === 'WAREHOUSE') return true;
    if (actor.id === auditRow.assigned_to && !['ADMIN', 'MANAGER'].includes(actor.role_code)) return true;
    return false;
  }

  _resolveAuditReason(rawReasonCode, rawReason, diffQty, productName) {
    const code = String(rawReasonCode || '').trim().toUpperCase();
    const freeText = String(rawReason || '').trim();
    if (diffQty === 0) {
      return { reasonCode: code && AUDIT_REASON_CODES[code] ? code : '', reason: freeText };
    }
    if (code) {
      assertRule(
        Boolean(AUDIT_REASON_CODES[code]),
        `Mã lý do chênh lệch "${code}" không hợp lệ (${Object.keys(AUDIT_REASON_CODES).join(', ')}).`,
        400,
      );
      if (code === 'KHAC') {
        assertRule(
          freeText.length >= 3,
          `Sản phẩm "${productName}" chọn lý do KHAC: bắt buộc nhập mô tả cụ thể tối thiểu 3 ký tự.`,
          400,
        );
        return { reasonCode: code, reason: freeText };
      }
      return { reasonCode: code, reason: freeText || AUDIT_REASON_CODES[code] };
    }
    assertRule(
      freeText.length >= 3,
      `Sản phẩm "${productName}" có chênh lệch ${diffQty > 0 ? `+${diffQty}` : diffQty}: bắt buộc chọn Mã lý do chuẩn hoặc nhập Lý do chênh lệch tối thiểu 3 ký tự (BR-06).`,
      400,
    );
    return { reasonCode: 'KHAC', reason: freeText };
  }

  listStockAudits(filters = {}) {
    const fromDate = String(filters.fromDate || '').trim();
    const toDate = String(filters.toDate || '').trim();
    validateDateRange(fromDate, toDate);

    const rows = this.repos.stockAudits.list({
      search: filters.search || '',
      status: filters.status || '',
      fromDate,
      toDate,
    });
    const allRows = this.repos.stockAudits.list({});
    return {
      items: rows.map(toAuditSummaryDto),
      reasonCodes: AUDIT_REASON_CODES,
      summary: {
        total: allRows.length,
        countingCount: allRows.filter((r) => r.status === 'DangDem').length,
        recountCount: allRows.filter((r) => r.status === 'ChoDemLai').length,
        pendingCount: allRows.filter((r) => r.status === 'ChoDuyet').length,
        approvedCount: allRows.filter((r) => r.status === 'DaDuyet').length,
        cancelledCount: allRows.filter((r) => r.status === 'DaHuy').length,
      },
    };
  }

  getStockAudit(id, actor = null) {
    const found = this.repos.stockAudits.findById(id);
    if (!found) throw new NotFoundException(`Không tìm thấy phiếu kiểm kê mã "${id}".`);
    const blindMask = this._shouldBlindMask(found, actor);
    return toAuditDetailDto(found, { blindMask });
  }

  /**
   * BR-06 & BƯỚC 2e: Lập phiếu kiểm kê.
   * - mode='BLIND' (hoặc blind=true): Tạo phiếu kiểm mù (DangDem), đóng băng snapshot hệ thống nhưng ẨN số hệ thống với nhân viên kiểm đếm.
   * - Mặc định (direct): Tạo phiếu ChoDuyet kèm số đếm & lý do ngay (giữ tương thích ngược M3).
   */
  createStockAudit(actor, input) {
    const isBlind = String(input?.mode || '').toUpperCase() === 'BLIND' || input?.blind === true;
    const note = String(input?.note || '').trim();
    const scopeType = String(input?.scopeType || 'TOAN_KHO').trim().toUpperCase();
    const scopeValue = String(input?.scopeValue || '').trim();
    const assignedTo = String(input?.assignedTo || '').trim() || null;

    if (isBlind) {
      let targetProducts = [];
      const rawIds = Array.isArray(input?.productIds)
        ? input.productIds
        : Array.isArray(input?.items)
          ? input.items.map((x) => x?.productId || x?.product_id || x)
          : [];
      if (rawIds.length > 0) {
        const seen = new Set();
        for (const pidRaw of rawIds) {
          const pid = String(pidRaw || '').trim();
          assertRule(pid.length > 0, 'Thiếu mã sản phẩm trong phạm vi kiểm mù.', 400);
          assertRule(!seen.has(pid), `Sản phẩm "${pid}" bị trùng lặp trong phiếu kiểm kê.`, 400);
          seen.add(pid);
          const p = this.repos.products.findById(pid);
          assertRule(Boolean(p), `Sản phẩm mã "${pid}" không tồn tại.`, 400);
          targetProducts.push(p);
        }
      } else {
        const filter = { status: 'DangKinhDoanh' };
        if (scopeType === 'DANH_MUC' && scopeValue) filter.categoryCode = scopeValue;
        if (scopeType === 'NCC' && scopeValue) filter.supplierId = scopeValue;
        targetProducts = this.repos.products.list(filter).slice(0, 50);
      }
      assertRule(targetProducts.length >= 1, 'Không có sản phẩm nào trong phạm vi kiểm kê.', 400);

      const snapshotAt = new Date().toISOString();
      const blindItems = targetProducts.map((p) => ({
        product_id: p.id,
        system_qty: Number(p.stock_qty) || 0,
        actual_qty: 0,
        diff_qty: 0,
        round1_qty: null,
        round2_qty: null,
        reason_code: '',
        reason: '',
      }));

      const created = withTransaction(this.db, () => {
        const audit = this.repos.stockAudits.create(
          {
            created_by: actor.id,
            assigned_to: assignedTo,
            scope_type: scopeType,
            scope_value: scopeValue,
            snapshot_at: snapshotAt,
            requires_recount: 0,
            requires_admin_approval: 0,
            status: 'DangDem',
            note: note || 'Phiếu kiểm kê mù theo phạm vi',
          },
          blindItems,
        );
        this.repos.auditLogs.append({
          actor,
          action: 'AUDIT_CREATE_BLIND',
          entityType: 'StockAudit',
          entityId: audit.id,
          detail: `Tạo phiếu kiểm kê mù ${audit.id} (${blindItems.length} SKU, phạm vi ${scopeType}${scopeValue ? `:${scopeValue}` : ''})`,
          after: { id: audit.id, status: 'DangDem', itemCount: blindItems.length, assignedTo },
        });
        return audit;
      });
      return toAuditDetailDto(created, { blindMask: this._shouldBlindMask(created, actor) });
    }

    // Chế độ nhập kết quả trực tiếp (ChoDuyet)
    const rawItems = input?.items;
    assertRule(
      Array.isArray(rawItems) && rawItems.length >= 1,
      'Phiếu kiểm kê phải có tối thiểu 1 sản phẩm cần kiểm đếm.',
      400,
    );

    const seen = new Set();
    const normalizedItems = [];
    let totalAbsDiffValue = 0;

    for (const raw of rawItems) {
      const productId = String(raw?.productId || raw?.product_id || '').trim();
      assertRule(productId.length > 0, 'Thiếu mã sản phẩm trong phiếu kiểm kê.', 400);
      assertRule(!seen.has(productId), `Sản phẩm "${productId}" bị trùng lặp trong cùng phiếu kiểm kê.`, 400);
      seen.add(productId);

      const product = this.repos.products.findById(productId);
      assertRule(Boolean(product), `Sản phẩm mã "${productId}" không tồn tại.`, 400);

      const actualQty = parseNonNegativeInt(
        raw?.actualQty !== undefined ? raw.actualQty : raw?.actual_qty,
        `Tồn thực tế của ${product.name}`,
      );
      const systemQty = Number(product.stock_qty) || 0;
      const diffQty = actualQty - systemQty;
      const { reasonCode, reason } = this._resolveAuditReason(
        raw?.reasonCode || raw?.reason_code,
        raw?.reason,
        diffQty,
        product.name,
      );
      totalAbsDiffValue += Math.abs(diffQty) * (Number(product.cost_price) || 0);

      normalizedItems.push({
        product_id: productId,
        system_qty: systemQty,
        actual_qty: actualQty,
        diff_qty: diffQty,
        round1_qty: actualQty,
        round2_qty: null,
        reason_code: reasonCode,
        reason,
      });
    }

    const { adminApprovalThreshold } = this._getAuditThresholds();
    const requiresAdminApproval = totalAbsDiffValue >= adminApprovalThreshold ? 1 : 0;

    const created = withTransaction(this.db, () => {
      const audit = this.repos.stockAudits.create(
        {
          created_by: actor.id,
          assigned_to: assignedTo || actor.id,
          scope_type: scopeType,
          scope_value: scopeValue,
          snapshot_at: new Date().toISOString(),
          requires_recount: 0,
          requires_admin_approval: requiresAdminApproval,
          status: 'ChoDuyet',
          note: note || 'Kiểm kê kho định kỳ',
        },
        normalizedItems,
      );

      this.repos.stockAudits.addRound({
        auditId: audit.id,
        roundNo: 1,
        countedBy: actor.id,
        countedByName: actor.full_name,
        itemsJson: JSON.stringify(normalizedItems.map((i) => ({ productId: i.product_id, qty: i.actual_qty }))),
        note: note || 'Đếm trực tiếp vòng 1',
      });

      const diffCount = normalizedItems.filter((i) => i.diff_qty !== 0).length;
      this.repos.auditLogs.append({
        actor,
        action: 'AUDIT_CREATE',
        entityType: 'StockAudit',
        entityId: audit.id,
        detail: `Lập phiếu kiểm kê ${audit.id} (${normalizedItems.length} SKU, ${diffCount} SKU có chênh lệch — trạng thái Chờ duyệt${requiresAdminApproval ? ', yêu cầu Admin duyệt' : ''})`,
        after: {
          id: audit.id,
          status: audit.status,
          itemCount: normalizedItems.length,
          diffCount,
          requiresAdminApproval: Boolean(requiresAdminApproval),
        },
      });
      return audit;
    });

    return toAuditDetailDto(created);
  }

  /**
   * BƯỚC 2e: Nộp kết quả kiểm đếm mù vòng 1 (DangDem -> ChoDemLai hoặc ChoDuyet).
   */
  submitBlindCount(actor, id, input = {}) {
    const updated = withTransaction(this.db, () => {
      const existing = this.repos.stockAudits.findById(id);
      if (!existing) throw new NotFoundException(`Không tìm thấy phiếu kiểm kê mã "${id}".`);
      if (existing.status !== 'DangDem') {
        throw new ConflictException(`Chỉ được nộp kết quả đếm vòng 1 cho phiếu ở trạng thái Đang kiểm đếm (DangDem).`);
      }

      const rawItems = Array.isArray(input?.items) ? input.items : [];
      assertRule(rawItems.length >= 1, 'Vui lòng nhập số lượng thực đếm cho các sản phẩm trong phiếu.', 400);
      const countMap = new Map();
      for (const r of rawItems) {
        const pid = String(r?.productId || r?.product_id || '').trim();
        if (pid) countMap.set(pid, r);
      }

      const { recountQtyThreshold, recountValueThreshold, adminApprovalThreshold } = this._getAuditThresholds();
      let requiresRecount = false;
      let totalAbsDiffValue = 0;
      const roundSnapshot = [];

      for (const item of existing.items) {
        const entry = countMap.get(item.product_id);
        assertRule(Boolean(entry), `Thiếu kết quả kiểm đếm thực tế cho sản phẩm "${item.product_name}" (${item.sku}).`, 400);
        const actualQty = parseNonNegativeInt(
          entry.actualQty !== undefined ? entry.actualQty : entry.actual_qty,
          `Số lượng đếm vòng 1 của ${item.product_name}`,
        );
        const systemQty = Number(item.system_qty) || 0;
        const diffQty = actualQty - systemQty;
        const diffVal = Math.abs(diffQty) * (Number(item.cost_price) || 0);
        totalAbsDiffValue += diffVal;

        if (Math.abs(diffQty) >= recountQtyThreshold || diffVal >= recountValueThreshold) {
          requiresRecount = true;
        }

        // Ở bước đếm mù, nhân viên chưa thấy số sổ sách nên không bắt buộc lý do trước khi phát hiện lệch;
        // nếu có gửi mã lý do thì lưu luôn.
        const reasonCode = String(entry.reasonCode || entry.reason_code || '').trim().toUpperCase();
        const reason = String(entry.reason || '').trim();
        this.repos.stockAudits.updateItem(item.id, {
          actual_qty: actualQty,
          diff_qty: diffQty,
          round1_qty: actualQty,
          reason_code: reasonCode && AUDIT_REASON_CODES[reasonCode] ? reasonCode : '',
          reason: reason || (reasonCode && AUDIT_REASON_CODES[reasonCode] ? AUDIT_REASON_CODES[reasonCode] : ''),
        });
        roundSnapshot.push({ productId: item.product_id, sku: item.sku, qty: actualQty });
      }

      this.repos.stockAudits.addRound({
        auditId: id,
        roundNo: 1,
        countedBy: actor.id,
        countedByName: actor.full_name,
        itemsJson: JSON.stringify(roundSnapshot),
        note: String(input?.note || '').trim(),
      });

      const nextStatus = requiresRecount ? 'ChoDemLai' : 'ChoDuyet';
      const requiresAdminApproval = totalAbsDiffValue >= adminApprovalThreshold ? 1 : 0;
      const result = this.repos.stockAudits.updateHeader(id, {
        assigned_to: actor.id,
        requires_recount: requiresRecount ? 1 : 0,
        requires_admin_approval: requiresAdminApproval,
        status: nextStatus,
      });

      this.repos.auditLogs.append({
        actor,
        action: 'AUDIT_COUNT_ROUND1',
        entityType: 'StockAudit',
        entityId: id,
        detail: `Hoàn tất đếm mù vòng 1 phiếu ${id}: chuyển sang ${AUDIT_STATUS_LABELS[nextStatus]} (tổng giá trị lệch ${totalAbsDiffValue.toLocaleString('vi-VN')} ₫)`,
        after: { status: nextStatus, requiresRecount, requiresAdminApproval: Boolean(requiresAdminApproval), totalAbsDiffValue },
      });
      return result;
    });
    return toAuditDetailDto(updated);
  }

  /**
   * BƯỚC 2e: Nộp kết quả đếm lại vòng 2 (ChoDemLai -> ChoDuyet).
   * Bắt buộc người đếm vòng 2 PHẢI KHÁC người đếm vòng 1 (403 Forbidden nếu trùng người).
   */
  submitRecount(actor, id, input = {}) {
    const updated = withTransaction(this.db, () => {
      const existing = this.repos.stockAudits.findById(id);
      if (!existing) throw new NotFoundException(`Không tìm thấy phiếu kiểm kê mã "${id}".`);
      if (existing.status !== 'ChoDemLai') {
        throw new ConflictException(`Phiếu kiểm kê "${id}" không ở trạng thái Chờ đếm lại vòng 2 (ChoDemLai).`);
      }

      const round1 = (existing.rounds || []).find((r) => Number(r.round_no) === 1);
      const round1CounterId = round1?.counted_by || existing.assigned_to || existing.created_by;
      if (actor.id === round1CounterId) {
        throw new ForbiddenException(
          'Người đếm lại vòng 2 bắt buộc phải khác người đã đếm vòng 1 để đảm bảo đối chiếu độc lập.',
        );
      }

      const rawItems = Array.isArray(input?.items) ? input.items : [];
      assertRule(rawItems.length >= 1, 'Vui lòng nhập số lượng đếm lại vòng 2.', 400);
      const countMap = new Map();
      for (const r of rawItems) {
        const pid = String(r?.productId || r?.product_id || '').trim();
        if (pid) countMap.set(pid, r);
      }

      const { adminApprovalThreshold } = this._getAuditThresholds();
      let totalAbsDiffValue = 0;
      const roundSnapshot = [];

      for (const item of existing.items) {
        const entry = countMap.get(item.product_id);
        const actualQty = entry
          ? parseNonNegativeInt(
              entry.actualQty !== undefined ? entry.actualQty : entry.actual_qty,
              `Số lượng đếm vòng 2 của ${item.product_name}`,
            )
          : Number(item.actual_qty) || 0;
        const systemQty = Number(item.system_qty) || 0;
        const diffQty = actualQty - systemQty;
        const { reasonCode, reason } = this._resolveAuditReason(
          entry?.reasonCode || entry?.reason_code || item.reason_code,
          entry?.reason !== undefined ? entry.reason : item.reason,
          diffQty,
          item.product_name,
        );
        totalAbsDiffValue += Math.abs(diffQty) * (Number(item.cost_price) || 0);

        this.repos.stockAudits.updateItem(item.id, {
          actual_qty: actualQty,
          diff_qty: diffQty,
          round2_qty: actualQty,
          reason_code: reasonCode,
          reason,
        });
        roundSnapshot.push({ productId: item.product_id, sku: item.sku, qty: actualQty, reasonCode });
      }

      this.repos.stockAudits.addRound({
        auditId: id,
        roundNo: 2,
        countedBy: actor.id,
        countedByName: actor.full_name,
        itemsJson: JSON.stringify(roundSnapshot),
        note: String(input?.note || '').trim(),
      });

      const requiresAdminApproval = totalAbsDiffValue >= adminApprovalThreshold ? 1 : 0;
      const result = this.repos.stockAudits.updateHeader(id, {
        recount_by: actor.id,
        requires_admin_approval: requiresAdminApproval,
        status: 'ChoDuyet',
      });

      this.repos.auditLogs.append({
        actor,
        action: 'AUDIT_COUNT_ROUND2',
        entityType: 'StockAudit',
        entityId: id,
        detail: `Hoàn tất đếm lại vòng 2 phiếu ${id} bởi ${actor.full_name}: chuyển sang Chờ duyệt (giá trị lệch ${totalAbsDiffValue.toLocaleString('vi-VN')} ₫)`,
        after: { status: 'ChoDuyet', recountBy: actor.id, requiresAdminApproval: Boolean(requiresAdminApproval) },
      });
      return result;
    });
    return toAuditDetailDto(updated);
  }

  /**
   * BR-06, BR-07 & BƯỚC 2e: Duyệt phiếu kiểm kê (ChoDuyet -> DaDuyet) trong 1 Transaction nguyên tử:
   * - CẤM tự duyệt (actor không được là người lập / người đếm vòng 1 / người đếm vòng 2 -> 403)
   * - Duyệt phân cấp: nếu tổng |giá trị lệch| >= NguongDuyetKiemKeAdmin -> chỉ Admin mới được duyệt (403)
   * - Tính lại số tồn hệ thống tại thời điểm duyệt (thay cho chặn 409):
   *   movementsSinceSnapshot = currentLiveStock - snapshotQty
   *   effectiveSystemQty = currentLiveStock
   *   targetLiveStock = MAX(0, effectiveSystemQty + (actualQty - snapshotQty))
   * - Đồng bộ lô product_batches + products.stock_qty + ghi Thẻ kho (KIEM_KE) + AuditLog.
   */
  approveStockAudit(actor, id, options = {}) {
    const approved = withTransaction(this.db, () => {
      const existing = this.repos.stockAudits.findById(id);
      if (!existing) throw new NotFoundException(`Không tìm thấy phiếu kiểm kê mã "${id}".`);
      if (existing.status !== 'ChoDuyet') {
        throw new ConflictException(
          `Chỉ được duyệt phiếu kiểm kê ở trạng thái Chờ duyệt. Phiếu "${id}" đang là ${existing.status}.`,
        );
      }

      // Kiểm soát tách biệt nhiệm vụ: CẤM tự duyệt phiếu do chính mình lập hoặc kiểm đếm
      const participantIds = new Set(
        [
          existing.created_by,
          existing.assigned_to,
          existing.recount_by,
          ...(existing.rounds || []).map((r) => r.counted_by),
        ].filter(Boolean),
      );
      if (participantIds.has(actor.id)) {
        throw new ForbiddenException(
          `Không được tự duyệt phiếu kiểm kê "${id}" do chính mình lập hoặc tham gia kiểm đếm.`,
        );
      }

      // Kiểm tra phân cấp duyệt theo ngưỡng giá trị chênh lệch (NguongDuyetKiemKeAdmin)
      const { adminApprovalThreshold } = this._getAuditThresholds();
      let totalAbsDiffValue = 0;
      const resolvedLines = [];
      for (const item of existing.items) {
        const product = this.repos.products.findById(item.product_id);
        assertRule(Boolean(product), `Sản phẩm "${item.product_id}" không tồn tại.`, 400);

        const snapshotQty = Number(item.system_qty) || 0;
        const actualQty = Number(item.actual_qty);
        assertRule(actualQty >= 0, `Tồn thực tế của "${product.name}" không được âm.`, 400);
        const auditDiff = actualQty - snapshotQty;
        const currentLiveStock = Number(product.stock_qty) || 0;
        const movementsSinceSnapshot = currentLiveStock - snapshotQty;
        const effectiveSystemQty = snapshotQty + movementsSinceSnapshot; // === currentLiveStock
        const targetLiveStock = Math.max(0, effectiveSystemQty + auditDiff);
        const appliedDelta = targetLiveStock - currentLiveStock;

        totalAbsDiffValue += Math.abs(auditDiff) * (Number(product.cost_price) || 0);
        resolvedLines.push({
          item,
          product,
          snapshotQty,
          actualQty,
          auditDiff,
          currentLiveStock,
          movementsSinceSnapshot,
          effectiveSystemQty,
          targetLiveStock,
          appliedDelta,
        });
      }

      if (
        (totalAbsDiffValue >= adminApprovalThreshold || Number(existing.requires_admin_approval) === 1) &&
        actor.role_code !== 'ADMIN'
      ) {
        throw new ForbiddenException(
          `Phiếu kiểm kê "${id}" có tổng giá trị chênh lệch ${totalAbsDiffValue.toLocaleString('vi-VN')} ₫ vượt ngưỡng ${adminApprovalThreshold.toLocaleString('vi-VN')} ₫ — yêu cầu Quản trị viên (Admin) phê duyệt.`,
        );
      }

      // Cập nhật đối chiếu biến động phát sinh & đồng bộ tồn kho + lô hàng
      const adjustments = [];
      const today = todayYmdVn();
      for (const line of resolvedLines) {
        const {
          item,
          product,
          snapshotQty,
          currentLiveStock,
          movementsSinceSnapshot,
          effectiveSystemQty,
          targetLiveStock,
          appliedDelta,
        } = line;

        this.repos.stockAudits.updateItem(item.id, {
          movements_since_snapshot: movementsSinceSnapshot,
          effective_system_qty: effectiveSystemQty,
        });

        if (appliedDelta !== 0) {
          if (this.repos.batches) {
            if (appliedDelta < 0) {
              let remain = Math.abs(appliedDelta);
              const salable = this.repos.batches.findSalableFefo(product.id, today);
              for (const b of salable) {
                if (remain <= 0) break;
                const take = Math.min(remain, Number(b.qty_remaining) || 0);
                if (take > 0) {
                  const afterQty = (Number(b.qty_remaining) || 0) - take;
                  this.repos.batches.updateQtyAndStatus(b.id, afterQty, afterQty === 0 ? 'DaHet' : b.status);
                  remain -= take;
                }
              }
            } else {
              const salable = this.repos.batches.findSalableFefo(product.id, today);
              if (salable.length > 0) {
                const targetBatch = salable[salable.length - 1];
                this.repos.batches.updateQtyAndStatus(
                  targetBatch.id,
                  (Number(targetBatch.qty_remaining) || 0) + appliedDelta,
                  targetBatch.status === 'DaHet' ? 'ConHan' : targetBatch.status,
                );
              } else {
                this.repos.batches.create({
                  batchCode: `LO-KK-${id}-${product.sku}`,
                  productId: product.id,
                  mfgDate: today,
                  expiryDate: Number(product.has_expiry) === 1 ? addDaysYmd(today, 180) : '',
                  initialQty: appliedDelta,
                  qtyRemaining: appliedDelta,
                  unitCost: Number(product.cost_price) || 0,
                  status: 'ConHan',
                });
              }
            }
          }

          this.repos.products.updateStock(product.id, targetLiveStock);
          const reconcileNote =
            movementsSinceSnapshot !== 0
              ? ` (đối chiếu biến động phát sinh sau chốt sổ ${movementsSinceSnapshot > 0 ? `+${movementsSinceSnapshot}` : movementsSinceSnapshot}: sổ gốc ${snapshotQty} → tồn lúc duyệt ${currentLiveStock} → sau điều chỉnh ${targetLiveStock})`
              : '';
          this.repos.stockMovements.append({
            productId: product.id,
            stockBefore: currentLiveStock,
            delta: appliedDelta,
            stockAfter: targetLiveStock,
            docType: 'KIEM_KE',
            docId: id,
            actorId: actor.id,
            actorName: actor.full_name,
            note: `Duyệt kiểm kê ${id}: ${item.reason || existing.note || 'Điều chỉnh theo tồn thực tế'}${reconcileNote}`,
          });
          adjustments.push({
            productId: product.id,
            sku: product.sku,
            snapshotQty,
            movementsSinceSnapshot,
            stockBefore: currentLiveStock,
            delta: appliedDelta,
            stockAfter: targetLiveStock,
            reasonCode: item.reason_code || '',
            reason: item.reason,
          });
        }
      }

      if (typeof options._beforeCommitHook === 'function') {
        options._beforeCommitHook();
      }

      const finalAudit = this.repos.stockAudits.updateStatus(id, 'DaDuyet', {
        approved_by: actor.id,
        approved_at: new Date().toISOString(),
      });

      this.repos.auditLogs.append({
        actor,
        action: 'AUDIT_APPROVE',
        entityType: 'StockAudit',
        entityId: id,
        detail: `Duyệt phiếu kiểm kê ${id}: điều chỉnh tồn kho cho ${adjustments.length}/${existing.items.length} SKU (tổng giá trị lệch ${totalAbsDiffValue.toLocaleString('vi-VN')} ₫)`,
        before: { status: 'ChoDuyet' },
        after: { status: 'DaDuyet', totalAbsDiffValue, adjustments },
      });

      return finalAudit;
    });

    return toAuditDetailDto(approved);
  }

  cancelStockAudit(actor, id, reason = '') {
    const cancelled = withTransaction(this.db, () => {
      const existing = this.repos.stockAudits.findById(id);
      if (!existing) throw new NotFoundException(`Không tìm thấy phiếu kiểm kê mã "${id}".`);
      if (existing.status === 'DaDuyet') {
        throw new ConflictException(`Phiếu kiểm kê "${id}" đã duyệt điều chỉnh tồn kho, không thể hủy.`);
      }
      if (existing.status === 'DaHuy') {
        throw new ConflictException(`Phiếu kiểm kê "${id}" đã bị hủy trước đó.`);
      }

      const cleanReason = String(reason || '').trim();
      const nextNote = cleanReason
        ? `${existing.note ? `${existing.note} · ` : ''}Lý do hủy: ${cleanReason}`
        : existing.note;

      const updated = this.repos.stockAudits.updateStatus(id, 'DaHuy', {
        approved_by: actor.id,
        approved_at: new Date().toISOString(),
        note: nextNote,
      });

      this.repos.auditLogs.append({
        actor,
        action: 'AUDIT_CANCEL',
        entityType: 'StockAudit',
        entityId: id,
        detail: `Hủy phiếu kiểm kê ${id}${cleanReason ? ` (Lý do: ${cleanReason})` : ''}`,
        before: { status: existing.status },
        after: { status: 'DaHuy', reason: cleanReason },
      });

      return updated;
    });

    return toAuditDetailDto(cancelled);
  }

  // ─── TWO-WAY PURCHASING, SUPPLIER PORTAL, GRN, AP PAYABLES & SUPPLIER RETURNS (BƯỚC 2d) ─

  _getPriceDeviationWarnPct() {
    const row = this.repos.thamSo?.findByCode?.('CanhBaoLechGiaNhapPct');
    const val = row ? Number(row.gia_tri) : 15;
    return Number.isFinite(val) && val >= 0 ? val : 15;
  }

  sendPurchaseToSupplier(actor, id, input = {}) {
    const updated = withTransaction(this.db, () => {
      const existing = this.repos.purchases.findById(id);
      if (!existing) throw new NotFoundException(`Không tìm thấy đơn đặt hàng (PO) mã "${id}".`);
      if (existing.status !== 'Draft') {
        throw new ConflictException(`Chỉ có thể gửi NCC từ trạng thái Nháp (Draft). PO "${id}" đang là ${existing.status}.`);
      }
      const expectedDeliveryDate = String(
        input?.expectedDeliveryDate ?? existing.expected_delivery_date ?? '',
      ).trim();
      if (expectedDeliveryDate) {
        assertRule(isValidIsoYmd(expectedDeliveryDate), 'Ngày giao dự kiến không đúng định dạng YYYY-MM-DD.', 400);
      }
      const note = String(input?.note || '').trim();
      const po = this.repos.purchases.updateNegotiationTerms(id, {
        status: 'GuiNCC',
        expected_delivery_date: expectedDeliveryDate,
      });
      this.repos.supplierOps.addNegotiation({
        purchaseId: id,
        roundNo: 1,
        actorId: actor.id,
        actorRole: actor.role_code,
        actorName: actor.full_name,
        action: 'SEND_TO_SUPPLIER',
        proposedItemsJson: JSON.stringify(
          existing.items.map((i) => ({ productId: i.product_id, sku: i.sku, qty: i.qty, unitCost: i.unit_cost })),
        ),
        expectedDeliveryDate,
        note: note || 'Gửi đơn đặt hàng cho Nhà cung cấp xác nhận',
      });
      this.repos.auditLogs.append({
        actor,
        action: 'PURCHASE_SEND_SUPPLIER',
        entityType: 'Purchase',
        entityId: id,
        detail: `Gửi PO ${id} cho NCC ${existing.supplier_name} (Draft → GuiNCC)`,
        after: { status: 'GuiNCC', expectedDeliveryDate },
      });
      return po;
    });
    return this._hydratePurchaseDetail(updated);
  }

  listSupplierPortalPurchases(actor, filters = {}) {
    let supplierId = String(filters.supplierId || '').trim();
    if (actor.role_code === 'SUPPLIER') {
      assertRule(Boolean(actor.supplier_id), 'Tài khoản Nhà cung cấp chưa được gắn mã NCC.', 403);
      supplierId = actor.supplier_id;
    }
    const rows = this.repos.purchases.list({
      search: filters.search || '',
      supplierId,
      status: filters.status || '',
    });
    const visible = rows.filter((r) => r.status !== 'Draft');
    return {
      items: visible.map(toPurchaseSummaryDto),
      supplierId: supplierId || null,
      summary: {
        total: visible.length,
        waitingResponse: visible.filter((r) => ['GuiNCC', 'ThuongLuong'].includes(r.status)).length,
        responded: visible.filter((r) => r.status === 'NCCPhanHoi').length,
        agreed: visible.filter((r) => ['DaThongNhat', 'DangNhanHang'].includes(r.status)).length,
        confirmed: visible.filter((r) => r.status === 'Confirmed').length,
      },
    };
  }

  getSupplierPortalPurchase(actor, id) {
    const found = this.repos.purchases.findById(id);
    if (!found) throw new NotFoundException(`Không tìm thấy đơn đặt hàng mã "${id}".`);
    if (actor.role_code === 'SUPPLIER' && found.supplier_id !== actor.supplier_id) {
      throw new ForbiddenException(`Nhà cung cấp không được phép truy cập đơn hàng "${id}" của nhà cung cấp khác.`);
    }
    return this._hydratePurchaseDetail(found);
  }

  respondToPurchase(actor, id, input = {}) {
    const updated = withTransaction(this.db, () => {
      const existing = this.repos.purchases.findById(id);
      if (!existing) throw new NotFoundException(`Không tìm thấy đơn đặt hàng mã "${id}".`);
      if (actor.role_code === 'SUPPLIER' && existing.supplier_id !== actor.supplier_id) {
        throw new ForbiddenException(`Nhà cung cấp không được phép phản hồi đơn hàng "${id}" của nhà cung cấp khác.`);
      }
      if (!['GuiNCC', 'ThuongLuong'].includes(existing.status)) {
        throw new ConflictException(
          `PO "${id}" đang ở trạng thái ${existing.status}, không thể gửi phản hồi nhà cung cấp.`,
        );
      }

      const action = String(input?.action || 'ACCEPT').trim().toUpperCase();
      assertRule(['ACCEPT', 'COUNTER', 'REJECT'].includes(action), 'Hành động phản hồi phải là ACCEPT / COUNTER / REJECT.', 400);
      const note = String(input?.note || '').trim();
      const expectedDeliveryDate = String(
        input?.expectedDeliveryDate ?? existing.expected_delivery_date ?? '',
      ).trim();
      if (expectedDeliveryDate) {
        assertRule(isValidIsoYmd(expectedDeliveryDate), 'Ngày giao dự kiến không đúng định dạng YYYY-MM-DD.', 400);
      }

      const prevRounds = this.repos.supplierOps.listNegotiations(id);
      const roundNo = prevRounds.length + 1;

      if (action === 'REJECT') {
        assertRule(note.length >= 3, 'Từ chối đơn hàng bắt buộc nhập lý do (tối thiểu 3 ký tự).', 400);
        const po = this.repos.purchases.updateNegotiationTerms(id, {
          status: 'Cancelled',
          note: `${existing.note ? `${existing.note} · ` : ''}NCC từ chối: ${note}`,
        });
        this.repos.supplierOps.addNegotiation({
          purchaseId: id,
          roundNo,
          actorId: actor.id,
          actorRole: actor.role_code,
          actorName: actor.full_name,
          action: 'SUPPLIER_REJECT',
          proposedItemsJson: '[]',
          expectedDeliveryDate,
          note,
        });
        this.repos.auditLogs.append({
          actor,
          action: 'PURCHASE_SUPPLIER_REJECT',
          entityType: 'Purchase',
          entityId: id,
          detail: `NCC từ chối PO ${id}: ${note}`,
        });
        return po;
      }

      if (action === 'ACCEPT') {
        const po = this.repos.purchases.updateNegotiationTerms(id, {
          status: 'DaThongNhat',
          expected_delivery_date: expectedDeliveryDate,
        });
        this.repos.supplierOps.addNegotiation({
          purchaseId: id,
          roundNo,
          actorId: actor.id,
          actorRole: actor.role_code,
          actorName: actor.full_name,
          action: 'SUPPLIER_ACCEPT',
          proposedItemsJson: JSON.stringify(
            existing.items.map((i) => ({ productId: i.product_id, sku: i.sku, qty: i.qty, unitCost: i.unit_cost })),
          ),
          expectedDeliveryDate,
          note: note || 'Nhà cung cấp đồng ý giao đủ theo điều khoản PO',
        });
        this.repos.auditLogs.append({
          actor,
          action: 'PURCHASE_SUPPLIER_ACCEPT',
          entityType: 'Purchase',
          entityId: id,
          detail: `NCC xác nhận đồng ý PO ${id} (→ DaThongNhat)`,
        });
        return po;
      }

      // action === 'COUNTER' (đề xuất giá / số lượng / ngày giao mới -> NCCPhanHoi)
      const proposedRaw = Array.isArray(input?.items) && input.items.length > 0 ? input.items : existing.items;
      const mergedItems = existing.items.map((orig) => {
        const override = proposedRaw.find((x) => (x.productId || x.product_id) === orig.product_id);
        const qty = override?.qty !== undefined ? parsePositiveInt(override.qty, `SL đề xuất ${orig.product_name}`) : orig.qty;
        const unitCost =
          override?.unitCost !== undefined || override?.unit_cost !== undefined
            ? parseNonNegativeInt(override.unitCost ?? override.unit_cost, `Đơn giá đề xuất ${orig.product_name}`)
            : orig.unit_cost;
        return {
          product_id: orig.product_id,
          qty,
          unit_cost: unitCost,
          batch_code: orig.batch_code || '',
          mfg_date: orig.mfg_date || '',
          expiry_date: orig.expiry_date || '',
        };
      });
      const totalAmount = mergedItems.reduce((s, i) => s + i.qty * i.unit_cost, 0);
      const po = this.repos.purchases.updateNegotiationTerms(
        id,
        {
          status: 'NCCPhanHoi',
          total_amount: totalAmount,
          expected_delivery_date: expectedDeliveryDate,
        },
        mergedItems,
      );
      this.repos.supplierOps.addNegotiation({
        purchaseId: id,
        roundNo,
        actorId: actor.id,
        actorRole: actor.role_code,
        actorName: actor.full_name,
        action: 'SUPPLIER_COUNTER',
        proposedItemsJson: JSON.stringify(mergedItems),
        expectedDeliveryDate,
        note: note || 'NCC gửi đề xuất điều chỉnh giá/số lượng',
      });
      this.repos.auditLogs.append({
        actor,
        action: 'PURCHASE_SUPPLIER_COUNTER',
        entityType: 'Purchase',
        entityId: id,
        detail: `NCC phản hồi thương lượng vòng ${roundNo} cho PO ${id} (tổng mới ${totalAmount.toLocaleString('vi-VN')} ₫)`,
      });
      return po;
    });
    return this._hydratePurchaseDetail(updated);
  }

  counterPurchase(actor, id, input = {}) {
    const updated = withTransaction(this.db, () => {
      const existing = this.repos.purchases.findById(id);
      if (!existing) throw new NotFoundException(`Không tìm thấy đơn đặt hàng mã "${id}".`);
      if (existing.status !== 'NCCPhanHoi') {
        throw new ConflictException(`Chỉ gửi thương lượng ngược khi PO đang ở trạng thái NCC phản hồi (NCCPhanHoi).`);
      }
      const proposedRaw = Array.isArray(input?.items) && input.items.length > 0 ? input.items : existing.items;
      const mergedItems = existing.items.map((orig) => {
        const override = proposedRaw.find((x) => (x.productId || x.product_id) === orig.product_id);
        const qty = override?.qty !== undefined ? parsePositiveInt(override.qty, `SL thương lượng ${orig.product_name}`) : orig.qty;
        const unitCost =
          override?.unitCost !== undefined || override?.unit_cost !== undefined
            ? parseNonNegativeInt(override.unitCost ?? override.unit_cost, `Đơn giá thương lượng ${orig.product_name}`)
            : orig.unit_cost;
        return {
          product_id: orig.product_id,
          qty,
          unit_cost: unitCost,
          batch_code: orig.batch_code || '',
          mfg_date: orig.mfg_date || '',
          expiry_date: orig.expiry_date || '',
        };
      });
      const expectedDeliveryDate = String(
        input?.expectedDeliveryDate ?? existing.expected_delivery_date ?? '',
      ).trim();
      const note = String(input?.note || '').trim();
      const totalAmount = mergedItems.reduce((s, i) => s + i.qty * i.unit_cost, 0);
      const prevRounds = this.repos.supplierOps.listNegotiations(id);
      const roundNo = prevRounds.length + 1;

      const po = this.repos.purchases.updateNegotiationTerms(
        id,
        {
          status: 'ThuongLuong',
          total_amount: totalAmount,
          expected_delivery_date: expectedDeliveryDate,
        },
        mergedItems,
      );
      this.repos.supplierOps.addNegotiation({
        purchaseId: id,
        roundNo,
        actorId: actor.id,
        actorRole: actor.role_code,
        actorName: actor.full_name,
        action: 'STORE_COUNTER',
        proposedItemsJson: JSON.stringify(mergedItems),
        expectedDeliveryDate,
        note: note || 'Cửa hàng gửi đề xuất thương lượng lại',
      });
      this.repos.auditLogs.append({
        actor,
        action: 'PURCHASE_STORE_COUNTER',
        entityType: 'Purchase',
        entityId: id,
        detail: `Cửa hàng thương lượng vòng ${roundNo} cho PO ${id} (tổng ${totalAmount.toLocaleString('vi-VN')} ₫)`,
      });
      return po;
    });
    return this._hydratePurchaseDetail(updated);
  }

  agreePurchase(actor, id, input = {}) {
    const updated = withTransaction(this.db, () => {
      const existing = this.repos.purchases.findById(id);
      if (!existing) throw new NotFoundException(`Không tìm thấy đơn đặt hàng mã "${id}".`);
      const prevRounds = this.repos.supplierOps.listNegotiations(id);
      const hasSupplierResponse = prevRounds.some((r) =>
        ['SUPPLIER_COUNTER', 'SUPPLIER_ACCEPT'].includes(r.action),
      );
      // F-01C: Require recorded supplier response before store can finalize DaThongNhat
      if (existing.status !== 'NCCPhanHoi' || !hasSupplierResponse) {
        throw new ConflictException(
          `PO "${id}" đang ở trạng thái ${existing.status} và chưa có phản hồi xác nhận từ Nhà cung cấp. Chỉ được chốt thống nhất khi NCC đã phản hồi (NCCPhanHoi) hoặc NCC tự xác nhận ACCEPT (F-01C).`,
        );
      }
      const note = String(input?.note || '').trim();
      const roundNo = prevRounds.length + 1;
      const po = this.repos.purchases.updateNegotiationTerms(id, { status: 'DaThongNhat' });
      this.repos.supplierOps.addNegotiation({
        purchaseId: id,
        roundNo,
        actorId: actor.id,
        actorRole: actor.role_code,
        actorName: actor.full_name,
        action: 'STORE_AGREE',
        proposedItemsJson: JSON.stringify(
          existing.items.map((i) => ({ productId: i.product_id, qty: i.qty, unitCost: i.unit_cost })),
        ),
        expectedDeliveryDate: existing.expected_delivery_date || '',
        note: note || 'Cửa hàng chốt thống nhất điều khoản đặt hàng',
      });
      this.repos.auditLogs.append({
        actor,
        action: 'PURCHASE_AGREE',
        entityType: 'Purchase',
        entityId: id,
        detail: `Chốt thống nhất PO ${id} (→ DaThongNhat, chờ nhận hàng GRN)`,
      });
      return po;
    });
    return this._hydratePurchaseDetail(updated);
  }

  // ─── GOODS RECEIPTS (GRN — NHẬN HÀNG NHIỀU ĐỢT) ───────────────────────────

  _toGrnDto(row) {
    return {
      id: row.id,
      purchaseId: row.purchase_id,
      supplierId: row.supplier_id,
      supplierName: row.supplier_name,
      receivedBy: row.received_by,
      receivedByName: row.received_by_name,
      approvedBy: row.approved_by || null,
      approvedByName: row.approved_by_name || null,
      totalReceivedAmount: Number(row.total_received_amount) || 0,
      totalReceivedQty: Number(row.total_received_qty) || (row.items || []).reduce((s, i) => s + Number(i.received_qty || 0), 0),
      totalRejectedQty: Number(row.total_rejected_qty) || (row.items || []).reduce((s, i) => s + Number(i.rejected_qty || 0), 0),
      status: row.status,
      statusLabel: GRN_STATUS_LABELS[row.status] || row.status,
      note: row.note || '',
      createdAt: row.created_at,
      confirmedAt: row.confirmed_at || null,
      items: row.items
        ? row.items.map((i) => ({
            id: i.id,
            productId: i.product_id,
            sku: i.sku,
            productName: i.product_name,
            unitName: i.unit_name,
            orderedQty: Number(i.ordered_qty) || 0,
            receivedQty: Number(i.received_qty) || 0,
            rejectedQty: Number(i.rejected_qty) || 0,
            unitCost: Number(i.unit_cost) || 0,
            lineTotal: (Number(i.received_qty) || 0) * (Number(i.unit_cost) || 0),
            batchCode: i.batch_code || '',
            mfgDate: i.mfg_date || '',
            expiryDate: i.expiry_date || '',
            qcNote: i.qc_note || '',
          }))
        : undefined,
    };
  }

  listGoodsReceipts(filters = {}) {
    const rows = this.repos.supplierOps.listGrns({
      purchaseId: filters.purchaseId || '',
      supplierId: filters.supplierId || '',
      status: filters.status || '',
    });
    return {
      items: rows.map((r) => this._toGrnDto(r)),
      summary: {
        total: rows.length,
        pendingCount: rows.filter((r) => r.status === 'ChoDuyet').length,
        approvedCount: rows.filter((r) => r.status === 'DaDuyet').length,
      },
    };
  }

  getGoodsReceipt(id) {
    const found = this.repos.supplierOps.findGrnById(id);
    if (!found) throw new NotFoundException(`Không tìm thấy phiếu nhận hàng (GRN) mã "${id}".`);
    return this._toGrnDto(found);
  }

  createGoodsReceipt(actor, input = {}) {
    const purchaseId = String(input?.purchaseId || input?.purchase_id || '').trim();
    assertRule(purchaseId.length > 0, 'Vui lòng chọn mã Đơn đặt hàng (PO) cần nhận hàng.', 400);
    const rawItems = Array.isArray(input?.items) ? input.items : [];
    assertRule(rawItems.length >= 1, 'Phiếu nhận hàng (GRN) phải có tối thiểu 1 mặt hàng.', 400);

    const warnings = [];
    const created = withTransaction(this.db, () => {
      const po = this.repos.purchases.findById(purchaseId);
      if (!po) throw new NotFoundException(`Không tìm thấy đơn đặt hàng mã "${purchaseId}".`);
      // F-01A: Disallow creating GRN against Draft, Cancelled, Confirmed, or unagreed POs
      if (!['DaThongNhat', 'DangNhanHang'].includes(po.status)) {
        throw new ConflictException(
          `PO "${purchaseId}" đang ở trạng thái ${po.status}. Chỉ được lập phiếu nhận hàng (GRN) cho PO đã thống nhất (DaThongNhat) hoặc đang nhận hàng (DangNhanHang) (F-01A).`,
        );
      }
      const directPoPayable = this.db
        .prepare('SELECT id FROM supplier_payables WHERE purchase_id = ? AND receipt_id IS NULL LIMIT 1')
        .get(purchaseId);
      if (directPoPayable) {
        throw new ConflictException(
          `PO "${purchaseId}" đã được xác nhận nhập kho trực tiếp (${directPoPayable.id}), không thể lập thêm GRN (F-01A).`,
        );
      }

      const poItemMap = new Map(po.items.map((i) => [i.product_id, i]));
      const alreadyMap = this.repos.purchases.getCumulativeReceivedMap(purchaseId, { approvedOnly: false });
      const warnPct = this._getPriceDeviationWarnPct();
      const today = todayYmdVn();
      const normalized = [];
      let totalReceivedAmount = 0;

      for (const raw of rawItems) {
        const productId = String(raw?.productId || raw?.product_id || '').trim();
        const poItem = poItemMap.get(productId);
        assertRule(Boolean(poItem), `Sản phẩm "${productId}" không thuộc đơn đặt hàng "${purchaseId}".`, 400);
        const product = this.repos.products.findById(productId);

        const receivedQty = parseNonNegativeInt(raw?.receivedQty ?? raw?.received_qty, `SL nhận của ${poItem.product_name}`);
        const rejectedQty = parseNonNegativeInt(raw?.rejectedQty ?? raw?.rejected_qty ?? 0, `SL từ chối QC của ${poItem.product_name}`);
        assertRule(receivedQty + rejectedQty > 0, `Dòng "${poItem.product_name}" phải có SL nhận hoặc SL từ chối > 0.`, 400);

        const alreadyReceived = alreadyMap.get(productId) || 0;
        const maxCanReceive = Math.max(0, Number(poItem.qty) - alreadyReceived);
        assertRule(
          receivedQty <= maxCanReceive,
          `Sản phẩm "${poItem.product_name}" chỉ còn chờ nhận ${maxCanReceive} (đặt ${poItem.qty}, đã lập GRN ${alreadyReceived}), không thể nhận ${receivedQty}.`,
          400,
        );
        alreadyMap.set(productId, alreadyReceived + receivedQty);

        const unitCost = parseNonNegativeInt(
          raw?.unitCost !== undefined ? raw.unitCost : poItem.unit_cost,
          `Đơn giá nhận của ${poItem.product_name}`,
        );
        const expiryDate = String(raw?.expiryDate ?? raw?.expiry_date ?? poItem.expiry_date ?? '').trim();
        const mfgDate = String(raw?.mfgDate ?? raw?.mfg_date ?? poItem.mfg_date ?? '').trim();
        const batchCode = String(raw?.batchCode ?? raw?.batch_code ?? poItem.batch_code ?? '').trim();

        if (receivedQty > 0 && Number(product?.has_expiry ?? 1) === 1) {
          assertRule(isValidIsoYmd(expiryDate), `Sản phẩm "${poItem.product_name}" bắt buộc nhập Hạn sử dụng (YYYY-MM-DD).`, 400);
          assertRule(expiryDate > today, `Hạn sử dụng (${expiryDate}) của "${poItem.product_name}" phải lớn hơn hôm nay (${today}).`, 400);
        }

        if (unitCost === 0) {
          warnings.push(`${poItem.sku}: Đơn giá nhập 0 ₫ (hàng tặng / khuyến mãi).`);
        } else if (Number(product?.cost_price) > 0) {
          const pct = (Math.abs(unitCost - Number(product.cost_price)) / Number(product.cost_price)) * 100;
          if (pct > warnPct) {
            warnings.push(`${poItem.sku}: Đơn giá nhận lệch ${pct.toFixed(1)}% so với giá vốn hiện tại.`);
          }
        }

        totalReceivedAmount += receivedQty * unitCost;
        normalized.push({
          product_id: productId,
          ordered_qty: Number(poItem.qty),
          received_qty: receivedQty,
          rejected_qty: rejectedQty,
          unit_cost: unitCost,
          batch_code: batchCode,
          mfg_date: mfgDate,
          expiry_date: expiryDate,
          qc_note: String(raw?.qcNote || raw?.qc_note || '').trim(),
        });
      }

      const grn = this.repos.supplierOps.createGrn(
        {
          purchase_id: purchaseId,
          supplier_id: po.supplier_id,
          received_by: actor.id,
          total_received_amount: totalReceivedAmount,
          note: String(input?.note || '').trim(),
        },
        normalized,
      );
      this.repos.auditLogs.append({
        actor,
        action: 'GRN_CREATE',
        entityType: 'GoodsReceipt',
        entityId: grn.id,
        detail: `Lập phiếu nhận hàng ${grn.id} cho PO ${purchaseId} (${normalized.length} dòng, giá trị ${totalReceivedAmount.toLocaleString('vi-VN')} ₫ — Chờ duyệt)`,
      });
      return grn;
    });

    return { ...this._toGrnDto(created), warnings };
  }

  confirmGoodsReceipt(actor, id, options = {}) {
    const confirmed = withTransaction(this.db, () => {
      const grn = this.repos.supplierOps.findGrnById(id);
      if (!grn) throw new NotFoundException(`Không tìm thấy phiếu nhận hàng (GRN) mã "${id}".`);
      if (grn.status !== 'ChoDuyet') {
        throw new ConflictException(`Chỉ được duyệt GRN ở trạng thái Chờ duyệt. Phiếu "${id}" đang là ${grn.status}.`);
      }
      // F-01D: Enforce separation of duties (creator cannot approve their own GRN)
      if (grn.received_by && grn.received_by === actor.id) {
        throw new ForbiddenException(
          `Người lập phiếu nhận hàng "${id}" không được tự duyệt phiếu của chính mình (nguyên tắc tách bạch nhiệm vụ — F-01D). Vui lòng để Quản lý / Admin khác xác nhận.`,
        );
      }
      const po = this.repos.purchases.findById(grn.purchase_id);
      if (!po) throw new NotFoundException(`Không tìm thấy PO "${grn.purchase_id}".`);
      // F-01A: Re-validate PO status, mutual exclusion with direct PO AP, and cumulative received qty inside TX
      if (!['DaThongNhat', 'DangNhanHang'].includes(po.status)) {
        throw new ConflictException(
          `Không thể duyệt GRN "${id}" vì PO "${po.id}" đang ở trạng thái ${po.status} (yêu cầu DaThongNhat hoặc DangNhanHang) (F-01A).`,
        );
      }
      const directPoPayable = this.db
        .prepare('SELECT id FROM supplier_payables WHERE purchase_id = ? AND receipt_id IS NULL LIMIT 1')
        .get(po.id);
      if (directPoPayable) {
        throw new ConflictException(
          `PO "${po.id}" đã phát sinh công nợ từ duyệt trực tiếp (${directPoPayable.id}), không thể duyệt thêm GRN "${id}" (F-01A).`,
        );
      }
      const existingGrnPayable = this.repos.supplierOps.findPayableByReceipt(id);
      if (existingGrnPayable) {
        throw new ConflictException(
          `GRN "${id}" đã phát sinh công nợ (${existingGrnPayable.id}), không thể duyệt lặp lại (F-01A).`,
        );
      }
      const poItemMap = new Map(po.items.map((pi) => [pi.product_id, pi]));
      const approvedBeforeMap = this.repos.purchases.getCumulativeReceivedMap(po.id, { approvedOnly: true });
      for (const item of grn.items) {
        const receivedQty = Number(item.received_qty) || 0;
        if (receivedQty <= 0) continue;
        const poItem = poItemMap.get(item.product_id);
        if (!poItem) {
          throw new ConflictException(`Sản phẩm "${item.product_id}" không tồn tại trong PO "${po.id}".`);
        }
        const approvedBefore = approvedBeforeMap.get(item.product_id) || 0;
        if (approvedBefore + receivedQty > Number(poItem.qty)) {
          throw new ConflictException(
            `Không thể duyệt GRN "${id}": tổng SL nhận (${approvedBefore + receivedQty}) vượt quá SL đặt (${poItem.qty}) của "${poItem.product_name}" (F-01A).`,
          );
        }
        approvedBeforeMap.set(item.product_id, approvedBefore + receivedQty);
      }

      const nowIso = new Date().toISOString();
      const today = todayYmdVn();
      const warnDays = this._getNearExpiryWarnDays();

      for (const item of grn.items) {
        const receivedQty = Number(item.received_qty) || 0;
        if (receivedQty <= 0) continue;
        const product = this.repos.products.findById(item.product_id);
        assertRule(Boolean(product), `Sản phẩm "${item.product_id}" không tồn tại.`, 400);

        const oldStock = Number(product.stock_qty) || 0;
        const oldCost = Number(product.cost_price) || 0;
        const importCost = Number(item.unit_cost) || 0;
        const newStock = oldStock + receivedQty;
        const newCost = computeWeightedAverageCost(oldStock, oldCost, receivedQty, importCost);

        const expDate = String(item.expiry_date || '').trim();
        let batchStatus = 'ConHan';
        if (expDate) {
          const daysLeft = diffDaysYmd(today, expDate);
          if (daysLeft <= 0) batchStatus = 'HetHan';
          else if (daysLeft <= warnDays) batchStatus = 'CanDate';
        }
        const batchCode = String(item.batch_code || '').trim() || `LO-${today.replace(/-/g, '')}-${id}-${product.sku}`;
        const createdBatch = this.repos.batches.create({
          batchCode,
          productId: product.id,
          mfgDate: item.mfg_date || '',
          expiryDate: expDate,
          initialQty: receivedQty,
          qtyRemaining: receivedQty,
          unitCost: importCost,
          purchaseId: po.id,
          status: batchStatus,
          createdAt: nowIso,
        });
        if (!item.batch_code) {
          this.db.prepare('UPDATE purchase_receipt_items SET batch_code = ? WHERE id = ?').run(createdBatch.batch_code, item.id);
        }

        this.repos.products.updateStock(product.id, newStock);
        this.repos.products.update(product.id, { cost_price: newCost });
        this.repos.stockMovements.append({
          productId: product.id,
          stockBefore: oldStock,
          delta: receivedQty,
          stockAfter: newStock,
          docType: 'NHAP_KHO',
          docId: id,
          batchCode: createdBatch.batch_code,
          actorId: actor.id,
          actorName: actor.full_name,
          note: `Duyệt GRN ${id} (PO ${po.id}) · Lô ${createdBatch.batch_code}${expDate ? ` (HSD ${expDate})` : ''} · Giá nhập ${importCost.toLocaleString('vi-VN')} ₫`,
        });
      }

      if (typeof options._beforeCommitHook === 'function') {
        options._beforeCommitHook();
      }

      const finalGrn = this.repos.supplierOps.updateGrnStatus(id, 'DaDuyet', {
        approved_by: actor.id,
        confirmed_at: nowIso,
      });

      // Tự động tạo công nợ phải trả NCC cho đợt giao hàng này
      if (Number(grn.total_received_amount) > 0) {
        this.repos.supplierOps.createPayable({
          supplierId: grn.supplier_id,
          purchaseId: grn.purchase_id,
          receiptId: id,
          totalAmount: Number(grn.total_received_amount),
          dueDate: addDaysYmd(today, 15),
          note: `Công nợ phát sinh từ GRN ${id} (PO ${grn.purchase_id})`,
        });
      }

      // Kiểm tra PO đã nhận đủ 100% hay mới nhận một phần
      const approvedReceivedMap = this.repos.purchases.getCumulativeReceivedMap(po.id, { approvedOnly: true });
      const fullyReceived = po.items.every(
        (pi) => (approvedReceivedMap.get(pi.product_id) || 0) >= Number(pi.qty),
      );
      this.repos.purchases.updateStatus(po.id, fullyReceived ? 'Confirmed' : 'DangNhanHang', {
        approved_by: actor.id,
        confirmed_at: fullyReceived ? nowIso : null,
      });

      this.repos.auditLogs.append({
        actor,
        action: 'GRN_CONFIRM',
        entityType: 'GoodsReceipt',
        entityId: id,
        detail: `Duyệt GRN ${id} (PO ${po.id} → ${fullyReceived ? 'Confirmed' : 'DangNhanHang'}), giá trị ${Number(grn.total_received_amount).toLocaleString('vi-VN')} ₫`,
      });

      return finalGrn;
    });
    return this._toGrnDto(confirmed);
  }

  // ─── SUPPLIER PAYABLES (CÔNG NỢ NCC — AP) ──────────────────────────────────

  _toPayableDto(row) {
    const today = todayYmdVn();
    const balance = Number(row.balance_amount) || 0;
    const isOverdue = balance > 0 && row.due_date && row.due_date < today;
    return {
      id: row.id,
      supplierId: row.supplier_id,
      supplierName: row.supplier_name,
      supplierPhone: row.supplier_phone || '',
      purchaseId: row.purchase_id,
      receiptId: row.receipt_id || null,
      totalAmount: Number(row.total_amount) || 0,
      paidAmount: Number(row.paid_amount) || 0,
      balanceAmount: balance,
      dueDate: row.due_date,
      isOverdue,
      status: row.status,
      statusLabel: PAYABLE_STATUS_LABELS[row.status] || row.status,
      note: row.note || '',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      payments: row.payments
        ? row.payments.map((p) => ({
            id: p.id,
            amount: Number(p.amount) || 0,
            paymentMethod: p.payment_method,
            paymentRef: p.payment_ref || '',
            actorName: p.actor_name,
            note: p.note || '',
            paidAt: p.paid_at,
          }))
        : undefined,
    };
  }

  listPayables(filters = {}) {
    const rows = this.repos.supplierOps.listPayables({
      supplierId: filters.supplierId || '',
      status: filters.status || '',
    });
    const items = rows.map((r) => this._toPayableDto(r));
    return {
      items,
      summary: {
        totalCount: items.length,
        totalAmount: items.reduce((s, i) => s + i.totalAmount, 0),
        totalPaid: items.reduce((s, i) => s + i.paidAmount, 0),
        totalBalance: items.reduce((s, i) => s + i.balanceAmount, 0),
        overdueCount: items.filter((i) => i.isOverdue).length,
      },
    };
  }

  getPayable(id) {
    const found = this.repos.supplierOps.findPayableById(id);
    if (!found) throw new NotFoundException(`Không tìm thấy phiếu công nợ NCC mã "${id}".`);
    return this._toPayableDto(found);
  }

  recordSupplierPayment(actor, payableId, input = {}) {
    const updated = withTransaction(this.db, () => {
      const pay = this.repos.supplierOps.findPayableById(payableId);
      if (!pay) throw new NotFoundException(`Không tìm thấy phiếu công nợ NCC mã "${payableId}".`);
      const balance = Number(pay.balance_amount) || 0;
      assertRule(balance > 0, `Công nợ "${payableId}" đã thanh toán đủ, không còn dư nợ.`, 400);

      const amount = parsePositiveInt(input?.amount, 'Số tiền thanh toán NCC');
      assertRule(
        amount <= balance,
        `Số tiền thanh toán (${amount.toLocaleString('vi-VN')} ₫) vượt quá dư nợ hiện tại (${balance.toLocaleString('vi-VN')} ₫).`,
        400,
      );
      const paymentMethod = String(input?.paymentMethod || 'BANK_TRANSFER').trim().toUpperCase();
      const paymentRef = String(input?.paymentRef || '').trim();
      const note = String(input?.note || '').trim();

      const afterPay = this.repos.supplierOps.recordPayment({
        payableId,
        amount,
        paymentMethod,
        paymentRef,
        createdBy: actor.id,
        note,
      });

      this.repos.auditLogs.append({
        actor,
        action: 'PAYABLE_PAYMENT',
        entityType: 'SupplierPayable',
        entityId: payableId,
        detail: `Thanh toán công nợ NCC ${payableId} (${pay.supplier_name}): ${amount.toLocaleString('vi-VN')} ₫, dư nợ còn ${Number(afterPay.balance_amount).toLocaleString('vi-VN')} ₫`,
        after: { amount, paymentMethod, paymentRef, balanceAfter: afterPay.balance_amount, status: afterPay.status },
      });
      return afterPay;
    });
    return this._toPayableDto(updated);
  }

  // ─── SUPPLIER RETURNS (TRẢ HÀNG NCC — TRA_NCC) ─────────────────────────────

  _toSupplierReturnDto(row) {
    return {
      id: row.id,
      supplierId: row.supplier_id,
      supplierName: row.supplier_name,
      purchaseId: row.purchase_id || null,
      createdBy: row.created_by,
      createdByName: row.created_by_name,
      approvedBy: row.approved_by || null,
      approvedByName: row.approved_by_name || null,
      totalAmount: Number(row.total_amount) || 0,
      reason: row.reason,
      status: row.status,
      statusLabel: SUPPLIER_RETURN_STATUS_LABELS[row.status] || row.status,
      createdAt: row.created_at,
      approvedAt: row.approved_at || null,
      items: row.items
        ? row.items.map((i) => ({
            id: i.id,
            productId: i.product_id,
            sku: i.sku,
            productName: i.product_name,
            unitName: i.unit_name,
            batchId: i.batch_id || null,
            batchCode: i.batch_code || '',
            qty: Number(i.qty) || 0,
            unitCost: Number(i.unit_cost) || 0,
            lineTotal: Number(i.line_total) || 0,
            reason: i.reason || '',
          }))
        : undefined,
    };
  }

  listSupplierReturns(filters = {}) {
    const rows = this.repos.supplierOps.listSupplierReturns({
      supplierId: filters.supplierId || '',
      status: filters.status || '',
    });
    return {
      items: rows.map((r) => this._toSupplierReturnDto(r)),
      summary: {
        total: rows.length,
        pendingCount: rows.filter((r) => r.status === 'ChoDuyet').length,
        approvedCount: rows.filter((r) => r.status === 'DaDuyet').length,
        totalApprovedAmount: rows
          .filter((r) => r.status === 'DaDuyet')
          .reduce((s, r) => s + (Number(r.total_amount) || 0), 0),
      },
    };
  }

  getSupplierReturn(id) {
    const found = this.repos.supplierOps.findSupplierReturnById(id);
    if (!found) throw new NotFoundException(`Không tìm thấy phiếu trả hàng NCC mã "${id}".`);
    return this._toSupplierReturnDto(found);
  }

  createSupplierReturn(actor, input = {}) {
    const supplierId = String(input?.supplierId || input?.supplier_id || '').trim();
    const purchaseId = String(input?.purchaseId || input?.purchase_id || '').trim() || null;
    const reason = String(input?.reason || '').trim();
    const rawItems = Array.isArray(input?.items) ? input.items : [];

    assertRule(supplierId.length > 0, 'Vui lòng chọn Nhà cung cấp cần trả hàng.', 400);
    const supplier = this.repos.suppliers.findById(supplierId);
    assertRule(Boolean(supplier), `Nhà cung cấp "${supplierId}" không tồn tại.`, 400);
    assertRule(reason.length >= 3 && reason.length <= 300, 'Vui lòng nhập lý do trả hàng NCC (tối thiểu 3 ký tự).', 400);
    assertRule(rawItems.length >= 1, 'Phiếu trả hàng NCC phải có tối thiểu 1 mặt hàng.', 400);

    const normalized = [];
    let totalAmount = 0;
    for (const raw of rawItems) {
      const batchId = String(raw?.batchId || raw?.batch_id || '').trim() || null;
      let productId = String(raw?.productId || raw?.product_id || '').trim();
      let batchCode = '';
      let defaultCost = 0;
      if (batchId) {
        const batch = this.repos.batches.findById(batchId);
        assertRule(Boolean(batch), `Không tìm thấy lô hàng "${batchId}".`, 400);
        productId = batch.product_id;
        batchCode = batch.batch_code;
        defaultCost = Number(batch.unit_cost) || 0;
        const qtyCheck = parsePositiveInt(raw?.qty, `SL trả lô ${batch.batch_code}`);
        assertRule(
          qtyCheck <= Number(batch.qty_remaining),
          `SL trả (${qtyCheck}) vượt quá tồn còn lại của lô "${batch.batch_code}" (${batch.qty_remaining}).`,
          400,
        );
      }
      const product = this.repos.products.findById(productId);
      assertRule(Boolean(product), `Sản phẩm "${productId}" không tồn tại.`, 400);
      const qty = parsePositiveInt(raw?.qty, `SL trả của ${product.name}`);
      if (!batchId) {
        assertRule(qty <= Number(product.stock_qty), `SL trả (${qty}) vượt tồn kho hiện tại (${product.stock_qty}) của ${product.name}.`, 400);
      }
      const unitCost = parseNonNegativeInt(
        raw?.unitCost !== undefined ? raw.unitCost : defaultCost || product.cost_price,
        `Đơn giá trả của ${product.name}`,
      );
      const lineTotal = qty * unitCost;
      totalAmount += lineTotal;
      normalized.push({
        product_id: product.id,
        batch_id: batchId,
        batch_code: batchCode,
        qty,
        unit_cost: unitCost,
        line_total: lineTotal,
        reason: String(raw?.reason || reason).trim(),
      });
    }

    const created = withTransaction(this.db, () => {
      const sr = this.repos.supplierOps.createSupplierReturn(
        {
          supplier_id: supplierId,
          purchase_id: purchaseId,
          created_by: actor.id,
          total_amount: totalAmount,
          reason,
        },
        normalized,
      );
      this.repos.auditLogs.append({
        actor,
        action: 'SUPPLIER_RETURN_CREATE',
        entityType: 'SupplierReturn',
        entityId: sr.id,
        detail: `Lập phiếu trả hàng NCC ${sr.id} (${supplier.name}, tổng ${totalAmount.toLocaleString('vi-VN')} ₫ — Chờ duyệt)`,
      });
      return sr;
    });
    return this._toSupplierReturnDto(created);
  }

  approveSupplierReturn(actor, id, options = {}) {
    const approved = withTransaction(this.db, () => {
      const sr = this.repos.supplierOps.findSupplierReturnById(id);
      if (!sr) throw new NotFoundException(`Không tìm thấy phiếu trả hàng NCC mã "${id}".`);
      if (sr.status !== 'ChoDuyet') {
        throw new ConflictException(`Phiếu trả hàng NCC "${id}" đang ở trạng thái ${sr.status}, không thể duyệt.`);
      }

      const today = todayYmdVn();
      for (const item of sr.items) {
        const product = this.repos.products.findById(item.product_id);
        assertRule(Boolean(product), `Sản phẩm "${item.product_id}" không tồn tại.`, 400);
        const qty = Number(item.qty);
        const stockBefore = Number(product.stock_qty) || 0;
        let usedBatchCode = item.batch_code || '';

        if (item.batch_id) {
          const batch = this.repos.batches.findById(item.batch_id);
          assertRule(Boolean(batch), `Lô hàng "${item.batch_code}" không tồn tại.`, 400);
          assertRule(Number(batch.qty_remaining) >= qty, `Lô "${batch.batch_code}" chỉ còn ${batch.qty_remaining}, không đủ trả ${qty}.`, 409);
          const afterBatch = Number(batch.qty_remaining) - qty;
          this.repos.batches.updateQtyAndStatus(batch.id, afterBatch, afterBatch === 0 ? 'DaHet' : batch.status);
          usedBatchCode = batch.batch_code;
          this.repos.batches.syncProductSalableStock(product.id, today);
        } else {
          assertRule(stockBefore >= qty, `Tồn kho "${product.name}" chỉ còn ${stockBefore}, không đủ trả ${qty}.`, 409);
          let remain = qty;
          const salable = this.repos.batches.findSalableFefo(product.id, today);
          for (const b of salable) {
            if (remain <= 0) break;
            const take = Math.min(remain, Number(b.qty_remaining) || 0);
            if (take > 0) {
              const afterB = Number(b.qty_remaining) - take;
              this.repos.batches.updateQtyAndStatus(b.id, afterB, afterB === 0 ? 'DaHet' : b.status);
              if (!usedBatchCode) usedBatchCode = b.batch_code;
              remain -= take;
            }
          }
          this.repos.products.updateStock(product.id, stockBefore - qty);
        }

        const stockAfter = Number(this.repos.products.findById(product.id)?.stock_qty) || 0;
        this.repos.stockMovements.append({
          productId: product.id,
          stockBefore,
          delta: -qty,
          stockAfter,
          docType: 'TRA_NCC',
          docId: id,
          batchCode: usedBatchCode,
          actorId: actor.id,
          actorName: actor.full_name,
          note: `Duyệt trả hàng NCC ${id} (${sr.supplier_name})${usedBatchCode ? ` · Lô ${usedBatchCode}` : ''}: ${item.reason || sr.reason}`,
        });
      }

      // Giảm trừ công nợ NCC nếu gắn với GRN/PO có công nợ (ưu tiên khớp đúng GRN của lô hàng trả)
      if (sr.purchase_id) {
        let matchedReceiptId = null;
        for (const it of sr.items) {
          if (it.batch_code) {
            const grnItem = this.db
              .prepare('SELECT receipt_id FROM purchase_receipt_items WHERE batch_code = ? LIMIT 1')
              .get(it.batch_code);
            if (grnItem?.receipt_id) {
              matchedReceiptId = grnItem.receipt_id;
              break;
            }
          }
        }
        const linkedPayable =
          (matchedReceiptId ? this.repos.supplierOps.findPayableByReceipt(matchedReceiptId) : null) ||
          this.repos.supplierOps.findPayableByPurchase(sr.purchase_id);
        if (linkedPayable) {
          this.repos.supplierOps.reducePayableForReturn(linkedPayable.id, Number(sr.total_amount) || 0);
        }
      }

      if (typeof options._beforeCommitHook === 'function') {
        options._beforeCommitHook();
      }

      const finalSr = this.repos.supplierOps.updateSupplierReturnStatus(id, 'DaDuyet', {
        approved_by: actor.id,
        approved_at: new Date().toISOString(),
      });

      this.repos.auditLogs.append({
        actor,
        action: 'SUPPLIER_RETURN_APPROVE',
        entityType: 'SupplierReturn',
        entityId: id,
        detail: `Duyệt trả hàng NCC ${id} (${sr.supplier_name}, giá trị ${Number(sr.total_amount).toLocaleString('vi-VN')} ₫)`,
      });
      return finalSr;
    });
    return this._toSupplierReturnDto(approved);
  }

  // ─── BATCHES, NEAR-EXPIRY & WRITE-OFFS (CHẶNG 2: FEFO & HỦY HÀNG) ─────────

  _getNearExpiryWarnDays() {
    const row = this.repos.thamSo?.findByCode?.('SoNgayCanhBaoCanDate');
    const val = row ? Number(row.gia_tri) : 14;
    return Number.isFinite(val) && val >= 1 ? Math.round(val) : 14;
  }

  _toBatchDto(row, warnDays = 14, today = todayYmdVn()) {
    const exp = String(row.expiry_date || '');
    const daysLeft = exp ? diffDaysYmd(today, exp) : null;
    const qtyRemaining = Number(row.qty_remaining) || 0;
    const unitCost = Number(row.unit_cost) || 0;
    let computedStatus = row.status || 'ConHan';
    if (computedStatus !== 'DaHuy') {
      if (qtyRemaining <= 0) computedStatus = 'DaHet';
      else if (daysLeft !== null && daysLeft <= 0) computedStatus = 'HetHan';
      else if (daysLeft !== null && daysLeft <= warnDays) computedStatus = 'CanDate';
      else computedStatus = 'ConHan';
    }
    return {
      id: row.id,
      batchCode: row.batch_code,
      productId: row.product_id,
      sku: row.sku,
      productName: row.product_name,
      imageUrl: row.image_url,
      thumbUrl: row.thumb_url || '',
      categoryCode: row.category_code,
      categoryName: row.category_name,
      unitName: row.unit_name,
      salePrice: Number(row.sale_price) || 0,
      mfgDate: row.mfg_date || '',
      expiryDate: exp,
      daysLeft,
      initialQty: Number(row.initial_qty) || 0,
      qtyRemaining,
      unitCost,
      atRiskCostValue: qtyRemaining * unitCost,
      purchaseId: row.purchase_id || null,
      status: computedStatus,
      statusLabel: BATCH_STATUS_LABELS[computedStatus] || computedStatus,
      isExpired: daysLeft !== null && daysLeft <= 0 && qtyRemaining > 0 && row.status !== 'DaHuy',
      isNearExpiry: daysLeft !== null && daysLeft > 0 && daysLeft <= warnDays && qtyRemaining > 0 && row.status !== 'DaHuy',
      createdAt: row.created_at,
    };
  }

  listBatches(filters = {}) {
    const warnDays = this._getNearExpiryWarnDays();
    const today = todayYmdVn();
    const rows = this.repos.batches.list({
      productId: filters.productId || '',
      categoryCode: filters.categoryCode || '',
      search: filters.search || '',
      status: filters.status || '',
      includeEmpty: filters.includeEmpty === true || filters.includeEmpty === 'true',
    });
    const items = rows.map((r) => this._toBatchDto(r, warnDays, today));
    return {
      items,
      total: items.length,
      warnDays,
    };
  }

  listNearExpiryBatches({ days = '', categoryCode = '', includeExpired = true } = {}) {
    const defaultWarn = this._getNearExpiryWarnDays();
    const maxDays =
      days !== '' && days !== undefined && days !== null
        ? Math.max(0, Math.min(365, Math.round(Number(days) || defaultWarn)))
        : defaultWarn;
    const includeExp = includeExpired !== false && includeExpired !== 'false' && includeExpired !== '0';
    const today = todayYmdVn();
    const rows = this.repos.batches.findNearExpiryAndExpired({
      maxDays,
      categoryCode: String(categoryCode || '').trim(),
      includeExpired: includeExp,
      refDate: today,
    });
    const items = rows.map((r) => this._toBatchDto(r, maxDays, today));
    const expiredItems = items.filter((b) => b.isExpired);
    const nearItems = items.filter((b) => !b.isExpired);
    return {
      items,
      summary: {
        warnDays: maxDays,
        totalBatches: items.length,
        expiredCount: expiredItems.length,
        expiredQty: expiredItems.reduce((s, b) => s + b.qtyRemaining, 0),
        expiredCostValue: expiredItems.reduce((s, b) => s + b.atRiskCostValue, 0),
        nearExpiryCount: nearItems.length,
        nearExpiryQty: nearItems.reduce((s, b) => s + b.qtyRemaining, 0),
        nearExpiryCostValue: nearItems.reduce((s, b) => s + b.atRiskCostValue, 0),
        totalQty: items.reduce((s, b) => s + b.qtyRemaining, 0),
        atRiskCostValue: items.reduce((s, b) => s + b.atRiskCostValue, 0),
      },
    };
  }

  _toWriteOffSummaryDto(row) {
    return {
      id: row.id,
      createdBy: row.created_by,
      createdByName: row.created_by_name,
      approvedBy: row.approved_by || null,
      approvedByName: row.approved_by_name || null,
      reason: row.reason,
      itemCount: Number(row.item_count) || 0,
      totalQty: Number(row.total_qty) || 0,
      totalValue: Number(row.total_value) || 0,
      status: row.status,
      statusLabel: WRITEOFF_STATUS_LABELS[row.status] || row.status,
      createdAt: row.created_at,
      approvedAt: row.approved_at || null,
    };
  }

  _toWriteOffDetailDto(row) {
    const items = (row.items || []).map((i) => ({
      id: i.id,
      batchId: i.batch_id,
      productId: i.product_id,
      sku: i.sku,
      productName: i.product_name,
      unitName: i.unit_name,
      imageUrl: i.image_url,
      batchCode: i.batch_code,
      expiryDate: i.expiry_date || '',
      qty: Number(i.qty) || 0,
      unitCost: Number(i.unit_cost) || 0,
      lineValue: Number(i.line_value) || 0,
      reason: i.reason || '',
    }));
    return {
      ...this._toWriteOffSummaryDto({ ...row, item_count: items.length }),
      items,
    };
  }

  listWriteOffs(filters = {}) {
    const fromDate = String(filters.fromDate || '').trim();
    const toDate = String(filters.toDate || '').trim();
    validateDateRange(fromDate, toDate);
    const rows = this.repos.writeoffs.list({
      status: filters.status || '',
      search: filters.search || '',
      fromDate,
      toDate,
    });
    const allRows = this.repos.writeoffs.list({});
    return {
      items: rows.map((r) => this._toWriteOffSummaryDto(r)),
      summary: {
        total: allRows.length,
        pendingCount: allRows.filter((r) => r.status === 'ChoDuyet').length,
        approvedCount: allRows.filter((r) => r.status === 'DaDuyet').length,
        cancelledCount: allRows.filter((r) => r.status === 'DaHuy').length,
        totalApprovedLoss: allRows
          .filter((r) => r.status === 'DaDuyet')
          .reduce((s, r) => s + (Number(r.total_value) || 0), 0),
      },
    };
  }

  getWriteOff(id) {
    const found = this.repos.writeoffs.findById(id);
    if (!found) throw new NotFoundException(`Không tìm thấy phiếu hủy hàng mã "${id}".`);
    return this._toWriteOffDetailDto(found);
  }

  createWriteOff(actor, input) {
    const reason = String(input?.reason || '').trim();
    const rawItems = input?.items;
    assertRule(reason.length >= 3 && reason.length <= 300, 'Bắt buộc nhập lý do xuất hủy hàng (tối thiểu 3 ký tự).', 400);
    assertRule(Array.isArray(rawItems) && rawItems.length >= 1, 'Phiếu hủy hàng phải có tối thiểu 1 lô hàng.', 400);

    const seen = new Set();
    const normalized = [];
    let totalQty = 0;
    let totalValue = 0;

    for (const raw of rawItems) {
      const batchId = String(raw?.batchId || raw?.batch_id || '').trim();
      assertRule(batchId.length > 0, 'Thiếu mã lô hàng cần xuất hủy.', 400);
      assertRule(!seen.has(batchId), `Lô hàng "${batchId}" bị trùng lặp trong cùng phiếu hủy.`, 400);
      seen.add(batchId);

      const batch = this.repos.batches.findById(batchId);
      assertRule(Boolean(batch), `Không tìm thấy lô hàng "${batchId}".`, 400);
      assertRule(batch.status !== 'DaHuy', `Lô hàng "${batch.batch_code}" đã bị xuất hủy trước đó.`, 400);

      const qty = parsePositiveInt(raw?.qty, `Số lượng hủy của lô ${batch.batch_code}`);
      assertRule(
        qty <= Number(batch.qty_remaining),
        `Số lượng hủy (${qty}) của lô "${batch.batch_code}" vượt quá số lượng còn lại (${batch.qty_remaining}).`,
        400,
      );

      const unitCost = Math.max(0, Number(batch.unit_cost) || 0);
      const lineValue = qty * unitCost;
      totalQty += qty;
      totalValue += lineValue;
      normalized.push({
        batch_id: batch.id,
        product_id: batch.product_id,
        batch_code: batch.batch_code,
        expiry_date: batch.expiry_date || '',
        qty,
        unit_cost: unitCost,
        line_value: lineValue,
        reason: String(raw?.reason || reason).trim(),
      });
    }

    const created = withTransaction(this.db, () => {
      const wo = this.repos.writeoffs.create(
        {
          created_by: actor.id,
          reason,
          total_qty: totalQty,
          total_value: totalValue,
        },
        normalized,
      );
      this.repos.auditLogs.append({
        actor,
        action: 'WRITEOFF_CREATE',
        entityType: 'BatchWriteOff',
        entityId: wo.id,
        detail: `Lập phiếu hủy hàng ${wo.id} (${normalized.length} lô, ${totalQty} đv, giá trị vốn ${totalValue.toLocaleString('vi-VN')} ₫ — Chờ duyệt)`,
        after: { id: wo.id, totalQty, totalValue, reason },
      });
      return wo;
    });

    return this._toWriteOffDetailDto(created);
  }

  approveWriteOff(actor, id, options = {}) {
    const approved = withTransaction(this.db, () => {
      const existing = this.repos.writeoffs.findById(id);
      if (!existing) throw new NotFoundException(`Không tìm thấy phiếu hủy hàng mã "${id}".`);
      if (existing.status !== 'ChoDuyet') {
        throw new ConflictException(`Chỉ được duyệt phiếu hủy hàng ở trạng thái Chờ duyệt. Phiếu "${id}" hiện là ${existing.status}.`);
      }

      const today = todayYmdVn();
      const changes = [];
      for (const item of existing.items) {
        const batch = this.repos.batches.findById(item.batch_id);
        assertRule(Boolean(batch), `Lô hàng "${item.batch_code}" không tồn tại.`, 400);
        const batchBefore = Number(batch.qty_remaining) || 0;
        assertRule(
          batchBefore >= Number(item.qty),
          `Lô "${batch.batch_code}" chỉ còn ${batchBefore}, không đủ để xuất hủy ${item.qty}.`,
          409,
        );

        const isBatchExpired = batch.expiry_date !== '' && batch.expiry_date <= today;
        const productBefore = Number(this.repos.products.findById(item.product_id)?.stock_qty) || 0;
        const batchAfter = batchBefore - Number(item.qty);
        const nextBatchStatus = batchAfter === 0 ? 'DaHuy' : batch.status;

        this.repos.batches.updateQtyAndStatus(batch.id, batchAfter, nextBatchStatus);
        const productAfter = this.repos.batches.syncProductSalableStock(item.product_id, today);

        this.repos.stockMovements.append({
          productId: item.product_id,
          stockBefore: isBatchExpired ? batchBefore : productBefore,
          delta: -Number(item.qty),
          stockAfter: isBatchExpired ? batchAfter : productAfter,
          docType: 'HUY_HANG',
          docId: id,
          batchCode: batch.batch_code,
          actorId: actor.id,
          actorName: actor.full_name,
          note: `Duyệt hủy hàng ${id} · Lô ${batch.batch_code}${batch.expiry_date ? ` (HSD ${batch.expiry_date})` : ''}${isBatchExpired ? ' [Lô hết hạn]' : ''}: ${item.reason || existing.reason}`,
        });

        changes.push({
          batchId: batch.id,
          batchCode: batch.batch_code,
          productId: item.product_id,
          qty: Number(item.qty),
          lineValue: Number(item.line_value) || 0,
        });
      }

      if (typeof options._beforeCommitHook === 'function') {
        options._beforeCommitHook();
      }

      const finalWo = this.repos.writeoffs.updateStatus(id, 'DaDuyet', {
        approved_by: actor.id,
        approved_at: new Date().toISOString(),
      });

      this.repos.auditLogs.append({
        actor,
        action: 'WRITEOFF_APPROVE',
        entityType: 'BatchWriteOff',
        entityId: id,
        detail: `Duyệt xuất hủy hàng ${id}: ${existing.total_qty} đv, hao hụt vốn ${Number(existing.total_value).toLocaleString('vi-VN')} ₫`,
        before: { status: 'ChoDuyet' },
        after: { status: 'DaDuyet', totalQty: existing.total_qty, totalValue: existing.total_value, changes },
      });

      return finalWo;
    });

    return this._toWriteOffDetailDto(approved);
  }

  cancelWriteOff(actor, id, reason = '') {
    const cancelled = withTransaction(this.db, () => {
      const existing = this.repos.writeoffs.findById(id);
      if (!existing) throw new NotFoundException(`Không tìm thấy phiếu hủy hàng mã "${id}".`);
      if (existing.status !== 'ChoDuyet') {
        throw new ConflictException(`Phiếu hủy hàng "${id}" không ở trạng thái Chờ duyệt, không thể hủy.`);
      }
      const updated = this.repos.writeoffs.updateStatus(id, 'DaHuy', {
        approved_by: actor.id,
        approved_at: new Date().toISOString(),
      });
      this.repos.auditLogs.append({
        actor,
        action: 'WRITEOFF_CANCEL',
        entityType: 'BatchWriteOff',
        entityId: id,
        detail: `Hủy phiếu xuất hủy ${id}${reason ? ` (${reason})` : ''}`,
        before: { status: 'ChoDuyet' },
        after: { status: 'DaHuy', reason },
      });
      return updated;
    });
    return this._toWriteOffDetailDto(cancelled);
  }
}

module.exports = {
  WarehouseService,
  computeWeightedAverageCost,
  PURCHASE_STATUS_LABELS,
  AUDIT_STATUS_LABELS,
  AUDIT_REASON_CODES,
  GRN_STATUS_LABELS,
  PAYABLE_STATUS_LABELS,
  SUPPLIER_RETURN_STATUS_LABELS,
  WRITEOFF_STATUS_LABELS,
  BATCH_STATUS_LABELS,
};
