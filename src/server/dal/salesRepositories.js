'use strict';

class PromotionRepository {
  constructor(db) {
    this.db = db;
  }

  nextId() {
    const rows = this.db.prepare(`SELECT id FROM promotions WHERE id LIKE 'KM%'`).all();
    let maxNum = 0;
    for (const r of rows) {
      const m = /^KM(\d+)$/.exec(r.id);
      if (m) maxNum = Math.max(maxNum, Number(m[1]));
    }
    return `KM${String(maxNum + 1).padStart(3, '0')}`;
  }

  list({ search = '', status = '' } = {}) {
    const clauses = [];
    const params = [];
    if (search && search.trim()) {
      const q = `%${search.trim().toLowerCase()}%`;
      clauses.push('(lower(code) LIKE ? OR lower(name) LIKE ? OR lower(id) LIKE ?)');
      params.push(q, q, q);
    }
    if (status && status.trim()) {
      clauses.push('status = ?');
      params.push(status.trim());
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return this.db
      .prepare(`SELECT * FROM promotions ${where} ORDER BY created_at DESC, id DESC`)
      .all(...params);
  }

  findById(id) {
    return this.db.prepare('SELECT * FROM promotions WHERE id = ?').get(id) || null;
  }

  findByCode(code) {
    return this.db.prepare('SELECT * FROM promotions WHERE lower(code) = lower(?)').get(String(code || '').trim()) || null;
  }

  create(data) {
    const nowIso = new Date().toISOString();
    const id = data.id || this.nextId();
    this.db
      .prepare(
        `INSERT INTO promotions (
           id, code, name, discount_type, discount_value, min_order_amount,
           max_discount, start_date, end_date, usage_limit, used_count,
           scope, category_code, near_expiry_days, status, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        data.code,
        data.name,
        data.discount_type,
        data.discount_value,
        data.min_order_amount ?? 0,
        data.max_discount ?? 0,
        data.start_date,
        data.end_date,
        data.usage_limit ?? 1000,
        data.scope || 'INVOICE',
        data.category_code || '',
        data.near_expiry_days ?? 14,
        data.status || 'DangDienRa',
        nowIso,
      );
    if (Array.isArray(data.product_ids)) {
      this.setProducts(id, data.product_ids);
    }
    return this.findById(id);
  }

  update(id, fields) {
    const allowed = [
      'code',
      'name',
      'discount_type',
      'discount_value',
      'min_order_amount',
      'max_discount',
      'start_date',
      'end_date',
      'usage_limit',
      'scope',
      'category_code',
      'near_expiry_days',
      'status',
    ];
    const sets = [];
    const params = [];
    for (const key of allowed) {
      if (fields[key] !== undefined) {
        sets.push(`${key} = ?`);
        params.push(fields[key]);
      }
    }
    if (sets.length) {
      params.push(id);
      this.db.prepare(`UPDATE promotions SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    }
    if (Array.isArray(fields.product_ids)) {
      this.setProducts(id, fields.product_ids);
    }
    return this.findById(id);
  }

  setProducts(promoId, productIds = []) {
    this.db.prepare('DELETE FROM promotion_products WHERE promotion_id = ?').run(promoId);
    const ins = this.db.prepare('INSERT OR IGNORE INTO promotion_products (promotion_id, product_id) VALUES (?, ?)');
    for (const pid of productIds) {
      if (pid) ins.run(promoId, String(pid).trim());
    }
  }

  getProductIds(promoId) {
    return this.db
      .prepare('SELECT product_id FROM promotion_products WHERE promotion_id = ? ORDER BY product_id ASC')
      .all(promoId)
      .map((r) => r.product_id);
  }

  incrementUsedCount(id) {
    this.db.prepare('UPDATE promotions SET used_count = used_count + 1 WHERE id = ?').run(id);
    return this.findById(id);
  }
}

class CustomerRepository {
  constructor(db) {
    this.db = db;
  }

  nextId() {
    const rows = this.db.prepare(`SELECT id FROM customers WHERE id LIKE 'KH%'`).all();
    let maxNum = 0;
    for (const r of rows) {
      const m = /^KH(\d+)$/.exec(r.id);
      if (m) maxNum = Math.max(maxNum, Number(m[1]));
    }
    return `KH${String(maxNum + 1).padStart(3, '0')}`;
  }

