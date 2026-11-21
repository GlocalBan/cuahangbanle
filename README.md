# RetailFlow — Hệ thống Quản lý Cửa hàng Bán lẻ (841111)

Ứng dụng quản lý cửa hàng bán lẻ theo kiến trúc **3 tầng tách biệt (Presentation / BLL / DAL)** chạy trên **Node.js + SQLite** (`node:sqlite`), áp dụng **RBAC 3 lớp**, giao dịch nguyên tử 1-Transaction, quản lý tồn kho theo lô FEFO, thương lượng đơn đặt hàng hai chiều (PO/GRN/AP) và kiểm kê mù 2 vòng.

## Khởi chạy ứng dụng

Yêu cầu **Node.js >= 22** (sử dụng sẵn module `node:sqlite`, không cần biên dịch native addon).

```sh
npm start
# hoặc
node server.js
```

Mặc định máy chủ lắng nghe tại **http://127.0.0.1:3000** (có thể cấu hình qua biến môi trường `PORT`, `HOST`, `RETAILFLOW_DB_PATH`).

- Kiểm tra sức khỏe dịch vụ: `GET http://127.0.0.1:3000/api/health`
- Cơ sở dữ liệu SQLite lưu bền vững tại: `data/cuahangbanle.sqlite` (tự động chạy schema & migration an toàn, không phá dữ liệu cũ).

## Tài khoản khởi tạo (Seed Accounts)

> **Lưu ý bảo mật triển khai thực tế:** Các tài khoản dưới đây chỉ phục vụ môi trường học tập / kiểm thử nội bộ. Khi triển khai thật (production), **bắt buộc đổi toàn bộ mật khẩu mặc định** và khóa các tài khoản demo không sử dụng.

| Tài khoản | Mật khẩu mặc định | Vai trò (`role_code`) | Phạm vi quyền chính |
| --------- | ----------------- | --------------------- | ------------------- |
| `admin` | `123456` | `ADMIN` (Quản trị) | Toàn quyền hệ thống, nhân sự, tham số `THAM_SO`, Audit Log, sao lưu/phục hồi |
| `quanly` | `123456` | `MANAGER` (Quản lý) | Hàng hóa, khuyến mãi, voucher, duyệt PO/GRN/kiểm kê/trả hàng/hủy hàng, công nợ NCC, báo cáo |
| `thungan` | `123456` | `CASHIER` (Thu ngân) | Mở/chốt ca POS, bán hàng, thanh toán tiền mặt/VietQR, hóa đơn, lập yêu cầu trả hàng |
| `kho` | `123456` | `WAREHOUSE` (Nhân viên kho) | Lập PO, nhận hàng GRN, quản lý lô HSD, lập phiếu hủy hàng/trả NCC, thẻ kho, kiểm kê mù |
| `ncc01` | `123456` | `SUPPLIER` (Cổng NCC · `NCC003`) | Cổng NCC: xem PO được gửi và phản hồi/thương lượng đơn đặt hàng |

## Kiến trúc 3 tầng & Tính năng chính

1. **Presentation Layer (`index.html`, `src/core/`, `src/features/`, `src/events/`, `src/shared/`, `assets/css/`):**
   - Giao diện Vanilla JS + CSS theo mô-đun, phân nhóm menu theo vai trò, hỗ trợ phím tắt (`Ctrl/Cmd+K`, `F2`, `F4`, `F8`, `Esc`).
   - Toàn bộ nghiệp vụ vận hành gọi REST API `/api/*` qua `src/core/api.js`.
2. **Business Logic Layer (`src/server/bll/`):**
   - `authService.js`, `systemService.js`: xác thực Bearer Token, RBAC Guard, quản trị nhân sự, `THAM_SO`, Audit Log bất biến.
   - `catalogService.js`: sản phẩm (SKU/Barcode duy nhất, soft-delete, tự động quét lô hết hạn khỏi tồn khả dụng), danh mục, ĐVT, NCC, khách hàng.
   - `warehouseService.js`: đặt hàng hai chiều PO (`Draft → GuiNCC → NCCPhanHoi / ThuongLuong → DaThongNhat → DangNhanHang → Confirmed`), nhận hàng nhiều đợt GRN kèm HSD & bình quân gia quyền giá vốn, công nợ NCC (AP) & phiếu ghi có (`supplier_credits`), trả hàng NCC (`TRA_NCC`), xuất hủy hàng (`HUY_HANG`) có tách bạch người lập/người duyệt (SoD), kiểm kê mù 2 vòng phân cấp duyệt.
   - `salesService.js`: ca thu ngân (bắt buộc mở ca khi thu tiền mặt), POS xuất kho FEFO 1-Transaction, idempotency key chống lập đơn trùng, đóng băng giá bán, khuyến mãi & voucher (ngăn áp dụng chồng chéo), trả hàng trong hạn có phân bổ hoàn tiền không lệch làm tròn và kiểm soát SoD.
   - `reportService.js`: Dashboard & báo cáo doanh thu thuần trước VAT, thuế VAT ròng, giá vốn ròng, hao hụt hủy hàng & kiểm kê âm, múi giờ chuẩn `Asia/Ho_Chi_Minh` (UTC+7).
