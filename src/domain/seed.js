(function (scope) {
  'use strict';
  const { clone, now, id } =
    typeof module !== 'undefined' && module.exports ? require('./config.js') : scope.Retail;
  const { totals } =
    typeof module !== 'undefined' && module.exports ? require('./calculations.js') : scope.Retail;
  const catalogData =
    typeof module !== 'undefined' && module.exports
      ? require('./catalog-data.js')
      : {
          CATALOG_CATEGORIES: scope.CATALOG_CATEGORIES || [],
          CATALOG_SUPPLIERS: scope.CATALOG_SUPPLIERS || [],
          CATALOG_PRODUCTS: scope.CATALOG_PRODUCTS || [],
        };

  // === EAN-13 helper (GS1 Modulo-10) ===
  function calcEan13CheckDigit(digits12) {
    const sum = String(digits12)
      .slice(0, 12)
      .split('')
      .reduce((acc, d, i) => acc + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
    return (10 - (sum % 10)) % 10;
  }

  const CATEGORY_ICON = {
    DM01: '🥛',
    DM02: '🥤',
    DM03: '🍜',
    DM04: '🌾',
    DM05: '🫒',
    DM06: '🥫',
    DM07: '🍪',
    DM08: '❄️',
    DM09: '🧴',
    DM10: '🧼',
    DM11: '🧹',
    DM12: '🍼',
    DM13: '🍱',
    DM14: '🛍️',
  };

  function seed() {
    const SEED_BASE_DATE = new Date().toISOString().slice(0, 10);
    const dateOffset = (days) => {
      const d = new Date();
      d.setDate(d.getDate() + days);
      return d.toISOString().slice(0, 10);
    };

    const categories = (catalogData.CATALOG_CATEGORIES || []).map((c) => ({
      code: c.code,
      name: c.name,
      description: c.description || '',
      hasExpiry: c.hasExpiry ?? 1,
      defaultMinStock: c.defaultMinStock ?? 15,
      defaultWarnDays: c.defaultWarnDays ?? 14,
      nonReturnable: c.nonReturnable ?? 0,
    }));

    const suppliers = (catalogData.CATALOG_SUPPLIERS || []).map((s) => ({
      id: s.id,
      name: s.name,
      phone: s.phone,
      email: s.email || '',
      address: s.address || s.areas || 'TP. HCM',
      category: s.category || '',
      areas: s.areas || 'TP. HCM',
      paymentTermsDays: s.paymentTermsDays ?? 30,
      active: s.active !== false,
    }));

    const products = (catalogData.CATALOG_PRODUCTS || []).map((item, i) => {
      const expiryOffset = Number(item.expiryOffsetDays ?? 180);
      const shelfLife = Number(item.shelfLifeDays ?? Math.max(180, expiryOffset + 60));
      const expiryDate = item.hasExpiry === 0 ? '' : dateOffset(expiryOffset);
      const mfgDate = item.hasExpiry === 0 ? '' : dateOffset(expiryOffset - shelfLife);
      const nearDays = Number(item.expiryWarnDays || 14);
      const isNear = item.hasExpiry !== 0 && expiryOffset > 0 && expiryOffset <= 30;
      const batchCode = `LO-${SEED_BASE_DATE.slice(0, 7).replace('-', '')}-${String(i + 1).padStart(3, '0')}`;
      const batches = [
        {
          id: `BAT-SEED-${String(i + 1).padStart(3, '0')}`,
          productId: item.id,
          batchCode,
          mfgDate,
          expiryDate,
          costPrice: item.cost,
          initialQty: item.stock,
          remainingQty: item.stock,
          status: item.hasExpiry !== 0 && expiryOffset <= 0 ? 'expired_quarantined' : 'active',
          receivedAt: SEED_BASE_DATE,
          supplierId: item.supplierId,
        },
      ];

      return {
        id: item.id,
        sku: item.sku || item.id,
        barcode: item.barcode,
        gtin: item.gtin || item.barcode,
        name: item.name,
        brand: item.brand || '',
        packSize: item.packSize || '',
        unit: item.unit || 'cái',
        category: item.categoryName,
        categoryCode: item.categoryCode,
        categoryL1: item.categoryName,
        categoryL2: item.categoryName,
        categoryL3: item.brand || item.categoryName,
        price: item.price,
        cost: item.cost,
        costPrice: item.cost,
        stock: item.stock,
        damagedStock: 0,
        icon: CATEGORY_ICON[item.categoryCode] || '📦',
        supplierId: item.supplierId,
        minStock: item.minStock ?? 15,
        vatRate: item.categoryCode === 'DM01' || item.categoryCode === 'DM04' ? 5 : 10,
        hasExpiry: item.hasExpiry ?? 1,
        expiryWarnDays: nearDays,
        nearExpiryDays: nearDays,
        nearExpiryDiscountPercent: expiryOffset <= 10 ? 35 : 25,
        nonReturnable: item.nonReturnable ?? 0,
        caseUnitName: item.caseUnitName || 'Thùng',
        unitsPerCase: item.unitsPerCase || 12,
        expiryOffsetDays: expiryOffset,
        shelfLifeDays: shelfLife,
        batchCode,
        mfgDate,
        expiryDate,
        imageUrl: item.imageUrl,
        thumbUrl: item.thumbUrl || item.imageUrl,
        batches,
        inNearExpiryPromo: isNear,
        active: true,
        createdAt: now(),
        referenceSource: { status: 'verified_retail_catalog' },
      };
    });

    const customers = [
      { id: 'KH001', name: 'Nguyễn Minh Anh', phone: '0903123458', email: 'minhanh@example.com' },
      { id: 'KH002', name: 'Trần Thị Lan', phone: '0918234567', email: 'lan.tran@example.com' },
      { id: 'KH003', name: 'Phạm Quốc Huy', phone: '0932876543', email: 'huy.pham@example.com' },
      { id: 'KH004', name: 'Lê Ngọc Hà', phone: '0987111222', email: 'ha.le@example.com' },
      { id: 'KH005', name: 'Đỗ Hoàng Phúc', phone: '0909555666', email: 'phuc.do@example.com' },
      { id: 'KH006', name: 'Võ Thị Thu Thảo', phone: '0977888999', email: 'thao.vo@example.com' },
    ].map((c) => ({ ...c, active: true, createdAt: now() }));

    const state = {
      schema: 2,
      revision: 0,
      settings: {
        name: 'RetailFlow — Chi nhánh chính',
        phone: '028 3822 3456',
        address: '123 Nguyễn Thị Minh Khai, Quận 3, TP. HCM',
        taxRate: 0,
        bank: 'Vietcombank',
        bankAccount: '0123456789',
        bankOwner: 'CUA HANG RETAILFLOW',
        receiptNote: 'Cảm ơn quý khách đã mua sắm tại RetailFlow. Hẹn gặp lại!',
      },
      categories,
      products,
      batches: products.flatMap((p) => p.batches || []),
      customers,
      suppliers,
      staff: [
        { id: 'NV001', name: 'Lê Hoàng Nam', username: 'admin', password: '123456', role: 'ADMIN', active: true },
        { id: 'NV002', name: 'Nguyễn Hà Linh', username: 'nhanvien', password: '123456', role: 'CASHIER', active: true },
        { id: 'NV003', name: 'Trần Quốc Bảo', username: 'kho', password: '123456', role: 'WAREHOUSE', active: true },
      ],
      orders: [],
      returns: [],
      purchases: [],
      movements: [],
      audits: [],
      held: [],
      promotions: [
        {
          id: 'promo-neardate',
          code: 'XACANDATE35',
          name: 'Xả Kho Hàng Cận Date - Giảm 35%',
          badgeText: '-35% XẢ CẬN DATE',
          type: 'percent',
          value: 35,
          minOrderAmount: 0,
          maxDiscount: 500000,
          nearExpiryOnly: true,
          productIds: products.filter((p) => p.inNearExpiryPromo).map((p) => p.id),
          active: true,
        },
        {
          id: 'promo-cuoituan',
          code: 'CUOITUAN10',
          name: 'Ưu Đãi Cuối Tuần - Giảm 10%',
          badgeText: '-10% CUỐI TUẦN',
          type: 'percent',
          value: 10,
          minOrderAmount: 150000,
          maxDiscount: 50000,
          nearExpiryOnly: false,
          productIds: [],
          active: true,
        },
        {
          id: 'promo-combo',
          code: 'COMBO25K',
          name: 'Combo Tiện Lợi - Giảm 25.000đ',
          badgeText: '-25K COMBO',
          type: 'fixed',
          value: 25000,
          minOrderAmount: 250000,
          maxDiscount: 25000,
          nearExpiryOnly: false,
          productIds: [],
          active: true,
        },
        {
          id: 'promo-fmcg',
          code: 'TIEUDUNG15',
          name: 'Tuần Lễ Hàng Tiêu Dùng - Giảm 15%',
          badgeText: '-15% FMCG',
          type: 'percent',
          value: 15,
          minOrderAmount: 300000,
          maxDiscount: 80000,
          nearExpiryOnly: false,
          productIds: [],
          active: true,
        },
      ],
      vouchers: [
        { id: 'vouch-app15k', code: 'APP15K', name: 'Voucher Khách Mới App (-15k)', type: 'fixed', value: 15000, minOrderAmount: 100000, maxDiscount: 15000, active: true },
        { id: 'vouch-app30k', code: 'APP30K', name: 'Voucher Đơn Lớn Tiện Lợi (-30k)', type: 'fixed', value: 30000, minOrderAmount: 220000, maxDiscount: 30000, active: true },
        { id: 'vouch-sieuthi10', code: 'SIEUTHI10', name: 'Voucher Siêu Thị Tiện Lợi (-10%)', type: 'percent', value: 10, minOrderAmount: 150000, maxDiscount: 30000, active: true },
        { id: 'vouch-banmoi20k', code: 'BANMOI20K', name: 'Voucher Bạn Mới 20k (-20k)', type: 'fixed', value: 20000, minOrderAmount: 120000, maxDiscount: 20000, active: true },
        { id: 'vouch-vip50k', code: 'VIP50K', name: 'Voucher VIP Circle (-50k)', type: 'fixed', value: 50000, minOrderAmount: 400000, maxDiscount: 50000, active: true },
      ],
      draft: { items: [], customerId: '', discount: 0, promotionId: null, voucherId: null, note: '', demographic: 'Không ghi nhận' },
      branches: [
        {
          id: 'CN001',
          name: 'Chi nhánh chính',
          address: '123 Nguyễn Thị Minh Khai, Quận 3, TP. HCM',
          area: 'TP. HCM',
          warehouse: 'Kho chính',
          supplierIds: suppliers.map((s) => s.id),
          status: 'active',
        },
      ],
      logs: [],
    };

    for (let d = 6; d >= 0; d--) {
      for (let j = 0; j < 4; j++) {
        const date = new Date();
        date.setDate(date.getDate() - d);
        date.setHours(8 + j * 3, 15 + j * 7, 0, 0);
        const indexes = [(d + j) % 9, (d + j + 3) % 9];
        const items = indexes.map((n, k) => {
          const p = products[n];
          return {
            id: p.id,
            name: p.name,
            price: p.price,
            cost: p.cost,
            category: p.category,
            icon: p.icon,
            qty: k ? 1 : 2,
            returnedQty: 0,
          };
        });
        const t = totals(items);
        items.forEach((i) => (i.paidTotal = i.price * i.qty));
        state.orders.push({
          id: `HD-DEMO-${String(28 - d * 4 + j).padStart(3, '0')}`,
          time: date.toISOString(),
          ...t,
          items,
          customerId: customers[j].id,
          customer: customers[j].name,
          payment: ['cash', 'transfer', 'card'][j % 3],
          received: t.total,
          change: 0,
          status: 'completed',
          staffId: 'NV002',
          staffName: 'Nguyễn Hà Linh',
          note: 'Đơn hàng mẫu',
          demographic: 'Không ghi nhận',
          paymentRef: 'DEMO',
          store: clone(state.settings),
          branchId: 'CN001',
        });
      }
    }
    state.orders.sort((a, b) => b.time.localeCompare(a.time));
    state.logs.push({
      id: id('LOG'),
      time: now(),
      actor: 'Hệ thống',
      action: 'Khởi tạo dữ liệu mẫu',
      detail: `${products.length} sản phẩm · ${categories.length} danh mục · ${suppliers.length} NCC · Product+Batch FEFO`,
    });
    return state;
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { seed, calcEan13CheckDigit };
  else {
    scope.Retail.seed = seed;
    scope.Retail.calcEan13CheckDigit = calcEan13CheckDigit;
  }
})(globalThis);
