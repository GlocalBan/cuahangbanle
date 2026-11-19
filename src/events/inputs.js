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
    } else if (el.dataset.filter === 'promotions') {
      clearTimeout(window.__promotionsSearchTimer);
      window.__promotionsSearchTimer = setTimeout(() => loadPromotionsData(true), 220);
    } else if (el.dataset.filter === 'customers') {
      clearTimeout(window.__customersSearchTimer);
      window.__customersSearchTimer = setTimeout(() => loadCustomersData(true), 220);
    } else if (el.dataset.filter === 'orders') {
      clearTimeout(window.__ordersSearchTimer);
      window.__ordersSearchTimer = setTimeout(() => loadOrdersData(true), 220);
    } else if (el.dataset.filter === 'returns') {
      clearTimeout(window.__returnsSearchTimer);
      window.__returnsSearchTimer = setTimeout(() => loadReturnsData(true), 220);
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
  if (el.id === 'pos-promo-code') {
    posCart.promotionCode = el.value.toUpperCase();
  }
  if (el.id === 'cart-note') {
    posCart.note = el.value;
  }
  if (el.dataset.input === 'cart-direct-qty') {
    const qty = Math.max(1, Number(el.value) || 1);
    const prod = (apiState.products || []).find((p) => p.id === el.dataset.id);
    const max = prod ? Number(prod.stockQty) : 999;
    const finalQty = Math.min(max, qty);
    el.value = finalQty;
    const item = posCart.items.find((i) => i.productId === el.dataset.id);
    if (item) {
      item.qty = finalQty;
      render();
    }
  }
  if (el.dataset.input === 'cart-line-discount') {
    const item = posCart.items.find((i) => i.productId === el.dataset.id);
    if (item) {
      const lineGross = Number(item.qty) * Number(item.salePrice);
      const raw = Math.max(0, Math.round(Number(el.value) || 0));
      item.lineDiscount = Math.min(lineGross, raw);
      render();
    }
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
      } else if (el.dataset.filter === 'promoStatus') {
        loadPromotionsData(true);
      } else if (el.dataset.filter === 'customerStatus') {
        loadCustomersData(true);
      } else if (['orderStatus', 'orderPayment', 'orderFrom', 'orderTo'].includes(el.dataset.filter)) {
        loadOrdersData(true);
      } else if (['returnStatus', 'returnFrom', 'returnTo'].includes(el.dataset.filter)) {
        loadReturnsData(true);
      } else if (['reportFrom', 'reportTo', 'reportCategory', 'reportGroupBy'].includes(el.dataset.filter)) {
        loadReportsData(true);
      } else {
        render();
      }
    }
    if (el.id === 'cart-note') {
      posCart.note = el.value;
    }
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
  } catch (error) {
    notify(error.message, true);
    if (['cart-discount', 'cart-note', 'cart-customer'].includes(el.id)) render();
  }
});