  list({ search = '', status = '' } = {}) {
    const clauses = [];
    const params = [];
    if (search && search.trim()) {
      const q = `%${search.trim().toLowerCase()}%`;
      clauses.push('(lower(c.id) LIKE ? OR lower(c.name) LIKE ? OR lower(c.phone) LIKE ? OR lower(c.email) LIKE ?)');
      params.push(q, q, q, q);
    }
    if (status && status.trim()) {
      clauses.push('c.status = ?');
      params.push(status.trim());
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return this.db
      .prepare(
        `SELECT c.*,
                (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id AND o.status != 'DaHuy') AS order_count,
                (SELECT COALESCE(SUM(o.total_amount), 0) FROM orders o WHERE o.customer_id = c.id AND o.status != 'DaHuy') AS gross_spent,
                (SELECT COALESCE(SUM(r.refund_amount), 0)
                   FROM returns r
                   JOIN orders o2 ON o2.id = r.order_id
                  WHERE o2.customer_id = c.id AND r.status = 'DaXacNhan') AS refunded_total
         FROM customers c
         ${where}
         ORDER BY c.id ASC`,
      )
      .all(...params);
  }

  findById(id) {
    return this.db.prepare('SELECT * FROM customers WHERE id = ?').get(id) || null;
  }

  findByPhone(phone) {
    return this.db.prepare('SELECT * FROM customers WHERE phone = ?').get(String(phone || '').trim()) || null;
  }

  create(data) {
    const nowIso = new Date().toISOString();
    const id = data.id || this.nextId();
    this.db
      .prepare(
        `INSERT INTO customers (id, name, phone, email, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, data.name, data.phone, data.email || '', data.status || 'HoatDong', nowIso);
    return this.findById(id);
  }

  update(id, fields) {
    const allowed = ['name', 'phone', 'email', 'status'];
    const sets = [];
    const params = [];
    for (const key of allowed) {
      if (fields[key] !== undefined) {
        sets.push(`${key} = ?`);
        params.push(fields[key]);
      }
    }
    if (!sets.length) return this.findById(id);
    params.push(id);
    this.db.prepare(`UPDATE customers SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    return this.findById(id);
  }
}

class OrderRepository {
  constructor(db) {
    this.db = db;
  }

  nextId() {
    const rows = this.db.prepare(`SELECT id FROM orders WHERE id LIKE 'HD%'`).all();
    let maxNum = 0;
    for (const r of rows) {
      const m = /^HD(\d+)$/.exec(r.id);
      if (m) maxNum = Math.max(maxNum, Number(m[1]));
    }
    return `HD${String(maxNum + 1).padStart(4, '0')}`;
  }

  list({ search = '', status = '', paymentMethod = '', customerId = '', fromDate = '', toDate = '' } = {}) {
    const clauses = [];
    const params = [];
    if (search && search.trim()) {
      const q = `%${search.trim().toLowerCase()}%`;
      clauses.push(
        '(lower(o.id) LIKE ? OR lower(COALESCE(c.name, \'khach le\')) LIKE ? OR lower(COALESCE(c.phone, \'\')) LIKE ? OR lower(u.full_name) LIKE ? OR lower(o.payment_ref) LIKE ? OR lower(o.note) LIKE ?)',
      );
      params.push(q, q, q, q, q, q);
    }
    if (status && status.trim()) {
      clauses.push('o.status = ?');
      params.push(status.trim());
    }
    if (paymentMethod && paymentMethod.trim()) {
      clauses.push('o.payment_method = ?');
      params.push(paymentMethod.trim());
    }
    if (customerId && customerId.trim()) {
      clauses.push('o.customer_id = ?');
      params.push(customerId.trim());
    }
    if (fromDate && fromDate.trim()) {
      clauses.push('substr(o.created_at, 1, 10) >= ?');
      params.push(fromDate.trim());
    }
    if (toDate && toDate.trim()) {
      clauses.push('substr(o.created_at, 1, 10) <= ?');
      params.push(toDate.trim());
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return this.db
      .prepare(
        `SELECT o.*,
                COALESCE(c.name, 'Khách lẻ') AS customer_name,
                COALESCE(c.phone, '') AS customer_phone,
                u.full_name AS cashier_name,
                u.username AS cashier_username,
                pr.code AS promotion_code,
                pr.name AS promotion_name,
                v.code AS voucher_code,
                v.name AS voucher_name,
                (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count,
                (SELECT COALESCE(SUM(oi.qty), 0) FROM order_items oi WHERE oi.order_id = o.id) AS total_qty,
                (SELECT COALESCE(SUM(r.refund_amount), 0) FROM returns r WHERE r.order_id = o.id AND r.status = 'DaXacNhan') AS refunded_amount
         FROM orders o
         LEFT JOIN customers c ON c.id = o.customer_id
         JOIN users u ON u.id = o.cashier_id
         LEFT JOIN promotions pr ON pr.id = o.promotion_id
         LEFT JOIN vouchers v ON v.id = o.voucher_id
         ${where}
         ORDER BY o.created_at DESC, o.id DESC`,
      )
      .all(...params);
  }

  findById(id) {
    const header =
      this.db
        .prepare(
          `SELECT o.*,
                  COALESCE(c.name, 'Khách lẻ') AS customer_name,
                  COALESCE(c.phone, '') AS customer_phone,
                  u.full_name AS cashier_name,
                  u.username AS cashier_username,
                  pr.code AS promotion_code,
                  pr.name AS promotion_name,
                  v.code AS voucher_code,
                  v.name AS voucher_name,
                  (SELECT COALESCE(SUM(r.refund_amount), 0) FROM returns r WHERE r.order_id = o.id AND r.status = 'DaXacNhan') AS refunded_amount
           FROM orders o
           LEFT JOIN customers c ON c.id = o.customer_id
           JOIN users u ON u.id = o.cashier_id
           LEFT JOIN promotions pr ON pr.id = o.promotion_id
           LEFT JOIN vouchers v ON v.id = o.voucher_id
           WHERE o.id = ?`,
        )
        .get(id) || null;
    if (!header) return null;

    const items = this.db
      .prepare(
        `SELECT oi.*, p.sku, p.barcode, p.image_url, p.non_returnable, un.name AS unit_name
         FROM order_items oi
         JOIN products p ON p.id = oi.product_id
         JOIN units un ON un.code = p.unit_code
         WHERE oi.order_id = ?
         ORDER BY oi.id ASC`,
      )
      .all(id);

    const returns = this.db
      .prepare(
        `SELECT r.*, uc.full_name AS created_by_name, ua.full_name AS approved_by_name
         FROM returns r
         JOIN users uc ON uc.id = r.created_by
         LEFT JOIN users ua ON ua.id = r.approved_by
         WHERE r.order_id = ?
         ORDER BY r.created_at DESC, r.id DESC`,
      )
      .all(id);

    return { ...header, items, returns };
  }

  create(header, items) {
    const nowIso = header.created_at || new Date().toISOString();
    const id = header.id || this.nextId();
    this.db
      .prepare(
        `INSERT INTO orders (
           id, customer_id, cashier_id, shift_id, discount_mode, promotion_id, voucher_id,
           subtotal, invoice_discount, tax_rate, tax_amount, total_amount,
           payment_method, cash_received, cash_change, payment_ref,
           status, note, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        header.customer_id || null,
        header.cashier_id,
        header.shift_id || null,
        header.discount_mode || 'NONE',
        header.promotion_id || null,
        header.voucher_id || null,
        header.subtotal,
        header.invoice_discount || 0,
        header.tax_rate || 0,
        header.tax_amount || 0,
        header.total_amount,
        header.payment_method,
        header.cash_received || 0,
        header.cash_change || 0,
        header.payment_ref || '',
        header.status || 'DaThanhToan',
        header.note || '',
        nowIso,
      );

    const insertItem = this.db.prepare(`
      INSERT INTO order_items (
        order_id, product_id, product_name_snapshot,
        unit_price_snapshot, unit_cost_snapshot,
        qty, line_discount, returned_qty
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0)
    `);
    for (const item of items) {
      insertItem.run(
        id,
        item.product_id,
        item.product_name_snapshot,
        item.unit_price_snapshot,
        item.unit_cost_snapshot,
        item.qty,
        item.line_discount || 0,
      );
    }
    return this.findById(id);
  }

  updateStatus(id, status) {
    this.db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, id);
    return this.findById(id);
  }

  incrementItemReturnedQty(orderId, productId, addQty) {
    this.db
      .prepare(
        `UPDATE order_items
         SET returned_qty = returned_qty + ?
         WHERE order_id = ? AND product_id = ?`,
      )
      .run(addQty, orderId, productId);
  }
}

class ReturnRepository {
  constructor(db) {
    this.db = db;
  }

  nextId() {
    const rows = this.db.prepare(`SELECT id FROM returns WHERE id LIKE 'TH%'`).all();
    let maxNum = 0;
    for (const r of rows) {
      const m = /^TH(\d+)$/.exec(r.id);
      if (m) maxNum = Math.max(maxNum, Number(m[1]));
    }
    return `TH${String(maxNum + 1).padStart(4, '0')}`;
  }

  list({ search = '', status = '', orderId = '', fromDate = '', toDate = '' } = {}) {
    const clauses = [];
    const params = [];
    if (search && search.trim()) {
      const q = `%${search.trim().toLowerCase()}%`;
      clauses.push(
        '(lower(r.id) LIKE ? OR lower(r.order_id) LIKE ? OR lower(r.reason) LIKE ? OR lower(COALESCE(c.name, \'khach le\')) LIKE ? OR lower(uc.full_name) LIKE ?)',
      );
      params.push(q, q, q, q, q);
    }
    if (status && status.trim()) {
      clauses.push('r.status = ?');
      params.push(status.trim());
    }
    if (orderId && orderId.trim()) {
      clauses.push('r.order_id = ?');
      params.push(orderId.trim());
    }
    if (fromDate && fromDate.trim()) {
      clauses.push('substr(r.created_at, 1, 10) >= ?');
      params.push(fromDate.trim());
    }
    if (toDate && toDate.trim()) {
      clauses.push('substr(r.created_at, 1, 10) <= ?');
      params.push(toDate.trim());
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return this.db
      .prepare(
        `SELECT r.*,
                o.payment_method AS order_payment_method,
                o.total_amount AS order_total_amount,
                o.created_at AS order_created_at,
                COALESCE(c.name, 'Khách lẻ') AS customer_name,
                uc.full_name AS created_by_name,
                ua.full_name AS approved_by_name,
                (SELECT COUNT(*) FROM return_items ri WHERE ri.return_id = r.id) AS item_count,
                (SELECT COALESCE(SUM(ri.qty), 0) FROM return_items ri WHERE ri.return_id = r.id) AS total_qty
         FROM returns r
         JOIN orders o ON o.id = r.order_id
         LEFT JOIN customers c ON c.id = o.customer_id
         JOIN users uc ON uc.id = r.created_by
         LEFT JOIN users ua ON ua.id = r.approved_by
         ${where}
         ORDER BY r.created_at DESC, r.id DESC`,
      )
      .all(...params);
  }

  findById(id) {
    const header =
      this.db
        .prepare(
          `SELECT r.*,
                  o.payment_method AS order_payment_method,
                  o.total_amount AS order_total_amount,
                  o.created_at AS order_created_at,
                  COALESCE(c.name, 'Khách lẻ') AS customer_name,
                  uc.full_name AS created_by_name,
                  ua.full_name AS approved_by_name
           FROM returns r
           JOIN orders o ON o.id = r.order_id
           LEFT JOIN customers c ON c.id = o.customer_id
           JOIN users uc ON uc.id = r.created_by
           LEFT JOIN users ua ON ua.id = r.approved_by
           WHERE r.id = ?`,
        )
        .get(id) || null;
    if (!header) return null;

    const items = this.db
      .prepare(
        `SELECT ri.*, p.sku, p.name AS product_name, p.image_url, un.name AS unit_name,
                oi.unit_price_snapshot, oi.qty AS purchased_qty, oi.returned_qty AS order_returned_qty
         FROM return_items ri
         JOIN products p ON p.id = ri.product_id
         JOIN units un ON un.code = p.unit_code
         LEFT JOIN order_items oi ON oi.order_id = ? AND oi.product_id = ri.product_id
         WHERE ri.return_id = ?
         ORDER BY ri.id ASC`,
      )
      .all(header.order_id, id);

    return { ...header, items };
  }

  getPendingQtyMap(orderId, excludeReturnId = '') {
    const rows = this.db
      .prepare(
        `SELECT ri.product_id, COALESCE(SUM(ri.qty), 0) AS pending_qty
         FROM return_items ri
         JOIN returns r ON r.id = ri.return_id
         WHERE r.order_id = ? AND r.status = 'ChoDuyet' AND r.id != ?
         GROUP BY ri.product_id`,
      )
      .all(orderId, excludeReturnId || '');
    const map = new Map();
    for (const row of rows) {
      map.set(row.product_id, Number(row.pending_qty) || 0);
    }
    return map;
  }

  create(header, items) {
    const nowIso = header.created_at || new Date().toISOString();
    const id = header.id || this.nextId();
    this.db
      .prepare(
        `INSERT INTO returns (
           id, order_id, created_by, approved_by, reason, restock, refund_amount, status, created_at, resolved_at
         ) VALUES (?, ?, ?, NULL, ?, ?, ?, 'ChoDuyet', ?, NULL)`,
      )
      .run(
        id,
        header.order_id,
        header.created_by,
        header.reason,
        header.restock ? 1 : 0,
        header.refund_amount,
        nowIso,
      );

    const insertItem = this.db.prepare(`
      INSERT INTO return_items (return_id, product_id, qty, refund_line_amount)
      VALUES (?, ?, ?, ?)
    `);
    for (const item of items) {
      insertItem.run(id, item.product_id, item.qty, item.refund_line_amount);
    }
    return this.findById(id);
  }

  updateStatus(id, status, extra = {}) {
    const sets = ['status = ?'];
    const params = [status];
    if (extra.approved_by !== undefined) {
      sets.push('approved_by = ?');
      params.push(extra.approved_by);
    }
    if (extra.resolved_at !== undefined) {
      sets.push('resolved_at = ?');
      params.push(extra.resolved_at);
    }
    if (extra.reason !== undefined) {
      sets.push('reason = ?');
      params.push(extra.reason);
    }
    params.push(id);
    this.db.prepare(`UPDATE returns SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    return this.findById(id);
  }
}

module.exports = {
  PromotionRepository,
  CustomerRepository,
  OrderRepository,
  ReturnRepository,
};
