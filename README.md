# Cửa hàng bán lẻ — RetailFlow

Ứng dụng quản lý cửa hàng bằng HTML, CSS và JavaScript, tổng hợp chức năng từ hai bản `pt`, `pttk` và giao diện tham khảo. Mã nguồn được chia theo từng chủ đề để dễ bổ sung.

## Chạy ứng dụng

Nhấp đúp `start.cmd`, sau đó truy cập **http://127.0.0.1:4173**. Hoặc mở terminal trong thư mục dự án và chạy:

```sh
node server.js
```

Cần Node.js. Chạy ứng dụng không cần cài thư viện. `npm install` chỉ cần thiết khi muốn dùng công cụ định dạng mã Prettier. Có thể mở `index.html` trực tiếp để xem nhanh; nên chạy qua server cục bộ để dữ liệu được lưu ổn định.

| Tài khoản dùng thử | Mật khẩu | Quyền                                                   |
| ------------------ | -------- | ------------------------------------------------------- |
| admin              | 123456   | Quản trị toàn bộ                                        |
| nhanvien           | 123456   | Bán hàng, hóa đơn, khách hàng, yêu cầu trả hàng         |
| kho                | 123456   | Xem sản phẩm, tồn kho, kiểm kê, nhập hàng, nhà cung cấp |

## Chức năng

- Tổng quan: thống kê thực từ dữ liệu, biểu đồ doanh thu 7/30 ngày, thanh toán, đơn mới và cảnh báo tồn thấp.
- POS: tìm sản phẩm không dấu, lọc danh mục, nhập/quét mã vạch USB, tăng giảm số lượng, giảm giá, thuế, chọn khách, ghi chú.
- Tìm khách theo số điện thoại tại POS: gợi ý cập nhật theo từng chữ số, tự ẩn khi không còn số khớp, chọn bằng chuột hoặc phím mũi tên/Enter; sửa số sẽ bỏ khách đã chọn để tránh gắn nhầm hóa đơn.
- Đơn tạm: lưu tối đa 5 đơn; mở lại, xóa và lưu qua lần tải lại trang.
- Ba phương thức thanh toán: **tiền mặt, chuyển khoản, thẻ ngân hàng**. Tiền mặt có tính tiền thừa và bàn phím số; chuyển khoản/thẻ lưu mã tham chiếu và xác nhận thủ công.
- Hóa đơn: tự động lưu sau thanh toán; tìm kiếm, lọc trạng thái/phương thức/ngày, phân trang, tải HTML, in/lưu PDF qua trình duyệt, xuất CSV.
- Trả hàng: tra hóa đơn gốc, chọn số lượng từng sản phẩm, lý do, quản trị phê duyệt/từ chối, hoàn tiền theo giá trị đã trả sau giảm giá/thuế; ngăn trả vượt hoặc hoàn trùng.
- Kho: cập nhật sau bán hàng, nhận hàng và trả hàng; kiểm kê thực đếm có lý do, xem lịch sử biến động.
- Nhập hàng: phiếu nhiều sản phẩm theo nhà cung cấp; nháp, chờ nhận, xác nhận nhập kho, hủy phiếu; chỉ cộng kho một lần khi xác nhận.
- Gợi ý nhập hàng: liệt kê mặt hàng bằng hoặc dưới ngưỡng tồn tối thiểu, chọn để mở phiếu với đúng nhà cung cấp và thêm sẵn mặt hàng; gợi ý bổ sung lên 2 lần ngưỡng tối thiểu sau khi trừ hàng chờ nhận. Có thể chỉnh số lượng và đơn giá ngay trên phiếu, thêm nhanh các mặt hàng sắp hết cùng đối tác.
- Danh mục: thêm/sửa sản phẩm, khách hàng, nhà cung cấp; trạng thái hoạt động; mã vạch, điện thoại và tên đăng nhập không trùng.
- Nhân viên: tài khoản, mật khẩu, khóa tài khoản, phân quyền quản trị/thu ngân/kho.
- Báo cáo: doanh thu gộp, tiền hoàn, doanh thu thuần, phương thức thanh toán, danh mục bán chạy, kỳ 1/7/30/90 ngày và CSV.
- Chi nhánh: xem chi nhánh chính, lưu đề xuất địa chỉ có kiểm tra vùng cung ứng của đối tác.
- Cấu hình: thông tin cửa hàng, thuế, tài khoản chuyển khoản, lời nhắn hóa đơn, sao lưu/khôi phục JSON và nhật ký thao tác.
- Giao diện tiếng Việt cho máy tính/điện thoại, menu di động, tìm kiếm toàn hệ thống và thông báo.

## Cấu trúc mã nguồn

