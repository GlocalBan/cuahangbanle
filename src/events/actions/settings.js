function handleSettingsAction(a) {
  switch (a.action) {
    case 'staff-new':
      staffModal();
      break;

    case 'staff-edit':
      staffModal(a.id);
      break;

    case 'staff-refresh':
      loadStaffData(true);
      break;

    case 'staff-toggle-status': {
      store.requirePermission('STAFF_MANAGE');
      const targetStatus = a.status === 'ACTIVE' ? 'ACTIVE' : 'LOCKED';
      const staffName = a.name || a.id;
      const title =
        targetStatus === 'LOCKED'
          ? `Xác nhận khóa tài khoản ${e(staffName)}?`
          : `Xác nhận mở khóa tài khoản ${e(staffName)}?`;
      const desc =
        targetStatus === 'LOCKED'
          ? `Tài khoản <strong>${e(staffName)}</strong> (${e(a.id)}) sẽ bị chuyển sang trạng thái <strong>Bị khóa (LOCKED)</strong> và lập tức bị chặn đăng nhập/API (HTTP 401). Toàn bộ lịch sử hóa đơn và chứng từ vẫn được bảo toàn.`
          : `Tài khoản <strong>${e(staffName)}</strong> (${e(a.id)}) sẽ được khôi phục trạng thái <strong>Đang hoạt động (ACTIVE)</strong> và có thể đăng nhập trở lại.`;
      confirmation(title, desc, async () => {
        try {
          await api.setStaffStatus(a.id, targetStatus);
          notify(
            targetStatus === 'LOCKED'
              ? `Đã khóa tài khoản ${staffName} (Soft-Delete).`
              : `Đã mở khóa tài khoản ${staffName}.`,
          );
          await loadStaffData(true);
        } catch (err) {
          notify(err.message, true);
        }
      });
      break;
    }

    case 'tham-so-reload':
      loadThamSoData(true);
      notify('Đã đồng bộ lại bảng THAM_SO từ CSDL.');
      break;

    case 'audit-refresh':
    case 'audit-apply-filter':
      pagination['audit-logs'] = 1;
      loadAuditLogsData(true);
      break;

    case 'audit-clear-filter':
      filters.auditSearch = '';
      filters.auditAction = '';
      filters.auditFrom = '';
      filters.auditTo = '';
      pagination['audit-logs'] = 1;
      apiState.auditLogError = '';
      loadAuditLogsData(true);
      break;

    case 'audit-paginate':
      pagination['audit-logs'] = Math.max(1, (pagination['audit-logs'] || 1) + Number(a.delta || 0));
      loadAuditLogsData(true);
      break;

    case 'branch-new':
      branchModal();
      break;

    case 'backup':
      store.admin();
      download(
        JSON.stringify(store.data, null, 2),
        `RetailFlow-backup-${dayKey(new Date())}.json`,
        'application/json',
      );
      notify('Đã tải bản sao lưu dữ liệu.');
      break;

    case 'restore':
      store.admin();
      $('#restore-file').click();
      break;

    case 'export-report': {
      store.require('reports');
      const p = periodData(reportDays);
      exportCSV(
        [
          ['Báo cáo', `${reportDays} ngày gần nhất`],
          ['Doanh thu gộp', p.gross],
          ['Hoàn tiền trong kỳ', p.refund],
          ['Doanh thu thuần', p.gross - p.refund],
          [],
          ['Mã hóa đơn', 'Thời gian', 'Khách hàng', 'Phương thức', 'Tổng tiền', 'Trạng thái'],
          ...p.orders.map((o) => [
            o.id,
            date(o.time),
            o.customer,
            METHODS[o.payment],
            o.total,
            statusLabels[o.status][0],
          ]),
          [],
          ['Phiếu hoàn', 'Hóa đơn gốc', 'Ngày hoàn', 'Số tiền'],
          ...p.refunds.map((r) => [r.id, r.orderId, date(r.resolvedAt), r.amount]),
        ],
        `RetailFlow-bao-cao-${reportDays}-ngay.csv`,
      );
      break;
    }

    default:
      return false;
  }
  return true;
}
