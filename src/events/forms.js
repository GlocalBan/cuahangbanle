/* Form submit dispatcher (M1–M5 + Phase 2) with unified .btn-loading feedback. */
'use strict';

function setSubmitLoading(btn, isLoading) {
  if (!btn) return;
  btn.disabled = Boolean(isLoading);
  btn.classList.toggle('btn-loading', Boolean(isLoading));
}

document.addEventListener('submit', async (event) => {
  const form = event.target;
  if (!form.id) return;
  event.preventDefault();
  const v = dataForm(form);
  const submitBtn = form.querySelector('button[type="submit"]');
  try {
    switch (form.id) {
      case 'login-form': {
        setSubmitLoading(submitBtn, true);
        try {
          const res = await api.login(v.username.trim(), v.password);
          setAuthToken(res.token);
          resetApiCaches();
          productsTab = 'products';
          inventoryTab = 'stock';
          promotionsTab = 'promotions';
          purchasesTab = 'pos';
          store.setAuthenticatedUser(res.user);
          try {
            const cfg = await api.getStoreConfig();
            syncStoreSettingsFromServer(cfg.storeConfig);
          } catch {}
          const defaultPage = (ACCESS[res.user.role] || ['pos'])[0];
          forbiddenAttempt = '';
          page = defaultPage;
          window.location.hash = `#/${defaultPage}`;
          shell();
          notify(`Chào ${res.user.fullName}, đăng nhập thành công (${res.user.roleShortName}).`);
        } finally {
          setSubmitLoading(submitBtn, false);
        }
        break;
      }
      case 'change-password-form': {
        if (v.newPassword !== v.confirmPassword) {
          throw new Error('Xác nhận mật khẩu mới không khớp.');
        }
        setSubmitLoading(submitBtn, true);
        try {
          await api.changePassword({
            currentPassword: v.currentPassword,
            newPassword: v.newPassword,
            confirmPassword: v.confirmPassword,
          });
          closeModal();
          notify('Đổi mật khẩu thành công. Nhật ký kiểm toán đã ghi nhận.');
        } finally {
          setSubmitLoading(submitBtn, false);
        }
        break;
      }
      case 'staff-api-form': {
        setSubmitLoading(submitBtn, true);
        try {
          const payload = {
            fullName: (v.fullName || '').trim(),
            username: (v.username || '').trim(),
            phone: (v.phone || '').trim(),
            email: (v.email || '').trim(),
            role: v.role,
            status: v.status,
          };
          if (v.password) payload.password = v.password;
          if (modalContext.id) {
            await api.updateStaff(modalContext.id, payload);
            notify('Đã cập nhật thông tin nhân viên và ghi Audit Log.');
          } else {
            await api.createStaff(payload);
            notify('Đã tạo tài khoản nhân viên mới (mật khẩu đã băm bảo mật).');
          }
          closeModal();
          await loadStaffData(true);
        } finally {
          setSubmitLoading(submitBtn, false);
        }
        break;
      }
      case 'tham-so-form': {
        setSubmitLoading(submitBtn, true);
        try {
          const updates = Object.entries(v).map(([maThamSo, giaTri]) => ({
            maThamSo,
            giaTri,
          }));
          const res = await api.updateThamSo(updates);
          apiState.thamSo = res.items || [];
          apiState.thamSoLoaded = true;
          syncStoreSettingsFromServer(res.storeConfig);
          render();
          notify('Đã lưu bảng THAM_SO vào CSDL và ghi Nhật ký kiểm toán.');
        } finally {
          setSubmitLoading(submitBtn, false);
        }
        break;
      }
      case 'product-api-form': {
        setSubmitLoading(submitBtn, true);
        try {
          const payload = {
            name: (v.name || '').trim(),
            sku: (v.sku || '').trim().toUpperCase(),
            barcode: (v.barcode || '').trim(),
            brand: (v.brand || '').trim(),
            packSize: (v.packSize || '').trim(),
            categoryCode: v.categoryCode,
            unitCode: v.unitCode,
            supplierId: v.supplierId,
            salePrice: Number(v.salePrice),
            costPrice: Number(v.costPrice),
            minStock: Number(v.minStock),
            imageUrl: v.imageUrl,
          };
          if (modalContext.id) {
            if (v.status) payload.status = v.status;
            await api.updateProduct(modalContext.id, payload);
            notify('Đã cập nhật thông tin sản phẩm vào CSDL.');
          } else {
            payload.stockQty = Number(v.stockQty || 0);
            await api.createProduct(payload);
            notify('Đã thêm sản phẩm mới và ghi Thẻ kho khởi tạo (nếu tồn > 0).');
          }
          closeModal();
          await Promise.all([loadProductsData(true), loadCatalogMeta(true)]);
        } finally {
          setSubmitLoading(submitBtn, false);
        }
        break;
      }
      case 'stock-adjust-form': {
        setSubmitLoading(submitBtn, true);
        try {
          const res = await api.adjustProductStock(modalContext.id, {
            newStock: Number(v.newStock),
            docId: (v.docId || '').trim(),
            note: (v.note || '').trim(),
          });
          closeModal();
          notify(
            `Đã điều chỉnh tồn ${res.item.sku}: ${res.movement.stockBefore} → ${res.movement.stockAfter} và ghi Thẻ kho (${res.movement.docId}).`,
          );
          await Promise.all([loadProductsData(true), loadStockMovementsData(true)]);
        } finally {
          setSubmitLoading(submitBtn, false);
        }
        break;
      }
      case 'category-api-form': {
        setSubmitLoading(submitBtn, true);
        try {
          const payload = {
            code: (v.code || '').trim().toUpperCase(),
            name: (v.name || '').trim(),
            description: (v.description || '').trim(),
          };
          if (modalContext.code) {
            await api.updateCategory(modalContext.code, payload);
            notify('Đã cập nhật danh mục hàng hóa.');
          } else {
            await api.createCategory(payload);
            notify('Đã thêm danh mục hàng hóa mới.');
          }
          closeModal();
          await loadCatalogMeta(true);
        } finally {
          setSubmitLoading(submitBtn, false);
        }
        break;
      }
      case 'unit-api-form': {
        setSubmitLoading(submitBtn, true);
        try {
          const payload = {
            code: (v.code || '').trim().toUpperCase(),
            name: (v.name || '').trim(),
          };
          if (modalContext.code) {
            await api.updateUnit(modalContext.code, payload);
            notify('Đã cập nhật đơn vị tính.');
          } else {
            await api.createUnit(payload);
            notify('Đã thêm đơn vị tính mới.');
          }
          closeModal();
          await loadCatalogMeta(true);
        } finally {
          setSubmitLoading(submitBtn, false);
        }
        break;
      }
      case 'supplier-api-form': {
        setSubmitLoading(submitBtn, true);
        try {
          const payload = {
            name: (v.name || '').trim(),
            phone: (v.phone || '').trim(),
            categoryGroup: (v.categoryGroup || '').trim(),
            areas: (v.areas || '').trim(),
          };
          if (modalContext.id) {
            if (v.status) payload.status = v.status;
            await api.updateSupplier(modalContext.id, payload);
            notify('Đã cập nhật nhà cung cấp vào CSDL.');
          } else {
            await api.createSupplier(payload);
            notify('Đã thêm nhà cung cấp mới.');
          }
          closeModal();
          await loadSuppliersData(true);
        } finally {
          setSubmitLoading(submitBtn, false);
        }
        break;
      }
      case 'checkout-form': {
        if (!posCart.items.length) {
          throw new Error('Giỏ hàng trống, không thể thanh toán.');
        }
        setSubmitLoading(submitBtn, true);
        try {
          const paymentMethod = String(v.paymentMethod || v.payment || 'CASH').toUpperCase();
          const cashVal = v.cashReceived !== undefined ? v.cashReceived : v.received;
          const mode = posCart.discountMode || 'NONE';
          const payload = {
            customerId: posCart.customerId || null,
            promotionCode: mode === 'PROMO' ? posCart.appliedPromotion?.code || '' : '',
            voucherCode: mode === 'VOUCHER' ? posCart.appliedVoucher?.code || '' : '',
            paymentMethod,
            cashReceived: paymentMethod === 'CASH' ? Number(cashVal || 0) : 0,
            paymentRef: (v.paymentRef || '').trim(),
            note: (posCart.note || '').trim(),
            items: posCart.items.map((i) => ({
              productId: i.productId,
              qty: Number(i.qty),
              lineDiscount: Math.max(0, Math.round(Number(i.lineDiscount || 0))),
            })),
          };
          const res = await api.checkoutPos(payload);
          const createdOrder = res.item;
          resetPosCart();
          closeModal();
          notify(`Thanh toán thành công hóa đơn ${createdOrder.id} · ${money(createdOrder.totalAmount)}`);
          await Promise.all([
            loadPosData(true),
            store.hasPermission('ORDER_VIEW') ? loadOrdersData(true) : Promise.resolve(),
          ]);
          await orderDetail(createdOrder.id);
        } finally {
          setSubmitLoading(submitBtn, false);
        }
        break;
      }
      case 'shift-open-form': {
        setSubmitLoading(submitBtn, true);
        try {
          const res = await api.openShift({
            openingCash: Number(v.openingCash || 0),
            note: (v.note || '').trim(),
          });
          apiState.currentShift = res.item || res.shift || null;
          apiState.currentShiftLoaded = true;
          closeModal();
          render();
          notify(`Đã mở ca bán hàng ${apiState.currentShift?.id || ''} thành công.`);
        } finally {
          setSubmitLoading(submitBtn, false);
        }
        break;
      }
      case 'shift-close-form': {
        setSubmitLoading(submitBtn, true);
        try {
          const res = await api.closeShift(modalContext.id, {
            actualCash: Number(v.actualCash || 0),
            note: (v.note || '').trim(),
          });
          const closed = res.item || res.shift;
          apiState.currentShift = null;
          apiState.currentShiftLoaded = true;
          closeModal();
          render();
          notify(
            `Đã chốt ca ${closed?.id || modalContext.id} · Chênh lệch: ${money(closed?.variance || 0)}.`,
          );
        } finally {
          setSubmitLoading(submitBtn, false);
        }
        break;
      }
      case 'promotion-api-form': {
        setSubmitLoading(submitBtn, true);
        try {
          const checkedProdIds = $$('input[name="promoProductId"]:checked', form).map((el) => el.value);
          const payload = {
            code: (v.code || '').trim().toUpperCase(),
            name: (v.name || '').trim(),
            scope: v.scope || 'INVOICE',
            categoryCode: (v.categoryCode || '').trim(),
            nearExpiryDays: Number(v.nearExpiryDays || 14),
            productIds: checkedProdIds.length ? checkedProdIds : modalContext.selectedProductIds || [],
            discountType: v.discountType,
            discountValue: Number(v.discountValue),
            maxDiscount: Number(v.maxDiscount || 0),
            minOrderAmount: Number(v.minOrderAmount || 0),
            startDate: v.startDate,
            endDate: v.endDate,
            usageLimit: Number(v.usageLimit),
            status: v.status,
          };
          if (modalContext.id) {
            await api.updatePromotion(modalContext.id, payload);
            notify(`Đã cập nhật chương trình khuyến mãi ${payload.code}.`);
          } else {
            await api.createPromotion(payload);
            notify(`Đã tạo chương trình khuyến mãi ${payload.code}.`);
          }
          closeModal();
          await loadPromotionsData(true);
        } finally {
          setSubmitLoading(submitBtn, false);
        }
        break;
      }
      case 'voucher-api-form': {
        setSubmitLoading(submitBtn, true);
        try {
          const payload = {
            code: (v.code || '').trim().toUpperCase(),
            name: (v.name || '').trim(),
            discountType: v.discountType,
            discountValue: Number(v.discountValue),
            maxDiscount: Number(v.maxDiscount || 0),
            minOrderAmount: Number(v.minOrderAmount || 0),
            startDate: v.startDate,
            endDate: v.endDate,
            usageLimit: Number(v.usageLimit),
            perCustomerLimit: Number(v.perCustomerLimit || 1),
            status: v.status,
          };
          if (modalContext.id) {
            await api.updateVoucher(modalContext.id, payload);
            notify(`Đã cập nhật Voucher ${payload.code}.`);
          } else {
            await api.createVoucher(payload);
            notify(`Đã tạo Voucher ${payload.code}.`);
          }
          closeModal();
          await loadVouchersData(true);
        } finally {
          setSubmitLoading(submitBtn, false);
        }
        break;
      }
      case 'voucher-bulk-form': {
        setSubmitLoading(submitBtn, true);
        try {
          const res = await api.bulkGenerateVouchers({
            prefix: (v.prefix || '').trim().toUpperCase(),
            quantity: Number(v.quantity),
            name: (v.name || '').trim(),
            discountType: v.discountType,
            discountValue: Number(v.discountValue),
            maxDiscount: Number(v.maxDiscount || 0),
            minOrderAmount: Number(v.minOrderAmount || 0),
            startDate: v.startDate,
            endDate: v.endDate,
            usageLimit: Number(v.usageLimit || 1),
            perCustomerLimit: Number(v.perCustomerLimit || 1),
          });
          closeModal();
          notify(`Đã phát hành hàng loạt ${res.count || (res.items || []).length} mã Voucher thành công.`);
          await loadVouchersData(true);
        } finally {
          setSubmitLoading(submitBtn, false);
        }
        break;
      }
      case 'customer-api-form': {
        setSubmitLoading(submitBtn, true);
        try {
          const payload = {
            name: (v.name || '').trim(),
            phone: (v.phone || '').trim(),
            email: (v.email || '').trim(),
          };
          if (modalContext.id) {
            if (v.status) payload.status = v.status;
            await api.updateCustomer(modalContext.id, payload);
            notify('Đã cập nhật hồ sơ khách hàng.');
          } else {
            const res = await api.createCustomer(payload);
            notify(`Đã thêm khách hàng ${res.item.name} (${res.item.id}).`);
            if (page === 'pos' && res.item) {
              posCart.customerId = res.item.id;
              customerSearchState.customerId = res.item.id;
              customerSearchState.query = '';
            }
          }
          closeModal();
          await loadCustomersData(true);
        } finally {
          setSubmitLoading(submitBtn, false);
        }
        break;
      }
      case 'purchase-api-form': {
        if (!purchaseLines.length) {
          throw new Error('Vui lòng thêm tối thiểu 1 mặt hàng vào phiếu nhập trước khi lưu (BR-02).');
        }
        setSubmitLoading(submitBtn, true);
        try {
          const payload = {
            supplierId: v.supplierId,
            note: (v.note || '').trim(),
            items: purchaseLines.map((l) => ({
              productId: l.productId,
              qty: Number(l.qty),
              unitCost: Number(l.unitCost),
              batchCode: String(l.batchCode || '').trim(),
              mfgDate: String(l.mfgDate || '').trim(),
              expiryDate: String(l.expiryDate || '').trim(),
            })),
          };
          if (modalContext.id) {
            const res = await api.updatePurchase(modalContext.id, payload);
            notify(`Đã cập nhật phiếu nhập nháp ${res.item.id}.`);
          } else {
            const res = await api.createPurchase(payload);
            notify(`Đã tạo phiếu nhập nháp ${res.item.id} (có thể Gửi NCC hoặc Duyệt nhập kho).`);
          }
          closeModal();
          await loadPurchasesData(true);
        } finally {
          setSubmitLoading(submitBtn, false);
        }
        break;
      }
      case 'portal-respond-form': {
        setSubmitLoading(submitBtn, true);
        try {
          const items = $$('[data-nego-qty]', form).map((el) => {
            const pid = el.dataset.negoQty;
            const costEl = form.querySelector(`[data-nego-cost="${pid}"]`);
            return {
              productId: pid,
              qty: Number(el.value),
              unitCost: Number(costEl?.value || 0),
            };
          });
          await api.respondPurchase(modalContext.id, {
            action: v.action,
            expectedDeliveryDate: (v.expectedDeliveryDate || '').trim(),
            note: (v.note || '').trim(),
            items,
          });
          closeModal();
          notify(`Đã gửi phản hồi (${v.action}) cho đơn đặt hàng ${modalContext.id}.`);
          await loadSupplierPortalData(true);
        } finally {
          setSubmitLoading(submitBtn, false);
        }
        break;
      }
      case 'purchase-counter-form': {
        setSubmitLoading(submitBtn, true);
        try {
          const items = $$('[data-nego-qty]', form).map((el) => {
            const pid = el.dataset.negoQty;
            const costEl = form.querySelector(`[data-nego-cost="${pid}"]`);
            return {
              productId: pid,
              qty: Number(el.value),
              unitCost: Number(costEl?.value || 0),
            };
          });
          await api.counterPurchase(modalContext.id, {
            expectedDeliveryDate: (v.expectedDeliveryDate || '').trim(),
            note: (v.note || '').trim(),
            items,
          });
          closeModal();
          notify(`Đã gửi đề xuất thương lượng lại cho PO ${modalContext.id}.`);
          await loadPurchasesData(true);
        } finally {
          setSubmitLoading(submitBtn, false);
        }
        break;
      }
      case 'grn-api-form': {
        setSubmitLoading(submitBtn, true);
        try {
          const items = $$('[data-grn-qty]', form)
            .map((el) => {
              const pid = el.dataset.grnQty;
              return {
                productId: pid,
                receivedQty: Number(el.value || 0),
                unitCost: Number(form.querySelector(`[data-grn-cost="${pid}"]`)?.value || 0),
                expiryDate: String(form.querySelector(`[data-grn-exp="${pid}"]`)?.value || '').trim(),
                batchCode: String(form.querySelector(`[data-grn-batch="${pid}"]`)?.value || '').trim(),
              };
            })
            .filter((i) => i.receivedQty > 0);
          if (!items.length) throw new Error('Vui lòng nhập số lượng nhận (> 0) cho ít nhất 1 mặt hàng.');
          const res = await api.createGrn({
            purchaseId: v.purchaseId,
            note: (v.note || '').trim(),
            items,
          });
          closeModal();
          purchasesTab = 'grns';
          notify(`Đã lập phiếu nhận hàng ${res.item.id} (Chờ Quản lý duyệt nhập kho).`);
          await Promise.all([loadGrnsData(true), loadPurchasesData(true)]);
        } finally {
          setSubmitLoading(submitBtn, false);
        }
        break;
      }
      case 'payable-pay-form': {
        setSubmitLoading(submitBtn, true);
        try {
          const res = await api.recordSupplierPayment(modalContext.id, {
            amount: Number(v.amount),
            paymentMethod: v.paymentMethod,
            paymentRef: (v.paymentRef || '').trim(),
            note: (v.note || '').trim(),
          });
          closeModal();
          notify(`Đã ghi nhận chi ${money(Number(v.amount))} · Dư nợ còn ${money(res.item.balanceAmount)}.`);
          await loadPayablesData(true);
        } finally {
          setSubmitLoading(submitBtn, false);
        }
        break;
      }
      case 'supret-api-form': {
        setSubmitLoading(submitBtn, true);
        try {
          const res = await api.createSupplierReturn({
            supplierId: v.supplierId,
            purchaseId: (v.purchaseId || '').trim() || null,
            reason: (v.reason || '').trim(),
            items: [{ batchId: v.batchId, qty: Number(v.qty) }],
          });
          closeModal();
          purchasesTab = 'supplier-returns';
          notify(`Đã lập phiếu trả hàng NCC ${res.item.id} (Chờ Quản lý duyệt).`);
          await loadSupplierReturnsData(true);
        } finally {
          setSubmitLoading(submitBtn, false);
        }
        break;
      }
      case 'writeoff-api-form': {
        setSubmitLoading(submitBtn, true);
        try {
          const res = await api.createWriteOff({
            reason: (v.reason || '').trim(),
            items: [{ batchId: v.batchId, qty: Number(v.qty) }],
          });
          closeModal();
          inventoryTab = 'near-expiry';
          notify(`Đã lập phiếu xuất hủy hàng ${res.item.id} (Chờ Quản lý duyệt).`);
          await loadNearExpiryData(true);
        } finally {
          setSubmitLoading(submitBtn, false);
        }
        break;
      }
      case 'audit-blind-form': {
        setSubmitLoading(submitBtn, true);
        try {
          const productIds = $$('input[name="blindProductId"]:checked', form).map((el) => el.value);
          if (v.scopeType === 'TUY_CHON' && !productIds.length) {
            throw new Error('Vui lòng chọn ít nhất 1 sản phẩm cho phiếu kiểm kê mù.');
          }
          const res = await api.createStockAudit({
            mode: 'BLIND',
            scopeType: v.scopeType,
            scopeValue: v.scopeValue || '',
            note: (v.note || '').trim(),
            productIds: v.scopeType === 'TUY_CHON' ? productIds : undefined,
          });
          closeModal();
          inventoryTab = 'audits';
          notify(`Đã tạo phiếu kiểm kê mù ${res.item.id} (trạng thái Đang đếm mù).`);
          await loadStockAuditsData(true);
        } finally {
          setSubmitLoading(submitBtn, false);
        }
        break;
      }
      case 'audit-count-form': {
        setSubmitLoading(submitBtn, true);
        try {
          const items = $$('[data-count-qty]', form).map((el) => ({
            productId: el.dataset.countQty,
            actualQty: Number(el.value),
          }));
          const res = await api.submitBlindCount(modalContext.id, {
            note: (v.note || '').trim(),
            items,
          });
          closeModal();
          notify(`Đã nộp đếm vòng 1 cho ${res.item.id} → ${statusLabels[res.item.status]?.[0] || res.item.status}.`);
          await loadStockAuditsData(true);
        } finally {
          setSubmitLoading(submitBtn, false);
        }
        break;
      }
      case 'audit-recount-form': {
        setSubmitLoading(submitBtn, true);
        try {
          const items = $$('[data-recount-qty]', form).map((el) => {
            const pid = el.dataset.recountQty;
            return {
              productId: pid,
              actualQty: Number(el.value),
              reasonCode: String(form.querySelector(`[data-recount-reason-code="${pid}"]`)?.value || '').trim(),
              reason: String(form.querySelector(`[data-recount-reason="${pid}"]`)?.value || '').trim(),
            };
          });
          const res = await api.submitRecount(modalContext.id, {
            note: (v.note || '').trim(),
            items,
          });
          closeModal();
          notify(`Đã nộp đếm lại vòng 2 cho ${res.item.id} → Chờ phê duyệt.`);
          await loadStockAuditsData(true);
        } finally {
          setSubmitLoading(submitBtn, false);
        }
        break;
      }
      case 'audit-api-form': {
        if (!auditLines.length) {
          throw new Error('Vui lòng thêm tối thiểu 1 sản phẩm cần kiểm đếm vào phiếu kiểm kê.');
        }
        for (const line of auditLines) {
          const diff = Number(line.actualQty) - Number(line.systemQty);
          if (diff !== 0 && !line.reasonCode && String(line.reason || '').trim().length < 3) {
            throw new Error(
              `Sản phẩm ${line.sku} có chênh lệch ${diff > 0 ? `+${diff}` : diff}: bắt buộc chọn Mã lý do chuẩn hoặc nhập lý do tối thiểu 3 ký tự (BR-06).`,
            );
          }
        }
        setSubmitLoading(submitBtn, true);
        try {
          const res = await api.createStockAudit({
            note: (v.note || '').trim(),
            items: auditLines.map((l) => ({
              productId: l.productId,
              actualQty: Number(l.actualQty),
              reasonCode: l.reasonCode || '',
              reason: String(l.reason || '').trim(),
            })),
          });
          closeModal();
          inventoryTab = 'audits';
          notify(`Đã lập phiếu kiểm kê ${res.item.id} (trạng thái Chờ duyệt).`);
          await loadStockAuditsData(true);
        } finally {
          setSubmitLoading(submitBtn, false);
        }
        break;
      }
      case 'return-form': {
        if (
          !modalContext.orderId ||
          (v.orderId || '').trim().toUpperCase() !== modalContext.orderId.toUpperCase()
        ) {
          throw new Error('Vui lòng bấm "Tra cứu hóa đơn" trước khi gửi phiếu trả hàng.');
        }
        const reason = (v.reason || '').trim();
        if (reason.length < 3) throw new Error('Vui lòng nhập lý do trả hàng (tối thiểu 3 ký tự).');
        const selections = $$('[data-return-id]', $('#modal'))
          .map((input) => ({ productId: input.dataset.returnId, qty: Number(input.value) }))
          .filter((i) => i.qty > 0);
        if (!selections.length) {
          throw new Error('Vui lòng nhập số lượng trả (> 0) cho ít nhất 1 sản phẩm.');
        }
        const restock = v.restock !== 'damaged_or_expired';
        setSubmitLoading(submitBtn, true);
        try {
          const res = await api.createReturn({
            orderId: modalContext.orderId,
            reason,
            restock,
            items: selections,
          });
          closeModal();
          notify(`Đã lập phiếu trả hàng ${res.item.id} (Chờ Quản lý/Admin duyệt hoàn tiền).`);
          await Promise.all([
            loadReturnsData(true),
            store.hasPermission('ORDER_VIEW') ? loadOrdersData(true) : Promise.resolve(),
          ]);
          await returnDetail(res.item.id);
        } finally {
          setSubmitLoading(submitBtn, false);
        }
        break;
      }
      case 'scan-form': {
        const code = (v.code || '').trim().toLowerCase();
        const p = (apiState.products || []).find(
          (item) =>
            item.status === 'DangKinhDoanh' &&
            (String(item.barcode || '').toLowerCase() === code ||
              String(item.sku || '').toLowerCase() === code ||
              String(item.id || '').toLowerCase() === code),
        );
        if (!p) throw new Error(`Không tìm thấy sản phẩm đang kinh doanh với mã "${v.code.trim()}".`);
        addCart(p.id, 1);
        closeModal();
        notify(`Đã thêm ${p.name} (${p.sku}) vào giỏ POS.`);
        break;
      }
    }
  } catch (error) {
    const target = $('#form-error', form) || $('#login-error', form);
    if (target) target.textContent = error.message;
    else notify(error.message, true);
  }
});
