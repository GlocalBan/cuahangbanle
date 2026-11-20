/* Client-side REST API adapter (Presentation -> Backend API -> BLL -> DAL). */
'use strict';

const TOKEN_STORAGE_KEY = 'retailflow-jwt-token';

const apiState = {
  staff: [],
  staffLoaded: false,
  roles: [],
  rolesLoaded: false,
  thamSo: [],
  thamSoLoaded: false,
  auditLogs: { items: [], total: 0, page: 1, limit: 15, totalPages: 1, actions: [] },
  auditLogsLoaded: false,
  auditLogError: '',
  // M2 Catalog & Stock Ledger caches
  products: [],
  productsSummary: {
    total: 0,
    activeCount: 0,
    inactiveCount: 0,
    lowStockCount: 0,
    outOfStockCount: 0,
    totalStockQty: 0,
  },
  productsLoaded: false,
  productError: '',
  categories: [],
  categoriesLoaded: false,
  units: [],
  unitsLoaded: false,
  suppliers: [],
  suppliersLoaded: false,
  productImages: [],
  productImagesLoaded: false,
  stockMovements: {
    items: [],
    total: 0,
    page: 1,
    limit: 12,
    totalPages: 1,
    docTypes: [],
    docTypeLabels: {},
  },
  stockMovementsLoaded: false,
  stockMovementError: '',
  // M3 Warehouse (Purchases & Stock Audits) caches
  purchases: [],
  purchasesSummary: {
    total: 0,
    draftCount: 0,
    confirmedCount: 0,
    cancelledCount: 0,
    totalConfirmedAmount: 0,
  },
  purchasesLoaded: false,
  purchaseError: '',
  restockSuggestions: [],
  restockLoaded: false,
  stockAudits: [],
  stockAuditsSummary: {
    total: 0,
    pendingCount: 0,
    approvedCount: 0,
    cancelledCount: 0,
  },
  stockAuditsLoaded: false,
  stockAuditError: '',
  // M4 POS, Promotions, Customers, Orders & Returns caches
  promotions: [],
  promotionsSummary: { total: 0, activeCount: 0, upcomingCount: 0, pausedCount: 0, endedCount: 0 },
  promotionsLoaded: false,
  activePromotions: [],
  activePromotionsLoaded: false,
  customers: [],
  customersLoaded: false,
  orders: [],
  ordersSummary: { total: 0, paidCount: 0, returnedCount: 0, grossRevenue: 0, refundedTotal: 0, netRevenue: 0 },
  ordersLoaded: false,
  orderError: '',
  returns: [],
  returnsSummary: { total: 0, pendingCount: 0, approvedCount: 0, rejectedCount: 0, totalRefunded: 0 },
  returnsLoaded: false,
  returnError: '',
  // M5 Dashboard & Financial/Inventory Reports caches
  dashboardData: null,
  dashboardLoaded: false,
  dashboardError: '',
  salesReport: null,
  salesReportLoaded: false,
  salesReportError: '',
  inventoryReport: null,
  inventoryReportLoaded: false,
  // Phase 2 (Chặng 2): Batches, Near-Expiry & Write-Offs
  nearExpiry: {
    items: [],
    summary: {
      warnDays: 14,
      totalBatches: 0,
      expiredCount: 0,
      expiredQty: 0,
      expiredCostValue: 0,
      nearExpiryCount: 0,
      nearExpiryQty: 0,
      nearExpiryCostValue: 0,
      totalQty: 0,
      atRiskCostValue: 0,
    },
  },
  nearExpiryLoaded: false,
  writeoffs: [],
  writeoffsSummary: { total: 0, pendingCount: 0, approvedCount: 0, cancelledCount: 0, totalApprovedLoss: 0 },
  writeoffsLoaded: false,
  loading: {},
};

