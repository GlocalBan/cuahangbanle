/* Shared browser state, Lucide v1.76.0 vector icon bridge, and HTML helpers.
 * Uses pure in-memory store for session/config mirror (zero legacy localStorage business persistence). */
'use strict';
const { Store, totals, METHODS, ROLES, ROLE_SHORT, ACCESS, PAGE_PERMISSIONS, clone, getExpiryInfo } = Retail;
const _memoryStorage = {
  _map: new Map(),
  getItem(k) {
    return this._map.has(k) ? this._map.get(k) : null;
  },
  setItem(k, v) {
    this._map.set(k, String(v));
  },
  removeItem(k) {
    this._map.delete(k);
  },
};
const store = new Store(_memoryStorage);
// Clean up any stale legacy prototype key left in browser localStorage
try {
  if (typeof localStorage !== 'undefined') localStorage.removeItem('retailflow-store');
} catch {
  // ignore storage errors
}

const SIDEBAR_PREF_KEY = 'retailflow-sidebar-collapsed';
let sidebarCollapsed = false;
try {
  sidebarCollapsed = typeof localStorage !== 'undefined' && localStorage.getItem(SIDEBAR_PREF_KEY) === '1';
} catch {
  sidebarCollapsed = false;
}
function setSidebarCollapsed(next) {
  sidebarCollapsed = Boolean(next);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SIDEBAR_PREF_KEY, sidebarCollapsed ? '1' : '0');
    }
  } catch {
    // ignore
  }
  document.body.classList.toggle('sidebar-collapsed', sidebarCollapsed);
}

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHTML = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const e = escapeHTML;
const money = (value) => new Intl.NumberFormat('vi-VN').format(value || 0) + ' ₫';
const number = (value) => new Intl.NumberFormat('vi-VN').format(value || 0);
const date = (value) =>
  new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(new Date(value));
const dateOnly = (value) => {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(d);
};
const dayKey = (value) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
const match = (value, query) =>
  String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .toLowerCase()
    .includes(
      String(query)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .toLowerCase(),
    );

const LUCIDE_ICON_MAP = {
  layers: 'layers',
  grid: 'layout-grid',
  cart: 'shopping-cart',
  box: 'package',
  receipt: 'receipt',
  warehouse: 'warehouse',
  truck: 'truck',
  users: 'users',
  user: 'user-cog',
  return: 'rotate-ccw',
  chart: 'bar-chart-3',
  branch: 'building-2',
  settings: 'sliders-horizontal',
  search: 'search',
  plus: 'plus',
  close: 'x',
  arrow: 'arrow-right',
  logout: 'log-out',
  bell: 'bell',
  download: 'download',
  upload: 'upload',
  edit: 'pencil',
  eye: 'eye',
  check: 'check',
  cash: 'banknote',
  card: 'credit-card',
  transfer: 'arrow-left-right',
  print: 'printer',
  save: 'save',
  clock: 'clock',
  shield: 'shield-check',
  menu: 'menu',
  trash: 'trash-2',
  scan: 'scan-barcode',
  info: 'info',
  key: 'key-round',
  lock: 'lock',
  unlock: 'lock-open',
  tag: 'tag',
  'collapse-left': 'panel-left-close',
  'collapse-right': 'panel-left-open',
};

const icon = (name) => {
  const lucideName = LUCIDE_ICON_MAP[name] || 'package';
  return `<i data-lucide="${lucideName}" class="icon" aria-hidden="true"></i>`;
};

function hydrateIcons() {
  if (typeof window !== 'undefined' && window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons({
      attrs: {
        class: 'icon',
        'stroke-width': '1.75',
      },
    });
  }
}

const logo = () =>
  `<div class="logo"><div class="logo-mark">${icon('layers')}</div><div class="logo-text"><strong>RetailFlow</strong><small>RETAIL MANAGEMENT</small></div></div>`;
const action = (name, label, ico = '', kind = '', attrs = '') =>
  `<button type="button" class="btn ${kind}" data-action="${name}" ${attrs}>${ico ? icon(ico) : ''}${label}</button>`;
const ib = (name, ico, label, attrs = '') =>
  `<button type="button" class="icon-btn" data-action="${name}" title="${e(label)}" aria-label="${e(label)}" ${attrs}>${icon(ico)}</button>`;
