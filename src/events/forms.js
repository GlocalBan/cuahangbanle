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
      case 'checkout-form': {
        const d = clone(store.data.draft);
        d.demographic = v.demographic;
        store.saveDraft(d);
        const o = store.checkout({
          payment: v.payment,
          received: Number(v.received || 0),
          paymentRef: v.paymentRef || '',
          confirmed: v.confirmed === 'on',
        });
        render();
        orderDetail(o.id);
        notify(`Thanh toán thành công · ${o.id}`);
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
          v.orderId.trim().toLowerCase() !== modalContext.orderId.toLowerCase()
        )
          throw new Error('Tra cứu hóa đơn trước khi gửi yêu cầu.');
        if (!v.reason?.trim()) throw new Error('Vui lòng nhập lý do trả hàng.');
        const selections = $$('[data-return-id]', $('#modal'))
          .map((input) => ({ id: input.dataset.returnId, qty: Number(input.value) }))
          .filter((i) => i.qty > 0);
        const restockChoice =
          v.restock === 'good_restock' || v.restock === 'on' || v.restock === true;
        const r = store.createReturn(
          modalContext.orderId,
          selections,
          v.reason,
          restockChoice ? 'good_restock' : 'damaged_or_expired',
        );
        render();
        returnDetail(r.id);
        notify('Đã tạo yêu cầu, chờ quản trị viên phê duyệt.');
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
        const p = store.data.products.find(
          (p) => p.barcode === v.code.trim() || p.id.toLowerCase() === v.code.trim().toLowerCase(),
        );
        if (!p) throw new Error('Không tìm thấy sản phẩm với mã này.');
        addCart(p.id);
        closeModal();
        notify(`Đã thêm ${p.name}`);
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
