/* M4: Tra cứu nhanh khách hàng theo SĐT tại POS (kết nối apiState.customers từ SQLite). */
'use strict';

const customerSearchState = { query: '', customerId: null, activeIndex: -1 };
const phoneDigits = (value) => String(value || '').replace(/\D/g, '');

function customerLookupHTML() {
  const customers = apiState.customers || [];
  const customer = customers.find((c) => c.id === posCart.customerId && c.active);
  const customerId = customer?.id || '';
  if (customerSearchState.customerId !== customerId) {
    customerSearchState.customerId = customerId;
    customerSearchState.query = customer?.phone || '';
    customerSearchState.activeIndex = -1;
  }
  return `<div class="customer-lookup">
    <label class="field" for="customer-phone-search"><span>Khách hàng (tìm theo SĐT)</span></label>
    <div class="cart-customer">
      <div class="customer-search-field">
        ${icon('search')}
        <input id="customer-phone-search" type="tel" inputmode="tel"
          value="${e(customerSearchState.query)}" placeholder="Nhập SĐT khách hàng…"
          autocomplete="off" role="combobox" aria-autocomplete="list"
          aria-expanded="false" aria-controls="customer-phone-results" aria-describedby="customer-phone-status">
        <div id="customer-phone-results" class="customer-phone-results" role="listbox" aria-label="Khách hàng trùng số điện thoại" hidden></div>
      </div>
      ${ib('entity-new', 'plus', 'Thêm khách hàng mới', 'data-type="customers"')}
    </div>
    <div id="customer-phone-status" class="customer-phone-status" aria-live="polite">
      ${customer ? selectedCustomerHTML(customer) : '<span class="muted">Khách lẻ · Chưa gắn hồ sơ thành viên</span>'}
    </div>
  </div>`;
}

function selectedCustomerHTML(customer) {
  return `<span class="customer-selected">${icon('user')}<span><strong>${e(customer.name)}</strong><small>${e(customer.phone)}</small></span>${ib('customer-clear', 'close', 'Bỏ chọn khách hàng')}</span>`;
}

function matchingPhoneCustomers(query) {
  const digits = phoneDigits(query);
  if (!digits || /[^\d\s+().-]/.test(query)) return [];
  return (apiState.customers || []).filter((c) => c.active && phoneDigits(c.phone).startsWith(digits));
}

function hideCustomerSuggestions() {
  const list = $('#customer-phone-results'),
    input = $('#customer-phone-search');
  if (list) {
    list.hidden = true;
    list.innerHTML = '';
  }
  if (input) {
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }
  customerSearchState.activeIndex = -1;
}

function renderCustomerSuggestions() {
  const list = $('#customer-phone-results'),
    input = $('#customer-phone-search');
  if (!list || !input) return;
  const matches = matchingPhoneCustomers(input.value);
  if (!matches.length) {
    hideCustomerSuggestions();
    if (!posCart.customerId) {
      $('#customer-phone-status').innerHTML = input.value.trim()
        ? '<span class="muted">Không có khách trùng SĐT · Nhấn + để thêm mới</span>'
        : '<span class="muted">Khách lẻ · Chưa gắn hồ sơ thành viên</span>';
    }
    return;
  }
  customerSearchState.activeIndex = -1;
  input.removeAttribute('aria-activedescendant');
  list.innerHTML =
    matches
      .slice(0, 8)
      .map(
        (c, index) => `<button type="button"
    id="customer-phone-option-${index}" role="option" aria-selected="false"
    data-action="customer-select" data-id="${e(c.id)}">
    <span><strong>${e(c.phone)}</strong><small>${e(c.name)}</small></span>${icon('plus')}
  </button>`,
      )
      .join('') +
    (matches.length > 8
      ? `<p class="sub">Còn ${matches.length - 8} khách trùng số · Nhập tiếp để thu hẹp</p>`
      : '');
  list.hidden = false;
  input.setAttribute('aria-expanded', 'true');
  if (!posCart.customerId) {
    $('#customer-phone-status').textContent = `${matches.length} khách trùng số · Chọn khách để gắn hóa đơn`;
  }
}

function searchCustomerPhone(input) {
  const query = input.value;
  const customer = (apiState.customers || []).find((c) => c.id === posCart.customerId);
  if (customer && phoneDigits(query) !== phoneDigits(customer.phone)) {
    posCart.customerId = '';
    customerSearchState.customerId = '';
    $('#customer-phone-status').innerHTML = '<span class="muted">Khách lẻ · Chưa gắn hồ sơ thành viên</span>';
  }
  customerSearchState.query = query;
  renderCustomerSuggestions();
}

function selectPhoneCustomer(customerId) {
  const customer = (apiState.customers || []).find((c) => c.id === customerId && c.active);
  if (!customer) throw new Error('Khách hàng không còn hoạt động.');
  posCart.customerId = customer.id;
  hideCustomerSuggestions();
  render();
}

function clearPhoneCustomer() {
  posCart.customerId = '';
  customerSearchState.query = '';
  customerSearchState.customerId = '';
  if ($('#customer-phone-search')) $('#customer-phone-search').value = '';
  hideCustomerSuggestions();
  render();
}

document.addEventListener('focusin', (event) => {
  if (event.target.id === 'customer-phone-search') renderCustomerSuggestions();
});
document.addEventListener('focusout', (event) => {
  if (event.target.closest('.customer-lookup') && !event.relatedTarget?.closest('.customer-lookup'))
    hideCustomerSuggestions();
});
document.addEventListener('keydown', (event) => {
  if (event.target.id !== 'customer-phone-search') return;
  const list = $('#customer-phone-results');
  if (event.key === 'Escape') {
    event.preventDefault();
    hideCustomerSuggestions();
    return;
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    if (list.hidden) renderCustomerSuggestions();
    const options = $$('[role="option"]', list);
    if (!options.length) return;
    const step = event.key === 'ArrowDown' ? 1 : -1;
    customerSearchState.activeIndex =
      customerSearchState.activeIndex < 0
        ? step > 0
          ? 0
          : options.length - 1
        : (customerSearchState.activeIndex + step + options.length) % options.length;
    options.forEach((option, index) =>
      option.setAttribute('aria-selected', String(index === customerSearchState.activeIndex)),
    );
    const active = options[customerSearchState.activeIndex];
    event.target.setAttribute('aria-activedescendant', active.id);
    active.scrollIntoView({ block: 'nearest' });
  }
  if (event.key === 'Enter' && !list.hidden) {
    const options = $$('[role="option"]', list);
    const chosen =
      options[customerSearchState.activeIndex] || (options.length === 1 ? options[0] : null);
    if (chosen) {
      event.preventDefault();
      chosen.click();
    }
  }
});
