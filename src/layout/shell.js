function getRouteFromHash() {
  const raw = String(window.location.hash || '').replace(/^#\/?/, '').trim();
  return raw.split('?')[0] || '';
}

function buildSidebarNav() {
  const allowed = pages.filter((p) => store.can(p[0]));
  let lastGroup = '';
  return allowed
    .map(([key, label, ico, group]) => {
      const groupHeading = group && group !== lastGroup ? `<div class="nav-group">${e(group)}</div>` : '';
      lastGroup = group || lastGroup;
      return `${groupHeading}<button type="button" class="nav-item ${page === key ? 'active' : ''}" data-action="navigate" data-page="${key}" aria-current="${page === key ? 'page' : 'false'}">${icon(ico)}<span>${e(label)}</span>${key === 'branches' ? '<span class="badge">Mở rộng</span>' : ''}</button>`;
    })
    .join('');
}

function renderBreadcrumb() {
  if (page === 'forbidden') {
    return `<nav class="breadcrumb" aria-label="Breadcrumb"><span>Bảo mật RBAC</span><span class="sep">/</span><strong>403 · Không có quyền truy cập</strong></nav>`;
  }
  const meta = pages.find((p) => p[0] === page);
  if (!meta) return '';
  return `<nav class="breadcrumb" aria-label="Breadcrumb"><span>${e(meta[3] || 'Hệ thống')}</span><span class="sep">/</span><strong>${e(meta[1])}</strong></nav>`;
}

function shell() {
  const u = store.user;
  if (!u) {
    loginScreen();
    return;
  }
  const roleShort = ROLE_SHORT[u.role] || u.role;
  const initials = (u.fullName || u.name || 'NV')
    .split(' ')
    .filter(Boolean)
    .map((s) => s[0])
    .slice(-2)
    .join('')
    .toUpperCase();

  $('#root').innerHTML = `<aside class="sidebar" aria-label="Menu điều hướng chính">
    ${logo()}
    <nav>${buildSidebarNav()}</nav>
    <div class="sidebar-bottom">
      <div class="sidebar-note">
        ${icon('shield')}
        <div>
          <strong>Phiên bảo mật RBAC</strong>
          <p>Vai trò: ${e(roleShort)} · ${e((u.permissions || []).length || (ACCESS[u.role] || []).length)} quyền đang kích hoạt.</p>
        </div>
      </div>
      <div class="sidebar-user">
        <div class="avatar">${e(initials)}</div>
        <div>
          <strong>${e(u.fullName || u.name)}</strong>
          <small>${e(ROLES[u.role] || u.role)}</small>
        </div>
        ${ib('open-change-password', 'key', 'Đổi mật khẩu')}
        ${ib('logout', 'logout', 'Đăng xuất')}
      </div>
    </div>
  </aside>
  <div class="main">
    <header class="topbar">
      <div class="row gap8">
        ${ib('mobile-menu', 'menu', 'Mở menu', 'class="mobile-menu"')}
        <div id="topbar-breadcrumb">${renderBreadcrumb()}</div>
      </div>
      <div class="global-search">
        ${icon('search')}
        <input id="global-search" placeholder="Tìm màn hình, sản phẩm, hóa đơn…" aria-label="Tìm kiếm toàn hệ thống" autocomplete="off">
        <span class="key">/</span>
        <div id="global-results" hidden></div>
      </div>
      <div class="topbar-right">
        <span class="badge green"><i class="dot"></i>${e(roleShort)}</span>
        ${ib('notifications', 'bell', 'Thông báo cửa hàng')}
        ${ib('open-change-password', 'key', 'Đổi mật khẩu')}
        <div class="topbar-user">
          <div class="avatar">${e(u.username.slice(0, 2).toUpperCase())}</div>
          <div>
            <strong>${e(u.fullName || u.name)}</strong>
            <small>${e(u.username)} · ${e(ROLES[u.role] || u.role)}</small>
          </div>
        </div>
      </div>
    </header>
    <main class="content" id="content"></main>
  </div>`;
  render();
}

function navigate(target, options = {}) {
  if (!store.user) {
    loginScreen();
    return;
  }
  const cleanTarget = String(target || '').trim();
  const knownPages = new Set(pages.map((p) => p[0]));

  if (!knownPages.has(cleanTarget) || !store.can(cleanTarget)) {
    forbiddenAttempt = cleanTarget || 'unknown';
    page = 'forbidden';
    document.body.classList.remove('menu-open');
    $('.sidebar')?.classList.remove('open');
    $$('.nav-item').forEach((n) => {
      n.classList.remove('active');
      n.setAttribute('aria-current', 'false');
    });
    if (!options.fromHash) {
      window.location.hash = `#/${cleanTarget || '403'}`;
    }
    const bc = $('#topbar-breadcrumb');
    if (bc) bc.innerHTML = renderBreadcrumb();
    render();
    window.scrollTo(0, 0);
    return;
  }

  forbiddenAttempt = '';
  page = cleanTarget;
  filters = {};
  pagination = {};
  apiState.productError = '';
  apiState.stockMovementError = '';
  apiState.purchaseError = '';
  apiState.stockAuditError = '';
  document.body.classList.remove('menu-open');
  $('.sidebar')?.classList.remove('open');
  $$('.nav-item').forEach((n) => {
    const active = n.dataset.page === page;
    n.classList.toggle('active', active);
    n.setAttribute('aria-current', active ? 'page' : 'false');
  });
  if (!options.fromHash && getRouteFromHash() !== page) {
    window.location.hash = `#/${page}`;
  }
  const bc = $('#topbar-breadcrumb');
  if (bc) bc.innerHTML = renderBreadcrumb();
  if (page === 'products') {
    loadCatalogMeta();
    loadProductsData(true);
  } else if (page === 'suppliers') {
    loadSuppliersData(true);
  } else if (page === 'inventory') {
    loadProductsData(true);
    if (inventoryTab === 'movements') loadStockMovementsData(true);
    if (inventoryTab === 'audits') loadStockAuditsData(true);
  } else if (page === 'purchases') {
    loadCatalogMeta();
    loadProductsData(true);
    loadPurchasesData(true);
  }
  render();
  window.scrollTo(0, 0);
}

function render() {
  if (!store.user) {
    loginScreen();
    return;
  }
  const focused = document.activeElement?.id,
    selection = document.activeElement?.selectionStart;
  const views = {
    dashboard: dashboardView,
    pos: posView,
    products: productsView,
    orders: ordersView,
    inventory: inventoryView,
    purchases: purchasesView,
    suppliers: () => entitiesView('suppliers'),
    customers: () => entitiesView('customers'),
    staff: staffView,
    returns: returnsView,
    reports: reportsView,
    branches: branchesView,
    settings: settingsView,
    'audit-logs': auditLogsView,
    forbidden: () => forbiddenView(forbiddenAttempt),
  };
  const viewFn = views[page] || (() => forbiddenView(page));
  $('#content').innerHTML =
    viewFn() +
    `<footer class="footer">RetailFlow · Quản lý cửa hàng bán lẻ &nbsp;·&nbsp; ${e(store.data.settings.name)}</footer>`;
  const bc = $('#topbar-breadcrumb');
  if (bc) bc.innerHTML = renderBreadcrumb();
  if (focused) {
    const el = document.getElementById(focused);
    if (el) {
      el.focus();
      if (selection != null && el.setSelectionRange)
        try {
          el.setSelectionRange(selection, selection);
        } catch {}
    }
  }
}

window.addEventListener('hashchange', () => {
  if (!store.user) return;
  const target = getRouteFromHash();
  if (!target) return;
  if (target !== page && !(page === 'forbidden' && target === forbiddenAttempt)) {
    navigate(target, { fromHash: true });
  }
});

function globalSearch(query) {
  let container = $('#global-results');
  if (!query.trim()) {
    container?.remove();
    return;
  }
  if (!container) {
    container = document.createElement('div');
    container.id = 'global-results';
    $('.global-search').append(container);
  }
  container.hidden = false;
  container.className = 'search-results';
  const targets = pages
    .filter((p) => store.can(p[0]) && match(p[1], query))
    .map(
      ([key, label, ico]) =>
        `<button type="button" data-action="navigate" data-page="${key}">${icon(ico)}${e(label)}</button>`,
    );
  if (store.can('orders'))
    store.data.orders
      .filter((o) => match(`${o.id} ${o.customer}`, query))
      .slice(0, 4)
      .forEach((o) =>
        targets.push(
          `<button type="button" data-action="order-detail" data-id="${e(o.id)}">${icon('receipt')}<span>${e(o.id)}<small class="sub"> · ${e(o.customer)} · ${money(o.total)}</small></span></button>`,
        ),
      );
  if (store.can('pos'))
    store.data.products
      .filter((p) => p.active && match(`${p.name} ${p.barcode}`, query))
      .slice(0, 4)
      .forEach((p) =>
        targets.push(
          `<button type="button" data-action="search-product" data-id="${e(p.id)}">${e(p.icon)} ${e(p.name)} · ${money(p.price)}</button>`,
        ),
      );
  container.innerHTML =
    targets.slice(0, 10).join('') ||
    '<div class="sub" style="padding:12px">Không tìm thấy kết quả phù hợp.</div>';
}
