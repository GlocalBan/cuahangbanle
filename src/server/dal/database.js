'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { hashPassword } = require('../bll/security.js');

const ROLE_DEFINITIONS = [
  {
    code: 'ADMIN',
    display_name: 'Admin (Quản trị viên)',
    short_name: 'Admin',
    description: 'Quản trị tài khoản nhân viên, gán vai trò, cấu hình THAM_SO, xem Audit Log, sao lưu/phục hồi.',
  },
  {
    code: 'MANAGER',
    display_name: 'Quản lý cửa hàng (QuanLy)',
    short_name: 'QuanLy',
    description: 'Quản lý sản phẩm/danh mục/bảng giá, khuyến mãi, NCC, duyệt nhập/kiểm kê/trả hàng, xem báo cáo lợi nhuận.',
  },
  {
    code: 'CASHIER',
    display_name: 'Thu ngân (ThuNgan)',
    short_name: 'ThuNgan',
    description: 'Bán hàng POS, lập hóa đơn, áp dụng khuyến mãi, thanh toán, lập phiếu trả hàng, tra cứu SP & khách hàng.',
  },
  {
    code: 'WAREHOUSE',
    display_name: 'Nhân viên kho (NhanVienKho)',
    short_name: 'NhanVienKho',
    description: 'Lập phiếu nhập (Draft), kiểm kê kho, xem thẻ kho (LichSuTonKho), tra cứu sản phẩm & NCC.',
  },
];

const PERMISSION_DEFINITIONS = [
  { code: 'DASHBOARD_VIEW', module: 'Bán hàng (POS)', description: 'Xem tổng quan vận hành cửa hàng' },
  { code: 'POS_SELL', module: 'Bán hàng (POS)', description: 'Bán hàng tại quầy POS, lập hóa đơn và thanh toán' },
  { code: 'ORDER_VIEW', module: 'Bán hàng (POS)', description: 'Xem và tra cứu hóa đơn bán hàng' },
  { code: 'RETURN_CREATE', module: 'Bán hàng (POS)', description: 'Lập phiếu yêu cầu trả hàng trong hạn' },
  { code: 'RETURN_APPROVE', module: 'Bán hàng (POS)', description: 'Duyệt hoặc từ chối phiếu trả hàng và hoàn tiền' },
  { code: 'PRODUCT_VIEW', module: 'Quản lý Hàng hóa', description: 'Tra cứu danh sách sản phẩm và giá bán' },
  { code: 'PRODUCT_COST_VIEW', module: 'Quản lý Hàng hóa', description: 'Xem giá vốn sản phẩm' },
  { code: 'PRODUCT_MANAGE', module: 'Quản lý Hàng hóa', description: 'Thêm, sửa, ngưng kinh doanh sản phẩm và cập nhật giá' },
  { code: 'CATEGORY_MANAGE', module: 'Quản lý Hàng hóa', description: 'Quản lý danh mục hàng hóa và đơn vị tính' },
  { code: 'INVENTORY_VIEW', module: 'Quản lý Kho', description: 'Xem tồn kho và thẻ kho (LichSuTonKho)' },
  { code: 'INVENTORY_AUDIT', module: 'Quản lý Kho', description: 'Lập phiếu kiểm kê kho và ghi nhận chênh lệch' },
  { code: 'INVENTORY_APPROVE', module: 'Quản lý Kho', description: 'Duyệt phiếu kiểm kê điều chỉnh tồn kho' },
  { code: 'PURCHASE_CREATE', module: 'Quản lý Kho', description: 'Tạo phiếu nhập hàng (Draft)' },
  { code: 'PURCHASE_APPROVE', module: 'Quản lý Kho', description: 'Duyệt hoặc hủy phiếu nhập hàng' },
  { code: 'SUPPLIER_VIEW', module: 'Khuyến mãi & Đối tác', description: 'Tra cứu thông tin nhà cung cấp' },
  { code: 'SUPPLIER_MANAGE', module: 'Khuyến mãi & Đối tác', description: 'Thêm, sửa, ngừng hợp tác nhà cung cấp' },
  { code: 'CUSTOMER_MANAGE', module: 'Khuyến mãi & Đối tác', description: 'Tra cứu và quản lý thông tin khách hàng' },
  { code: 'PROMOTION_MANAGE', module: 'Khuyến mãi & Đối tác', description: 'Quản lý chương trình khuyến mãi' },
  { code: 'REPORT_VIEW', module: 'Báo cáo & Thống kê', description: 'Xem báo cáo doanh thu, tồn kho và bán chạy' },
  { code: 'REPORT_PROFIT', module: 'Báo cáo & Thống kê', description: 'Xem báo cáo lợi nhuận và giá vốn' },
  { code: 'STAFF_MANAGE', module: 'Quản trị Hệ thống', description: 'Quản trị tài khoản nhân viên, gán vai trò, khóa/mở khóa' },
  { code: 'THAM_SO_MANAGE', module: 'Quản trị Hệ thống', description: 'Cấu hình bảng THAM_SO hệ thống' },
  { code: 'AUDIT_LOG_VIEW', module: 'Quản trị Hệ thống', description: 'Xem nhật ký kiểm toán bất biến (Audit Log)' },
  { code: 'BACKUP_MANAGE', module: 'Quản trị Hệ thống', description: 'Sao lưu và phục hồi dữ liệu hệ thống' },
];

