function handleCatalogAction(a) {
  switch (a.action) {
    case 'entity-new':
      entityModal(a.type);
      break;

    case 'entity-edit':
      entityModal(a.type, a.id);
      break;

    case 'customer-history':
      customerHistory(a.id);
      break;

    case 'supplier-history':
      supplierHistory(a.id);
      break;

    case 'view-product-batches': {
      const p = store.data.products.find((x) => x.id === a.id);
      if (!p) return true;
      const batches = p.batches || [];
      const batchRows = batches.map((b) => {
        const exp = getExpiryInfo ? getExpiryInfo(b.expiryDate) : { label: 'Còn hạn', color: 'green' };
        const statusBadge =
          b.status === 'expired_quarantined'
            ? badge('Hết hạn - Cách ly', 'red')
            : b.status === 'depleted'
              ? badge('Đã xuất hết', 'gray')
              : badge('Đang lưu kho', 'green');
        return `<tr>
          <td><strong>${e(b.batchCode)}</strong></td>
          <td>${e(b.mfgDate || 'N/A')}</td>
          <td><span class="badge ${exp.color}">${e(b.expiryDate || 'N/A')}</span></td>
          <td class="money">${money(b.costPrice)}</td>
          <td>${b.initialQty}</td>
          <td><strong>${b.remainingQty}</strong></td>
          <td>${statusBadge}</td>
        </tr>`;
      });
      showModal(
        `Chi tiết lô hàng — ${e(p.name)}`,
        `<div class="modal-content">
          <p class="sub">Quản lý lô hàng theo nguyên tắc <strong>FEFO (First-Expired, First-Out)</strong>. Khi thanh toán POS, hệ thống tự động xuất từ lô có HSD sớm nhất.</p>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Mã lô</th>
                  <th>Ngày SX</th>
                  <th>Hạn SD</th>
                  <th>Giá vốn</th>
                  <th>Nhập</th>
                  <th>Còn lại</th>
                  <th>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                ${batchRows.length ? batchRows.join('') : '<tr><td colspan="7" class="text-center muted">Chưa có thông tin lô hàng chi tiết.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
        <div class="modal-footer"><button type="button" class="btn" data-action="close-modal">Đóng</button></div>`,
        true,
      );
      break;
    }

    case 'export-products':
      exportCSV(
        [
          [
            'Mã',
            'GTIN',
            'Mã vạch',
            'Tên',
            'Thương hiệu',
            'Quy cách',
            'Ngành cấp 1',
            'Ngành cấp 2',
            'Ngành cấp 3',
            'Giá bán',
            'Giá vốn',
            'VAT (%)',
            'Tồn khả dụng',
            'Hàng cách ly/hủy',
            'Mã lô FEFO',
            'NSX',
            'HSD',
            'Trạng thái HSD',
            'Trạng thái',
            'Nguồn đối chứng',
          ],
          ...store.data.products.map((p) => [
            p.id,
            p.gtin || p.barcode,
            p.barcode,
            p.name,
            p.brand || '',
            p.packSize || '',
            p.categoryL1 || '',
            p.categoryL2 || p.category,
            p.categoryL3 || '',
            p.price,
            p.costPrice || p.cost,
            p.vatRate ?? 10,
            p.stock,
            p.damagedStock || 0,
            p.batchCode || '',
            p.mfgDate || '',
            p.expiryDate || '',
            typeof getExpiryInfo === 'function' ? getExpiryInfo(p.expiryDate).label : '',
            p.active ? 'Đang bán' : 'Ngừng bán',
            p.referenceSource?.status || 'seed',
          ]),
        ],
        'RetailFlow-san-pham-FEFO.csv',
      );
      break;

    case 'sync-seed-catalog': {
      if (store.user.role !== 'ADMIN') {
        notify('Chỉ Quản trị viên (ADMIN) mới có quyền đồng bộ danh mục mẫu.', 'error');
        return true;
      }
      confirmation(
        'Đồng bộ danh mục mẫu mới (Bảo vệ dữ liệu)?',
        'Hệ thống sẽ thêm các SKU mẫu CVS mới chưa có trong hệ thống, cập nhật nhà cung cấp thực tế và KHÔNG ghi đè bất kỳ sản phẩm nào bạn đã chỉnh sửa giá, tồn kho hoặc tên.',
        () => {
          const count = store.syncSeedCatalog();
          render();
          notify(`Đã đồng bộ thành công danh mục mẫu (${count} mặt hàng)!`);
        },
      );
      break;
    }

    case 'sweep-expired-batches': {
      confirmation(
        'Quét và cách ly các lô hàng hết hạn?',
        'Hệ thống sẽ chuyển các lô hàng có ngày hết hạn nhỏ hơn ngày hiện tại sang trạng thái cách ly (expired_quarantined) và cộng dồn vào tổn thất hàng hủy.',
        () => {
          const res = store.sweepExpiredBatches();
          render();
          notify(`Đã quét xong: Cách ly ${res.quarantinedBatchesCount} lô (${res.totalQuarantinedQty} sản phẩm).`);
        },
      );
      break;
    }

    case 'import-reference-csv': {
      if (store.user.role !== 'ADMIN') {
        notify('Chỉ Quản trị viên (ADMIN) mới có quyền nạp CSV đối chứng.', 'error');
        return true;
      }
      const sampleCsv = `gtin,brand,name,packSize,categoryL1,categoryL2,categoryL3,price,costPrice,vatRate,imageUrl,refUrl
8934543000017,Vinamilk,Sữa tươi Vinamilk 1L,1L,Thực phẩm,Sữa & Chế phẩm,Sữa tươi tiệt trùng,36000,27000,5,assets/images/products/milk_vinamilk.jpg,https://vinamilk.com.vn
8934607000018,Hảo Hảo,Mì Hảo Hảo tôm chua cay 75g,75g,Thực phẩm,Mì ăn liền,Mì vị tôm,4500,3240,10,assets/images/products/haohao_shrimp.jpg,https://acecookvietnam.vn`;

      showModal(
        'Nạp tệp CSV Đối chứng 1-1 (Chuẩn GTIN EAN-13)',
        `<form id="import-csv-form">
          <div class="modal-content">
            <p class="sub">Nhập nội dung CSV chuẩn đối chứng 1-1. Thuật toán kiểm tra check-digit <strong>EAN-13</strong> và chống trùng lặp GTIN sẽ tự động xác thực từng dòng dữ liệu.</p>
            <div class="field full">
              <span>Tải tệp CSV từ máy</span>
              <input type="file" id="csv-file-input" accept=".csv,text/csv" />
            </div>
            <label class="field full">
              <span>Hoặc dán nội dung CSV vào đây:</span>
              <textarea name="csvContent" id="csv-text-area" rows="8" style="font-family:monospace;font-size:0.8rem">${e(sampleCsv)}</textarea>
            </label>
            ${formError()}
          </div>
          <div class="modal-footer">
            <button type="button" class="btn" data-action="close-modal">Đóng</button>
            <button type="submit" class="btn primary">${icon('upload')} Tiến hành Nạp & Xác thực</button>
          </div>
        </form>`,
        true,
      );

      // File reader listener
      setTimeout(() => {
        const fileIn = $('#csv-file-input');
        if (fileIn) {
          fileIn.addEventListener('change', (ev) => {
            const f = ev.target.files && ev.target.files[0];
            if (f) {
              const r = new FileReader();
              r.onload = (e) => {
                const txt = e.target.result;
                const area = $('#csv-text-area');
                if (area) area.value = txt;
              };
              r.readAsText(f, 'UTF-8');
            }
          });
        }
      }, 50);
      break;
    }

    default:
      return false;
  }
  return true;
}
