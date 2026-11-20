'use strict';

class PurchaseRepository {
  constructor(db) {
    this.db = db;
  }

  nextId() {
    const rows = this.db.prepare(`SELECT id FROM purchases WHERE id LIKE 'PN%'`).all();
    let maxNum = 0;
    for (const r of rows) {
      const m = /^PN(\d+)$/.exec(r.id);
      if (m) maxNum = Math.max(maxNum, Number(m[1]));
    }
    return `PN${String(maxNum + 1).padStart(3, '0')}`;
  }

  list({ search = '', supplierId = '', status = '', fromDate = '', toDate = '' } = {}) {
    const clauses = [];
    const params = [];
    if (search && search.trim()) {
      const q = `%${search.trim().toLowerCase()}%`;
      clauses.push(
        '(lower(p.id) LIKE ? OR lower(s.name) LIKE ? OR lower(p.note) LIKE ? OR lower(uc.full_name) LIKE ?)',
      );
      params.push(q, q, q, q);
    }
    if (supplierId && supplierId.trim()) {
      clauses.push('p.supplier_id = ?');
      params.push(supplierId.trim());
    }
    if (status && status.trim()) {
      clauses.push('p.status = ?');
      params.push(status.trim());
    }
    if (fromDate && fromDate.trim()) {
      clauses.push('substr(p.created_at, 1, 10) >= ?');
      params.push(fromDate.trim());
    }
    if (toDate && toDate.trim()) {
      clauses.push('substr(p.created_at, 1, 10) <= ?');
      params.push(toDate.trim());
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return this.db
      .prepare(
        `SELECT p.*,
                s.name AS supplier_name,
                s.status AS supplier_status,
                uc.full_name AS created_by_name,
                uc.username AS created_by_username,
                ua.full_name AS approved_by_name,
                (SELECT COUNT(*) FROM purchase_items pi WHERE pi.purchase_id = p.id) AS item_count,
                (SELECT COALESCE(SUM(pi.qty), 0) FROM purchase_items pi WHERE pi.purchase_id = p.id) AS total_qty
         FROM purchases p
         JOIN suppliers s ON s.id = p.supplier_id
         JOIN users uc ON uc.id = p.created_by
         LEFT JOIN users ua ON ua.id = p.approved_by
         ${where}
         ORDER BY p.created_at DESC, p.id DESC`,
      )
      .all(...params);
  }

  findById(id) {
    const header =
      this.db
        .prepare(
          `SELECT p.*,
                  s.name AS supplier_name,
                  s.phone AS supplier_phone,
                  s.status AS supplier_status,
                  uc.full_name AS created_by_name,
                  uc.username AS created_by_username,
                  ua.full_name AS approved_by_name
           FROM purchases p
           JOIN suppliers s ON s.id = p.supplier_id
           JOIN users uc ON uc.id = p.created_by
           LEFT JOIN users ua ON ua.id = p.approved_by
           WHERE p.id = ?`,
        )
        .get(id) || null;
    if (!header) return null;

    const items = this.db
      .prepare(
        `SELECT pi.id, pi.purchase_id, pi.product_id, pi.qty, pi.unit_cost,
                pi.batch_code, pi.mfg_date, pi.expiry_date,
                pr.sku, pr.name AS product_name, pr.image_url,
                pr.stock_qty AS current_stock_qty, pr.cost_price AS current_cost_price,
                pr.status AS product_status, pr.has_expiry,
                u.name AS unit_name
         FROM purchase_items pi
         JOIN products pr ON pr.id = pi.product_id
         JOIN units u ON u.code = pr.unit_code
         WHERE pi.purchase_id = ?
         ORDER BY pi.id ASC`,
      )
      .all(id);

    return { ...header, items };
  }

  create(header, items) {
    const id = header.id || this.nextId();
    const nowIso = header.created_at || new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO purchases (id, supplier_id, created_by, approved_by, total_amount, note, status, created_at, confirmed_at)
         VALUES (?, ?, ?, NULL, ?, ?, 'Draft', ?, NULL)`,
      )
      .run(id, header.supplier_id, header.created_by, header.total_amount, header.note || '', nowIso);

    const insertItem = this.db.prepare(
      `INSERT INTO purchase_items (purchase_id, product_id, qty, unit_cost, batch_code, mfg_date, expiry_date)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const item of items) {
      insertItem.run(
        id,
        item.product_id,
        item.qty,
        item.unit_cost,
        item.batch_code || '',
        item.mfg_date || '',
        item.expiry_date || '',
      );
    }
    return this.findById(id);
  }