function getAuthToken() {
  try {
    return sessionStorage.getItem(TOKEN_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

function setAuthToken(token) {
  try {
    if (token) sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
    else sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // ignore storage restriction
  }
}

function resetApiCaches() {
  apiState.staff = [];
  apiState.staffLoaded = false;
  apiState.roles = [];
  apiState.rolesLoaded = false;
  apiState.thamSo = [];
  apiState.thamSoLoaded = false;
  apiState.auditLogs = { items: [], total: 0, page: 1, limit: 15, totalPages: 1, actions: [] };
  apiState.auditLogsLoaded = false;
  apiState.auditLogError = '';
  apiState.products = [];
  apiState.productsSummary = {
    total: 0,
    activeCount: 0,
    inactiveCount: 0,
    lowStockCount: 0,
    outOfStockCount: 0,
    totalStockQty: 0,
  };
  apiState.productsLoaded = false;
  apiState.productError = '';
  apiState.categories = [];
  apiState.categoriesLoaded = false;
  apiState.units = [];
  apiState.unitsLoaded = false;
  apiState.suppliers = [];
  apiState.suppliersLoaded = false;
  apiState.productImages = [];
  apiState.productImagesLoaded = false;
  apiState.stockMovements = {
    items: [],
    total: 0,
    page: 1,
    limit: 12,
    totalPages: 1,
    docTypes: [],
    docTypeLabels: {},
  };
  apiState.stockMovementsLoaded = false;
  apiState.stockMovementError = '';
  apiState.purchases = [];
  apiState.purchasesSummary = {
    total: 0,
    draftCount: 0,
    confirmedCount: 0,
    cancelledCount: 0,
    totalConfirmedAmount: 0,
  };
  apiState.purchasesLoaded = false;
  apiState.purchaseError = '';
  apiState.restockSuggestions = [];
  apiState.restockLoaded = false;
  apiState.stockAudits = [];
  apiState.stockAuditsSummary = {
    total: 0,
    pendingCount: 0,
    approvedCount: 0,
    cancelledCount: 0,
  };
  apiState.stockAuditsLoaded = false;
  apiState.stockAuditError = '';
  apiState.promotions = [];
  apiState.promotionsSummary = { total: 0, activeCount: 0, upcomingCount: 0, pausedCount: 0, endedCount: 0 };
  apiState.promotionsLoaded = false;
  apiState.activePromotions = [];
  apiState.activePromotionsLoaded = false;
  apiState.customers = [];
  apiState.customersLoaded = false;
  apiState.orders = [];
  apiState.ordersSummary = { total: 0, paidCount: 0, returnedCount: 0, grossRevenue: 0, refundedTotal: 0, netRevenue: 0 };
  apiState.ordersLoaded = false;
  apiState.orderError = '';
  apiState.returns = [];
  apiState.returnsSummary = { total: 0, pendingCount: 0, approvedCount: 0, rejectedCount: 0, totalRefunded: 0 };
  apiState.returnsLoaded = false;
  apiState.returnError = '';
  apiState.dashboardData = null;
  apiState.dashboardLoaded = false;
  apiState.dashboardError = '';
  apiState.salesReport = null;
  apiState.salesReportLoaded = false;
  apiState.salesReportError = '';
  apiState.inventoryReport = null;
  apiState.inventoryReportLoaded = false;
  apiState.nearExpiry = {
    items: [],
    summary: {
      warnDays: 14,
      totalBatches: 0,
      expiredCount: 0,
      expiredQty: 0,
      expiredCostValue: 0,
      nearExpiryCount: 0,
      nearExpiryQty: 0,
      nearExpiryCostValue: 0,
      totalQty: 0,
      atRiskCostValue: 0,
    },
  };
  apiState.nearExpiryLoaded = false;
  apiState.writeoffs = [];
  apiState.writeoffsSummary = { total: 0, pendingCount: 0, approvedCount: 0, cancelledCount: 0, totalApprovedLoss: 0 };
  apiState.writeoffsLoaded = false;
  apiState.loading = {};
}

function syncStoreSettingsFromServer(storeConfig) {
  if (!storeConfig || !store?.data?.settings) return;
  Object.assign(store.data.settings, {
    name: storeConfig.name || store.data.settings.name,
    address: storeConfig.address || store.data.settings.address,
    phone: storeConfig.phone || store.data.settings.phone,
    taxRate: Number(storeConfig.taxRate ?? store.data.settings.taxRate),
    defaultMinStock: Number(storeConfig.defaultMinStock ?? 15),
    returnWindowDays: Number(storeConfig.returnWindowDays ?? 7),
    maxCashierLineDiscountPct: Number(storeConfig.maxCashierLineDiscountPct ?? 10),
    bank: storeConfig.bank || store.data.settings.bank,
    bankAccount: storeConfig.bankAccount || store.data.settings.bankAccount,
    bankOwner: storeConfig.bankOwner || store.data.settings.bankOwner,
    receiptNote: storeConfig.receiptNote ?? store.data.settings.receiptNote,
  });
}

function buildQuery(params = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && String(v).trim() !== '') {
      qs.set(k, String(v).trim());
    }
  }
  return qs.toString() ? `?${qs.toString()}` : '';
}

async function apiRequest(method, url, body = null, options = {}) {
  const headers = { Accept: 'application/json' };
  const token = getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== null) headers['Content-Type'] = 'application/json';

  const res = await fetch(url, {
    method,
    headers,
    body: body !== null ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });

  let payload = {};
  try {
    payload = await res.json();
  } catch {
    payload = {};
  }

  if (!res.ok) {
    const message = payload?.error?.message || `Yêu cầu thất bại (HTTP ${res.status}).`;
    const err = new Error(message);
    err.status = res.status;
    err.code = payload?.error?.code || 'HTTP_ERROR';
    if (res.status === 401 && !options.skipAuthRedirect) {
      setAuthToken('');
      store.setAuthenticatedUser(null);
      resetApiCaches();
      if (typeof loginScreen === 'function') {
        loginScreen(message);
      }
    }
    throw err;
  }

  return payload;
}

