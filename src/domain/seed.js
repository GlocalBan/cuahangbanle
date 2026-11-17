(function (scope) {
  'use strict';
  const { clone, now, id } =
    typeof module !== 'undefined' && module.exports ? require('./config.js') : scope.Retail;
  const { totals } =
    typeof module !== 'undefined' && module.exports ? require('./calculations.js') : scope.Retail;
  function seed() {
    const dateOffset = (days) => {
      const d = new Date();
      d.setDate(d.getDate() + days);
      return d.toISOString().slice(0, 10);
    };
    const raw = [
      // 9 sản phẩm đầu tiên tương thích nghiệp vụ cốt lõi & bài test
      ['Sữa tươi Vinamilk 1L', 'Sữa & Đồ uống', 36000, 154, '🥛', 'NCC001', 120, 180, 'assets/images/products/milk_vinamilk.jpg'],
      ['Mì Hảo Hảo tôm chua cay', 'Mì & Thực phẩm khô', 4500, 290, '🍜', 'NCC002', 180, 240, 'assets/images/products/haohao_shrimp.jpg'],
      ['Dầu ăn Simply 1L', 'Gia vị & Phụ liệu', 53000, 12, '🫒', 'NCC003', 365, 720, 'assets/images/products/oil_simply.jpg'],
      ['Nước suối Aquafina 500ml', 'Sữa & Đồ uống', 7000, 260, '💧', 'NCC003', 365, 720, 'assets/images/products/water_aquafina.jpg'],
      ['Bánh Oreo 133g', 'Bánh kẹo & Đồ ăn vặt', 20500, 180, '🍪', 'NCC002', 240, 365, 'assets/images/products/oreo_vanilla.jpg'],
      ['Cà phê G7 hộp 20 gói', 'Sữa & Đồ uống', 64000, 8, '☕', 'NCC003', 180, 240, 'assets/images/products/coffee_highlands.jpg'],
      ['Gạo ST25 túi 5kg', 'Mì & Thực phẩm khô', 195000, 85, '🌾', 'NCC002', 365, 540, 'assets/images/products/rice_st25.jpg'],
      ['Nước rửa chén Sunlight', 'Hóa mỹ phẩm', 35000, 14, '🧴', 'NCC003', 720, 1000, 'assets/images/products/dish_sunlight.jpg'],
      ['Khăn giấy Tempo', 'Đồ dùng gia đình', 25500, 128, '🧻', 'NCC003', 1000, 1500, 'assets/images/products/tissue_pulppy.jpg'],

      // Sữa & Đồ uống mở rộng
      ['Sữa chua uống Probi vi chất 130ml', 'Sữa & Đồ uống', 9000, 85, '🧃', 'NCC001', -3, 50, 'assets/images/products/yogurt_probi.jpg'], // Expired #1
      ['Sữa tươi tiệt trùng có đường 1L', 'Sữa & Đồ uống', 36000, 140, '🥛', 'NCC001', 4, 180, 'assets/images/products/milk_sweetened.jpg'], // Near #1
      ['Sữa tươi TH True Milk ít đường 1L', 'Sữa & Đồ uống', 38000, 125, '🥛', 'NCC001', 7, 180, 'assets/images/products/milk_th.jpg'], // Near #2
      ['Sữa chua nha đam tự nhiên', 'Sữa & Đồ uống', 8500, 95, '🥣', 'NCC001', 2, 45, 'assets/images/products/yogurt_aloe.jpg'], // Near #3
      ['Sữa đậu nành Fami nguyên chất 200ml', 'Sữa & Đồ uống', 5500, 220, '🧃', 'NCC001', 12, 180, 'assets/images/products/soy_milk.jpg'], // Near #4
      ['Trà xanh Không Độ 455ml', 'Sữa & Đồ uống', 12000, 175, '🍵', 'NCC003', 22, 365, 'assets/images/products/green_tea.jpg'], // Near #5
      ['Sữa đặc Ông Thọ đỏ lon 380g', 'Sữa & Đồ uống', 26000, 130, '🥫', 'NCC001', 240, 365, 'assets/images/products/condensed_milk.jpg'],
      ['Sữa Milo lúa mạch Nestlé 180ml', 'Sữa & Đồ uống', 9500, 210, '🧃', 'NCC001', 180, 240, 'assets/images/products/milk_milo.jpg'],
      ['Nước khoáng Lavie 500ml', 'Sữa & Đồ uống', 6500, 280, '💧', 'NCC003', 365, 720, 'assets/images/products/water_lavie.jpg'],
      ['Nước ngọt Coca-Cola lon 320ml', 'Sữa & Đồ uống', 11000, 240, '🥤', 'NCC003', 270, 365, 'assets/images/products/coca_cola.jpg'],
      ['Nước ngọt Pepsi không calo 330ml', 'Sữa & Đồ uống', 11000, 230, '🥤', 'NCC003', 270, 365, 'assets/images/products/pepsi_zero.jpg'],
      ['Nước ngọt 7Up lon 320ml', 'Sữa & Đồ uống', 11000, 190, '🥤', 'NCC003', 270, 365, 'assets/images/products/seven_up.jpg'],
      ['Trà Ô Long Tea+ Plus 455ml', 'Sữa & Đồ uống', 12500, 185, '🧋', 'NCC003', 200, 365, 'assets/images/products/oolong_tea.jpg'],
      ['Nước tăng lực Red Bull lon 250ml', 'Sữa & Đồ uống', 14000, 200, '⚡', 'NCC003', 300, 540, 'assets/images/products/red_bull.jpg'],
      ['Nước tăng lực Sting dâu 320ml', 'Sữa & Đồ uống', 11500, 215, '🍓', 'NCC003', 210, 365, 'assets/images/products/sting_red.jpg'],
      ['Cà phê lon Highlands Sữa đá 235ml', 'Sữa & Đồ uống', 17000, 180, '☕', 'NCC003', 180, 240, 'assets/images/products/coffee_highlands.jpg'],

      // Mì & Thực phẩm khô (16 sản phẩm)
      ['Mì Hảo Hảo tôm chua cay 75g', 'Mì & Thực phẩm khô', 4500, 290, '🍜', 'NCC002', 180, 240, 'assets/images/products/haohao_shrimp.jpg'],
      ['Mì Hảo Hảo sa tế hành 75g', 'Mì & Thực phẩm khô', 4500, 250, '🍜', 'NCC002', 180, 240, 'assets/images/products/haohao_sate.jpg'],
      ['Mì Omachi sườn hầm ngũ quả 80g', 'Mì & Thực phẩm khô', 9500, 210, '🍜', 'NCC002', 180, 240, 'assets/images/products/noodles_omachi.jpg'],
      ['Mì Kokomi 90 tôm chua cay', 'Mì & Thực phẩm khô', 5000, 240, '🍜', 'NCC002', 180, 240, 'assets/images/products/noodles_kokomi.jpg'],
      ['Mì xào khô Indomie Mi Goreng 85g', 'Mì & Thực phẩm khô', 6500, 200, '🍝', 'NCC002', 180, 240, 'assets/images/products/noodles_indomie.jpg'],
      ['Mì Cung Đình sườn hầm 80g', 'Mì & Thực phẩm khô', 9000, 190, '🍜', 'NCC002', 180, 240, 'assets/images/products/noodles_cungdinh.jpg'],
      ['Phở Đệ Nhất bò gói 68g', 'Mì & Thực phẩm khô', 8500, 170, '🍲', 'NCC002', 150, 240, 'assets/images/products/pho_beef.jpg'],
      ['Miến Phú Hương sườn heo 55g', 'Mì & Thực phẩm khô', 11500, 160, '🍲', 'NCC002', 150, 240, 'assets/images/products/glass_noodles.jpg'],
      ['Bún tươi Ba Cây Tre 300g', 'Mì & Thực phẩm khô', 18000, 120, '🌾', 'NCC002', 360, 540, 'assets/images/products/bun_dry.jpg'],
      ['Hủ tiếu Nam Vang Vifon 65g', 'Mì & Thực phẩm khô', 9500, 150, '🍲', 'NCC002', 150, 240, 'assets/images/products/glass_noodles.jpg'],
      ['Cháo sườn Vifon gói 70g', 'Mì & Thực phẩm khô', 7500, 140, '🥣', 'NCC002', 150, 240, 'assets/images/products/oats_quaker.jpg'],
      ['Gạo thơm ST25 Neptune túi 5kg', 'Mì & Thực phẩm khô', 195000, 85, '🌾', 'NCC002', 365, 540, 'assets/images/products/rice_st25.jpg'],
      ['Gạo thơm Jasmine túi 5kg', 'Mì & Thực phẩm khô', 125000, 90, '🌾', 'NCC002', 365, 540, 'assets/images/products/rice_st25.jpg'],
      ['Yến mạch nguyên chất Quaker 500g', 'Mì & Thực phẩm khô', 72000, 110, '🥣', 'NCC002', 300, 365, 'assets/images/products/oats_quaker.jpg'],
      ['Đậu xanh tách vỏ Tài Ký 500g', 'Mì & Thực phẩm khô', 38000, 130, '🌱', 'NCC002', 365, 540, 'assets/images/products/beans_green.jpg'],
      ['Nấm đông cô sấy khô 100g', 'Mì & Thực phẩm khô', 42000, 70, '🍄', 'NCC002', -12, 180, 'assets/images/products/mushrooms.jpg'],

      // Gia vị & Phụ liệu (14 sản phẩm)
      ['Nước mắm Nam Ngư Đệ Nhị 900ml', 'Gia vị & Phụ liệu', 28000, 180, '🍶', 'NCC003', 365, 720, 'assets/images/products/fish_sauce_namngu.jpg'],
      ['Nước mắm Chinsu cá hồi 500ml', 'Gia vị & Phụ liệu', 46000, 160, '🐟', 'NCC003', 365, 720, 'assets/images/products/fish_sauce_chinsu.jpg'],
      ['Nước tương Chinsu tỏi ớt 330ml', 'Gia vị & Phụ liệu', 18000, 190, '🍶', 'NCC003', 365, 720, 'assets/images/products/soy_sauce_chinsu.jpg'],
      ['Nước tương Maggi đậm đặc 700ml', 'Gia vị & Phụ liệu', 32000, 170, '🍶', 'NCC003', 365, 720, 'assets/images/products/soy_sauce_maggi.jpg'],
      ['Hạt nêm Knorr thịt thăn 400g', 'Gia vị & Phụ liệu', 39000, 210, '🧂', 'NCC003', 365, 540, 'assets/images/products/seasoning_knorr.jpg'],
      ['Bột ngọt Ajinomoto 454g', 'Gia vị & Phụ liệu', 36000, 230, '🧂', 'NCC003', 720, 1000, 'assets/images/products/msg_ajinomoto.jpg'],
      ['Muối tinh sấy i-ốt Vifon 500g', 'Gia vị & Phụ liệu', 6000, 250, '🧂', 'NCC003', 720, 1000, 'assets/images/products/salt_vifon.jpg'],
      ['Đường tinh luyện Biên Hòa 1kg', 'Gia vị & Phụ liệu', 29000, 200, '🍬', 'NCC003', 720, 1000, 'assets/images/products/sugar_bienhoa.jpg'],
      ['Dầu ăn Simply đậu nành 1L', 'Gia vị & Phụ liệu', 56000, 175, '🫒', 'NCC003', 500, 720, 'assets/images/products/oil_simply.jpg'],
      ['Dầu ăn Tường An Cooking Oil 1L', 'Gia vị & Phụ liệu', 48000, 190, '🫒', 'NCC003', 500, 720, 'assets/images/products/oil_tuongan.jpg'],
      ['Tương ớt Chinsu chai 250g', 'Gia vị & Phụ liệu', 14500, 240, '🌶️', 'NCC003', 300, 365, 'assets/images/products/chili_chinsu.jpg'],
      ['Tương cà Cholimex 330g', 'Gia vị & Phụ liệu', 15500, 180, '🍅', 'NCC003', 300, 365, 'assets/images/products/ketchup_cholimex.jpg'],
      ['Sốt Mayonnaise Kewpie 130g', 'Gia vị & Phụ liệu', 24000, 120, '🍳', 'NCC003', 120, 180, 'assets/images/products/mayo_kewpie.jpg'],
      ['Giấm gạo lên men Ajinomoto 400ml', 'Gia vị & Phụ liệu', 12000, 160, '🍶', 'NCC003', 365, 720, 'assets/images/products/soy_sauce_maggi.jpg'],

      // Bánh kẹo & Đồ ăn vặt (18 sản phẩm)
      ['Bánh quy Cosy mè Kinh Đô 288g', 'Bánh kẹo & Đồ ăn vặt', 32000, 140, '🍪', 'NCC002', 20, 365, 'assets/images/products/biscuits_cosy.jpg'],
      ['Bánh quy bơ Danisa hộp thiếc 454g', 'Bánh kẹo & Đồ ăn vặt', 135000, 65, '🍪', 'NCC002', 365, 540, 'assets/images/products/danisa_butter.jpg'],
      ['Bánh ChocoPie Orion hộp 12 cái', 'Bánh kẹo & Đồ ăn vặt', 56000, 130, '🥧', 'NCC002', 15, 365, 'assets/images/products/chocopie_orion.jpg'],
      ['Bánh bông lan Custas kem trứng 6 cái', 'Bánh kẹo & Đồ ăn vặt', 32000, 110, '🧁', 'NCC002', 60, 180, 'assets/images/products/custas_cake.jpg'],
      ['Bánh Oreo kem vani 133g', 'Bánh kẹo & Đồ ăn vặt', 20500, 180, '🍪', 'NCC002', 240, 365, 'assets/images/products/oreo_vanilla.jpg'],
      ['Bánh snack khoai tây O’Star rong biển', 'Bánh kẹo & Đồ ăn vặt', 13500, 190, '🥔', 'NCC002', 25, 180, 'assets/images/products/chips_ostar.jpg'],
      ['Bánh snack Lay’s vị tự nhiên 95g', 'Bánh kẹo & Đồ ăn vặt', 21000, 160, '🥔', 'NCC002', 120, 180, 'assets/images/products/chips_lays.jpg'],
      ['Bánh que Pocky sô-cô-la 40g', 'Bánh kẹo & Đồ ăn vặt', 14000, 175, '🥢', 'NCC002', 6, 365, 'assets/images/products/pocky_choco.jpg'],
      ['Kẹo dẻo Chupa Chups Panda 90g', 'Bánh kẹo & Đồ ăn vặt', 16000, 195, '🍬', 'NCC002', 240, 365, 'assets/images/products/candy_chupa.jpg'],
      ['Kẹo sâm ngậm Ricola 40g', 'Bánh kẹo & Đồ ăn vặt', 39000, 140, '🍬', 'NCC002', 360, 720, 'assets/images/products/candy_ricola.jpg'],
      ['Hạt điều rang muối Bình Phước 250g', 'Bánh kẹo & Đồ ăn vặt', 95000, 80, '🥜', 'NCC002', 28, 180, 'assets/images/products/cashews_salt.jpg'],
      ['Hạt hạnh nhân sấy mộc 200g', 'Bánh kẹo & Đồ ăn vặt', 85000, 75, '🥜', 'NCC002', 180, 240, 'assets/images/products/almonds_roasted.jpg'],
      ['Khô gà lá chanh bơ tỏi 200g', 'Bánh kẹo & Đồ ăn vặt', 48000, 90, '🍗', 'NCC002', 18, 120, 'assets/images/products/chicken_floss.jpg'],
      ['Khô bò miếng cay truyền thống 150g', 'Bánh kẹo & Đồ ăn vặt', 92000, 70, '🥩', 'NCC002', 150, 180, 'assets/images/products/beef_jerky.jpg'],
      ['Rong biển cuộn nướng Big Roll', 'Bánh kẹo & Đồ ăn vặt', 12500, 210, '🍙', 'NCC002', 180, 365, 'assets/images/products/seaweed_roll.jpg'],
      ['Bánh Mì Que Pate Peak', 'Bánh kẹo & Đồ ăn vặt', 19000, 70, '🥖', 'NCC002', -8, 10, 'assets/images/products/bread_pate.jpg'],
      ['Sandwich Trứng Mayonnaise', 'Bánh kẹo & Đồ ăn vặt', 25000, 60, '🥪', 'NCC002', -5, 7, 'assets/images/products/sandwich_egg.jpg'],
      ['Cơm Tấm Sườn Nướng 7-E', 'Bánh kẹo & Đồ ăn vặt', 42000, 75, '🍱', 'NCC002', 1, 3, 'assets/images/products/com_tam.jpg'],

      // Hóa mỹ phẩm (12 sản phẩm)
      ['Nước giặt OMO Matic cửa trên 2kg', 'Hóa mỹ phẩm', 135000, 85, '🧴', 'NCC003', 720, 1000, 'assets/images/products/detergent_omo.jpg'],
      ['Nước giặt Ariel Downy túi 1.9kg', 'Hóa mỹ phẩm', 142000, 80, '🧴', 'NCC003', 720, 1000, 'assets/images/products/detergent_ariel.jpg'],
      ['Nước xả vải Comfort ban mai 1.8L', 'Hóa mỹ phẩm', 118000, 95, '🌸', 'NCC003', 720, 1000, 'assets/images/products/softener_comfort.jpg'],
      ['Nước rửa chén Sunlight chanh 750g', 'Hóa mỹ phẩm', 31000, 180, '🍋', 'NCC003', 720, 1000, 'assets/images/products/dish_sunlight.jpg'],
      ['Nước lau sàn Sunlight hoa hạ 1kg', 'Hóa mỹ phẩm', 34000, 150, '🧼', 'NCC003', 720, 1000, 'assets/images/products/floor_sunlight.jpg'],
      ['Nước tẩy bồn cầu Vim 880ml', 'Hóa mỹ phẩm', 38000, 160, '🪠', 'NCC003', 720, 1000, 'assets/images/products/toilet_vim.jpg'],
      ['Dầu gội Clear sạch gàu 630g', 'Hóa mỹ phẩm', 165000, 90, '🧴', 'NCC003', 720, 1000, 'assets/images/products/shampoo_clear.jpg'],
      ['Dầu gội Sunsilk óng mượt 650g', 'Hóa mỹ phẩm', 139000, 100, '🧴', 'NCC003', 720, 1000, 'assets/images/products/shampoo_sunsilk.jpg'],
      ['Sữa tắm Lifebuoy bảo vệ 850g', 'Hóa mỹ phẩm', 155000, 95, '🧼', 'NCC003', 720, 1000, 'assets/images/products/body_lifebuoy.jpg'],
      ['Bọt rửa tay Lifebuoy sạch khuẩn 250ml', 'Hóa mỹ phẩm', 42000, 130, '🫧', 'NCC003', 720, 1000, 'assets/images/products/handwash_lifebuoy.jpg'],
      ['Kem đánh răng Colgate Total 180g', 'Hóa mỹ phẩm', 45000, 170, '🪥', 'NCC003', 720, 1000, 'assets/images/products/toothpaste_colgate.jpg'],
      ['Bàn chải Colgate Slim Soft lông tơ', 'Hóa mỹ phẩm', 28000, 190, '🪥', 'NCC003', 1000, 1500, 'assets/images/products/toothbrush_colgate.jpg'],

      // Đồ dùng gia đình (7 sản phẩm)
      ['Khăn giấy rút Pulppy 2 lớp 180 tờ', 'Đồ dùng gia đình', 24000, 160, '🧻', 'NCC003', 1000, 1500, 'assets/images/products/tissue_pulppy.jpg'],
      ['Khăn giấy cuộn Premier lốc 10 cuộn', 'Đồ dùng gia đình', 85000, 110, '🧻', 'NCC003', 1000, 1500, 'assets/images/products/tissue_premier.jpg'],
      ['Khăn ướt Fressi Care 80 tờ', 'Đồ dùng gia đình', 28000, 150, '🧻', 'NCC003', 720, 1000, 'assets/images/products/wipes_fressi.jpg'],
      ['Túi rác sinh học Opec 3 màu 1kg', 'Đồ dùng gia đình', 46000, 140, '🗑️', 'NCC003', 1000, 1500, 'assets/images/products/trash_bags_opec.jpg'],
      ['Màng bọc thực phẩm PE Sunhouse 150m', 'Đồ dùng gia đình', 52000, 125, '📦', 'NCC003', 1000, 1500, 'assets/images/products/pe_film.jpg'],
      ['Giấy bạc nướng thực phẩm 5m', 'Đồ dùng gia đình', 26000, 135, '🍳', 'NCC003', 1000, 1500, 'assets/images/products/foil_cooking.jpg'],
      ['Găng tay cao su gia dụng size M', 'Đồ dùng gia đình', 22000, 150, '🧤', 'NCC003', 1000, 1500, 'assets/images/products/gloves_rubber.jpg'],
    ];
    const products = raw.map((r, i) => {
      const price = r[2];
      const cost = Math.round(price * 0.7);
      const expiryOffset = r[6] ?? 180;
      const shelfLife = r[7] ?? 365;
      const expiryDate = dateOffset(expiryOffset);
      const mfgDate = dateOffset(expiryOffset - shelfLife);
      return {
        id: `SP${String(i + 1).padStart(3, '0')}`,
        barcode: `8935000${String(i + 1).padStart(6, '0')}`,
        name: r[0],
        category: r[1],
        price,
        cost,
        costPrice: cost,
        stock: r[3],
        icon: r[4],
        supplierId: r[5],
        minStock: 15,
        batchCode: `LO-2026-${String(i + 1).padStart(3, '0')}`,
        mfgDate,
        expiryDate,
        imageUrl: r[8] || '',
        active: true,
        createdAt: now(),
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
      detail: `${products.length} sản phẩm · 28 hóa đơn mẫu`,
    });
    return state;
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { seed };
  else scope.Retail.seed = seed;
})(globalThis);
