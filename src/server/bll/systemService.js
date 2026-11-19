'use strict';
const { withTransaction } = require('../dal/database.js');
const { NotFoundException, assertRule } = require('./errors.js');

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function castThamSoValue(row) {
  if (row.kieu_du_lieu === 'NUMBER') {
    const n = Number(row.gia_tri);
    return Number.isFinite(n) ? n : 0;
  }
  if (row.kieu_du_lieu === 'BOOLEAN') {
    return row.gia_tri === 'true' || row.gia_tri === '1';
  }
  return row.gia_tri;
}

class SystemService {
  constructor(db, repos) {
    this.db = db;
    this.repos = repos;
  }

  listThamSo() {
    return this.repos.thamSo.findAll().map((row) => ({
      maThamSo: row.ma_tham_so,
      tenThamSo: row.ten_tham_so,
      kieuDuLieu: row.kieu_du_lieu,
      giaTri: row.gia_tri,
      giaTriParsed: castThamSoValue(row),
      nhomThamSo: row.nhom_tham_so,
      moTa: row.mo_ta,
      tinhTrang: row.tinh_trang,
      updatedAt: row.updated_at,
      updatedBy: row.updated_by,
    }));
  }

  getPublicStoreConfig() {
    const rows = this.repos.thamSo.findAll();
    const map = {};
    for (const r of rows) {
      map[r.ma_tham_so] = castThamSoValue(r);
    }
    return {
      name: map.TenCuaHang || 'RetailFlow',
      address: map.DiaChiCuaHang || '',
      phone: map.HotlineCuaHang || '',
      taxRate: Number(map.TyLeVAT ?? 8),
      defaultMinStock: Number(map.TonToiThieuMacDinh ?? 15),
      returnWindowDays: Number(map.SoNgayChoPhepTraHang ?? 7),
      maxCashierLineDiscountPct: Number(map.TyLeGiamGiaDongToiDa ?? 10),
      bank: map.NganHangVietQR || '',
      bankAccount: map.SoTaiKhoanVietQR || '',
      bankOwner: map.ChuTaiKhoanVietQR || '',
      receiptNote: map.LoiNhanHoaDon || '',
    };
  }

  updateThamSo(actor, updates) {
    assertRule(Array.isArray(updates) && updates.length > 0, 'Danh sách tham số cập nhật không được rỗng.', 400);

    const validated = updates.map((item) => {
      const ma = String(item.maThamSo || item.ma_tham_so || '').trim();
      const existing = this.repos.thamSo.findByCode(ma);
      if (!existing) {
        throw new NotFoundException(`Tham số hệ thống "${ma}" không tồn tại.`);
      }
      const rawVal = item.giaTri !== undefined ? item.giaTri : item.gia_tri;
      const strVal = String(rawVal ?? '').trim();

      if (existing.kieu_du_lieu === 'NUMBER') {
        const num = Number(strVal);
        assertRule(strVal !== '' && Number.isFinite(num), `Tham số "${existing.ten_tham_so}" phải là giá trị số hợp lệ.`, 400);
        if (ma === 'TyLeVAT') {
          assertRule(num >= 0 && num <= 100, 'Tỷ lệ thuế VAT phải nằm trong khoảng từ 0% đến 100%.', 400);
        } else if (ma === 'TyLeGiamGiaDongToiDa') {
          assertRule(num >= 0 && num <= 100, 'Tỷ lệ giảm giá dòng hàng tối đa của Thu ngân phải từ 0% đến 100%.', 400);
        } else if (ma === 'SoNgayChoPhepTraHang') {
          assertRule(Number.isInteger(num) && num >= 1 && num <= 365, 'Số ngày cho phép trả hàng phải là số nguyên từ 1 đến 365 ngày.', 400);
        } else if (ma === 'TonToiThieuMacDinh') {
          assertRule(Number.isInteger(num) && num >= 0 && num <= 100000, 'Ngưỡng tồn tối thiểu mặc định phải là số nguyên không âm.', 400);
        }
      } else if (existing.kieu_du_lieu === 'BOOLEAN') {
        assertRule(['true', 'false', '1', '0'].includes(strVal.toLowerCase()), `Tham số "${existing.ten_tham_so}" phải là giá trị đúng/sai.`, 400);
      } else {
        if (['TenCuaHang', 'DiaChiCuaHang', 'HotlineCuaHang'].includes(ma)) {
          assertRule(strVal.length > 0, `Tham số "${existing.ten_tham_so}" không được để trống.`, 400);
        }
        assertRule(strVal.length <= 300, `Tham số "${existing.ten_tham_so}" không được vượt quá 300 ký tự.`, 400);
      }

      return { existing, nextVal: strVal };
    });

    withTransaction(this.db, () => {
      const changedSummary = [];
      const beforeObj = {};
      const afterObj = {};
      for (const { existing, nextVal } of validated) {
        if (existing.gia_tri !== nextVal) {
          this.repos.thamSo.updateValue(existing.ma_tham_so, nextVal, actor.full_name || actor.username);
          beforeObj[existing.ma_tham_so] = existing.gia_tri;
          afterObj[existing.ma_tham_so] = nextVal;
          changedSummary.push(`${existing.ma_tham_so}: "${existing.gia_tri}" → "${nextVal}"`);
        }
      }
      if (changedSummary.length > 0) {
        this.repos.auditLogs.append({
          actor,
          action: 'THAM_SO_UPDATE',
          entityType: 'THAM_SO',
          entityId: Object.keys(afterObj).join(','),
          detail: `Cập nhật tham số hệ thống: ${changedSummary.join('; ')}.`,
          before: beforeObj,
          after: afterObj,
        });
      }
    });

    return {
      items: this.listThamSo(),
      storeConfig: this.getPublicStoreConfig(),
    };
  }

