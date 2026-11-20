'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { createServer } = require('../server.js');
const { withTransaction } = require('../src/server/dal/database.js');
const { resolveJwtSecret, signToken, verifyToken } = require('../src/server/bll/security.js');

async function startTestServer() {
  const server = createServer({ dbPath: ':memory:' });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  async function req(method, path, { token = '', body = null } = {}) {
    const headers = { Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== null) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body !== null ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    return { status: res.status, json };
  }

  async function loginAs(username, password = '123456') {
    const r = await req('POST', '/api/auth/login', { body: { username, password } });
    assert.equal(r.status, 200, `Login failed for ${username}: ${JSON.stringify(r.json)}`);
    return r.json;
  }

  return { server, db: server.db, baseUrl, req, loginAs };
}

test('M1-1: 9-rule OOD schema, 4 seeded accounts with scrypt hashes, and THAM_SO rows exist', async () => {
  const { server, db } = await startTestServer();
  try {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => r.name);

    for (const requiredTable of [
      'roles',
      'permissions',
      'role_permissions',
      'users',
      'tham_so',
      'audit_logs',
      'categories',
      'units',
      'branches',
      'suppliers',
      'products',
      'promotions',
      'purchases',
      'purchase_items',
      'orders',
      'order_items',
      'returns',
      'return_items',
      'stock_movements',
      'stock_audits',
      'stock_audit_items',
    ]) {
      assert.ok(tables.includes(requiredTable), `Missing table ${requiredTable}`);
    }

    const users = db.prepare('SELECT id, username, password_hash, role_code, status FROM users ORDER BY id').all();
    assert.equal(users.length, 5);
    assert.deepEqual(
      users.map((u) => [u.username, u.role_code, u.status]),
      [
        ['admin', 'ADMIN', 'ACTIVE'],
        ['quanly', 'MANAGER', 'ACTIVE'],
        ['thungan', 'CASHIER', 'ACTIVE'],
        ['kho', 'WAREHOUSE', 'ACTIVE'],
        ['ncc01', 'SUPPLIER', 'ACTIVE'],
      ],
    );
    for (const u of users) {
      assert.ok(u.password_hash.startsWith('scrypt$'), 'Password must be scrypt hashed');
      assert.notEqual(u.password_hash, '123456', 'Password must never be stored in plaintext');
    }

    const thamSoRows = db.prepare('SELECT ma_tham_so, kieu_du_lieu, gia_tri, tinh_trang FROM tham_so').all();
    assert.ok(thamSoRows.length >= 10, 'THAM_SO must contain seeded configuration rows');
    assert.ok(thamSoRows.some((r) => r.ma_tham_so === 'TyLeVAT' && r.kieu_du_lieu === 'NUMBER'));
    assert.ok(thamSoRows.some((r) => r.ma_tham_so === 'SoNgayChoPhepTraHang' && r.gia_tri === '7'));
  } finally {
    server.close();
    db.close();
  }
});

test('M1-2: Unauthenticated and tampered tokens receive 401; static server blocks backend source', async () => {
  const { server, db, req } = await startTestServer();
  try {
    for (const path of ['/api/auth/me', '/api/staff', '/api/roles', '/api/tham-so', '/api/audit-logs']) {
      const unauth = await req('GET', path);
      assert.equal(unauth.status, 401, `Expected 401 without token on ${path}`);

      const tampered = await req('GET', path, { token: 'invalid.jwt.token' });
      assert.equal(tampered.status, 401, `Expected 401 with bad token on ${path}`);
    }

    // Backend source code must not be served statically
    const leaked = await req('GET', '/src/server/dal/database.js');
    assert.equal(leaked.status, 404);
  } finally {
    server.close();
    db.close();
  }
});

