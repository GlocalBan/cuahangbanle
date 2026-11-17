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

  function calculateProfitAndLoss(data = {}, days = 30) {
    const start = new Date();
    start.setDate(start.getDate() - days + 1);
    start.setHours(0, 0, 0, 0);
    const startKey = start.toISOString().slice(0, 10);

    const orders = (data.orders || []).filter(
      (o) => o.status !== 'cancelled' && (o.time || '').slice(0, 10) >= startKey,
    );
    const refunds = (data.returns || []).filter(
      (r) => r.status === 'approved' && (r.resolvedAt || r.time || '').slice(0, 10) >= startKey,
    );
    const audits = (data.audits || []).filter(
      (a) => (a.time || '').slice(0, 10) >= startKey,
    );

    const productsMap = new Map((data.products || []).map((p) => [p.id, p]));

    let grossRevenue = 0;
    let totalDiscounts = 0;
    let cogs = 0;

    orders.forEach((o) => {
      let orderGross = 0;
      (o.items || []).forEach((i) => {
        const p = productsMap.get(i.id);
        const cost = p ? (p.costPrice !== undefined ? p.costPrice : (p.cost || 0)) : 0;
        const itemGross = (i.price || 0) * (i.qty || 0);
        orderGross += itemGross;
        cogs += cost * (i.qty - (i.returnedQty || 0));
      });
      grossRevenue += orderGross;
      const orderDisc = (o.discount || 0) + (o.promotionDiscount || 0) + (o.voucherDiscount || 0);
      totalDiscounts += orderDisc;
    });

    if (grossRevenue < orders.reduce((s, o) => s + (o.total || 0), 0)) {
      grossRevenue = orders.reduce((s, o) => s + (o.total || 0), 0) + totalDiscounts;
    }

    const totalRefunds = refunds.reduce((s, r) => s + (r.amount || 0), 0);
    const netRevenue = Math.max(0, grossRevenue - totalDiscounts - totalRefunds);
    const grossProfit = netRevenue - cogs;

    let auditLoss = 0;
    let staffCompensation = 0;
    let auditSurplus = 0;

    audits.forEach((a) => {
      (a.items || []).forEach((i) => {
        const p = productsMap.get(i.id);
        const cost = p ? (p.costPrice !== undefined ? p.costPrice : (p.cost || 0)) : 0;
        const delta = i.delta !== undefined ? i.delta : (i.actual - i.previous);
        if (delta < 0) {
          const lossVal = Math.abs(delta) * cost;
          if (i.resolution === 'staff_compensation') {
            staffCompensation += lossVal;
          } else {
            auditLoss += lossVal;
          }
        } else if (delta > 0) {
          auditSurplus += delta * cost;
        }
      });
    });

    let damagedReturnLoss = 0;
    refunds.forEach((r) => {
      if (!r.restock || r.returnCondition === 'damaged_or_expired') {
        (r.items || []).forEach((i) => {
          const p = productsMap.get(i.id);
          const cost = p ? (p.costPrice !== undefined ? p.costPrice : (p.cost || 0)) : 0;
          damagedReturnLoss += (i.qty || 0) * cost;
        });
      }
    });

    const totalLoss = auditLoss + damagedReturnLoss;
    const netProfit = grossProfit - totalLoss + staffCompensation;

    return {
      days,
      ordersCount: orders.length,
      refundsCount: refunds.length,
      auditsCount: audits.length,
      grossRevenue,
      totalDiscounts,
      refunds: totalRefunds,
      netRevenue,
      cogs,
      grossProfit,
      auditLoss,
      damagedReturnLoss,
      totalLoss,
      staffCompensation,
      auditSurplus,
      netProfit,
    };
  }

  const api = { totals, calculateDiscounts, calculateProfitAndLoss };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(scope.Retail, api);
})(globalThis);
