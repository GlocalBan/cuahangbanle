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

    case 'backup': {
      store.requirePermission('THAM_SO_MANAGE');
      api
        .exportBackup()
        .then((snapshot) => {
          download(
            JSON.stringify(snapshot, null, 2),
            `RetailFlow-SQLite-backup-${dayKey(new Date())}.json`,
            'application/json',
          );
          notify('Đã xuất bản sao lưu CSDL SQLite (JSON) và ghi Nhật ký kiểm toán.');
        })
        .catch((err) => notify(err?.message || 'Không thể xuất sao lưu hệ thống.', true));
      break;
    }

    case 'report-preset': {
      const today = new Date();
      const toDate = today.toISOString().slice(0, 10);
      let fromDate = toDate;
      if (a.preset === '7d') {
        fromDate = new Date(today.getTime() - 6 * 86400000).toISOString().slice(0, 10);
      } else if (a.preset === '30d') {
        fromDate = new Date(today.getTime() - 29 * 86400000).toISOString().slice(0, 10);
      } else if (a.preset === 'month') {
        fromDate = `${toDate.slice(0, 8)}01`;
      }
      filters.reportFrom = fromDate;
      filters.reportTo = toDate;
      apiState.salesReportError = '';
      loadReportsData(true);
      break;
    }

    case 'reports-reset': {
      const def = getDefaultReportRange(30);
      filters.reportFrom = def.fromDate;
      filters.reportTo = def.toDate;
      filters.reportCategory = '';
      filters.reportGroupBy = 'day';
      apiState.salesReportError = '';
      loadReportsData(true);
      break;
    }

    case 'print-report': {
      store.requirePermission('REPORT_VIEW');
      if (!apiState.salesReport) throw new Error('Chưa có dữ liệu báo cáo để in.');
      const html = buildPrintableReportHTML(apiState.salesReport, apiState.inventoryReport);
      printReportHTML(html);
      notify('Đã mở cửa sổ In / Lưu PDF báo cáo khớp đúng bộ lọc đang xem.');
      break;
    }

    case 'export-report': {
      store.requirePermission('REPORT_VIEW');
      const r = apiState.salesReport;
      const inv = apiState.inventoryReport;
      if (!r) throw new Error('Chưa có dữ liệu báo cáo để xuất.');
      const s = r.summary || {};
      const f = r.filters || {};
      const rows = [
        ['BÁO CÁO KẾT QUẢ KINH DOANH & TỒN KHO (BR-08)', store.data.settings.name || 'RetailFlow'],
        ['Từ ngày', dateOnly(f.fromDate), 'Đến ngày', dateOnly(f.toDate)],
        ['Danh mục', f.categoryCode || 'Tất cả danh mục', 'Gom nhóm', f.groupBy === 'month' ? 'Tháng' : 'Ngày'],
        [],
        ['1. TỔNG HỢP KẾT QUẢ KINH DOANH CHUẨN KẾ TOÁN (VNĐ)'],
        ['Chỉ tiêu', 'Giá trị'],
        ['Số hóa đơn đã thanh toán', s.orderCount || 0],
        ['Số phiếu trả hàng đã xác nhận', s.returnCount || 0],
        ['Doanh thu gộp (trước VAT)', s.grossRevenuePreTax || 0],
        ['Hoàn trả doanh thu (trước VAT)', s.refundPreTax || 0],
        ['Doanh thu thuần (trước VAT)', s.netRevenuePreTax || 0],
        ['Giá vốn hàng bán gốc', s.grossCogs || 0],
        ['Giá vốn hàng trả nhập lại kho (restock = 1)', s.restockedReturnCogs || 0],
        ['Hao hụt hàng lỗi không nhập kho (restock = 0, theo dõi)', s.nonRestockedReturnCogs || 0],
        ['Giá vốn hàng bán ròng (COGS)', s.netCogs || 0],
        ['Lợi nhuận gộp (trước VAT)', s.grossProfit || 0],
        ['Biên lợi nhuận gộp (%)', s.grossMarginPct ?? 0],
        ['Thuế VAT đầu ra gộp', s.grossTax || 0],
        ['Thuế VAT hoàn trả', s.refundTax || 0],
        ['Thuế VAT đầu ra ròng', s.netTax || 0],
        ['Tổng thu khách hàng gộp (gồm VAT)', s.grossCollected || 0],
        ['Tiền hoàn khách (gồm VAT)', s.refundTotal || 0],
        ['Tổng thu ròng khách hàng (gồm VAT)', s.netCollected || 0],
        [],
        ['2. DOANH THU THUẦN (TRƯỚC VAT) & LỢI NHUẬN THEO DANH MỤC'],
        ['Danh mục', 'SL bán', 'SL trả', 'SL ròng', 'DT gộp trước VAT', 'Hoàn trước VAT', 'DT thuần trước VAT', 'Giá vốn', 'Hao hụt không nhập kho', 'LN gộp'],
        ...(r.categoryBreakdown || []).map((c) => [
          c.categoryName,
          c.soldQty,
          c.returnedQty,
          c.netQty,
          c.grossRevenuePreTax,
          c.refundPreTax,
          c.netRevenuePreTax,
          c.netCogs,
          c.nonRestockedReturnCogs || 0,
          c.grossProfit,
        ]),
        [],
        ['3. PHƯƠNG THỨC THANH TOÁN'],
        ['Phương thức', 'Số hóa đơn', 'Tổng thu gộp', 'Hoàn khách', 'Tổng thu ròng (gồm VAT)', 'DT thuần trước VAT', 'Thuế VAT ròng', 'Tỷ trọng (%)'],
        ...(r.paymentBreakdown || []).map((p) => [
          p.label,
          p.orderCount,
          p.grossCollected,
          p.refundTotal,
          p.netCollected,
          p.netRevenuePreTax,
          p.netTax,
          p.sharePct,
        ]),
        [],
        ['4. TOP SẢN PHẨM BÁN CHẠY'],
        ['SKU', 'Tên sản phẩm', 'Danh mục', 'SL bán', 'SL trả', 'SL ròng', 'DT thuần trước VAT', 'Giá vốn', 'Hao hụt không nhập kho', 'LN gộp'],
        ...(r.topProducts || []).map((p) => [
          p.sku,
          p.productName,
          p.categoryName,
          p.soldQty,
          p.returnedQty,
          p.netQty,
          p.netRevenuePreTax,
          p.netCogs,
          p.nonRestockedReturnCogs || 0,
          p.grossProfit,
        ]),
        [],
        ['5. ĐỊNH GIÁ TỒN KHO THEO DANH MỤC'],
        ['Danh mục', 'Số SKU', 'Tổng tồn', 'Giá trị vốn', 'Giá trị bán lẻ', 'SKU dưới tồn tối thiểu'],
        ...((inv?.byCategory) || []).map((c) => [
          c.categoryName,
          c.skuCount,
          c.stockQty,
          c.costValue,
          c.retailValue,
          c.lowStockCount,
        ]),
      ];
      exportCSV(rows, `RetailFlow-bao-cao-${f.fromDate}-den-${f.toDate}.csv`);
      notify('Đã xuất báo cáo Excel/CSV (UTF-8 BOM) khớp 100% bộ lọc hiện tại.');
      break;
    }

    default:
      return false;
  }
  return true;
}
