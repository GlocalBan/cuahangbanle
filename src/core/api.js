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
  listStaff: (params = {}) => {
    const qs = new URLSearchParams();
    if (params.search) qs.set('search', params.search);
    if (params.role) qs.set('role', params.role);
    if (params.status) qs.set('status', params.status);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return apiRequest('GET', `/api/staff${suffix}`);
  },
  createStaff: (data) => apiRequest('POST', '/api/staff', data),
  updateStaff: (id, data) => apiRequest('PUT', `/api/staff/${encodeURIComponent(id)}`, data),
  setStaffStatus: (id, status) =>
    apiRequest('PATCH', `/api/staff/${encodeURIComponent(id)}/status`, { status }),
  listThamSo: () => apiRequest('GET', '/api/tham-so'),
  updateThamSo: (items) => apiRequest('PUT', '/api/tham-so', { items }),
  queryAuditLogs: (params = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && String(v).trim() !== '') qs.set(k, String(v).trim());
    }
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return apiRequest('GET', `/api/audit-logs${suffix}`);
  },
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