const api = {
  getStoreConfig: () => apiRequest('GET', '/api/store-config', null, { skipAuthRedirect: true }),
  login: (username, password) =>
    apiRequest('POST', '/api/auth/login', { username, password }, { skipAuthRedirect: true }),
  me: () => apiRequest('GET', '/api/auth/me', null, { skipAuthRedirect: true }),
  logout: () => apiRequest('POST', '/api/auth/logout', {}, { skipAuthRedirect: true }),
  changePassword: (data) => apiRequest('POST', '/api/auth/change-password', data),
  listRoles: () => apiRequest('GET', '/api/roles'),
  listStaff: (params = {}) => apiRequest('GET', `/api/staff${buildQuery(params)}`),
  createStaff: (data) => apiRequest('POST', '/api/staff', data),
  updateStaff: (id, data) => apiRequest('PUT', `/api/staff/${encodeURIComponent(id)}`, data),
  setStaffStatus: (id, status) =>
    apiRequest('PATCH', `/api/staff/${encodeURIComponent(id)}/status`, { status }),
  listThamSo: () => apiRequest('GET', '/api/tham-so'),
  updateThamSo: (items) => apiRequest('PUT', '/api/tham-so', { items }),
  exportBackup: () => apiRequest('GET', '/api/system/backup'),
  queryAuditLogs: (params = {}) => apiRequest('GET', `/api/audit-logs${buildQuery(params)}`),

  // M2 Catalog & Stock Ledger
  listProductImages: () => apiRequest('GET', '/api/product-images'),
  listProducts: (params = {}) => apiRequest('GET', `/api/products${buildQuery(params)}`),
  getProduct: (id) => apiRequest('GET', `/api/products/${encodeURIComponent(id)}`),
  createProduct: (data) => apiRequest('POST', '/api/products', data),
  updateProduct: (id, data) => apiRequest('PUT', `/api/products/${encodeURIComponent(id)}`, data),
  setProductStatus: (id, status) =>
    apiRequest('PATCH', `/api/products/${encodeURIComponent(id)}/status`, { status }),
  adjustProductStock: (id, data) =>
    apiRequest('POST', `/api/products/${encodeURIComponent(id)}/stock-adjust`, data),

  listCategories: (params = {}) => apiRequest('GET', `/api/categories${buildQuery(params)}`),
  createCategory: (data) => apiRequest('POST', '/api/categories', data),
  updateCategory: (code, data) => apiRequest('PUT', `/api/categories/${encodeURIComponent(code)}`, data),
  setCategoryStatus: (code, status) =>
    apiRequest('PATCH', `/api/categories/${encodeURIComponent(code)}/status`, { status }),

  listUnits: (params = {}) => apiRequest('GET', `/api/units${buildQuery(params)}`),
  createUnit: (data) => apiRequest('POST', '/api/units', data),
  updateUnit: (code, data) => apiRequest('PUT', `/api/units/${encodeURIComponent(code)}`, data),
  setUnitStatus: (code, status) =>
    apiRequest('PATCH', `/api/units/${encodeURIComponent(code)}/status`, { status }),

  listSuppliers: (params = {}) => apiRequest('GET', `/api/suppliers${buildQuery(params)}`),
  createSupplier: (data) => apiRequest('POST', '/api/suppliers', data),
  updateSupplier: (id, data) => apiRequest('PUT', `/api/suppliers/${encodeURIComponent(id)}`, data),
  setSupplierStatus: (id, status) =>
    apiRequest('PATCH', `/api/suppliers/${encodeURIComponent(id)}/status`, { status }),
  getSupplierHistory: (id) => apiRequest('GET', `/api/suppliers/${encodeURIComponent(id)}/history`),

  queryStockMovements: (params = {}) => apiRequest('GET', `/api/stock-movements${buildQuery(params)}`),

  // M3 Purchases, Restock Suggestions & Stock Audits
  listRestockSuggestions: () => apiRequest('GET', '/api/restock-suggestions'),
  listPurchases: (params = {}) => apiRequest('GET', `/api/purchases${buildQuery(params)}`),
  getPurchase: (id) => apiRequest('GET', `/api/purchases/${encodeURIComponent(id)}`),
  createPurchase: (data) => apiRequest('POST', '/api/purchases', data),
  updatePurchase: (id, data) => apiRequest('PUT', `/api/purchases/${encodeURIComponent(id)}`, data),
  confirmPurchase: (id) => apiRequest('POST', `/api/purchases/${encodeURIComponent(id)}/confirm`, {}),
  cancelPurchase: (id, reason = '') =>
    apiRequest('POST', `/api/purchases/${encodeURIComponent(id)}/cancel`, { reason }),

  listStockAudits: (params = {}) => apiRequest('GET', `/api/stock-audits${buildQuery(params)}`),
  getStockAudit: (id) => apiRequest('GET', `/api/stock-audits/${encodeURIComponent(id)}`),
  createStockAudit: (data) => apiRequest('POST', '/api/stock-audits', data),
  approveStockAudit: (id) => apiRequest('POST', `/api/stock-audits/${encodeURIComponent(id)}/approve`, {}),
  cancelStockAudit: (id, reason = '') =>
    apiRequest('POST', `/api/stock-audits/${encodeURIComponent(id)}/cancel`, { reason }),

  // M4 Promotions, Customers, POS Checkout, Orders & Returns
  listPromotions: (params = {}) => apiRequest('GET', `/api/promotions${buildQuery(params)}`),
  createPromotion: (data) => apiRequest('POST', '/api/promotions', data),
  updatePromotion: (id, data) => apiRequest('PUT', `/api/promotions/${encodeURIComponent(id)}`, data),
  setPromotionStatus: (id, status) =>
    apiRequest('PATCH', `/api/promotions/${encodeURIComponent(id)}/status`, { status }),
  validatePromotion: (code, subtotal) =>
    apiRequest('POST', '/api/promotions/validate', { code, subtotal }),

  listCustomers: (params = {}) => apiRequest('GET', `/api/customers${buildQuery(params)}`),
  createCustomer: (data) => apiRequest('POST', '/api/customers', data),
  updateCustomer: (id, data) => apiRequest('PUT', `/api/customers/${encodeURIComponent(id)}`, data),
  getCustomerHistory: (id) => apiRequest('GET', `/api/customers/${encodeURIComponent(id)}/history`),

  checkoutPos: (data) => apiRequest('POST', '/api/pos/checkout', data),
  listOrders: (params = {}) => apiRequest('GET', `/api/orders${buildQuery(params)}`),
  getOrder: (id) => apiRequest('GET', `/api/orders/${encodeURIComponent(id)}`),

  listReturns: (params = {}) => apiRequest('GET', `/api/returns${buildQuery(params)}`),
  getReturn: (id) => apiRequest('GET', `/api/returns/${encodeURIComponent(id)}`),
  createReturn: (data) => apiRequest('POST', '/api/returns', data),
  approveReturn: (id) => apiRequest('POST', `/api/returns/${encodeURIComponent(id)}/approve`, {}),
  rejectReturn: (id, reason = '') =>
    apiRequest('POST', `/api/returns/${encodeURIComponent(id)}/reject`, { reason }),

  // M5 Dashboard & Financial / Inventory Reports (BR-08)
  getDashboardReport: (params = {}) => apiRequest('GET', `/api/reports/dashboard${buildQuery(params)}`),
  getSalesReport: (params = {}) => apiRequest('GET', `/api/reports/sales${buildQuery(params)}`),
  getInventoryReport: (params = {}) => apiRequest('GET', `/api/reports/inventory${buildQuery(params)}`),

  // Phase 2 (Chặng 2): Batches, Near-Expiry & Write-Offs
  listBatches: (params = {}) => apiRequest('GET', `/api/batches${buildQuery(params)}`),
  listNearExpiryBatches: (params = {}) => apiRequest('GET', `/api/batches/near-expiry${buildQuery(params)}`),
  listWriteOffs: (params = {}) => apiRequest('GET', `/api/writeoffs${buildQuery(params)}`),
  getWriteOff: (id) => apiRequest('GET', `/api/writeoffs/${encodeURIComponent(id)}`),
  createWriteOff: (data) => apiRequest('POST', '/api/writeoffs', data),
  approveWriteOff: (id) => apiRequest('POST', `/api/writeoffs/${encodeURIComponent(id)}/approve`, {}),
  cancelWriteOff: (id, reason = '') =>
    apiRequest('POST', `/api/writeoffs/${encodeURIComponent(id)}/cancel`, { reason }),
};

