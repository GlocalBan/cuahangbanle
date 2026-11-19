'use strict';
const { withTransaction } = require('../dal/database.js');
const { ConflictException, NotFoundException, assertRule } = require('./errors.js');

const PURCHASE_STATUS_LABELS = {
  Draft: 'Phiếu nháp (Chờ duyệt)',
  Confirmed: 'Đã nhập kho',
  Cancelled: 'Đã hủy',
};

const AUDIT_STATUS_LABELS = {
  ChoDuyet: 'Chờ duyệt kiểm kê',
  DaDuyet: 'Đã duyệt điều chỉnh',
  DaHuy: 'Đã hủy',
};

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
    itemCount: Number(row.item_count) || 0,
    totalQty: Number(row.total_qty) || 0,
    note: row.note || '',
    status: row.status,
    statusLabel: PURCHASE_STATUS_LABELS[row.status] || row.status,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at || null,
  };
}

function toPurchaseDetailDto(row) {
  const items = (row.items || []).map((i) => ({
    id: i.id,
    productId: i.product_id,
    sku: i.sku,
    productName: i.product_name,
    unitName: i.unit_name,
    imageUrl: i.image_url,
    qty: Number(i.qty) || 0,
    unitCost: Number(i.unit_cost) || 0,
    lineTotal: (Number(i.qty) || 0) * (Number(i.unit_cost) || 0),
    currentStockQty: Number(i.current_stock_qty) || 0,
    currentCostPrice: Number(i.current_cost_price) || 0,
    productStatus: i.product_status,
  }));
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
    itemCount: items.length,
    totalQty: items.reduce((s, i) => s + i.qty, 0),
    note: row.note || '',
    status: row.status,
    statusLabel: PURCHASE_STATUS_LABELS[row.status] || row.status,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at || null,
    items,
  };
}

function toAuditSummaryDto(row) {
  return {
    id: row.id,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    approvedBy: row.approved_by || null,
    approvedByName: row.approved_by_name || null,
    note: row.note || '',
    status: row.status,
    statusLabel: AUDIT_STATUS_LABELS[row.status] || row.status,
    itemCount: Number(row.item_count) || 0,
    diffItemCount: Number(row.diff_item_count) || 0,
    totalDiffQty: Number(row.total_diff_qty) || 0,
    totalAbsDiffValue: Number(row.total_abs_diff_value) || 0,
    createdAt: row.created_at,
    approvedAt: row.approved_at || null,
  };
}

