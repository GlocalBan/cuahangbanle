/* M2 + M3 + Phase 2: Xử lý sự kiện Kho, Cận date & Hủy hàng, Thẻ kho, Kiểm kê mù/2 vòng, PO 2 chiều, GRN, Công nợ & Cổng NCC. */
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
      else if (inventoryTab === 'near-expiry') loadNearExpiryData(true);
      else if (inventoryTab === 'stock') loadProductsData(true);
      render();
      break;

    case 'purchases-tab':
      purchasesTab = a.tab || 'pos';
      if (purchasesTab === 'grns') loadGrnsData(true);
      else if (purchasesTab === 'payables') loadPayablesData(true);
      else if (purchasesTab === 'supplier-returns') loadSupplierReturnsData(true);
      else loadPurchasesData(true);
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

    // ─── PHASE 2: NEAR-EXPIRY & WRITE-OFFS ───────────────────────────────────
    case 'writeoff-new':
      Promise.resolve(writeOffModal(a.batchId || '')).catch((err) => notify(err.message, true));
      break;

    case 'writeoff-approve': {
      const wid = a.id;
      confirmation(
        `Duyệt xuất hủy hàng ${e(wid)}?`,
        `Hệ thống sẽ trừ tồn lô, đồng bộ tồn sản phẩm và ghi <strong>Thẻ kho (HUY_HANG)</strong> trong 1 Transaction nguyên tử.`,
        async () => {
          await api.approveWriteOff(wid);
          notify(`Đã duyệt phiếu xuất hủy ${wid}.`);
          await Promise.all([loadNearExpiryData(true), loadProductsData(true), loadStockMovementsData(true)]);
        },
      );
      break;
    }

    case 'writeoff-cancel': {
      const wid = a.id;
      confirmation(
        `Hủy phiếu xuất hủy ${e(wid)}?`,
        `Phiếu <strong>${e(wid)}</strong> sẽ chuyển sang trạng thái Đã hủy và không trừ tồn lô.`,
        async () => {
          await api.cancelWriteOff(wid, 'Hủy phiếu chờ duyệt');
          notify(`Đã hủy phiếu xuất hủy ${wid}.`);
          await loadNearExpiryData(true);
        },
      );
      break;
    }

    // ─── M3 + PHASE 2: STOCK AUDITS (BLIND COUNT, ROUND 2, APPROVAL) ─────────
    case 'audit-new':
      Promise.resolve(auditModal()).catch((err) => notify(err.message, true));
      break;

    case 'audit-new-blind':
      Promise.resolve(blindAuditModal()).catch((err) => notify(err.message, true));
      break;

    case 'audit-count':
      Promise.resolve(auditCountModal(a.id, false)).catch((err) => notify(err.message, true));
      break;

    case 'audit-recount':
      Promise.resolve(auditCountModal(a.id, true)).catch((err) => notify(err.message, true));
      break;

    case 'audit-print':
      Promise.resolve(printAuditReport(a.id)).catch((err) => notify(err.message, true));
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
      const reasonCode = String($('#audit-reason-code-input')?.value || '').trim().toUpperCase();
      const reason = String($('#audit-reason-input')?.value || '').trim();
      const diff = actualQty - Number(prod.stockQty || 0);
      if (diff !== 0 && !reasonCode && reason.length < 3) {
        throw new Error('Có chênh lệch tồn kho: vui lòng chọn Mã lý do chuẩn hoặc nhập Lý do chênh lệch (tối thiểu 3 ký tự).');
      }
      if (diff !== 0 && reasonCode === 'KHAC' && reason.length < 3) {
        throw new Error('Chọn mã KHAC: vui lòng nhập mô tả cụ thể tối thiểu 3 ký tự.');
      }
      auditLines.push({
        productId: prod.id,
        sku: prod.sku,
        name: prod.name,
        systemQty: Number(prod.stockQty || 0),
        actualQty,
        reasonCode,
        reason,
      });
      if ($('#audit-reason-input')) $('#audit-reason-input').value = '';
      if ($('#audit-reason-code-input')) $('#audit-reason-code-input').value = '';
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
        `Hệ thống sẽ tự đối chiếu biến động phát sinh sau chốt sổ, điều chỉnh tồn kho thực tế cho phiếu <strong>${e(aid)}</strong>, ghi <strong>Thẻ kho (KIEM_KE)</strong> và <strong>Audit Log</strong> trong cùng 1 Transaction.`,
        async () => {
          const res = await api.approveStockAudit(aid);
          notify(`Đã duyệt kiểm kê ${res.item.id} và cập nhật tồn kho thành công.`);
          await Promise.all([loadStockAuditsData(true), loadProductsData(true), loadStockMovementsData(true)]);
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

    // ─── M3 + PHASE 2: TWO-WAY PO, GRN, PAYABLES, SUPPLIER RETURNS & PORTAL ─
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
      Promise.resolve(purchaseDetail(a.id, false)).catch((err) => notify(err.message, true));
      break;

    case 'purchase-send': {
      const pid = a.id;
      confirmation(
        `Gửi đơn đặt hàng ${e(pid)} cho Nhà cung cấp?`,
        `Đơn đặt hàng <strong>${e(pid)}</strong> sẽ chuyển từ Nháp sang <strong>Đã gửi NCC (GuiNCC)</strong> và xuất hiện trên Cổng Nhà cung cấp để xác nhận hoặc thương lượng.`,
        async () => {
          await api.sendPurchaseToSupplier(pid, { note: 'Gửi đơn đặt hàng cho NCC xác nhận' });
          notify(`Đã gửi đơn đặt hàng ${pid} tới Cổng Nhà cung cấp.`);
          await loadPurchasesData(true);
        },
      );
      break;
    }

    case 'purchase-counter':
      Promise.resolve(supplierRespondModal(a.id, true)).catch((err) => notify(err.message, true));
      break;

    case 'purchase-agree': {
      const pid = a.id;
      confirmation(
        `Chốt thống nhất điều khoản PO ${e(pid)}?`,
        `Đơn hàng <strong>${e(pid)}</strong> sẽ chuyển sang trạng thái <strong>Đã thống nhất (DaThongNhat)</strong> để kho tiến hành lập Phiếu nhận hàng (GRN).`,
        async () => {
          await api.agreePurchase(pid, { note: 'Cửa hàng chốt thống nhất điều khoản đặt hàng' });
          notify(`Đã chốt thống nhất PO ${pid}. Có thể lập phiếu nhận hàng (GRN).`);
          await loadPurchasesData(true);
        },
      );
      break;
    }

    case 'grn-new':
      Promise.resolve(createGrnModal(a.purchaseId || '')).catch((err) => notify(err.message, true));
      break;

    case 'grn-confirm': {
      const gid = a.id;
      confirmation(
        `Duyệt phiếu nhận hàng ${e(gid)}?`,
        `Hệ thống sẽ cộng tồn kho, tạo lô HSD, cập nhật giá vốn bình quân, ghi Thẻ kho (<code>NHAP_KHO</code>) và tự động tạo công nợ phải trả NCC cho phiếu <strong>${e(gid)}</strong> trong 1 Transaction.`,
        async () => {
          await api.confirmGrn(gid);
          notify(`Đã duyệt phiếu nhận hàng ${gid} và tạo công nợ NCC.`);
          await Promise.all([
            loadGrnsData(true),
            loadPurchasesData(true),
            store.hasPermission('PAYABLE_MANAGE') ? loadPayablesData(true) : Promise.resolve(),
            loadProductsData(true),
            loadStockMovementsData(true),
          ]);
        },
      );
      break;
    }

    case 'payable-pay':
      Promise.resolve(payablePayModal(a.id)).catch((err) => notify(err.message, true));
      break;

    case 'supret-new':
      Promise.resolve(supplierReturnModal()).catch((err) => notify(err.message, true));
      break;

    case 'supret-approve': {
      const srid = a.id;
      confirmation(
        `Duyệt phiếu trả hàng NCC ${e(srid)}?`,
        `Hệ thống sẽ trừ tồn lô hàng, ghi Thẻ kho <code>TRA_NCC</code> và tự động giảm trừ công nợ NCC tương ứng trong 1 Transaction.`,
        async () => {
          await api.approveSupplierReturn(srid);
          notify(`Đã duyệt phiếu trả hàng NCC ${srid}.`);
          await Promise.all([
            loadSupplierReturnsData(true),
            store.hasPermission('PAYABLE_MANAGE') ? loadPayablesData(true) : Promise.resolve(),
            loadProductsData(true),
            loadStockMovementsData(true),
          ]);
        },
      );
      break;
    }

    case 'portal-refresh':
      loadSupplierPortalData(true);
      break;

    case 'portal-detail':
      Promise.resolve(purchaseDetail(a.id, true)).catch((err) => notify(err.message, true));
      break;

    case 'portal-respond':
      Promise.resolve(supplierRespondModal(a.id, false)).catch((err) => notify(err.message, true));
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
      const expiryDate = String($('#purchase-expiry')?.value || '').trim();
      const mfgDate = String($('#purchase-mfg')?.value || '').trim();
      const batchCode = String($('#purchase-batch')?.value || '').trim();
      if (p.hasExpiry !== false && !expiryDate) {
        throw new Error(`Sản phẩm "${p.name}" có quản lý HSD: vui lòng chọn Hạn sử dụng (*).`);
      }
      purchaseLines.push({
        productId: p.id,
        sku: p.sku,
        name: p.name,
        unitName: p.unitName || '',
        qty,
        unitCost,
        expiryDate,
        mfgDate,
        batchCode,
        hasExpiry: p.hasExpiry !== false,
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
            `Phiếu <strong>${e(pid)}</strong> sẽ chuyển sang trạng thái <strong>Đã nhập kho (Confirmed)</strong>. Trong cùng 1 Transaction, hệ thống sẽ cộng <strong>Tồn hiện tại</strong>, tính lại <strong>Giá vốn bình quân gia quyền</strong>, ghi <strong>Thẻ kho (NHAP_KHO)</strong>, tạo công nợ NCC và khóa phiếu.${zeroCostWarning}`,
            async () => {
              const res = await api.confirmPurchase(pid);
              notify(`Đã duyệt nhập kho phiếu ${res.item.id} thành công (tồn kho & giá vốn đã cập nhật).`);
              await Promise.all([
                loadPurchasesData(true),
                loadProductsData(true),
                loadStockMovementsData(true),
                store.hasPermission('PAYABLE_MANAGE') ? loadPayablesData(true) : Promise.resolve(),
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