async function loadStaffData(force = false) {
  if (!store.hasPermission('STAFF_MANAGE')) return;
  if (apiState.loading.staff) return;
  if (apiState.staffLoaded && apiState.rolesLoaded && !force) return;
  apiState.loading.staff = true;
  try {
    const [staffRes, rolesRes] = await Promise.all([api.listStaff(), api.listRoles()]);
    apiState.staff = staffRes.items || [];
    apiState.roles = rolesRes.items || [];
    apiState.staffLoaded = true;
    apiState.rolesLoaded = true;
  } catch (err) {
    notify(err.message, true);
  } finally {
    apiState.loading.staff = false;
    if (page === 'staff' && $('#content')) render();
  }
}

async function loadThamSoData(force = false) {
  if (!store.hasPermission('THAM_SO_MANAGE')) return;
  if (apiState.loading.thamSo) return;
  if (apiState.thamSoLoaded && !force) return;
  apiState.loading.thamSo = true;
  try {
    const res = await api.listThamSo();
    apiState.thamSo = res.items || [];
    apiState.thamSoLoaded = true;
    syncStoreSettingsFromServer(res.storeConfig);
  } catch (err) {
    notify(err.message, true);
  } finally {
    apiState.loading.thamSo = false;
    if (page === 'settings' && $('#content')) render();
  }
}

