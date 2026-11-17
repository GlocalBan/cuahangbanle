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
      ['Mì Hảo Hảo tôm chua cay', 'Mì & Thực phẩm tiện lợi', 4500, 290, '🍜', 'NCC002', 180, 240, 'assets/images/products/haohao_shrimp.jpg'],
      ['Dầu ăn Simply 1L', 'Gia vị & Nhu yếu phẩm', 53000, 12, '🫒', 'NCC003', 365, 720, 'assets/images/products/oil_simply.jpg'],
      ['Nước suối Aquafina 500ml', 'Sữa & Đồ uống', 7000, 260, '💧', 'NCC003', 365, 720, 'assets/images/products/water_aquafina.jpg'],
      ['Bánh Oreo 133g', 'Snack & Bánh kẹo', 20500, 180, '🍪', 'NCC002', 240, 365, 'assets/images/products/oreo_vanilla.jpg'],
      ['Cà phê G7 hộp 20 gói', 'Sữa & Đồ uống', 64000, 8, '☕', 'NCC003', 180, 240, 'assets/images/products/coffee_highlands.jpg'],
      ['Gạo ST25 túi 5kg', 'Mì & Thực phẩm tiện lợi', 195000, 85, '🌾', 'NCC002', 365, 540, 'assets/images/products/rice_st25.jpg'],
      ['Nước rửa chén Sunlight', 'Chăm sóc cá nhân & Tiện ích', 35000, 14, '🧴', 'NCC003', 720, 1000, 'assets/images/products/dish_sunlight.jpg'],
      ['Khăn giấy Tempo', 'Chăm sóc cá nhân & Tiện ích', 25500, 128, '🧻', 'NCC003', 1000, 1500, 'assets/images/products/tissue_pulppy.jpg'],

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

      // Mì ăn liền, Phở & Thực phẩm tiện lợi
      ['Mì Hảo Hảo tôm chua cay 75g', 'Mì & Thực phẩm tiện lợi', 4500, 290, '🍜', 'NCC002', 180, 240, 'assets/images/products/haohao_shrimp.jpg'],
      ['Mì Hảo Hảo sa tế hành 75g', 'Mì & Thực phẩm tiện lợi', 4500, 250, '🍜', 'NCC002', 180, 240, 'assets/images/products/haohao_sate.jpg'],
      ['Mì Omachi sườn hầm ngũ quả 80g', 'Mì & Thực phẩm tiện lợi', 9500, 210, '🍜', 'NCC002', 180, 240, 'assets/images/products/noodles_omachi.jpg'],
      ['Mì Kokomi 90 tôm chua cay', 'Mì & Thực phẩm tiện lợi', 5000, 240, '🍜', 'NCC002', 180, 240, 'assets/images/products/noodles_kokomi.jpg'],
      ['Mì xào khô Indomie Mi Goreng 85g', 'Mì & Thực phẩm tiện lợi', 6500, 200, '🍝', 'NCC002', 180, 240, 'assets/images/products/noodles_indomie.jpg'],
      ['Mì Cung Đình sườn hầm 80g', 'Mì & Thực phẩm tiện lợi', 9000, 190, '🍜', 'NCC002', 180, 240, 'assets/images/products/noodles_cungdinh.jpg'],
      ['Phở Đệ Nhất bò gói 68g', 'Mì & Thực phẩm tiện lợi', 8500, 170, '🍲', 'NCC002', 150, 240, 'assets/images/products/pho_beef.jpg'],
      ['Miến Phú Hương sườn heo 55g', 'Mì & Thực phẩm tiện lợi', 11500, 160, '🍲', 'NCC002', 150, 240, 'assets/images/products/glass_noodles.jpg'],
      ['Bún tươi Ba Cây Tre 300g', 'Mì & Thực phẩm tiện lợi', 18000, 120, '🌾', 'NCC002', 360, 540, 'assets/images/products/bun_dry.jpg'],
      ['Hủ tiếu Nam Vang Vifon 65g', 'Mì & Thực phẩm tiện lợi', 9500, 150, '🍲', 'NCC002', 150, 240, 'assets/images/products/glass_noodles.jpg'],
      ['Cháo sườn Vifon gói 70g', 'Mì & Thực phẩm tiện lợi', 7500, 140, '🥣', 'NCC002', 150, 240, 'assets/images/products/oats_quaker.jpg'],
      ['Gạo thơm ST25 Neptune túi 5kg', 'Mì & Thực phẩm tiện lợi', 195000, 85, '🌾', 'NCC002', 365, 540, 'assets/images/products/rice_st25.jpg'],
      ['Gạo thơm Jasmine túi 5kg', 'Mì & Thực phẩm tiện lợi', 125000, 90, '🌾', 'NCC002', 365, 540, 'assets/images/products/rice_st25.jpg'],
      ['Yến mạch nguyên chất Quaker 500g', 'Mì & Thực phẩm tiện lợi', 72000, 110, '🥣', 'NCC002', 300, 365, 'assets/images/products/oats_quaker.jpg'],
      ['Đậu xanh tách vỏ Tài Ký 500g', 'Mì & Thực phẩm tiện lợi', 38000, 130, '🌱', 'NCC002', 365, 540, 'assets/images/products/beans_green.jpg'],
      ['Nấm đông cô sấy khô 100g', 'Mì & Thực phẩm tiện lợi', 42000, 70, '🍄', 'NCC002', -12, 180, 'assets/images/products/mushrooms.jpg'],

      // Gia vị & Nhu yếu phẩm bếp
      ['Nước mắm Nam Ngư Đệ Nhị 900ml', 'Gia vị & Nhu yếu phẩm', 28000, 180, '🍶', 'NCC003', 365, 720, 'assets/images/products/fish_sauce_namngu.jpg'],
      ['Nước mắm Chinsu cá hồi 500ml', 'Gia vị & Nhu yếu phẩm', 46000, 160, '🐟', 'NCC003', 365, 720, 'assets/images/products/fish_sauce_chinsu.jpg'],
      ['Nước tương Chinsu tỏi ớt 330ml', 'Gia vị & Nhu yếu phẩm', 18000, 190, '🍶', 'NCC003', 365, 720, 'assets/images/products/soy_sauce_chinsu.jpg'],
      ['Nước tương Maggi đậm đặc 700ml', 'Gia vị & Nhu yếu phẩm', 32000, 170, '🍶', 'NCC003', 365, 720, 'assets/images/products/soy_sauce_maggi.jpg'],
      ['Hạt nêm Knorr thịt thăn 400g', 'Gia vị & Nhu yếu phẩm', 39000, 210, '🧂', 'NCC003', 365, 540, 'assets/images/products/seasoning_knorr.jpg'],
      ['Bột ngọt Ajinomoto 454g', 'Gia vị & Nhu yếu phẩm', 36000, 230, '🧂', 'NCC003', 720, 1000, 'assets/images/products/msg_ajinomoto.jpg'],
      ['Muối tinh sấy i-ốt Vifon 500g', 'Gia vị & Nhu yếu phẩm', 6000, 250, '🧂', 'NCC003', 720, 1000, 'assets/images/products/salt_vifon.jpg'],
      ['Đường tinh luyện Biên Hòa 1kg', 'Gia vị & Nhu yếu phẩm', 29000, 200, '🍬', 'NCC003', 720, 1000, 'assets/images/products/sugar_bienhoa.jpg'],
      ['Dầu ăn Simply đậu nành 1L', 'Gia vị & Nhu yếu phẩm', 56000, 175, '🫒', 'NCC003', 500, 720, 'assets/images/products/oil_simply.jpg'],
      ['Dầu ăn Tường An Cooking Oil 1L', 'Gia vị & Nhu yếu phẩm', 48000, 190, '🫒', 'NCC003', 500, 720, 'assets/images/products/oil_tuongan.jpg'],
      ['Tương ớt Chinsu chai 250g', 'Gia vị & Nhu yếu phẩm', 14500, 240, '🌶️', 'NCC003', 300, 365, 'assets/images/products/chili_chinsu.jpg'],
      ['Tương cà Cholimex 330g', 'Gia vị & Nhu yếu phẩm', 15500, 180, '🍅', 'NCC003', 300, 365, 'assets/images/products/ketchup_cholimex.jpg'],
      ['Sốt Mayonnaise Kewpie 130g', 'Gia vị & Nhu yếu phẩm', 24000, 120, '🍳', 'NCC003', 120, 180, 'assets/images/products/mayo_kewpie.jpg'],
      ['Giấm gạo lên men Ajinomoto 400ml', 'Gia vị & Nhu yếu phẩm', 12000, 160, '🍶', 'NCC003', 365, 720, 'assets/images/products/soy_sauce_maggi.jpg'],

      // Snack, Bánh kẹo & Đồ ăn vặt
      ['Bánh quy Cosy mè Kinh Đô 288g', 'Snack & Bánh kẹo', 32000, 140, '🍪', 'NCC002', 20, 365, 'assets/images/products/biscuits_cosy.jpg'],
      ['Bánh quy bơ Danisa hộp thiếc 454g', 'Snack & Bánh kẹo', 135000, 65, '🍪', 'NCC002', 365, 540, 'assets/images/products/danisa_butter.jpg'],
      ['Bánh ChocoPie Orion hộp 12 cái', 'Snack & Bánh kẹo', 56000, 130, '🥧', 'NCC002', 15, 365, 'assets/images/products/chocopie_orion.jpg'],
      ['Bánh bông lan Custas kem trứng 6 cái', 'Snack & Bánh kẹo', 32000, 110, '🧁', 'NCC002', 60, 180, 'assets/images/products/custas_cake.jpg'],
      ['Bánh Oreo kem vani 133g', 'Snack & Bánh kẹo', 20500, 180, '🍪', 'NCC002', 240, 365, 'assets/images/products/oreo_vanilla.jpg'],
      ['Bánh snack khoai tây O’Star rong biển', 'Snack & Bánh kẹo', 13500, 190, '🥔', 'NCC002', 25, 180, 'assets/images/products/chips_ostar.jpg'],
      ['Bánh snack Lay’s vị tự nhiên 95g', 'Snack & Bánh kẹo', 21000, 160, '🥔', 'NCC002', 120, 180, 'assets/images/products/chips_lays.jpg'],
      ['Bánh que Pocky sô-cô-la 40g', 'Snack & Bánh kẹo', 14000, 175, '🥢', 'NCC002', 6, 365, 'assets/images/products/pocky_choco.jpg'],
      ['Kẹo dẻo Chupa Chups Panda 90g', 'Snack & Bánh kẹo', 16000, 195, '🍬', 'NCC002', 240, 365, 'assets/images/products/candy_chupa.jpg'],
      ['Kẹo sâm ngậm Ricola 40g', 'Snack & Bánh kẹo', 39000, 140, '🍬', 'NCC002', 360, 720, 'assets/images/products/candy_ricola.jpg'],
      ['Hạt điều rang muối Bình Phước 250g', 'Snack & Bánh kẹo', 95000, 80, '🥜', 'NCC002', 28, 180, 'assets/images/products/cashews_salt.jpg'],
      ['Hạt hạnh nhân sấy mộc 200g', 'Snack & Bánh kẹo', 85000, 75, '🥜', 'NCC002', 180, 240, 'assets/images/products/almonds_roasted.jpg'],
      ['Khô gà lá chanh bơ tỏi 200g', 'Snack & Bánh kẹo', 48000, 90, '🍗', 'NCC002', 18, 120, 'assets/images/products/chicken_floss.jpg'],
      ['Khô bò miếng cay truyền thống 150g', 'Snack & Bánh kẹo', 92000, 70, '🥩', 'NCC002', 150, 180, 'assets/images/products/beef_jerky.jpg'],
      ['Rong biển cuộn nướng Big Roll', 'Snack & Bánh kẹo', 12500, 210, '🍙', 'NCC002', 180, 365, 'assets/images/products/seaweed_roll.jpg'],

      // Đồ ăn liền & Chế biến sẵn (Ready-to-Eat / Hot Food)
      ['Bánh Mì Que Pate Peak', 'Đồ ăn liền & Chế biến sẵn', 19000, 70, '🥖', 'NCC002', -8, 10, 'assets/images/products/bread_pate.jpg'],
      ['Sandwich Trứng Mayonnaise', 'Đồ ăn liền & Chế biến sẵn', 25000, 60, '🥪', 'NCC002', -5, 7, 'assets/images/products/sandwich_egg.jpg'],
      ['Cơm Tấm Sườn Nướng 7-E', 'Đồ ăn liền & Chế biến sẵn', 42000, 75, '🍱', 'NCC002', 1, 3, 'assets/images/products/com_tam.jpg'],
      ['Cơm nắm Onigiri cá hồi', 'Đồ ăn liền & Chế biến sẵn', 18000, 140, '🍙', 'NCC002', 35, 60, 'assets/images/products/seaweed_roll.jpg'],
      ['Bánh bao xá xíu trứng muối', 'Đồ ăn liền & Chế biến sẵn', 22000, 120, '🥟', 'NCC002', 40, 90, 'assets/images/products/bread_pate.jpg'],
      ['Xúc xích phô mai nướng', 'Đồ ăn liền & Chế biến sẵn', 16000, 160, '🌭', 'NCC002', 60, 120, 'assets/images/products/beef_jerky.jpg'],
      ['Trứng lòng đào ngâm tương', 'Đồ ăn liền & Chế biến sẵn', 12000, 150, '🥚', 'NCC002', 32, 60, 'assets/images/products/sandwich_egg.jpg'],
      ['Tokbokki phô mai ly', 'Đồ ăn liền & Chế biến sẵn', 32000, 130, '🍲', 'NCC002', 90, 180, 'assets/images/products/noodles_omachi.jpg'],

      // Chăm sóc cá nhân & Tiện ích 24/7 (Personal Care & CVS Utilities)
      ['Nước giặt OMO Matic cửa trên 2kg', 'Chăm sóc cá nhân & Tiện ích', 135000, 85, '🧴', 'NCC003', 720, 1000, 'assets/images/products/detergent_omo.jpg'],
      ['Nước giặt Ariel Downy túi 1.9kg', 'Chăm sóc cá nhân & Tiện ích', 142000, 80, '🧴', 'NCC003', 720, 1000, 'assets/images/products/detergent_ariel.jpg'],
      ['Nước xả vải Comfort ban mai 1.8L', 'Chăm sóc cá nhân & Tiện ích', 118000, 95, '🌸', 'NCC003', 720, 1000, 'assets/images/products/softener_comfort.jpg'],
      ['Nước rửa chén Sunlight chanh 750g', 'Chăm sóc cá nhân & Tiện ích', 31000, 180, '🍋', 'NCC003', 720, 1000, 'assets/images/products/dish_sunlight.jpg'],
      ['Nước lau sàn Sunlight hoa hạ 1kg', 'Chăm sóc cá nhân & Tiện ích', 34000, 150, '🧼', 'NCC003', 720, 1000, 'assets/images/products/floor_sunlight.jpg'],
      ['Nước tẩy bồn cầu Vim 880ml', 'Chăm sóc cá nhân & Tiện ích', 38000, 160, '🪠', 'NCC003', 720, 1000, 'assets/images/products/toilet_vim.jpg'],
      ['Dầu gội Clear sạch gàu 630g', 'Chăm sóc cá nhân & Tiện ích', 165000, 90, '🧴', 'NCC003', 720, 1000, 'assets/images/products/shampoo_clear.jpg'],
      ['Dầu gội Sunsilk óng mượt 650g', 'Chăm sóc cá nhân & Tiện ích', 139000, 100, '🧴', 'NCC003', 720, 1000, 'assets/images/products/shampoo_sunsilk.jpg'],
      ['Sữa tắm Lifebuoy bảo vệ 850g', 'Chăm sóc cá nhân & Tiện ích', 155000, 95, '🧼', 'NCC003', 720, 1000, 'assets/images/products/body_lifebuoy.jpg'],
      ['Bọt rửa tay Lifebuoy sạch khuẩn 250ml', 'Chăm sóc cá nhân & Tiện ích', 42000, 130, '🫧', 'NCC003', 720, 1000, 'assets/images/products/handwash_lifebuoy.jpg'],
      ['Kem đánh răng Colgate Total 180g', 'Chăm sóc cá nhân & Tiện ích', 45000, 170, '🪥', 'NCC003', 720, 1000, 'assets/images/products/toothpaste_colgate.jpg'],
      ['Bàn chải Colgate Slim Soft lông tơ', 'Chăm sóc cá nhân & Tiện ích', 28000, 190, '🪥', 'NCC003', 1000, 1500, 'assets/images/products/toothbrush_colgate.jpg'],
      ['Khăn giấy rút Pulppy 2 lớp 180 tờ', 'Chăm sóc cá nhân & Tiện ích', 24000, 160, '🧻', 'NCC003', 1000, 1500, 'assets/images/products/tissue_pulppy.jpg'],
      ['Khăn giấy cuộn Premier lốc 10 cuộn', 'Chăm sóc cá nhân & Tiện ích', 85000, 110, '🧻', 'NCC003', 1000, 1500, 'assets/images/products/tissue_premier.jpg'],
      ['Khăn ướt Fressi Care 80 tờ', 'Chăm sóc cá nhân & Tiện ích', 28000, 150, '🧻', 'NCC003', 720, 1000, 'assets/images/products/wipes_fressi.jpg'],
      ['Túi rác sinh học Opec 3 màu 1kg', 'Chăm sóc cá nhân & Tiện ích', 46000, 140, '🗑️', 'NCC003', 1000, 1500, 'assets/images/products/trash_bags_opec.jpg'],
      ['Màng bọc thực phẩm PE Sunhouse 150m', 'Chăm sóc cá nhân & Tiện ích', 52000, 125, '📦', 'NCC003', 1000, 1500, 'assets/images/products/pe_film.jpg'],
      ['Giấy bạc nướng thực phẩm 5m', 'Chăm sóc cá nhân & Tiện ích', 26000, 135, '🍳', 'NCC003', 1000, 1500, 'assets/images/products/foil_cooking.jpg'],
      ['Găng tay cao su gia dụng size M', 'Chăm sóc cá nhân & Tiện ích', 22000, 150, '🧤', 'NCC003', 1000, 1500, 'assets/images/products/gloves_rubber.jpg'],
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
        damagedStock: 0,
        inNearExpiryPromo: false,
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
      promotions: [
        {
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
        },
        {
          id: 'promo-cuoituan',
          code: 'CUOITUAN10',
          name: 'Giảm 10% Cuối Tuần (Đơn từ 150k)',
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
          name: 'Giảm 25.000đ Đơn từ 250k',
          type: 'fixed',
          value: 25000,
          minOrderAmount: 250000,
          maxDiscount: 25000,
          nearExpiryOnly: false,
          productIds: [],
          active: true,
        },
        {
          id: 'promo-cvs15',
          code: 'CVS15',
          name: 'Ưu đãi CVS Mùa Hè (-15%)',
          type: 'percent',
          value: 15,
          minOrderAmount: 300000,
          maxDiscount: 60000,
          nearExpiryOnly: false,
          productIds: [],
          active: true,
        },
      ],
      vouchers: [
        {
          id: 'vouch-app15k',
          code: 'APP15K',
          name: 'Voucher Khách Mới App (-15k)',
          type: 'fixed',
          value: 15000,
          minOrderAmount: 100000,
          maxDiscount: 15000,
          active: true,
        },
        {
          id: 'vouch-app30k',
          code: 'APP30K',
          name: 'Voucher Đơn Lớn Tiện Lợi (-30k)',
          type: 'fixed',
          value: 30000,
          minOrderAmount: 220000,
          maxDiscount: 30000,
          active: true,
        },
        {
          id: 'vouch-sieuthi10',
          code: 'SIEUTHI10',
          name: 'Voucher Siêu Thị Tiện Lợi (-10%)',
          type: 'percent',
          value: 10,
          minOrderAmount: 150000,
          maxDiscount: 30000,
          active: true,
        },
        {
          id: 'vouch-banmoi20k',
          code: 'BANMOI20K',
          name: 'Voucher Bạn Mới 20k (-20k)',
          type: 'fixed',
          value: 20000,
          minOrderAmount: 120000,
          maxDiscount: 20000,
          active: true,
        },
        {
          id: 'vouch-vip50k',
          code: 'VIP50K',
          name: 'Voucher VIP Circle (-50k)',
          type: 'fixed',
          value: 50000,
          minOrderAmount: 400000,
          maxDiscount: 50000,
          active: true,
        },
      ],
      draft: { items: [], customerId: '', discount: 0, promotionId: null, voucherId: null, note: '', demographic: 'Không ghi nhận' },
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
