/* M2 + M3: Xử lý sự kiện Nhập hàng, Thẻ kho & Kiểm kê kho (API SQLite). */
'use strict';

function handleInventoryAction(a) {
  switch (a.action) {
    case 'inventory-tab':
      inventoryTab = a.tab;
      filters = {};
      pagination = {};
      apiState.stockMovementError = '';
      apiState.stockAuditError = '';
      if (inventoryTab === 'movements') loadStockMovementsData(true);
      else if (inventoryTab === 'audits') loadStockAuditsData(true);
      else if (inventoryTab === 'stock') loadProductsData(true);
      render();
      break;

    case 'stock-movements-page': {
      const nextPage = Math.max(1, (pagination['stock-movements'] || 1) + Number(a.delta || 0));
      pagination['stock-movements'] = nextPage;
      loadStockMovementsData(true);
      break;
    }

    case 'stock-movements-reset':
      delete filters.moveSearch;
      delete filters.moveDocType;
      delete filters.moveFrom;
      delete filters.moveTo;
      apiState.stockMovementError = '';
      pagination['stock-movements'] = 1;
      loadStockMovementsData(true);
      break;

    case 'stock-audits-reset':
      delete filters.auditListSearch;
      delete filters.auditListStatus;
      delete filters.auditListFrom;
      delete filters.auditListTo;
      apiState.stockAuditError = '';
      pagination.audits = 1;
      loadStockAuditsData(true);
      break;

    case 'purchases-reset':
      delete filters.purchases;
      delete filters.purchaseSupplier;
      delete filters.purchaseStatus;
      delete filters.purchaseFrom;
      delete filters.purchaseTo;
      apiState.purchaseError = '';
      pagination.purchases = 1;
      loadPurchasesData(true);
      break;

    // ─── M3: STOCK AUDITS (BR-06) ────────────────────────────────────────────
    case 'audit-new':
      Promise.resolve(auditModal()).catch((err) => notify(err.message, true));
      break;

    case 'audit-line-add': {
      const prodId = $('#audit-product-select')?.value;
      const prod = (apiState.products || []).find((p) => p.id === prodId);
      if (!prod) throw new Error('Vui lòng chọn sản phẩm hợp lệ.');
      if (auditLines.some((l) => l.productId === prod.id)) {
        throw new Error(`Sản phẩm ${prod.sku} đã có trong phiếu kiểm kê.`);
      }
      const actualQty = Number($('#audit-actual-input')?.value);
      if (!Number.isSafeInteger(actualQty) || actualQty < 0) {
        throw new Error('Số lượng tồn thực tế phải là số nguyên không âm (>= 0).');
      }
      const reason = String($('#audit-reason-input')?.value || '').trim();
      const diff = actualQty - Number(prod.stockQty || 0);
      if (diff !== 0 && reason.length < 3) {
        throw new Error('Có chênh lệch tồn kho: vui lòng nhập Lý do chênh lệch (tối thiểu 3 ký tự) theo BR-06.');
      }
      auditLines.push({
        productId: prod.id,
        sku: prod.sku,
        name: prod.name,
        systemQty: Number(prod.stockQty || 0),
        actualQty,
        reason,
      });
      if ($('#audit-reason-input')) $('#audit-reason-input').value = '';
      renderAuditLines();
      break;
    }

    case 'audit-line-delete':
      auditLines.splice(Number(a.index), 1);
      renderAuditLines();
      break;

    case 'audit-detail':
      Promise.resolve(auditDetailModal(a.id)).catch((err) => notify(err.message, true));
      break;

    case 'audit-approve': {
      const aid = a.id;
      confirmation(
        `Duyệt phiếu kiểm kê ${e(aid)}?`,
        `Hệ thống sẽ điều chỉnh tồn kho thực tế cho các sản phẩm có chênh lệch trong phiếu <strong>${e(aid)}</strong>, ghi <strong>Thẻ kho (KIEM_KE)</strong> và <strong>Audit Log</strong> trong cùng 1 Transaction. Hành động không thể hoàn tác.`,
        async () => {
          const res = await api.approveStockAudit(aid);
          notify(`Đã duyệt kiểm kê ${res.item.id} và cập nhật tồn kho thành công.`);
          await Promise.all([
            loadStockAuditsData(true),
            loadProductsData(true),
            loadStockMovementsData(true),
          ]);
        },
      );
      break;
    }

    case 'audit-cancel': {
      const aid = a.id;
      confirmation(
        `Hủy phiếu kiểm kê ${e(aid)}?`,
        `Phiếu kiểm kê <strong>${e(aid)}</strong> sẽ chuyển sang trạng thái <strong>Đã hủy (DaHuy)</strong> và không làm thay đổi tồn kho.`,
        async () => {
          await api.cancelStockAudit(aid, 'Quản lý hủy phiếu kiểm kê chưa duyệt');
          notify(`Đã hủy phiếu kiểm kê ${aid}.`);
          await loadStockAuditsData(true);
        },
      );
      break;
    }

    // ─── M3: PURCHASES (BR-02) ───────────────────────────────────────────────
    case 'purchase-new':
      Promise.resolve(purchaseModal()).catch((err) => notify(err.message, true));
      break;

    case 'purchase-restock':
      Promise.resolve(purchaseModal(a.id)).catch((err) => notify(err.message, true));
      break;

    case 'purchase-edit':
      Promise.resolve(purchaseModal('', a.id)).catch((err) => notify(err.message, true));
      break;

    case 'purchase-add-suggestion':
      addSuggestedPurchase(a.id);
      break;

    case 'purchase-detail':
      Promise.resolve(purchaseDetail(a.id)).catch((err) => notify(err.message, true));
      break;

    case 'purchase-line-add': {
      const prodId = $('#purchase-product')?.value;
      const p = (apiState.products || []).find((x) => x.id === prodId && x.status === 'DangKinhDoanh');
      if (!p) throw new Error('Nhà cung cấp này chưa có sản phẩm đang kinh doanh.');
      const qty = Number($('#purchase-qty')?.value);
      const unitCost = Number($('#purchase-price')?.value);
      if (!Number.isSafeInteger(qty) || qty < 1) {
        throw new Error('Số lượng nhập phải là số nguyên dương lớn hơn 0 (BR-02).');
      }
      if (!Number.isSafeInteger(unitCost) || unitCost < 0) {
        throw new Error('Đơn giá nhập phải là số nguyên không âm (>= 0) (BR-02).');
      }
      if (purchaseLines.some((i) => i.productId === p.id)) {
        throw new Error(`Sản phẩm ${p.sku} đã có trong phiếu. Hãy sửa trực tiếp trên dòng hoặc xóa dòng cũ.`);
      }
      purchaseLines.push({
        productId: p.id,
        sku: p.sku,
        name: p.name,
        unitName: p.unitName || '',
        qty,
        unitCost,
      });
      renderPurchaseLines();
      break;
    }

    case 'purchase-line-delete':
      purchaseLines.splice(Number(a.index), 1);
      renderPurchaseLines();
      break;

    case 'purchase-confirm': {
      const pid = a.id;
      Promise.resolve(api.getPurchase(pid))
        .then((detailRes) => {
          const po = detailRes?.item;
          const zeroCostItems = (po?.items || []).filter((i) => Number(i.unitCost) === 0);
          const zeroCostWarning = zeroCostItems.length
            ? `<div class="note yellow mt16"><strong>Cảnh báo đơn giá nhập 0 ₫:</strong> Phiếu có ${zeroCostItems.length} dòng hàng đơn giá <strong>0 ₫</strong> (${zeroCostItems.map((i) => `${e(i.sku)} · ${e(i.productName)} (×${number(i.qty)})`).join(', ')}). Nếu không phải hàng tặng kèm/khuyến mãi, hãy kiểm tra lại vì đơn giá 0 ₫ sẽ làm giảm giá vốn bình quân gia quyền.</div>`
            : '';
          confirmation(
            `Duyệt xác nhận nhập kho phiếu ${e(pid)}?`,
            `Phiếu <strong>${e(pid)}</strong> sẽ chuyển sang trạng thái <strong>Đã nhập kho (Confirmed)</strong>. Trong cùng 1 Transaction, hệ thống sẽ cộng <strong>Tồn hiện tại</strong>, tính lại <strong>Giá vốn bình quân gia quyền</strong>, ghi <strong>Thẻ kho (NHAP_KHO)</strong> và khóa chỉnh sửa phiếu.${zeroCostWarning}`,
            async () => {
              const res = await api.confirmPurchase(pid);
              notify(`Đã duyệt nhập kho phiếu ${res.item.id} thành công (tồn kho & giá vốn đã cập nhật).`);
              await Promise.all([
                loadPurchasesData(true),
                loadProductsData(true),
                loadStockMovementsData(true),
              ]);
            },
          );
        })
        .catch((err) => notify(err.message, true));
      break;
    }

    case 'purchase-cancel':
    case 'cancel-purchase': {
      const pid = a.id;
      confirmation(
        `Hủy phiếu nhập nháp ${e(pid)}?`,
        `Phiếu nhập <strong>${e(pid)}</strong> đang ở trạng thái Nháp sẽ chuyển sang <strong>Đã hủy (Cancelled)</strong> và không ảnh hưởng tồn kho.`,
        async () => {
          await api.cancelPurchase(pid, 'Hủy phiếu nháp bởi Quản lý');
          notify(`Đã hủy phiếu nhập ${pid}.`);
          await loadPurchasesData(true);
        },
      );
      break;
    }

    default:
      return false;
  }
  return true;
}