async function loadAuditLogsData(force = false) {
  if (!store.hasPermission('AUDIT_LOG_VIEW')) return;
  if (apiState.loading.auditLogs && !force) return;
  const fromDate = filters.auditFrom || '';
  const toDate = filters.auditTo || '';
  if (fromDate && toDate && fromDate > toDate) {
    apiState.auditLogError = 'Khoảng thời gian không hợp lệ: "Từ ngày" phải nhỏ hơn hoặc bằng "Đến ngày".';
    apiState.auditLogsLoaded = true;
    if (page === 'audit-logs' && $('#content')) render();
    return;
  }
  apiState.auditLogError = '';
  apiState.loading.auditLogs = true;
  try {
    const res = await api.queryAuditLogs({
      search: filters.auditSearch || '',
      action: filters.auditAction || '',
      fromDate,
      toDate,
      page: pagination['audit-logs'] || 1,
      limit: 12,
    });
    apiState.auditLogs = res;
    apiState.auditLogsLoaded = true;
  } catch (err) {
    apiState.auditLogError = err.message;
    notify(err.message, true);
  } finally {
    apiState.loading.auditLogs = false;
    if (page === 'audit-logs' && $('#content')) render();
  }
}

async function loadCatalogMeta(force = false) {
  if (!store.hasPermission('PRODUCT_VIEW')) return;
  if (apiState.loading.catalogMeta) return;
  const needSup = store.hasPermission('SUPPLIER_VIEW') && (!apiState.suppliersLoaded || force);
  const needCat = !apiState.categoriesLoaded || force;
  const needUnit = !apiState.unitsLoaded || force;
  const needImg = !apiState.productImagesLoaded || force;
  if (!needSup && !needCat && !needUnit && !needImg) return;

  apiState.loading.catalogMeta = true;
  try {
    const jobs = [];
    if (needCat) jobs.push(api.listCategories().then((r) => { apiState.categories = r.items || []; apiState.categoriesLoaded = true; }));
    if (needUnit) jobs.push(api.listUnits().then((r) => { apiState.units = r.items || []; apiState.unitsLoaded = true; }));
    if (needImg) jobs.push(api.listProductImages().then((r) => { apiState.productImages = r.items || []; apiState.productImagesLoaded = true; }));
    if (needSup) {
      jobs.push(
        api.listSuppliers().then((r) => {
          apiState.suppliers = r.items || [];
          apiState.suppliersLoaded = true;
        }),
      );
    }
    await Promise.all(jobs);
  } catch (err) {
    notify(err.message, true);
  } finally {
    apiState.loading.catalogMeta = false;
    if (['products', 'suppliers', 'inventory', 'purchases'].includes(page) && $('#content')) render();
  }
}

