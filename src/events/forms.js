document.addEventListener('submit', async (event) => {
  const form = event.target;
  if (!form.id) return;
  event.preventDefault();
  const v = dataForm(form);
  const submitBtn = form.querySelector('button[type="submit"]');
  try {
    switch (form.id) {
      case 'login-form': {
        if (submitBtn) submitBtn.disabled = true;
        try {
          const res = await api.login(v.username.trim(), v.password);
          setAuthToken(res.token);
          resetApiCaches();
          productsTab = 'products';
          inventoryTab = 'stock';
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
          if (submitBtn) submitBtn.disabled = false;
        }
        break;
      }
      case 'change-password-form': {
        if (v.newPassword !== v.confirmPassword) {
          throw new Error('Xác nhận mật khẩu mới không khớp.');
        }
        if (submitBtn) submitBtn.disabled = true;
        try {
          await api.changePassword({
            currentPassword: v.currentPassword,
            newPassword: v.newPassword,
            confirmPassword: v.confirmPassword,
          });
          closeModal();
          notify('Đổi mật khẩu thành công. Nhật ký kiểm toán đã ghi nhận.');
        } finally {
          if (submitBtn) submitBtn.disabled = false;
        }
        break;
      }
      case 'staff-api-form': {
        if (submitBtn) submitBtn.disabled = true;
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
          if (submitBtn) submitBtn.disabled = false;
        }
        break;
      }
      case 'tham-so-form': {
        if (submitBtn) submitBtn.disabled = true;
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
          if (submitBtn) submitBtn.disabled = false;
        }
        break;
      }
      case 'product-api-form': {
        if (submitBtn) submitBtn.disabled = true;
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
          if (submitBtn) submitBtn.disabled = false;
        }
        break;
      }
      case 'stock-adjust-form': {
        if (submitBtn) submitBtn.disabled = true;
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
          if (submitBtn) submitBtn.disabled = false;
        }
        break;
      }
      case 'category-api-form': {
        if (submitBtn) submitBtn.disabled = true;
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
          if (submitBtn) submitBtn.disabled = false;
        }
        break;
      }
      case 'unit-api-form': {
        if (submitBtn) submitBtn.disabled = true;
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
          if (submitBtn) submitBtn.disabled = false;
        }
        break;
      }
      case 'supplier-api-form': {
        if (submitBtn) submitBtn.disabled = true;
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
          if (submitBtn) submitBtn.disabled = false;
        }
        break;
      }
      case 'checkout-form': {
        if (!posCart.items.length) {
          throw new Error('Giỏ hàng trống, không thể thanh toán.');
        }
        if (submitBtn) submitBtn.disabled = true;
        try {
          const paymentMethod = String(v.paymentMethod || v.payment || 'CASH').toUpperCase();
          const cashVal = v.cashReceived !== undefined ? v.cashReceived : v.received;
          const payload = {
            customerId: posCart.customerId || null,
            promotionCode: posCart.appliedPromotion?.code || '',
            paymentMethod,
            cashReceived: paymentMethod === 'CASH' ? Number(cashVal || 0) : 0,
            paymentRef: (v.paymentRef || '').trim(),
            note: (posCart.note || '').trim(),
            items: posCart.items.map((i) => ({
              productId: i.productId,
              qty: Number(i.qty),
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
          if (submitBtn) submitBtn.disabled = false;
        }
        break;
      }
      case 'promotion-api-form': {
        if (submitBtn) submitBtn.disabled = true;
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
          if (submitBtn) submitBtn.disabled = false;
        }
        break;
      }
      case 'customer-api-form': {
        if (submitBtn) submitBtn.disabled = true;
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
          if (submitBtn) submitBtn.disabled = false;
        }
        break;
      }
      case 'entity-form': {
        const type = modalContext.entity;
        const values = { ...v, active: v.active === 'true' };
        if (modalContext.id) values.id = modalContext.id;
        store.upsert(type, values);
        closeModal();
        if ($('#content')) render();
        notify('Đã lưu thông tin.');
        break;
      }
      case 'purchase-api-form': {
        if (!purchaseLines.length) {
          throw new Error('Vui lòng thêm tối thiểu 1 mặt hàng vào phiếu nhập trước khi lưu (BR-02).');
        }
        if (submitBtn) submitBtn.disabled = true;
        try {
          const payload = {
            supplierId: v.supplierId,
            note: (v.note || '').trim(),
            items: purchaseLines.map((l) => ({
              productId: l.productId,
              qty: Number(l.qty),
              unitCost: Number(l.unitCost),
            })),
          };
          if (modalContext.id) {
            const res = await api.updatePurchase(modalContext.id, payload);
            notify(`Đã cập nhật phiếu nhập nháp ${res.item.id}.`);
          } else {
            const res = await api.createPurchase(payload);
            notify(`Đã tạo phiếu nhập nháp ${res.item.id} (chờ Quản lý duyệt nhập kho).`);
          }
          closeModal();
          await loadPurchasesData(true);
        } finally {
          if (submitBtn) submitBtn.disabled = false;
        }
        break;
      }
      case 'audit-api-form': {
        if (!auditLines.length) {
          throw new Error('Vui lòng thêm tối thiểu 1 sản phẩm cần kiểm đếm vào phiếu kiểm kê.');
        }
        for (const line of auditLines) {
          const diff = Number(line.actualQty) - Number(line.systemQty);
          if (diff !== 0 && String(line.reason || '').trim().length < 3) {
            throw new Error(
              `Sản phẩm ${line.sku} có chênh lệch ${diff > 0 ? `+${diff}` : diff}: bắt buộc nhập Lý do chênh lệch tối thiểu 3 ký tự (BR-06).`,
            );
          }
        }
        if (submitBtn) submitBtn.disabled = true;
        try {
          const res = await api.createStockAudit({
            note: (v.note || '').trim(),
            items: auditLines.map((l) => ({
              productId: l.productId,
              actualQty: Number(l.actualQty),
              reason: String(l.reason || '').trim(),
            })),
          });
          closeModal();
          inventoryTab = 'audits';
          notify(`Đã lập phiếu kiểm kê ${res.item.id} (trạng thái Chờ duyệt).`);
          await loadStockAuditsData(true);
        } finally {
          if (submitBtn) submitBtn.disabled = false;
        }
        break;
      }
      case 'audit-form': {
        const auditStatus = v.status || 'resolved';
        store.audit(
          [
            {
              id: v.productId,
              actual: Number(v.counted),
              resolution: v.resolution || 'damage_writeoff',
              resolutionAction: v.resolution || 'damage_writeoff',
              responsibleStaff: v.responsibleStaff || '',
            },
          ],
          v.reason || 'Kiểm kê định kỳ',
          auditStatus,
        );
        closeModal();
        render();
        notify(
          auditStatus === 'pending_resolution'
            ? 'Đã lưu phiếu kiểm kê (chờ phê duyệt).'
            : 'Đã xác nhận kiểm kê và cập nhật tồn kho.',
        );
        break;
      }
      case 'purchase-form':
        store.createPurchase(v.supplierId, purchaseLines, v.note || '', v.status);
        closeModal();
        render();
        notify('Đã lưu phiếu nhập hàng.');
        break;
      case 'supplier-response-form': {
        const pid = modalContext.purchaseId;
        const p = store.data.purchases.find((x) => x.id === pid);
        if (!p) throw new Error('Không tìm thấy phiếu nhập.');
        const lines = p.items.map((item, idx) => ({
          id: item.id,
          supplierStatus: v[`supplier_status_${idx}`] || (Number(v[`confirmed_qty_${idx}`]) === 0 ? 'out_of_stock' : Number(v[`confirmed_qty_${idx}`]) < item.qty ? 'partial' : 'full'),
          confirmedQty: Number(
            v[`confirmed_qty_${idx}`] !== undefined ? v[`confirmed_qty_${idx}`] : item.qty,
          ),
          confirmedCost: Number(
            v[`confirmed_cost_${idx}`] !== undefined ? v[`confirmed_cost_${idx}`] : item.price,
          ),
          expiryDate: v[`expiry_date_${idx}`] || item.expiryDate || '',
          batchCode: v[`batch_code_${idx}`] || item.batchCode || '',
        }));
        store.supplierRespond(pid, { lines, supplierNote: v.supplierNote });
        closeModal();
        render();
        purchaseDetail(pid);
        notify('Đã ghi nhận phản hồi từ Nhà cung cấp!');
        break;
      }
      case 'purchase-receipt-form': {
        const pid = modalContext.purchaseId;
        const p = store.data.purchases.find((x) => x.id === pid);
        if (!p) throw new Error('Không tìm thấy phiếu nhập.');
        const lines = p.items.map((item, idx) => ({
          id: item.id,
          acceptedQty: Number(
            v[`accepted_qty_${idx}`] !== undefined
              ? v[`accepted_qty_${idx}`]
              : item.confirmedQty || item.qty,
          ),
          rejectedQty: Number(v[`rejected_qty_${idx}`] || 0),
          rejectReason: v[`reject_reason_${idx}`] || '',
        }));
        store.confirmPurchaseReceipt(pid, { lines, receiverNote: v.receiverNote });
        closeModal();
        render();
        purchaseDetail(pid);
        notify('Đã hoàn tất kiểm nhận hàng (GRN) và nhập kho thành công!');
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
        if (submitBtn) submitBtn.disabled = true;
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
          if (submitBtn) submitBtn.disabled = false;
        }
        break;
      }
      case 'settings-form':
        store.saveSettings({ ...v, taxRate: Number(v.taxRate) });
        render();
        notify('Đã lưu cấu hình cửa hàng.');
        break;
      case 'branch-form':
        store.createBranch(v);
        closeModal();
        render();
        notify('Địa chỉ có đối tác phục vụ. Đã lưu đề xuất chi nhánh.');
        break;
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
      case 'import-csv-form': {
        const content = v.csvContent || '';
        if (!content.trim()) throw new Error('Vui lòng dán hoặc tải nội dung CSV.');
        const res = store.importReferenceCatalogCsv(content);
        closeModal();
        render();
        notify(`Đã nạp thành công đối chứng CSV (${res.updatedCount} cập nhật, ${res.addedCount} thêm mới)!`);
        break;
      }
    }
  } catch (error) {
    const target = $('#form-error', form) || $('#login-error', form);
    if (target) target.textContent = error.message;
    else notify(error.message, true);
  }
});
