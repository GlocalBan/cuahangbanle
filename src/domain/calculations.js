(function (scope) {
  'use strict';
  const { integer, assert } =
    typeof module !== 'undefined' && module.exports ? require('./config.js') : scope.Retail;

  function calculateDiscounts(itemsOrOpts = [], manualDiscountOrOpts = 0, maybeOpts = {}) {
    let items, promotion, voucher, manualDiscount, products;
    if (Array.isArray(itemsOrOpts)) {
      items = itemsOrOpts;
      if (typeof manualDiscountOrOpts === 'object' && manualDiscountOrOpts !== null) {
        maybeOpts = manualDiscountOrOpts;
        manualDiscount = maybeOpts.manualDiscount || 0;
      } else {
        manualDiscount = manualDiscountOrOpts || 0;
      }
      promotion = maybeOpts.promotion || null;
      voucher = maybeOpts.voucher || null;
      products = maybeOpts.products || [];
    } else {
      const opts = itemsOrOpts || {};
      items = opts.items || [];
      promotion = opts.promotion || null;
      voucher = opts.voucher || null;
      manualDiscount = opts.manualDiscount || 0;
      products = opts.products || [];
    }
    const subtotal = items.reduce((s, i) => s + (i.price || 0) * (i.qty || 0), 0);
    let promotionDiscount = 0;
    let voucherDiscount = 0;

    if (promotion && promotion.active) {
      if (subtotal >= (promotion.minOrderAmount || 0)) {
        if (promotion.nearExpiryOnly) {
          const nearExpiryItems = items.filter((i) => {
            const p = products.find((x) => x.id === i.id);
            return (
              (p && p.inNearExpiryPromo) ||
              (promotion.productIds && promotion.productIds.includes(i.id))
            );
          });
          const nearSubtotal = nearExpiryItems.reduce((s, i) => s + i.price * i.qty, 0);
          if (promotion.type === 'percent') {
            promotionDiscount = Math.round((nearSubtotal * promotion.value) / 100);
          } else {
            promotionDiscount = Math.min(nearSubtotal, promotion.value);
          }
        } else if (promotion.type === 'percent') {
          promotionDiscount = Math.round((subtotal * promotion.value) / 100);
        } else {
          promotionDiscount = promotion.value;
        }
        if (promotion.maxDiscount) {
          promotionDiscount = Math.min(promotionDiscount, promotion.maxDiscount);
        }
      }
    }

    if (voucher && voucher.active) {
      if (subtotal >= (voucher.minOrderAmount || 0)) {
        if (voucher.type === 'percent') {
          voucherDiscount = Math.round((subtotal * voucher.value) / 100);
        } else {
          voucherDiscount = voucher.value;
        }
        if (voucher.maxDiscount) {
          voucherDiscount = Math.min(voucherDiscount, voucher.maxDiscount);
        }
      }
    }

    const totalDiscount = Math.min(
      subtotal,
      promotionDiscount + voucherDiscount + (manualDiscount || 0),
    );
    return {
      subtotal,
      promotionDiscount,
      voucherDiscount,
      manualDiscount: manualDiscount || 0,
      totalDiscount,
    };
  }

  function totals(items, discount = 0, taxRate = 0, opts = {}) {
    const subtotal = items.reduce((s, i) => s + (i.price || 0) * (i.qty || 0), 0);
    let promoDiscount = 0;
    let voucherDiscount = 0;
    let totalDiscount = 0;

    if (typeof discount === 'object' && discount !== null) {
      opts = discount;
      discount = opts.discount || 0;
    }

    if (opts.promotion || opts.voucher) {
      const res = calculateDiscounts({
        items,
        promotion: opts.promotion,
        voucher: opts.voucher,
        manualDiscount: discount || 0,
        products: opts.products || [],
      });
      promoDiscount = res.promotionDiscount;
      voucherDiscount = res.voucherDiscount;
      totalDiscount = res.totalDiscount;
    } else {
      totalDiscount = integer(discount, 'Giảm giá');
      assert(totalDiscount <= subtotal, 'Giảm giá không được vượt quá tạm tính.');
    }

    taxRate = integer(taxRate, 'Thuế suất', 0, 100);
    const tax = Math.round(((subtotal - totalDiscount) * taxRate) / 100);
    return {
      subtotal,
      discount: totalDiscount,
      promotionDiscount: promoDiscount,
      voucherDiscount: voucherDiscount,
      taxRate,
      tax,
      total: subtotal - totalDiscount + tax,
    };
  }

  const api = { totals, calculateDiscounts };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(scope.Retail, api);
})(globalThis);