async function loadProductsData(force = false) {
  if (!store.hasPermission('PRODUCT_VIEW')) return;
  if (apiState.loading.products && !force) return;
  const minPrice = filters.productMinPrice || '';
  const maxPrice = filters.productMaxPrice || '';
  if (minPrice !== '' && maxPrice !== '' && Number(minPrice) > Number(maxPrice)) {
    apiState.productError = 'Khoảng giá không hợp lệ: "Giá từ" phải nhỏ hơn hoặc bằng "Giá đến".';
    apiState.productsLoaded = true;
    if (['products', 'inventory'].includes(page) && $('#content')) render();
    return;
  }
  apiState.productError = '';
  apiState.loading.products = true;
  try {
    const params =
      page === 'products'
        ? {
            search: filters.products || '',
            categoryCode: filters.productCategory || '',
            supplierId: filters.productSupplier || '',
            status: filters.productStatus || '',
            stockLevel: filters.productStock || '',
            minPrice,
            maxPrice,
          }
        : {
            search: filters.inventory || '',
            stockLevel: filters.low === 'yes' ? 'low' : '',
          };
    const res = await api.listProducts(params);
    apiState.products = res.items || [];
    apiState.productsSummary = res.summary || apiState.productsSummary;
    apiState.productsLoaded = true;
  } catch (err) {
    apiState.productError = err.message;
    notify(err.message, true);
  } finally {
    apiState.loading.products = false;
    if (['products', 'inventory', 'purchases', 'pos'].includes(page) && $('#content')) render();
  }
}

async function loadSuppliersData(force = false) {
  if (!store.hasPermission('SUPPLIER_VIEW')) return;
  if (apiState.loading.suppliers && !force) return;
  if (apiState.suppliersLoaded && !force && !filters.suppliers && !filters.supplierStatus) return;
  apiState.loading.suppliers = true;
  try {
    const res = await api.listSuppliers({
      search: filters.suppliers || '',
      status: filters.supplierStatus || '',
    });
    apiState.suppliers = res.items || [];
    apiState.suppliersLoaded = true;
  } catch (err) {
    notify(err.message, true);
  } finally {
    apiState.loading.suppliers = false;
    if (['suppliers', 'products'].includes(page) && $('#content')) render();
  }
}

async function loadStockMovementsData(force = false) {
  if (!store.hasPermission('INVENTORY_VIEW')) return;
  if (apiState.loading.stockMovements && !force) return;
  const fromDate = filters.moveFrom || '';
  const toDate = filters.moveTo || '';
  if (fromDate && toDate && fromDate > toDate) {
    apiState.stockMovementError = 'Khoảng thời gian không hợp lệ: "Từ ngày" phải nhỏ hơn hoặc bằng "Đến ngày" (BR-08).';
    apiState.stockMovementsLoaded = true;
    if (page === 'inventory' && $('#content')) render();
    return;
  }
  apiState.stockMovementError = '';
  apiState.loading.stockMovements = true;
  try {
    const res = await api.queryStockMovements({
      search: filters.moveSearch || '',
      docType: filters.moveDocType || '',
      fromDate,
      toDate,
      page: pagination['stock-movements'] || 1,
      limit: 12,
    });
    apiState.stockMovements = res;
    apiState.stockMovementsLoaded = true;
  } catch (err) {
    apiState.stockMovementError = err.message;
    notify(err.message, true);
  } finally {
    apiState.loading.stockMovements = false;
    if (page === 'inventory' && $('#content')) render();
  }
}

async function loadPurchasesData(force = false) {
  if (!store.hasPermission('PURCHASE_CREATE')) return;
  if (apiState.loading.purchases && !force) return;
  const fromDate = filters.purchaseFrom || '';
  const toDate = filters.purchaseTo || '';
  if (fromDate && toDate && fromDate > toDate) {
    apiState.purchaseError = 'Khoảng thời gian không hợp lệ: "Từ ngày" phải nhỏ hơn hoặc bằng "Đến ngày" (BR-08).';
    apiState.purchasesLoaded = true;
    if (page === 'purchases' && $('#content')) render();
    return;
  }
  apiState.purchaseError = '';
  apiState.loading.purchases = true;
  try {
    const [poRes, restockRes] = await Promise.all([
      api.listPurchases({
        search: filters.purchases || '',
        supplierId: filters.purchaseSupplier || '',
        status: filters.purchaseStatus || '',
        fromDate,
        toDate,
      }),
      api.listRestockSuggestions(),
    ]);
    apiState.purchases = poRes.items || [];
    apiState.purchasesSummary = poRes.summary || apiState.purchasesSummary;
    apiState.purchasesLoaded = true;
    apiState.restockSuggestions = restockRes.items || [];
    apiState.restockLoaded = true;
  } catch (err) {
    apiState.purchaseError = err.message;
    notify(err.message, true);
  } finally {
    apiState.loading.purchases = false;
    if (page === 'purchases' && $('#content')) render();
  }
}

