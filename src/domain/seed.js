(function (scope) {
  'use strict';
  const { clone, now, id } =
    typeof module !== 'undefined' && module.exports ? require('./config.js') : scope.Retail;
  const { totals } =
    typeof module !== 'undefined' && module.exports ? require('./calculations.js') : scope.Retail;

  // === EAN-13 helper (GS1 Modulo-10) ===
  function calcEan13CheckDigit(digits12) {
    const sum = String(digits12)
      .slice(0, 12)
      .split('')
      .reduce((acc, d, i) => acc + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
    return (10 - (sum % 10)) % 10;
  }
  function makeEan13(prefix9) {
    // prefix9 = first 9 digits (3 country + 4 company + 2 product prefix)
    // We'll embed a 3-digit sequential index as digits 10-12 and compute check digit
    // Actually we build full 12 digit from prefix9 + 3-digit seq, then compute check
    const d12 = String(prefix9).padStart(12, '0').slice(0, 12);
    return d12 + calcEan13CheckDigit(d12);
  }
  // VN prefix 893, Acecook: 8934607, Mondelez: 8934588, Orion: 8934694, PepsiCo: 8934673,
  // Masan: 8934742, Nestle: 8934585, TH TrueMilk: 8935086, Vinamilk: 8934543,
  // Unilever: 8935001, BioAmicus/Vifon: 8935062, Generic CVS: 8935000
  function seed() {
    const SEED_BASE_DATE = new Date().toISOString().slice(0, 10);
    const dateOffset = (days) => {
      const d = new Date();
      d.setDate(d.getDate() + days);
      return d.toISOString().slice(0, 10);
    };

    // Supplier ID map
    const S = {
      VINAMILK: 'NCC001',
      ACECOOK: 'NCC002',
      MASAN: 'NCC003',
      MONDELEZ: 'NCC004',
      NESTLE: 'NCC005',
      TH: 'NCC006',
      UNILEVER: 'NCC007',
      PEPSICO: 'NCC008',
      LOCTRO: 'NCC009',
      BEPCH: 'NCC010',
    };

    // raw columns:
    // [name, category, price, stock, icon, supplierId,
    //  expiryOffsetDays, shelfLifeDays, imageUrl,
    //  brand, packSize, unit, catL1, catL2, catL3, vatRate, nearExpiryDays, nearExpiryDiscount%, ean12prefix]
    // expiryOffsetDays < 0 → expired; 0–nearExpiryDays → near_expiry; > nearExpiryDays → valid
    // costPrice computed per-group realistic margin below
    const raw = [
      // ─────────────────────────────────────────────────────────────────────
      // 9 sản phẩm đầu tương thích nghiệp vụ cốt lõi & bài test (giữ nguyên order/ID)
      // ─────────────────────────────────────────────────────────────────────
      // SP001
      ['Sữa tươi Vinamilk 1L', 'Sữa & Đồ uống', 36000, 154, '🥛', S.VINAMILK,
        120, 180, 'assets/images/products/milk_vinamilk.jpg',
        'Vinamilk', '1L', 'hộp', 'Thực phẩm', 'Sữa & Chế phẩm', 'Sữa tươi tiệt trùng', 5, 10, 25, '893454300001'],
      // SP002
      ['Mì Hảo Hảo tôm chua cay 75g', 'Mì & Thực phẩm tiện lợi', 4500, 290, '🍜', S.ACECOOK,
        180, 240, 'assets/images/products/haohao_shrimp.jpg',
        'Hảo Hảo', '75g', 'gói', 'Thực phẩm', 'Mì ăn liền', 'Mì vị tôm', 10, 14, 30, '893460700001'],
      // SP003
      ['Dầu ăn Simply 1L', 'Gia vị & Nhu yếu phẩm', 53000, 12, '🫒', S.MASAN,
        365, 720, 'assets/images/products/oil_simply.jpg',
        'Simply', '1L', 'chai', 'Thực phẩm', 'Dầu ăn & Gia vị', 'Dầu đậu nành', 10, 20, 25, '893474200001'],
      // SP004
      ['Nước suối Aquafina 500ml', 'Sữa & Đồ uống', 7000, 260, '💧', S.PEPSICO,
        365, 720, 'assets/images/products/water_aquafina.jpg',
        'Aquafina', '500ml', 'chai', 'Đồ uống', 'Nước tinh khiết', 'Nước đóng chai', 10, 20, 20, '893467300001'],
      // SP005
      ['Bánh Oreo kem vani 133g', 'Snack & Bánh kẹo', 20500, 180, '🍪', S.MONDELEZ,
        240, 365, 'assets/images/products/oreo_vanilla.jpg',
        'Oreo', '133g', 'gói', 'Thực phẩm', 'Bánh kẹo', 'Bánh quy sandwich', 10, 20, 25, '893458800001'],
      // SP006
      ['Cà phê G7 hòa tan hộp 20 gói', 'Sữa & Đồ uống', 64000, 8, '☕', S.MASAN,
        180, 240, 'assets/images/products/coffee_g7_20s.jpg',
        'G7', '20 gói×16g', 'hộp', 'Đồ uống', 'Cà phê hòa tan', 'Cà phê 3in1', 10, 15, 20, '893474200002'],
      // SP007
      ['Gạo thơm ST25 túi 5kg', 'Mì & Thực phẩm tiện lợi', 195000, 85, '🌾', S.LOCTRO,
        365, 540, 'assets/images/products/rice_st25.jpg',
        'ST25', '5kg', 'túi', 'Thực phẩm', 'Gạo & Ngũ cốc', 'Gạo thơm cao cấp', 5, 20, 20, '893500000007'],
      // SP008 — Sunlight chai 750g (tách khỏi SP082 túi 1.4kg)
      ['Nước rửa chén Sunlight chanh 750g', 'Chăm sóc cá nhân & Tiện ích', 31000, 14, '🧴', S.MASAN,
        720, 1000, 'assets/images/products/dish_sunlight.jpg',
        'Sunlight', '750g', 'chai', 'Hóa mỹ phẩm', 'Vệ sinh bếp', 'Nước rửa chén', 10, 30, 15, '893500100001'],
      // SP009
      ['Khăn giấy Pulppy 2 lớp 180 tờ', 'Chăm sóc cá nhân & Tiện ích', 24000, 128, '🧻', S.MASAN,
        1000, 1500, 'assets/images/products/tissue_pulppy.jpg',
        'Pulppy', '180 tờ', 'hộp', 'Hóa mỹ phẩm', 'Giấy vệ sinh', 'Khăn giấy rút', 10, 30, 10, '893500100002'],

      // ─────────────────────────────────────────────────────────────────────
      // Sữa & Đồ uống mở rộng
      // ─────────────────────────────────────────────────────────────────────
      // SP010
      ['Sữa chua uống Probi vi chất 130ml', 'Sữa & Đồ uống', 9000, 85, '🧃', S.VINAMILK,
        -3, 50, 'assets/images/products/yogurt_probi.jpg',
        'Probi', '130ml', 'chai', 'Thực phẩm', 'Sữa & Chế phẩm', 'Sữa chua uống', 5, 7, 35, '893454300002'],
      // SP011
      ['Sữa tươi tiệt trùng có đường 1L', 'Sữa & Đồ uống', 36000, 140, '🥛', S.VINAMILK,
        4, 180, 'assets/images/products/milk_sweetened.jpg',
        'Vinamilk', '1L', 'hộp', 'Thực phẩm', 'Sữa & Chế phẩm', 'Sữa tươi tiệt trùng', 5, 7, 30, '893454300003'],
      // SP012
      ['Sữa tươi TH True Milk ít đường 1L', 'Sữa & Đồ uống', 38000, 125, '🥛', S.TH,
        7, 180, 'assets/images/products/milk_th.jpg',
        'TH True Milk', '1L', 'hộp', 'Thực phẩm', 'Sữa & Chế phẩm', 'Sữa tươi tiệt trùng', 5, 10, 25, '893508600001'],
      // SP013
      ['Sữa chua nha đam tự nhiên', 'Sữa & Đồ uống', 8500, 95, '🥣', S.VINAMILK,
        3, 45, 'assets/images/products/yogurt_aloe.jpg',
        'Vinamilk', '100g', 'hũ', 'Thực phẩm', 'Sữa & Chế phẩm', 'Sữa chua ăn', 5, 7, 35, '893454300004'],
      // SP014
      ['Sữa đậu nành Fami nguyên chất 200ml', 'Sữa & Đồ uống', 5500, 220, '🧃', S.VINAMILK,
        12, 180, 'assets/images/products/soy_milk.jpg',
        'Fami', '200ml', 'hộp', 'Thực phẩm', 'Sữa & Chế phẩm', 'Sữa thực vật', 5, 10, 25, '893454300005'],
      // SP015
      ['Trà xanh Không Độ chai 455ml', 'Sữa & Đồ uống', 12000, 175, '🍵', S.MASAN,
        22, 365, 'assets/images/products/green_tea.jpg',
        'Không Độ', '455ml', 'chai', 'Đồ uống', 'Trà đóng chai', 'Trà xanh', 10, 25, 20, '893474200003'],
      // SP016
      ['Sữa đặc Ông Thọ đỏ lon 380g', 'Sữa & Đồ uống', 26000, 130, '🥫', S.VINAMILK,
        240, 365, 'assets/images/products/condensed_milk.jpg',
        'Ông Thọ', '380g', 'lon', 'Thực phẩm', 'Sữa & Chế phẩm', 'Sữa đặc', 5, 20, 20, '893454300006'],
      // SP017
      ['Sữa Milo lúa mạch Nestlé hộp 180ml', 'Sữa & Đồ uống', 9500, 210, '🧃', S.NESTLE,
        180, 240, 'assets/images/products/milk_milo.jpg',
        'Milo', '180ml', 'hộp', 'Đồ uống', 'Sữa hạt & Dinh dưỡng', 'Sữa lúa mạch', 5, 15, 25, '893458500001'],
      // SP018
      ['Nước khoáng Lavie chai 500ml', 'Sữa & Đồ uống', 6500, 280, '💧', S.PEPSICO,
        365, 720, 'assets/images/products/water_lavie.jpg',
        'Lavie', '500ml', 'chai', 'Đồ uống', 'Nước khoáng', 'Nước đóng chai', 10, 20, 15, '893467300002'],
      // SP019
      ['Nước ngọt Coca-Cola lon 320ml', 'Sữa & Đồ uống', 11000, 240, '🥤', S.PEPSICO,
        270, 365, 'assets/images/products/coca_cola.jpg',
        'Coca-Cola', '320ml', 'lon', 'Đồ uống', 'Nước ngọt có gas', 'Cola', 10, 20, 15, '893467300003'],
      // SP020
      ['Nước ngọt Pepsi không calo lon 330ml', 'Sữa & Đồ uống', 11000, 230, '🥤', S.PEPSICO,
        270, 365, 'assets/images/products/pepsi_zero.jpg',
        'Pepsi', '330ml', 'lon', 'Đồ uống', 'Nước ngọt có gas', 'Cola', 10, 20, 15, '893467300004'],
      // SP021
      ['Nước ngọt 7Up lon 320ml', 'Sữa & Đồ uống', 11000, 190, '🥤', S.PEPSICO,
        270, 365, 'assets/images/products/seven_up.jpg',
        '7Up', '320ml', 'lon', 'Đồ uống', 'Nước ngọt có gas', 'Nước chanh có gas', 10, 20, 15, '893467300005'],
      // SP022
      ['Trà Ô Long Tea+ Plus chai 455ml', 'Sữa & Đồ uống', 12500, 185, '🧋', S.PEPSICO,
        200, 365, 'assets/images/products/oolong_tea.jpg',
        'Tea+', '455ml', 'chai', 'Đồ uống', 'Trà đóng chai', 'Trà ô long', 10, 20, 20, '893467300006'],
      // SP023
      ['Nước tăng lực Red Bull lon 250ml', 'Sữa & Đồ uống', 14000, 200, '⚡', S.PEPSICO,
        300, 540, 'assets/images/products/red_bull.jpg',
        'Red Bull', '250ml', 'lon', 'Đồ uống', 'Nước tăng lực', 'Năng lượng', 10, 20, 15, '893467300007'],
      // SP024
      ['Nước tăng lực Sting dâu lon 320ml', 'Sữa & Đồ uống', 11500, 215, '🍓', S.PEPSICO,
        210, 365, 'assets/images/products/sting_red.jpg',
        'Sting', '320ml', 'lon', 'Đồ uống', 'Nước tăng lực', 'Năng lượng', 10, 20, 15, '893467300008'],
      // SP025
      ['Cà phê lon Highlands Sữa đá 235ml', 'Sữa & Đồ uống', 17000, 180, '☕', S.MASAN,
        180, 240, 'assets/images/products/coffee_highlands.jpg',
        'Highlands', '235ml', 'lon', 'Đồ uống', 'Cà phê đóng chai', 'Cà phê sữa đá', 10, 15, 20, '893474200004'],

      // ─────────────────────────────────────────────────────────────────────
      // Mì ăn liền, Phở & Thực phẩm tiện lợi
      // ─────────────────────────────────────────────────────────────────────
      // SP026
      ['Mì Hảo Hảo sa tế hành 75g', 'Mì & Thực phẩm tiện lợi', 4500, 250, '🍜', S.ACECOOK,
        180, 240, 'assets/images/products/haohao_sate.jpg',
        'Hảo Hảo', '75g', 'gói', 'Thực phẩm', 'Mì ăn liền', 'Mì vị sa tế', 10, 14, 30, '893460700002'],
      // SP027
      ['Mì Omachi sườn hầm ngũ quả 80g', 'Mì & Thực phẩm tiện lợi', 9500, 210, '🍜', S.MASAN,
        180, 240, 'assets/images/products/noodles_omachi.jpg',
        'Omachi', '80g', 'gói', 'Thực phẩm', 'Mì ăn liền', 'Mì khoai tây cao cấp', 10, 14, 25, '893474200005'],
      // SP028
      ['Mì Kokomi 90 tôm chua cay', 'Mì & Thực phẩm tiện lợi', 5000, 240, '🍜', S.MASAN,
        180, 240, 'assets/images/products/noodles_kokomi.jpg',
        'Kokomi', '90g', 'gói', 'Thực phẩm', 'Mì ăn liền', 'Mì vị tôm', 10, 14, 25, '893474200006'],
      // SP029
      ['Mì xào khô Indomie Mi Goreng 85g', 'Mì & Thực phẩm tiện lợi', 6500, 200, '🍝', S.ACECOOK,
        180, 240, 'assets/images/products/noodles_indomie.jpg',
        'Indomie', '85g', 'gói', 'Thực phẩm', 'Mì ăn liền', 'Mì xào khô', 10, 14, 25, '893460700003'],
      // SP030
      ['Mì Cung Đình sườn hầm 80g', 'Mì & Thực phẩm tiện lợi', 9000, 190, '🍜', S.ACECOOK,
        180, 240, 'assets/images/products/noodles_cungdinh.jpg',
        'Cung Đình', '80g', 'gói', 'Thực phẩm', 'Mì ăn liền', 'Mì cao cấp', 10, 14, 25, '893460700004'],
      // SP031
      ['Phở Đệ Nhất bò tái gói 68g', 'Mì & Thực phẩm tiện lợi', 8500, 170, '🍲', S.ACECOOK,
        150, 240, 'assets/images/products/pho_beef.jpg',
        'Phở Đệ Nhất', '68g', 'gói', 'Thực phẩm', 'Mì ăn liền', 'Phở ăn liền', 10, 14, 25, '893460700005'],
      // SP032
      ['Miến Phú Hương sườn heo 55g', 'Mì & Thực phẩm tiện lợi', 11500, 160, '🍲', S.ACECOOK,
        150, 240, 'assets/images/products/glass_noodles.jpg',
        'Phú Hương', '55g', 'gói', 'Thực phẩm', 'Mì ăn liền', 'Miến ăn liền', 10, 14, 25, '893460700006'],
      // SP033
      ['Bún khô Ba Cây Tre 300g', 'Mì & Thực phẩm tiện lợi', 18000, 120, '🌾', S.ACECOOK,
        360, 540, 'assets/images/products/bun_dry.jpg',
        'Ba Cây Tre', '300g', 'túi', 'Thực phẩm', 'Gạo & Ngũ cốc', 'Bún khô', 10, 20, 20, '893460700007'],
      // SP034
      ['Hủ tiếu Nam Vang Vifon 65g', 'Mì & Thực phẩm tiện lợi', 9500, 150, '🍲', S.ACECOOK,
        150, 240, 'assets/images/products/hutieu_vifon_65g.jpg',
        'Vifon', '65g', 'gói', 'Thực phẩm', 'Mì ăn liền', 'Hủ tiếu ăn liền', 10, 14, 25, '893460700008'],
      // SP035
      ['Cháo sườn Vifon gói 70g', 'Mì & Thực phẩm tiện lợi', 7500, 140, '🥣', S.ACECOOK,
        150, 240, 'assets/images/products/porridge_vifon_70g.jpg',
        'Vifon', '70g', 'gói', 'Thực phẩm', 'Mì ăn liền', 'Cháo ăn liền', 10, 14, 25, '893460700009'],
      // SP036
      ['Gạo thơm Jasmine túi 5kg', 'Mì & Thực phẩm tiện lợi', 125000, 90, '🌾', S.LOCTRO,
        365, 540, 'assets/images/products/rice_jasmine_5kg.jpg',
        'Jasmine', '5kg', 'túi', 'Thực phẩm', 'Gạo & Ngũ cốc', 'Gạo thơm', 5, 20, 15, '893500000036'],
      // SP037
      ['Yến mạch nguyên chất Quaker 500g', 'Mì & Thực phẩm tiện lợi', 72000, 110, '🥣', S.PEPSICO,
        300, 365, 'assets/images/products/oats_quaker.jpg',
        'Quaker', '500g', 'hộp', 'Thực phẩm', 'Gạo & Ngũ cốc', 'Yến mạch', 5, 20, 20, '893467300009'],
      // SP038
      ['Đậu xanh tách vỏ Tài Ký 500g', 'Mì & Thực phẩm tiện lợi', 38000, 130, '🌱', S.MASAN,
        365, 540, 'assets/images/products/beans_green.jpg',
        'Tài Ký', '500g', 'túi', 'Thực phẩm', 'Gạo & Ngũ cốc', 'Đậu hạt khô', 5, 20, 15, '893474200007'],
      // SP039
      ['Nấm đông cô sấy khô 100g', 'Mì & Thực phẩm tiện lợi', 42000, 70, '🍄', S.MASAN,
        -12, 180, 'assets/images/products/mushrooms.jpg',
        'Nấm VN', '100g', 'túi', 'Thực phẩm', 'Rau củ khô', 'Nấm sấy', 5, 14, 30, '893474200008'],

      // ─────────────────────────────────────────────────────────────────────
      // Gia vị & Nhu yếu phẩm bếp
      // ─────────────────────────────────────────────────────────────────────
      // SP040
      ['Nước mắm Nam Ngư Đệ Nhị chai 900ml', 'Gia vị & Nhu yếu phẩm', 28000, 180, '🍶', S.MASAN,
        365, 720, 'assets/images/products/fish_sauce_namngu.jpg',
        'Nam Ngư', '900ml', 'chai', 'Thực phẩm', 'Nước chấm & Gia vị', 'Nước mắm', 10, 20, 15, '893474200009'],
      // SP041
      ['Nước mắm Chinsu cá hồi chai 500ml', 'Gia vị & Nhu yếu phẩm', 46000, 160, '🐟', S.MASAN,
        365, 720, 'assets/images/products/fish_sauce_chinsu.jpg',
        'Chinsu', '500ml', 'chai', 'Thực phẩm', 'Nước chấm & Gia vị', 'Nước mắm', 10, 20, 15, '893474200010'],
      // SP042
      ['Nước tương Chinsu tỏi ớt chai 330ml', 'Gia vị & Nhu yếu phẩm', 18000, 190, '🍶', S.MASAN,
        365, 720, 'assets/images/products/soy_sauce_chinsu.jpg',
        'Chinsu', '330ml', 'chai', 'Thực phẩm', 'Nước chấm & Gia vị', 'Nước tương', 10, 20, 15, '893474200011'],
      // SP043
      ['Nước tương Maggi đậm đặc chai 700ml', 'Gia vị & Nhu yếu phẩm', 32000, 170, '🍶', S.NESTLE,
        365, 720, 'assets/images/products/soy_sauce_maggi.jpg',
        'Maggi', '700ml', 'chai', 'Thực phẩm', 'Nước chấm & Gia vị', 'Nước tương', 10, 20, 15, '893458500002'],
      // SP044
      ['Hạt nêm Knorr thịt thăn heo 400g', 'Gia vị & Nhu yếu phẩm', 39000, 210, '🧂', S.UNILEVER,
        365, 540, 'assets/images/products/seasoning_knorr.jpg',
        'Knorr', '400g', 'túi', 'Thực phẩm', 'Nước chấm & Gia vị', 'Hạt nêm', 10, 20, 15, '893500100003'],
      // SP045
      ['Bột ngọt Ajinomoto túi 454g', 'Gia vị & Nhu yếu phẩm', 36000, 230, '🧂', S.NESTLE,
        720, 1000, 'assets/images/products/msg_ajinomoto.jpg',
        'Ajinomoto', '454g', 'túi', 'Thực phẩm', 'Nước chấm & Gia vị', 'Bột ngọt', 10, 30, 10, '893458500003'],
      // SP046
      ['Muối tinh sấy i-ốt 500g', 'Gia vị & Nhu yếu phẩm', 6000, 250, '🧂', S.MASAN,
        720, 1000, 'assets/images/products/salt_vifon.jpg',
        'Masan', '500g', 'gói', 'Thực phẩm', 'Nước chấm & Gia vị', 'Muối', 10, 30, 10, '893474200012'],
      // SP047
      ['Đường tinh luyện Biên Hòa 1kg', 'Gia vị & Nhu yếu phẩm', 29000, 200, '🍬', S.MASAN,
        720, 1000, 'assets/images/products/sugar_bienhoa.jpg',
        'Biên Hòa', '1kg', 'túi', 'Thực phẩm', 'Nước chấm & Gia vị', 'Đường', 10, 30, 10, '893474200013'],
      // SP048
      ['Dầu ăn Tường An Cooking Oil 1L', 'Gia vị & Nhu yếu phẩm', 48000, 190, '🫒', S.MASAN,
        500, 720, 'assets/images/products/oil_tuongan.jpg',
        'Tường An', '1L', 'chai', 'Thực phẩm', 'Dầu ăn & Gia vị', 'Dầu hỗn hợp', 10, 20, 20, '893474200014'],
      // SP049
      ['Tương ớt Chinsu chai 250g', 'Gia vị & Nhu yếu phẩm', 14500, 240, '🌶️', S.MASAN,
        300, 365, 'assets/images/products/chili_chinsu.jpg',
        'Chinsu', '250g', 'chai', 'Thực phẩm', 'Nước chấm & Gia vị', 'Tương ớt', 10, 20, 20, '893474200015'],
      // SP050
      ['Tương cà Cholimex chai 330g', 'Gia vị & Nhu yếu phẩm', 15500, 180, '🍅', S.MASAN,
        300, 365, 'assets/images/products/ketchup_cholimex.jpg',
        'Cholimex', '330g', 'chai', 'Thực phẩm', 'Nước chấm & Gia vị', 'Tương cà', 10, 20, 20, '893474200016'],
      // SP051
      ['Sốt Mayonnaise Kewpie chai 130g', 'Gia vị & Nhu yếu phẩm', 24000, 120, '🍳', S.NESTLE,
        120, 180, 'assets/images/products/mayo_kewpie.jpg',
        'Kewpie', '130g', 'chai', 'Thực phẩm', 'Nước chấm & Gia vị', 'Sốt mayonnaise', 10, 15, 25, '893458500004'],
      // SP052
      ['Giấm gạo lên men Ajinomoto 400ml', 'Gia vị & Nhu yếu phẩm', 12000, 160, '🍶', S.NESTLE,
        365, 720, 'assets/images/products/vinegar_ajinomoto_400ml.jpg',
        'Ajinomoto', '400ml', 'chai', 'Thực phẩm', 'Nước chấm & Gia vị', 'Giấm', 10, 20, 15, '893458500005'],

      // ─────────────────────────────────────────────────────────────────────
      // Snack, Bánh kẹo & Đồ ăn vặt
      // ─────────────────────────────────────────────────────────────────────
      // SP053
      ['Bánh quy Cosy mè Kinh Đô 288g', 'Snack & Bánh kẹo', 32000, 140, '🍪', S.MONDELEZ,
        20, 365, 'assets/images/products/biscuits_cosy.jpg',
        'Cosy', '288g', 'hộp', 'Thực phẩm', 'Bánh kẹo', 'Bánh quy giòn', 10, 25, 25, '893458800002'],
      // SP054
      ['Bánh quy bơ Danisa hộp thiếc 454g', 'Snack & Bánh kẹo', 135000, 65, '🍪', S.MONDELEZ,
        365, 540, 'assets/images/products/danisa_butter.jpg',
        'Danisa', '454g', 'hộp', 'Thực phẩm', 'Bánh kẹo', 'Bánh quy bơ', 10, 25, 20, '893458800003'],
      // SP055
      ['Bánh ChocoPie Orion hộp 12 cái', 'Snack & Bánh kẹo', 56000, 130, '🥧', S.MONDELEZ,
        15, 365, 'assets/images/products/chocopie_orion.jpg',
        'Orion', '12 cái×30g', 'hộp', 'Thực phẩm', 'Bánh kẹo', 'Bánh xốp nhân kem', 10, 20, 25, '893458800004'],
      // SP056
      ['Bánh bông lan Custas kem trứng 6 cái', 'Snack & Bánh kẹo', 32000, 110, '🧁', S.MONDELEZ,
        60, 180, 'assets/images/products/custas_cake.jpg',
        'Custas', '6 cái×35g', 'hộp', 'Thực phẩm', 'Bánh kẹo', 'Bánh bông lan', 10, 20, 25, '893458800005'],
      // SP057
      ['Bánh snack khoai tây O\'Star rong biển', 'Snack & Bánh kẹo', 13500, 190, '🥔', S.MONDELEZ,
        25, 180, 'assets/images/products/chips_ostar.jpg',
        'O\'Star', '40g', 'gói', 'Thực phẩm', 'Bánh kẹo', 'Snack khoai tây', 10, 20, 25, '893458800006'],
      // SP058
      ['Bánh snack Lay\'s vị tự nhiên 95g', 'Snack & Bánh kẹo', 21000, 160, '🥔', S.PEPSICO,
        120, 180, 'assets/images/products/chips_lays.jpg',
        'Lay\'s', '95g', 'gói', 'Thực phẩm', 'Bánh kẹo', 'Snack khoai tây', 10, 20, 25, '893467300010'],
      // SP059
      ['Bánh que Pocky sô-cô-la 40g', 'Snack & Bánh kẹo', 14000, 175, '🥢', S.MONDELEZ,
        6, 365, 'assets/images/products/pocky_choco.jpg',
        'Pocky', '40g', 'hộp', 'Thực phẩm', 'Bánh kẹo', 'Bánh que nhúng socola', 10, 14, 30, '893458800007'],
      // SP060
      ['Kẹo dẻo Chupa Chups Panda 90g', 'Snack & Bánh kẹo', 16000, 195, '🍬', S.MONDELEZ,
        240, 365, 'assets/images/products/candy_chupa.jpg',
        'Chupa Chups', '90g', 'túi', 'Thực phẩm', 'Bánh kẹo', 'Kẹo dẻo', 10, 20, 15, '893458800008'],
      // SP061
      ['Kẹo thảo mộc Ricola 40g', 'Snack & Bánh kẹo', 39000, 140, '🍬', S.NESTLE,
        360, 720, 'assets/images/products/candy_ricola.jpg',
        'Ricola', '40g', 'hộp', 'Thực phẩm', 'Bánh kẹo', 'Kẹo thảo mộc', 10, 25, 15, '893458500006'],
      // SP062
      ['Hạt điều rang muối Bình Phước 250g', 'Snack & Bánh kẹo', 95000, 80, '🥜', S.MASAN,
        24, 180, 'assets/images/products/cashews_salt.jpg',
        'Bình Phước', '250g', 'gói', 'Thực phẩm', 'Hạt & Khô', 'Hạt điều', 10, 20, 25, '893474200017'],
      // SP063
      ['Hạt hạnh nhân sấy mộc 200g', 'Snack & Bánh kẹo', 85000, 75, '🥜', S.MASAN,
        180, 240, 'assets/images/products/almonds_roasted.jpg',
        'Việt Xuân', '200g', 'gói', 'Thực phẩm', 'Hạt & Khô', 'Hạt hạnh nhân', 10, 20, 20, '893474200018'],
      // SP064
      ['Khô gà lá chanh bơ tỏi 200g', 'Snack & Bánh kẹo', 48000, 90, '🍗', S.MASAN,
        18, 120, 'assets/images/products/chicken_floss.jpg',
        'Masan', '200g', 'gói', 'Thực phẩm', 'Hạt & Khô', 'Khô gà', 10, 14, 30, '893474200019'],
      // SP065
      ['Khô bò miếng cay truyền thống 150g', 'Snack & Bánh kẹo', 92000, 70, '🥩', S.MASAN,
        150, 180, 'assets/images/products/beef_jerky.jpg',
        'Masan', '150g', 'gói', 'Thực phẩm', 'Hạt & Khô', 'Khô bò', 10, 20, 20, '893474200020'],
      // SP066
      ['Rong biển cuộn nướng Big Roll', 'Snack & Bánh kẹo', 12500, 210, '🍙', S.MONDELEZ,
        180, 365, 'assets/images/products/seaweed_roll.jpg',
        'Big Roll', '24 miếng', 'hộp', 'Thực phẩm', 'Bánh kẹo', 'Rong biển ăn liền', 10, 20, 20, '893458800009'],

      // ─────────────────────────────────────────────────────────────────────
      // Đồ ăn liền & Chế biến sẵn (Ready-to-Eat / Hot Food)
      // ─────────────────────────────────────────────────────────────────────
      // SP067
      ['Bánh Mì Que Pate Peak', 'Đồ ăn liền & Chế biến sẵn', 19000, 70, '🥖', S.BEPCH,
        -8, 10, 'assets/images/products/bread_pate.jpg',
        'Peak', '1 cái', 'chiếc', 'Thực phẩm', 'Đồ ăn chế biến', 'Bánh mì', 10, 3, 40, '893500000671'],
      // SP068
      ['Sandwich Trứng Mayonnaise tươi', 'Đồ ăn liền & Chế biến sẵn', 25000, 60, '🥪', S.BEPCH,
        -5, 7, 'assets/images/products/sandwich_egg.jpg',
        'Bếp CH', '1 cái', 'chiếc', 'Thực phẩm', 'Đồ ăn chế biến', 'Sandwich', 10, 3, 40, '893500000681'],
      // SP069
      ['Cơm Tấm Sườn Nướng 7-E', 'Đồ ăn liền & Chế biến sẵn', 42000, 75, '🍱', S.BEPCH,
        5, 10, 'assets/images/products/com_tam.jpg',
        'Bếp CH', '1 phần', 'hộp', 'Thực phẩm', 'Đồ ăn chế biến', 'Cơm hộp', 10, 5, 35, '893500000691'],
      // SP070
      ['Cơm nắm Onigiri cá hồi', 'Đồ ăn liền & Chế biến sẵn', 18000, 140, '🍙', S.BEPCH,
        35, 60, 'assets/images/products/onigiri_salmon.jpg',
        'Bếp CH', '1 cái×100g', 'chiếc', 'Thực phẩm', 'Đồ ăn chế biến', 'Cơm nắm', 10, 7, 30, '893500000070'],
      // SP071
      ['Bánh bao xá xíu trứng muối', 'Đồ ăn liền & Chế biến sẵn', 22000, 120, '🥟', S.BEPCH,
        40, 90, 'assets/images/products/steamed_bun_charsiu.jpg',
        'Bếp CH', '1 cái×120g', 'chiếc', 'Thực phẩm', 'Đồ ăn chế biến', 'Bánh bao', 10, 7, 30, '893500000711'],
      // SP072
      ['Xúc xích phô mai nướng', 'Đồ ăn liền & Chế biến sẵn', 16000, 160, '🌭', S.MASAN,
        60, 120, 'assets/images/products/sausage_cheese_grill.jpg',
        'Masan', '1 que', 'chiếc', 'Thực phẩm', 'Đồ ăn chế biến', 'Xúc xích', 10, 10, 30, '893474200021'],
      // SP073
      ['Trứng lòng đào ngâm tương', 'Đồ ăn liền & Chế biến sẵn', 12000, 150, '🥚', S.BEPCH,
        32, 60, 'assets/images/products/egg_soy_marinated.png',
        'Bếp CH', '1 quả', 'quả', 'Thực phẩm', 'Đồ ăn chế biến', 'Trứng chế biến', 10, 7, 30, '893500000731'],
      // SP074
      ['Tokbokki phô mai ly', 'Đồ ăn liền & Chế biến sẵn', 32000, 130, '🍲', S.MASAN,
        90, 180, 'assets/images/products/tokbokki_cheese_cup.jpg',
        'Masan', '130g', 'ly', 'Thực phẩm', 'Đồ ăn chế biến', 'Tokbokki', 10, 14, 25, '893474200022'],

      // ─────────────────────────────────────────────────────────────────────
      // Chăm sóc cá nhân & Tiện ích 24/7
      // ─────────────────────────────────────────────────────────────────────
      // SP075
      ['Nước giặt OMO Matic cửa trên túi 2kg', 'Chăm sóc cá nhân & Tiện ích', 135000, 85, '🧴', S.UNILEVER,
        720, 1000, 'assets/images/products/detergent_omo.jpg',
        'OMO', '2kg', 'túi', 'Hóa mỹ phẩm', 'Chăm sóc quần áo', 'Nước giặt', 10, 30, 10, '893500100004'],
      // SP076
      ['Nước giặt Ariel Downy túi 1.9kg', 'Chăm sóc cá nhân & Tiện ích', 142000, 80, '🧴', S.PEPSICO,
        720, 1000, 'assets/images/products/detergent_ariel.jpg',
        'Ariel', '1.9kg', 'túi', 'Hóa mỹ phẩm', 'Chăm sóc quần áo', 'Nước giặt', 10, 30, 10, '893467300011'],
      // SP077
      ['Nước xả vải Comfort ban mai 1.8L', 'Chăm sóc cá nhân & Tiện ích', 118000, 95, '🌸', S.UNILEVER,
        720, 1000, 'assets/images/products/softener_comfort.jpg',
        'Comfort', '1.8L', 'chai', 'Hóa mỹ phẩm', 'Chăm sóc quần áo', 'Nước xả vải', 10, 30, 10, '893500100005'],
      // SP078 — tách thành túi tiết kiệm 1.4kg (phân biệt với SP008 chai 750g)
      ['Nước rửa chén Sunlight tiết kiệm túi 1.4kg', 'Chăm sóc cá nhân & Tiện ích', 56000, 60, '🧴', S.UNILEVER,
        720, 1000, 'assets/images/products/dishwash_sunlight_1400g.jpg',
        'Sunlight', '1.4kg', 'túi', 'Hóa mỹ phẩm', 'Vệ sinh bếp', 'Nước rửa chén', 10, 30, 10, '893500100006'],
      // SP079
      ['Nước lau sàn Sunlight hoa hạ 1kg', 'Chăm sóc cá nhân & Tiện ích', 34000, 150, '🧼', S.UNILEVER,
        720, 1000, 'assets/images/products/floor_sunlight.jpg',
        'Sunlight', '1kg', 'chai', 'Hóa mỹ phẩm', 'Vệ sinh nhà cửa', 'Nước lau sàn', 10, 30, 10, '893500100007'],
      // SP080
      ['Nước tẩy bồn cầu Vim chai 880ml', 'Chăm sóc cá nhân & Tiện ích', 38000, 160, '🪠', S.UNILEVER,
        720, 1000, 'assets/images/products/toilet_vim.jpg',
        'Vim', '880ml', 'chai', 'Hóa mỹ phẩm', 'Vệ sinh nhà cửa', 'Nước tẩy bồn cầu', 10, 30, 10, '893500100008'],
      // SP081
      ['Dầu gội Clear sạch gàu chai 630g', 'Chăm sóc cá nhân & Tiện ích', 165000, 90, '🧴', S.UNILEVER,
        720, 1000, 'assets/images/products/shampoo_clear.jpg',
        'Clear', '630g', 'chai', 'Hóa mỹ phẩm', 'Chăm sóc tóc', 'Dầu gội', 10, 30, 10, '893500100009'],
      // SP082
      ['Dầu gội Sunsilk óng mượt chai 650g', 'Chăm sóc cá nhân & Tiện ích', 139000, 100, '🧴', S.UNILEVER,
        720, 1000, 'assets/images/products/shampoo_sunsilk.jpg',
        'Sunsilk', '650g', 'chai', 'Hóa mỹ phẩm', 'Chăm sóc tóc', 'Dầu gội', 10, 30, 10, '893500100010'],
      // SP083
      ['Sữa tắm Lifebuoy bảo vệ chai 850g', 'Chăm sóc cá nhân & Tiện ích', 155000, 95, '🧼', S.UNILEVER,
        720, 1000, 'assets/images/products/body_lifebuoy.jpg',
        'Lifebuoy', '850g', 'chai', 'Hóa mỹ phẩm', 'Chăm sóc da', 'Sữa tắm', 10, 30, 10, '893500100011'],
      // SP084
      ['Bọt rửa tay Lifebuoy sạch khuẩn 250ml', 'Chăm sóc cá nhân & Tiện ích', 42000, 130, '🫧', S.UNILEVER,
        720, 1000, 'assets/images/products/handwash_lifebuoy.jpg',
        'Lifebuoy', '250ml', 'chai', 'Hóa mỹ phẩm', 'Chăm sóc da', 'Nước rửa tay', 10, 30, 10, '893500100012'],
      // SP085
      ['Kem đánh răng Colgate Total 180g', 'Chăm sóc cá nhân & Tiện ích', 45000, 170, '🪥', S.MASAN,
        720, 1000, 'assets/images/products/toothpaste_colgate.jpg',
        'Colgate', '180g', 'tuýp', 'Hóa mỹ phẩm', 'Vệ sinh răng miệng', 'Kem đánh răng', 10, 30, 10, '893474200023'],
      // SP086
      ['Bàn chải Colgate Slim Soft lông tơ', 'Chăm sóc cá nhân & Tiện ích', 28000, 190, '🪥', S.MASAN,
        1000, 1500, 'assets/images/products/toothbrush_colgate.jpg',
        'Colgate', '1 chiếc', 'chiếc', 'Hóa mỹ phẩm', 'Vệ sinh răng miệng', 'Bàn chải đánh răng', 10, 30, 10, '893474200024'],
      // SP087
      ['Khăn giấy cuộn Premier lốc 10 cuộn', 'Chăm sóc cá nhân & Tiện ích', 85000, 110, '🧻', S.UNILEVER,
        1000, 1500, 'assets/images/products/tissue_premier.jpg',
        'Premier', '10 cuộn', 'lốc', 'Hóa mỹ phẩm', 'Giấy vệ sinh', 'Giấy cuộn', 10, 30, 10, '893500100013'],
      // SP088
      ['Khăn ướt Fressi Care 80 tờ', 'Chăm sóc cá nhân & Tiện ích', 28000, 150, '🧻', S.UNILEVER,
        720, 1000, 'assets/images/products/wipes_fressi.jpg',
        'Fressi Care', '80 tờ', 'gói', 'Hóa mỹ phẩm', 'Chăm sóc da', 'Khăn ướt', 10, 30, 10, '893500100014'],
      // SP089
      ['Túi rác sinh học Opec 3 màu 1kg', 'Chăm sóc cá nhân & Tiện ích', 46000, 140, '🗑️', S.UNILEVER,
        1000, 1500, 'assets/images/products/trash_bags_opec.jpg',
        'Opec', '1kg', 'cuộn', 'Hóa mỹ phẩm', 'Tiện ích gia đình', 'Túi rác', 10, 30, 10, '893500100015'],
      // SP090
      ['Màng bọc thực phẩm PE Sunhouse 150m', 'Chăm sóc cá nhân & Tiện ích', 52000, 125, '📦', S.UNILEVER,
        1000, 1500, 'assets/images/products/pe_film.jpg',
        'Sunhouse', '150m', 'cuộn', 'Hóa mỹ phẩm', 'Tiện ích gia đình', 'Màng bọc thực phẩm', 10, 30, 10, '893500100016'],
      // SP091
      ['Giấy bạc nướng thực phẩm 5m', 'Chăm sóc cá nhân & Tiện ích', 26000, 135, '🍳', S.UNILEVER,
        1000, 1500, 'assets/images/products/foil_cooking.jpg',
        'Generic', '5m', 'cuộn', 'Hóa mỹ phẩm', 'Tiện ích gia đình', 'Giấy bạc nướng', 10, 30, 10, '893500100017'],
      // SP092
      ['Găng tay cao su gia dụng size M', 'Chăm sóc cá nhân & Tiện ích', 22000, 150, '🧤', S.UNILEVER,
        1000, 1500, 'assets/images/products/gloves_rubber.jpg',
        'Generic', '1 đôi', 'đôi', 'Hóa mỹ phẩm', 'Tiện ích gia đình', 'Găng tay', 10, 30, 10, '893500100018'],
      // SP093
      ['Dầu ăn Simply đậu nành chai 1L', 'Gia vị & Nhu yếu phẩm', 56000, 175, '🫒', S.MASAN,
        500, 720, 'assets/images/products/oil_simply_soybean_1l.png',
        'Simply', '1L', 'chai', 'Thực phẩm', 'Dầu ăn & Gia vị', 'Dầu đậu nành', 10, 20, 20, '893474200025'],
    ];

    // Cost price realistic margins per category
    function computeCostPrice(price, catL1, catL2) {
      // Thực phẩm: 65-75% of price; Đồ uống: 68-72%; Hóa mỹ phẩm: 60-70%
      if (catL1 === 'Hóa mỹ phẩm') return Math.round(price * 0.65);
      if (catL2 === 'Mì ăn liền' || catL2 === 'Nước mắm & Gia vị' || catL2 === 'Nước chấm & Gia vị') return Math.round(price * 0.72);
      if (catL2 === 'Sữa & Chế phẩm') return Math.round(price * 0.75);
      if (catL2 === 'Nước tinh khiết' || catL2 === 'Nước khoáng' || catL2 === 'Nước ngọt có gas' || catL2 === 'Nước tăng lực') return Math.round(price * 0.68);
      if (catL2 === 'Đồ ăn chế biến') return Math.round(price * 0.70);
      if (catL2 === 'Hạt & Khô' || catL2 === 'Bánh kẹo') return Math.round(price * 0.70);
      if (catL2 === 'Gạo & Ngũ cốc') return Math.round(price * 0.75);
      return Math.round(price * 0.70);
    }

    // minStock realistic by category
    function computeMinStock(catL1, catL2) {
      if (catL2 === 'Mì ăn liền') return 40;
      if (catL2 === 'Sữa & Chế phẩm' || catL2 === 'Sữa tươi tiệt trùng' || catL2 === 'Sữa chua uống') return 35;
      if (catL2 === 'Nước tinh khiết' || catL2 === 'Nước khoáng' || catL2 === 'Nước ngọt có gas' || catL2 === 'Nước tăng lực') return 50;
      if (catL2 === 'Trà đóng chai' || catL2 === 'Cà phê hòa tan' || catL2 === 'Cà phê đóng chai') return 25;
      if (catL2 === 'Gạo & Ngũ cốc') return 15;
      if (catL2 === 'Nước chấm & Gia vị' || catL2 === 'Dầu ăn & Gia vị') return 20;
      if (catL1 === 'Hóa mỹ phẩm') return 15;
      if (catL2 === 'Đồ ăn chế biến') return 10;
      if (catL2 === 'Bánh kẹo' || catL2 === 'Snack khoai tây') return 25;
      return 15;
    }

    const products = raw.map((r, i) => {
      const name = r[0], category = r[1], price = r[2], stock = r[3];
      const icon = r[4], supplierId = r[5];
      const expiryOffset = r[6] ?? 180, shelfLife = r[7] ?? 365;
      const imageUrl = r[8];
      const brand = r[9], packSize = r[10], unit = r[11];
      const catL1 = r[12], catL2 = r[13], catL3 = r[14];
      const vatRate = r[15] ?? 10, nearExpiryDays = r[16] ?? 20;
      const nearExpiryDiscountPercent = r[17] ?? 25;
      const ean12 = r[18] || ('893500000' + String(i + 1).padStart(3, '0'));

      const expiryDate = dateOffset(expiryOffset);
      const mfgDate = dateOffset(expiryOffset - shelfLife);
      const isNear = expiryOffset > 0 && expiryOffset <= nearExpiryDays;
      const costPrice = computeCostPrice(price, catL1, catL2);
      const minStock = i < 9 ? 15 : computeMinStock(catL1, catL2);

      // Build GTIN-13 from ean12 (12 digits), compute check digit
      const ean12str = String(ean12).replace(/\D/g, '').slice(0, 12).padStart(12, '0');
      const gtin = ean12str + calcEan13CheckDigit(ean12str);

      // Initial batch from seed stock
      const batchCode = `LO-${SEED_BASE_DATE.slice(0, 7).replace('-', '')}-${String(i + 1).padStart(3, '0')}`;
      const batches = [
        {
          id: `BAT-SEED-${String(i + 1).padStart(3, '0')}`,
          productId: `SP${String(i + 1).padStart(3, '0')}`,
          batchCode,
          mfgDate,
          expiryDate,
          costPrice,
          initialQty: stock,
          remainingQty: stock,
          status: expiryOffset < 0 ? 'expired_quarantined' : 'active',
          receivedAt: SEED_BASE_DATE,
          supplierId,
        },
      ];

      return {
        id: `SP${String(i + 1).padStart(3, '0')}`,
        barcode: `8935000${String(i + 1).padStart(6, '0')}`,
        gtin,
        name,
        brand,
        packSize,
        unit,
        category,
        categoryL1: catL1,
        categoryL2: catL2,
        categoryL3: catL3,
        price,
        cost: costPrice,
        costPrice,
        stock,
        damagedStock: 0,
        icon,
        supplierId,
        minStock,
        vatRate,
        nearExpiryDays,
        nearExpiryDiscountPercent,
        batchCode,
        mfgDate,
        expiryDate,
        imageUrl,
        batches,
        inNearExpiryPromo: isNear,
        active: true,
        createdAt: now(),
        referenceSource: { status: 'seed_placeholder' },
      };
    });

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
      batches: products.flatMap((p) => p.batches || []),
      customers,
      suppliers: [
        { id: 'NCC001', name: 'Vinamilk Việt Nam', phone: '02838231111', category: 'Sữa & chế phẩm', areas: 'TP. HCM, Bình Dương', active: true },
        { id: 'NCC002', name: 'Acecook Việt Nam', phone: '02837502000', category: 'Mì ăn liền, thực phẩm khô', areas: 'TP. HCM, Đồng Nai', active: true },
        { id: 'NCC003', name: 'Masan Consumer Corporation', phone: '02835444888', category: 'Gia vị, nước chấm, nước giải khát', areas: 'TP. HCM, Bình Dương', active: true },
        { id: 'NCC004', name: 'Mondelez Kinh Đô Việt Nam', phone: '02838155088', category: 'Bánh kẹo, snack', areas: 'TP. HCM, Bình Dương', active: true },
        { id: 'NCC005', name: 'Nestlé Việt Nam', phone: '02838155099', category: 'Sữa, cà phê, gia vị Maggi', areas: 'TP. HCM, Đồng Nai', active: true },
        { id: 'NCC006', name: 'Tập đoàn TH (TH TrueMilk)', phone: '02438574248', category: 'Sữa tươi sạch', areas: 'Nghệ An, TP. HCM', active: true },
        { id: 'NCC007', name: 'Unilever Việt Nam', phone: '02837668800', category: 'Hóa mỹ phẩm, chăm sóc cá nhân', areas: 'TP. HCM, Bình Dương', active: true },
        { id: 'NCC008', name: 'PepsiCo Foods Việt Nam', phone: '02838265577', category: 'Nước giải khát, snack, yến mạch', areas: 'TP. HCM, Đồng Nai', active: true },
        { id: 'NCC009', name: 'Lộc Trời Group (Gạo Lộc Trời / ST25)', phone: '02963877797', category: 'Gạo cao cấp', areas: 'An Giang, TP. HCM', active: true },
        { id: 'NCC010', name: 'Bếp Cửa Hàng (Nhà cung cấp đồ ăn tươi)', phone: '0908123456', category: 'Đồ ăn chế biến sẵn, bánh mì, cơm hộp', areas: 'TP. HCM', active: true },
      ],
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
          supplierIds: ['NCC001', 'NCC002', 'NCC003', 'NCC004', 'NCC005', 'NCC006', 'NCC007', 'NCC008', 'NCC009', 'NCC010'],
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
      detail: `${products.length} sản phẩm · 28 hóa đơn mẫu · Product+Batch FEFO`,
    });
    return state;
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { seed, calcEan13CheckDigit };
  else {
    scope.Retail.seed = seed;
    scope.Retail.calcEan13CheckDigit = calcEan13CheckDigit;
  }
})(globalThis);