test('M1-3: Full 4-role RBAC matrix (200 vs 403) across Admin, QuanLy, ThuNgan, and NhanVienKho', async () => {
  const { server, db, req, loginAs } = await startTestServer();
  try {
    const admin = await loginAs('admin');
    const quanly = await loginAs('quanly');
    const thungan = await loginAs('thungan');
    const kho = await loginAs('kho');

    // Admin: full system administration access (200)
    assert.equal((await req('GET', '/api/staff', { token: admin.token })).status, 200);
    assert.equal((await req('GET', '/api/roles', { token: admin.token })).status, 200);
    assert.equal((await req('GET', '/api/tham-so', { token: admin.token })).status, 200);
    assert.equal((await req('GET', '/api/audit-logs', { token: admin.token })).status, 200);

    // QuanLy: allowed management/profit/approvals, FORBIDDEN from staff/tham-so/audit-logs/POS
    assert.equal((await req('GET', '/api/rbac/check/PRODUCT_MANAGE', { token: quanly.token })).status, 200);
    assert.equal((await req('GET', '/api/rbac/check/REPORT_PROFIT', { token: quanly.token })).status, 200);
    assert.equal((await req('GET', '/api/rbac/check/PURCHASE_APPROVE', { token: quanly.token })).status, 200);
    assert.equal((await req('GET', '/api/rbac/check/RETURN_APPROVE', { token: quanly.token })).status, 200);
    assert.equal((await req('GET', '/api/staff', { token: quanly.token })).status, 403);
    assert.equal((await req('GET', '/api/tham-so', { token: quanly.token })).status, 403);
    assert.equal((await req('PUT', '/api/tham-so', { token: quanly.token, body: { items: [] } })).status, 403);
    assert.equal((await req('GET', '/api/audit-logs', { token: quanly.token })).status, 403);

    // ThuNgan: allowed POS/orders/customers/returns-create/product-view, FORBIDDEN from cost/inventory/profit/staff
    assert.equal((await req('GET', '/api/rbac/check/POS_SELL', { token: thungan.token })).status, 200);
    assert.equal((await req('GET', '/api/rbac/check/RETURN_CREATE', { token: thungan.token })).status, 200);
    assert.equal((await req('GET', '/api/rbac/check/PRODUCT_VIEW', { token: thungan.token })).status, 200);
    assert.equal((await req('GET', '/api/rbac/check/PRODUCT_COST_VIEW', { token: thungan.token })).status, 403);
    assert.equal((await req('GET', '/api/rbac/check/PRODUCT_MANAGE', { token: thungan.token })).status, 403);
    assert.equal((await req('GET', '/api/rbac/check/INVENTORY_AUDIT', { token: thungan.token })).status, 403);
    assert.equal((await req('GET', '/api/rbac/check/REPORT_PROFIT', { token: thungan.token })).status, 403);
    assert.equal((await req('GET', '/api/staff', { token: thungan.token })).status, 403);

    // NhanVienKho: allowed inventory/audit/purchase-create/supplier-view, FORBIDDEN from POS/price-manage/promo/reports/staff
    assert.equal((await req('GET', '/api/rbac/check/INVENTORY_VIEW', { token: kho.token })).status, 200);
    assert.equal((await req('GET', '/api/rbac/check/INVENTORY_AUDIT', { token: kho.token })).status, 200);
    assert.equal((await req('GET', '/api/rbac/check/PURCHASE_CREATE', { token: kho.token })).status, 200);
    assert.equal((await req('GET', '/api/rbac/check/POS_SELL', { token: kho.token })).status, 403);
    assert.equal((await req('GET', '/api/rbac/check/PRODUCT_MANAGE', { token: kho.token })).status, 403);
    assert.equal((await req('GET', '/api/rbac/check/PROMOTION_MANAGE', { token: kho.token })).status, 403);
    assert.equal((await req('GET', '/api/rbac/check/REPORT_VIEW', { token: kho.token })).status, 403);
    assert.equal((await req('GET', '/api/staff', { token: kho.token })).status, 403);
  } finally {
    server.close();
    db.close();
  }
});