  updateDraft(id, { supplier_id, total_amount, note }, items) {
    this.db
      .prepare(
        `UPDATE purchases
         SET supplier_id = ?, total_amount = ?, note = ?
         WHERE id = ? AND status = 'Draft'`,
      )
      .run(supplier_id, total_amount, note || '', id);

    this.db.prepare('DELETE FROM purchase_items WHERE purchase_id = ?').run(id);
    const insertItem = this.db.prepare(
      `INSERT INTO purchase_items (purchase_id, product_id, qty, unit_cost, batch_code, mfg_date, expiry_date)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const item of items) {
      insertItem.run(
        id,
        item.product_id,
        item.qty,
        item.unit_cost,
        item.batch_code || '',
        item.mfg_date || '',
        item.expiry_date || '',
      );
    }
    return this.findById(id);
  }

  updateStatus(id, status, { approved_by = null, confirmed_at = null, note = undefined } = {}) {
    if (note !== undefined) {
      this.db
        .prepare(
          `UPDATE purchases
           SET status = ?, approved_by = ?, confirmed_at = ?, note = ?
           WHERE id = ?`,
        )
        .run(status, approved_by, confirmed_at, note, id);
    } else {
      this.db
        .prepare(
          `UPDATE purchases
           SET status = ?, approved_by = ?, confirmed_at = ?
           WHERE id = ?`,
        )
        .run(status, approved_by, confirmed_at, id);
    }
    return this.findById(id);
  }

  getPendingQtyByProduct() {
    const rows = this.db
      .prepare(
        `SELECT pi.product_id, COALESCE(SUM(pi.qty), 0) AS pending_qty
         FROM purchase_items pi
         JOIN purchases p ON p.id = pi.purchase_id
         WHERE p.status = 'Draft'
         GROUP BY pi.product_id`,
      )
      .all();
    return new Map(rows.map((r) => [r.product_id, Number(r.pending_qty) || 0]));
  }
}

class StockAuditRepository {
  constructor(db) {
    this.db = db;
  }

  nextId() {
    const rows = this.db.prepare(`SELECT id FROM stock_audits WHERE id LIKE 'KK%'`).all();
    let maxNum = 0;
    for (const r of rows) {
      const m = /^KK(\d+)$/.exec(r.id);
      if (m) maxNum = Math.max(maxNum, Number(m[1]));
    }
    return `KK${String(maxNum + 1).padStart(3, '0')}`;
  }

  list({ search = '', status = '', fromDate = '', toDate = '' } = {}) {
    const clauses = [];
    const params = [];
    if (search && search.trim()) {
      const q = `%${search.trim().toLowerCase()}%`;
      clauses.push(
        `(lower(a.id) LIKE ? OR lower(a.note) LIKE ? OR lower(uc.full_name) LIKE ?
          OR EXISTS (
            SELECT 1 FROM stock_audit_items sai
            JOIN products pr ON pr.id = sai.product_id
            WHERE sai.audit_id = a.id
              AND (lower(pr.name) LIKE ? OR lower(pr.sku) LIKE ? OR lower(sai.reason) LIKE ?)
          ))`,
      );
      params.push(q, q, q, q, q, q);
    }
    if (status && status.trim()) {
      clauses.push('a.status = ?');
      params.push(status.trim());
    }
    if (fromDate && fromDate.trim()) {
      clauses.push('substr(a.created_at, 1, 10) >= ?');
      params.push(fromDate.trim());
    }
    if (toDate && toDate.trim()) {
      clauses.push('substr(a.created_at, 1, 10) <= ?');
      params.push(toDate.trim());
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return this.db
      .prepare(
        `SELECT a.*,
                uc.full_name AS created_by_name,
                uc.username AS created_by_username,
                ua.full_name AS approved_by_name,
                (SELECT COUNT(*) FROM stock_audit_items sai WHERE sai.audit_id = a.id) AS item_count,
                (SELECT COUNT(*) FROM stock_audit_items sai WHERE sai.audit_id = a.id AND sai.diff_qty != 0) AS diff_item_count,
                (SELECT COALESCE(SUM(sai.diff_qty), 0) FROM stock_audit_items sai WHERE sai.audit_id = a.id) AS total_diff_qty,
                (SELECT COALESCE(SUM(ABS(sai.diff_qty) * pr.cost_price), 0)
                 FROM stock_audit_items sai
                 JOIN products pr ON pr.id = sai.product_id
                 WHERE sai.audit_id = a.id) AS total_abs_diff_value
         FROM stock_audits a
         JOIN users uc ON uc.id = a.created_by
         LEFT JOIN users ua ON ua.id = a.approved_by
         ${where}
         ORDER BY a.created_at DESC, a.id DESC`,
      )
      .all(...params);
  }

  findById(id) {
    const header =
      this.db
        .prepare(
          `SELECT a.*,
                  uc.full_name AS created_by_name,
                  uc.username AS created_by_username,
                  ua.full_name AS approved_by_name
           FROM stock_audits a
           JOIN users uc ON uc.id = a.created_by
           LEFT JOIN users ua ON ua.id = a.approved_by
           WHERE a.id = ?`,
        )
        .get(id) || null;
    if (!header) return null;

    const items = this.db
      .prepare(
        `SELECT sai.id, sai.audit_id, sai.product_id,
                sai.system_qty, sai.actual_qty, sai.diff_qty, sai.reason,
                pr.sku, pr.name AS product_name, pr.image_url,
                pr.stock_qty AS live_stock_qty, pr.cost_price,
                u.name AS unit_name
         FROM stock_audit_items sai
         JOIN products pr ON pr.id = sai.product_id
         JOIN units u ON u.code = pr.unit_code
         WHERE sai.audit_id = ?
         ORDER BY sai.id ASC`,
      )
      .all(id);

    return { ...header, items };
  }

  create(header, items) {
    const id = header.id || this.nextId();
    const nowIso = header.created_at || new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO stock_audits (id, created_by, approved_by, note, status, created_at, approved_at)
         VALUES (?, ?, NULL, ?, 'ChoDuyet', ?, NULL)`,
      )
      .run(id, header.created_by, header.note || '', nowIso);

    const insertItem = this.db.prepare(
      `INSERT INTO stock_audit_items (audit_id, product_id, system_qty, actual_qty, diff_qty, reason)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const item of items) {
      insertItem.run(
        id,
        item.product_id,
        item.system_qty,
        item.actual_qty,
        item.diff_qty,
        item.reason || '',
      );
    }
    return this.findById(id);
  }

  updateStatus(id, status, { approved_by = null, approved_at = null, note = undefined } = {}) {
    if (note !== undefined) {
      this.db
        .prepare(
          `UPDATE stock_audits
           SET status = ?, approved_by = ?, approved_at = ?, note = ?
           WHERE id = ?`,
        )
        .run(status, approved_by, approved_at, note, id);
    } else {
      this.db
        .prepare(
          `UPDATE stock_audits
           SET status = ?, approved_by = ?, approved_at = ?
           WHERE id = ?`,
        )
        .run(status, approved_by, approved_at, id);
    }
    return this.findById(id);
  }
}

module.exports = {
  PurchaseRepository,
  StockAuditRepository,
};