function toAuditDetailDto(row) {
  const items = (row.items || []).map((i) => ({
    id: i.id,
    productId: i.product_id,
    sku: i.sku,
    productName: i.product_name,
    unitName: i.unit_name,
    imageUrl: i.image_url,
    systemQty: Number(i.system_qty) || 0,
    actualQty: Number(i.actual_qty) || 0,
    diffQty: Number(i.diff_qty) || 0,
    liveStockQty: Number(i.live_stock_qty) || 0,
    costPrice: Number(i.cost_price) || 0,
    diffValue: Math.abs(Number(i.diff_qty) || 0) * (Number(i.cost_price) || 0),
    reason: i.reason || '',
  }));
  return {
    id: row.id,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    approvedBy: row.approved_by || null,
    approvedByName: row.approved_by_name || null,
    note: row.note || '',
    status: row.status,
    statusLabel: AUDIT_STATUS_LABELS[row.status] || row.status,
    itemCount: items.length,
    diffItemCount: items.filter((i) => i.diffQty !== 0).length,
    totalDiffQty: items.reduce((s, i) => s + i.diffQty, 0),
    totalAbsDiffValue: items.reduce((s, i) => s + i.diffValue, 0),
    createdAt: row.created_at,
    approvedAt: row.approved_at || null,
    items,
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

  getPurchase(id) {
    const found = this.repos.purchases.findById(id);
    if (!found) throw new NotFoundException(`Không tìm thấy phiếu nhập mã "${id}".`);
    return toPurchaseDetailDto(found);
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

      totalAmount += qty * unitCost;
      normalizedItems.push({
        product_id: productId,
        qty,
        unit_cost: unitCost,
        productName: product.name,
        sku: product.sku,
      });
    }

    return { supplier, normalizedItems, totalAmount };
  }

  createPurchase(actor, input) {
    const note = String(input?.note || '').trim();
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

    return toPurchaseDetailDto(created);
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

        this.repos.products.updateStock(product.id, newStock);
        this.repos.products.update(product.id, { cost_price: newCost });

        this.repos.stockMovements.append({
          productId: product.id,
          stockBefore: oldStock,
          delta: importQty,
          stockAfter: newStock,
          docType: 'NHAP_KHO',
          docId: id,
          actorId: actor.id,
          actorName: actor.full_name,
          note: `Duyệt phiếu nhập ${id} từ ${supplier.name} · Đơn giá nhập ${importCost.toLocaleString('vi-VN')} ₫ (Giá vốn BQ: ${oldCost.toLocaleString('vi-VN')} → ${newCost.toLocaleString('vi-VN')} ₫)`,
        });

        movementChanges.push({
          productId: product.id,
          sku: product.sku,
          qty: importQty,
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

    return toPurchaseDetailDto(confirmed);
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
        detail: `Hủy phiếu nhập nháp ${id}${cleanReason ? ` (Lý do: ${cleanReason})` : ''}`,
        before: { status: 'Draft' },
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

  // ─── STOCK AUDITS (BR-06 & BR-07 & BR-08) ──────────────────────────────────

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
      summary: {
        total: allRows.length,
        pendingCount: allRows.filter((r) => r.status === 'ChoDuyet').length,
        approvedCount: allRows.filter((r) => r.status === 'DaDuyet').length,
        cancelledCount: allRows.filter((r) => r.status === 'DaHuy').length,
      },
    };
  }

  getStockAudit(id) {
    const found = this.repos.stockAudits.findById(id);
    if (!found) throw new NotFoundException(`Không tìm thấy phiếu kiểm kê mã "${id}".`);
    return toAuditDetailDto(found);
  }

  /**
   * BR-06: Lập phiếu kiểm kê (ChoDuyet).
   * Tính ChenhLech = TonThucTe - TonHeThong; BẮT BUỘC nhập LyDoChenhLech khi ChenhLech != 0.
   * Chưa điều chỉnh tồn kho cho đến khi Quản lý/Admin duyệt (approveStockAudit).
   */
  createStockAudit(actor, input) {
    const rawItems = input?.items;
    const note = String(input?.note || '').trim();
    assertRule(
      Array.isArray(rawItems) && rawItems.length >= 1,
      'Phiếu kiểm kê phải có tối thiểu 1 sản phẩm cần kiểm đếm.',
      400,
    );

    const seen = new Set();
    const normalizedItems = [];

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
      const reason = String(raw?.reason || '').trim();

      if (diffQty !== 0) {
        assertRule(
          reason.length >= 3,
          `Sản phẩm "${product.name}" có chênh lệch ${diffQty > 0 ? `+${diffQty}` : diffQty}: bắt buộc nhập Lý do chênh lệch tối thiểu 3 ký tự (BR-06).`,
          400,
        );
      }

      normalizedItems.push({
        product_id: productId,
        system_qty: systemQty,
        actual_qty: actualQty,
        diff_qty: diffQty,
        reason,
      });
    }

    const created = withTransaction(this.db, () => {
      const audit = this.repos.stockAudits.create(
        {
          created_by: actor.id,
          note: note || 'Kiểm kê kho định kỳ',
        },
        normalizedItems,
      );

      const diffCount = normalizedItems.filter((i) => i.diff_qty !== 0).length;
      this.repos.auditLogs.append({
        actor,
        action: 'AUDIT_CREATE',
        entityType: 'StockAudit',
        entityId: audit.id,
        detail: `Lập phiếu kiểm kê ${audit.id} (${normalizedItems.length} SKU, ${diffCount} SKU có chênh lệch — trạng thái Chờ duyệt)`,
        after: {
          id: audit.id,
          status: audit.status,
          itemCount: normalizedItems.length,
          diffCount,
        },
      });
      return audit;
    });

    return toAuditDetailDto(created);
  }

  /**
   * BR-06 & BR-07: Duyệt phiếu kiểm kê (ChoDuyet -> DaDuyet) trong 1 Transaction nguyên tử:
   * Cập nhật TonHienTai theo TonThucTe + ghi Thẻ kho (KIEM_KE) cho mọi dòng biến động + ghi AuditLog.
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

      const adjustments = [];
      for (const item of existing.items) {
        const product = this.repos.products.findById(item.product_id);
        assertRule(Boolean(product), `Sản phẩm "${item.product_id}" không tồn tại.`, 400);

        const currentStock = Number(product.stock_qty) || 0;
        const targetStock = Number(item.actual_qty);
        assertRule(targetStock >= 0, `Tồn thực tế của "${product.name}" không được âm.`, 400);
        const delta = targetStock - currentStock;

        if (delta !== 0) {
          this.repos.products.updateStock(product.id, targetStock);
          this.repos.stockMovements.append({
            productId: product.id,
            stockBefore: currentStock,
            delta,
            stockAfter: targetStock,
            docType: 'KIEM_KE',
            docId: id,
            actorId: actor.id,
            actorName: actor.full_name,
            note: `Duyệt kiểm kê ${id}: ${item.reason || existing.note || 'Điều chỉnh theo tồn thực tế'}`,
          });
          adjustments.push({
            productId: product.id,
            sku: product.sku,
            stockBefore: currentStock,
            delta,
            stockAfter: targetStock,
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
        detail: `Duyệt phiếu kiểm kê ${id}: điều chỉnh tồn kho cho ${adjustments.length}/${existing.items.length} SKU`,
        before: { status: 'ChoDuyet' },
        after: { status: 'DaDuyet', adjustments },
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
        before: { status: 'ChoDuyet' },
        after: { status: 'DaHuy', reason: cleanReason },
      });

      return updated;
    });

    return toAuditDetailDto(cancelled);
  }
}

module.exports = {
  WarehouseService,
  computeWeightedAverageCost,
  PURCHASE_STATUS_LABELS,
  AUDIT_STATUS_LABELS,
};
