'use strict';

const PAID_ORDER_STATUSES_SQL = "('DaThanhToan', 'TraMotPhan', 'DaHoanTra')";

class ReportRepository {
  constructor(db) {
    this.db = db;
  }

  getPaidOrdersInRange({ fromDate = '', toDate = '' } = {}) {
    const clauses = [`o.status IN ${PAID_ORDER_STATUSES_SQL}`];
    const params = [];
    if (fromDate) {
      clauses.push('substr(o.created_at, 1, 10) >= ?');
      params.push(fromDate);
    }
    if (toDate) {
      clauses.push('substr(o.created_at, 1, 10) <= ?');
      params.push(toDate);
    }
    const where = `WHERE ${clauses.join(' AND ')}`;
    return this.db
      .prepare(
        `SELECT o.id, o.customer_id, o.cashier_id, o.promotion_id,
                o.subtotal, o.invoice_discount, o.tax_rate, o.tax_amount, o.total_amount,
                o.payment_method, o.status, o.created_at,
                COALESCE(c.name, 'Khách lẻ') AS customer_name,
                u.full_name AS cashier_name,
                (SELECT COALESCE(SUM(r.refund_amount), 0)
                   FROM returns r
                  WHERE r.order_id = o.id AND r.status = 'DaXacNhan') AS refunded_amount
         FROM orders o
         LEFT JOIN customers c ON c.id = o.customer_id
         JOIN users u ON u.id = o.cashier_id
         ${where}
         ORDER BY o.created_at DESC, o.id DESC`,
      )
      .all(...params);
  }

  getPaidOrderItemsInRange({ fromDate = '', toDate = '' } = {}) {
    const clauses = [`o.status IN ${PAID_ORDER_STATUSES_SQL}`];
    const params = [];
    if (fromDate) {
      clauses.push('substr(o.created_at, 1, 10) >= ?');
      params.push(fromDate);
    }
    if (toDate) {
      clauses.push('substr(o.created_at, 1, 10) <= ?');
      params.push(toDate);
    }
    const where = `WHERE ${clauses.join(' AND ')}`;
    return this.db
      .prepare(
        `SELECT oi.id, oi.order_id, oi.product_id, oi.product_name_snapshot,
                oi.unit_price_snapshot, oi.unit_cost_snapshot, oi.qty, oi.line_discount, oi.returned_qty,
                o.created_at AS order_created_at,
                o.payment_method,
                o.subtotal AS order_subtotal,
                o.invoice_discount AS order_invoice_discount,
                o.tax_amount AS order_tax_amount,
                o.total_amount AS order_total_amount,
                o.status AS order_status,
                p.sku, p.category_code,
                c.name AS category_name,
                u.name AS unit_name
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         JOIN products p ON p.id = oi.product_id
         JOIN categories c ON c.code = p.category_code
         JOIN units u ON u.code = p.unit_code
         ${where}
         ORDER BY oi.order_id ASC, oi.id ASC`,
      )
      .all(...params);
  }

  getApprovedReturnsInRange({ fromDate = '', toDate = '' } = {}) {
    const clauses = ["r.status = 'DaXacNhan'"];
    const params = [];
    if (fromDate) {
      clauses.push('substr(COALESCE(r.resolved_at, r.created_at), 1, 10) >= ?');
      params.push(fromDate);
    }
    if (toDate) {
      clauses.push('substr(COALESCE(r.resolved_at, r.created_at), 1, 10) <= ?');
      params.push(toDate);
    }
    const where = `WHERE ${clauses.join(' AND ')}`;
    return this.db
      .prepare(
        `SELECT r.id, r.order_id, r.refund_amount, r.restock, r.status,
                r.created_at, r.resolved_at,
                COALESCE(r.resolved_at, r.created_at) AS effective_at,
                o.payment_method,
                o.created_at AS order_created_at,
                o.subtotal AS order_subtotal,
                o.invoice_discount AS order_invoice_discount,
                o.tax_amount AS order_tax_amount,
                o.total_amount AS order_total_amount
         FROM returns r
         JOIN orders o ON o.id = r.order_id
         ${where}
         ORDER BY COALESCE(r.resolved_at, r.created_at) DESC, r.id DESC`,
      )
      .all(...params);
  }

