(function (scope) {
  'use strict';
  const api =
    typeof module !== 'undefined' && module.exports
      ? {
          ...require('./config.js'),
          ...require('./calculations.js'),
          ...require('./seed.js'),
          ...require('./backup.js'),
          ...require('./catalog.js'),
        }
      : scope.Retail;
  const { KEY, clone, now, id, assert, seed, validateBackup } = api;

  class Store {
    constructor(storage) {
      this.storage = storage;
      this.userId = null;
      this.loadError = '';
      let raw = null;
      try {
        raw = storage.getItem(KEY);
        let parsed = raw ? JSON.parse(raw) : null;
        if (parsed) {
          const prods = Array.isArray(parsed.products) ? parsed.products : [];
          const getExp = api.getExpiryInfo;
          const nearCount = prods.filter(
            (p) => getExp && getExp(p.expiryDate).status === 'near_expiry',
          ).length;
          const expCount = prods.filter(
            (p) => getExp && getExp(p.expiryDate).status === 'expired',
          ).length;
          const needsMigration =
            prods.length < 80 ||
            prods.some(
              (p) =>
                !p.expiryDate ||
                !p.imageUrl ||
                p.imageUrl.includes('data:image/svg') ||
                !p.gtin ||
                !Array.isArray(p.batches),
            ) ||
            (nearCount === 0 && expCount === 0) ||
            !Array.isArray(parsed.promotions) ||
            !Array.isArray(parsed.vouchers);

          if (needsMigration) {
            parsed = this.autoMigrate(parsed);
          }
          this.data = validateBackup(parsed);
        } else {
          this.data = seed();
        }

        storage.setItem(KEY, JSON.stringify(this.data));
      } catch (e) {
        this.loadError = `Không đọc hoặc lưu được dữ liệu: ${e.message}`;
        this.data = seed();
        this.readOnly = true;
      }
    }

    // Đồng bộ thuộc tính sản phẩm từ danh sách batches (FEFO)
    syncProductWithBatches(prod) {
      if (!Array.isArray(prod.batches) || prod.batches.length === 0) {
        return prod;
      }
      const todayStr = new Date().toISOString().slice(0, 10);
      let activeStock = 0;
      let quarantinedStock = 0;

      // Sắp xếp các lô theo HSD tăng dần (FEFO)
      prod.batches.sort((a, b) => (a.expiryDate || '').localeCompare(b.expiryDate || ''));

      prod.batches.forEach((b) => {
        const isExp = (b.expiryDate || '') < todayStr;
        if (isExp && b.status === 'active') {
          b.status = 'expired_quarantined';
        }
        if (b.status === 'active') {
          activeStock += b.remainingQty || 0;
        } else if (b.status === 'expired_quarantined') {
          quarantinedStock += b.remainingQty || 0;
        }
      });

      prod.stock = activeStock;
      // Giữ damagedStock cũ nếu lớn hơn hoặc cộng dồn hàng lỗi
      if (typeof prod.damagedStock !== 'number') prod.damagedStock = 0;
      if (quarantinedStock > prod.damagedStock) {
        prod.damagedStock = quarantinedStock;
      }

      // Cập nhật lô FEFO hiện hành (lô active đầu tiên)
      const currentBatch = prod.batches.find((b) => b.status === 'active' && b.remainingQty > 0);
      if (currentBatch) {
        prod.expiryDate = currentBatch.expiryDate;
        prod.batchCode = currentBatch.batchCode;
        prod.costPrice = currentBatch.costPrice;
        prod.cost = currentBatch.costPrice;
        if (currentBatch.mfgDate) prod.mfgDate = currentBatch.mfgDate;
      }

      return prod;
    }

    // Quét tự động không tạo log gây lỗi revision lúc khởi tạo
    sweepExpiredBatchesSilent() {
      if (!this.data || !Array.isArray(this.data.products)) return 0;
      let count = 0;
      this.data.products.forEach((p) => {
        this.syncProductWithBatches(p);
      });
      // Đồng bộ root batches
      this.data.batches = this.data.products.flatMap((p) => p.batches || []);
      return count;
    }

    // Phương án B: autoMigrate KHÔNG ghi đè dữ liệu người dùng đã tùy chỉnh
    autoMigrate(oldData) {
      const fresh = seed();
      const freshProducts = fresh.products;
      const oldProducts = Array.isArray(oldData?.products) ? oldData.products : [];
      const oldMap = new Map(oldProducts.map((p) => [p.id, p]));

      const mergedProducts = freshProducts.map((fp) => {
        const op = oldMap.get(fp.id);
        if (op) {
          // BẢO VỆ DỮ LIỆU NGƯỜI DÙNG: Cấm ghi đè name, price, costPrice, stock, batches, expiryDate, imageUrl
          const preservedStock =
            typeof op.stock === 'number' && op.stock >= 0 ? op.stock : fp.stock;
          const preservedPrice = op.price !== undefined ? op.price : fp.price;
          const preservedCost =
            op.costPrice !== undefined ? op.costPrice : (op.cost !== undefined ? op.cost : fp.costPrice);
          const preservedName = op.name || fp.name;
          const preservedCategory = op.category || fp.category;
          const preservedExpiry = op.expiryDate || fp.expiryDate;
          const preservedMfg = op.mfgDate || fp.mfgDate;
          const preservedBatchCode = op.batchCode || fp.batchCode;
          const preservedImg =
            op.imageUrl && !op.imageUrl.includes('data:image/svg') ? op.imageUrl : fp.imageUrl;
          const preservedBatches =
            Array.isArray(op.batches) && op.batches.length > 0
              ? op.batches
              : (fp.batches || []).map((b) => ({
                  ...b,
                  costPrice: preservedCost,
                  remainingQty: preservedStock,
                  initialQty: preservedStock,
                }));

          const merged = {
            ...fp,
            ...op,
            // Đảm bảo không bị ghi đè các trường người dùng sửa:
            name: preservedName,
            price: preservedPrice,
            cost: preservedCost,
            costPrice: preservedCost,
            stock: preservedStock,
            category: preservedCategory,
            expiryDate: preservedExpiry,
            mfgDate: preservedMfg,
            batchCode: preservedBatchCode,
            imageUrl: preservedImg,
            batches: preservedBatches,
            damagedStock: typeof op.damagedStock === 'number' ? op.damagedStock : (fp.damagedStock || 0),
            inNearExpiryPromo: op.inNearExpiryPromo !== undefined ? op.inNearExpiryPromo : fp.inNearExpiryPromo,
            active: op.active !== undefined ? op.active : true,
            // Bổ sung các trường schema mới từ fp nếu op chưa có:
            gtin: op.gtin || fp.gtin,
            brand: op.brand || fp.brand,
            packSize: op.packSize || fp.packSize,
            unit: op.unit || fp.unit,
            categoryL1: op.categoryL1 || fp.categoryL1,
            categoryL2: op.categoryL2 || fp.categoryL2,
            categoryL3: op.categoryL3 || fp.categoryL3,
            vatRate: op.vatRate !== undefined ? op.vatRate : fp.vatRate,
            nearExpiryDays: op.nearExpiryDays !== undefined ? op.nearExpiryDays : fp.nearExpiryDays,
            nearExpiryDiscountPercent:
              op.nearExpiryDiscountPercent !== undefined
                ? op.nearExpiryDiscountPercent
                : fp.nearExpiryDiscountPercent,
            referenceSource: op.referenceSource || fp.referenceSource,
          };
          return this.syncProductWithBatches(merged);
        }
        return fp;
      });

      // Giữ lại các sản phẩm do người dùng tự tạo mới (không có trong seed)
      oldProducts.forEach((op) => {
        if (!freshProducts.some((fp) => fp.id === op.id)) {
          mergedProducts.push(this.syncProductWithBatches(op));
        }
      });

      oldData.products = mergedProducts;
      oldData.batches = mergedProducts.flatMap((p) => p.batches || []);

      if (!Array.isArray(oldData.promotions) || oldData.promotions.length === 0) {
        oldData.promotions = fresh.promotions;
      }
      if (!Array.isArray(oldData.vouchers) || oldData.vouchers.length === 0) {
        oldData.vouchers = fresh.vouchers;
      }
      if (!Array.isArray(oldData.suppliers) || oldData.suppliers.length < 5) {
        oldData.suppliers = fresh.suppliers;
      }
      return oldData;
    }

    // Khóa quyền ADMIN: Đồng bộ chỉ thêm SKU mới, không ghi đè sản phẩm người dùng
    syncSeedCatalog() {
      this.admin();
      return this.commit('Đồng bộ danh mục mẫu mới', '80+ sản phẩm CVS & HSD FEFO', () => {
        const fresh = seed();
        const existingIds = new Set(this.data.products.map((p) => p.id));
        const existingBarcodes = new Set(this.data.products.map((p) => p.barcode));
        let addedCount = 0;

        fresh.products.forEach((fp) => {
          if (!existingIds.has(fp.id) && !existingBarcodes.has(fp.barcode)) {
            this.data.products.push(fp);
            if (Array.isArray(fp.batches)) {
              if (!this.data.batches) this.data.batches = [];
              this.data.batches.push(...fp.batches);
            }
            addedCount++;
          }
        });

        // Cập nhật suppliers thiếu
        const existingSuppIds = new Set(this.data.suppliers.map((s) => s.id));
        fresh.suppliers.forEach((fs) => {
          if (!existingSuppIds.has(fs.id)) {
            this.data.suppliers.push(fs);
          }
        });

        this.sweepExpiredBatchesSilent();
        return this.data.products.length;
      });
    }

    get user() {
      if (this.authUser && this.authUser.active !== false) return this.authUser;
      return this.data.staff.find((s) => s.id === this.userId && s.active);
    }

    commit(action, detail, fn) {
      assert(
        !this.readOnly,
        'Dữ liệu đang ở chế độ chỉ đọc vì bộ nhớ gặp lỗi. Hãy sao lưu và kiểm tra bộ nhớ trình duyệt.',
      );
      const raw = this.storage.getItem(KEY);
      assert(
        !raw || JSON.parse(raw).revision === this.data.revision,
        'Dữ liệu đã thay đổi ở tab khác. Vui lòng tải lại trang trước khi tiếp tục.',
      );
      const before = clone(this.data);
      try {
        const result = fn();
        this.data.logs.unshift({
          id: id('LOG'),
          time: now(),
          actor: this.user?.name || 'Hệ thống',
          action,
          detail,
        });
        this.data.logs = this.data.logs.slice(0, 1500);
        this.data.revision++;
        this.storage.setItem(KEY, JSON.stringify(this.data));
        return result;
      } catch (e) {
        this.data = before;
        throw e;
      }
    }
  }

  const groups = ['auth', 'sales', 'inventory', 'returns', 'catalog', 'purchases', 'settings'];
  for (const name of groups)
    Object.assign(
      Store.prototype,
      typeof module !== 'undefined' && module.exports
        ? require('./' + name + '.js')
        : scope.Retail.storeModules[name],
    );

  if (typeof module !== 'undefined' && module.exports) module.exports = { ...api, Store };
  else scope.Retail.Store = Store;
})(globalThis);
