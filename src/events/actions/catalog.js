/* M2 Catalog, Category, Unit, Supplier & Stock Ledger Click Actions. */
'use strict';

function handleCatalogAction(a) {
  switch (a.action) {
    case 'products-tab':
      productsTab = a.tab || 'products';
      pagination = {};
      if (productsTab === 'products') loadProductsData(true);
      else loadCatalogMeta(true);
      render();
      break;

    case 'product-new':
      productApiModal('');
      break;

    case 'product-edit':
      productApiModal(a.id);
      break;

    case 'product-ledger':
      productLedgerModal(a.id);
      break;

    case 'product-stock-adjust':
      stockAdjustModal(a.id);
      break;

    case 'product-reset-filters':
      delete filters.products;
      delete filters.productCategory;
      delete filters.productSupplier;
      delete filters.productStatus;
      delete filters.productStock;
      delete filters.productMinPrice;
      delete filters.productMaxPrice;
      apiState.productError = '';
      pagination.products = 1;
      loadProductsData(true);
      render();
      break;

    case 'product-toggle-status': {
      const target = apiState.products.find((x) => x.id === a.id);
      if (!target) return true;
      const nextStatus = a.nextStatus || (target.active ? 'NgungKinhDoanh' : 'DangKinhDoanh');
      const isStopping = nextStatus === 'NgungKinhDoanh';
      confirmation(
        isStopping ? 'Xác nhận ngừng kinh doanh sản phẩm?' : 'Xác nhận mở bán lại sản phẩm?',
        isStopping
          ? `Sản phẩm <strong>${e(target.sku)} — ${e(target.name)}</strong> sẽ chuyển sang trạng thái <strong>Ngừng kinh doanh</strong> (Soft-Delete), ẩn khỏi POS nhưng vẫn bảo toàn lịch sử hóa đơn và Thẻ kho.`
          : `Mở bán lại sản phẩm <strong>${e(target.sku)} — ${e(target.name)}</strong> (Đang kinh doanh)?`,
        async () => {
          try {
            await api.setProductStatus(target.id, nextStatus);
            notify(isStopping ? `Đã ngừng kinh doanh ${target.sku}.` : `Đã mở bán lại ${target.sku}.`);
            await loadProductsData(true);
          } catch (err) {
            notify(err.message, true);
          }
        },
      );
      break;
    }

    case 'export-products-api': {
      const canViewCost = store.hasPermission('PRODUCT_COST_VIEW');
      const header = [
        'Mã SP',
        'SKU',
        'Mã vạch',
        'Tên sản phẩm',
        'Thương hiệu',
        'Quy cách',
        'Danh mục',
        'ĐVT',
        'Nhà cung cấp',
        'Giá bán',
        ...(canViewCost ? ['Giá vốn'] : []),
        'Tồn hiện tại',
        'Tồn tối thiểu',
        'Trạng thái',
      ];
      exportCSV(
        [
          header,
          ...apiState.products.map((p) => [
            p.id,
            p.sku,
            p.barcode,
            p.name,
            p.brand,
            p.packSize,
            p.categoryName,
            p.unitName,
            p.supplierName,
            p.salePrice,
            ...(canViewCost ? [p.costPrice ?? ''] : []),
            p.stockQty,
            p.minStock,
            p.active ? 'Đang kinh doanh' : 'Ngừng kinh doanh',
          ]),
        ],
        'RetailFlow-hang-hoa.csv',
      );
      break;
    }

    case 'category-new':
      categoryApiModal('');
      break;

    case 'category-edit':
      categoryApiModal(a.code);
      break;

    case 'category-toggle-status': {
      const target = apiState.categories.find((c) => c.code === a.code);
      if (!target) return true;
      const nextStatus = a.nextStatus || (target.active ? 'NgungSuDung' : 'HoatDong');
      const isStopping = nextStatus === 'NgungSuDung';
      confirmation(
        isStopping ? 'Xác nhận ngừng sử dụng danh mục?' : 'Xác nhận khôi phục danh mục?',
        isStopping
          ? `Danh mục <strong>${e(target.code)} — ${e(target.name)}</strong> (đang gắn ${number(target.productCount)} sản phẩm) sẽ chuyển sang trạng thái <strong>Ngừng sử dụng</strong> (Soft-Delete).`
          : `Khôi phục trạng thái hoạt động cho danh mục <strong>${e(target.code)} — ${e(target.name)}</strong>?`,
        async () => {
          try {
            await api.setCategoryStatus(target.code, nextStatus);
            notify(isStopping ? `Đã ngừng sử dụng danh mục ${target.code}.` : `Đã khôi phục danh mục ${target.code}.`);
            await loadCatalogMeta(true);
          } catch (err) {
            notify(err.message, true);
          }
        },
      );
      break;
    }

    case 'unit-new':
      unitApiModal('');
      break;

    case 'unit-edit':
      unitApiModal(a.code);
      break;

    case 'unit-toggle-status': {
      const target = apiState.units.find((u) => u.code === a.code);
      if (!target) return true;
      const nextStatus = a.nextStatus || (target.active ? 'NgungSuDung' : 'HoatDong');
      const isStopping = nextStatus === 'NgungSuDung';
      confirmation(
        isStopping ? 'Xác nhận ngừng sử dụng đơn vị tính?' : 'Xác nhận khôi phục đơn vị tính?',
        isStopping
          ? `Đơn vị tính <strong>${e(target.code)} — ${e(target.name)}</strong> sẽ chuyển sang <strong>Ngừng sử dụng</strong> (Soft-Delete).`
          : `Khôi phục trạng thái hoạt động cho ĐVT <strong>${e(target.code)} — ${e(target.name)}</strong>?`,
        async () => {
          try {
            await api.setUnitStatus(target.code, nextStatus);
            notify(isStopping ? `Đã ngừng sử dụng ĐVT ${target.code}.` : `Đã khôi phục ĐVT ${target.code}.`);
            await loadCatalogMeta(true);
          } catch (err) {
            notify(err.message, true);
          }
        },
      );
      break;
    }

    case 'supplier-new':
      supplierApiModal('');
      break;

    case 'supplier-edit':
      supplierApiModal(a.id);
      break;

    case 'supplier-api-history':
    case 'supplier-history':
      supplierApiHistory(a.id);
      break;

    case 'supplier-toggle-status': {
      const target = apiState.suppliers.find((s) => s.id === a.id);
      if (!target) return true;
      const nextStatus = a.nextStatus || (target.active ? 'NgungHopTac' : 'HoatDong');
      const isStopping = nextStatus === 'NgungHopTac';
      confirmation(
        isStopping ? 'Xác nhận ngừng hợp tác nhà cung cấp?' : 'Xác nhận khôi phục hợp tác?',
        isStopping
          ? `Nhà cung cấp <strong>${e(target.id)} — ${e(target.name)}</strong> sẽ chuyển sang <strong>Ngừng hợp tác</strong> (Soft-Delete), không thể tạo phiếu nhập mới nhưng vẫn giữ nguyên dữ liệu lịch sử.`
          : `Khôi phục hợp tác với nhà cung cấp <strong>${e(target.id)} — ${e(target.name)}</strong>?`,
        async () => {
          try {
            await api.setSupplierStatus(target.id, nextStatus);
            notify(isStopping ? `Đã ngừng hợp tác với ${target.name}.` : `Đã khôi phục hợp tác với ${target.name}.`);
            await loadSuppliersData(true);
          } catch (err) {
            notify(err.message, true);
          }
        },
      );
      break;
    }

    case 'customer-new':
      customerApiModal('');
      break;

    case 'customer-edit':
      customerApiModal(a.id);
      break;

    case 'entity-new':
      entityModal(a.type);
      break;

    case 'entity-edit':
      entityModal(a.type, a.id);
      break;

    case 'customer-history':
      customerHistory(a.id);
      break;

    default:
      return false;
  }
  return true;
}
