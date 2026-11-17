document.addEventListener('submit', (event) => {
  const form = event.target;
  if (!form.id) return;
  event.preventDefault();
  const v = dataForm(form);
  try {
    switch (form.id) {
      case 'login-form':
        store.login(v.username.trim(), v.password);
        sessionStorage.setItem('retailflow-user', store.user.id);
        page = ACCESS[store.user.role][0];
        shell();
        notify(`Chào ${store.user.name}, chúc bạn một ngày làm việc tốt!`);
        break;
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
      case 'audit-form':
        store.audit(
          [
            {
              id: v.productId,
              actual: Number(v.counted),
              resolution: v.resolution || 'damage_writeoff',
              responsibleStaff: v.responsibleStaff || '',
            },
          ],
          v.reason || 'Kiểm kê định kỳ',
        );
        closeModal();
        render();
        notify('Đã xác nhận kiểm kê và cập nhật tồn kho.');
        break;
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
    }
  } catch (error) {
    const target = $('#form-error', form) || $('#login-error', form);
    if (target) target.textContent = error.message;
    else notify(error.message, true);
  }
});
