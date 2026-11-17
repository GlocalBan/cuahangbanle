(function (scope) {
  'use strict';
  const { KEY, ROLES, METHODS, ACCESS, clone, now, id, assert, integer } =
    typeof module !== 'undefined' && module.exports ? require('./config.js') : scope.Retail;
  const { totals } =
    typeof module !== 'undefined' && module.exports ? require('./calculations.js') : scope.Retail;
  const { validateBackup } =
    typeof module !== 'undefined' && module.exports ? require('./backup.js') : scope.Retail;

  function isValidEan13(gtin) {
    if (typeof gtin !== 'string') gtin = String(gtin || '');
    gtin = gtin.trim();
    if (!/^\d{13}$/.test(gtin)) return false;
    const digits = gtin.split('').map(Number);
    const sum = digits.slice(0, 12).reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 1 : 3), 0);
    const checkDigit = (10 - (sum % 10)) % 10;
    return checkDigit === digits[12];
  }

  function getExpiryInfo(expiryDate, fromDate = new Date(), options = {}) {
    if (!expiryDate) {
      return { status: 'valid', daysRemaining: 999, label: 'Còn hạn', color: 'green' };
    }
    const parts = String(expiryDate).slice(0, 10).split('-');
    if (parts.length !== 3) {
      return { status: 'valid', daysRemaining: 999, label: 'Còn hạn', color: 'green' };
    }
    const target = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    const ref = fromDate instanceof Date ? fromDate : new Date(fromDate);
    const refIso = (isNaN(ref.getTime()) ? new Date() : ref).toISOString().slice(0, 10).split('-');
    const today = new Date(Number(refIso[0]), Number(refIso[1]) - 1, Number(refIso[2]));
    const diffDays = Math.round((target.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
    const nearDays = typeof options === 'number' ? options : (options.nearDays || 30);

    if (diffDays <= 0) {
      return { status: 'expired', daysRemaining: diffDays, label: 'Hết hạn', color: 'red' };
    }
    if (diffDays <= nearDays) {
      return {
        status: 'near_expiry',
        daysRemaining: diffDays,
        label: `Cận date - còn ${diffDays} ngày`,
        color: 'yellow',
      };
    }
    return { status: 'valid', daysRemaining: diffDays, label: 'Còn hạn', color: 'green' };
  }

  const methods = {
    getExpiryInfo,
    isValidEan13,

    // Quét và cách ly tự động các lô hàng hết hạn (diffDays < 0)
    sweepExpiredBatches(todayDate = new Date()) {
      this.require('products');
      return this.commit('Quét và cách ly lô hàng hết hạn', 'Tự động FEFO', () => {
        const todayStr = (todayDate instanceof Date ? todayDate : new Date(todayDate))
          .toISOString()
          .slice(0, 10);
        let quarantinedBatchesCount = 0;
        let totalQuarantinedQty = 0;

        this.data.products.forEach((prod) => {
          if (!Array.isArray(prod.batches) || prod.batches.length === 0) return;

          let prodActiveStock = 0;
          let prodQuarantinedStock = 0;

          // Sắp xếp FEFO: expiryDate tăng dần
          prod.batches.sort((a, b) => (a.expiryDate || '').localeCompare(b.expiryDate || ''));

          prod.batches.forEach((b) => {
            // Hết hạn khi expiryDate < todayStr (diffDays < 0)
            const isExpired = (b.expiryDate || '') < todayStr;
            if (isExpired && b.status === 'active' && b.remainingQty > 0) {
              b.status = 'expired_quarantined';
              quarantinedBatchesCount++;
              totalQuarantinedQty += b.remainingQty;
            }
            if (b.status === 'active') {
              prodActiveStock += b.remainingQty || 0;
            } else if (b.status === 'expired_quarantined') {
              prodQuarantinedStock += b.remainingQty || 0;
            }
          });

          prod.stock = prodActiveStock;
          if (typeof prod.damagedStock !== 'number') prod.damagedStock = 0;
          if (prodQuarantinedStock > prod.damagedStock) {
            prod.damagedStock = prodQuarantinedStock;
          }

          // Cập nhật lô FEFO hiện hành
          const currentBatch = prod.batches.find((b) => b.status === 'active' && b.remainingQty > 0);
          if (currentBatch) {
            prod.expiryDate = currentBatch.expiryDate;
            prod.batchCode = currentBatch.batchCode;
            prod.costPrice = currentBatch.costPrice;
            prod.cost = currentBatch.costPrice;
            if (currentBatch.mfgDate) prod.mfgDate = currentBatch.mfgDate;
          }
        });

        // Đồng bộ root s.batches
        this.data.batches = this.data.products.flatMap((p) => p.batches || []);
        return { quarantinedBatchesCount, totalQuarantinedQty };
      });
    },

    // Cổng nạp CSV đối chứng 1-1 (chỉ dành cho ADMIN)
    importReferenceCatalogCsv(csvText) {
      this.admin();
      assert(typeof csvText === 'string' && csvText.trim(), 'Nội dung tệp CSV trống.');

      const lines = csvText
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      assert(lines.length >= 2, 'Tệp CSV cần ít nhất một dòng tiêu đề và một dòng dữ liệu.');

      const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
      const gtinIdx = headers.indexOf('gtin');
      const brandIdx = headers.indexOf('brand');
      const nameIdx = headers.indexOf('name');
      const packSizeIdx = headers.indexOf('packsize');
      const cat1Idx = headers.indexOf('categoryl1');
      const cat2Idx = headers.indexOf('categoryl2');
      const cat3Idx = headers.indexOf('categoryl3');
      const priceIdx = headers.indexOf('price');
      const costIdx = headers.indexOf('costprice');
      const vatIdx = headers.indexOf('vatrate');
      const imgIdx = headers.indexOf('imageurl');
      const refUrlIdx = headers.indexOf('refurl');

      assert(gtinIdx !== -1 && nameIdx !== -1, 'Tệp CSV phải có tối thiểu cột gtin và name.');

      const seenGtins = new Set();
      const recordsToProcess = [];

      for (let i = 1; i < lines.length; i++) {
        // Simple CSV splitter handling quoted cells
        const row = [];
        let cur = '';
        let inQuotes = false;
        for (const ch of lines[i]) {
          if (ch === '"') {
            inQuotes = !inQuotes;
          } else if (ch === ',' && !inQuotes) {
            row.push(cur.trim());
            cur = '';
          } else {
            cur += ch;
          }
        }
        row.push(cur.trim());

        const gtin = row[gtinIdx] || '';
        assert(gtin, `Dòng ${i + 1}: Thiếu mã GTIN.`);
        assert(isValidEan13(gtin), `Dòng ${i + 1}: Mã GTIN ${gtin} không đúng chuẩn EAN-13 (sai check-digit).`);
        assert(!seenGtins.has(gtin), `Dòng ${i + 1}: Mã GTIN ${gtin} bị trùng lặp trong tệp CSV.`);
        seenGtins.add(gtin);

        recordsToProcess.push({
          gtin,
          brand: brandIdx !== -1 ? row[brandIdx] : '',
          name: row[nameIdx] || '',
          packSize: packSizeIdx !== -1 ? row[packSizeIdx] : '',
          categoryL1: cat1Idx !== -1 ? row[cat1Idx] : 'Tiêu dùng',
          categoryL2: cat2Idx !== -1 ? row[cat2Idx] : 'Thực phẩm',
          categoryL3: cat3Idx !== -1 ? row[cat3Idx] : '',
          price: priceIdx !== -1 && row[priceIdx] ? Number(row[priceIdx]) : 0,
          costPrice: costIdx !== -1 && row[costIdx] ? Number(row[costIdx]) : 0,
          vatRate: vatIdx !== -1 && row[vatIdx] ? Number(row[vatIdx]) : 10,
          imageUrl: imgIdx !== -1 ? row[imgIdx] : '',
          refUrl: refUrlIdx !== -1 ? row[refUrlIdx] : '',
        });
      }

      return this.commit('Nạp CSV đối chứng danh mục', `${recordsToProcess.length} sản phẩm`, () => {
        let updatedCount = 0;
        let addedCount = 0;

        recordsToProcess.forEach((rec) => {
          let p = this.data.products.find(
            (x) => x.gtin === rec.gtin || x.barcode === rec.gtin || x.name === rec.name,
          );
          if (p) {
            p.gtin = rec.gtin;
            if (rec.brand) p.brand = rec.brand;
            if (rec.name) p.name = rec.name;
            if (rec.packSize) p.packSize = rec.packSize;
            if (rec.categoryL1) p.categoryL1 = rec.categoryL1;
            if (rec.categoryL2) {
              p.categoryL2 = rec.categoryL2;
              p.category = rec.categoryL2;
            }
            if (rec.categoryL3) p.categoryL3 = rec.categoryL3;
            if (rec.price > 0) p.price = rec.price;
            if (rec.costPrice > 0) {
              p.costPrice = rec.costPrice;
              p.cost = rec.costPrice;
            }
            if (rec.vatRate >= 0) p.vatRate = rec.vatRate;
            if (rec.imageUrl) p.imageUrl = rec.imageUrl;
            p.referenceSource = {
              status: 'csv_verified',
              refUrl: rec.refUrl,
              importedAt: now(),
            };
            updatedCount++;
          } else {
            const newId = id('SP');
            const defaultCost = rec.costPrice || Math.round((rec.price || 10000) * 0.7);
            const defaultPrice = rec.price || Math.round(defaultCost / 0.7);
            const newProd = {
              id: newId,
              barcode: rec.gtin,
              gtin: rec.gtin,
              name: rec.name,
              brand: rec.brand || 'Generic',
              packSize: rec.packSize || '1 đơn vị',
              unit: 'cái',
              category: rec.categoryL2 || 'Thực phẩm',
              categoryL1: rec.categoryL1 || 'Tiêu dùng',
              categoryL2: rec.categoryL2 || 'Thực phẩm',
              categoryL3: rec.categoryL3 || '',
              price: defaultPrice,
              cost: defaultCost,
              costPrice: defaultCost,
              stock: 50,
              damagedStock: 0,
              icon: '📦',
              supplierId: this.data.suppliers[0]?.id || 'NCC001',
              minStock: 15,
              vatRate: rec.vatRate || 10,
              nearExpiryDays: 20,
              nearExpiryDiscountPercent: 25,
              batchCode: `LO-${now().slice(0, 10).replace(/-/g, '')}-NEW`,
              mfgDate: now().slice(0, 10),
              expiryDate: new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10),
              imageUrl: rec.imageUrl || 'assets/images/products/default.jpg',
              batches: [
                {
                  id: `BAT-${newId}-001`,
                  productId: newId,
                  batchCode: `LO-${now().slice(0, 10).replace(/-/g, '')}-NEW`,
                  mfgDate: now().slice(0, 10),
                  expiryDate: new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10),
                  costPrice: defaultCost,
                  initialQty: 50,
                  remainingQty: 50,
                  status: 'active',
                  receivedAt: now(),
                  supplierId: this.data.suppliers[0]?.id || 'NCC001',
                },
              ],
              inNearExpiryPromo: false,
              active: true,
              createdAt: now(),
              referenceSource: {
                status: 'csv_verified',
                refUrl: rec.refUrl,
                importedAt: now(),
              },
            };
            this.data.products.push(newProd);
            if (this.data.batches) this.data.batches.push(...newProd.batches);
            addedCount++;
          }
        });

        return { totalProcessed: recordsToProcess.length, updatedCount, addedCount };
      });
    },

    upsert(type, values) {
      const permission = {
        products: 'products',
        suppliers: 'suppliers',
        customers: 'customers',
        staff: 'staff',
      }[type];
      assert(permission, 'Danh mục không hợp lệ.');
      this.require(permission);
      if (type === 'products') this.admin();
      const collection = this.data[type],
        existing = values.id ? collection.find((x) => x.id === values.id) : null;
      assert(!values.id || existing, 'Bản ghi không tồn tại.');
      assert(values.name?.trim(), 'Vui lòng nhập tên.');
      let v = clone(values);
      v.name = v.name.trim();

      if (type === 'products') {
        v.price = integer(v.price, 'Giá bán');
        const costVal = v.costPrice !== undefined ? v.costPrice : v.cost;
        v.cost = v.costPrice = integer(costVal, 'Giá vốn');
        v.minStock = integer(v.minStock, 'Ngưỡng cảnh báo');
        assert(v.category?.trim() && v.barcode?.trim(), 'Nhập danh mục và mã vạch.');
        assert(
          !collection.some((p) => p.id !== v.id && p.barcode === v.barcode.trim()),
          'Mã vạch đã tồn tại.',
        );
        const supp = this.data.suppliers.find((s) => s.id === v.supplierId);
        assert(
          supp && (supp.active || existing?.supplierId === supp.id),
          'Nhà cung cấp không hoạt động.',
        );
        v.barcode = v.barcode.trim();
        if (v.batchCode !== undefined) v.batchCode = String(v.batchCode).trim();
        if (v.imageUrl !== undefined) v.imageUrl = String(v.imageUrl).trim();
        if (v.mfgDate && v.expiryDate) {
          assert(v.expiryDate > v.mfgDate, 'Hạn sử dụng phải sau ngày sản xuất.');
        }

        // Schema extensions
        if (v.gtin !== undefined) v.gtin = String(v.gtin).trim();
        else if (!existing) v.gtin = v.barcode;

        if (v.brand !== undefined) v.brand = String(v.brand).trim();
        if (v.packSize !== undefined) v.packSize = String(v.packSize).trim();
        if (v.unit !== undefined) v.unit = String(v.unit).trim();
        if (v.categoryL1 !== undefined) v.categoryL1 = String(v.categoryL1).trim();
        if (v.categoryL2 !== undefined) v.categoryL2 = String(v.categoryL2).trim();
        if (v.categoryL3 !== undefined) v.categoryL3 = String(v.categoryL3).trim();
        if (v.vatRate !== undefined) v.vatRate = Number(v.vatRate);
        if (v.nearExpiryDays !== undefined) v.nearExpiryDays = Number(v.nearExpiryDays);
        if (v.nearExpiryDiscountPercent !== undefined)
          v.nearExpiryDiscountPercent = Number(v.nearExpiryDiscountPercent);

        if (!existing) {
          v.stock = integer(v.stock, 'Tồn đầu kỳ');
          v.batches = [
            {
              id: id('BAT'),
              productId: '',
              batchCode: v.batchCode || `LO-${now().slice(0, 10).replace(/-/g, '')}`,
              mfgDate: v.mfgDate || now().slice(0, 10),
              expiryDate: v.expiryDate || new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10),
              costPrice: v.costPrice,
              initialQty: v.stock,
              remainingQty: v.stock,
              status: 'active',
              receivedAt: now(),
              supplierId: v.supplierId,
            },
          ];
        } else {
          delete v.stock;
        }
      }

      if (type === 'customers') {
        assert(/^\+?[\d\s().-]{8,18}$/.test(v.phone), 'Số điện thoại không hợp lệ.');
        assert(
          !collection.some(
            (c) => c.id !== v.id && c.phone.replace(/\D/g, '') === v.phone.replace(/\D/g, ''),
          ),
          'Số điện thoại khách hàng đã tồn tại.',
        );
      }

      if (type === 'staff') {
        assert(ROLES[v.role], 'Vai trò không hợp lệ.');
        assert(
          /^[a-zA-Z0-9_.-]{3,40}$/.test(v.username),
          'Tên đăng nhập gồm 3–40 ký tự, không dấu và không có khoảng trắng.',
        );
        assert(
          !collection.some((u) => u.id !== v.id && u.username === v.username),
          'Tên đăng nhập đã tồn tại.',
        );
        if (!existing || v.password)
          assert(v.password?.length >= 6, 'Mật khẩu cần tối thiểu 6 ký tự.');
        else delete v.password;
        assert(
          v.id !== this.userId || (v.active && v.role === 'ADMIN'),
          'Không thể khóa hoặc hạ quyền tài khoản đang sử dụng.',
        );
        assert(
          !(existing?.role === 'ADMIN' && (!v.active || v.role !== 'ADMIN')) ||
            collection.some((s) => s.id !== v.id && s.role === 'ADMIN' && s.active),
          'Cần giữ ít nhất một quản trị viên hoạt động.',
        );
      }

      return this.commit(existing ? 'Cập nhật thông tin' : 'Thêm mới', v.name, () => {
        if (existing) {
          Object.assign(existing, v);
          return existing;
        }
        const prefix = { products: 'SP', suppliers: 'NCC', customers: 'KH', staff: 'NV' }[type];
        const record = { ...v, id: id(prefix), createdAt: now() };
        if (type === 'products' && record.batches && record.batches[0]) {
          record.batches[0].productId = record.id;
          if (this.data.batches) this.data.batches.push(...record.batches);
        }
        collection.push(record);
        if (type === 'products' && v.stock)
          this.data.movements.unshift({
            id: id('GD'),
            time: now(),
            productId: record.id,
            productName: record.name,
            delta: v.stock,
            balance: v.stock,
            reason: 'Tồn đầu kỳ',
            reference: record.id,
            actor: this.user.name,
          });
        return record;
      });
    },

    toggleNearDatePromo(productId) {
      this.require('products');
      return this.commit('Cập nhật khuyến mãi cận date', productId, () => {
        const p = this.data.products.find((x) => x.id === productId);
        assert(p, 'Sản phẩm không tồn tại.');
        const exp = getExpiryInfo(p.expiryDate);
        assert(exp.status === 'near_expiry', 'Sản phẩm không nằm trong diện cận date.');
        p.inNearExpiryPromo = !p.inNearExpiryPromo;
        let promo = this.data.promotions?.find((pr) => pr.id === 'promo-neardate');
        if (promo) {
          if (!Array.isArray(promo.productIds)) promo.productIds = [];
          if (p.inNearExpiryPromo) {
            if (!promo.productIds.includes(p.id)) promo.productIds.push(p.id);
          } else {
            promo.productIds = promo.productIds.filter((id) => id !== p.id);
          }
        }
        return p;
      });
    },

    applyAllNearDatePromo() {
      this.require('products');
      return this.commit('Áp dụng xả kho toàn bộ cận date', 'Tất cả SP cận date', () => {
        let count = 0;
        let promo = this.data.promotions?.find((pr) => pr.id === 'promo-neardate');
        if (!promo) {
          promo = {
            id: 'promo-neardate',
            code: 'XACANDATE35',
            name: 'Flash Sale Xả Kho Cận Date (-35%)',
            type: 'percent',
            value: 35,
            minOrderAmount: 0,
            maxDiscount: 500000,
            nearExpiryOnly: true,
            productIds: [],
            active: true,
          };
          if (!this.data.promotions) this.data.promotions = [];
          this.data.promotions.push(promo);
        }
        if (!Array.isArray(promo.productIds)) promo.productIds = [];
        this.data.products.forEach((p) => {
          const exp = getExpiryInfo(p.expiryDate);
          if (exp.status === 'near_expiry') {
            p.inNearExpiryPromo = true;
            if (!promo.productIds.includes(p.id)) promo.productIds.push(p.id);
            count++;
          }
        });
        return count;
      });
    },
  };

  if (typeof module !== 'undefined' && module.exports)
    module.exports = { ...methods, getExpiryInfo, isValidEan13 };
  else {
    (scope.Retail.storeModules || (scope.Retail.storeModules = {})).catalog = methods;
    scope.Retail.getExpiryInfo = getExpiryInfo;
    scope.Retail.isValidEan13 = isValidEan13;
  }
})(globalThis);
