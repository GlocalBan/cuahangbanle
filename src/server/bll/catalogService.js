'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { withTransaction } = require('../dal/database.js');
const {
  NghiepVuException,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  assertRule,
} = require('./errors.js');

const PRODUCT_IMAGES_DIR = path.resolve(__dirname, '../../../assets/images/products');
const DOC_TYPE_LABELS = {
  KHOI_TAO_TON: 'Khởi tạo tồn đầu kỳ',
  DIEU_CHINH_TON: 'Điều chỉnh tồn kho',
  NHAP_KHO: 'Nhập hàng vào kho',
  BAN_HANG: 'Xuất bán hàng (POS)',
  TRA_HANG: 'Nhập lại hàng trả',
  KIEM_KE: 'Điều chỉnh kiểm kê',
  HUY_HANG: 'Hủy hàng hết hạn / hư hỏng',
  TRA_NCC: 'Xuất trả hàng nhà cung cấp',
};

function parseNonNegativeInt(value, label) {
  const n = Number(value);
  assertRule(
    value !== '' && value !== null && value !== undefined && Number.isSafeInteger(n) && n >= 0,
    `${label} phải là số nguyên lớn hơn hoặc bằng 0 (BR-01).`,
    400,
    'INVALID_NUMBER',
  );
  return n;
}

function todayYmdVn() {
  return new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
}

function isValidIsoYmd(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '').trim());
}

function getAvailableProductImages() {
  try {
    return fs
      .readdirSync(PRODUCT_IMAGES_DIR)
      .filter((f) => /\.(jpe?g|png|webp)$/i.test(f) && f.toLowerCase() !== 'default.jpg')
      .sort((a, b) => a.localeCompare(b))
      .map((filename) => ({
        filename,
        path: `assets/images/products/${filename}`,
        label: filename.replace(/\.[^.]+$/, '').replace(/_/g, ' '),
      }));
  } catch {
    return [];
  }
}

function validateProductImageUrl(rawUrl) {
  const images = getAvailableProductImages();
  const fallback = images[0]?.path || 'assets/images/products/milk_vinamilk.jpg';
  const cleaned = String(rawUrl || '').trim();
  if (!cleaned) return fallback;
  assertRule(
    cleaned !== 'assets/images/products/default.jpg',
    'Vui lòng chọn ảnh sản phẩm thực tế trong thư mục assets/images/products/ (không dùng ảnh placeholder mặc định).',
    400,
    'INVALID_IMAGE_URL',
  );
  if (cleaned.startsWith('assets/images/products/')) {
    const baseName = path.basename(cleaned);
    const exists = images.some((i) => i.filename === baseName);
    assertRule(
      exists,
      `Tệp ảnh "${cleaned}" không tồn tại trong thư mục assets/images/products/.`,
      400,
      'IMAGE_NOT_FOUND',
    );
    return `assets/images/products/${baseName}`;
  }
  assertRule(
    /^https?:\/\/.+/i.test(cleaned),
    'Đường dẫn ảnh sản phẩm phải thuộc assets/images/products/ hoặc URL http(s) hợp lệ.',
    400,
    'INVALID_IMAGE_URL',
  );
  return cleaned;
}

