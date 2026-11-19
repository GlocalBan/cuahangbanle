document.addEventListener('input', (event) => {
  const el = event.target;
  if (el.dataset.filter && el.tagName === 'INPUT' && el.type !== 'date') {
    filters[el.dataset.filter] = el.value;
    pagination = {};
    if (el.dataset.filter === 'auditSearch') {
      clearTimeout(window.__auditSearchTimer);
      window.__auditSearchTimer = setTimeout(() => loadAuditLogsData(true), 220);
    } else if (['products', 'productMinPrice', 'productMaxPrice'].includes(el.dataset.filter)) {
      clearTimeout(window.__productsSearchTimer);
      window.__productsSearchTimer = setTimeout(() => loadProductsData(true), 220);
    } else if (el.dataset.filter === 'moveSearch') {
      clearTimeout(window.__moveSearchTimer);
      window.__moveSearchTimer = setTimeout(() => loadStockMovementsData(true), 220);
    } else if (el.dataset.filter === 'purchases') {
      clearTimeout(window.__purchasesSearchTimer);
      window.__purchasesSearchTimer = setTimeout(() => loadPurchasesData(true), 220);
    } else if (el.dataset.filter === 'auditListSearch') {
      clearTimeout(window.__auditListSearchTimer);
      window.__auditListSearchTimer = setTimeout(() => loadStockAuditsData(true), 220);
    } else {
      render();
    }
  }
  if (el.dataset.auditField === 'reason') {
    const line = auditLines[Number(el.dataset.index)];
    if (line) line.reason = el.value;
  }
  if (el.id === 'global-search') globalSearch(el.value);
  if (el.id === 'cash-input') updateCash();
  if (el.dataset.input === 'cart-direct-qty') {
    const qty = Math.max(1, Number(el.value) || 1);
    const prod = store.data.products.find((p) => p.id === el.dataset.id);
    const max = prod ? prod.stock : 999;
    const finalQty = Math.min(max, qty);
    el.value = finalQty;
    changeDraft((d) => {
      const item = d.items.find((i) => i.id === el.dataset.id);
      if (item) item.qty = finalQty;
    });
  }
  if (el.id === 'customer-phone-search') {
    try {
      searchCustomerPhone(el);
    } catch (error) {
      notify(error.message, true);
    }
  }
});
document.addEventListener('change', async (event) => {
  const el = event.target;
  try {
    if (el.dataset.filter && (el.tagName === 'SELECT' || el.type === 'date')) {
      filters[el.dataset.filter] = el.value;
      pagination = {};
      if (['auditAction', 'auditFrom', 'auditTo'].includes(el.dataset.filter)) {
        loadAuditLogsData(true);
      } else if (['productCategory', 'productSupplier', 'productStatus', 'productStock'].includes(el.dataset.filter)) {
        loadProductsData(true);
      } else if (['moveDocType', 'moveFrom', 'moveTo'].includes(el.dataset.filter)) {
        loadStockMovementsData(true);
      } else if (['purchaseSupplier', 'purchaseStatus', 'purchaseFrom', 'purchaseTo'].includes(el.dataset.filter)) {
        loadPurchasesData(true);
      } else if (['auditListStatus', 'auditListFrom', 'auditListTo'].includes(el.dataset.filter)) {
        loadStockAuditsData(true);
      } else {
        render();
      }
    }
    if (el.id === 'promo-select' || el.dataset.input === 'pos-select-promotion') {
      changeDraft((d) => {
        d.promotionId = el.value || null;
      });
    }
    if (el.id === 'cart-discount') {
      const value = Number(el.value);
      changeDraft((d) => {
        totals(d.items, value, store.data.settings.taxRate);
        d.discount = value;
      });
    }
    if (el.id === 'cart-note') changeDraft((d) => (d.note = el.value));
    if (el.id === 'purchase-supplier') updatePurchaseOptions(true);
    if (el.id === 'purchase-product') {
      const prod = (apiState.products || []).find((p) => p.id === el.value);
      if ($('#purchase-price')) $('#purchase-price').value = prod ? Number(prod.costPrice || 0) : 0;
    }
    if (el.id === 'audit-product-select') {
      const prod = (apiState.products || []).find((p) => p.id === el.value);
      if ($('#audit-actual-input') && prod) $('#audit-actual-input').value = Number(prod.stockQty || 0);
    }
    if (el.dataset.purchaseField) {
      const key = el.dataset.purchaseField,
        line = purchaseLines[Number(el.dataset.index)];
      if (!line || !['qty', 'unitCost', 'price'].includes(key))
        throw new Error('Mặt hàng không còn trong phiếu.');
      const value = Number(el.value),
        minimum = key === 'qty' ? 1 : 0;
      if (!el.value.trim() || !Number.isSafeInteger(value) || value < minimum) {
        el.value = line[key];
        throw new Error(
          key === 'qty'
            ? 'Số lượng nhập phải là số nguyên lớn hơn 0.'
            : 'Đơn giá nhập phải là số nguyên không âm.',
        );
      }
      line[key] = value;
      renderPurchaseLines();
    }
    if (el.dataset.auditField === 'actualQty') {
      const line = auditLines[Number(el.dataset.index)];
      if (!line) throw new Error('Dòng kiểm kê không tồn tại.');
      const value = Number(el.value);
      if (!el.value.trim() || !Number.isSafeInteger(value) || value < 0) {
        el.value = line.actualQty;
        throw new Error('Tồn thực tế phải là số nguyên không âm (>= 0).');
      }
      line.actualQty = value;
      renderAuditLines();
    }
    if (el.id === 'report-period') {
      reportDays = Number(el.value);
      render();
    }
    if (el.id === 'restore-file' && el.files.length) {
      store.admin();
      const file = el.files[0];
      if (file.size > 20 * 1024 * 1024) throw new Error('Tệp sao lưu quá lớn (tối đa 20 MB).');
      const value = JSON.parse(await file.text());
      Retail.validateBackup(value);
      confirmation(
        'Khôi phục bản sao lưu?',
        `Tệp <strong>${e(file.name)}</strong> có ${value.orders.length} hóa đơn và ${value.products.length} sản phẩm. Dữ liệu hiện tại sẽ được thay thế. Hãy tải bản sao lưu hiện tại trước khi xác nhận.`,
        () => {
          store.importBackup(value);
          if (store.user) {
            shell();
          } else {
            sessionStorage.removeItem('retailflow-user');
            loginScreen();
          }
          notify('Đã khôi phục dữ liệu từ bản sao lưu.');
        },
      );
      el.value = '';
    }
  } catch (error) {
    notify(error.message, true);
    if (['cart-discount', 'cart-note', 'cart-customer'].includes(el.id)) render();
    if (el.id === 'restore-file') el.value = '';
  }
});
