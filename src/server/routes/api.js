'use strict';
const { createRepositories } = require('../dal/repositories.js');
const { AuthService } = require('../bll/authService.js');
const { StaffService } = require('../bll/staffService.js');
const { SystemService } = require('../bll/systemService.js');
const { ForbiddenException, NotFoundException } = require('../bll/errors.js');
const { sendJson, sendError, readJsonBody, createAuthGuards } = require('../middleware/rbac.js');

function createApiRouter(db) {
  const repos = createRepositories(db);
  const authService = new AuthService(db, repos);
  const staffService = new StaffService(db, repos);
  const systemService = new SystemService(db, repos);
  const { authenticate, authorize } = createAuthGuards(repos);

  return async function handleApiRequest(req, res, urlObj) {
    const pathname = urlObj.pathname;
    const method = req.method.toUpperCase();

    try {
      // Public health endpoint
      if (method === 'GET' && pathname === '/api/health') {
        return sendJson(res, 200, { status: 'ok', service: 'RetailFlow', layer: '3-tier-ood' });
      }

      // Public store branding info for login screen (non-sensitive subset)
      if (method === 'GET' && pathname === '/api/store-config') {
        return sendJson(res, 200, { storeConfig: systemService.getPublicStoreConfig() });
      }

      // ─── AUTH ROUTES ───────────────────────────────────────────────────────
      if (method === 'POST' && pathname === '/api/auth/login') {
        const body = await readJsonBody(req);
        const result = authService.login(body.username, body.password);
        return sendJson(res, 200, result);
      }

      if (method === 'GET' && pathname === '/api/auth/me') {
        const auth = authenticate(req);
        const user = authService.getProfile(auth.user.id);
        return sendJson(res, 200, {
          user,
          storeConfig: systemService.getPublicStoreConfig(),
        });
      }

      if (method === 'POST' && pathname === '/api/auth/logout') {
        const auth = authenticate(req);
        const result = authService.logout(auth.user, auth.tokenPayload);
        return sendJson(res, 200, result);
      }

      if (method === 'POST' && pathname === '/api/auth/change-password') {
        const auth = authenticate(req);
        const body = await readJsonBody(req);
        const result = authService.changePassword(auth.user, body);
        return sendJson(res, 200, result);
      }

      // ─── RBAC PERMISSION CHECK ENDPOINT (For automated & UI verification) ──
      const rbacCheckMatch = /^\/api\/rbac\/check\/([A-Z0-9_]+)$/.exec(pathname);
      if (method === 'GET' && rbacCheckMatch) {
        const permCode = rbacCheckMatch[1];
        const auth = authorize(req, permCode);
        return sendJson(res, 200, {
          allowed: true,
          permission: permCode,
          role: auth.user.role_code,
          username: auth.user.username,
        });
      }

      // ─── ROLES & PERMISSIONS MATRIX (Admin only) ───────────────────────────
      if (method === 'GET' && pathname === '/api/roles') {
        authorize(req, 'STAFF_MANAGE');
        return sendJson(res, 200, { items: staffService.listRoles() });
      }

      // ─── STAFF MANAGEMENT (Admin only — soft-delete via ACTIVE/LOCKED) ────
      if (method === 'GET' && pathname === '/api/staff') {
        authorize(req, 'STAFF_MANAGE');
        const items = staffService.listStaff({
          search: urlObj.searchParams.get('search') || '',
          role: urlObj.searchParams.get('role') || '',
          status: urlObj.searchParams.get('status') || '',
        });
        return sendJson(res, 200, { items });
      }

      if (method === 'POST' && pathname === '/api/staff') {
        const auth = authorize(req, 'STAFF_MANAGE');
        const body = await readJsonBody(req);
        const item = staffService.createStaff(auth.user, body);
        return sendJson(res, 201, { item });
      }

      const staffStatusMatch = /^\/api\/staff\/([^/]+)\/status$/.exec(pathname);
      if (method === 'PATCH' && staffStatusMatch) {
        const auth = authorize(req, 'STAFF_MANAGE');
        const body = await readJsonBody(req);
        const item = staffService.setStaffStatus(auth.user, decodeURIComponent(staffStatusMatch[1]), body.status);
        return sendJson(res, 200, { item });
      }

      const staffIdMatch = /^\/api\/staff\/([^/]+)$/.exec(pathname);
      if (staffIdMatch) {
        const targetId = decodeURIComponent(staffIdMatch[1]);
        if (method === 'PUT' || method === 'PATCH') {
          const auth = authorize(req, 'STAFF_MANAGE');
          const body = await readJsonBody(req);
          const item = staffService.updateStaff(auth.user, targetId, body);
          return sendJson(res, 200, { item });
        }
        if (method === 'DELETE') {
          authorize(req, 'STAFF_MANAGE');
          throw new ForbiddenException(
            'Không cho phép xóa cứng tài khoản nhân viên. Hãy chuyển trạng thái sang Khóa tài khoản (LOCKED) để bảo toàn lịch sử chứng từ.',
          );
        }
      }

      // ─── THAM_SO (Dynamic System Parameters) ───────────────────────────────
      if (pathname === '/api/tham-so') {
        if (method === 'GET') {
          authorize(req, 'THAM_SO_MANAGE');
          return sendJson(res, 200, {
            items: systemService.listThamSo(),
            storeConfig: systemService.getPublicStoreConfig(),
          });
        }
        if (method === 'PUT') {
          const auth = authorize(req, 'THAM_SO_MANAGE');
          const body = await readJsonBody(req);
          const result = systemService.updateThamSo(auth.user, body.items || body.updates || []);
          return sendJson(res, 200, result);
        }
      }

      // ─── IMMUTABLE AUDIT LOGS (Admin read-only; forbid delete/edit) ────────
      if (pathname === '/api/audit-logs' || pathname.startsWith('/api/audit-logs/')) {
        if (method === 'GET' && pathname === '/api/audit-logs') {
          authorize(req, 'AUDIT_LOG_VIEW');
          const result = systemService.queryAuditLogs({
            search: urlObj.searchParams.get('search') || '',
            action: urlObj.searchParams.get('action') || '',
            actor: urlObj.searchParams.get('actor') || '',
            fromDate: urlObj.searchParams.get('fromDate') || '',
            toDate: urlObj.searchParams.get('toDate') || '',
            page: urlObj.searchParams.get('page') || 1,
            limit: urlObj.searchParams.get('limit') || 15,
          });
          return sendJson(res, 200, result);
        }
        if (['DELETE', 'PUT', 'PATCH'].includes(method)) {
          authenticate(req);
          throw new ForbiddenException('Nhật ký kiểm toán (Audit Log) là bất biến — nghiêm cấm sửa hoặc xóa.');
        }
      }

      throw new NotFoundException(`Đường dẫn API không tồn tại: ${method} ${pathname}`);
    } catch (err) {
      return sendError(res, err);
    }
  };
}

module.exports = { createApiRouter };