function toProductDto(row, { canViewCost = false } = {}) {
  if (!row) return null;
  const dto = {
    id: row.id,
    sku: row.sku,
    barcode: row.barcode,
    name: row.name,
    brand: row.brand || '',
    packSize: row.pack_size || '',
    categoryCode: row.category_code,
    categoryName: row.category_name,
    unitCode: row.unit_code,
    unitName: row.unit_name,
    supplierId: row.supplier_id,
    supplierName: row.supplier_name,
    salePrice: row.sale_price,
    stockQty: row.stock_qty,
    minStock: row.min_stock,
    isLowStock: row.status === 'DangKinhDoanh' && row.stock_qty <= row.min_stock,
    isOutOfStock: row.status === 'DangKinhDoanh' && row.stock_qty === 0,
    imageUrl: row.image_url,
    thumbUrl:
      row.thumb_url ||
      (String(row.image_url || '').startsWith('assets/images/products/')
        ? String(row.image_url).replace(/^assets\/images\/products\//, 'assets/images/products/thumbs/')
        : row.image_url),
    hasExpiry: row.has_expiry === undefined ? true : Boolean(row.has_expiry),
    expiryWarnDays: Number(row.expiry_warn_days ?? 14),
    nonReturnable: Boolean(row.non_returnable),
    caseUnitName: row.case_unit_name || 'Thùng',
    unitsPerCase: Number(row.units_per_case ?? 12),
    damagedStockQty: Number(row.damaged_stock_qty ?? 0),
    earliestExpiryDate: row.earliest_expiry_date || '',
    status: row.status,
    active: row.status === 'DangKinhDoanh',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  // Strict RBAC field protection: never leak costPrice to roles without PRODUCT_COST_VIEW (e.g. ThuNgan)
  if (canViewCost) {
    dto.costPrice = row.cost_price;
    dto.inventoryValue = row.stock_qty * row.cost_price;
  }
  return dto;
}

function toCategoryDto(row) {
  if (!row) return null;
  return {
    code: row.code,
    name: row.name,
    description: row.description || '',
    status: row.status,
    active: row.status === 'HoatDong',
    productCount: Number(row.product_count || 0),
    createdAt: row.created_at,
  };
}

function toUnitDto(row) {
  if (!row) return null;
  return {
    code: row.code,
    name: row.name,
    status: row.status,
    active: row.status === 'HoatDong',
    productCount: Number(row.product_count || 0),
    createdAt: row.created_at,
  };
}

function toSupplierDto(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    phone: row.phone || '',
    categoryGroup: row.category_group || '',
    areas: row.areas || '',
    status: row.status,
    active: row.status === 'HoatDong',
    productCount: Number(row.product_count || 0),
    purchaseCount: Number(row.purchase_count || 0),
    createdAt: row.created_at,
  };
}

function toMovementDto(row) {
  if (!row) return null;
  return {
    id: row.id,
    productId: row.product_id,
    sku: row.sku,
    productName: row.product_name,
    imageUrl: row.image_url,
    unitName: row.unit_name,
    stockBefore: row.stock_before,
    delta: row.delta,
    stockAfter: row.stock_after,
    docType: row.doc_type,
    docTypeLabel: DOC_TYPE_LABELS[row.doc_type] || row.doc_type,
    docId: row.doc_id,
    batchCode: row.batch_code || '',
    actorId: row.actor_id,
    actorName: row.actor_name,
    note: row.note || '',
    createdAt: row.created_at,
  };
}

class CatalogService {
  constructor(db, repos) {
    this.db = db;
    this.repos = repos;
  }

  getDefaultMinStock() {
    const row = this.repos.thamSo.findByCode('TonToiThieuMacDinh');
    const parsed = Number(row?.gia_tri);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 15;
  }

  listProductImages() {
    return getAvailableProductImages();
  }

  // ─── PRODUCTS (BR-01, BR-06) ──────────────────────────────────────────────

  listProducts(filters = {}, { canViewCost = false } = {}) {
    if (
      filters.minPrice !== undefined &&
      filters.minPrice !== '' &&
      filters.maxPrice !== undefined &&
      filters.maxPrice !== ''
    ) {
      const minP = Number(filters.minPrice);
      const maxP = Number(filters.maxPrice);
      assertRule(
        !Number.isNaN(minP) && !Number.isNaN(maxP) && minP >= 0 && maxP >= 0,
        'Khoảng giá lọc phải là số không âm.',
        400,
        'INVALID_PRICE_FILTER',
      );
      assertRule(
        minP <= maxP,
        'Khoảng giá không hợp lệ: "Giá từ" phải nhỏ hơn hoặc bằng "Giá đến".',
        400,
        'INVALID_PRICE_RANGE',
      );
    }

    if (this.repos.batches && typeof this.repos.batches.sweepExpiredBatches === 'function') {
      this.repos.batches.sweepExpiredBatches(todayYmdVn());
    }

    const rows = this.repos.products.list(filters);
    const rawSummary = this.repos.products.getSummary();
    const summary = {
      total: Number(rawSummary.total || 0),
      activeCount: Number(rawSummary.active_count || 0),
      inactiveCount: Number(rawSummary.inactive_count || 0),
      lowStockCount: Number(rawSummary.low_stock_count || 0),
      outOfStockCount: Number(rawSummary.out_of_stock_count || 0),
      totalStockQty: Number(rawSummary.total_stock_qty || 0),
    };
    if (canViewCost) {
      summary.totalInventoryValue = Number(rawSummary.total_inventory_value || 0);
    }

    return {
      items: rows.map((r) => toProductDto(r, { canViewCost })),
      summary,
      filteredCount: rows.length,
    };
  }

  getProduct(id, { canViewCost = false, canViewLedger = false } = {}) {
    if (this.repos.batches && typeof this.repos.batches.sweepExpiredBatches === 'function') {
      this.repos.batches.sweepExpiredBatches(todayYmdVn(), id);
    }
    const row = this.repos.products.findById(id);
    if (!row) throw new NotFoundException(`Không tìm thấy sản phẩm mã "${id}".`);
    const result = {
      item: toProductDto(row, { canViewCost }),
    };
    if (canViewLedger) {
      const ledger = this.repos.stockMovements.query({ productId: id, page: 1, limit: 20 });
      result.recentMovements = ledger.items.map(toMovementDto);
    }
    return result;
  }

  createProduct(actor, input) {
    const name = String(input?.name || '').trim();
    const rawSku = String(input?.sku || '').trim().toUpperCase();
    const barcode = String(input?.barcode || '').trim();
    const brand = String(input?.brand || '').trim();
    const packSize = String(input?.packSize || '').trim();
    const categoryCode = String(input?.categoryCode || '').trim();
    const unitCode = String(input?.unitCode || '').trim();
    const supplierId = String(input?.supplierId || '').trim();

    assertRule(name.length >= 2 && name.length <= 180, 'Tên sản phẩm phải từ 2 đến 180 ký tự.', 400);
    assertRule(
      !rawSku || /^[A-Z0-9._-]{2,32}$/.test(rawSku),
      'Mã SKU chỉ gồm chữ hoa, số và dấu (., _, -), dài 2–32 ký tự.',
      400,
    );
    assertRule(barcode.length >= 4 && barcode.length <= 64, 'Mã vạch (Barcode) phải từ 4 đến 64 ký tự.', 400);

    const salePrice = parseNonNegativeInt(input?.salePrice, 'Giá bán');
    const costPrice = parseNonNegativeInt(input?.costPrice, 'Giá vốn');
    const stockQty =
      input?.stockQty !== undefined && input?.stockQty !== ''
        ? parseNonNegativeInt(input.stockQty, 'Tồn đầu kỳ')
        : 0;
    const minStock =
      input?.minStock !== undefined && input?.minStock !== ''
        ? parseNonNegativeInt(input.minStock, 'Tồn tối thiểu')
        : this.getDefaultMinStock();
    const imageUrl = validateProductImageUrl(input?.imageUrl);
    const status = input?.status === 'NgungKinhDoanh' ? 'NgungKinhDoanh' : 'DangKinhDoanh';

    const category = this.repos.categories.findByCode(categoryCode);
    assertRule(Boolean(category), 'Danh mục hàng hóa không tồn tại.', 400);
    assertRule(category.status === 'HoatDong', 'Danh mục hàng hóa đang ngừng sử dụng.', 400);

    const unit = this.repos.units.findByCode(unitCode);
    assertRule(Boolean(unit), 'Đơn vị tính không tồn tại.', 400);
    assertRule(unit.status === 'HoatDong', 'Đơn vị tính đang ngừng sử dụng.', 400);

    const supplier = this.repos.suppliers.findById(supplierId);
    assertRule(Boolean(supplier), 'Nhà cung cấp không tồn tại.', 400);
    assertRule(supplier.status === 'HoatDong', 'Nhà cung cấp đã ngừng hợp tác.', 400);

    const finalId = this.repos.products.nextId();
    const finalSku = rawSku || finalId;

    if (this.repos.products.findBySku(finalSku)) {
      throw new ConflictException(`Mã SKU "${finalSku}" đã tồn tại trong hệ thống (BR-01).`);
    }
    if (this.repos.products.findByBarcode(barcode)) {
      throw new ConflictException(`Mã vạch "${barcode}" đã thuộc về sản phẩm khác (BR-01).`);
    }

    const hasExpiry =
      input?.hasExpiry === false ||
      input?.hasExpiry === 0 ||
      input?.hasExpiry === '0' ||
      input?.has_expiry === false ||
      input?.has_expiry === 0 ||
      input?.has_expiry === '0'
        ? 0
        : 1;

    const created = withTransaction(this.db, () => {
      const prod = this.repos.products.create({
        id: finalId,
        sku: finalSku,
        barcode,
        name,
        brand,
        pack_size: packSize,
        category_code: categoryCode,
        unit_code: unitCode,
        supplier_id: supplierId,
        sale_price: salePrice,
        cost_price: costPrice,
        stock_qty: stockQty,
        min_stock: minStock,
        image_url: imageUrl,
        has_expiry: hasExpiry,
        status,
      });

      if (stockQty > 0) {
        let initialBatchCode = '';
        if (this.repos.batches) {
          const today = todayYmdVn();
          const defaultExp = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);
          const batchExpiry = hasExpiry === 1 ? String(input?.expiryDate || defaultExp).trim() : '';
          const batch = this.repos.batches.create({
            batchCode: `LO-DK-${prod.sku}`,
            productId: prod.id,
            mfgDate: today,
            expiryDate: batchExpiry,
            initialQty: stockQty,
            qtyRemaining: stockQty,
            unitCost: costPrice,
            status: 'ConHan',
          });
          initialBatchCode = batch.batch_code;
        }
        this.repos.stockMovements.append({
          productId: prod.id,
          stockBefore: 0,
          delta: stockQty,
          stockAfter: stockQty,
          docType: 'KHOI_TAO_TON',
          docId: `INIT-${prod.sku}`,
          batchCode: initialBatchCode,
          actorId: actor.id,
          actorName: actor.full_name,
          note: `Khởi tạo tồn kho ban đầu khi tạo sản phẩm ${prod.name}`,
        });
      }

      this.repos.auditLogs.append({
        actor,
        action: 'PRODUCT_CREATE',
        entityType: 'Product',
        entityId: prod.id,
        detail: `Thêm sản phẩm ${prod.sku} — ${prod.name} (Giá bán ${salePrice.toLocaleString('vi-VN')} ₫, Tồn đầu ${stockQty})`,
        after: { id: prod.id, sku: prod.sku, barcode: prod.barcode, salePrice, costPrice, stockQty },
      });

      return prod;
    });

    return toProductDto(created, { canViewCost: true });
  }

  updateProduct(actor, id, input) {
    const existing = this.repos.products.findById(id);
    if (!existing) throw new NotFoundException(`Không tìm thấy sản phẩm mã "${id}".`);

    const name = input?.name !== undefined ? String(input.name).trim() : existing.name;
    const sku = input?.sku !== undefined ? String(input.sku).trim().toUpperCase() : existing.sku;
    const barcode = input?.barcode !== undefined ? String(input.barcode).trim() : existing.barcode;
    const brand = input?.brand !== undefined ? String(input.brand).trim() : existing.brand;
    const packSize = input?.packSize !== undefined ? String(input.packSize).trim() : existing.pack_size;
    const categoryCode = input?.categoryCode !== undefined ? String(input.categoryCode).trim() : existing.category_code;
    const unitCode = input?.unitCode !== undefined ? String(input.unitCode).trim() : existing.unit_code;
    const supplierId = input?.supplierId !== undefined ? String(input.supplierId).trim() : existing.supplier_id;

    assertRule(name.length >= 2 && name.length <= 180, 'Tên sản phẩm phải từ 2 đến 180 ký tự.', 400);
    assertRule(
      /^[A-Z0-9._-]{2,32}$/.test(sku),
      'Mã SKU chỉ gồm chữ hoa, số và dấu (., _, -), dài 2–32 ký tự.',
      400,
    );
    assertRule(barcode.length >= 4 && barcode.length <= 64, 'Mã vạch (Barcode) phải từ 4 đến 64 ký tự.', 400);

    const salePrice =
      input?.salePrice !== undefined ? parseNonNegativeInt(input.salePrice, 'Giá bán') : existing.sale_price;
    const costPrice =
      input?.costPrice !== undefined ? parseNonNegativeInt(input.costPrice, 'Giá vốn') : existing.cost_price;
    const minStock =
      input?.minStock !== undefined ? parseNonNegativeInt(input.minStock, 'Tồn tối thiểu') : existing.min_stock;
    const imageUrl =
      input?.imageUrl !== undefined ? validateProductImageUrl(input.imageUrl) : existing.image_url;
    const status =
      input?.status !== undefined ? input.status : existing.status;

    assertRule(
      ['DangKinhDoanh', 'NgungKinhDoanh'].includes(status),
      'Trạng thái sản phẩm chỉ nhận DangKinhDoanh hoặc NgungKinhDoanh.',
      400,
    );

    const category = this.repos.categories.findByCode(categoryCode);
    assertRule(Boolean(category), 'Danh mục hàng hóa không tồn tại.', 400);
    const unit = this.repos.units.findByCode(unitCode);
    assertRule(Boolean(unit), 'Đơn vị tính không tồn tại.', 400);
    const supplier = this.repos.suppliers.findById(supplierId);
    assertRule(Boolean(supplier), 'Nhà cung cấp không tồn tại.', 400);

    const dupSku = this.repos.products.findBySku(sku);
    if (dupSku && dupSku.id !== id) {
      throw new ConflictException(`Mã SKU "${sku}" đã thuộc về sản phẩm ${dupSku.id} (BR-01).`);
    }
    const dupBarcode = this.repos.products.findByBarcode(barcode);
    if (dupBarcode && dupBarcode.id !== id) {
      throw new ConflictException(`Mã vạch "${barcode}" đã thuộc về sản phẩm ${dupBarcode.id} (BR-01).`);
    }

    const updated = withTransaction(this.db, () => {
      const next = this.repos.products.update(id, {
        sku,
        barcode,
        name,
        brand,
        pack_size: packSize,
        category_code: categoryCode,
        unit_code: unitCode,
        supplier_id: supplierId,
        sale_price: salePrice,
        cost_price: costPrice,
        min_stock: minStock,
        image_url: imageUrl,
        status,
      });

      this.repos.auditLogs.append({
        actor,
        action: 'PRODUCT_UPDATE',
        entityType: 'Product',
        entityId: id,
        detail: `Cập nhật sản phẩm ${sku} — ${name} (Giá bán ${salePrice.toLocaleString('vi-VN')} ₫)`,
        before: {
          sku: existing.sku,
          barcode: existing.barcode,
          name: existing.name,
          salePrice: existing.sale_price,
          costPrice: existing.cost_price,
          status: existing.status,
        },
        after: { sku, barcode, name, salePrice, costPrice, status },
      });

      return next;
    });

    return toProductDto(updated, { canViewCost: true });
  }

  setProductStatus(actor, id, nextStatus) {
    const existing = this.repos.products.findById(id);
    if (!existing) throw new NotFoundException(`Không tìm thấy sản phẩm mã "${id}".`);
    assertRule(
      ['DangKinhDoanh', 'NgungKinhDoanh'].includes(nextStatus),
      'Trạng thái sản phẩm chỉ nhận DangKinhDoanh hoặc NgungKinhDoanh.',
      400,
    );
    if (existing.status === nextStatus) {
      return toProductDto(existing, { canViewCost: true });
    }

    const updated = withTransaction(this.db, () => {
      const next = this.repos.products.update(id, { status: nextStatus });
      this.repos.auditLogs.append({
        actor,
        action: nextStatus === 'NgungKinhDoanh' ? 'PRODUCT_DEACTIVATE' : 'PRODUCT_REACTIVATE',
        entityType: 'Product',
        entityId: id,
        detail:
          nextStatus === 'NgungKinhDoanh'
            ? `Ngừng kinh doanh (Soft-Delete) sản phẩm ${existing.sku} — ${existing.name}`
            : `Mở bán lại sản phẩm ${existing.sku} — ${existing.name}`,
        before: { status: existing.status },
        after: { status: nextStatus },
      });
      return next;
    });

    return toProductDto(updated, { canViewCost: true });
  }

  deleteProduct(actor, id) {
    const existing = this.repos.products.findById(id);
    if (!existing) throw new NotFoundException(`Không tìm thấy sản phẩm mã "${id}".`);
    const refs = this.repos.products.countTransactionRefs(id);
    if (refs.total > 0) {
      throw new ConflictException(
        `Không thể xóa cứng sản phẩm "${existing.sku}" vì đã phát sinh ${refs.total} bản ghi giao dịch / thẻ kho (BR-01). Vui lòng dùng thao tác Ngừng kinh doanh (Soft-Delete).`,
      );
    }
    throw new ForbiddenException(
      'Hệ thống áp dụng chính sách Soft-Delete (DangKinhDoanh → NgungKinhDoanh) để bảo toàn dữ liệu. Vui lòng chuyển sang Ngừng kinh doanh thay vì xóa cứng.',
    );
  }

  adjustProductStock(actor, id, input, options = {}) {
    const note = String(input?.note || '').trim();
    assertRule(
      note.length >= 3 && note.length <= 250,
      'Vui lòng nhập lý do điều chỉnh tồn kho (tối thiểu 3 ký tự) để lưu vào Thẻ kho.',
      400,
    );

    const requestedBatchId = String(input?.batchId || input?.batch_id || '').trim();
    const requestedExpiry = String(input?.expiryDate || input?.expiry_date || '').trim();
    const today = todayYmdVn();
    if (requestedExpiry) {
      assertRule(isValidIsoYmd(requestedExpiry), 'Hạn sử dụng lô điều chỉnh phải theo định dạng YYYY-MM-DD.', 400);
      assertRule(requestedExpiry > today, `Hạn sử dụng (${requestedExpiry}) phải lớn hơn hôm nay (${today}).`, 400);
    }

    const result = withTransaction(this.db, () => {
      const existing = this.repos.products.findById(id);
      if (!existing) throw new NotFoundException(`Không tìm thấy sản phẩm mã "${id}".`);

      const stockBefore = Number(existing.stock_qty) || 0;
      let stockAfter;
      let delta;
      if (input?.newStock !== undefined && input?.newStock !== '') {
        stockAfter = parseNonNegativeInt(input.newStock, 'Tồn kho mới');
        delta = stockAfter - stockBefore;
      } else {
        const parsedDelta = Number(input?.delta);
        assertRule(
          Number.isSafeInteger(parsedDelta) && parsedDelta !== 0,
          'Số lượng biến động (delta) phải là số nguyên khác 0.',
          400,
        );
        delta = parsedDelta;
        stockAfter = stockBefore + delta;
      }

      assertRule(delta !== 0, 'Số lượng tồn kho mới trùng với tồn hiện tại, không phát sinh biến động.', 400);
      assertRule(
        stockAfter >= 0,
        `Không thể xuất âm kho (BR-06): tồn hiện tại ${stockBefore}, điều chỉnh ${delta} sẽ dẫn tới tồn âm (${stockAfter}).`,
        400,
        'NEGATIVE_STOCK_FORBIDDEN',
      );

      const docId =
        String(input?.docId || '').trim() ||
        `ADJ-${existing.sku}-${Date.now().toString(36).toUpperCase().slice(-4)}`;

      // F-02: product_batches is the canonical ledger; mutate batches & sync products.stock_qty atomically
      const affectedBatchCodes = [];
      let currentBatchSum = stockBefore;
      if (this.repos.batches) {
        const salableBatches = this.repos.batches.findSalableFefo(id, today);
        currentBatchSum = salableBatches.reduce((s, b) => s + (Number(b.qty_remaining) || 0), 0);
        const batchDelta = stockAfter - currentBatchSum;

        if (batchDelta < 0) {
          let remain = Math.abs(batchDelta);
          if (requestedBatchId) {
            const target = this.repos.batches.findById(requestedBatchId);
            assertRule(Boolean(target) && target.product_id === id, `Lô hàng "${requestedBatchId}" không thuộc sản phẩm "${existing.sku}".`, 400);
            assertRule(
              !['HetHan', 'DaHuy', 'DaHet'].includes(target.status) && (!target.expiry_date || target.expiry_date > today),
              `Lô hàng "${target.batch_code}" không ở trạng thái khả dụng để điều chỉnh giảm.`,
              400,
            );
            const targetQty = Number(target.qty_remaining) || 0;
            assertRule(
              targetQty >= remain,
              `Lô "${target.batch_code}" chỉ còn ${targetQty}, không thể điều chỉnh giảm ${remain}.`,
              400,
              'NEGATIVE_STOCK_FORBIDDEN',
            );
            const afterQty = targetQty - remain;
            this.repos.batches.updateQtyAndStatus(target.id, afterQty, afterQty === 0 ? 'DaHet' : target.status);
            affectedBatchCodes.push(target.batch_code);
          } else {
            assertRule(
              currentBatchSum >= remain,
              `Tổng tồn các lô khả dụng (${currentBatchSum}) không đủ để giảm ${remain} (BR-06).`,
              400,
              'NEGATIVE_STOCK_FORBIDDEN',
            );
            for (const b of salableBatches) {
              if (remain <= 0) break;
              const bQty = Number(b.qty_remaining) || 0;
              const take = Math.min(remain, bQty);
              if (take > 0) {
                const afterQty = bQty - take;
                this.repos.batches.updateQtyAndStatus(b.id, afterQty, afterQty === 0 ? 'DaHet' : b.status);
                affectedBatchCodes.push(b.batch_code);
                remain -= take;
              }
            }
          }
        } else if (batchDelta > 0) {
          if (requestedBatchId) {
            const target = this.repos.batches.findById(requestedBatchId);
            assertRule(Boolean(target) && target.product_id === id, `Lô hàng "${requestedBatchId}" không thuộc sản phẩm "${existing.sku}".`, 400);
            assertRule(
              !['HetHan', 'DaHuy'].includes(target.status) && (!target.expiry_date || target.expiry_date > today),
              `Lô hàng "${target.batch_code}" đã hết hạn hoặc bị hủy, không thể điều chỉnh tăng.`,
              400,
            );
            const nextQty = (Number(target.qty_remaining) || 0) + batchDelta;
            this.repos.batches.updateQtyAndStatus(target.id, nextQty, target.status === 'DaHet' ? 'ConHan' : target.status);
            affectedBatchCodes.push(target.batch_code);
          } else if (Number(existing.has_expiry) === 0 && salableBatches.length > 0) {
            const target = salableBatches.find((b) => !b.expiry_date) || salableBatches[salableBatches.length - 1];
            const nextQty = (Number(target.qty_remaining) || 0) + batchDelta;
            this.repos.batches.updateQtyAndStatus(target.id, nextQty, target.status === 'DaHet' ? 'ConHan' : target.status);
            affectedBatchCodes.push(target.batch_code);
          } else {
            const adjBatch = this.repos.batches.create({
              batchCode: docId,
              productId: id,
              mfgDate: today,
              expiryDate: Number(existing.has_expiry) === 1 && requestedExpiry ? requestedExpiry : '',
              initialQty: batchDelta,
              qtyRemaining: batchDelta,
              unitCost: Number(existing.cost_price) || 0,
              status: 'ConHan',
            });
            affectedBatchCodes.push(adjBatch.batch_code);
          }
        }

        const syncedStock = this.repos.batches.syncProductSalableStock(id, today);
        assertRule(
          syncedStock === stockAfter,
          `Lỗi đồng bộ tồn kho giữa products (${stockAfter}) và product_batches (${syncedStock}).`,
          500,
        );
      } else {
        this.repos.products.updateStock(id, stockAfter);
      }

      const batchCodeRef = affectedBatchCodes.join(', ');
      const movement = this.repos.stockMovements.append({
        productId: id,
        stockBefore,
        delta,
        stockAfter,
        docType: 'DIEU_CHINH_TON',
        docId,
        batchCode: batchCodeRef,
        actorId: actor.id,
        actorName: actor.full_name,
        note: batchCodeRef ? `${note} (Lô: ${batchCodeRef})` : note,
      });

      this.repos.auditLogs.append({
        actor,
        action: 'STOCK_ADJUST',
        entityType: 'Product',
        entityId: id,
        detail: `Điều chỉnh tồn ${existing.sku}: ${stockBefore} → ${stockAfter} (${delta > 0 ? '+' : ''}${delta})${batchCodeRef ? ` · Lô ${batchCodeRef}` : ''}. Lý do: ${note}`,
        before: { stockQty: stockBefore, batchQty: currentBatchSum },
        after: { stockQty: stockAfter, batchQty: stockAfter, batchCodes: affectedBatchCodes, movementId: movement.id },
      });

      if (typeof options._beforeCommitHook === 'function') {
        options._beforeCommitHook();
      }

      return { product: this.repos.products.findById(id), movement };
    });

    return {
      item: toProductDto(result.product, { canViewCost: true }),
      movement: toMovementDto(result.movement),
    };
  }

  // ─── CATEGORIES (DanhMuc) ─────────────────────────────────────────────────

  listCategories(filters = {}) {
    return this.repos.categories.list(filters).map(toCategoryDto);
  }

  createCategory(actor, input) {
    const name = String(input?.name || '').trim();
    const description = String(input?.description || '').trim();
    const rawCode = String(input?.code || '').trim().toUpperCase();
    assertRule(name.length >= 2 && name.length <= 100, 'Tên danh mục phải từ 2 đến 100 ký tự.', 400);
    assertRule(!rawCode || /^[A-Z0-9_-]{2,20}$/.test(rawCode), 'Mã danh mục chỉ gồm chữ hoa, số, gạch ngang/dưới.', 400);

    if (rawCode && this.repos.categories.findByCode(rawCode)) {
      throw new ConflictException(`Mã danh mục "${rawCode}" đã tồn tại.`);
    }
    if (this.repos.categories.findByName(name)) {
      throw new ConflictException(`Danh mục "${name}" đã tồn tại.`);
    }

    const created = withTransaction(this.db, () => {
      const cat = this.repos.categories.create({
        code: rawCode || undefined,
        name,
        description,
        status: 'HoatDong',
      });
      this.repos.auditLogs.append({
        actor,
        action: 'CATEGORY_CREATE',
        entityType: 'Category',
        entityId: cat.code,
        detail: `Thêm danh mục ${cat.code} — ${cat.name}`,
        after: cat,
      });
      return cat;
    });
    return toCategoryDto(created);
  }

  updateCategory(actor, code, input) {
    const existing = this.repos.categories.findByCode(code);
    if (!existing) throw new NotFoundException(`Không tìm thấy danh mục mã "${code}".`);
    const name = input?.name !== undefined ? String(input.name).trim() : existing.name;
    const description = input?.description !== undefined ? String(input.description).trim() : existing.description;
    const status = input?.status !== undefined ? input.status : existing.status;

    assertRule(name.length >= 2 && name.length <= 100, 'Tên danh mục phải từ 2 đến 100 ký tự.', 400);
    assertRule(['HoatDong', 'NgungSuDung'].includes(status), 'Trạng thái danh mục không hợp lệ.', 400);

    const dup = this.repos.categories.findByName(name);
    if (dup && dup.code !== code) {
      throw new ConflictException(`Tên danh mục "${name}" đã tồn tại.`);
    }

    const updated = withTransaction(this.db, () => {
      const next = this.repos.categories.update(code, { name, description, status });
      this.repos.auditLogs.append({
        actor,
        action: 'CATEGORY_UPDATE',
        entityType: 'Category',
        entityId: code,
        detail: `Cập nhật danh mục ${code} — ${name} (${status})`,
        before: { name: existing.name, status: existing.status },
        after: { name, status },
      });
      return next;
    });
    return toCategoryDto(updated);
  }

  setCategoryStatus(actor, code, status) {
    return this.updateCategory(actor, code, { status });
  }

  deleteCategory(code) {
    const existing = this.repos.categories.findByCode(code);
    if (!existing) throw new NotFoundException(`Không tìm thấy danh mục mã "${code}".`);
    const cnt = this.repos.categories.countProducts(code);
    if (cnt > 0) {
      throw new ConflictException(
        `Không thể xóa cứng danh mục "${existing.name}" vì đang có ${cnt} sản phẩm thuộc danh mục này. Vui lòng chuyển sang Ngừng sử dụng.`,
      );
    }
    throw new ForbiddenException('Danh mục áp dụng Soft-Delete (Ngừng sử dụng), không cho phép xóa cứng.');
  }

  // ─── UNITS (DonViTinh) ────────────────────────────────────────────────────

  listUnits(filters = {}) {
    return this.repos.units.list(filters).map(toUnitDto);
  }

  createUnit(actor, input) {
    const name = String(input?.name || '').trim();
    const rawCode = String(input?.code || '').trim().toUpperCase();
    assertRule(name.length >= 1 && name.length <= 50, 'Tên đơn vị tính phải từ 1 đến 50 ký tự.', 400);
    assertRule(!rawCode || /^[A-Z0-9_-]{2,20}$/.test(rawCode), 'Mã ĐVT chỉ gồm chữ hoa, số, gạch ngang/dưới.', 400);

    if (rawCode && this.repos.units.findByCode(rawCode)) {
      throw new ConflictException(`Mã đơn vị tính "${rawCode}" đã tồn tại.`);
    }
    if (this.repos.units.findByName(name)) {
      throw new ConflictException(`Đơn vị tính "${name}" đã tồn tại.`);
    }

    const created = withTransaction(this.db, () => {
      const unit = this.repos.units.create({ code: rawCode || undefined, name, status: 'HoatDong' });
      this.repos.auditLogs.append({
        actor,
        action: 'UNIT_CREATE',
        entityType: 'Unit',
        entityId: unit.code,
        detail: `Thêm đơn vị tính ${unit.code} — ${unit.name}`,
        after: unit,
      });
      return unit;
    });
    return toUnitDto(created);
  }

  updateUnit(actor, code, input) {
    const existing = this.repos.units.findByCode(code);
    if (!existing) throw new NotFoundException(`Không tìm thấy đơn vị tính mã "${code}".`);
    const name = input?.name !== undefined ? String(input.name).trim() : existing.name;
    const status = input?.status !== undefined ? input.status : existing.status;

    assertRule(name.length >= 1 && name.length <= 50, 'Tên đơn vị tính phải từ 1 đến 50 ký tự.', 400);
    assertRule(['HoatDong', 'NgungSuDung'].includes(status), 'Trạng thái đơn vị tính không hợp lệ.', 400);

    const dup = this.repos.units.findByName(name);
    if (dup && dup.code !== code) {
      throw new ConflictException(`Đơn vị tính "${name}" đã tồn tại.`);
    }

    const updated = withTransaction(this.db, () => {
      const next = this.repos.units.update(code, { name, status });
      this.repos.auditLogs.append({
        actor,
        action: 'UNIT_UPDATE',
        entityType: 'Unit',
        entityId: code,
        detail: `Cập nhật đơn vị tính ${code} — ${name} (${status})`,
        before: { name: existing.name, status: existing.status },
        after: { name, status },
      });
      return next;
    });
    return toUnitDto(updated);
  }

  setUnitStatus(actor, code, status) {
    return this.updateUnit(actor, code, { status });
  }

  deleteUnit(code) {
    const existing = this.repos.units.findByCode(code);
    if (!existing) throw new NotFoundException(`Không tìm thấy đơn vị tính mã "${code}".`);
    const cnt = this.repos.units.countProducts(code);
    if (cnt > 0) {
      throw new ConflictException(
        `Không thể xóa cứng đơn vị tính "${existing.name}" vì đang có ${cnt} sản phẩm sử dụng. Vui lòng chuyển sang Ngừng sử dụng.`,
      );
    }
    throw new ForbiddenException('Đơn vị tính áp dụng Soft-Delete (Ngừng sử dụng), không cho phép xóa cứng.');
  }

  // ─── SUPPLIERS (NhaCungCap) ───────────────────────────────────────────────

  listSuppliers(filters = {}) {
    return this.repos.suppliers.list(filters).map(toSupplierDto);
  }

  createSupplier(actor, input) {
    const name = String(input?.name || '').trim();
    const phone = String(input?.phone || '').trim();
    const categoryGroup = String(input?.categoryGroup ?? input?.category ?? '').trim();
    const areas = String(input?.areas || '').trim();

    assertRule(name.length >= 2 && name.length <= 150, 'Tên nhà cung cấp phải từ 2 đến 150 ký tự.', 400);
    assertRule(phone.length >= 8 && phone.length <= 24, 'Số điện thoại nhà cung cấp phải từ 8 đến 24 ký tự.', 400);
    assertRule(categoryGroup.length >= 2, 'Vui lòng nhập nhóm hàng cung cấp.', 400);
    assertRule(areas.length >= 2, 'Vui lòng nhập vùng cung ứng.', 400);

    if (this.repos.suppliers.findByName(name)) {
      throw new ConflictException(`Nhà cung cấp "${name}" đã tồn tại.`);
    }

    const created = withTransaction(this.db, () => {
      const sup = this.repos.suppliers.create({
        name,
        phone,
        category_group: categoryGroup,
        areas,
        status: 'HoatDong',
      });
      this.repos.auditLogs.append({
        actor,
        action: 'SUPPLIER_CREATE',
        entityType: 'Supplier',
        entityId: sup.id,
        detail: `Thêm nhà cung cấp ${sup.id} — ${sup.name} (${sup.phone})`,
        after: sup,
      });
      return sup;
    });
    return toSupplierDto(created);
  }

  updateSupplier(actor, id, input) {
    const existing = this.repos.suppliers.findById(id);
    if (!existing) throw new NotFoundException(`Không tìm thấy nhà cung cấp mã "${id}".`);

    const name = input?.name !== undefined ? String(input.name).trim() : existing.name;
    const phone = input?.phone !== undefined ? String(input.phone).trim() : existing.phone;
    const categoryGroup =
      input?.categoryGroup !== undefined
        ? String(input.categoryGroup).trim()
        : input?.category !== undefined
          ? String(input.category).trim()
          : existing.category_group;
    const areas = input?.areas !== undefined ? String(input.areas).trim() : existing.areas;
    const status = input?.status !== undefined ? input.status : existing.status;

    assertRule(name.length >= 2 && name.length <= 150, 'Tên nhà cung cấp phải từ 2 đến 150 ký tự.', 400);
    assertRule(phone.length >= 8 && phone.length <= 24, 'Số điện thoại nhà cung cấp không hợp lệ.', 400);
    assertRule(['HoatDong', 'NgungHopTac'].includes(status), 'Trạng thái nhà cung cấp không hợp lệ.', 400);

    const dup = this.repos.suppliers.findByName(name);
    if (dup && dup.id !== id) {
      throw new ConflictException(`Nhà cung cấp "${name}" đã tồn tại.`);
    }

    const updated = withTransaction(this.db, () => {
      const next = this.repos.suppliers.update(id, {
        name,
        phone,
        category_group: categoryGroup,
        areas,
        status,
      });
      this.repos.auditLogs.append({
        actor,
        action: 'SUPPLIER_UPDATE',
        entityType: 'Supplier',
        entityId: id,
        detail: `Cập nhật nhà cung cấp ${id} — ${name} (${status})`,
        before: { name: existing.name, phone: existing.phone, status: existing.status },
        after: { name, phone, status },
      });
      return next;
    });
    return toSupplierDto(updated);
  }

  setSupplierStatus(actor, id, status) {
    const existing = this.repos.suppliers.findById(id);
    if (!existing) throw new NotFoundException(`Không tìm thấy nhà cung cấp mã "${id}".`);
    assertRule(['HoatDong', 'NgungHopTac'].includes(status), 'Trạng thái nhà cung cấp không hợp lệ.', 400);
    if (existing.status === status) return toSupplierDto(existing);

    const updated = withTransaction(this.db, () => {
      const next = this.repos.suppliers.update(id, { status });
      this.repos.auditLogs.append({
        actor,
        action: status === 'NgungHopTac' ? 'SUPPLIER_DEACTIVATE' : 'SUPPLIER_REACTIVATE',
        entityType: 'Supplier',
        entityId: id,
        detail:
          status === 'NgungHopTac'
            ? `Ngừng hợp tác (Soft-Delete) nhà cung cấp ${id} — ${existing.name}`
            : `Khôi phục hợp tác nhà cung cấp ${id} — ${existing.name}`,
        before: { status: existing.status },
        after: { status },
      });
      return next;
    });
    return toSupplierDto(updated);
  }

  getSupplierHistory(id) {
    const supplier = this.repos.suppliers.findById(id);
    if (!supplier) throw new NotFoundException(`Không tìm thấy nhà cung cấp mã "${id}".`);
    const purchases = this.repos.suppliers.listPurchases(id);
    return {
      supplier: toSupplierDto(supplier),
      purchases,
    };
  }

  deleteSupplier(id) {
    const existing = this.repos.suppliers.findById(id);
    if (!existing) throw new NotFoundException(`Không tìm thấy nhà cung cấp mã "${id}".`);
    const refs = this.repos.suppliers.countReferences(id);
    if (refs.total > 0) {
      throw new ConflictException(
        `Không thể xóa cứng nhà cung cấp "${existing.name}" vì đang liên kết với ${refs.productCount} sản phẩm và ${refs.purchaseCount} phiếu nhập. Vui lòng chuyển sang Ngừng hợp tác.`,
      );
    }
    throw new ForbiddenException('Nhà cung cấp áp dụng Soft-Delete (Ngừng hợp tác), không cho phép xóa cứng.');
  }

  // ─── STOCK MOVEMENTS / THẺ KHO (LichSuTonKho — Immutable) ─────────────────

  queryStockMovements(params = {}) {
    const fromDate = String(params.fromDate || '').trim();
    const toDate = String(params.toDate || '').trim();
    if (fromDate && toDate) {
      assertRule(
        fromDate <= toDate,
        'Khoảng thời gian không hợp lệ: "Từ ngày" phải nhỏ hơn hoặc bằng "Đến ngày" (BR-08).',
        400,
        'INVALID_DATE_RANGE',
      );
    }
    const result = this.repos.stockMovements.query({
      search: params.search || '',
      productId: params.productId || '',
      docType: params.docType || '',
      fromDate,
      toDate,
      page: params.page || 1,
      limit: params.limit || 15,
    });
    return {
      ...result,
      items: result.items.map(toMovementDto),
      docTypeLabels: DOC_TYPE_LABELS,
    };
  }
}

module.exports = { CatalogService, DOC_TYPE_LABELS, getAvailableProductImages };
