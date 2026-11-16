(function (scope) {
  'use strict';
  const { clone, now, id } =
    typeof module !== 'undefined' && module.exports ? require('./config.js') : scope.Retail;
  const { totals } =
    typeof module !== 'undefined' && module.exports ? require('./calculations.js') : scope.Retail;
  function seed() {
    const raw = [
      ['Sữa tươi Vinamilk 1L', 'Sữa & chế phẩm', 36000, 154, '🥛', 'NCC001'],
      ['Mì Hảo Hảo tôm chua cay', 'Thực phẩm khô', 4500, 468, '🍜', 'NCC002'],
      ['Dầu ăn Simply 1L', 'Gia vị', 53000, 12, '🫒', 'NCC003'],
      ['Nước suối Aquafina 500ml', 'Đồ uống', 7000, 356, '💧', 'NCC003'],
      ['Bánh Oreo 133g', 'Bánh kẹo', 20500, 36, '🍪', 'NCC002'],
      ['Cà phê G7 hộp 20 gói', 'Đồ uống', 64000, 8, '☕', 'NCC003'],
      ['Gạo ST25 túi 5kg', 'Thực phẩm khô', 195000, 27, '🌾', 'NCC002'],
      ['Nước rửa chén Sunlight', 'Hóa mỹ phẩm', 35000, 14, '🧴', 'NCC003'],
      ['Khăn giấy Tempo', 'Gia dụng', 25500, 128, '🧻', 'NCC003'],
      ['Bánh Mì Que Pate Peak', 'Đồ ăn', 19000, 45, '🥖', 'NCC002'],
      ['Cơm Tấm Sườn Nướng 7-E', 'Đồ ăn', 42000, 32, '🍱', 'NCC002'],
      ['Sandwich Trứng Mayonnaise', 'Đồ ăn', 25000, 28, '🥪', 'NCC002'],
      ['Bao Tử Cá Cay Chuẩn Vị', 'Đồ ăn', 35000, 22, '🍢', 'NCC002'],
      ['Trà Tắc Xí Muội Mát Lạnh', 'Trà tắc series', 18000, 60, '🍋', 'NCC003'],
      ['Trà Tắc Mật Khổng Lồ', 'Trà tắc series', 22000, 40, '🍹', 'NCC003'],
      ['Cà Phê Sữa Đá 7-Select', 'Cà phê', 20000, 55, '🧋', 'NCC003'],
      ['Cà Phê Đen Đá Nguyên Chất', 'Cà phê', 16000, 50, '☕', 'NCC003'],
      ['Matcha Latte Đá Sữa Tươi', 'Matcha', 32000, 35, '🍵', 'NCC001'],
      ['Trà Sữa Trân Châu Ô Long', 'Trà sữa', 28000, 40, '🧋', 'NCC001'],
      ['Bánh Bao Nhân Thịt Trứng Cút', 'Món nóng', 16000, 26, '🥟', 'NCC002'],
      ['In Ảnh Photobooth Khung 7E', 'Photobooth', 50000, 100, '📷', 'NCC003'],
      ['Cà phê Cốt Dừa', 'Đồ uống', 35000, 45, '🥥', 'NCC001'],
      ['Trà Sữa Oolong', 'Đồ uống', 42000, 30, '🧋', 'NCC001'],
      ['Trà Đào Sả', 'Đồ uống', 38000, 25, '🍑', 'NCC001'],
      ['Bánh Mì Que Hải Phòng', 'Đồ ăn vặt', 15000, 80, '🥖', 'NCC002'],
      ['Snack Khoai Tây', 'Đồ ăn vặt', 18000, 50, '🥔', 'NCC002'],
      ['Khô Gà Bơ Tỏi', 'Đồ ăn vặt', 45000, 20, '🍗', 'NCC002'],
      ['Khăn Giấy Ướt Cao Cấp', 'Gia dụng', 22000, 120, '🧻', 'NCC003'],
      ['Nước Rửa Tay Diệt Khuẩn', 'Gia dụng', 35000, 40, '🧼', 'NCC003'],
    ];
    const products = raw.map((r, i) => ({
      id: `SP${String(i + 1).padStart(3, '0')}`,
      barcode: `8935000${String(i + 1).padStart(6, '0')}`,
      name: r[0],
      category: r[1],
      price: r[2],
      cost: Math.round(r[2] * 0.7),
      stock: r[3],
      icon: r[4],
      supplierId: r[5],
      minStock: 15,
      active: true,
      createdAt: now(),
    }));
    const customers = [
      { id: 'KH001', name: 'Nguyễn Minh Anh', phone: '0903123458', email: 'minhanh@example.com' },
      { id: 'KH002', name: 'Trần Thị Lan', phone: '0918234567', email: '' },
      { id: 'KH003', name: 'Phạm Quốc Huy', phone: '0932876543', email: '' },
      { id: 'KH004', name: 'Lê Ngọc Hà', phone: '0987111222', email: '' },
    ].map((c) => ({ ...c, active: true, createdAt: now() }));
    const state = {
      schema: 1,
      revision: 0,
      settings: {
        name: 'RetailFlow — Chi nhánh chính',
        phone: '028 3822 3456',
        address: '123 Nguyễn Thị Minh Khai, Quận 3, TP. HCM',
        taxRate: 0,
        bank: 'Vietcombank',
        bankAccount: '0123456789',
        bankOwner: 'CUA HANG RETAILFLOW',
        receiptNote: 'Cảm ơn bạn đã mua sắm. Hẹn gặp lại!',
      },
      products,
      customers,
      suppliers: [
        {
          id: 'NCC001',
          name: 'Vinamilk Việt Nam',
          phone: '02838231111',
          category: 'Sữa & chế phẩm',
          areas: 'TP. HCM, Bình Dương',
          active: true,
        },
        {
          id: 'NCC002',
          name: 'Acecook Việt Nam',
          phone: '02837502000',
          category: 'Thực phẩm khô, đồ ăn',
          areas: 'TP. HCM, Đồng Nai',
          active: true,
        },
        {
          id: 'NCC003',
          name: 'Nhà phân phối An Phú',
          phone: '02839202200',
          category: 'Gia vị, đồ uống, gia dụng',
          areas: 'TP. HCM',
          active: true,
        },
      ],
      staff: [
        {
          id: 'NV001',
          name: 'Lê Hoàng Nam',
          username: 'admin',
          password: '123456',
          role: 'ADMIN',
          active: true,
        },
        {
          id: 'NV002',
          name: 'Nguyễn Hà Linh',
          username: 'nhanvien',
          password: '123456',
          role: 'CASHIER',
          active: true,
        },
        {
          id: 'NV003',
          name: 'Trần Quốc Bảo',
          username: 'kho',
          password: '123456',
          role: 'WAREHOUSE',
          active: true,
        },
      ],
      orders: [],
      returns: [],
      purchases: [],
      movements: [],
      audits: [],
      held: [],
      draft: { items: [], customerId: '', discount: 0, note: '', demographic: 'Không ghi nhận' },
      branches: [
        {
          id: 'CN001',
          name: 'Chi nhánh chính',
          address: '123 Nguyễn Thị Minh Khai, Quận 3, TP. HCM',
          area: 'TP. HCM',
          warehouse: 'Kho chính',
          supplierIds: ['NCC001', 'NCC002', 'NCC003'],
          status: 'active',
        },
      ],
      logs: [],
    };
    // A consistent example history: amounts are calculated from actual line items.
    for (let d = 6; d >= 0; d--)
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
    state.orders.sort((a, b) => b.time.localeCompare(a.time));
    state.logs.push({
      id: id('LOG'),
      time: now(),
      actor: 'Hệ thống',
      action: 'Khởi tạo dữ liệu mẫu',
      detail: '29 sản phẩm · 28 hóa đơn mẫu',
    });
    return state;
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { seed };
  else scope.Retail.seed = seed;
})(globalThis);