async function loadStockAuditsData(force = false) {
  if (!store.hasPermission('INVENTORY_VIEW')) return;
  if (apiState.loading.stockAudits && !force) return;
  const fromDate = filters.auditListFrom || '';
  const toDate = filters.auditListTo || '';
  if (fromDate && toDate && fromDate > toDate) {
    apiState.stockAuditError = 'Khoảng thời gian không hợp lệ: "Từ ngày" phải nhỏ hơn hoặc bằng "Đến ngày" (BR-08).';
    apiState.stockAuditsLoaded = true;
    if (page === 'inventory' && $('#content')) render();
    return;
  }
  apiState.stockAuditError = '';
  apiState.loading.stockAudits = true;
  try {
    const res = await api.listStockAudits({
      search: filters.auditListSearch || '',
      status: filters.auditListStatus || '',
      fromDate,
      toDate,
    });
    apiState.stockAudits = res.items || [];
    apiState.stockAuditsSummary = res.summary || apiState.stockAuditsSummary;
    apiState.stockAuditsLoaded = true;
  } catch (err) {
    apiState.stockAuditError = err.message;
    notify(err.message, true);
  } finally {
    apiState.loading.stockAudits = false;
    if (page === 'inventory' && $('#content')) render();
  }
}

async function loadPosData(force = false) {
  if (!store.hasPermission('POS_SELL')) return;
  if (apiState.loading.pos && !force) return;
  apiState.loading.pos = true;
  try {
    const jobs = [
      api.listProducts({ status: 'DangKinhDoanh' }).then((res) => {
        apiState.products = res.items || [];
        apiState.productsSummary = res.summary || apiState.productsSummary;
        apiState.productsLoaded = true;
      }),
      api.listPromotions({ activeOnly: 'true' }).then((res) => {
        apiState.activePromotions = res.items || [];
        apiState.activePromotionsLoaded = true;
      }),
      api.getStoreConfig().then((cfg) => {
        syncStoreSettingsFromServer(cfg.storeConfig);
      }),
    ];
    if (store.hasPermission('CUSTOMER_MANAGE')) {
      jobs.push(
        api.listCustomers().then((res) => {
          apiState.customers = res.items || [];
          apiState.customersLoaded = true;
        }),
      );
    }
    await Promise.all(jobs);
  } catch (err) {
    notify(err.message, true);
  } finally {
    apiState.loading.pos = false;
    if (page === 'pos' && $('#content')) render();
  }
}

async function loadPromotionsData(force = false) {
  if (!store.hasPermission('PROMOTION_MANAGE')) return;
  if (apiState.loading.promotions && !force) return;
  apiState.loading.promotions = true;
  try {
    const res = await api.listPromotions({
      search: filters.promotions || '',
      status: filters.promoStatus || '',
    });
    apiState.promotions = res.items || [];
    apiState.promotionsSummary = res.summary || apiState.promotionsSummary;
    apiState.promotionsLoaded = true;
  } catch (err) {
    notify(err.message, true);
  } finally {
    apiState.loading.promotions = false;
    if (page === 'promotions' && $('#content')) render();
  }
}

async function loadCustomersData(force = false) {
  if (!store.hasPermission('CUSTOMER_MANAGE')) return;
  if (apiState.loading.customers && !force) return;
  apiState.loading.customers = true;
  try {
    const res = await api.listCustomers({
      search: filters.customers || '',
      status: filters.customerStatus || '',
    });
    apiState.customers = res.items || [];
    apiState.customersLoaded = true;
  } catch (err) {
    notify(err.message, true);
  } finally {
    apiState.loading.customers = false;
    if (['customers', 'pos'].includes(page) && $('#content')) render();
  }
}

async function loadOrdersData(force = false) {
  if (!store.hasPermission('ORDER_VIEW')) return;
  if (apiState.loading.orders && !force) return;
  const fromDate = filters.orderFrom || '';
  const toDate = filters.orderTo || '';
  if (fromDate && toDate && fromDate > toDate) {
    apiState.orderError = 'Khoảng thời gian không hợp lệ: "Từ ngày" phải nhỏ hơn hoặc bằng "Đến ngày" (BR-08).';
    apiState.ordersLoaded = true;
    if (page === 'orders' && $('#content')) render();
    return;
  }
  apiState.orderError = '';
  apiState.loading.orders = true;
  try {
    const res = await api.listOrders({
      search: filters.orders || '',
      status: filters.orderStatus || '',
      paymentMethod: filters.orderPayment || '',
      fromDate,
      toDate,
    });
    apiState.orders = res.items || [];
    apiState.ordersSummary = res.summary || apiState.ordersSummary;
    apiState.ordersLoaded = true;
  } catch (err) {
    apiState.orderError = err.message;
    notify(err.message, true);
  } finally {
    apiState.loading.orders = false;
    if (page === 'orders' && $('#content')) render();
  }
}

