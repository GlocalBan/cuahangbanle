/* Shared UI primitives: Notyf v3.10.0 offline notifications, modals, filters, pagination & confirmations. */
'use strict';

let _notyfInstance = null;
function getNotyf() {
  if (_notyfInstance) return _notyfInstance;
  if (typeof window !== 'undefined' && typeof window.Notyf === 'function') {
    _notyfInstance = new window.Notyf({
      duration: 3800,
      ripple: false,
      dismissible: true,
      position: { x: 'right', y: 'bottom' },
      types: [
        {
          type: 'success',
          background: '#059669',
          icon: false,
        },
        {
          type: 'error',
          background: '#dc2626',
          duration: 5000,
          icon: false,
        },
      ],
    });
  }
  return _notyfInstance;
}

function notify(message, error = false) {
  const notyf = getNotyf();
  if (notyf) {
    if (error) notyf.error(String(message || 'Thao tác thất bại.'));
    else notyf.success(String(message || 'Thành công.'));
    return;
  }
  const n = document.createElement('div');
  n.className = 'toast' + (error ? ' error' : '');
  n.textContent = message;
  $('#toasts')?.append(n);
  setTimeout(() => n.remove(), 4200);
}

function showModal(title, html, wide = false) {
  const modal = $('#modal');
  modal.className = wide ? 'wide-modal' : '';
  modal.style.width = wide ? '800px' : '540px';
  modal.style.maxWidth = 'calc(100vw - 28px)';
  modal.innerHTML = `<div class="modal-header"><h2 id="modal-title">${title}</h2>${ib('close-modal', 'close', 'Đóng hộp thoại')}</div>${html}`;
  hydrateIcons();
  if (!modal.open) modal.showModal();
  setTimeout(() => {
    const el = $('input:not([type=hidden]),select,button', modal);
    el?.focus();
  }, 30);
}

function closeModal() {
  $('#modal').close();
  modalContext = {};
}

function dataForm(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function heading(eyebrow, title, subtitle, actions = '') {
  return `<div class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${subtitle}</p></div><div class="row gap8 wrap">${actions}</div></div>`;
}

function filterInput(key, placeholder) {
  return `<input id="filter-${key}" data-filter="${key}" value="${e(filters[key] || '')}" placeholder="${placeholder}" aria-label="${placeholder}">`;
}

function filterSelect(key, options) {
  return `<select id="filter-${key}" data-filter="${key}" aria-label="Lọc ${key}">${options.map(([v, t]) => `<option value="${e(v)}" ${(filters[key] || '') === v ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
}

function paginate(list, key) {
  const size = 10,
    totalPages = Math.max(1, Math.ceil(list.length / size));
  const current = Math.min(pagination[key] || 1, totalPages);
  pagination[key] = current;
  return {
    items: list.slice((current - 1) * size, current * size),
    foot: `<div class="table-foot"><span>${list.length ? `${(current - 1) * size + 1}–${Math.min(current * size, list.length)}` : '0'} / ${number(list.length)} kết quả</span><div class="row gap8">${action('paginate', '←', '', 'small', `data-key="${key}" data-delta="-1" ${current === 1 ? 'disabled' : ''}`)}<span>Trang ${current} / ${totalPages}</span>${action('paginate', '→', '', 'small', `data-key="${key}" data-delta="1" ${current === totalPages ? 'disabled' : ''}`)}</div></div>`,
  };
}

function confirmation(title, body, onConfirm) {
  modalContext = { type: 'confirm', onConfirm };
  showModal(
    title,
    `<div class="modal-content"><p class="confirm-body">${body}</p></div><div class="modal-footer">${action('close-modal', 'Hủy')}${action('confirm', 'Xác nhận', 'check', 'primary')}</div>`,
  );
}
