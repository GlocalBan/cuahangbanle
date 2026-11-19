'use strict';
const crypto = require('node:crypto');

function genId(prefix) {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

class UserRepository {
  constructor(db) {
    this.db = db;
  }

  findByUsername(username) {
    return (
      this.db
        .prepare(
          `SELECT u.*, r.display_name AS role_display_name, r.short_name AS role_short_name
           FROM users u
           JOIN roles r ON r.code = u.role_code
           WHERE lower(u.username) = lower(?)`,
        )
        .get(username) || null
    );
  }

  findById(id) {
    return (
      this.db
        .prepare(
          `SELECT u.*, r.display_name AS role_display_name, r.short_name AS role_short_name
           FROM users u
           JOIN roles r ON r.code = u.role_code
           WHERE u.id = ?`,
        )
        .get(id) || null
    );
  }

  list({ search = '', role = '', status = '' } = {}) {
    const clauses = [];
    const params = [];
    if (search && search.trim()) {
      const q = `%${search.trim().toLowerCase()}%`;
      clauses.push('(lower(u.full_name) LIKE ? OR lower(u.username) LIKE ? OR lower(u.id) LIKE ? OR lower(u.phone) LIKE ?)');
      params.push(q, q, q, q);
    }
    if (role && role.trim()) {
      clauses.push('u.role_code = ?');
      params.push(role.trim());
    }
    if (status && status.trim()) {
      clauses.push('u.status = ?');
      params.push(status.trim());
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return this.db
      .prepare(
        `SELECT u.id, u.username, u.full_name, u.email, u.phone, u.role_code,
                r.display_name AS role_display_name, r.short_name AS role_short_name,
                u.status, u.must_change_password, u.last_login_at, u.created_at, u.updated_at
         FROM users u
         JOIN roles r ON r.code = u.role_code
         ${where}
         ORDER BY u.id ASC`,
      )
      .all(...params);
  }

  countActiveAdmins(excludeId = '') {
    return this.db
      .prepare(
        `SELECT COUNT(*) AS cnt FROM users WHERE role_code = 'ADMIN' AND status = 'ACTIVE' AND id != ?`,
      )
      .get(excludeId).cnt;
  }

  nextEmployeeId() {
    const rows = this.db.prepare(`SELECT id FROM users WHERE id LIKE 'NV%'`).all();
    let maxNum = 0;
    for (const r of rows) {
      const m = /^NV(\d+)$/.exec(r.id);
      if (m) maxNum = Math.max(maxNum, Number(m[1]));
    }
    return `NV${String(maxNum + 1).padStart(3, '0')}`;
  }

  create(user) {
    const nowIso = new Date().toISOString();
    const id = user.id || this.nextEmployeeId();
    this.db
      .prepare(
        `INSERT INTO users (id, username, password_hash, full_name, email, phone, role_code, status, must_change_password, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        user.username,
        user.password_hash,
        user.full_name,
        user.email || '',
        user.phone || '',
        user.role_code,
        user.status || 'ACTIVE',
        user.must_change_password ? 1 : 0,
        nowIso,
        nowIso,
      );
    return this.findById(id);
  }

  update(id, fields) {
    const nowIso = new Date().toISOString();
    const sets = [];
    const params = [];
    const allowed = ['full_name', 'email', 'phone', 'role_code', 'status', 'password_hash', 'must_change_password', 'last_login_at'];
    for (const key of allowed) {
      if (fields[key] !== undefined) {
        sets.push(`${key} = ?`);
        params.push(fields[key]);
      }
    }
    sets.push('updated_at = ?');
    params.push(nowIso, id);
    this.db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    return this.findById(id);
  }
}

class RoleRepository {
  constructor(db) {
    this.db = db;
  }

  findAll() {
    const roles = this.db.prepare('SELECT * FROM roles ORDER BY code ASC').all();
    const perms = this.db
      .prepare(
        `SELECT rp.role_code, p.code, p.module, p.description
         FROM role_permissions rp
         JOIN permissions p ON p.code = rp.permission_code
         ORDER BY p.module ASC, p.code ASC`,
      )
      .all();
    const byRole = new Map();
    for (const p of perms) {
      if (!byRole.has(p.role_code)) byRole.set(p.role_code, []);
      byRole.get(p.role_code).push({ code: p.code, module: p.module, description: p.description });
    }
    return roles.map((r) => ({
      ...r,
      permissions: byRole.get(r.code) || [],
    }));
  }

  findByCode(code) {
    return this.db.prepare('SELECT * FROM roles WHERE code = ?').get(code) || null;
  }

  getPermissionsForRole(roleCode) {
    return this.db
      .prepare('SELECT permission_code FROM role_permissions WHERE role_code = ? ORDER BY permission_code ASC')
      .all(roleCode)
      .map((r) => r.permission_code);
  }

  hasPermission(roleCode, permissionCode) {
    const row = this.db
      .prepare('SELECT 1 AS ok FROM role_permissions WHERE role_code = ? AND permission_code = ?')
      .get(roleCode, permissionCode);
    return Boolean(row);
  }
}

class ThamSoRepository {
  constructor(db) {
    this.db = db;
  }

  findAll() {
    return this.db
      .prepare('SELECT * FROM tham_so ORDER BY nhom_tham_so ASC, ma_tham_so ASC')
      .all();
  }

  findByCode(maThamSo) {
    return this.db.prepare('SELECT * FROM tham_so WHERE ma_tham_so = ?').get(maThamSo) || null;
  }

  updateValue(maThamSo, giaTri, updatedBy) {
    const nowIso = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE tham_so
         SET gia_tri = ?, updated_at = ?, updated_by = ?
         WHERE ma_tham_so = ?`,
      )
      .run(String(giaTri), nowIso, updatedBy, maThamSo);
    return this.findByCode(maThamSo);
  }
}

class AuditLogRepository {
  constructor(db) {
    this.db = db;
  }

  append({ actor, action, entityType, entityId = '', detail = '', before = null, after = null }) {
    const id = genId('AUD');
    const nowIso = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO audit_logs (id, actor_id, actor_username, actor_name, actor_role, action, entity_type, entity_id, detail, before_json, after_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        actor?.id || null,
        actor?.username || 'system',
        actor?.full_name || actor?.name || 'Hệ thống',
        actor?.role_code || 'SYSTEM',
        action,
        entityType,
        String(entityId || ''),
        detail,
        before ? JSON.stringify(before) : null,
        after ? JSON.stringify(after) : null,
        nowIso,
      );
    return this.db.prepare('SELECT * FROM audit_logs WHERE id = ?').get(id);
  }

  query({ search = '', action = '', actor = '', fromDate = '', toDate = '', page = 1, limit = 15 } = {}) {
    const clauses = [];
    const params = [];
    if (search && search.trim()) {
      const q = `%${search.trim().toLowerCase()}%`;
      clauses.push(
        '(lower(detail) LIKE ? OR lower(entity_id) LIKE ? OR lower(actor_name) LIKE ? OR lower(actor_username) LIKE ? OR lower(action) LIKE ?)',
      );
      params.push(q, q, q, q, q);
    }
    if (action && action.trim()) {
      clauses.push('action = ?');
      params.push(action.trim());
    }
    if (actor && actor.trim()) {
      clauses.push('lower(actor_username) = lower(?)');
      params.push(actor.trim());
    }
    if (fromDate && fromDate.trim()) {
      clauses.push('substr(created_at, 1, 10) >= ?');
      params.push(fromDate.trim());
    }
    if (toDate && toDate.trim()) {
      clauses.push('substr(created_at, 1, 10) <= ?');
      params.push(toDate.trim());
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const total = this.db.prepare(`SELECT COUNT(*) AS cnt FROM audit_logs ${where}`).get(...params).cnt;
    const safeLimit = Math.min(Math.max(Number(limit) || 15, 1), 100);
    const safePage = Math.max(Number(page) || 1, 1);
    const offset = (safePage - 1) * safeLimit;
    const items = this.db
      .prepare(
        `SELECT id, actor_id, actor_username, actor_name, actor_role, action, entity_type, entity_id, detail, created_at
         FROM audit_logs
         ${where}
         ORDER BY created_at DESC, id DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, safeLimit, offset);
    const actions = this.db
      .prepare('SELECT DISTINCT action FROM audit_logs ORDER BY action ASC')
      .all()
      .map((r) => r.action);
    return {
      items,
      total,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.max(1, Math.ceil(total / safeLimit)),
      actions,
    };
  }
}

class TokenRevocationRepository {
  constructor(db) {
    this.db = db;
  }

  revoke(jti, userId, expiresAt) {
    const nowIso = new Date().toISOString();
    this.db
      .prepare(
        `INSERT OR IGNORE INTO revoked_tokens (jti, user_id, revoked_at, expires_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(jti, userId, nowIso, expiresAt || Math.floor(Date.now() / 1000) + 86400);
    // Clean expired entries opportunistically
    this.db.prepare('DELETE FROM revoked_tokens WHERE expires_at < ?').run(Math.floor(Date.now() / 1000));
  }

  isRevoked(jti) {
    const row = this.db.prepare('SELECT 1 AS ok FROM revoked_tokens WHERE jti = ?').get(jti);
    return Boolean(row);
  }
}

const {
  CategoryRepository,
  UnitRepository,
  SupplierRepository,
  ProductRepository,
  StockMovementRepository,
} = require('./catalogRepositories.js');

function createRepositories(db) {
  return {
    users: new UserRepository(db),
    roles: new RoleRepository(db),
    thamSo: new ThamSoRepository(db),
    auditLogs: new AuditLogRepository(db),
    revokedTokens: new TokenRevocationRepository(db),
    categories: new CategoryRepository(db),
    units: new UnitRepository(db),
    suppliers: new SupplierRepository(db),
    products: new ProductRepository(db),
    stockMovements: new StockMovementRepository(db),
  };
}

module.exports = {
  UserRepository,
  RoleRepository,
  ThamSoRepository,
  AuditLogRepository,
  TokenRevocationRepository,
  CategoryRepository,
  UnitRepository,
  SupplierRepository,
  ProductRepository,
  StockMovementRepository,
  createRepositories,
};