test('M1-4: Staff CRUD, duplicate check (409), hard-delete block (403), soft-delete lock invalidates live token (401)', async () => {
  const { server, db, req, loginAs } = await startTestServer();
  try {
    const admin = await loginAs('admin');

    // Create new cashier
    const created = await req('POST', '/api/staff', {
      token: admin.token,
      body: {
        fullName: 'Võ Thị Minh Thư',
        username: 'thungan2',
        password: 'password123',
        phone: '0909888777',
        email: 'thu@retailflow.vn',
        role: 'CASHIER',
        status: 'ACTIVE',
      },
    });
    assert.equal(created.status, 201);
    const staffId = created.json.item.id;
    assert.equal(created.json.item.username, 'thungan2');

    // Duplicate username rejected with 409
    const dup = await req('POST', '/api/staff', {
      token: admin.token,
      body: { fullName: 'Trùng tên', username: 'thungan2', password: 'password123', role: 'CASHIER' },
    });
    assert.equal(dup.status, 409);

    // Hard DELETE is strictly forbidden (Soft-Delete rule)
    const delRes = await req('DELETE', `/api/staff/${staffId}`, { token: admin.token });
    assert.equal(delRes.status, 403);

    // Self-lock Admin is blocked (400)
    const selfLock = await req('PATCH', `/api/staff/${admin.user.id}/status`, {
      token: admin.token,
      body: { status: 'LOCKED' },
    });
    assert.equal(selfLock.status, 400);

    // New user logs in cleanly
    const userSession = await loginAs('thungan2', 'password123');
    assert.equal((await req('GET', '/api/auth/me', { token: userSession.token })).status, 200);

    // Admin locks the user (Soft-Delete)
    const lockRes = await req('PATCH', `/api/staff/${staffId}/status`, {
      token: admin.token,
      body: { status: 'LOCKED' },
    });
    assert.equal(lockRes.status, 200);
    assert.equal(lockRes.json.item.status, 'LOCKED');

    // Existing token is immediately rejected with 401 & re-login returns 401
    assert.equal((await req('GET', '/api/auth/me', { token: userSession.token })).status, 401);
    const reloginLocked = await req('POST', '/api/auth/login', {
      body: { username: 'thungan2', password: 'password123' },
    });
    assert.equal(reloginLocked.status, 401);

    // Unlock restores access
    const unlockRes = await req('PATCH', `/api/staff/${staffId}/status`, {
      token: admin.token,
      body: { status: 'ACTIVE' },
    });
    assert.equal(unlockRes.status, 200);
    assert.equal((await loginAs('thungan2', 'password123')).user.username, 'thungan2');
  } finally {
    server.close();
    db.close();
  }
});

test('M1-5: Change password, logout token revocation, THAM_SO validation, immutable AuditLog & DAL rollback', async () => {
  const { server, db, req, loginAs } = await startTestServer();
  try {
    const thungan = await loginAs('thungan');

    // Change password
    const cpRes = await req('POST', '/api/auth/change-password', {
      token: thungan.token,
      body: { currentPassword: '123456', newPassword: 'newpass789', confirmPassword: 'newpass789' },
    });
    assert.equal(cpRes.status, 200);

    // Old password fails, new password succeeds
    assert.equal((await req('POST', '/api/auth/login', { body: { username: 'thungan', password: '123456' } })).status, 401);
    const relogin = await loginAs('thungan', 'newpass789');

    // Logout revokes token immediately
    assert.equal((await req('POST', '/api/auth/logout', { token: relogin.token })).status, 200);
    assert.equal((await req('GET', '/api/auth/me', { token: relogin.token })).status, 401);

    // Admin THAM_SO validation & update
    const admin = await loginAs('admin');
    const badVat = await req('PUT', '/api/tham-so', {
      token: admin.token,
      body: { items: [{ maThamSo: 'TyLeVAT', giaTri: '150' }] },
    });
    assert.equal(badVat.status, 400);

    const goodUpdate = await req('PUT', '/api/tham-so', {
      token: admin.token,
      body: {
        items: [
          { maThamSo: 'TyLeVAT', giaTri: '10' },
          { maThamSo: 'SoNgayChoPhepTraHang', giaTri: '14' },
        ],
      },
    });
    assert.equal(goodUpdate.status, 200);
    assert.equal(goodUpdate.json.storeConfig.taxRate, 10);
    assert.equal(goodUpdate.json.storeConfig.returnWindowDays, 14);

    // AuditLog date validation (TuNgay > DenNgay -> 400) & immutability (DELETE/PUT -> 403)
    const badRange = await req('GET', '/api/audit-logs?fromDate=2026-12-31&toDate=2026-01-01', {
      token: admin.token,
    });
    assert.equal(badRange.status, 400);

    assert.equal((await req('DELETE', '/api/audit-logs', { token: admin.token })).status, 403);
    assert.equal((await req('PUT', '/api/audit-logs/AUD-SEED-001', { token: admin.token, body: {} })).status, 403);

    const logs = await req('GET', '/api/audit-logs?action=THAM_SO_UPDATE', { token: admin.token });
    assert.equal(logs.status, 200);
    assert.ok(logs.json.items.length >= 1, 'THAM_SO_UPDATE must be recorded in AuditLog');

    // Atomic DAL Transaction Rollback verification
    const beforeCount = db.prepare('SELECT COUNT(*) AS cnt FROM audit_logs').get().cnt;
    assert.throws(() => {
      withTransaction(db, () => {
        db.prepare(
          `INSERT INTO audit_logs (id, actor_username, actor_name, actor_role, action, entity_type, detail, created_at)
           VALUES ('AUD-TX-TEST', 'admin', 'Admin', 'ADMIN', 'TX_TEST', 'Test', 'Should rollback', ?)`,
        ).run(new Date().toISOString());
        throw new Error('Simulated mid-transaction failure');
      });
    }, /Simulated mid-transaction failure/);
    const afterCount = db.prepare('SELECT COUNT(*) AS cnt FROM audit_logs').get().cnt;
    assert.equal(afterCount, beforeCount, 'DAL transaction must rollback 100% on failure');
  } finally {
    server.close();
    db.close();
  }
});

