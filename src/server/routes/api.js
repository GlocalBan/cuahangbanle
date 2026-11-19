'use strict';
const { createRepositories } = require('../dal/repositories.js');
const { AuthService } = require('../bll/authService.js');
const { StaffService } = require('../bll/staffService.js');
const { SystemService } = require('../bll/systemService.js');
const { CatalogService } = require('../bll/catalogService.js');
const { WarehouseService } = require('../bll/warehouseService.js');
const { SalesService } = require('../bll/salesService.js');
const { ReportService } = require('../bll/reportService.js');
const { ForbiddenException, NotFoundException } = require('../bll/errors.js');
const { sendJson, sendError, readJsonBody, createAuthGuards } = require('../middleware/rbac.js');

function createApiRouter(db) {
  const repos = createRepositories(db);
  const authService = new AuthService(db, repos);
  const staffService = new StaffService(db, repos);
  const systemService = new SystemService(db, repos);
  const catalogService = new CatalogService(db, repos);
  const warehouseService = new WarehouseService(db, repos);
  const salesService = new SalesService(db, repos, systemService);
  const reportService = new ReportService(db, repos, systemService);
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

      // ─── M4: PROMOTIONS (Khuyến mãi — BR-04) ───────────────────────────────
      if (method === 'POST' && pathname === '/api/promotions/validate') {
        authorize(req, 'POS_SELL');
        const body = await readJsonBody(req);
        const result = salesService.validatePromotionForSubtotal(body.code || body.promotionId, body.subtotal);
        return sendJson(res, 200, {
          promotion: result.promotion,
          subtotal: result.subtotal,
          discountAmount: result.discountAmount,
          afterDiscount: result.afterDiscount,
          taxRate: result.taxRate,
          taxAmount: result.taxAmount,
          totalAmount: result.totalAmount,
        });
      }

      if (pathname === '/api/promotions') {
        if (method === 'GET') {
          const requestedActiveOnly = urlObj.searchParams.get('activeOnly') === 'true';
          const auth = authenticate(req);
          const canManage = auth.permissions.includes('PROMOTION_MANAGE');
          const canSell = auth.permissions.includes('POS_SELL');
          if (requestedActiveOnly) {
            if (!canManage && !canSell) {
              throw new ForbiddenException(
                `Vai trò ${auth.user.role_short_name} không có quyền xem khuyến mãi áp dụng tại POS (yêu cầu POS_SELL hoặc PROMOTION_MANAGE).`,
              );
            }
          } else if (!canManage) {
            throw new ForbiddenException(
              `Vai trò ${auth.user.role_short_name} không có quyền quản lý chương trình khuyến mãi (yêu cầu PROMOTION_MANAGE).`,
            );
          }
          const result = salesService.listPromotions(
            {
              search: urlObj.searchParams.get('search') || '',
              status: urlObj.searchParams.get('status') || '',
            },
            { activeOnly: requestedActiveOnly },
          );
          return sendJson(res, 200, result);
        }
        if (method === 'POST') {
          const auth = authorize(req, 'PROMOTION_MANAGE');
          const body = await readJsonBody(req);
          const item = salesService.createPromotion(auth.user, body);
          return sendJson(res, 201, { item });
        }
      }

      const promoStatusMatch = /^\/api\/promotions\/([^/]+)\/status$/.exec(pathname);
      if (method === 'PATCH' && promoStatusMatch) {
        const auth = authorize(req, 'PROMOTION_MANAGE');
        const body = await readJsonBody(req);
        const item = salesService.setPromotionStatus(
          auth.user,
          decodeURIComponent(promoStatusMatch[1]),
          body.status,
        );
        return sendJson(res, 200, { item });
      }

      const promoIdMatch = /^\/api\/promotions\/([^/]+)$/.exec(pathname);
      if (promoIdMatch) {
        const targetId = decodeURIComponent(promoIdMatch[1]);
        if (method === 'PUT' || method === 'PATCH') {
          const auth = authorize(req, 'PROMOTION_MANAGE');
          const body = await readJsonBody(req);
          const item = salesService.updatePromotion(auth.user, targetId, body);
          return sendJson(res, 200, { item });
        }
        if (method === 'DELETE') {
          authorize(req, 'PROMOTION_MANAGE');
          throw new ForbiddenException(
            'Không cho phép xóa cứng chương trình khuyến mãi. Hãy chuyển trạng thái sang Tạm dừng hoặc Kết thúc để bảo toàn lịch sử hóa đơn.',
          );
        }
      }

      // ─── M4: CUSTOMERS (Khách hàng cho POS & Tra cứu) ──────────────────────
      if (pathname === '/api/customers') {
        if (method === 'GET') {
          authorize(req, 'CUSTOMER_MANAGE');
          const result = salesService.listCustomers({
            search: urlObj.searchParams.get('search') || '',
            status: urlObj.searchParams.get('status') || '',
          });
          return sendJson(res, 200, result);
        }
        if (method === 'POST') {
          const auth = authorize(req, 'CUSTOMER_MANAGE');
          const body = await readJsonBody(req);
          const item = salesService.createCustomer(auth.user, body);
          return sendJson(res, 201, { item });
        }
      }

      const custHistoryMatch = /^\/api\/customers\/([^/]+)\/history$/.exec(pathname);
      if (method === 'GET' && custHistoryMatch) {
        authorize(req, 'CUSTOMER_MANAGE');
        return sendJson(res, 200, salesService.getCustomerHistory(decodeURIComponent(custHistoryMatch[1])));
      }

      const custIdMatch = /^\/api\/customers\/([^/]+)$/.exec(pathname);
      if (custIdMatch) {
        const targetId = decodeURIComponent(custIdMatch[1]);
        if (method === 'PUT' || method === 'PATCH') {
          const auth = authorize(req, 'CUSTOMER_MANAGE');
          const body = await readJsonBody(req);
          const item = salesService.updateCustomer(auth.user, targetId, body);
          return sendJson(res, 200, { item });
        }
        if (method === 'DELETE') {
          authorize(req, 'CUSTOMER_MANAGE');
          throw new ForbiddenException('Không cho phép xóa cứng khách hàng. Hãy chuyển trạng thái sang Tạm ngừng.');
        }
      }

      // ─── M4: POS CHECKOUT & ORDERS (BR-03, BR-04, BR-05) ───────────────────
      if (method === 'POST' && pathname === '/api/pos/checkout') {
        const auth = authorize(req, 'POS_SELL');
        const body = await readJsonBody(req);
        const item = salesService.checkout(auth.user, body);
        return sendJson(res, 201, { item });
      }

      if (method === 'GET' && pathname === '/api/orders') {
        authorize(req, 'ORDER_VIEW');
        const result = salesService.listOrders({
          search: urlObj.searchParams.get('search') || '',
          status: urlObj.searchParams.get('status') || '',
          paymentMethod: urlObj.searchParams.get('paymentMethod') || '',
          customerId: urlObj.searchParams.get('customerId') || '',
          fromDate: urlObj.searchParams.get('fromDate') || '',
          toDate: urlObj.searchParams.get('toDate') || '',
        });
        return sendJson(res, 200, result);
      }

      const orderPayMatch = /^\/api\/orders\/([^/]+)\/pay$/.exec(pathname);
      if (method === 'POST' && orderPayMatch) {
        const auth = authorize(req, 'POS_SELL');
        salesService.payOrder(auth.user, decodeURIComponent(orderPayMatch[1]));
      }

      const orderIdMatch = /^\/api\/orders\/([^/]+)$/.exec(pathname);
      if (orderIdMatch) {
        const targetId = decodeURIComponent(orderIdMatch[1]);
        if (method === 'GET') {
          const auth = authorize(req, 'ORDER_VIEW');
          const item = salesService.getOrder(targetId, {
            canViewCost: auth.permissions.includes('PRODUCT_COST_VIEW'),
          });
          return sendJson(res, 200, { item });
        }
        if (['PUT', 'PATCH', 'DELETE'].includes(method)) {
          authorize(req, 'ORDER_VIEW');
          salesService.forbidOrderMutation(targetId);
        }
      }

      // ─── M4: CUSTOMER RETURNS (Trả hàng trong hạn — BR-05 & BR-06) ─────────
      if (pathname === '/api/returns') {
        if (method === 'GET') {
          authorize(req, 'RETURN_CREATE');
          const result = salesService.listReturns({
            search: urlObj.searchParams.get('search') || '',
            status: urlObj.searchParams.get('status') || '',
            orderId: urlObj.searchParams.get('orderId') || '',
            fromDate: urlObj.searchParams.get('fromDate') || '',
            toDate: urlObj.searchParams.get('toDate') || '',
          });
          return sendJson(res, 200, result);
        }
        if (method === 'POST') {
          const auth = authorize(req, 'RETURN_CREATE');
          const body = await readJsonBody(req);
          const item = salesService.createReturn(auth.user, body);
          return sendJson(res, 201, { item });
        }
      }

      const returnApproveMatch = /^\/api\/returns\/([^/]+)\/approve$/.exec(pathname);
      if (method === 'POST' && returnApproveMatch) {
        const auth = authorize(req, 'RETURN_APPROVE');
        const item = salesService.approveReturn(auth.user, decodeURIComponent(returnApproveMatch[1]));
        return sendJson(res, 200, { item });
      }

      const returnRejectMatch = /^\/api\/returns\/([^/]+)\/reject$/.exec(pathname);
      if (method === 'POST' && returnRejectMatch) {
        const auth = authorize(req, 'RETURN_APPROVE');
        const body = await readJsonBody(req);
        const item = salesService.rejectReturn(
          auth.user,
          decodeURIComponent(returnRejectMatch[1]),
          body.reason || '',
        );
        return sendJson(res, 200, { item });
      }

      const returnIdMatch = /^\/api\/returns\/([^/]+)$/.exec(pathname);
      if (returnIdMatch) {
        const targetId = decodeURIComponent(returnIdMatch[1]);
        if (method === 'GET') {
          authorize(req, 'RETURN_CREATE');
          const item = salesService.getReturn(targetId);
          return sendJson(res, 200, { item });
        }
        if (method === 'DELETE') {
          authorize(req, 'RETURN_APPROVE');
          throw new ForbiddenException(
            'Không cho phép xóa cứng phiếu trả hàng. Hãy dùng chức năng Từ chối (TuChoi) nếu phiếu đang Chờ duyệt.',
          );
        }
      }

      // ─── M5: DASHBOARD, FINANCIAL & INVENTORY REPORTS (BR-08 + RBAC) ───────
      if (method === 'GET' && pathname === '/api/reports/dashboard') {
        authorize(req, 'REPORT_VIEW');
        authorize(req, 'REPORT_PROFIT');
        const result = reportService.getDashboard({
          days: urlObj.searchParams.get('days') || 7,
          fromDate: urlObj.searchParams.get('fromDate') || '',
          toDate: urlObj.searchParams.get('toDate') || '',
        });
        return sendJson(res, 200, result);
      }

      if (method === 'GET' && pathname === '/api/reports/sales') {
        authorize(req, 'REPORT_VIEW');
        authorize(req, 'REPORT_PROFIT');
        const result = reportService.getSalesReport({
          fromDate: urlObj.searchParams.get('fromDate') || '',
          toDate: urlObj.searchParams.get('toDate') || '',
          categoryCode: urlObj.searchParams.get('categoryCode') || '',
          groupBy: urlObj.searchParams.get('groupBy') || 'day',
        });
        return sendJson(res, 200, result);
      }

      if (method === 'GET' && pathname === '/api/reports/inventory') {
        authorize(req, 'INVENTORY_VIEW');
        const result = reportService.getInventoryReport({
          categoryCode: urlObj.searchParams.get('categoryCode') || '',
        });
        return sendJson(res, 200, result);
      }

      throw new NotFoundException(`Đường dẫn API không tồn tại: ${method} ${pathname}`);
    } catch (err) {
      return sendError(res, err);
    }
  };
}

module.exports = { createApiRouter };
