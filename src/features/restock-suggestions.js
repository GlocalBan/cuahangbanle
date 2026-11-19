/* M3: Gợi ý nhập hàng sắp hết (BR-01 & BR-02) đọc trực tiếp từ SQLite API. */
'use strict';

function restockSuggestionsHTML() {
  const items = apiState.restockSuggestions || [];
  if (!items.length) return '';
  return `<section class="panel restock-panel">
    <div class="panel-head">
      <div>
        <h2>Gợi ý nhập hàng sắp hết (BR-01)</h2>
        <p class="sub">${items.length} mặt hàng đang có tồn kho &le; ngưỡng tối thiểu · Chọn để lập phiếu nhập nháp (Draft) ngay</p>
      </div>
      ${badge(`${items.length} cần nhập`, 'yellow')}
    </div>
    <div class="restock-grid">${items
      .map(
        (p) => `<article class="restock-card">
          <div class="row">
            <div class="product-thumb">${productImage({ imageUrl: p.imageUrl, name: p.name }, 'product-thumb-img')}</div>
            <div>
              <h3>${e(p.name)}</h3>
              <p class="sub"><code>${e(p.sku)}</code> · ${e(p.supplierName)}</p>
            </div>
          </div>
          <div class="restock-levels">
            <span>Còn <b class="negative">${number(p.stockQty)}</b> ${e(p.unitName)}</span>
            <span>Tối thiểu <b>${number(p.minStock)}</b></span>
          </div>
          ${p.pendingDraftQty > 0 ? `<p class="sub">Đang có trong phiếu nháp: <strong>${number(p.pendingDraftQty)}</strong></p>` : ''}
          <p class="restock-recommended">${
            p.recommendedQty > 0
              ? `Gợi ý nhập thêm <strong>${number(p.recommendedQty)}</strong> ${e(p.unitName)}`
              : 'Lượng trong phiếu nháp đã đạt mức bổ sung gợi ý'
          }</p>
          ${action(
            'purchase-restock',
            p.recommendedQty > 0 ? 'Nhập mặt hàng này' : 'Lập phiếu thêm',
            'plus',
            'primary small',
            `data-id="${e(p.productId)}" ${p.supplierActive ? '' : 'disabled'}`,
          )}
          ${!p.supplierActive ? '<p class="sub negative">NCC đã ngừng hợp tác (BR-02)</p>' : ''}
        </article>`,
      )
      .join('')}</div>
    <p class="restock-explanation sub">Số lượng gợi ý = 2 × Tồn tối thiểu − Tồn hiện tại − SL đang ở phiếu Nháp. Bạn có thể điều chỉnh lại trước khi lưu.</p>
  </section>`;
}

function renderSupplierRestockSuggestions() {
  const container = $('#purchase-restock-suggestions');
  const supplierSelect = $('#purchase-supplier');
  if (!container || !supplierSelect) return;
  const sid = supplierSelect.value;
  const items = (apiState.restockSuggestions || []).filter((p) => p.supplierId === sid);
  container.hidden = !items.length;
  if (!items.length) {
    container.innerHTML = '';
    return;
  }
  container.innerHTML = `<h3>Mặt hàng sắp hết của nhà cung cấp này</h3>
    <p class="sub">Nhấn để thêm nhanh vào danh sách dòng nhập bên dưới</p>
    <div class="supplier-restock-list">${items
      .map((p) => {
        const added = purchaseLines.some((i) => i.productId === p.productId);
        return `<button type="button" class="supplier-restock-item" data-action="purchase-add-suggestion" data-id="${e(p.productId)}" ${added ? 'disabled' : ''}>
          <span><strong>${e(p.name)}</strong><small>Còn ${number(p.stockQty)} / Ngưỡng ${number(p.minStock)} · Nháp ${number(p.pendingDraftQty)}</small></span>
          <span>${added ? 'Đã thêm' : `+ ${number(p.recommendedQty || 1)}`}</span>
        </button>`;
      })
      .join('')}</div>`;
}

function addSuggestedPurchase(productId) {
  const supplierSelect = $('#purchase-supplier');
  const supplierId = supplierSelect ? supplierSelect.value : '';
  const prod = (apiState.products || []).find((p) => p.id === productId && p.status === 'DangKinhDoanh');
  const sug = (apiState.restockSuggestions || []).find((s) => s.productId === productId);
  const item = prod || sug;
  if (!item) throw new Error('Không tìm thấy sản phẩm đang kinh doanh.');
  if (supplierId && item.supplierId !== supplierId) {
    throw new Error('Sản phẩm không thuộc nhà cung cấp đang chọn.');
  }
  if (purchaseLines.some((i) => i.productId === productId)) {
    throw new Error('Mặt hàng đã có trong danh sách nhập.');
  }
  const qty = Math.max(1, Number(sug?.recommendedQty) || Math.max(1, (item.minStock || 15) * 2 - (item.stockQty || 0)));
  const unitCost = Math.max(0, Number(item.costPrice) || 0);
  if ($('#purchase-product')) $('#purchase-product').value = productId;
  if ($('#purchase-qty')) $('#purchase-qty').value = qty;
  if ($('#purchase-price')) $('#purchase-price').value = unitCost;
  purchaseLines.push({
    productId,
    sku: item.sku || productId,
    name: item.name,
    unitName: item.unitName || '',
    qty,
    unitCost,
  });
  renderPurchaseLines();
}