test('M1-6: DB-level SQLite triggers enforce append-only immutability on audit_logs (blocks raw SQL UPDATE/DELETE)', async () => {
  const { server, db } = await startTestServer();
  try {
    const triggers = db
      .prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='audit_logs' ORDER BY name")
      .all()
      .map((r) => r.name);
    assert.deepEqual(triggers, ['trg_audit_logs_no_delete', 'trg_audit_logs_no_update']);

    const beforeRow = db.prepare("SELECT id, detail FROM audit_logs WHERE id = 'AUD-SEED-001'").get();
    assert.ok(beforeRow, 'Seeded audit log row must exist');

    assert.throws(
      () => {
        db.prepare("UPDATE audit_logs SET detail = 'TAMPERED' WHERE id = 'AUD-SEED-001'").run();
      },
      /bất biến|append-only|cấm UPDATE/i,
    );

    assert.throws(
      () => {
        db.prepare("DELETE FROM audit_logs WHERE id = 'AUD-SEED-001'").run();
      },
      /bất biến|append-only|cấm DELETE/i,
    );

    const afterRow = db.prepare("SELECT id, detail FROM audit_logs WHERE id = 'AUD-SEED-001'").get();
    assert.equal(afterRow.detail, beforeRow.detail, 'audit_logs row must remain untouched after blocked SQL UPDATE/DELETE');
  } finally {
    server.close();
    db.close();
  }
});

test('M1-7: JWT_SECRET policy rejects missing/weak secret in production and allows warned fallback only in dev/test', () => {
  // Missing or < 32 chars in production MUST throw
  assert.throws(
    () => resolveJwtSecret({ NODE_ENV: 'production' }, { warn: false }),
    /JWT_SECRET.*production.*32/i,
  );
  assert.throws(
    () => resolveJwtSecret({ NODE_ENV: 'production', JWT_SECRET: 'too-short-secret-12345' }, { warn: false }),
    /JWT_SECRET.*production.*32/i,
  );

  // Valid >= 32 chars in production succeeds
  const prodSecret = 'prod-retailflow-super-secure-secret-key-2026';
  assert.equal(resolveJwtSecret({ NODE_ENV: 'production', JWT_SECRET: prodSecret }, { warn: false }), prodSecret);
  const signed = signToken({ sub: 'NV001', role: 'ADMIN' }, prodSecret);
  const verified = verifyToken(signed.token, prodSecret);
  assert.equal(verified.sub, 'NV001');

  // Development and test environments allow fallback secret
  const devSecret = resolveJwtSecret({ NODE_ENV: 'development' }, { warn: false });
  const testSecret = resolveJwtSecret({ NODE_ENV: 'test' }, { warn: false });
  assert.ok(devSecret.length >= 32);
  assert.equal(devSecret, testSecret);

  // Fail-fast check when loading security.js in a fresh NODE_ENV=production process without JWT_SECRET
  const securityModulePath = path.resolve(__dirname, '../src/server/bll/security.js');
  assert.throws(() => {
    execFileSync(process.execPath, ['-e', `require(${JSON.stringify(securityModulePath)})`], {
      env: { PATH: process.env.PATH, NODE_ENV: 'production' },
      stdio: 'pipe',
    });
  });
});