const ROLE_PERMISSION_MATRIX = {
  ADMIN: PERMISSION_DEFINITIONS.map((p) => p.code),
  MANAGER: [
    'DASHBOARD_VIEW',
    'POS_SELL',
    'ORDER_VIEW',
    'RETURN_CREATE',
    'RETURN_APPROVE',
    'PRODUCT_VIEW',
    'PRODUCT_COST_VIEW',
    'PRODUCT_MANAGE',
    'CATEGORY_MANAGE',
    'INVENTORY_VIEW',
    'INVENTORY_AUDIT',
    'INVENTORY_APPROVE',
    'PURCHASE_CREATE',
    'PURCHASE_APPROVE',
    'SUPPLIER_VIEW',
    'SUPPLIER_MANAGE',
    'CUSTOMER_MANAGE',
    'PROMOTION_MANAGE',
    'REPORT_VIEW',
    'REPORT_PROFIT',
  ],
  CASHIER: [
    'POS_SELL',
    'ORDER_VIEW',
    'RETURN_CREATE',
    'PRODUCT_VIEW',
    'CUSTOMER_MANAGE',
  ],
  WAREHOUSE: [
    'PRODUCT_VIEW',
    'PRODUCT_COST_VIEW',
    'INVENTORY_VIEW',
    'INVENTORY_AUDIT',
    'PURCHASE_CREATE',
    'SUPPLIER_VIEW',
  ],
};

const DEFAULT_THAM_SO = [
  {
    ma_tham_so: 'TenCuaHang',
    ten_tham_so: 'Tên cửa hàng',
    kieu_du_lieu: 'STRING',
    gia_tri: 'RetailFlow — Chi nhánh chính',
    nhom_tham_so: 'CUA_HANG',
    mo_ta: 'Tên hiển thị trên hóa đơn và báo cáo kết xuất.',
  },
  {
    ma_tham_so: 'DiaChiCuaHang',
    ten_tham_so: 'Địa chỉ cửa hàng',
    kieu_du_lieu: 'STRING',
    gia_tri: '123 Nguyễn Thị Minh Khai, Quận 3, TP. HCM',
    nhom_tham_so: 'CUA_HANG',
    mo_ta: 'Địa chỉ kinh doanh in trên chứng từ bán lẻ.',
  },
  {
    ma_tham_so: 'HotlineCuaHang',
    ten_tham_so: 'Số điện thoại / Hotline',
    kieu_du_lieu: 'STRING',
    gia_tri: '028 3822 3456',
    nhom_tham_so: 'CUA_HANG',
    mo_ta: 'Số liên hệ hỗ trợ khách hàng và đổi trả.',
  },
  {
    ma_tham_so: 'TyLeVAT',
    ten_tham_so: 'Tỷ lệ thuế VAT (%)',
    kieu_du_lieu: 'NUMBER',
    gia_tri: '8',
    nhom_tham_so: 'NGHIEP_VU',
    mo_ta: 'Áp dụng cho bước 4 tính tiền hóa đơn theo BR-04 (0 - 100%).',
  },
  {
    ma_tham_so: 'TonToiThieuMacDinh',
    ten_tham_so: 'Ngưỡng tồn tối thiểu mặc định',
    kieu_du_lieu: 'NUMBER',
    gia_tri: '15',
    nhom_tham_so: 'NGHIEP_VU',
    mo_ta: 'Cảnh báo sắp hết hàng theo BR-01 khi TonHienTai <= TonToiThieu.',
  },
  {
    ma_tham_so: 'SoNgayChoPhepTraHang',
    ten_tham_so: 'Số ngày cho phép trả hàng',
    kieu_du_lieu: 'NUMBER',
    gia_tri: '7',
    nhom_tham_so: 'NGHIEP_VU',
    mo_ta: 'Giới hạn thời hạn lập phiếu trả hàng kể từ ngày thanh toán (BR-05).',
  },
  {
    ma_tham_so: 'TyLeGiamGiaDongToiDa',
    ten_tham_so: 'Tỷ lệ giảm giá dòng hàng tối đa của Thu ngân (%)',
    kieu_du_lieu: 'NUMBER',
    gia_tri: '10',
    nhom_tham_so: 'NGHIEP_VU',
    mo_ta: 'Hạn mức giảm giá tay tối đa (%) trên mỗi dòng hàng cho vai trò Thu ngân; vượt mức cần Quản lý/Admin thực hiện.',
  },
  {
    ma_tham_so: 'NganHangVietQR',
    ten_tham_so: 'Ngân hàng nhận VietQR',
    kieu_du_lieu: 'STRING',
    gia_tri: 'Vietcombank',
    nhom_tham_so: 'THANH_TOAN',
    mo_ta: 'Ngân hàng hiển thị khi thanh toán chuyển khoản / VietQR.',
  },
  {
    ma_tham_so: 'SoTaiKhoanVietQR',
    ten_tham_so: 'Số tài khoản VietQR',
    kieu_du_lieu: 'STRING',
    gia_tri: '0123456789',
    nhom_tham_so: 'THANH_TOAN',
    mo_ta: 'Số tài khoản nhận chuyển khoản tại quầy.',
  },
  {
    ma_tham_so: 'ChuTaiKhoanVietQR',
    ten_tham_so: 'Chủ tài khoản VietQR',
    kieu_du_lieu: 'STRING',
    gia_tri: 'CUA HANG RETAILFLOW',
    nhom_tham_so: 'THANH_TOAN',
    mo_ta: 'Tên chủ tài khoản hiển thị cho khách đối chiếu.',
  },
  {
    ma_tham_so: 'LoiNhanHoaDon',
    ten_tham_so: 'Lời nhắn cuối hóa đơn',
    kieu_du_lieu: 'STRING',
    gia_tri: 'Cảm ơn quý khách đã mua sắm tại RetailFlow. Hẹn gặp lại!',
    nhom_tham_so: 'CUA_HANG',
    mo_ta: 'Thông điệp in ở chân hóa đơn bán hàng.',
  },
];

