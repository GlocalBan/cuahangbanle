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

    case 'export-products':
      exportCSV(
        [
          [
            'Mã',
            'Mã vạch',
            'Tên',
            'Danh mục',
            'Giá bán',
            'Giá vốn',
            'Tồn kho',
            'Mã lô',
            'NSX',
            'HSD',
            'Trạng thái HSD',
            'Trạng thái',
          ],
          ...store.data.products.map((p) => [
            p.id,
            p.barcode,
            p.name,
            p.category,
            p.price,
            p.costPrice || p.cost,
            p.stock,
            p.batchCode || '',
            p.mfgDate || '',
            p.expiryDate || '',
            typeof getExpiryInfo === 'function' ? getExpiryInfo(p.expiryDate).label : '',
            p.active ? 'Đang bán' : 'Ngừng bán',
          ]),
        ],
        'RetailFlow-san-pham.csv',
      );
      break;

    case 'sync-seed-catalog': {
      confirmation(
        'Đồng bộ danh mục mẫu mới?',
        'Hệ thống sẽ cập nhật toàn bộ 80+ sản phẩm cửa hàng tiện lợi chuẩn CVS, nạp ảnh chụp thương phẩm thật và đồng bộ hạn sử dụng thực tế (12 cận date, 4 hết hạn) tương thích với ngày hiện tại.',
        () => {
          const count = store.syncSeedCatalog();
          render();
          notify(`Đã đồng bộ thành công ${count} sản phẩm và hạn sử dụng thực tế mới nhất!`);
        },
      );
      break;
    }

    default:
      return false;
  }
  return true;
}