async function loadReturnsData(force = false) {
  if (!store.hasPermission('RETURN_CREATE')) return;
  if (apiState.loading.returns && !force) return;
  const fromDate = filters.returnFrom || '';
  const toDate = filters.returnTo || '';
  if (fromDate && toDate && fromDate > toDate) {
    apiState.returnError = 'Khoảng thời gian không hợp lệ: "Từ ngày" phải nhỏ hơn hoặc bằng "Đến ngày" (BR-08).';
    apiState.returnsLoaded = true;
    if (page === 'returns' && $('#content')) render();
    return;
  }
  apiState.returnError = '';
  apiState.loading.returns = true;
  try {
    const res = await api.listReturns({
      search: filters.returns || '',
      status: filters.returnStatus || '',
      fromDate,
      toDate,
    });
    apiState.returns = res.items || [];
    apiState.returnsSummary = res.summary || apiState.returnsSummary;
    apiState.returnsLoaded = true;
  } catch (err) {
    apiState.returnError = err.message;
    notify(err.message, true);
  } finally {
    apiState.loading.returns = false;
    if (page === 'returns' && $('#content')) render();
  }
}

function getDefaultReportRange(days = 30) {
  const end = new Date();
  const start = new Date(end.getTime() - (Math.max(1, Number(days) || 30) - 1) * 86400000);
  return {
    fromDate: start.toISOString().slice(0, 10),
    toDate: end.toISOString().slice(0, 10),
  };
}

async function loadDashboardData(force = false) {
  if (!store.hasPermission('REPORT_VIEW') || !store.hasPermission('REPORT_PROFIT')) return;
  if (apiState.loading.dashboard && !force) return;
  apiState.dashboardError = '';
  apiState.loading.dashboard = true;
  try {
    const res = await api.getDashboardReport({ days: chartDays || 7 });
    apiState.dashboardData = res;
    apiState.dashboardLoaded = true;
  } catch (err) {
    apiState.dashboardError = err.message;
    notify(err.message, true);
  } finally {
    apiState.loading.dashboard = false;
    if (page === 'dashboard' && $('#content')) render();
  }
}

async function loadReportsData(force = false) {
  if (!store.hasPermission('REPORT_VIEW') || !store.hasPermission('REPORT_PROFIT')) return;
  if (apiState.loading.reports && !force) return;
  if (!filters.reportFrom || !filters.reportTo) {
    const def = getDefaultReportRange(30);
    if (!filters.reportFrom) filters.reportFrom = def.fromDate;
    if (!filters.reportTo) filters.reportTo = def.toDate;
  }
  const fromDate = filters.reportFrom || '';
  const toDate = filters.reportTo || '';
  if (fromDate && toDate && fromDate > toDate) {
    apiState.salesReportError =
      'Khoảng thời gian không hợp lệ: "Từ ngày" phải nhỏ hơn hoặc bằng "Đến ngày" (BR-08).';
    apiState.salesReportLoaded = true;
    if (page === 'reports' && $('#content')) render();
    return;
  }
  apiState.salesReportError = '';
  apiState.loading.reports = true;
  try {
    const categoryCode = filters.reportCategory || '';
    const groupBy = filters.reportGroupBy || 'day';
    const [salesRes, invRes] = await Promise.all([
      api.getSalesReport({ fromDate, toDate, categoryCode, groupBy }),
      api.getInventoryReport({ categoryCode }),
    ]);
    apiState.salesReport = salesRes;
    apiState.salesReportLoaded = true;
    apiState.inventoryReport = invRes;
    apiState.inventoryReportLoaded = true;
  } catch (err) {
    apiState.salesReportError = err.message;
    notify(err.message, true);
  } finally {
    apiState.loading.reports = false;
    if (page === 'reports' && $('#content')) render();
  }
}

async function loadNearExpiryData(force = false) {
  if (!store.hasPermission('INVENTORY_VIEW')) return;
  if (apiState.loading.nearExpiry && !force) return;
  apiState.loading.nearExpiry = true;
  try {
    const [nearRes, woRes] = await Promise.all([
      api.listNearExpiryBatches({
        days: filters.nearExpiryDays || '',
        categoryCode: filters.nearExpiryCategory || '',
        includeExpired: filters.nearExpiryIncludeExpired === 'no' ? 'false' : 'true',
      }),
      api.listWriteOffs({
        status: filters.writeoffStatus || '',
      }),
    ]);
    apiState.nearExpiry = nearRes || apiState.nearExpiry;
    apiState.nearExpiryLoaded = true;
    apiState.writeoffs = woRes.items || [];
    apiState.writeoffsSummary = woRes.summary || apiState.writeoffsSummary;
    apiState.writeoffsLoaded = true;
  } catch (err) {
    notify(err.message, true);
  } finally {
    apiState.loading.nearExpiry = false;
    if (page === 'inventory' && $('#content')) render();
  }
}
