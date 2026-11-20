# RetailFlow — Tiến độ triển khai (Checkpoint Log)

> Lưu ý: Môi trường sandbox hiện tại không có thư mục `.git`, nên tiến độ được ghi dấu rõ ràng tại file này sau mỗi chặng đã chạy kiểm chứng đầy đủ.

## BƯỚC 1 — ĐÃ HOÀN TẤT & KIỂM CHỨNG
- Sửa 4 test M3 (`M3-02`, `M3-03`, `M3-05`, `M3-06`) gửi `expiryDate` hợp lệ cho sản phẩm có HSD (không nới lỏng nghiệp vụ).
- Kết quả: `65/65` tests pass, `80/80` JS lint pass, `438/438` ảnh sản phẩm đạt.

## BƯỚC 2 — ĐÃ HOÀN TẤT & KIỂM CHỨNG
- **2a) Voucher:** CRUD, phát hành hàng loạt (`/api/vouchers/bulk`), tạm dừng/kích hoạt, validate, chặn xóa cứng (403); POS chặn dùng đồng thời Voucher + Khuyến mãi (`400` XOR), ghi lịch sử sử dụng (`voucher_redemptions`) và giới hạn theo khách hàng.
- **2b) KM cận date:** `/api/promotions/near-expiry-suggestions` gợi ý từ `product_batches`; khuyến mãi phạm vi `NEAR_EXPIRY` chỉ tính giảm giá trên số lượng lô cận date hợp lệ.
- **2c) Ca thu ngân (`cashier_shifts`):** Mở ca (`/api/shifts/open`), chống mở trùng (`409`), tự gắn `shift_id` cho đơn POS, chốt ca đối soát tiền mặt (`expectedCash = openingCash + cashSales - cashRefunds`, bắt buộc ghi chú khi `variance != 0`).
- **2d) Nhập hàng 2 chiều + Cổng NCC (`SUPPLIER` / `ncc01`):** Gửi PO, thương lượng nhiều vòng (`send` / `respond` / `counter` / `agree`), cách ly NCC (`403` chéo NCC), nhận hàng nhiều đợt qua GRN (`/api/grns`), tự sinh công nợ NCC (`supplier_payables`) + ghi nhận thanh toán (`/api/payables/:id/pay`), trả hàng NCC (`TRA_NCC`) trừ tồn lô & giảm trừ đúng công nợ GRN liên kết, transaction nguyên tử + rollback test.
- **2e) Kiểm kê kho hoàn chỉnh:** Kiểm kê mù (`DangDem` ẩn `systemQty`/`diffQty` với người đếm), đếm lại vòng 2 (`ChoDemLai`, chặn tự đếm lại `403`), mã lý do chuẩn, duyệt phân cấp (`NguongDuyetKiemKeAdmin` -> Admin), cấm tự duyệt (`403`), tính lại tồn hệ thống thực tại thời điểm duyệt không ghi đè giao dịch phát sinh giữa chừng.
- **BƯỚC 3 (Backend):** Chặn tuyệt đối thanh toán một phần/trả góp/ghi nợ trên POS (`400`); giữ nguyên trả hàng theo từng món/số lượng và chặn trả mặt hàng `non_returnable = 1` (`400`).
- **Kiểm chứng:** `72/72` tests pass (thêm `tests/phase2-retail-ops.test.js` gồm ma trận RBAC 5 vai trò `401/403/200`), `81/81` JS files lint pass, `438/438` ảnh 1:1 + thumbs đạt.

## BƯỚC 3 — ĐÃ HOÀN TẤT & KIỂM CHỨNG
- **Backend & UI POS:** Chặn tuyệt đối thanh toán một phần / trả góp / chia tiền / ghi nợ (`400` ở API, bỏ toàn bộ UI thanh toán nhiều đợt, chỉ giữ 1 nút xác nhận thanh toán đủ 100%).
- **Trả hàng & Tồn khả dụng:** Hỗ trợ chọn từng món / số lượng hợp lệ, chặn trả mặt hàng `non_returnable = 1` (tươi sống / đông lạnh) trên cả Backend (`400`) lẫn UI (badge đỏ + khóa input + tooltip); nút `±` giỏ POS khóa trần theo `TonKhaDung` và tối thiểu `1` kèm tooltip giải thích.

## BƯỚC 4 — ĐÃ HOÀN TẤT & KIỂM CHỨNG
- **Giao diện Frontend đầy đủ cho toàn bộ nghiệp vụ Phase 2:**
  - Màn hình POS: thanh trạng thái Ca thu ngân (Mở ca / Chốt ca đối soát tiền mặt + chênh lệch trực tiếp), Radio XOR 3 chế độ (`Không giảm` / `Mã Voucher` / `Khuyến mãi`), nút `±` khóa trần tồn, giỏ hàng & tìm khách theo SĐT gọn 1 hàng.
  - Màn hình Khuyến mãi & Voucher: 2 tab tách biệt; tạo/sửa/tạm dừng KM kèm phạm vi `INVOICE / CATEGORY / PRODUCT / NEAR_EXPIRY` + nút tải gợi ý SP cận date từ `product_batches`; quản lý Voucher (CRUD, phát hành hàng loạt, tạm dừng/kích hoạt/kết thúc).
  - Màn hình Kho & Kiểm kê: 4 tab (`Tồn kho hiện tại`, `Hàng cận date & Hủy hàng` với KPI vốn rủi ro + CRUD/Duyệt/Hủy phiếu hủy hàng, `Thẻ kho (LichSuTonKho)` có cột `Mã lô`, `Phiếu kiểm kê` hỗ trợ Kiểm kê mù `DangDem` / Đếm lại vòng 2 `ChoDemLai` / mã lý do chuẩn / đối chiếu tồn thực lúc duyệt / in biên bản A4).
  - Màn hình Nhập hàng & Công nợ + Cổng NCC: 4 tab (`Đơn đặt hàng (PO)`, `Phiếu nhận hàng (GRN)`, `Công nợ NCC`, `Trả hàng NCC (TRA_NCC)`) và trang riêng `#/supplier-portal` cho tài khoản `ncc01` (`SUPPLIER`, `NCC003`).
- **Kiểm chứng thực tế trên Chromium (Playwright) ở 3 kích thước (`1440×900`, `1024×768`, `390×844`):**
  - `0` console error, `0` failed request, `0` request mạng ngoài (100% offline), `overflowX: false` trên cả 3 kích thước.
  - Xác nhận hiển thị đủ 14 danh mục (+ `Tất cả` = 15 nút), 438/438 thẻ sản phẩm POS nạp ảnh thumbnail `/thumbs/` (`240×240`), dữ liệu thực tế `4 lô` hết hạn & `10 lô` cận date (`3.649.000 ₫` vốn rủi ro), lưới KPI 2×2 cân đối tại `1024×768`, RBAC redirect `403` đúng cho `thungan` và `ncc01`.

## BƯỚC 5 — ĐÃ HOÀN TẤT & ĐÓNG GÓI KIỂM CHỨNG CUỐI
- **Test tự động:** `72/72` đạt (`npm test`).
- **Lint cú pháp JS:** `81/81` file đạt (`npm run lint`).
- **Kiểm chứng ảnh 1-1 & chuẩn EAN-13:** `438/438` SKU (`14` danh mục, `22` NCC), `438/438` MD5 duy nhất `>=600×600` tỷ lệ 1:1, `438/438` thumbnail `240×240`, `438/438` khớp `SOURCES.csv` (`{"salt.tikicdn.com":438}`), `0` EAN-13 lỗi.