3. **Data Access Layer (`src/server/dal/`):**
   - `database.js`: lược đồ SQLite có ràng buộc khóa ngoại (`PRAGMA foreign_keys = ON`), trigger bất biến cho `stock_movements` và `audit_logs`, cơ chế migration cộng thêm an toàn (`runSafeMigrations`).
   - `repositories.js`, `catalogRepositories.js`, `warehouseRepositories.js`, `salesRepositories.js`, `retailOpsRepositories.js`, `reportRepository.js`.

## Cấu trúc thư mục chính

```text
server.js                  Khởi chạy HTTP server (mặc định port 3000) + static & API
index.html                 Trang vào ứng dụng web
data/cuahangbanle.sqlite   CSDL SQLite cục bộ (tự khởi tạo khi chạy lần đầu)
src/
  core/                    API client (api.js), state & helper UI (context.js)
  features/                Màn hình nghiệp vụ (dashboard, pos, orders, returns, products, inventory, purchases, promotions, reports, settings, supplierPortal)
  events/                  Điều phối sự kiện click, form, input, keyboard
  layout/                  Khung điều hướng & sidebar phân quyền (shell.js)
  shared/                  Modal, bảng, biểu đồ, xuất CSV/PDF
  domain/                  Module nghiệp vụ tương thích kiểm thử nền tảng
  server/
    bll/                   Tầng nghiệp vụ & quy tắc BR-01..BR-08
    dal/                   Tầng truy cập SQLite, schema, trigger & migration
    routes/                REST API router (api.js)
    security/              Mật khẩu scrypt, phiên đăng nhập, phân quyền RBAC
scripts/
  check-syntax.js          Kiểm tra cú pháp toàn bộ file JS (npm run lint)
  verify-product-images.js Xác thực ảnh sản phẩm nội bộ
tests/                     Bộ kiểm thử tự động (unit + API tích hợp trên SQLite :memory:)
```

## Kiểm thử & Kiểm tra chất lượng

```sh
npm run lint     # Kiểm tra cú pháp toàn bộ mã nguồn JS
npm run build    # Xác thực lint & sẵn sàng đóng gói
npm test         # Chạy toàn bộ bộ kiểm thử tự động (isolated SQLite :memory:)
```

Bộ kiểm thử (`npm test`) bao gồm:
- `tests/store.test.js` — Kiểm thử nền tảng domain & tính toán
- `tests/m1-rbac-api.test.js` — M1: Xác thực, RBAC 3 lớp, nhân sự, `THAM_SO`, Audit Log
- `tests/m2-catalog-api.test.js` — M2: Hàng hóa, danh mục, NCC, thẻ kho
- `tests/m3-warehouse-api.test.js` — M3: Phiếu nhập hàng, kiểm kê kho
- `tests/m4-sales-api.test.js` — M4: POS, khuyến mãi, hóa đơn, trả hàng
- `tests/m5-reports-rbac.test.js` — M5: Báo cáo BR-08 & ma trận phân quyền
- `tests/phase2-retail-ops.test.js` — Nghiệp vụ bán lẻ nâng cao (lô FEFO, ca thu ngân, PO/GRN/AP, kiểm kê 2 vòng)
- `tests/rf-fix-01-p0.test.js` — Kiểm thử hồi quy P0 (toàn vẹn nhập kho, GRN, tồn kho lô, đồng bộ kho)
- `tests/rf-fix-02-p1.test.js` — Kiểm thử hồi quy P1 (khuyến mãi/voucher, hoàn hàng FEFO, ca thu ngân, công nợ NCC)
- `tests/rf-fix-03-p2p3.test.js` — Kiểm thử hồi quy P2/P3 (bắt buộc mở ca tiền mặt, SoD hủy/trả hàng, quét lô hết hạn, idempotency checkout, báo cáo hao hụt & UTC+7, FK & migration DB cũ)