```text
index.html                 Trang vào, khai báo thứ tự tải script
app.js                     Khởi động ứng dụng và phục hồi phiên
store.js                   Điểm vào tương thích cho kiểm thử Node
styles.css                 Danh sách import CSS theo chủ đề
src/
  core/context.js          Trạng thái chung, biểu tượng và helper HTML
  domain/                  Xử lý dữ liệu và quy tắc nghiệp vụ
    config.js              Vai trò, quyền, phương thức và tiện ích
    calculations.js        Tính giảm giá, thuế và tổng tiền
    seed.js                Dữ liệu mẫu
    backup.js              Kiểm tra dữ liệu sao lưu
    store.js               Kho dữ liệu, giao dịch và lưu trữ
    auth.js                Đăng nhập và quyền truy cập
    sales.js               Giỏ hàng, đơn tạm và thanh toán
    returns.js             Số lượng khả dụng và hoàn trả
    inventory.js           Biến động kho và kiểm kê
    purchases.js           Phiếu nhập hàng
    catalog.js             Sản phẩm, khách hàng, đối tác, nhân viên
    settings.js            Cấu hình, chi nhánh và khôi phục
  features/                Giao diện riêng theo chức năng
    auth.js, dashboard.js, pos.js, payments.js, orders.js
    products.js, catalog.js, inventory.js, purchases.js
    returns.js, reports.js, branches.js, settings.js
  layout/shell.js          Khung ứng dụng, điều hướng và tìm kiếm
  shared/                  Hộp thoại, bảng, biểu đồ và xuất file
  events/
    actions/               Xử lý nút bấm theo từng nhóm nghiệp vụ
    clicks.js              Điều phối sự kiện nút bấm
    forms.js               Biểu mẫu
    inputs.js              Ô nhập và bộ lọc
    keyboard.js            Phím tắt và đồng bộ tab
assets/css/                CSS: nền tảng, bố cục, thành phần, POS,
                           dashboard, form, hộp thoại, responsive, in
tests/                     Kiểm thử nghiệp vụ và trình duyệt
server.js                  Máy chủ cục bộ chỉ nghe 127.0.0.1
start.cmd                  Chạy trên Windows
```

Script phía trình duyệt dùng `defer` theo thứ tự trong `index.html`, chia sẻ context khai báo tại `src/core/context.js`. Nghiệp vụ được chia thành các module gắn vào Store; cùng mã được dùng trong trình duyệt và kiểm thử Node. Khi thêm module mới, khai báo trong `index.html` trước phần khởi động.

## Dữ liệu và phạm vi hiện tại

Bản đầu có 29 sản phẩm, 28 hóa đơn mẫu, 4 khách hàng, 3 đối tác và 3 tài khoản. Dữ liệu được lưu tại **localStorage của trình duyệt**, khóa `retailflow.v1`. Tải lại trang vẫn giữ giỏ hàng, đơn tạm, hóa đơn và tồn kho. Dùng cùng trình duyệt, địa chỉ và cổng; `localhost` và `127.0.0.1` là hai nguồn lưu trữ khác nhau.

Vào **Cấu hình → Tải bản sao lưu JSON** để sao lưu. Khôi phục thay thế dữ liệu sau khi kiểm tra định dạng và xác nhận. Đăng xuất không xóa dữ liệu; xóa bộ nhớ trình duyệt thì cần bản sao lưu để phục hồi. Tab cũ bị ngăn ghi đè nếu tab khác đã cập nhật dữ liệu.

Đây là bản frontend dùng thử: tài khoản/phân quyền và mật khẩu mẫu chạy trên trình duyệt, chưa có bảo mật backend hoặc database dùng chung nhiều thiết bị. Chuyển khoản/thẻ và hoàn tiền được xác nhận thủ công, chưa tích hợp ngân hàng. Hóa đơn là phiếu bán hàng nội bộ, chưa kết nối hóa đơn điện tử. Chi nhánh ở mức đề xuất, chưa vận hành kho độc lập. Đổi sản phẩm bằng cách trả hóa đơn cũ rồi lập đơn bán mới.

## Kiểm thử

```sh
npm test
npm run test:browser
```

Có 16 kiểm thử nghiệp vụ: thanh toán, tồn kho, trả hàng nhiều lần/làm tròn, đơn tạm, nhập hàng, phân quyền, kiểm kê, lỗi lưu trữ, xung đột tab và sao lưu. Kiểm thử trình duyệt dùng Microsoft Edge được cài sẵn trên Windows qua DevTools, không cần Playwright; sử dụng hồ sơ kiểm thử riêng. Ảnh kiểm thử sinh ra trong `preview/`, không đưa lên Git.

Phím tắt: **Ctrl/Cmd + K** tìm toàn hệ thống; **F2** mở POS; **F4** lưu đơn tạm; **F8** thanh toán; **Esc** đóng hộp thoại.