const DEFAULT_CATEGORIES = [
  { code: 'DM01', name: 'Sữa & Đồ uống', description: 'Sữa tươi, sữa chua, nước tinh khiết, nước ngọt, trà, cà phê' },
  { code: 'DM02', name: 'Mì & Thực phẩm tiện lợi', description: 'Mì ăn liền, phở, miến, gạo, ngũ cốc, đồ ăn nhanh' },
  { code: 'DM03', name: 'Gia vị & Nhu yếu phẩm', description: 'Dầu ăn, nước mắm, nước tương, hạt nêm, đường, muối' },
  { code: 'DM04', name: 'Snack & Bánh kẹo', description: 'Bánh quy, snack khoai tây, kẹo, hạt dinh dưỡng' },
  { code: 'DM05', name: 'Chăm sóc cá nhân & Tiện ích', description: 'Dầu gội, sữa tắm, bột giặt, nước rửa chén, khăn giấy' },
  { code: 'DM06', name: 'Đồ ăn liền & Chế biến sẵn', description: 'Bánh mì, sandwich, cơm hộp, đồ ăn nóng dùng ngay' },
];

const DEFAULT_UNITS = [
  { code: 'DVT01', name: 'hộp' },
  { code: 'DVT02', name: 'chai' },
  { code: 'DVT03', name: 'lon' },
  { code: 'DVT04', name: 'gói' },
  { code: 'DVT05', name: 'túi' },
  { code: 'DVT06', name: 'hũ' },
  { code: 'DVT07', name: 'lốc' },
  { code: 'DVT08', name: 'cái' },
  { code: 'DVT09', name: 'cuộn' },
  { code: 'DVT10', name: 'chiếc' },
  { code: 'DVT11', name: 'tuýp' },
  { code: 'DVT12', name: 'quả' },
  { code: 'DVT13', name: 'ly' },
  { code: 'DVT14', name: 'đôi' },
];

