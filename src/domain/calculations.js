(function (scope) {
  'use strict';
  const { integer, assert } =
    typeof module !== 'undefined' && module.exports ? require('./config.js') : scope.Retail;
  function totals(items, discount = 0, taxRate = 0) {
    const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
    discount = integer(discount, 'Giảm giá');
    assert(discount <= subtotal, 'Giảm giá không được vượt quá tạm tính.');
    taxRate = integer(taxRate, 'Thuế suất', 0, 100);
    const tax = Math.round(((subtotal - discount) * taxRate) / 100);
    return { subtotal, discount, taxRate, tax, total: subtotal - discount + tax };
  }

  const api = { totals };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(scope.Retail, api);
})(globalThis);
