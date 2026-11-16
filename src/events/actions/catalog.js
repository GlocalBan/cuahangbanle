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
          ['Mã', 'Mã vạch', 'Tên', 'Danh mục', 'Giá bán', 'Giá vốn', 'Tồn kho', 'Trạng thái'],
          ...store.data.products.map((p) => [
            p.id,
            p.barcode,
            p.name,
            p.category,
            p.price,
            p.cost,
            p.stock,
            p.active ? 'Đang bán' : 'Ngừng bán',
          ]),
        ],
        'RetailFlow-san-pham.csv',
      );
      break;

    default:
      return false;
  }
  return true;
}
