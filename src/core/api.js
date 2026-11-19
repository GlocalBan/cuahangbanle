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
    if (['products', 'inventory', 'purchases'].includes(page) && $('#content')) render();
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
