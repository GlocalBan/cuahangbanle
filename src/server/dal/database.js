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
  {
    code: 'SUPPLIER',
    display_name: 'Nhà cung cấp (NhaCungCap)',
    short_name: 'NhaCungCap',
    description: 'Cổng nhà cung cấp xác nhận, phản hồi giá/số lượng và thương lượng đơn đặt hàng (PO) của riêng mình.',
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
  { code: 'BATCH_MANAGE', module: 'Quản lý Kho', description: 'Quản lý lô hàng, hàng cận date và duyệt hủy hàng hết hạn/hư hỏng' },
  { code: 'VOUCHER_MANAGE', module: 'Khuyến mãi & Đối tác', description: 'Tạo, phát hành hàng loạt và quản lý mã Voucher giảm giá' },
  { code: 'SHIFT_MANAGE', module: 'Bán hàng (POS)', description: 'Mở ca, chốt ca và đối soát tiền mặt quầy thu ngân' },
  { code: 'PAYABLE_MANAGE', module: 'Quản lý Kho', description: 'Quản lý công nợ nhà cung cấp, thanh toán và trả hàng NCC' },
  { code: 'AUDIT_ADMIN_APPROVE', module: 'Quản lý Kho', description: 'Duyệt kiểm kê kho vượt ngưỡng giá trị lớn (cấp Admin)' },
  { code: 'SUPPLIER_PORTAL', module: 'Khuyến mãi & Đối tác', description: 'Cổng nhà cung cấp xác nhận và thương lượng đơn đặt hàng (PO)' },
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
    'BATCH_MANAGE',
    'PURCHASE_CREATE',
    'PURCHASE_APPROVE',
    'PAYABLE_MANAGE',
    'SUPPLIER_VIEW',
    'SUPPLIER_MANAGE',
    'CUSTOMER_MANAGE',
    'PROMOTION_MANAGE',
    'VOUCHER_MANAGE',
    'SHIFT_MANAGE',
    'REPORT_VIEW',
    'REPORT_PROFIT',
  ],
  CASHIER: [
    'POS_SELL',
    'ORDER_VIEW',
    'RETURN_CREATE',
    'PRODUCT_VIEW',
    'CUSTOMER_MANAGE',
    'SHIFT_MANAGE',
  ],
  WAREHOUSE: [
    'PRODUCT_VIEW',
    'PRODUCT_COST_VIEW',
    'INVENTORY_VIEW',
    'INVENTORY_AUDIT',
    'BATCH_MANAGE',
    'PURCHASE_CREATE',
    'SUPPLIER_VIEW',
  ],
  SUPPLIER: ['SUPPLIER_PORTAL'],
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
  {
    ma_tham_so: 'SoNgayCanhBaoCanDate',
    ten_tham_so: 'Số ngày cảnh báo hàng cận date mặc định',
    kieu_du_lieu: 'NUMBER',
    gia_tri: '14',
    nhom_tham_so: 'KHO_HSD',
    mo_ta: 'Cảnh báo lô hàng sắp hết hạn khi số ngày còn lại <= ngưỡng này.',
  },
  {
    ma_tham_so: 'NguongLechKiemKeSoLuong',
    ten_tham_so: 'Ngưỡng lệch số lượng bắt buộc đếm lại vòng 2',
    kieu_du_lieu: 'NUMBER',
    gia_tri: '5',
    nhom_tham_so: 'KIEM_KE',
    mo_ta: 'Dòng kiểm kê lệch tuyệt đối >= ngưỡng số lượng sẽ yêu cầu người khác đếm lại vòng 2.',
  },
  {
    ma_tham_so: 'NguongLechKiemKeGiaTri',
    ten_tham_so: 'Ngưỡng lệch giá trị bắt buộc đếm lại vòng 2 (₫)',
    kieu_du_lieu: 'NUMBER',
    gia_tri: '500000',
    nhom_tham_so: 'KIEM_KE',
    mo_ta: 'Dòng kiểm kê có giá trị chênh lệch >= ngưỡng này sẽ bắt buộc đếm lại vòng 2.',
  },
  {
    ma_tham_so: 'NguongDuyetKiemKeAdmin',
    ten_tham_so: 'Ngưỡng tổng giá trị lệch kiểm kê cần Admin duyệt (₫)',
    kieu_du_lieu: 'NUMBER',
    gia_tri: '2000000',
    nhom_tham_so: 'KIEM_KE',
    mo_ta: 'Phiếu kiểm kê có tổng giá trị chênh lệch >= ngưỡng này chỉ Admin mới được duyệt.',
  },
  {
    ma_tham_so: 'CanhBaoLechGiaNhapPct',
    ten_tham_so: 'Ngưỡng cảnh báo lệch đơn giá nhập (%)',
    kieu_du_lieu: 'NUMBER',
    gia_tri: '15',
    nhom_tham_so: 'NHAP_HANG',
    mo_ta: 'Cảnh báo khi đơn giá nhập chênh lệch lớn hơn tỷ lệ % này so với giá vốn gần nhất.',
  },
];