  queryAuditLogs(query = {}) {
    const fromDate = String(query.fromDate || '').trim();
    const toDate = String(query.toDate || '').trim();
    if (fromDate) {
      assertRule(DATE_REGEX.test(fromDate), 'Định dạng "Từ ngày" không hợp lệ (YYYY-MM-DD).', 400);
    }
    if (toDate) {
      assertRule(DATE_REGEX.test(toDate), 'Định dạng "Đến ngày" không hợp lệ (YYYY-MM-DD).', 400);
    }
    if (fromDate && toDate) {
      assertRule(fromDate <= toDate, 'Khoảng thời gian không hợp lệ: "Từ ngày" phải nhỏ hơn hoặc bằng "Đến ngày".', 400);
    }
    return this.repos.auditLogs.query({
      search: query.search || '',
      action: query.action || '',
      actor: query.actor || '',
      fromDate,
      toDate,
      page: query.page || 1,
      limit: query.limit || 15,
    });
  }

  exportBackupSnapshot(actor) {
    const exportedAt = new Date().toISOString();
    const snapshot = {
      schemaVersion: 'retailflow-sqlite-v1',
      exportedAt,
      exportedBy: actor.username,
      storeConfig: this.getPublicStoreConfig(),
      counts: {},
      data: {
        thamSo: this.db.prepare('SELECT * FROM tham_so ORDER BY ma_tham_so').all(),
        categories: this.db.prepare('SELECT * FROM categories ORDER BY code').all(),
        units: this.db.prepare('SELECT * FROM units ORDER BY code').all(),
        suppliers: this.db.prepare('SELECT * FROM suppliers ORDER BY id').all(),
        products: this.db.prepare('SELECT * FROM products ORDER BY id').all(),
        customers: this.db.prepare('SELECT * FROM customers ORDER BY id').all(),
        promotions: this.db.prepare('SELECT * FROM promotions ORDER BY id').all(),
        purchases: this.db.prepare('SELECT * FROM purchases ORDER BY created_at DESC').all(),
        purchaseItems: this.db.prepare('SELECT * FROM purchase_items ORDER BY id').all(),
        orders: this.db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all(),
        orderItems: this.db.prepare('SELECT * FROM order_items ORDER BY id').all(),
        returns: this.db.prepare('SELECT * FROM returns ORDER BY created_at DESC').all(),
        returnItems: this.db.prepare('SELECT * FROM return_items ORDER BY id').all(),
        stockAudits: this.db.prepare('SELECT * FROM stock_audits ORDER BY created_at DESC').all(),
        stockAuditItems: this.db.prepare('SELECT * FROM stock_audit_items ORDER BY id').all(),
        stockMovements: this.db.prepare('SELECT * FROM stock_movements ORDER BY created_at DESC').all(),
      },
    };
    for (const [k, rows] of Object.entries(snapshot.data)) {
      snapshot.counts[k] = rows.length;
    }
    this.repos.auditLogs.append({
      actor,
      action: 'SYSTEM_BACKUP',
      entityType: 'Database',
      entityId: 'retailflow.db',
      detail: `Xuất bản sao lưu SQLite JSON (${snapshot.counts.products} sản phẩm, ${snapshot.counts.orders} hóa đơn, ${snapshot.counts.returns} phiếu trả).`,
    });
    return snapshot;
  }
}

module.exports = { SystemService };