const empty = (
  label = 'Chưa có dữ liệu',
  desc = 'Các thông tin mới sẽ xuất hiện tại đây.',
  ico = 'box',
) => `<div class="empty">${icon(ico)}<strong>${label}</strong><div class="sub">${desc}</div></div>`;
const badge = (label, color = 'green') =>
  `<span class="badge ${color}"><i class="dot"></i>${label}</span>`;
const productImage = (p, cls = 'product-thumb-img', attrs = '') => {
  const fullSrc = p && p.imageUrl ? String(p.imageUrl) : 'assets/images/products/default.jpg';
  const useThumb =
    cls !== 'product-modal-img' &&
    fullSrc.startsWith('assets/images/products/') &&
    !fullSrc.includes('/thumbs/') &&
    !fullSrc.endsWith('/default.jpg');
  const src = useThumb
    ? (p && p.thumbUrl) || fullSrc.replace(/^assets\/images\/products\//, 'assets/images/products/thumbs/')
    : fullSrc;
  return `<img class="${cls}" src="${e(src)}" alt="${e((p && p.name) || 'Sản phẩm')}" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='${e(fullSrc)}'" ${attrs} />`;
};
const expiryBadge = (expiryDate, compact = false) => {
  const info = getExpiryInfo ? getExpiryInfo(expiryDate) : { status: 'valid', label: 'Còn hạn', color: 'green' };
  if (compact) {
    if (info.status === 'valid') return '';
    return `<span class="badge ${info.color} expiry-tag">${e(info.label)}</span>`;
  }
  return `<span class="badge ${info.color}"><i class="dot"></i>${e(info.label)}</span>`;
};
const statusLabels = {
  completed: ['Đã thanh toán', 'green'],
  refunded: ['Đã hoàn trả', 'red'],
  cancelled: ['Đã hủy', 'gray'],
  pending: ['Chờ xác nhận', 'yellow'],
  sent_to_supplier: ['Đã gửi NCC', 'blue'],
  supplier_responded: ['NCC đã phản hồi', 'yellow'],
  store_approved: ['Cửa hàng đã duyệt', 'teal'],
  approved: ['Đã hoàn tiền', 'green'],
  rejected: ['Đã từ chối', 'red'],
  draft: ['Bản nháp', 'gray'],
  received: ['Đã nhập kho', 'green'],
  active: ['Đang hoạt động', 'green'],
  Draft: ['Phiếu nháp', 'yellow'],
  GuiNCC: ['Đã gửi NCC', 'blue'],
  NCCPhanHoi: ['NCC phản hồi', 'yellow'],
  ThuongLuong: ['Đang thương lượng', 'yellow'],
  DaThongNhat: ['Đã thống nhất', 'teal'],
  DangNhanHang: ['Đang nhận hàng (GRN)', 'blue'],
  Confirmed: ['Đã nhập kho', 'green'],
  Cancelled: ['Đã hủy', 'red'],
  DangDem: ['Đang đếm mù', 'blue'],
  ChoDemLai: ['Cần đếm lại (Vòng 2)', 'yellow'],
  ChoDuyet: ['Chờ duyệt', 'yellow'],
  DaDuyet: ['Đã duyệt', 'green'],
  DaHuy: ['Đã hủy', 'red'],
  ConHan: ['Còn hạn', 'green'],
  CanDate: ['Cận date', 'yellow'],
  HetHan: ['Hết hạn', 'red'],
  DaHet: ['Đã xuất hết', 'gray'],
  ChuaThanhToan: ['Chưa thanh toán', 'red'],
  ThanhToanMotPhan: ['Thanh toán một phần', 'yellow'],
  DaThanhToanNCC: ['Đã thanh toán NCC', 'green'],
  SapDienRa: ['Sắp diễn ra', 'blue'],
  DangDienRa: ['Đang diễn ra', 'green'],
  TamDung: ['Tạm dừng', 'yellow'],
  KetThuc: ['Đã kết thúc', 'gray'],
  DaThanhToan: ['Đã thanh toán', 'green'],
  TraMotPhan: ['Trả một phần', 'yellow'],
  DaHoanTra: ['Đã hoàn trả', 'red'],
  DaXacNhan: ['Đã xác nhận', 'green'],
  TuChoi: ['Đã từ chối', 'red'],
};
const status = (value) => badge(...(statusLabels[value] || [e(value), 'gray']));
const stats = (values) =>
  `<div class="stats">${values.map(([label, value, desc, ico]) => `<div class="panel stat"><div class="stat-icon">${icon(ico || 'receipt')}</div><div class="stat-label">${label}</div><div class="money"><h2 class="stat-value">${value}</h2></div><p class="sub stat-foot">${desc}</p></div>`).join('')}</div>`;
const table = (headers, rows, cls = '') =>
  `<div class="table-wrap ${cls}"><table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>${rows.length ? '' : empty('Không có kết quả', 'Thử đổi bộ lọc hoặc thêm dữ liệu mới.', 'search')}</div>`;
const field = (label, name, value = '', type = 'text', attrs = '', full = false) =>
  `<label class="field ${full ? 'full' : ''}"><span>${label}</span><input name="${name}" type="${type}" value="${e(value)}" ${attrs}></label>`;
const selectField = (label, name, options, value = '', attrs = '', full = false) =>
  `<label class="field ${full ? 'full' : ''}"><span>${label}</span><select name="${name}" ${attrs}>${options.map(([v, t]) => `<option value="${e(v)}" ${v === value ? 'selected' : ''}>${e(t)}</option>`).join('')}</select></label>`;
const textField = (label, name, value = '', full = true) =>
  `<label class="field ${full ? 'full' : ''}"><span>${label}</span><textarea name="${name}">${e(value)}</textarea></label>`;
const formError = () => '<div class="error-text full" id="form-error" role="alert"></div>';
const foot = (submit = 'Lưu thông tin', cls = 'primary') =>
  `<div class="modal-footer">${action('close-modal', 'Đóng')}<button class="btn ${cls}" type="submit">${icon('check')}${submit}</button></div>`;
const pages = [
  ['dashboard', 'Tổng quan', 'grid', 'BÁN HÀNG (POS)'],
  ['pos', 'Bán hàng POS', 'cart', 'BÁN HÀNG (POS)'],
  ['orders', 'Hóa đơn', 'receipt', 'BÁN HÀNG (POS)'],
  ['returns', 'Đổi trả & Hoàn tiền', 'return', 'BÁN HÀNG (POS)'],
  ['products', 'Sản phẩm & Bảng giá', 'box', 'QUẢN LÝ HÀNG HÓA'],
  ['inventory', 'Kho & Kiểm kê', 'warehouse', 'QUẢN LÝ KHO'],
  ['purchases', 'Nhập hàng & Công nợ', 'truck', 'QUẢN LÝ KHO'],
  ['promotions', 'Khuyến mãi & Voucher', 'tag', 'KHUYẾN MÃI & ĐỐI TÁC'],
  ['suppliers', 'Nhà cung cấp', 'branch', 'KHUYẾN MÃI & ĐỐI TÁC'],
  ['supplier-portal', 'Cổng Nhà cung cấp', 'truck', 'KHUYẾN MÃI & ĐỐI TÁC'],
  ['customers', 'Khách hàng', 'users', 'KHUYẾN MÃI & ĐỐI TÁC'],
  ['reports', 'Báo cáo & Thống kê', 'chart', 'BÁO CÁO & THỐNG KÊ'],
  ['staff', 'Nhân viên & Phân quyền', 'user', 'QUẢN TRỊ HỆ THỐNG'],
  ['settings', 'Tham số & Cấu hình', 'settings', 'QUẢN TRỊ HỆ THỐNG'],
  ['audit-logs', 'Nhật ký kiểm toán', 'shield', 'QUẢN TRỊ HỆ THỐNG'],
];
let page = 'dashboard',
  forbiddenAttempt = '',
  filters = {},
  pagination = {},
  modalContext = {},
  chartDays = 7,
  activeCategory = 'Tất cả',
  productsTab = 'products',
  inventoryTab = 'stock',
  promotionsTab = 'promotions',
  purchasesTab = 'pos';
let purchaseLines = [];
let auditLines = [];
let posCart = {
  items: [],
  customerId: '',
  discountMode: 'NONE',
  promotionCode: '',
  appliedPromotion: null,
  promoError: '',
  voucherCode: '',
  appliedVoucher: null,
  voucherError: '',
  note: '',
};
let posHeldOrders = [];
