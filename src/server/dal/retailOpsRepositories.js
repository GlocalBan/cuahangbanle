'use strict';
const crypto = require('node:crypto');

function genId(prefix) {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

class BatchRepository {
  constructor(db) {
    this.db = db;
  }

  nextId() {
    return genId('LOT');
  }

  list({ productId = '', categoryCode = '', search = '', status = '', includeEmpty = false } = {}) {
    const clauses = [];
    const params = [];
    if (productId && productId.trim()) {
      clauses.push('b.product_id = ?');
      params.push(productId.trim());
    }
    if (categoryCode && categoryCode.trim()) {
      clauses.push('p.category_code = ?');
      params.push(categoryCode.trim());
    }
    if (search && search.trim()) {
      const q = `%${search.trim().toLowerCase()}%`;
      clauses.push('(lower(b.batch_code) LIKE ? OR lower(p.sku) LIKE ? OR lower(p.name) LIKE ?)');
      params.push(q, q, q);
    }
    if (status && status.trim()) {
      clauses.push('b.status = ?');
      params.push(status.trim());
    }
    if (!includeEmpty) {
      clauses.push('b.qty_remaining > 0');
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return this.db
      .prepare(
        `SELECT b.*,
                p.sku, p.name AS product_name, p.image_url, p.thumb_url,
                p.category_code, c.name AS category_name,
                p.unit_code, u.name AS unit_name,
                p.sale_price, p.has_expiry, p.expiry_warn_days
         FROM product_batches b
         JOIN products p ON p.id = b.product_id
         JOIN categories c ON c.code = p.category_code
         JOIN units u ON u.code = p.unit_code
         ${where}
         ORDER BY CASE WHEN b.expiry_date = '' THEN 1 ELSE 0 END ASC, b.expiry_date ASC, b.created_at ASC`,
      )
      .all(...params);
  }

  findById(id) {
    return (
      this.db
        .prepare(
          `SELECT b.*,
                  p.sku, p.name AS product_name, p.image_url, p.thumb_url,
                  p.category_code, c.name AS category_name,
                  p.unit_code, u.name AS unit_name,
                  p.sale_price, p.has_expiry, p.expiry_warn_days
           FROM product_batches b
           JOIN products p ON p.id = b.product_id
           JOIN categories c ON c.code = p.category_code
           JOIN units u ON u.code = p.unit_code
           WHERE b.id = ?`,
        )
        .get(id) || null
    );
  }

  findSalableFefo(productId, refDate = todayYmd()) {
    return this.db
      .prepare(
        `SELECT b.*
         FROM product_batches b
         WHERE b.product_id = ?
           AND b.qty_remaining > 0
           AND b.status NOT IN ('HetHan', 'DaHuy', 'DaHet')
           AND (b.expiry_date = '' OR b.expiry_date > ?)
         ORDER BY CASE WHEN b.expiry_date = '' THEN 1 ELSE 0 END ASC, b.expiry_date ASC, b.created_at ASC`,
      )
      .all(productId, refDate);
  }

  findExpiredByProduct(productId, refDate = todayYmd()) {
    return this.db
      .prepare(
        `SELECT b.*
         FROM product_batches b
         WHERE b.product_id = ?
           AND b.qty_remaining > 0
           AND b.status != 'DaHuy'
           AND b.expiry_date != ''
           AND b.expiry_date <= ?
         ORDER BY b.expiry_date ASC`,
      )
      .all(productId, refDate);
  }

  create({
    id,
    batchCode,
    productId,
    mfgDate = '',
    expiryDate = '',
    initialQty,
    qtyRemaining,
    unitCost = 0,
    purchaseId = null,
    status = 'ConHan',
    createdAt,
  }) {
    const finalId = id || this.nextId();
    const nowIso = createdAt || new Date().toISOString();
    const qty = Math.max(0, Math.round(Number(initialQty) || 0));
    const rem = qtyRemaining !== undefined ? Math.max(0, Math.round(Number(qtyRemaining) || 0)) : qty;
    this.db
      .prepare(
        `INSERT INTO product_batches (
           id, batch_code, product_id, mfg_date, expiry_date,
           initial_qty, qty_remaining, unit_cost, purchase_id, status, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        finalId,
        batchCode || `LO-${nowIso.slice(0, 10).replace(/-/g, '')}-${finalId.slice(-4)}`,
        productId,
        mfgDate || '',
        expiryDate || '',
        qty,
        rem,
        Math.max(0, Math.round(Number(unitCost) || 0)),
        purchaseId || null,
        status,
        nowIso,
      );
    return this.findById(finalId);
  }

  updateQtyAndStatus(id, newQty, newStatus) {
    const safeQty = Math.max(0, Math.round(Number(newQty) || 0));
    const finalStatus = newStatus || (safeQty === 0 ? 'DaHet' : 'ConHan');
    this.db
      .prepare('UPDATE product_batches SET qty_remaining = ?, status = ? WHERE id = ?')
      .run(safeQty, finalStatus, id);
    return this.findById(id);
  }

  sumSalableQty(productId, refDate = todayYmd()) {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(qty_remaining), 0) AS qty
         FROM product_batches
         WHERE product_id = ?
           AND qty_remaining > 0
           AND status NOT IN ('HetHan', 'DaHuy', 'DaHet')
           AND (expiry_date = '' OR expiry_date > ?)`,
      )
      .get(productId, refDate);
    return Number(row?.qty) || 0;
  }

  syncProductSalableStock(productId, refDate = todayYmd()) {
    const salable = this.sumSalableQty(productId, refDate);
    const nowIso = new Date().toISOString();
    this.db
      .prepare('UPDATE products SET stock_qty = ?, updated_at = ? WHERE id = ?')
      .run(salable, nowIso, productId);
    return salable;
  }

  findNearExpiryAndExpired({ maxDays = 14, categoryCode = '', includeExpired = true, refDate = todayYmd() } = {}) {
    const clauses = [
      'b.qty_remaining > 0',
      "b.status NOT IN ('DaHuy', 'DaHet')",
      "b.expiry_date != ''",
    ];
    const params = [];
    const cutoff = new Date(`${refDate}T00:00:00Z`);
    cutoff.setUTCDate(cutoff.getUTCDate() + Math.max(0, Number(maxDays) || 14));
    const cutoffYmd = cutoff.toISOString().slice(0, 10);
    clauses.push('b.expiry_date <= ?');
    params.push(cutoffYmd);
    if (!includeExpired) {
      clauses.push('b.expiry_date > ?');
      params.push(refDate);
    }
    if (categoryCode && categoryCode.trim()) {
      clauses.push('p.category_code = ?');
      params.push(categoryCode.trim());
    }
    return this.db
      .prepare(
        `SELECT b.*,
                p.sku, p.name AS product_name, p.image_url, p.thumb_url,
                p.category_code, c.name AS category_name,
                p.unit_code, u.name AS unit_name,
                p.sale_price, p.cost_price, p.has_expiry, p.expiry_warn_days
         FROM product_batches b
         JOIN products p ON p.id = b.product_id
         JOIN categories c ON c.code = p.category_code
         JOIN units u ON u.code = p.unit_code
         WHERE ${clauses.join(' AND ')}
         ORDER BY b.expiry_date ASC, b.product_id ASC`,
      )
      .all(...params);
  }
}

class WriteOffRepository {
  constructor(db) {
    this.db = db;
  }

  nextId() {
    const rows = this.db.prepare(`SELECT id FROM batch_writeoffs WHERE id LIKE 'HH%'`).all();
    let maxNum = 0;
    for (const r of rows) {
      const m = /^HH(\d+)$/.exec(r.id);
      if (m) maxNum = Math.max(maxNum, Number(m[1]));
    }
    return `HH${String(maxNum + 1).padStart(3, '0')}`;
  }

  list({ status = '', search = '', fromDate = '', toDate = '' } = {}) {
    const clauses = [];
    const params = [];
    if (status && status.trim()) {
      clauses.push('w.status = ?');
      params.push(status.trim());
    }
    if (search && search.trim()) {
      const q = `%${search.trim().toLowerCase()}%`;
      clauses.push('(lower(w.id) LIKE ? OR lower(w.reason) LIKE ? OR lower(uc.full_name) LIKE ?)');
      params.push(q, q, q);
    }
    if (fromDate && fromDate.trim()) {
      clauses.push('substr(w.created_at, 1, 10) >= ?');
      params.push(fromDate.trim());
    }
    if (toDate && toDate.trim()) {
      clauses.push('substr(w.created_at, 1, 10) <= ?');
      params.push(toDate.trim());
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return this.db
      .prepare(
        `SELECT w.*,
                uc.full_name AS created_by_name,
                ua.full_name AS approved_by_name,
                (SELECT COUNT(*) FROM batch_writeoff_items wi WHERE wi.writeoff_id = w.id) AS item_count
         FROM batch_writeoffs w
         JOIN users uc ON uc.id = w.created_by
         LEFT JOIN users ua ON ua.id = w.approved_by
         ${where}
         ORDER BY w.created_at DESC, w.id DESC`,
      )
      .all(...params);
  }

  findById(id) {
    const header =
      this.db
        .prepare(
          `SELECT w.*,
                  uc.full_name AS created_by_name,
                  ua.full_name AS approved_by_name
           FROM batch_writeoffs w
           JOIN users uc ON uc.id = w.created_by
           LEFT JOIN users ua ON ua.id = w.approved_by
           WHERE w.id = ?`,
        )
        .get(id) || null;
    if (!header) return null;
    const items = this.db
      .prepare(
        `SELECT wi.*, p.sku, p.name AS product_name, p.image_url, u.name AS unit_name
         FROM batch_writeoff_items wi
         JOIN products p ON p.id = wi.product_id
         JOIN units u ON u.code = p.unit_code
         WHERE wi.writeoff_id = ?
         ORDER BY wi.id ASC`,
      )
      .all(id);
    return { ...header, items };
  }

  create(header, items) {
    const id = header.id || this.nextId();
    const nowIso = header.created_at || new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO batch_writeoffs (
           id, created_by, approved_by, reason, total_qty, total_value, status, created_at, approved_at
         ) VALUES (?, ?, NULL, ?, ?, ?, 'ChoDuyet', ?, NULL)`,
      )
      .run(id, header.created_by, header.reason, header.total_qty, header.total_value, nowIso);
    const ins = this.db.prepare(
      `INSERT INTO batch_writeoff_items (
         writeoff_id, batch_id, product_id, batch_code, expiry_date, qty, unit_cost, line_value, reason
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const item of items) {
      ins.run(
        id,
        item.batch_id,
        item.product_id,
        item.batch_code,
        item.expiry_date || '',
        item.qty,
        item.unit_cost,
        item.line_value,
        item.reason || '',
      );
    }
    return this.findById(id);
  }

  updateStatus(id, status, { approved_by = null, approved_at = null } = {}) {
    this.db
      .prepare('UPDATE batch_writeoffs SET status = ?, approved_by = ?, approved_at = ? WHERE id = ?')
      .run(status, approved_by, approved_at, id);
    return this.findById(id);
  }

  sumApprovedLoss({ fromDate = '', toDate = '' } = {}) {
    const clauses = ["status = 'DaDuyet'"];
    const params = [];
    if (fromDate) {
      clauses.push('substr(COALESCE(approved_at, created_at), 1, 10) >= ?');
      params.push(fromDate);
    }
    if (toDate) {
      clauses.push('substr(COALESCE(approved_at, created_at), 1, 10) <= ?');
      params.push(toDate);
    }
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS doc_count,
                COALESCE(SUM(total_qty), 0) AS total_qty,
                COALESCE(SUM(total_value), 0) AS total_value
         FROM batch_writeoffs
         WHERE ${clauses.join(' AND ')}`,
      )
      .get(...params);
    return {
      docCount: Number(row?.doc_count) || 0,
      totalQty: Number(row?.total_qty) || 0,
      totalValue: Number(row?.total_value) || 0,
    };
  }
}

class VoucherRepository {
  constructor(db) {
    this.db = db;
  }

  nextId() {
    const rows = this.db.prepare(`SELECT id FROM vouchers WHERE id LIKE 'VC%'`).all();
    let maxNum = 0;
    for (const r of rows) {
      const m = /^VC(\d+)$/.exec(r.id);
      if (m) maxNum = Math.max(maxNum, Number(m[1]));
    }
    return `VC${String(maxNum + 1).padStart(3, '0')}`;
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
      .prepare(`SELECT * FROM vouchers ${where} ORDER BY created_at DESC, id DESC`)
      .all(...params);
  }

  findById(id) {
    return this.db.prepare('SELECT * FROM vouchers WHERE id = ?').get(id) || null;
  }

  findByCode(code) {
    return this.db.prepare('SELECT * FROM vouchers WHERE upper(code) = upper(?)').get(code) || null;
  }

  create(data) {
    const id = data.id || this.nextId();
    const nowIso = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO vouchers (
           id, code, name, discount_type, discount_value, min_order_amount,
           max_discount, start_date, end_date, usage_limit, used_count,
           max_uses_per_customer, status, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      )
      .run(
        id,
        String(data.code).trim().toUpperCase(),
        data.name,
        data.discount_type,
        data.discount_value,
        data.min_order_amount ?? 0,
        data.max_discount ?? 0,
        data.start_date,
        data.end_date,
        data.usage_limit ?? 100,
        data.max_uses_per_customer ?? 1,
        data.status || 'DangDienRa',
        nowIso,
      );
    return this.findById(id);
  }

  update(id, fields) {
    const allowed = [
      'name',
      'discount_type',
      'discount_value',
      'min_order_amount',
      'max_discount',
      'start_date',
      'end_date',
      'usage_limit',
      'max_uses_per_customer',
      'status',
    ];
    const sets = [];
    const params = [];
    for (const k of allowed) {
      if (fields[k] !== undefined) {
        sets.push(`${k} = ?`);
        params.push(fields[k]);
      }
    }
    if (!sets.length) return this.findById(id);
    params.push(id);
    this.db.prepare(`UPDATE vouchers SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    return this.findById(id);
  }

  countCustomerUses(voucherId, customerId) {
    if (!customerId) return 0;
    const row = this.db
      .prepare('SELECT COUNT(*) AS cnt FROM voucher_redemptions WHERE voucher_id = ? AND customer_id = ?')
      .get(voucherId, customerId);
    return Number(row?.cnt) || 0;
  }

  recordRedemption({ voucherId, orderId, customerId = null, discountAmount = 0 }) {
    const nowIso = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO voucher_redemptions (id, voucher_id, order_id, customer_id, discount_amount, redeemed_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(genId('VCR'), voucherId, orderId, customerId || null, discountAmount, nowIso);
    this.db.prepare('UPDATE vouchers SET used_count = used_count + 1 WHERE id = ?').run(voucherId);
  }
}

class CashierShiftRepository {
  constructor(db) {
    this.db = db;
  }

  nextId() {
    const rows = this.db.prepare(`SELECT id FROM cashier_shifts WHERE id LIKE 'CA%'`).all();
    let maxNum = 0;
    for (const r of rows) {
      const m = /^CA(\d+)$/.exec(r.id);
      if (m) maxNum = Math.max(maxNum, Number(m[1]));
    }
    return `CA${String(maxNum + 1).padStart(3, '0')}`;
  }

  findOpenByCashier(cashierId) {
    return (
      this.db
        .prepare(
          `SELECT cs.*, u.full_name AS cashier_name, u.username AS cashier_username
           FROM cashier_shifts cs
           JOIN users u ON u.id = cs.cashier_id
           WHERE cs.cashier_id = ? AND cs.status = 'DangMo'
           ORDER BY cs.opened_at DESC LIMIT 1`,
        )
        .get(cashierId) || null
    );
  }

  findById(id) {
    return (
      this.db
        .prepare(
          `SELECT cs.*, u.full_name AS cashier_name, u.username AS cashier_username
           FROM cashier_shifts cs
           JOIN users u ON u.id = cs.cashier_id
           WHERE cs.id = ?`,
        )
        .get(id) || null
    );
  }

  list({ cashierId = '', status = '', limit = 30 } = {}) {
    const clauses = [];
    const params = [];
    if (cashierId) {
      clauses.push('cs.cashier_id = ?');
      params.push(cashierId);
    }
    if (status) {
      clauses.push('cs.status = ?');
      params.push(status);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return this.db
      .prepare(
        `SELECT cs.*, u.full_name AS cashier_name, u.username AS cashier_username
         FROM cashier_shifts cs
         JOIN users u ON u.id = cs.cashier_id
         ${where}
         ORDER BY cs.opened_at DESC LIMIT ?`,
      )
      .all(...params, Math.min(Math.max(Number(limit) || 30, 1), 200));
  }

  open({ cashierId, openingCash = 0, note = '' }) {
    const id = this.nextId();
    const nowIso = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO cashier_shifts (
           id, cashier_id, opened_at, closed_at, opening_cash, expected_cash,
           actual_cash, variance, cash_sales, cash_refunds, non_cash_sales, order_count, status, note
         ) VALUES (?, ?, ?, NULL, ?, ?, NULL, NULL, 0, 0, 0, 0, 'DangMo', ?)`,
      )
      .run(id, cashierId, nowIso, openingCash, openingCash, note || '');
    return this.findById(id);
  }

  computeShiftMetrics(shiftId, cashierId, openedAt) {
    const salesRow = this.db
      .prepare(
        `SELECT COUNT(*) AS order_count,
                COALESCE(SUM(CASE WHEN payment_method = 'CASH' THEN total_amount ELSE 0 END), 0) AS cash_sales,
                COALESCE(SUM(CASE WHEN payment_method != 'CASH' THEN total_amount ELSE 0 END), 0) AS non_cash_sales
         FROM orders
         WHERE (shift_id = ? OR (shift_id IS NULL AND cashier_id = ? AND created_at >= ?))
           AND status IN ('DaThanhToan', 'TraMotPhan', 'DaHoanTra')`,
      )
      .get(shiftId, cashierId, openedAt);
    const refundRow = this.db
      .prepare(
        `SELECT COALESCE(SUM(r.refund_amount), 0) AS cash_refunds
         FROM returns r
         JOIN orders o ON o.id = r.order_id
         WHERE r.status = 'DaXacNhan'
           AND o.payment_method = 'CASH'
           AND COALESCE(r.resolved_at, r.created_at) >= ?
           AND (r.created_by = ? OR o.shift_id = ?)`,
      )
      .get(openedAt, cashierId, shiftId);
    return {
      orderCount: Number(salesRow?.order_count) || 0,
      cashSales: Number(salesRow?.cash_sales) || 0,
      nonCashSales: Number(salesRow?.non_cash_sales) || 0,
      cashRefunds: Number(refundRow?.cash_refunds) || 0,
    };
  }

  close(id, { expectedCash, actualCash, variance, cashSales, cashRefunds, nonCashSales, orderCount, note = '' }) {
    const nowIso = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE cashier_shifts
         SET closed_at = ?, expected_cash = ?, actual_cash = ?, variance = ?,
             cash_sales = ?, cash_refunds = ?, non_cash_sales = ?, order_count = ?,
             status = 'DaDong', note = ?
         WHERE id = ?`,
      )
      .run(
        nowIso,
        expectedCash,
        actualCash,
        variance,
        cashSales,
        cashRefunds,
        nonCashSales,
        orderCount,
        note || '',
        id,
      );
    return this.findById(id);
  }
}

class SupplierOpsRepository {
  constructor(db) {
    this.db = db;
  }

  addNegotiation({ purchaseId, roundNo, actorId, actorRole, actorName, action, proposedItemsJson = '[]', expectedDeliveryDate = '', note = '' }) {
    const id = genId('NEG');
    const nowIso = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO purchase_negotiations (
           id, purchase_id, round_no, actor_id, actor_role, actor_name,
           action, proposed_items_json, expected_delivery_date, note, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        purchaseId,
        roundNo,
        actorId,
        actorRole,
        actorName,
        action,
        proposedItemsJson,
        expectedDeliveryDate || '',
        note || '',
        nowIso,
      );
    return this.db.prepare('SELECT * FROM purchase_negotiations WHERE id = ?').get(id);
  }

  listNegotiations(purchaseId) {
    return this.db
      .prepare('SELECT * FROM purchase_negotiations WHERE purchase_id = ? ORDER BY round_no ASC, created_at ASC')
      .all(purchaseId);
  }

  nextGrnId() {
    const rows = this.db.prepare(`SELECT id FROM purchase_receipts WHERE id LIKE 'GRN%'`).all();
    let maxNum = 0;
    for (const r of rows) {
      const m = /^GRN(\d+)$/.exec(r.id);
      if (m) maxNum = Math.max(maxNum, Number(m[1]));
    }
    return `GRN${String(maxNum + 1).padStart(3, '0')}`;
  }

  createGrn(header, items) {
    const id = header.id || this.nextGrnId();
    const nowIso = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO purchase_receipts (
           id, purchase_id, supplier_id, received_by, approved_by,
           total_received_amount, status, note, created_at, confirmed_at
         ) VALUES (?, ?, ?, ?, NULL, ?, 'ChoDuyet', ?, ?, NULL)`,
      )
      .run(
        id,
        header.purchase_id,
        header.supplier_id,
        header.received_by,
        header.total_received_amount,
        header.note || '',
        nowIso,
      );
    const ins = this.db.prepare(
      `INSERT INTO purchase_receipt_items (
         receipt_id, product_id, ordered_qty, received_qty, rejected_qty,
         unit_cost, batch_code, mfg_date, expiry_date, qc_note
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const it of items) {
      ins.run(
        id,
        it.product_id,
        it.ordered_qty,
        it.received_qty,
        it.rejected_qty || 0,
        it.unit_cost,
        it.batch_code || '',
        it.mfg_date || '',
        it.expiry_date || '',
        it.qc_note || '',
      );
    }
    return this.findGrnById(id);
  }

  findGrnById(id) {
    const header =
      this.db
        .prepare(
          `SELECT grn.*, s.name AS supplier_name, u1.full_name AS received_by_name, u2.full_name AS approved_by_name
           FROM purchase_receipts grn
           JOIN suppliers s ON s.id = grn.supplier_id
           JOIN users u1 ON u1.id = grn.received_by
           LEFT JOIN users u2 ON u2.id = grn.approved_by
           WHERE grn.id = ?`,
        )
        .get(id) || null;
    if (!header) return null;
    const items = this.db
      .prepare(
        `SELECT ri.*, p.sku, p.name AS product_name, p.has_expiry, p.cost_price AS current_cost_price, u.name AS unit_name
         FROM purchase_receipt_items ri
         JOIN products p ON p.id = ri.product_id
         JOIN units u ON u.code = p.unit_code
         WHERE ri.receipt_id = ?
         ORDER BY ri.id ASC`,
      )
      .all(id);
    return { ...header, items };
  }

  listGrns({ purchaseId = '', supplierId = '', status = '' } = {}) {
    const clauses = [];
    const params = [];
    if (purchaseId) {
      clauses.push('grn.purchase_id = ?');
      params.push(purchaseId);
    }
    if (supplierId) {
      clauses.push('grn.supplier_id = ?');
      params.push(supplierId);
    }
    if (status) {
      clauses.push('grn.status = ?');
      params.push(status);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return this.db
      .prepare(
        `SELECT grn.*, s.name AS supplier_name, u1.full_name AS received_by_name, u2.full_name AS approved_by_name,
                (SELECT COALESCE(SUM(ri.received_qty), 0) FROM purchase_receipt_items ri WHERE ri.receipt_id = grn.id) AS total_received_qty,
                (SELECT COALESCE(SUM(ri.rejected_qty), 0) FROM purchase_receipt_items ri WHERE ri.receipt_id = grn.id) AS total_rejected_qty
         FROM purchase_receipts grn
         JOIN suppliers s ON s.id = grn.supplier_id
         JOIN users u1 ON u1.id = grn.received_by
         LEFT JOIN users u2 ON u2.id = grn.approved_by
         ${where}
         ORDER BY grn.created_at DESC`,
      )
      .all(...params);
  }

  updateGrnStatus(id, status, { approved_by = null, confirmed_at = null } = {}) {
    this.db
      .prepare('UPDATE purchase_receipts SET status = ?, approved_by = ?, confirmed_at = ? WHERE id = ?')
      .run(status, approved_by, confirmed_at, id);
    return this.findGrnById(id);
  }

  nextPayableId() {
    const rows = this.db.prepare(`SELECT id FROM supplier_payables WHERE id LIKE 'CNCC%'`).all();
    let maxNum = 0;
    for (const r of rows) {
      const m = /^CNCC(\d+)$/.exec(r.id);
      if (m) maxNum = Math.max(maxNum, Number(m[1]));
    }
    return `CNCC${String(maxNum + 1).padStart(3, '0')}`;
  }

  createPayable({ supplierId, purchaseId, receiptId = null, totalAmount, dueDate, note = '' }) {
    const id = this.nextPayableId();
    const nowIso = new Date().toISOString();
    const amt = Math.max(0, Math.round(Number(totalAmount) || 0));
    this.db
      .prepare(
        `INSERT INTO supplier_payables (
           id, supplier_id, purchase_id, receipt_id, total_amount, paid_amount,
           balance_amount, due_date, status, note, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        supplierId,
        purchaseId,
        receiptId,
        amt,
        amt,
        dueDate,
        amt === 0 ? 'DaThanhToanNCC' : 'ChuaThanhToan',
        note || '',
        nowIso,
        nowIso,
      );
    return this.findPayableById(id);
  }

  findPayableById(id) {
    const header =
      this.db
        .prepare(
          `SELECT sp.*, s.name AS supplier_name, s.phone AS supplier_phone
           FROM supplier_payables sp
           JOIN suppliers s ON s.id = sp.supplier_id
           WHERE sp.id = ?`,
        )
        .get(id) || null;
    if (!header) return null;
    const payments = this.db
      .prepare(
        `SELECT pay.*, u.full_name AS actor_name
         FROM supplier_payments pay
         JOIN users u ON u.id = pay.created_by
         WHERE pay.payable_id = ?
         ORDER BY pay.paid_at DESC`,
      )
      .all(id);
    return { ...header, payments };
  }

  findPayableByPurchase(purchaseId) {
    return (
      this.db.prepare('SELECT * FROM supplier_payables WHERE purchase_id = ? ORDER BY created_at DESC LIMIT 1').get(purchaseId) ||
      null
    );
  }

  findPayableByReceipt(receiptId) {
    if (!receiptId) return null;
    return this.db
      .prepare(
        `SELECT sp.*, s.name AS supplier_name, s.phone AS supplier_phone
         FROM supplier_payables sp
         JOIN suppliers s ON s.id = sp.supplier_id
         WHERE sp.receipt_id = ?
         ORDER BY sp.created_at DESC
         LIMIT 1`,
      )
      .get(receiptId);
  }

  listPayables({ supplierId = '', status = '' } = {}) {
    const clauses = [];
    const params = [];
    if (supplierId) {
      clauses.push('sp.supplier_id = ?');
      params.push(supplierId);
    }
    if (status) {
      clauses.push('sp.status = ?');
      params.push(status);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return this.db
      .prepare(
        `SELECT sp.*, s.name AS supplier_name, s.phone AS supplier_phone
         FROM supplier_payables sp
         JOIN suppliers s ON s.id = sp.supplier_id
         ${where}
         ORDER BY sp.due_date ASC, sp.created_at DESC`,
      )
      .all(...params);
  }

  recordPayment({ payableId, amount, paymentMethod = 'BANK_TRANSFER', paymentRef = '', createdBy, note = '' }) {
    const pay = this.findPayableById(payableId);
    if (!pay) return null;
    const nowIso = new Date().toISOString();
    const id = genId('PAYNCC');
    this.db
      .prepare(
        `INSERT INTO supplier_payments (id, payable_id, amount, payment_method, payment_ref, created_by, note, paid_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, payableId, amount, paymentMethod, paymentRef || '', createdBy, note || '', nowIso);
    const newPaid = Number(pay.paid_amount) + amount;
    const newBalance = Math.max(0, Number(pay.total_amount) - newPaid);
    const newStatus = newBalance === 0 ? 'DaThanhToanNCC' : 'ThanhToanMotPhan';
    this.db
      .prepare('UPDATE supplier_payables SET paid_amount = ?, balance_amount = ?, status = ?, updated_at = ? WHERE id = ?')
      .run(newPaid, newBalance, newStatus, nowIso, payableId);
    return this.findPayableById(payableId);
  }

  reducePayableForReturn(payableId, creditAmount) {
    const pay = this.db.prepare('SELECT * FROM supplier_payables WHERE id = ?').get(payableId);
    if (!pay) return null;
    const nowIso = new Date().toISOString();
    const newTotal = Math.max(0, Number(pay.total_amount) - creditAmount);
    const newBalance = Math.max(0, newTotal - Number(pay.paid_amount));
    const newStatus = newBalance === 0 ? 'DaThanhToanNCC' : Number(pay.paid_amount) > 0 ? 'ThanhToanMotPhan' : 'ChuaThanhToan';
    this.db
      .prepare('UPDATE supplier_payables SET total_amount = ?, balance_amount = ?, status = ?, updated_at = ? WHERE id = ?')
      .run(newTotal, newBalance, newStatus, nowIso, payableId);
    return this.findPayableById(payableId);
  }

  nextSupplierReturnId() {
    const rows = this.db.prepare(`SELECT id FROM supplier_returns WHERE id LIKE 'TNCC%'`).all();
    let maxNum = 0;
    for (const r of rows) {
      const m = /^TNCC(\d+)$/.exec(r.id);
      if (m) maxNum = Math.max(maxNum, Number(m[1]));
    }
    return `TNCC${String(maxNum + 1).padStart(3, '0')}`;
  }

  createSupplierReturn(header, items) {
    const id = header.id || this.nextSupplierReturnId();
    const nowIso = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO supplier_returns (
           id, supplier_id, purchase_id, created_by, approved_by,
           total_amount, reason, status, created_at, approved_at
         ) VALUES (?, ?, ?, ?, NULL, ?, ?, 'ChoDuyet', ?, NULL)`,
      )
      .run(id, header.supplier_id, header.purchase_id || null, header.created_by, header.total_amount, header.reason, nowIso);
    const ins = this.db.prepare(
      `INSERT INTO supplier_return_items (return_id, product_id, batch_id, batch_code, qty, unit_cost, line_total, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const it of items) {
      ins.run(id, it.product_id, it.batch_id || null, it.batch_code || '', it.qty, it.unit_cost, it.line_total, it.reason || '');
    }
    return this.findSupplierReturnById(id);
  }

  findSupplierReturnById(id) {
    const header =
      this.db
        .prepare(
          `SELECT sr.*, s.name AS supplier_name, u1.full_name AS created_by_name, u2.full_name AS approved_by_name
           FROM supplier_returns sr
           JOIN suppliers s ON s.id = sr.supplier_id
           JOIN users u1 ON u1.id = sr.created_by
           LEFT JOIN users u2 ON u2.id = sr.approved_by
           WHERE sr.id = ?`,
        )
        .get(id) || null;
    if (!header) return null;
    const items = this.db
      .prepare(
        `SELECT sri.*, p.sku, p.name AS product_name, u.name AS unit_name
         FROM supplier_return_items sri
         JOIN products p ON p.id = sri.product_id
         JOIN units u ON u.code = p.unit_code
         WHERE sri.return_id = ?
         ORDER BY sri.id ASC`,
      )
      .all(id);
    return { ...header, items };
  }

  listSupplierReturns({ supplierId = '', status = '' } = {}) {
    const clauses = [];
    const params = [];
    if (supplierId) {
      clauses.push('sr.supplier_id = ?');
      params.push(supplierId);
    }
    if (status) {
      clauses.push('sr.status = ?');
      params.push(status);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return this.db
      .prepare(
        `SELECT sr.*, s.name AS supplier_name, u1.full_name AS created_by_name, u2.full_name AS approved_by_name
         FROM supplier_returns sr
         JOIN suppliers s ON s.id = sr.supplier_id
         JOIN users u1 ON u1.id = sr.created_by
         LEFT JOIN users u2 ON u2.id = sr.approved_by
         ${where}
         ORDER BY sr.created_at DESC`,
      )
      .all(...params);
  }

  updateSupplierReturnStatus(id, status, { approved_by = null, approved_at = null } = {}) {
    this.db
      .prepare('UPDATE supplier_returns SET status = ?, approved_by = ?, approved_at = ? WHERE id = ?')
      .run(status, approved_by, approved_at, id);
    return this.findSupplierReturnById(id);
  }
}

module.exports = {
  BatchRepository,
  WriteOffRepository,
  VoucherRepository,
  CashierShiftRepository,
  SupplierOpsRepository,
};
