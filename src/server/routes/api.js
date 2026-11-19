'use strict';
const { createRepositories } = require('../dal/repositories.js');
const { AuthService } = require('../bll/authService.js');
const { StaffService } = require('../bll/staffService.js');
const { SystemService } = require('../bll/systemService.js');
const { CatalogService } = require('../bll/catalogService.js');
const { WarehouseService } = require('../bll/warehouseService.js');
const { ForbiddenException, NotFoundException } = require('../bll/errors.js');
const { sendJson, sendError, readJsonBody, createAuthGuards } = require('../middleware/rbac.js');

function createApiRouter(db) {
  const repos = createRepositories(db);
  const authService = new AuthService(db, repos);
  const staffService = new StaffService(db, repos);
  const systemService = new SystemService(db, repos);
  const catalogService = new CatalogService(db, repos);
  const warehouseService = new WarehouseService(db, repos);
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

      // ─── M2: PRODUCT IMAGES CATALOG (Real assets in assets/images/products) ─
      if (method === 'GET' && pathname === '/api/product-images') {
        authorize(req, 'PRODUCT_VIEW');
        return sendJson(res, 200, { items: catalogService.listProductImages() });
      }

      // ─── M2: PRODUCTS (Hàng hóa — BR-01 & BR-06) ───────────────────────────
      if (pathname === '/api/products') {
        if (method === 'GET') {
          const auth = authorize(req, 'PRODUCT_VIEW');
          const canViewCost = auth.permissions.includes('PRODUCT_COST_VIEW');
          const result = catalogService.listProducts(
            {
              search: urlObj.searchParams.get('search') || '',
              categoryCode: urlObj.searchParams.get('categoryCode') || '',
              supplierId: urlObj.searchParams.get('supplierId') || '',
              status: urlObj.searchParams.get('status') || '',
              stockLevel: urlObj.searchParams.get('stockLevel') || '',
              minPrice: urlObj.searchParams.get('minPrice') || '',
              maxPrice: urlObj.searchParams.get('maxPrice') || '',
            },
            { canViewCost },
          );
          return sendJson(res, 200, result);
        }
        if (method === 'POST') {
          const auth = authorize(req, 'PRODUCT_MANAGE');
          const body = await readJsonBody(req);
          const item = catalogService.createProduct(auth.user, body);
          return sendJson(res, 201, { item });
        }
      }

      const productStatusMatch = /^\/api\/products\/([^/]+)\/status$/.exec(pathname);
      if (method === 'PATCH' && productStatusMatch) {
        const auth = authorize(req, 'PRODUCT_MANAGE');
        const body = await readJsonBody(req);
        const item = catalogService.setProductStatus(
          auth.user,
          decodeURIComponent(productStatusMatch[1]),
          body.status,
        );
        return sendJson(res, 200, { item });
      }

      const productAdjustMatch = /^\/api\/products\/([^/]+)\/stock-adjust$/.exec(pathname);
      if (method === 'POST' && productAdjustMatch) {
        const auth = authorize(req, 'INVENTORY_APPROVE');
        const body = await readJsonBody(req);
        const result = catalogService.adjustProductStock(
          auth.user,
          decodeURIComponent(productAdjustMatch[1]),
          body,
        );
        return sendJson(res, 200, result);
      }

      const productIdMatch = /^\/api\/products\/([^/]+)$/.exec(pathname);
      if (productIdMatch) {
        const targetId = decodeURIComponent(productIdMatch[1]);
        if (method === 'GET') {
          const auth = authorize(req, 'PRODUCT_VIEW');
          const result = catalogService.getProduct(targetId, {
            canViewCost: auth.permissions.includes('PRODUCT_COST_VIEW'),
            canViewLedger: auth.permissions.includes('INVENTORY_VIEW'),
          });
          return sendJson(res, 200, result);
        }
        if (method === 'PUT' || method === 'PATCH') {
          const auth = authorize(req, 'PRODUCT_MANAGE');
          const body = await readJsonBody(req);
          const item = catalogService.updateProduct(auth.user, targetId, body);
          return sendJson(res, 200, { item });
        }
        if (method === 'DELETE') {
          const auth = authorize(req, 'PRODUCT_MANAGE');
          catalogService.deleteProduct(auth.user, targetId);
        }
      }

      // ─── M2: CATEGORIES (Danh mục hàng hóa) ────────────────────────────────
      if (pathname === '/api/categories') {
        if (method === 'GET') {
          authorize(req, 'PRODUCT_VIEW');
          const items = catalogService.listCategories({
            search: urlObj.searchParams.get('search') || '',
            status: urlObj.searchParams.get('status') || '',
          });
          return sendJson(res, 200, { items });
        }
        if (method === 'POST') {
          const auth = authorize(req, 'CATEGORY_MANAGE');
          const body = await readJsonBody(req);
          const item = catalogService.createCategory(auth.user, body);
          return sendJson(res, 201, { item });
        }
      }

      const catStatusMatch = /^\/api\/categories\/([^/]+)\/status$/.exec(pathname);
      if (method === 'PATCH' && catStatusMatch) {
        const auth = authorize(req, 'CATEGORY_MANAGE');
        const body = await readJsonBody(req);
        const item = catalogService.setCategoryStatus(
          auth.user,
          decodeURIComponent(catStatusMatch[1]),
          body.status,
        );
        return sendJson(res, 200, { item });
      }

      const catIdMatch = /^\/api\/categories\/([^/]+)$/.exec(pathname);
      if (catIdMatch) {
        const code = decodeURIComponent(catIdMatch[1]);
        if (method === 'PUT' || method === 'PATCH') {
          const auth = authorize(req, 'CATEGORY_MANAGE');
          const body = await readJsonBody(req);
          const item = catalogService.updateCategory(auth.user, code, body);
          return sendJson(res, 200, { item });
        }
        if (method === 'DELETE') {
          authorize(req, 'CATEGORY_MANAGE');
          catalogService.deleteCategory(code);
        }
      }

      // ─── M2: UNITS (Đơn vị tính) ───────────────────────────────────────────
      if (pathname === '/api/units') {
        if (method === 'GET') {
          authorize(req, 'PRODUCT_VIEW');
          const items = catalogService.listUnits({
            search: urlObj.searchParams.get('search') || '',
            status: urlObj.searchParams.get('status') || '',
          });
          return sendJson(res, 200, { items });
        }
        if (method === 'POST') {
          const auth = authorize(req, 'CATEGORY_MANAGE');
          const body = await readJsonBody(req);
          const item = catalogService.createUnit(auth.user, body);
          return sendJson(res, 201, { item });
        }
      }

      const unitStatusMatch = /^\/api\/units\/([^/]+)\/status$/.exec(pathname);
      if (method === 'PATCH' && unitStatusMatch) {
        const auth = authorize(req, 'CATEGORY_MANAGE');
        const body = await readJsonBody(req);
        const item = catalogService.setUnitStatus(
          auth.user,
          decodeURIComponent(unitStatusMatch[1]),
          body.status,
        );
        return sendJson(res, 200, { item });
      }

      const unitIdMatch = /^\/api\/units\/([^/]+)$/.exec(pathname);
      if (unitIdMatch) {
        const code = decodeURIComponent(unitIdMatch[1]);
        if (method === 'PUT' || method === 'PATCH') {
          const auth = authorize(req, 'CATEGORY_MANAGE');
          const body = await readJsonBody(req);
          const item = catalogService.updateUnit(auth.user, code, body);
          return sendJson(res, 200, { item });
        }
        if (method === 'DELETE') {
          authorize(req, 'CATEGORY_MANAGE');
          catalogService.deleteUnit(code);
        }
      }

      // ─── M2: SUPPLIERS (Nhà cung cấp) ──────────────────────────────────────
      if (pathname === '/api/suppliers') {
        if (method === 'GET') {
          authorize(req, 'SUPPLIER_VIEW');
          const items = catalogService.listSuppliers({
            search: urlObj.searchParams.get('search') || '',
            status: urlObj.searchParams.get('status') || '',
          });
          return sendJson(res, 200, { items });
        }
        if (method === 'POST') {
          const auth = authorize(req, 'SUPPLIER_MANAGE');
          const body = await readJsonBody(req);
          const item = catalogService.createSupplier(auth.user, body);
          return sendJson(res, 201, { item });
        }
      }

      const supStatusMatch = /^\/api\/suppliers\/([^/]+)\/status$/.exec(pathname);
      if (method === 'PATCH' && supStatusMatch) {
        const auth = authorize(req, 'SUPPLIER_MANAGE');
        const body = await readJsonBody(req);
        const item = catalogService.setSupplierStatus(
          auth.user,
          decodeURIComponent(supStatusMatch[1]),
          body.status,
        );
        return sendJson(res, 200, { item });
      }

      const supHistoryMatch = /^\/api\/suppliers\/([^/]+)\/history$/.exec(pathname);
      if (method === 'GET' && supHistoryMatch) {
        authorize(req, 'SUPPLIER_VIEW');
        const result = catalogService.getSupplierHistory(decodeURIComponent(supHistoryMatch[1]));
        return sendJson(res, 200, result);
      }

      const supIdMatch = /^\/api\/suppliers\/([^/]+)$/.exec(pathname);
      if (supIdMatch) {
        const targetId = decodeURIComponent(supIdMatch[1]);
        if (method === 'PUT' || method === 'PATCH') {
          const auth = authorize(req, 'SUPPLIER_MANAGE');
          const body = await readJsonBody(req);
          const item = catalogService.updateSupplier(auth.user, targetId, body);
          return sendJson(res, 200, { item });
        }
        if (method === 'DELETE') {
          authorize(req, 'SUPPLIER_MANAGE');
          catalogService.deleteSupplier(targetId);
        }
      }

      // ─── M2: IMMUTABLE STOCK MOVEMENTS (Thẻ kho — LichSuTonKho) ───────────
      if (pathname === '/api/stock-movements' || pathname.startsWith('/api/stock-movements/')) {
        if (method === 'GET' && pathname === '/api/stock-movements') {
          authorize(req, 'INVENTORY_VIEW');
          const result = catalogService.queryStockMovements({
            search: urlObj.searchParams.get('search') || '',
            productId: urlObj.searchParams.get('productId') || '',
            docType: urlObj.searchParams.get('docType') || '',
            fromDate: urlObj.searchParams.get('fromDate') || '',
            toDate: urlObj.searchParams.get('toDate') || '',
            page: urlObj.searchParams.get('page') || 1,
            limit: urlObj.searchParams.get('limit') || 15,
          });
          return sendJson(res, 200, result);
        }
        if (['DELETE', 'PUT', 'PATCH'].includes(method)) {
          authenticate(req);
          throw new ForbiddenException('Thẻ kho (LichSuTonKho) là bất biến — nghiêm cấm sửa hoặc xóa.');
        }
      }

      // ─── M3: RESTOCK SUGGESTIONS (Gợi ý nhập hàng sắp hết từ SQLite) ───────
      if (method === 'GET' && pathname === '/api/restock-suggestions') {
        authorize(req, 'PURCHASE_CREATE');
        return sendJson(res, 200, warehouseService.getRestockSuggestions());
      }

      // ─── M3: PURCHASES (Phiếu nhập hàng — BR-02 & BR-06) ───────────────────
      if (pathname === '/api/purchases') {
        if (method === 'GET') {
          authorize(req, 'PURCHASE_CREATE');
          const result = warehouseService.listPurchases({
            search: urlObj.searchParams.get('search') || '',
            supplierId: urlObj.searchParams.get('supplierId') || '',
            status: urlObj.searchParams.get('status') || '',
            fromDate: urlObj.searchParams.get('fromDate') || '',
            toDate: urlObj.searchParams.get('toDate') || '',
          });
          return sendJson(res, 200, result);
        }
        if (method === 'POST') {
          const auth = authorize(req, 'PURCHASE_CREATE');
          const body = await readJsonBody(req);
          const item = warehouseService.createPurchase(auth.user, body);
          return sendJson(res, 201, { item });
        }
      }

      const purchaseConfirmMatch = /^\/api\/purchases\/([^/]+)\/confirm$/.exec(pathname);
      if (method === 'POST' && purchaseConfirmMatch) {
        const auth = authorize(req, 'PURCHASE_APPROVE');
        const item = warehouseService.confirmPurchase(auth.user, decodeURIComponent(purchaseConfirmMatch[1]));
        return sendJson(res, 200, { item });
      }

      const purchaseCancelMatch = /^\/api\/purchases\/([^/]+)\/cancel$/.exec(pathname);
      if (method === 'POST' && purchaseCancelMatch) {
        const auth = authorize(req, 'PURCHASE_APPROVE');
        const body = await readJsonBody(req);
        const item = warehouseService.cancelPurchase(
          auth.user,
          decodeURIComponent(purchaseCancelMatch[1]),
          body.reason || '',
        );
        return sendJson(res, 200, { item });
      }

      const purchaseIdMatch = /^\/api\/purchases\/([^/]+)$/.exec(pathname);
      if (purchaseIdMatch) {
        const targetId = decodeURIComponent(purchaseIdMatch[1]);
        if (method === 'GET') {
          authorize(req, 'PURCHASE_CREATE');
          const item = warehouseService.getPurchase(targetId);
          return sendJson(res, 200, { item });
        }
        if (method === 'PUT' || method === 'PATCH') {
          const auth = authorize(req, 'PURCHASE_CREATE');
          const body = await readJsonBody(req);
          const item = warehouseService.updateDraftPurchase(auth.user, targetId, body);
          return sendJson(res, 200, { item });
        }
        if (method === 'DELETE') {
          authorize(req, 'PURCHASE_APPROVE');
          throw new ForbiddenException(
            'Không cho phép xóa cứng phiếu nhập hàng. Hãy chuyển trạng thái sang Đã hủy (Cancelled) nếu phiếu đang là Nháp.',
          );
        }
      }

      // ─── M3: STOCK AUDITS (Phiếu kiểm kê kho — BR-06) ──────────────────────
      if (pathname === '/api/stock-audits') {
        if (method === 'GET') {
          authorize(req, 'INVENTORY_VIEW');
          const result = warehouseService.listStockAudits({
            search: urlObj.searchParams.get('search') || '',
            status: urlObj.searchParams.get('status') || '',
            fromDate: urlObj.searchParams.get('fromDate') || '',
            toDate: urlObj.searchParams.get('toDate') || '',
          });
          return sendJson(res, 200, result);
        }
        if (method === 'POST') {
          const auth = authorize(req, 'INVENTORY_AUDIT');
          const body = await readJsonBody(req);
          const item = warehouseService.createStockAudit(auth.user, body);
          return sendJson(res, 201, { item });
        }
      }

      const auditApproveMatch = /^\/api\/stock-audits\/([^/]+)\/approve$/.exec(pathname);
      if (method === 'POST' && auditApproveMatch) {
        const auth = authorize(req, 'INVENTORY_APPROVE');
        const item = warehouseService.approveStockAudit(auth.user, decodeURIComponent(auditApproveMatch[1]));
        return sendJson(res, 200, { item });
      }

      const auditCancelMatch = /^\/api\/stock-audits\/([^/]+)\/cancel$/.exec(pathname);
      if (method === 'POST' && auditCancelMatch) {
        const auth = authorize(req, 'INVENTORY_APPROVE');
        const body = await readJsonBody(req);
        const item = warehouseService.cancelStockAudit(
          auth.user,
          decodeURIComponent(auditCancelMatch[1]),
          body.reason || '',
        );
        return sendJson(res, 200, { item });
      }

      const auditIdMatch = /^\/api\/stock-audits\/([^/]+)$/.exec(pathname);
      if (auditIdMatch) {
        const targetId = decodeURIComponent(auditIdMatch[1]);
        if (method === 'GET') {
          authorize(req, 'INVENTORY_VIEW');
          const item = warehouseService.getStockAudit(targetId);
          return sendJson(res, 200, { item });
        }
        if (method === 'DELETE') {
          authorize(req, 'INVENTORY_APPROVE');
          throw new ForbiddenException(
            'Không cho phép xóa cứng phiếu kiểm kê. Hãy chuyển trạng thái sang Đã hủy (DaHuy) nếu phiếu đang Chờ duyệt.',
          );
        }
      }

      throw new NotFoundException(`Đường dẫn API không tồn tại: ${method} ${pathname}`);
    } catch (err) {
      return sendError(res, err);
    }
  };
}

module.exports = { createApiRouter };