const { CATALOG_CATEGORIES } = require('../../domain/catalog-data.js');

const DEFAULT_CATEGORIES = CATALOG_CATEGORIES.map((c) => ({
  code: c.code,
  name: c.name,
  description: c.description || '',
}));

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
  { code: 'DVT15', name: 'thùng' },
  { code: 'DVT16', name: 'bịch' },
  { code: 'DVT17', name: 'lọ' },
  { code: 'DVT18', name: 'cây' },
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
  supplier_id TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'LOCKED')),
  must_change_password INTEGER NOT NULL DEFAULT 0,
  last_login_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (role_code) REFERENCES roles(code) ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL
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
  created_at TEXT NOT NULL,
  FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL
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
  payment_terms_days INTEGER NOT NULL DEFAULT 30 CHECK (payment_terms_days >= 0 AND payment_terms_days <= 365),
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
  thumb_url TEXT NOT NULL DEFAULT '',
  has_expiry INTEGER NOT NULL DEFAULT 1 CHECK (has_expiry IN (0, 1)),
  expiry_warn_days INTEGER NOT NULL DEFAULT 14 CHECK (expiry_warn_days >= 0),
  non_returnable INTEGER NOT NULL DEFAULT 0 CHECK (non_returnable IN (0, 1)),
  case_unit_name TEXT NOT NULL DEFAULT 'Thùng',
  units_per_case INTEGER NOT NULL DEFAULT 12 CHECK (units_per_case >= 1),
  damaged_stock_qty INTEGER NOT NULL DEFAULT 0 CHECK (damaged_stock_qty >= 0),
  status TEXT NOT NULL DEFAULT 'DangKinhDoanh' CHECK (status IN ('DangKinhDoanh', 'NgungKinhDoanh')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (category_code) REFERENCES categories(code) ON DELETE RESTRICT,
  FOREIGN KEY (unit_code) REFERENCES units(code) ON DELETE RESTRICT,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS product_batches (
  id TEXT PRIMARY KEY,
  batch_code TEXT NOT NULL,
  product_id TEXT NOT NULL,
  mfg_date TEXT NOT NULL DEFAULT '',
  expiry_date TEXT NOT NULL DEFAULT '',
  initial_qty INTEGER NOT NULL CHECK (initial_qty >= 0),
  qty_remaining INTEGER NOT NULL CHECK (qty_remaining >= 0),
  unit_cost INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  purchase_id TEXT,
  status TEXT NOT NULL DEFAULT 'ConHan' CHECK (status IN ('ConHan', 'CanDate', 'HetHan', 'DaHet', 'DaHuy')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
  FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS batch_writeoffs (
  id TEXT PRIMARY KEY,
  created_by TEXT NOT NULL,
  approved_by TEXT,
  reason TEXT NOT NULL,
  total_qty INTEGER NOT NULL DEFAULT 0 CHECK (total_qty >= 0),
  total_value INTEGER NOT NULL DEFAULT 0 CHECK (total_value >= 0),
  status TEXT NOT NULL DEFAULT 'ChoDuyet' CHECK (status IN ('ChoDuyet', 'DaDuyet', 'DaHuy')),
  created_at TEXT NOT NULL,
  approved_at TEXT,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS batch_writeoff_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  writeoff_id TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  batch_code TEXT NOT NULL DEFAULT '',
  expiry_date TEXT NOT NULL DEFAULT '',
  qty INTEGER NOT NULL CHECK (qty > 0),
  unit_cost INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  line_value INTEGER NOT NULL DEFAULT 0 CHECK (line_value >= 0),
  reason TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (writeoff_id) REFERENCES batch_writeoffs(id) ON DELETE CASCADE,
  FOREIGN KEY (batch_id) REFERENCES product_batches(id) ON DELETE RESTRICT,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
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
  scope TEXT NOT NULL DEFAULT 'INVOICE' CHECK (scope IN ('INVOICE', 'CATEGORY', 'PRODUCT', 'NEAR_EXPIRY')),
  category_code TEXT NOT NULL DEFAULT '',
  near_expiry_days INTEGER NOT NULL DEFAULT 14,
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

CREATE TABLE IF NOT EXISTS vouchers (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  discount_type TEXT NOT NULL CHECK (discount_type IN ('PERCENT', 'FIXED')),
  discount_value INTEGER NOT NULL CHECK (discount_value >= 0),
  min_order_amount INTEGER NOT NULL DEFAULT 0 CHECK (min_order_amount >= 0),
  max_discount INTEGER NOT NULL DEFAULT 0 CHECK (max_discount >= 0),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  usage_limit INTEGER NOT NULL DEFAULT 100 CHECK (usage_limit >= 1),
  used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  max_uses_per_customer INTEGER NOT NULL DEFAULT 1 CHECK (max_uses_per_customer >= 1),
  status TEXT NOT NULL DEFAULT 'DangDienRa' CHECK (status IN ('SapDienRa', 'DangDienRa', 'TamDung', 'KetThuc', 'DaHuy')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS voucher_redemptions (
  id TEXT PRIMARY KEY,
  voucher_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  customer_id TEXT,
  discount_amount INTEGER NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  redeemed_at TEXT NOT NULL,
  FOREIGN KEY (voucher_id) REFERENCES vouchers(id) ON DELETE RESTRICT,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS cashier_shifts (
  id TEXT PRIMARY KEY,
  cashier_id TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  opening_cash INTEGER NOT NULL DEFAULT 0 CHECK (opening_cash >= 0),
  expected_cash INTEGER NOT NULL DEFAULT 0,
  actual_cash INTEGER,
  variance INTEGER,
  cash_sales INTEGER NOT NULL DEFAULT 0,
  cash_refunds INTEGER NOT NULL DEFAULT 0,
  non_cash_sales INTEGER NOT NULL DEFAULT 0,
  order_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'DangMo' CHECK (status IN ('DangMo', 'DaDong')),
  note TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (cashier_id) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS purchases (
  id TEXT PRIMARY KEY,
  supplier_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  approved_by TEXT,
  total_amount INTEGER NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  expected_delivery_date TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'GuiNCC', 'NCCPhanHoi', 'ThuongLuong', 'DaThongNhat', 'DangNhanHang', 'Confirmed', 'Cancelled')),
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
  batch_code TEXT NOT NULL DEFAULT '',
  mfg_date TEXT NOT NULL DEFAULT '',
  expiry_date TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS purchase_negotiations (
  id TEXT PRIMARY KEY,
  purchase_id TEXT NOT NULL,
  round_no INTEGER NOT NULL DEFAULT 1,
  actor_id TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  action TEXT NOT NULL,
  proposed_items_json TEXT NOT NULL DEFAULT '[]',
  expected_delivery_date TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS purchase_receipts (
  id TEXT PRIMARY KEY,
  purchase_id TEXT NOT NULL,
  supplier_id TEXT NOT NULL,
  received_by TEXT NOT NULL,
  approved_by TEXT,
  total_received_amount INTEGER NOT NULL DEFAULT 0 CHECK (total_received_amount >= 0),
  status TEXT NOT NULL DEFAULT 'ChoDuyet' CHECK (status IN ('ChoDuyet', 'DaDuyet', 'DaHuy')),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE RESTRICT,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT,
  FOREIGN KEY (received_by) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS purchase_receipt_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  ordered_qty INTEGER NOT NULL CHECK (ordered_qty >= 0),
  received_qty INTEGER NOT NULL CHECK (received_qty >= 0),
  rejected_qty INTEGER NOT NULL DEFAULT 0 CHECK (rejected_qty >= 0),
  unit_cost INTEGER NOT NULL CHECK (unit_cost >= 0),
  batch_code TEXT NOT NULL DEFAULT '',
  mfg_date TEXT NOT NULL DEFAULT '',
  expiry_date TEXT NOT NULL DEFAULT '',
  qc_note TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (receipt_id) REFERENCES purchase_receipts(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS supplier_payables (
  id TEXT PRIMARY KEY,
  supplier_id TEXT NOT NULL,
  purchase_id TEXT NOT NULL,
  receipt_id TEXT,
  total_amount INTEGER NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  paid_amount INTEGER NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  balance_amount INTEGER NOT NULL DEFAULT 0 CHECK (balance_amount >= 0),
  credit_amount INTEGER NOT NULL DEFAULT 0 CHECK (credit_amount >= 0),
  due_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ChuaThanhToan' CHECK (status IN ('ChuaThanhToan', 'ThanhToanMotPhan', 'DaThanhToanNCC')),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT,
  FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE RESTRICT,
  FOREIGN KEY (receipt_id) REFERENCES purchase_receipts(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS supplier_credits (
  id TEXT PRIMARY KEY,
  supplier_id TEXT NOT NULL,
  supplier_return_id TEXT,
  payable_id TEXT,
  amount INTEGER NOT NULL CHECK (amount >= 0),
  remaining_amount INTEGER NOT NULL CHECK (remaining_amount >= 0),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT,
  FOREIGN KEY (supplier_return_id) REFERENCES supplier_returns(id) ON DELETE SET NULL,
  FOREIGN KEY (payable_id) REFERENCES supplier_payables(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS supplier_payments (
  id TEXT PRIMARY KEY,
  payable_id TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL DEFAULT 'BANK_TRANSFER',
  payment_ref TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  paid_at TEXT NOT NULL,
  FOREIGN KEY (payable_id) REFERENCES supplier_payables(id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS supplier_returns (
  id TEXT PRIMARY KEY,
  supplier_id TEXT NOT NULL,
  purchase_id TEXT,
  created_by TEXT NOT NULL,
  approved_by TEXT,
  total_amount INTEGER NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ChoDuyet' CHECK (status IN ('ChoDuyet', 'DaDuyet', 'DaHuy')),
  created_at TEXT NOT NULL,
  approved_at TEXT,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT,
  FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS supplier_return_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  return_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  batch_id TEXT,
  batch_code TEXT NOT NULL DEFAULT '',
  qty INTEGER NOT NULL CHECK (qty > 0),
  unit_cost INTEGER NOT NULL CHECK (unit_cost >= 0),
  line_total INTEGER NOT NULL DEFAULT 0 CHECK (line_total >= 0),
  reason TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (return_id) REFERENCES supplier_returns(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
  FOREIGN KEY (batch_id) REFERENCES product_batches(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  customer_id TEXT,
  cashier_id TEXT NOT NULL,
  shift_id TEXT,
  discount_mode TEXT NOT NULL DEFAULT 'NONE' CHECK (discount_mode IN ('NONE', 'VOUCHER', 'PROMOTION')),
  promotion_id TEXT,
  voucher_id TEXT,
  subtotal INTEGER NOT NULL CHECK (subtotal >= 0),
  invoice_discount INTEGER NOT NULL DEFAULT 0 CHECK (invoice_discount >= 0),
  tax_rate REAL NOT NULL DEFAULT 0 CHECK (tax_rate >= 0),
  tax_amount INTEGER NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  total_amount INTEGER NOT NULL CHECK (total_amount >= 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('CASH', 'VIETQR', 'CARD')),
  cash_received INTEGER NOT NULL DEFAULT 0 CHECK (cash_received >= 0),
  cash_change INTEGER NOT NULL DEFAULT 0 CHECK (cash_change >= 0),
  payment_ref TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT,
  status TEXT NOT NULL DEFAULT 'DaThanhToan' CHECK (status IN ('DaThanhToan', 'TraMotPhan', 'DaHoanTra', 'DaHuy')),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
  FOREIGN KEY (cashier_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (shift_id) REFERENCES cashier_shifts(id) ON DELETE SET NULL,
  FOREIGN KEY (promotion_id) REFERENCES promotions(id) ON DELETE RESTRICT,
  FOREIGN KEY (voucher_id) REFERENCES vouchers(id) ON DELETE RESTRICT
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

CREATE TABLE IF NOT EXISTS order_item_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL,
  order_item_id INTEGER,
  product_id TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  batch_code TEXT NOT NULL DEFAULT '',
  expiry_date TEXT NOT NULL DEFAULT '',
  qty INTEGER NOT NULL CHECK (qty > 0),
  returned_qty INTEGER NOT NULL DEFAULT 0 CHECK (returned_qty >= 0),
  cost_price INTEGER NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
  created_at TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
  FOREIGN KEY (batch_id) REFERENCES product_batches(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS returns (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  approved_by TEXT,
  refund_shift_id TEXT,
  reason TEXT NOT NULL,
  restock INTEGER NOT NULL DEFAULT 1,
  refund_amount INTEGER NOT NULL DEFAULT 0 CHECK (refund_amount >= 0),
  status TEXT NOT NULL DEFAULT 'ChoDuyet' CHECK (status IN ('ChoDuyet', 'DaXacNhan', 'TuChoi')),
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (refund_shift_id) REFERENCES cashier_shifts(id) ON DELETE SET NULL
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
  batch_code TEXT NOT NULL DEFAULT '',
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
  assigned_to TEXT,
  recount_by TEXT,
  approved_by TEXT,
  scope_type TEXT NOT NULL DEFAULT 'TOAN_KHO',
  scope_value TEXT NOT NULL DEFAULT '',
  snapshot_at TEXT NOT NULL DEFAULT '',
  requires_recount INTEGER NOT NULL DEFAULT 0,
  requires_admin_approval INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ChoDuyet' CHECK (status IN ('DangDem', 'ChoDemLai', 'ChoDuyet', 'DaDuyet', 'DaHuy')),
  created_at TEXT NOT NULL,
  approved_at TEXT,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (recount_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS stock_audit_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  audit_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  batch_id TEXT,
  batch_code TEXT NOT NULL DEFAULT '',
  expiry_date TEXT NOT NULL DEFAULT '',
  system_qty INTEGER NOT NULL,
  actual_qty INTEGER NOT NULL CHECK (actual_qty >= 0),
  diff_qty INTEGER NOT NULL,
  round1_qty INTEGER,
  round2_qty INTEGER,
  movements_since_snapshot INTEGER NOT NULL DEFAULT 0,
  effective_system_qty INTEGER,
  reason_code TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (audit_id) REFERENCES stock_audits(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
  FOREIGN KEY (batch_id) REFERENCES product_batches(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS stock_audit_rounds (
  id TEXT PRIMARY KEY,
  audit_id TEXT NOT NULL,
  round_no INTEGER NOT NULL DEFAULT 1,
  counted_by TEXT NOT NULL,
  counted_by_name TEXT NOT NULL,
  items_json TEXT NOT NULL DEFAULT '[]',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY (audit_id) REFERENCES stock_audits(id) ON DELETE CASCADE,
  FOREIGN KEY (counted_by) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_username);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role_code);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_code);
CREATE INDEX IF NOT EXISTS idx_products_supplier ON products(supplier_id);
CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
CREATE INDEX IF NOT EXISTS idx_product_batches_product ON product_batches(product_id, expiry_date ASC);
CREATE INDEX IF NOT EXISTS idx_product_batches_expiry ON product_batches(expiry_date ASC);
CREATE INDEX IF NOT EXISTS idx_batch_writeoffs_status ON batch_writeoffs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vouchers_code ON vouchers(code);
CREATE INDEX IF NOT EXISTS idx_cashier_shifts_cashier ON cashier_shifts(cashier_id, status);
CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON stock_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_created ON stock_movements(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_purchases_status_created ON purchases(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_purchases_supplier ON purchases(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_payables_supplier ON supplier_payables(supplier_id, status);
CREATE INDEX IF NOT EXISTS idx_stock_audits_status_created ON stock_audits(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_promotions_code ON promotions(code);
CREATE INDEX IF NOT EXISTS idx_promotions_status ON promotions(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_returns_order ON returns(order_id);
CREATE INDEX IF NOT EXISTS idx_returns_status_created ON returns(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_item_batches_order_product ON order_item_batches(order_id, product_id);
CREATE INDEX IF NOT EXISTS idx_supplier_credits_supplier ON supplier_credits(supplier_id);

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

function runSafeMigrations(db) {
  const ensureColumn = (table, col, defSql) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    if (!cols.includes(col)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${defSql}`);
    }
  };
  ensureColumn('users', 'supplier_id', 'TEXT');
  ensureColumn('products', 'thumb_url', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('products', 'has_expiry', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn('products', 'expiry_warn_days', 'INTEGER NOT NULL DEFAULT 14');
  ensureColumn('products', 'non_returnable', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('products', 'case_unit_name', "TEXT NOT NULL DEFAULT 'Thùng'");
  ensureColumn('products', 'units_per_case', 'INTEGER NOT NULL DEFAULT 12');
  ensureColumn('products', 'damaged_stock_qty', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('stock_movements', 'batch_code', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('purchase_items', 'batch_code', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('purchase_items', 'mfg_date', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('purchase_items', 'expiry_date', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('purchases', 'expected_delivery_date', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('promotions', 'scope', "TEXT NOT NULL DEFAULT 'INVOICE'");
  ensureColumn('promotions', 'category_code', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('promotions', 'near_expiry_days', 'INTEGER NOT NULL DEFAULT 14');
  ensureColumn('orders', 'shift_id', 'TEXT');
  ensureColumn('orders', 'discount_mode', "TEXT NOT NULL DEFAULT 'NONE'");
  ensureColumn('orders', 'voucher_id', 'TEXT');
  ensureColumn('stock_audits', 'assigned_to', 'TEXT');
  ensureColumn('stock_audits', 'recount_by', 'TEXT');
  ensureColumn('stock_audits', 'scope_type', "TEXT NOT NULL DEFAULT 'TOAN_KHO'");
  ensureColumn('stock_audits', 'scope_value', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('stock_audits', 'snapshot_at', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('stock_audits', 'requires_recount', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('stock_audits', 'requires_admin_approval', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('stock_audit_items', 'batch_id', 'TEXT');
  ensureColumn('stock_audit_items', 'batch_code', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('stock_audit_items', 'expiry_date', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('stock_audit_items', 'round1_qty', 'INTEGER');
  ensureColumn('stock_audit_items', 'round2_qty', 'INTEGER');
  ensureColumn('stock_audit_items', 'movements_since_snapshot', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('stock_audit_items', 'effective_system_qty', 'INTEGER');
  ensureColumn('stock_audit_items', 'reason_code', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('orders', 'idempotency_key', 'TEXT');
  ensureColumn('returns', 'refund_shift_id', 'TEXT');
  ensureColumn('supplier_payables', 'credit_amount', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('suppliers', 'payment_terms_days', 'INTEGER NOT NULL DEFAULT 30');
  db.exec('CREATE INDEX IF NOT EXISTS idx_returns_refund_shift ON returns(refund_shift_id)');
  db.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_idempotency_key ON orders(idempotency_key) WHERE idempotency_key IS NOT NULL',
  );
}

function openDatabase(dbPath) {
  const targetPath = dbPath || process.env.DB_PATH || path.resolve(__dirname, '../../../data/retailflow.db');
  if (targetPath !== ':memory:') {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  }
  const db = new DatabaseSync(targetPath);
  db.exec(SCHEMA_SQL);
  runSafeMigrations(db);
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

    // Seed suppliers BEFORE users so NV005.supplier_id ('NCC003') satisfies users.supplier_id FK
    const supplierCount = db.prepare('SELECT COUNT(*) AS cnt FROM suppliers').get().cnt;
    const productCount = db.prepare('SELECT COUNT(*) AS cnt FROM products').get().cnt;
    let seeded = null;
    if (supplierCount === 0 || productCount === 0) {
      const { seed } = require('../../domain/seed.js');
      seeded = seed();

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
    }

    const userCount = db.prepare('SELECT COUNT(*) AS cnt FROM users').get().cnt;
    if (userCount === 0) {
      const insertUser = db.prepare(`
        INSERT INTO users (id, username, password_hash, full_name, email, phone, role_code, supplier_id, status, must_change_password, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 0, ?, ?)
      `);
      const seedUsers = [
        ['NV001', 'admin', 'Lê Hoàng Nam', 'admin@retailflow.vn', '0901000001', 'ADMIN', null],
        ['NV002', 'quanly', 'Phạm Minh Quân', 'quanly@retailflow.vn', '0901000002', 'MANAGER', null],
        ['NV003', 'thungan', 'Nguyễn Hà Linh', 'thungan@retailflow.vn', '0901000003', 'CASHIER', null],
        ['NV004', 'kho', 'Trần Quốc Bảo', 'kho@retailflow.vn', '0901000004', 'WAREHOUSE', null],
        ['NV005', 'ncc01', 'Đại diện NCC Trung Nguyên', 'ncc01@trungnguyen.vn', '02838231111', 'SUPPLIER', 'NCC003'],
      ];
      for (const [uid, username, fullName, email, phone, roleCode, supplierId] of seedUsers) {
        insertUser.run(uid, username, hashPassword('123456'), fullName, email, phone, roleCode, supplierId, nowIso, nowIso);
      }
    } else {
      // Đảm bảo tài khoản cổng NCC (ncc01) tồn tại trên CSDL đã nâng cấp
      db.prepare(`
        INSERT OR IGNORE INTO users (id, username, password_hash, full_name, email, phone, role_code, supplier_id, status, must_change_password, created_at, updated_at)
        VALUES ('NV005', 'ncc01', ?, 'Đại diện NCC Trung Nguyên', 'ncc01@trungnguyen.vn', '02838231111', 'SUPPLIER', 'NCC003', 'ACTIVE', 0, ?, ?)
      `).run(hashPassword('123456'), nowIso, nowIso);
    }

    if (seeded && productCount === 0) {
        const catCodeSet = new Set(db.prepare('SELECT code FROM categories').all().map((r) => r.code));
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
            image_url, thumb_url, has_expiry, expiry_warn_days,
            non_returnable, case_unit_name, units_per_case, damaged_stock_qty,
            status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
        `);
        const insertBatch = db.prepare(`
          INSERT OR IGNORE INTO product_batches (
            id, batch_code, product_id, mfg_date, expiry_date,
            initial_qty, qty_remaining, unit_cost, purchase_id, status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
        `);
        const insertMovement = db.prepare(`
          INSERT OR IGNORE INTO stock_movements (
            id, product_id, stock_before, delta, stock_after,
            doc_type, doc_id, batch_code, actor_id, actor_name, note, created_at
          ) VALUES (?, ?, 0, ?, ?, 'KHOI_TAO_TON', ?, ?, 'NV001', 'Hệ thống', ?, ?)
        `);

        const ymdOffset = (days) => new Date(nowMs + days * dayMs).toISOString().slice(0, 10);
        const ymTag = nowIso.slice(0, 7).replace('-', '');

        for (const prod of seeded.products || []) {
          const catCode =
            (prod.categoryCode && catCodeSet.has(prod.categoryCode) ? prod.categoryCode : null) ||
            catMap.get(String(prod.category || '').toLowerCase()) ||
            'DM01';
          const unitCode = unitMap.get(String(prod.unit || '').toLowerCase()) || 'DVT01';
          const salePrice = Math.max(0, Math.round(Number(prod.price) || 0));
          const costPrice = Math.max(0, Math.round(Number(prod.costPrice ?? prod.cost) || 0));
          const stockQty = Math.max(0, Math.round(Number(prod.stock) || 0));
          const minStock = Math.max(0, Math.round(Number(prod.minStock) || 15));
          const imgUrl =
            prod.imageUrl && prod.imageUrl !== 'assets/images/products/default.jpg'
              ? prod.imageUrl
              : 'assets/images/products/milk_vinamilk.jpg';
          const thumbUrl =
            prod.thumbUrl ||
            imgUrl.replace(/^assets\/images\/products\//, 'assets/images/products/thumbs/');
          const hasExpiry = prod.hasExpiry === 0 || prod.hasExpiry === false ? 0 : 1;
          const warnDays = Math.max(0, Math.round(Number(prod.expiryWarnDays) || 14));
          const nonReturnable = prod.nonReturnable ? 1 : 0;
          const caseUnitName = prod.caseUnitName || 'Thùng';
          const unitsPerCase = Math.max(1, Math.round(Number(prod.unitsPerCase) || 12));

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
            thumbUrl,
            hasExpiry,
            warnDays,
            nonReturnable,
            caseUnitName,
            unitsPerCase,
            prod.active === false ? 'NgungKinhDoanh' : 'DangKinhDoanh',
            nowIso,
            nowIso,
          );

          const expOff = Number(prod.expiryOffsetDays ?? 180);
          const shelfLife = Math.max(90, Number(prod.shelfLifeDays ?? 240));
          const mainBatchCode = `LO-${ymTag}-${prod.id}`;
          if (hasExpiry === 1 && expOff <= 0) {
            // Seed BOTH an expired batch awaiting write-off AND a valid batch matching salable stockQty
            const expQty = 16;
            insertBatch.run(
              `LOT-EXP-${prod.id}`,
              `LO-HH-${prod.id}`,
              prod.id,
              ymdOffset(expOff - shelfLife),
              ymdOffset(expOff),
              expQty,
              expQty,
              costPrice,
              'HetHan',
              openingIso,
            );
            insertBatch.run(
              `LOT-SEED-${prod.id}`,
              mainBatchCode,
              prod.id,
              ymdOffset(-30),
              ymdOffset(150),
              stockQty,
              stockQty,
              costPrice,
              'ConHan',
              openingIso,
            );
          } else if (hasExpiry === 1 && expOff > 0 && expOff <= 14 && stockQty >= 30) {
            // Split into 2 batches for real FEFO demonstration (near-expiry batch + fresher batch)
            const nearQty = Math.min(20, Math.floor(stockQty / 4));
            const freshQty = stockQty - nearQty;
            insertBatch.run(
              `LOT-NEAR-${prod.id}`,
              `LO-CD-${prod.id}`,
              prod.id,
              ymdOffset(expOff - shelfLife),
              ymdOffset(expOff),
              nearQty,
              nearQty,
              costPrice,
              'CanDate',
              openingIso,
            );
            insertBatch.run(
              `LOT-SEED-${prod.id}`,
              mainBatchCode,
              prod.id,
              ymdOffset(-20),
              ymdOffset(180),
              freshQty,
              freshQty,
              costPrice,
              'ConHan',
              openingIso,
            );
          } else {
            const batchStatus = hasExpiry === 1 && expOff <= warnDays ? 'CanDate' : 'ConHan';
            insertBatch.run(
              `LOT-SEED-${prod.id}`,
              mainBatchCode,
              prod.id,
              hasExpiry ? ymdOffset(expOff - shelfLife) : '',
              hasExpiry ? ymdOffset(expOff) : '',
              stockQty,
              stockQty,
              costPrice,
              batchStatus,
              openingIso,
            );
          }

          if (stockQty > 0) {
            insertMovement.run(
              `STK-SEED-${prod.id}`,
              prod.id,
              stockQty,
              stockQty,
              `INIT-${prod.id}`,
              mainBatchCode,
              `Khởi tạo tồn kho đầu kỳ cho ${prod.name}`,
              openingIso,
            );
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
          max_discount, start_date, end_date, usage_limit, used_count,
          scope, category_code, near_expiry_days, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, '', 14, ?, ?)
      `);
      const seedPromos = [
        ['KM001', 'GIAM10', 'Giảm 10% hóa đơn từ 100.000 ₫ (tối đa 50.000 ₫)', 'PERCENT', 10, 100000, 50000, startActive, endActive, 500, 'INVOICE', 'DangDienRa'],
        ['KM002', 'GIAM20K', 'Giảm thẳng 20.000 ₫ cho đơn từ 150.000 ₫', 'FIXED', 20000, 150000, 0, startActive, endActive, 300, 'INVOICE', 'DangDienRa'],
        ['KM003', 'SAPMO15', 'Ưu đãi sắp mở giảm 15% (tối đa 80.000 ₫)', 'PERCENT', 15, 200000, 80000, startFuture, endFuture, 200, 'INVOICE', 'SapDienRa'],
        ['KM004', 'XACANDATE30', 'Xả kho hàng cận date giảm 30% (áp dụng lô <= 14 ngày)', 'PERCENT', 30, 0, 200000, startActive, endActive, 500, 'NEAR_EXPIRY', 'DangDienRa'],
      ];
      for (const p of seedPromos) {
        insertPromo.run(...p, nowIso);
      }
      // Attach near-expiry products to KM004
      const nearProds = db
        .prepare("SELECT DISTINCT product_id FROM product_batches WHERE status = 'CanDate' AND qty_remaining > 0")
        .all();
      const insPromoProd = db.prepare('INSERT OR IGNORE INTO promotion_products (promotion_id, product_id) VALUES (?, ?)');
      for (const np of nearProds) {
        insPromoProd.run('KM004', np.product_id);
      }
    }

    const voucherCount = db.prepare('SELECT COUNT(*) AS cnt FROM vouchers').get().cnt;
    if (voucherCount === 0) {
      const toYmd = (d) => d.toISOString().slice(0, 10);
      const startActive = toYmd(new Date(Date.now() - 15 * dayMs));
      const endActive = toYmd(new Date(Date.now() + 90 * dayMs));
      const insV = db.prepare(`
        INSERT OR IGNORE INTO vouchers (
          id, code, name, discount_type, discount_value, min_order_amount,
          max_discount, start_date, end_date, usage_limit, used_count,
          max_uses_per_customer, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'DangDienRa', ?)
      `);
      const seedVouchers = [
        ['VC001', 'APP15K', 'Voucher Khách hàng mới App (-15.000 ₫)', 'FIXED', 15000, 100000, 15000, startActive, endActive, 200, 1],
        ['VC002', 'SIEUTHI10', 'Voucher Thành viên Siêu thị (-10%, tối đa 40.000 ₫)', 'PERCENT', 10, 150000, 40000, startActive, endActive, 300, 2],
        ['VC003', 'BANMOI20K', 'Voucher Bạn mới (-20.000 ₫ đơn từ 120.000 ₫)', 'FIXED', 20000, 120000, 20000, startActive, endActive, 150, 1],
        ['VC004', 'VIP50K', 'Voucher Hội viên VIP (-50.000 ₫ đơn từ 400.000 ₫)', 'FIXED', 50000, 400000, 50000, startActive, endActive, 100, 3],
      ];
      for (const v of seedVouchers) {
        insV.run(...v, nowIso);
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
