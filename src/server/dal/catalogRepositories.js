'use strict';
const crypto = require('node:crypto');

function genId(prefix) {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

class CategoryRepository {
  constructor(db) {
    this.db = db;
  }

  list({ search = '', status = '' } = {}) {
    const clauses = [];
    const params = [];
    if (search && search.trim()) {
      const q = `%${search.trim().toLowerCase()}%`;
      clauses.push('(lower(c.code) LIKE ? OR lower(c.name) LIKE ? OR lower(c.description) LIKE ?)');
      params.push(q, q, q);
    }
    if (status && status.trim()) {
      clauses.push('c.status = ?');
      params.push(status.trim());
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return this.db
      .prepare(
        `SELECT c.code, c.name, c.description, c.status, c.created_at,
                (SELECT COUNT(*) FROM products p WHERE p.category_code = c.code) AS product_count
         FROM categories c
         ${where}
         ORDER BY c.code ASC`,
      )
      .all(...params);
  }

  findByCode(code) {
    return (
      this.db
        .prepare(
          `SELECT c.code, c.name, c.description, c.status, c.created_at,
                  (SELECT COUNT(*) FROM products p WHERE p.category_code = c.code) AS product_count
           FROM categories c WHERE c.code = ?`,
        )
        .get(code) || null
    );
  }

  findByName(name) {
    return this.db.prepare('SELECT * FROM categories WHERE lower(name) = lower(?)').get(name) || null;
  }

  nextCode() {
    const rows = this.db.prepare(`SELECT code FROM categories WHERE code LIKE 'DM%'`).all();
    let maxNum = 0;
    for (const r of rows) {
      const m = /^DM(\d+)$/.exec(r.code);
      if (m) maxNum = Math.max(maxNum, Number(m[1]));
    }
    return `DM${String(maxNum + 1).padStart(2, '0')}`;
  }

  create({ code, name, description = '', status = 'HoatDong' }) {
    const nowIso = new Date().toISOString();
    const finalCode = code || this.nextCode();
    this.db
      .prepare(
        `INSERT INTO categories (code, name, description, status, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(finalCode, name, description, status, nowIso);
    return this.findByCode(finalCode);
  }

  update(code, fields) {
    const sets = [];
    const params = [];
    for (const key of ['name', 'description', 'status']) {
      if (fields[key] !== undefined) {
        sets.push(`${key} = ?`);
        params.push(fields[key]);
      }
    }
    if (!sets.length) return this.findByCode(code);
    params.push(code);
    this.db.prepare(`UPDATE categories SET ${sets.join(', ')} WHERE code = ?`).run(...params);
    return this.findByCode(code);
  }

  countProducts(code) {
    return this.db.prepare('SELECT COUNT(*) AS cnt FROM products WHERE category_code = ?').get(code).cnt;
  }
}

class UnitRepository {
  constructor(db) {
    this.db = db;
  }

  list({ search = '', status = '' } = {}) {
    const clauses = [];
    const params = [];
    if (search && search.trim()) {
      const q = `%${search.trim().toLowerCase()}%`;
      clauses.push('(lower(u.code) LIKE ? OR lower(u.name) LIKE ?)');
      params.push(q, q);
    }
    if (status && status.trim()) {
      clauses.push('u.status = ?');
      params.push(status.trim());
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return this.db
      .prepare(
        `SELECT u.code, u.name, u.status, u.created_at,
                (SELECT COUNT(*) FROM products p WHERE p.unit_code = u.code) AS product_count
         FROM units u
         ${where}
         ORDER BY u.code ASC`,
      )
      .all(...params);
  }

  findByCode(code) {
    return (
      this.db
        .prepare(
          `SELECT u.code, u.name, u.status, u.created_at,
                  (SELECT COUNT(*) FROM products p WHERE p.unit_code = u.code) AS product_count
           FROM units u WHERE u.code = ?`,
        )
        .get(code) || null
    );
  }

  findByName(name) {
    return this.db.prepare('SELECT * FROM units WHERE lower(name) = lower(?)').get(name) || null;
  }

  nextCode() {
    const rows = this.db.prepare(`SELECT code FROM units WHERE code LIKE 'DVT%'`).all();
    let maxNum = 0;
    for (const r of rows) {
      const m = /^DVT(\d+)$/.exec(r.code);
      if (m) maxNum = Math.max(maxNum, Number(m[1]));
    }
    return `DVT${String(maxNum + 1).padStart(2, '0')}`;
  }

  create({ code, name, status = 'HoatDong' }) {
    const nowIso = new Date().toISOString();
    const finalCode = code || this.nextCode();
    this.db
      .prepare(`INSERT INTO units (code, name, status, created_at) VALUES (?, ?, ?, ?)`)
      .run(finalCode, name, status, nowIso);
    return this.findByCode(finalCode);
  }

  update(code, fields) {
    const sets = [];
    const params = [];
    for (const key of ['name', 'status']) {
      if (fields[key] !== undefined) {
        sets.push(`${key} = ?`);
        params.push(fields[key]);
      }
    }
    if (!sets.length) return this.findByCode(code);
    params.push(code);
    this.db.prepare(`UPDATE units SET ${sets.join(', ')} WHERE code = ?`).run(...params);
    return this.findByCode(code);
  }

  countProducts(code) {
    return this.db.prepare('SELECT COUNT(*) AS cnt FROM products WHERE unit_code = ?').get(code).cnt;
  }
}

class SupplierRepository {
  constructor(db) {
    this.db = db;
  }

  list({ search = '', status = '' } = {}) {
    const clauses = [];
    const params = [];
    if (search && search.trim()) {
      const q = `%${search.trim().toLowerCase()}%`;
      clauses.push(
        '(lower(s.id) LIKE ? OR lower(s.name) LIKE ? OR lower(s.phone) LIKE ? OR lower(s.category_group) LIKE ? OR lower(s.areas) LIKE ?)',
      );
      params.push(q, q, q, q, q);
    }
    if (status && status.trim()) {
      clauses.push('s.status = ?');
      params.push(status.trim());
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return this.db
      .prepare(
        `SELECT s.id, s.name, s.phone, s.category_group, s.areas, s.payment_terms_days, s.status, s.created_at,
                (SELECT COUNT(*) FROM products p WHERE p.supplier_id = s.id) AS product_count,
                (SELECT COUNT(*) FROM purchases pu WHERE pu.supplier_id = s.id) AS purchase_count
         FROM suppliers s
         ${where}
         ORDER BY s.id ASC`,
      )
      .all(...params);
  }

  findById(id) {
    return (
      this.db
        .prepare(
          `SELECT s.id, s.name, s.phone, s.category_group, s.areas, s.payment_terms_days, s.status, s.created_at,
                  (SELECT COUNT(*) FROM products p WHERE p.supplier_id = s.id) AS product_count,
                  (SELECT COUNT(*) FROM purchases pu WHERE pu.supplier_id = s.id) AS purchase_count
           FROM suppliers s WHERE s.id = ?`,
        )
        .get(id) || null
    );
  }

  findByName(name) {
    return this.db.prepare('SELECT * FROM suppliers WHERE lower(name) = lower(?)').get(name) || null;
  }

  nextId() {
    const rows = this.db.prepare(`SELECT id FROM suppliers WHERE id LIKE 'NCC%'`).all();
    let maxNum = 0;
    for (const r of rows) {
      const m = /^NCC(\d+)$/.exec(r.id);
      if (m) maxNum = Math.max(maxNum, Number(m[1]));
    }
    return `NCC${String(maxNum + 1).padStart(3, '0')}`;
  }

  create({ id, name, phone = '', category_group = '', areas = '', payment_terms_days = 30, status = 'HoatDong' }) {
    const nowIso = new Date().toISOString();
    const finalId = id || this.nextId();
    this.db
      .prepare(
        `INSERT INTO suppliers (id, name, phone, category_group, areas, payment_terms_days, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(finalId, name, phone, category_group, areas, payment_terms_days, status, nowIso);
    this.db
      .prepare(`INSERT OR IGNORE INTO branch_suppliers (branch_id, supplier_id) VALUES ('CN001', ?)`)
      .run(finalId);
    return this.findById(finalId);
  }

  update(id, fields) {
    const sets = [];
    const params = [];
    for (const key of ['name', 'phone', 'category_group', 'areas', 'payment_terms_days', 'status']) {
      if (fields[key] !== undefined) {
        sets.push(`${key} = ?`);
        params.push(fields[key]);
      }
    }
    if (!sets.length) return this.findById(id);
    params.push(id);
    this.db.prepare(`UPDATE suppliers SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    return this.findById(id);
  }

  countReferences(id) {
    const prodCnt = this.db.prepare('SELECT COUNT(*) AS cnt FROM products WHERE supplier_id = ?').get(id).cnt;
    const purCnt = this.db.prepare('SELECT COUNT(*) AS cnt FROM purchases WHERE supplier_id = ?').get(id).cnt;
    return { productCount: prodCnt, purchaseCount: purCnt, total: prodCnt + purCnt };
  }

  listPurchases(supplierId) {
    return this.db
      .prepare(
        `SELECT p.id, p.total_amount, p.status, p.note, p.created_at, p.confirmed_at,
                u.full_name AS created_by_name
         FROM purchases p
         LEFT JOIN users u ON u.id = p.created_by
         WHERE p.supplier_id = ?
         ORDER BY p.created_at DESC`,
      )
      .all(supplierId);
  }
}

class ProductRepository {
  constructor(db) {
    this.db = db;
  }

  baseSelect() {
    return `
      SELECT p.id, p.sku, p.barcode, p.name, p.brand, p.pack_size,
             p.category_code, c.name AS category_name,
             p.unit_code, u.name AS unit_name,
             p.supplier_id, s.name AS supplier_name,
             p.sale_price, p.cost_price, p.stock_qty, p.min_stock,
             p.image_url, p.thumb_url,
             p.has_expiry, p.expiry_warn_days, p.non_returnable,
             p.case_unit_name, p.units_per_case, p.damaged_stock_qty,
             (SELECT MIN(b.expiry_date)
                FROM product_batches b
               WHERE b.product_id = p.id
                 AND b.qty_remaining > 0
                 AND b.status NOT IN ('HetHan', 'DaHuy', 'DaHet')
                 AND b.expiry_date != '') AS earliest_expiry_date,
             p.status, p.created_at, p.updated_at
      FROM products p
      JOIN categories c ON c.code = p.category_code
      JOIN units u ON u.code = p.unit_code
      JOIN suppliers s ON s.id = p.supplier_id
    `;
  }

  list({
    search = '',
    categoryCode = '',
    supplierId = '',
    status = '',
    stockLevel = '',
    minPrice = '',
    maxPrice = '',
  } = {}) {
    const clauses = [];
    const params = [];
    if (search && search.trim()) {
      const q = `%${search.trim().toLowerCase()}%`;
      clauses.push(
        '(lower(p.sku) LIKE ? OR lower(p.id) LIKE ? OR lower(p.name) LIKE ? OR lower(p.barcode) LIKE ? OR lower(p.brand) LIKE ?)',
      );
      params.push(q, q, q, q, q);
    }
    if (categoryCode && categoryCode.trim()) {
      clauses.push('p.category_code = ?');
      params.push(categoryCode.trim());
    }
    if (supplierId && supplierId.trim()) {
      clauses.push('p.supplier_id = ?');
      params.push(supplierId.trim());
    }
    if (status && status.trim()) {
      clauses.push('p.status = ?');
      params.push(status.trim());
    }
    if (stockLevel === 'low') {
      clauses.push('p.stock_qty <= p.min_stock');
    } else if (stockLevel === 'out') {
      clauses.push('p.stock_qty = 0');
    } else if (stockLevel === 'ok') {
      clauses.push('p.stock_qty > p.min_stock');
    }
    if (minPrice !== '' && minPrice !== null && minPrice !== undefined && !Number.isNaN(Number(minPrice))) {
      clauses.push('p.sale_price >= ?');
      params.push(Number(minPrice));
    }
    if (maxPrice !== '' && maxPrice !== null && maxPrice !== undefined && !Number.isNaN(Number(maxPrice))) {
      clauses.push('p.sale_price <= ?');
      params.push(Number(maxPrice));
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return this.db.prepare(`${this.baseSelect()} ${where} ORDER BY p.id ASC`).all(...params);
  }

  getSummary() {
    return this.db
      .prepare(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN status = 'DangKinhDoanh' THEN 1 ELSE 0 END) AS active_count,
           SUM(CASE WHEN status = 'NgungKinhDoanh' THEN 1 ELSE 0 END) AS inactive_count,
           SUM(CASE WHEN status = 'DangKinhDoanh' AND stock_qty <= min_stock THEN 1 ELSE 0 END) AS low_stock_count,
           SUM(CASE WHEN status = 'DangKinhDoanh' AND stock_qty = 0 THEN 1 ELSE 0 END) AS out_of_stock_count,
           COALESCE(SUM(stock_qty), 0) AS total_stock_qty,
           COALESCE(SUM(stock_qty * cost_price), 0) AS total_inventory_value
         FROM products`,
      )
      .get();
  }

  findById(id) {
    return this.db.prepare(`${this.baseSelect()} WHERE p.id = ?`).get(id) || null;
  }

  findBySku(sku) {
    return this.db.prepare(`${this.baseSelect()} WHERE lower(p.sku) = lower(?)`).get(sku) || null;
  }

  findByBarcode(barcode) {
    return this.db.prepare(`${this.baseSelect()} WHERE lower(p.barcode) = lower(?)`).get(barcode) || null;
  }

  nextId() {
    const rows = this.db.prepare(`SELECT id FROM products WHERE id LIKE 'SP%'`).all();
    let maxNum = 0;
    for (const r of rows) {
      const m = /^SP(\d+)$/.exec(r.id);
      if (m) maxNum = Math.max(maxNum, Number(m[1]));
    }
    return `SP${String(maxNum + 1).padStart(3, '0')}`;
  }

  create(data) {
    const nowIso = new Date().toISOString();
    const id = data.id || this.nextId();
    const sku = data.sku || id;
    const thumbUrl =
      data.thumb_url ||
      (String(data.image_url || '').startsWith('assets/images/products/')
        ? String(data.image_url).replace(/^assets\/images\/products\//, 'assets/images/products/thumbs/')
        : data.image_url || '');
    this.db
      .prepare(
        `INSERT INTO products (
           id, sku, barcode, name, brand, pack_size,
           category_code, unit_code, supplier_id,
           sale_price, cost_price, stock_qty, min_stock,
           image_url, thumb_url, has_expiry, expiry_warn_days,
           non_returnable, case_unit_name, units_per_case, damaged_stock_qty,
           status, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      )
      .run(
        id,
        sku,
        data.barcode,
        data.name,
        data.brand || '',
        data.pack_size || '',
        data.category_code,
        data.unit_code,
        data.supplier_id,
        data.sale_price,
        data.cost_price,
        data.stock_qty ?? 0,
        data.min_stock ?? 15,
        data.image_url,
        thumbUrl,
        data.has_expiry ?? 1,
        data.expiry_warn_days ?? 14,
        data.non_returnable ?? 0,
        data.case_unit_name || 'Thùng',
        data.units_per_case ?? 12,
        data.status || 'DangKinhDoanh',
        nowIso,
        nowIso,
      );
    return this.findById(id);
  }

  update(id, fields) {
    const nowIso = new Date().toISOString();
    const sets = [];
    const params = [];
    const allowed = [
      'sku',
      'barcode',
      'name',
      'brand',
      'pack_size',
      'category_code',
      'unit_code',
      'supplier_id',
      'sale_price',
      'cost_price',
      'min_stock',
      'image_url',
      'thumb_url',
      'has_expiry',
      'expiry_warn_days',
      'non_returnable',
      'case_unit_name',
      'units_per_case',
      'status',
    ];
    for (const key of allowed) {
      if (fields[key] !== undefined) {
        sets.push(`${key} = ?`);
        params.push(fields[key]);
      }
    }
    sets.push('updated_at = ?');
    params.push(nowIso, id);
    this.db.prepare(`UPDATE products SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    return this.findById(id);
  }

  updateStock(id, newStockQty) {
    const nowIso = new Date().toISOString();
    this.db
      .prepare('UPDATE products SET stock_qty = ?, updated_at = ? WHERE id = ?')
      .run(newStockQty, nowIso, id);
    return this.findById(id);
  }

  addDamagedStock(id, qty) {
    const nowIso = new Date().toISOString();
    this.db
      .prepare('UPDATE products SET damaged_stock_qty = damaged_stock_qty + ?, updated_at = ? WHERE id = ?')
      .run(Math.max(0, Number(qty) || 0), nowIso, id);
    return this.findById(id);
  }

  countTransactionRefs(id) {
    const orderItems = this.db.prepare('SELECT COUNT(*) AS cnt FROM order_items WHERE product_id = ?').get(id).cnt;
    const purchaseItems = this.db.prepare('SELECT COUNT(*) AS cnt FROM purchase_items WHERE product_id = ?').get(id).cnt;
    const returnItems = this.db.prepare('SELECT COUNT(*) AS cnt FROM return_items WHERE product_id = ?').get(id).cnt;
    const auditItems = this.db.prepare('SELECT COUNT(*) AS cnt FROM stock_audit_items WHERE product_id = ?').get(id).cnt;
    const stockMovements = this.db.prepare('SELECT COUNT(*) AS cnt FROM stock_movements WHERE product_id = ?').get(id).cnt;
    return {
      orderItems,
      purchaseItems,
      returnItems,
      auditItems,
      stockMovements,
      total: orderItems + purchaseItems + returnItems + auditItems + stockMovements,
    };
  }
}

class StockMovementRepository {
  constructor(db) {
    this.db = db;
  }

  // Strictly append-only (LichSuTonKho is immutable)
  append({
    productId,
    stockBefore,
    delta,
    stockAfter,
    docType,
    docId,
    batchCode = '',
    actorId = null,
    actorName = 'Hệ thống',
    note = '',
  }) {
    const id = genId('STK');
    const nowIso = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO stock_movements (
           id, product_id, stock_before, delta, stock_after,
           doc_type, doc_id, batch_code, actor_id, actor_name, note, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        productId,
        stockBefore,
        delta,
        stockAfter,
        docType,
        String(docId || ''),
        String(batchCode || ''),
        actorId,
        actorName,
        note,
        nowIso,
      );
    return this.findById(id);
  }

  findById(id) {
    return (
      this.db
        .prepare(
          `SELECT sm.*, p.sku, p.name AS product_name, u.name AS unit_name
           FROM stock_movements sm
           JOIN products p ON p.id = sm.product_id
           JOIN units u ON u.code = p.unit_code
           WHERE sm.id = ?`,
        )
        .get(id) || null
    );
  }

  query({ search = '', productId = '', docType = '', fromDate = '', toDate = '', page = 1, limit = 15 } = {}) {
    const clauses = [];
    const params = [];
    if (search && search.trim()) {
      const q = `%${search.trim().toLowerCase()}%`;
      clauses.push(
        '(lower(p.sku) LIKE ? OR lower(p.name) LIKE ? OR lower(sm.doc_id) LIKE ? OR lower(sm.note) LIKE ? OR lower(sm.actor_name) LIKE ?)',
      );
      params.push(q, q, q, q, q);
    }
    if (productId && productId.trim()) {
      clauses.push('sm.product_id = ?');
      params.push(productId.trim());
    }
    if (docType && docType.trim()) {
      clauses.push('sm.doc_type = ?');
      params.push(docType.trim());
    }
    if (fromDate && fromDate.trim()) {
      clauses.push('substr(sm.created_at, 1, 10) >= ?');
      params.push(fromDate.trim());
    }
    if (toDate && toDate.trim()) {
      clauses.push('substr(sm.created_at, 1, 10) <= ?');
      params.push(toDate.trim());
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const total = this.db
      .prepare(
        `SELECT COUNT(*) AS cnt
         FROM stock_movements sm
         JOIN products p ON p.id = sm.product_id
         ${where}`,
      )
      .get(...params).cnt;
    const safeLimit = Math.min(Math.max(Number(limit) || 15, 1), 100);
    const safePage = Math.max(Number(page) || 1, 1);
    const offset = (safePage - 1) * safeLimit;
    const items = this.db
      .prepare(
        `SELECT sm.id, sm.product_id, p.sku, p.name AS product_name, p.image_url,
                u.name AS unit_name,
                sm.stock_before, sm.delta, sm.stock_after,
                sm.doc_type, sm.doc_id, sm.batch_code, sm.actor_id, sm.actor_name, sm.note, sm.created_at
         FROM stock_movements sm
         JOIN products p ON p.id = sm.product_id
         JOIN units u ON u.code = p.unit_code
         ${where}
         ORDER BY sm.created_at DESC, sm.id DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, safeLimit, offset);
    const docTypes = this.db
      .prepare('SELECT DISTINCT doc_type FROM stock_movements ORDER BY doc_type ASC')
      .all()
      .map((r) => r.doc_type);
    return {
      items,
      total,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.max(1, Math.ceil(total / safeLimit)),
      docTypes,
    };
  }
}

module.exports = {
  CategoryRepository,
  UnitRepository,
  SupplierRepository,
  ProductRepository,
  StockMovementRepository,
};