  getApprovedReturnItemsInRange({ fromDate = '', toDate = '' } = {}) {
    const clauses = ["r.status = 'DaXacNhan'"];
    const params = [];
    if (fromDate) {
      clauses.push('substr(COALESCE(r.resolved_at, r.created_at), 1, 10) >= ?');
      params.push(fromDate);
    }
    if (toDate) {
      clauses.push('substr(COALESCE(r.resolved_at, r.created_at), 1, 10) <= ?');
      params.push(toDate);
    }
    const where = `WHERE ${clauses.join(' AND ')}`;
    return this.db
      .prepare(
        `SELECT ri.id, ri.return_id, ri.product_id, ri.qty, ri.refund_line_amount,
                r.order_id, r.restock, r.status,
                COALESCE(r.resolved_at, r.created_at) AS effective_at,
                o.payment_method,
                o.subtotal AS order_subtotal,
                o.invoice_discount AS order_invoice_discount,
                o.tax_amount AS order_tax_amount,
                o.total_amount AS order_total_amount,
                oi.unit_cost_snapshot, oi.unit_price_snapshot, oi.product_name_snapshot,
                p.sku, p.category_code,
                c.name AS category_name,
                u.name AS unit_name
         FROM return_items ri
         JOIN returns r ON r.id = ri.return_id
         JOIN orders o ON o.id = r.order_id
         JOIN order_items oi ON oi.order_id = r.order_id AND oi.product_id = ri.product_id
         JOIN products p ON p.id = ri.product_id
         JOIN categories c ON c.code = p.category_code
         JOIN units u ON u.code = p.unit_code
         ${where}
         ORDER BY COALESCE(r.resolved_at, r.created_at) DESC, ri.id ASC`,
      )
      .all(...params);
  }

  getInventorySnapshot({ categoryCode = '' } = {}) {
    const clauses = [];
    const params = [];
    if (categoryCode && categoryCode.trim()) {
      clauses.push('p.category_code = ?');
      params.push(categoryCode.trim());
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return this.db
      .prepare(
        `SELECT p.id, p.sku, p.barcode, p.name, p.brand, p.pack_size,
                p.category_code, c.name AS category_name,
                p.unit_code, u.name AS unit_name,
                p.supplier_id, s.name AS supplier_name,
                p.sale_price, p.cost_price, p.stock_qty, p.min_stock, p.status, p.image_url
         FROM products p
         JOIN categories c ON c.code = p.category_code
         JOIN units u ON u.code = p.unit_code
         JOIN suppliers s ON s.id = p.supplier_id
         ${where}
         ORDER BY p.stock_qty ASC, p.name ASC`,
      )
      .all(...params);
  }

  getOperationalQueues() {
    const draftPurchases = this.db
      .prepare("SELECT COUNT(*) AS cnt FROM purchases WHERE status = 'Draft'")
      .get().cnt;
    const pendingAudits = this.db
      .prepare("SELECT COUNT(*) AS cnt FROM stock_audits WHERE status = 'ChoDuyet'")
      .get().cnt;
    const pendingReturns = this.db
      .prepare("SELECT COUNT(*) AS cnt FROM returns WHERE status = 'ChoDuyet'")
      .get().cnt;
    const activeProducts = this.db
      .prepare("SELECT COUNT(*) AS cnt FROM products WHERE status = 'DangKinhDoanh'")
      .get().cnt;
    const lowStockCount = this.db
      .prepare("SELECT COUNT(*) AS cnt FROM products WHERE status = 'DangKinhDoanh' AND stock_qty <= min_stock")
      .get().cnt;
    const outOfStockCount = this.db
      .prepare("SELECT COUNT(*) AS cnt FROM products WHERE status = 'DangKinhDoanh' AND stock_qty <= 0")
      .get().cnt;
    const lowStockProducts = this.db
      .prepare(
        `SELECT p.id, p.sku, p.name, p.stock_qty, p.min_stock, u.name AS unit_name, c.name AS category_name
         FROM products p
         JOIN units u ON u.code = p.unit_code
         JOIN categories c ON c.code = p.category_code
         WHERE p.status = 'DangKinhDoanh' AND p.stock_qty <= p.min_stock
         ORDER BY p.stock_qty ASC, p.name ASC
         LIMIT 8`,
      )
      .all();

    return {
      draftPurchases,
      pendingAudits,
      pendingReturns,
      activeProducts,
      lowStockCount,
      outOfStockCount,
      lowStockProducts,
    };
  }

  getRecentPaidOrders(limit = 6) {
    return this.db
      .prepare(
        `SELECT o.id, o.customer_id, o.total_amount, o.payment_method, o.status, o.created_at,
                COALESCE(c.name, 'Khách lẻ') AS customer_name,
                COALESCE(c.phone, '') AS customer_phone,
                u.full_name AS cashier_name,
                (SELECT COALESCE(SUM(r.refund_amount), 0)
                   FROM returns r
                  WHERE r.order_id = o.id AND r.status = 'DaXacNhan') AS refunded_amount
         FROM orders o
         LEFT JOIN customers c ON c.id = o.customer_id
         JOIN users u ON u.id = o.cashier_id
         WHERE o.status IN ${PAID_ORDER_STATUSES_SQL}
         ORDER BY o.created_at DESC, o.id DESC
         LIMIT ?`,
      )
      .all(limit);
  }
}

module.exports = { ReportRepository };
