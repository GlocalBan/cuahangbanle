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
                p.imageUrl.includes('data:image/svg'),
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
    autoMigrate(oldData) {
      const fresh = seed();
      const freshProducts = fresh.products;
      const oldProducts = Array.isArray(oldData?.products) ? oldData.products : [];
      const oldMap = new Map(oldProducts.map((p) => [p.id, p]));

      const mergedProducts = freshProducts.map((fp) => {
        const op = oldMap.get(fp.id);
        if (op) {
          return {
            ...fp,
            stock: typeof op.stock === 'number' && op.stock >= 0 ? op.stock : fp.stock,
            damagedStock: typeof op.damagedStock === 'number' ? op.damagedStock : 0,
            inNearExpiryPromo: !!op.inNearExpiryPromo,
            mfgDate: fp.mfgDate,
            expiryDate: fp.expiryDate,
            batchCode: fp.batchCode || op.batchCode,
            imageUrl: fp.imageUrl,
            costPrice: fp.costPrice,
            cost: fp.cost,
            price: op.price || fp.price,
            name: op.name || fp.name,
            category: fp.category || op.category,
            active: op.active !== undefined ? op.active : true,
          };
        }
        return fp;
      });

      oldProducts.forEach((op) => {
        if (!freshProducts.some((fp) => fp.id === op.id)) {
          mergedProducts.push(op);
        }
      });

      oldData.products = mergedProducts;
      if (!Array.isArray(oldData.promotions) || oldData.promotions.length === 0) {
        oldData.promotions = fresh.promotions;
      }
      if (!Array.isArray(oldData.vouchers) || oldData.vouchers.length === 0) {
        oldData.vouchers = fresh.vouchers;
      }
      return oldData;
    }
    syncSeedCatalog() {
      return this.commit('Đồng bộ danh mục mẫu mới', '80+ sản phẩm CVS & HSD', () => {
        this.data = this.autoMigrate(this.data);
        return this.data.products.length;
      });
    }
    get user() {
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