const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- ============================================================================
-- NHÓM 1: PHÂN QUYỀN RBAC & NGƯỜI DÙNG (Chuẩn 9 quy tắc OOD — chỉ lớp persistent)
-- ============================================================================
CREATE TABLE IF NOT EXISTS roles (
  code TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  short_name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS permissions (
  code TEXT PRIMARY KEY,
  module TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_code TEXT NOT NULL,
  permission_code TEXT NOT NULL,
  PRIMARY KEY (role_code, permission_code),
  FOREIGN KEY (role_code) REFERENCES roles(code) ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY (permission_code) REFERENCES permissions(code) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  role_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'LOCKED')),
  must_change_password INTEGER NOT NULL DEFAULT 0,
  last_login_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (role_code) REFERENCES roles(code) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS revoked_tokens (
  jti TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  revoked_at TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ============================================================================
-- NHÓM 2: CẤU HÌNH THAM_SO (DẠNG DÒNG) & NHẬT KÝ KIỂM TOÁN BẤT BIẾN (AUDIT LOG)
-- ============================================================================
CREATE TABLE IF NOT EXISTS tham_so (
  ma_tham_so TEXT PRIMARY KEY,
  ten_tham_so TEXT NOT NULL,
  kieu_du_lieu TEXT NOT NULL CHECK (kieu_du_lieu IN ('STRING', 'NUMBER', 'BOOLEAN')),
  gia_tri TEXT NOT NULL,
  nhom_tham_so TEXT NOT NULL DEFAULT 'CHUNG',
  mo_ta TEXT NOT NULL DEFAULT '',
  tinh_trang TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (tinh_trang IN ('ACTIVE', 'INACTIVE')),
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT 'Hệ thống'
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_id TEXT,
  actor_username TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  before_json TEXT,
  after_json TEXT,
  created_at TEXT NOT NULL
);

-- ============================================================================
-- NHÓM 3: DANH MỤC RỜI RẠC (DanhMuc, DonViTinh, ChiNhanh) & ĐỐI TÁC
-- ============================================================================
CREATE TABLE IF NOT EXISTS categories (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'HoatDong' CHECK (status IN ('HoatDong', 'NgungSuDung')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS units (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'HoatDong' CHECK (status IN ('HoatDong', 'NgungSuDung')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS branches (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  area TEXT NOT NULL DEFAULT 'TP. HCM',
  status TEXT NOT NULL DEFAULT 'HoatDong' CHECK (status IN ('HoatDong', 'DeXuat', 'NgungHoatDong')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  category_group TEXT NOT NULL DEFAULT '',
  areas TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'HoatDong' CHECK (status IN ('HoatDong', 'NgungHopTac')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS branch_suppliers (
  branch_id TEXT NOT NULL,
  supplier_id TEXT NOT NULL,
  PRIMARY KEY (branch_id, supplier_id),
  FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'HoatDong' CHECK (status IN ('HoatDong', 'TamNgung')),
  created_at TEXT NOT NULL
);

-- ============================================================================
-- NHÓM 4: HÀNG HÓA, LÔ HÀNG, KHUYẾN MÃI & CHỨNG TỪ GIAO DỊCH (M2 - M5 READY)
-- ============================================================================
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE,
  barcode TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  brand TEXT NOT NULL DEFAULT '',
  pack_size TEXT NOT NULL DEFAULT '',
  category_code TEXT NOT NULL,
  unit_code TEXT NOT NULL,
  supplier_id TEXT NOT NULL,
  sale_price INTEGER NOT NULL CHECK (sale_price >= 0),
  cost_price INTEGER NOT NULL CHECK (cost_price >= 0),
  stock_qty INTEGER NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),
  min_stock INTEGER NOT NULL DEFAULT 15 CHECK (min_stock >= 0),
  image_url TEXT NOT NULL DEFAULT 'assets/images/products/default.jpg',
  status TEXT NOT NULL DEFAULT 'DangKinhDoanh' CHECK (status IN ('DangKinhDoanh', 'NgungKinhDoanh')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (category_code) REFERENCES categories(code) ON DELETE RESTRICT,
  FOREIGN KEY (unit_code) REFERENCES units(code) ON DELETE RESTRICT,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS promotions (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  discount_type TEXT NOT NULL CHECK (discount_type IN ('PERCENT', 'FIXED')),
  discount_value INTEGER NOT NULL CHECK (discount_value >= 0),
  min_order_amount INTEGER NOT NULL DEFAULT 0 CHECK (min_order_amount >= 0),
  max_discount INTEGER NOT NULL DEFAULT 0 CHECK (max_discount >= 0),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  usage_limit INTEGER NOT NULL DEFAULT 1000 CHECK (usage_limit >= 1),
  used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  status TEXT NOT NULL DEFAULT 'DangDienRa' CHECK (status IN ('SapDienRa', 'DangDienRa', 'TamDung', 'KetThuc', 'DaHuy')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS promotion_products (
  promotion_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  PRIMARY KEY (promotion_id, product_id),
  FOREIGN KEY (promotion_id) REFERENCES promotions(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS purchases (
  id TEXT PRIMARY KEY,
  supplier_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  approved_by TEXT,
  total_amount INTEGER NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Confirmed', 'Cancelled')),
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS purchase_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK (qty > 0),
  unit_cost INTEGER NOT NULL CHECK (unit_cost >= 0),
  FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  customer_id TEXT,
  cashier_id TEXT NOT NULL,
  promotion_id TEXT,
  subtotal INTEGER NOT NULL CHECK (subtotal >= 0),
  invoice_discount INTEGER NOT NULL DEFAULT 0 CHECK (invoice_discount >= 0),
  tax_rate REAL NOT NULL DEFAULT 0 CHECK (tax_rate >= 0),
  tax_amount INTEGER NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  total_amount INTEGER NOT NULL CHECK (total_amount >= 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('CASH', 'VIETQR', 'CARD')),
  cash_received INTEGER NOT NULL DEFAULT 0 CHECK (cash_received >= 0),
  cash_change INTEGER NOT NULL DEFAULT 0 CHECK (cash_change >= 0),
  payment_ref TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'DaThanhToan' CHECK (status IN ('DaThanhToan', 'TraMotPhan', 'DaHoanTra', 'DaHuy')),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
  FOREIGN KEY (cashier_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (promotion_id) REFERENCES promotions(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name_snapshot TEXT NOT NULL,
  unit_price_snapshot INTEGER NOT NULL CHECK (unit_price_snapshot >= 0),
  unit_cost_snapshot INTEGER NOT NULL CHECK (unit_cost_snapshot >= 0),
  qty INTEGER NOT NULL CHECK (qty > 0),
  line_discount INTEGER NOT NULL DEFAULT 0 CHECK (line_discount >= 0),
  returned_qty INTEGER NOT NULL DEFAULT 0 CHECK (returned_qty >= 0),
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS returns (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  approved_by TEXT,
  reason TEXT NOT NULL,
  restock INTEGER NOT NULL DEFAULT 1,
  refund_amount INTEGER NOT NULL DEFAULT 0 CHECK (refund_amount >= 0),
  status TEXT NOT NULL DEFAULT 'ChoDuyet' CHECK (status IN ('ChoDuyet', 'DaXacNhan', 'TuChoi')),
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS return_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  return_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK (qty > 0),
  refund_line_amount INTEGER NOT NULL DEFAULT 0 CHECK (refund_line_amount >= 0),
  FOREIGN KEY (return_id) REFERENCES returns(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  stock_before INTEGER NOT NULL,
  delta INTEGER NOT NULL,
  stock_after INTEGER NOT NULL CHECK (stock_after >= 0),
  doc_type TEXT NOT NULL,
  doc_id TEXT NOT NULL,
  actor_id TEXT,
  actor_name TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
  FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS stock_audits (
  id TEXT PRIMARY KEY,
  created_by TEXT NOT NULL,
  approved_by TEXT,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ChoDuyet' CHECK (status IN ('ChoDuyet', 'DaDuyet', 'DaHuy')),
  created_at TEXT NOT NULL,
  approved_at TEXT,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS stock_audit_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  audit_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  system_qty INTEGER NOT NULL,
  actual_qty INTEGER NOT NULL CHECK (actual_qty >= 0),
  diff_qty INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (audit_id) REFERENCES stock_audits(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_username);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role_code);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_code);
CREATE INDEX IF NOT EXISTS idx_products_supplier ON products(supplier_id);
CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON stock_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_created ON stock_movements(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_purchases_status_created ON purchases(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_purchases_supplier ON purchases(supplier_id);
CREATE INDEX IF NOT EXISTS idx_stock_audits_status_created ON stock_audits(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_promotions_code ON promotions(code);
CREATE INDEX IF NOT EXISTS idx_promotions_status ON promotions(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_returns_order ON returns(order_id);
CREATE INDEX IF NOT EXISTS idx_returns_status_created ON returns(status, created_at DESC);

-- ============================================================================
-- TRIGGERS BẤT BIẾN (APPEND-ONLY) TẠI TẦNG CSDL CHO AUDIT_LOGS & STOCK_MOVEMENTS
-- ============================================================================
CREATE TRIGGER IF NOT EXISTS trg_audit_logs_no_update
BEFORE UPDATE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'audit_logs là bảng bất biến (append-only), cấm UPDATE.');
END;

CREATE TRIGGER IF NOT EXISTS trg_audit_logs_no_delete
BEFORE DELETE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'audit_logs là bảng bất biến (append-only), cấm DELETE.');
END;

CREATE TRIGGER IF NOT EXISTS trg_stock_movements_no_update
BEFORE UPDATE ON stock_movements
BEGIN
  SELECT RAISE(ABORT, 'stock_movements (LichSuTonKho) là bảng bất biến (append-only), cấm UPDATE.');
END;

CREATE TRIGGER IF NOT EXISTS trg_stock_movements_no_delete
BEFORE DELETE ON stock_movements
BEGIN
  SELECT RAISE(ABORT, 'stock_movements (LichSuTonKho) là bảng bất biến (append-only), cấm DELETE.');
END;
`;

function openDatabase(dbPath) {
  const targetPath = dbPath || process.env.DB_PATH || path.resolve(__dirname, '../../../data/retailflow.db');
  if (targetPath !== ':memory:') {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  }
  const db = new DatabaseSync(targetPath);
  db.exec(SCHEMA_SQL);
  seedCoreData(db);
  return db;
}

function withTransaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore rollback error when no transaction active
    }
    throw err;
  }
}

function seedCoreData(db) {
  const nowMs = Date.now();
  const dayMs = 86400000;
  const nowIso = new Date(nowMs).toISOString();
  const isoDaysAgo = (daysAgo, vnHour = 10, minute = 15) => {
    const d = new Date(nowMs - daysAgo * dayMs);
    const utcHour = Math.max(1, Math.min(22, Number(vnHour) - 7));
    d.setUTCHours(utcHour, minute, 0, 0);
    return d.toISOString();
  };
  const openingIso = isoDaysAgo(7, 8, 0);
  withTransaction(db, () => {
    const upsertRole = db.prepare(`
      INSERT INTO roles (code, display_name, short_name, description)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(code) DO UPDATE SET
        display_name = excluded.display_name,
        short_name = excluded.short_name,
        description = excluded.description
    `);
    for (const r of ROLE_DEFINITIONS) {
      upsertRole.run(r.code, r.display_name, r.short_name, r.description);
    }

    const upsertPerm = db.prepare(`
      INSERT INTO permissions (code, module, description)
      VALUES (?, ?, ?)
      ON CONFLICT(code) DO UPDATE SET
        module = excluded.module,
        description = excluded.description
    `);
    for (const p of PERMISSION_DEFINITIONS) {
      upsertPerm.run(p.code, p.module, p.description);
    }

    const insertRolePerm = db.prepare(`
      INSERT OR IGNORE INTO role_permissions (role_code, permission_code)
      VALUES (?, ?)
    `);
    for (const [roleCode, perms] of Object.entries(ROLE_PERMISSION_MATRIX)) {
      for (const permCode of perms) {
        insertRolePerm.run(roleCode, permCode);
      }
    }

    const userCount = db.prepare('SELECT COUNT(*) AS cnt FROM users').get().cnt;
    if (userCount === 0) {
      const insertUser = db.prepare(`
        INSERT INTO users (id, username, password_hash, full_name, email, phone, role_code, status, must_change_password, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 0, ?, ?)
      `);
      const seedUsers = [
        ['NV001', 'admin', 'Lê Hoàng Nam', 'admin@retailflow.vn', '0901000001', 'ADMIN'],
        ['NV002', 'quanly', 'Phạm Minh Quân', 'quanly@retailflow.vn', '0901000002', 'MANAGER'],
        ['NV003', 'thungan', 'Nguyễn Hà Linh', 'thungan@retailflow.vn', '0901000003', 'CASHIER'],
        ['NV004', 'kho', 'Trần Quốc Bảo', 'kho@retailflow.vn', '0901000004', 'WAREHOUSE'],
      ];
      for (const [uid, username, fullName, email, phone, roleCode] of seedUsers) {
        insertUser.run(uid, username, hashPassword('123456'), fullName, email, phone, roleCode, nowIso, nowIso);
      }
    }

    const insertThamSo = db.prepare(`
      INSERT OR IGNORE INTO tham_so (ma_tham_so, ten_tham_so, kieu_du_lieu, gia_tri, nhom_tham_so, mo_ta, tinh_trang, updated_at, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, 'Hệ thống')
    `);
    for (const ts of DEFAULT_THAM_SO) {
      insertThamSo.run(ts.ma_tham_so, ts.ten_tham_so, ts.kieu_du_lieu, ts.gia_tri, ts.nhom_tham_so, ts.mo_ta, nowIso);
    }

    const insertCategory = db.prepare(`
      INSERT OR IGNORE INTO categories (code, name, description, status, created_at)
      VALUES (?, ?, ?, 'HoatDong', ?)
    `);
    for (const c of DEFAULT_CATEGORIES) {
      insertCategory.run(c.code, c.name, c.description, nowIso);
    }

    const insertUnit = db.prepare(`
      INSERT OR IGNORE INTO units (code, name, status, created_at)
      VALUES (?, ?, 'HoatDong', ?)
    `);
    for (const u of DEFAULT_UNITS) {
      insertUnit.run(u.code, u.name, nowIso);
    }

    const insertBranch = db.prepare(`
      INSERT OR IGNORE INTO branches (id, name, address, area, status, created_at)
      VALUES ('CN001', 'Chi nhánh chính', '123 Nguyễn Thị Minh Khai, Quận 3, TP. HCM', 'TP. HCM', 'HoatDong', ?)
    `);
    insertBranch.run(nowIso);

    // Seed suppliers, products (93 real SKU with 1-1 images in assets/images/products/), and opening stock_movements
    const supplierCount = db.prepare('SELECT COUNT(*) AS cnt FROM suppliers').get().cnt;
    const productCount = db.prepare('SELECT COUNT(*) AS cnt FROM products').get().cnt;
    if (supplierCount === 0 || productCount === 0) {
      const { seed } = require('../../domain/seed.js');
      const seeded = seed();

      if (supplierCount === 0) {
        const insertSupplier = db.prepare(`
          INSERT OR IGNORE INTO suppliers (id, name, phone, category_group, areas, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        const insertBranchSupplier = db.prepare(`
          INSERT OR IGNORE INTO branch_suppliers (branch_id, supplier_id)
          VALUES ('CN001', ?)
        `);
        for (const sup of seeded.suppliers || []) {
          insertSupplier.run(
            sup.id,
            sup.name,
            sup.phone || '',
            sup.category || '',
            sup.areas || '',
            sup.active === false ? 'NgungHopTac' : 'HoatDong',
            nowIso,
          );
          insertBranchSupplier.run(sup.id);
        }
      }

      if (productCount === 0) {
        const catMap = new Map(
          db.prepare('SELECT code, name FROM categories').all().map((r) => [r.name.toLowerCase(), r.code]),
        );
        const unitMap = new Map(
          db.prepare('SELECT code, name FROM units').all().map((r) => [r.name.toLowerCase(), r.code]),
        );
        const insertProduct = db.prepare(`
          INSERT OR IGNORE INTO products (
            id, sku, barcode, name, brand, pack_size,
            category_code, unit_code, supplier_id,
            sale_price, cost_price, stock_qty, min_stock,
            image_url, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const insertMovement = db.prepare(`
          INSERT OR IGNORE INTO stock_movements (
            id, product_id, stock_before, delta, stock_after,
            doc_type, doc_id, actor_id, actor_name, note, created_at
          ) VALUES (?, ?, 0, ?, ?, 'KHOI_TAO_TON', ?, 'NV001', 'Hệ thống', ?, ?)
        `);

        for (const prod of seeded.products || []) {
          const catCode = catMap.get(String(prod.category || '').toLowerCase()) || 'DM01';
          const unitCode = unitMap.get(String(prod.unit || '').toLowerCase()) || 'DVT01';
          const salePrice = Math.max(0, Math.round(Number(prod.price) || 0));
          const costPrice = Math.max(0, Math.round(Number(prod.costPrice ?? prod.cost) || 0));
          const stockQty = Math.max(0, Math.round(Number(prod.stock) || 0));
          const minStock = Math.max(0, Math.round(Number(prod.minStock) || 15));
          const imgUrl =
            prod.imageUrl && prod.imageUrl !== 'assets/images/products/default.jpg'
              ? prod.imageUrl
              : 'assets/images/products/milk_vinamilk.jpg';
          insertProduct.run(
            prod.id,
            prod.id,
            prod.barcode,
            prod.name,
            prod.brand || '',
            prod.packSize || '',
            catCode,
            unitCode,
            prod.supplierId || 'NCC001',
            salePrice,
            costPrice,
            stockQty,
            minStock,
            imgUrl,
            prod.active === false ? 'NgungKinhDoanh' : 'DangKinhDoanh',
            nowIso,
            nowIso,
          );
          if (stockQty > 0) {
            insertMovement.run(
              `STK-SEED-${prod.id}`,
              prod.id,
              stockQty,
              stockQty,
              `INIT-${prod.id}`,
              `Khởi tạo tồn kho đầu kỳ cho ${prod.name}`,
              openingIso,
            );
          }
        }
      }
    }

    // Seed default customers & promotions for M4 POS (does not create orders or extra stock_movements)
    const customerCount = db.prepare('SELECT COUNT(*) AS cnt FROM customers').get().cnt;
    if (customerCount === 0) {
      const insertCustomer = db.prepare(`
        INSERT OR IGNORE INTO customers (id, name, phone, email, status, created_at)
        VALUES (?, ?, ?, ?, 'HoatDong', ?)
      `);
      const seedCustomers = [
        ['KH001', 'Nguyễn Minh Anh', '0901234567', 'minhanh@gmail.com'],
        ['KH002', 'Trần Thanh Tùng', '0912345678', 'thanhtung@gmail.com'],
        ['KH003', 'Lê Thảo Vy', '0987654321', 'thaovy@gmail.com'],
        ['KH004', 'Phạm Gia Huy', '0938112233', 'giahuy@gmail.com'],
      ];
      for (const [cid, cname, cphone, cemail] of seedCustomers) {
        insertCustomer.run(cid, cname, cphone, cemail, nowIso);
      }
    }

    const promoCount = db.prepare('SELECT COUNT(*) AS cnt FROM promotions').get().cnt;
    if (promoCount === 0) {
      const dayMs = 86400000;
      const toYmd = (d) => d.toISOString().slice(0, 10);
      const startActive = toYmd(new Date(Date.now() - 30 * dayMs));
      const endActive = toYmd(new Date(Date.now() + 180 * dayMs));
      const startFuture = toYmd(new Date(Date.now() + 30 * dayMs));
      const endFuture = toYmd(new Date(Date.now() + 90 * dayMs));
      const insertPromo = db.prepare(`
        INSERT OR IGNORE INTO promotions (
          id, code, name, discount_type, discount_value, min_order_amount,
          max_discount, start_date, end_date, usage_limit, used_count, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      `);
      const seedPromos = [
        ['KM001', 'GIAM10', 'Giảm 10% hóa đơn từ 100.000 ₫ (tối đa 50.000 ₫)', 'PERCENT', 10, 100000, 50000, startActive, endActive, 500, 'DangDienRa'],
        ['KM002', 'GIAM20K', 'Giảm thẳng 20.000 ₫ cho đơn từ 150.000 ₫', 'FIXED', 20000, 150000, 0, startActive, endActive, 300, 'DangDienRa'],
        ['KM003', 'SAPMO15', 'Ưu đãi sắp mở giảm 15% (tối đa 80.000 ₫)', 'PERCENT', 15, 200000, 80000, startFuture, endFuture, 200, 'SapDienRa'],
      ];
      for (const p of seedPromos) {
        insertPromo.run(...p, nowIso);
      }
    }

    // Seed realistic historical paid orders & 1 approved partial return across the last 7 days
    // (Does NOT mutate stock_movements or promotions.used_count so opening KHOI_TAO_TON = 93 and promo counters stay clean)
    const orderCount = db.prepare('SELECT COUNT(*) AS cnt FROM orders').get().cnt;
    if (orderCount === 0) {
      const prods = db.prepare("SELECT id, name, sale_price, cost_price FROM products WHERE status = 'DangKinhDoanh' ORDER BY id ASC").all();
      const prodById = new Map(prods.map((p) => [p.id, p]));
      const pick = (id, fallbackIdx) => prodById.get(id) || prods[fallbackIdx % prods.length];
      if (prods.length >= 12) {

        const sampleOrders = [
          {
            id: 'HD0001',
            customerId: 'KH001',
            cashierId: 'NV003',
            method: 'CASH',
            ref: '',
            daysAgo: 6,
            hour: 9,
            lines: [
              { prod: pick('SP001', 0), qty: 4 },
              { prod: pick('SP002', 1), qty: 10 },
              { prod: pick('SP015', 14), qty: 2 },
            ],
          },
          {
            id: 'HD0002',
            customerId: 'KH002',
            cashierId: 'NV003',
            method: 'VIETQR',
            ref: 'VQR260501',
            daysAgo: 5,
            hour: 11,
            lines: [
              { prod: pick('SP003', 2), qty: 3 },
              { prod: pick('SP020', 19), qty: 2 },
              { prod: pick('SP030', 29), qty: 3 },
            ],
          },
          {
            id: 'HD0003',
            customerId: null,
            cashierId: 'NV003',
            method: 'CARD',
            ref: 'POS-CARD-4412',
            daysAgo: 4,
            hour: 14,
            lines: [
              { prod: pick('SP004', 3), qty: 6 },
              { prod: pick('SP040', 39), qty: 2 },
            ],
          },
          {
            id: 'HD0004',
            customerId: 'KH003',
            cashierId: 'NV002',
            method: 'VIETQR',
            ref: 'VQR260502',
            daysAgo: 3,
            hour: 16,
            lines: [
              { prod: pick('SP001', 0), qty: 6 },
              { prod: pick('SP050', 49), qty: 3 },
              { prod: pick('SP060', 59), qty: 2 },
            ],
          },
          {
            id: 'HD0005',
            customerId: 'KH001',
            cashierId: 'NV003',
            method: 'CASH',
            ref: '',
            daysAgo: 2,
            hour: 10,
            lines: [
              { prod: pick('SP005', 4), qty: 5 },
              { prod: pick('SP070', 69), qty: 2 },
            ],
          },
          {
            id: 'HD0006',
            customerId: 'KH004',
            cashierId: 'NV003',
            method: 'VIETQR',
            ref: 'VQR260503',
            daysAgo: 1,
            hour: 15,
            status: 'TraMotPhan',
            lines: [
              { prod: pick('SP001', 0), qty: 5, returnedQty: 1 },
              { prod: pick('SP010', 9), qty: 3, returnedQty: 0 },
            ],
          },
          {
            id: 'HD0007',
            customerId: 'KH002',
            cashierId: 'NV003',
            method: 'CASH',
            ref: '',
            daysAgo: 1,
            hour: 9,
            lines: [
              { prod: pick('SP002', 1), qty: 12 },
              { prod: pick('SP003', 2), qty: 2 },
              { prod: pick('SP025', 24), qty: 3 },
            ],
          },
          {
            id: 'HD0008',
            customerId: 'KH003',
            cashierId: 'NV002',
            method: 'VIETQR',
            ref: 'VQR260504',
            daysAgo: 1,
            hour: 11,
            lines: [
              { prod: pick('SP004', 3), qty: 4 },
              { prod: pick('SP045', 44), qty: 2 },
              { prod: pick('SP080', 79), qty: 2 },
            ],
          },
        ];

        const insertOrder = db.prepare(`
          INSERT INTO orders (
            id, customer_id, cashier_id, promotion_id,
            subtotal, invoice_discount, tax_rate, tax_amount, total_amount,
            payment_method, cash_received, cash_change, payment_ref,
            status, note, created_at
          ) VALUES (?, ?, ?, NULL, ?, 0, 8, ?, ?, ?, ?, 0, ?, ?, ?, ?)
        `);
        const insertOrderItem = db.prepare(`
          INSERT INTO order_items (
            order_id, product_id, product_name_snapshot,
            unit_price_snapshot, unit_cost_snapshot,
            qty, line_discount, returned_qty
          ) VALUES (?, ?, ?, ?, ?, ?, 0, ?)
        `);

        let hd0006Ref = null;
        for (const o of sampleOrders) {
          const subtotal = o.lines.reduce((s, l) => s + l.qty * Number(l.prod.sale_price), 0);
          const taxAmount = Math.round((subtotal * 8) / 100);
          const totalAmount = subtotal + taxAmount;
          const createdAt = isoDaysAgo(o.daysAgo, o.hour, 20);
          insertOrder.run(
            o.id,
            o.customerId,
            o.cashierId,
            subtotal,
            taxAmount,
            totalAmount,
            o.method,
            totalAmount,
            o.ref,
            o.status || 'DaThanhToan',
            'Giao dịch bán lẻ mẫu chuẩn BR-03/BR-04',
            createdAt,
          );
          for (const l of o.lines) {
            insertOrderItem.run(
              o.id,
              l.prod.id,
              l.prod.name,
              Number(l.prod.sale_price),
              Number(l.prod.cost_price),
              l.qty,
              l.returnedQty || 0,
            );
          }
          if (o.id === 'HD0006') {
            hd0006Ref = { ...o, subtotal, totalAmount, createdAt };
          }
        }

        // Seed 1 approved partial return (TH0001) on HD0006 so net revenue & returns reports have real data
        if (hd0006Ref) {
          const retLine = hd0006Ref.lines[0];
          const linePaidTotal = Math.floor(
            (hd0006Ref.totalAmount * (retLine.qty * Number(retLine.prod.sale_price))) / hd0006Ref.subtotal,
          );
          const refundAmt = Math.floor((linePaidTotal * 1) / retLine.qty);
          const retCreatedAt = isoDaysAgo(1, 16, 10);
          const retResolvedAt = isoDaysAgo(1, 17, 5);
          db.prepare(`
            INSERT INTO returns (
              id, order_id, created_by, approved_by, reason, restock, refund_amount, status, created_at, resolved_at
            ) VALUES ('TH0001', 'HD0006', 'NV003', 'NV002', 'Khách mua dư 1 sản phẩm còn nguyên tem', 1, ?, 'DaXacNhan', ?, ?)
          `).run(refundAmt, retCreatedAt, retResolvedAt);
          db.prepare(`
            INSERT INTO return_items (return_id, product_id, qty, refund_line_amount)
            VALUES ('TH0001', ?, 1, ?)
          `).run(retLine.prod.id, refundAmt);
        }
      }
    }

    const logCount = db.prepare('SELECT COUNT(*) AS cnt FROM audit_logs').get().cnt;
    if (logCount === 0) {
      db.prepare(`
        INSERT INTO audit_logs (id, actor_id, actor_username, actor_name, actor_role, action, entity_type, entity_id, detail, created_at)
        VALUES ('AUD-SEED-001', NULL, 'system', 'Hệ thống', 'SYSTEM', 'SYSTEM_INIT', 'Database', 'retailflow.db', 'Khởi tạo CSDL chuẩn 9 quy tắc, 4 vai trò RBAC, 4 tài khoản mẫu, bảng THAM_SO và danh mục 93 SKU.', ?)
      `).run(nowIso);
    }
  });
}

module.exports = {
  openDatabase,
  withTransaction,
  ROLE_DEFINITIONS,
  PERMISSION_DEFINITIONS,
  ROLE_PERMISSION_MATRIX,
  DEFAULT_THAM_SO,
};
