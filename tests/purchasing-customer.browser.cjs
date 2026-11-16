'use strict';

module.exports = async function testPurchasingAndCustomerLookup({
  evaluate,
  click,
  fill,
  submit,
  check,
  command,
  screenshot,
}) {
  // Use a real pointer click so moving focus from the input to a suggestion is covered.
  async function pointerClick(selector) {
    const point = await evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error('Missing suggestion');
      el.scrollIntoView({block:'center'});
      const r = el.getBoundingClientRect();
      return {x:r.left+r.width/2,y:r.top+r.height/2};
    })()`);
    await command('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      ...point,
      button: 'left',
      clickCount: 1,
    });
    await command('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      ...point,
      button: 'left',
      clickCount: 1,
    });
  }

  await evaluate(`navigate('pos');document.querySelector('#customer-phone-search').focus()`);
  await fill('#customer-phone-search', '09');
  await check(
    `!document.querySelector('#customer-phone-results').hidden && document.querySelectorAll('#customer-phone-results [role=option]').length===5`,
    'phone prefix shows only matching customers',
  );
  await fill('#customer-phone-search', '090');
  await check(
    `document.querySelectorAll('#customer-phone-results [role=option]').length===2`,
    'customer suggestions narrow as digits are typed',
  );
  await fill('#customer-phone-search', '0903');
  await check(
    `document.querySelectorAll('#customer-phone-results [role=option]').length===1 && document.activeElement.id==='customer-phone-search'`,
    'typing keeps focus and narrows to one customer',
  );
  await screenshot('06-phone-search.png');
  await fill('#customer-phone-search', '0903999999');
  await check(
    `document.querySelector('#customer-phone-results').hidden && !document.querySelector('#customer-phone-results [role=option]')`,
    'unmatched digits hide and remove stale suggestions',
  );
  await fill('#customer-phone-search', '0903');
  await pointerClick('[data-action="customer-select"]');
  await check(
    `store.data.draft.customerId==='KH001' && document.querySelector('#customer-phone-status').textContent.includes('Nguyễn Minh Anh') && document.querySelector('#customer-phone-results').hidden`,
    'pointer selects the matching customer on the invoice',
  );
  await fill('#customer-phone-search', '090999');
  await check(
    `store.data.draft.customerId==='' && !document.querySelector('.customer-selected') && JSON.parse(localStorage.getItem(Retail.KEY)).draft.customerId===''`,
    'editing a selected phone detaches the old customer immediately',
  );
  await fill('#customer-phone-search', '09');
  await evaluate(
    `document.querySelector('#customer-phone-search').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true}));document.querySelector('#customer-phone-search').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));`,
  );
  await check(
    `store.data.customers.find(c=>c.id===store.data.draft.customerId).phone==='0909999888'`,
    'arrow keys and Enter select the highlighted customer',
  );
  await click('[data-action="customer-clear"]');
  await check(
    `store.data.draft.customerId==='' && document.querySelector('#customer-phone-search').value==='' && document.querySelector('#customer-phone-results').hidden`,
    'clear returns the invoice to a walk-in customer',
  );
  await fill('#customer-phone-search', '0903');
  await click('[data-action="customer-select"]');
  await command('Page.reload');
  // Reload completion is observed through the freshly created search control.
  for (let n = 0; n < 60; n++) {
    if (
      await evaluate(`document.readyState==='complete' && typeof customerLookupHTML==='function'`)
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await evaluate(`navigate('pos')`);
  await check(
    `store.data.draft.customerId==='KH001' && document.querySelector('#customer-phone-search').value==='0903123458'`,
    'selected customer survives reload',
  );
  await click('[data-action="customer-clear"]');

  await evaluate(`navigate('purchases')`);
  await check(
    `document.querySelectorAll('.restock-card').length===3`,
    'purchase page suggests all active low stock items',
  );
  await screenshot('07-restock-suggestions.png');
  await click('[data-action="purchase-restock"][data-id="SP003"]');
  await check(
    `document.querySelector('#purchase-supplier').value==='NCC003' && purchaseLines.length===1 && purchaseLines[0].id==='SP003' && purchaseLines[0].qty===18 && store.data.products.find(p=>p.id==='SP003').stock===12`,
    'restock action chooses supplier, product and quantity without changing stock',
  );
  await fill('[data-purchase-field="qty"]', '24');
  await evaluate(
    `document.querySelector('[data-purchase-field="qty"]').dispatchEvent(new Event('change',{bubbles:true}))`,
  );
  await check(
    `purchaseLines[0].qty===24 && document.querySelector('#purchase-lines').textContent.includes(money(24*store.data.products.find(p=>p.id==='SP003').cost))`,
    'suggested quantity can be edited before saving',
  );
  await submit('purchase-form');
  await check(
    `store.data.purchases[0].items[0].id==='SP003' && store.data.purchases[0].items[0].qty===24 && store.data.products.find(p=>p.id==='SP003').stock===12 && restockQuantity(store.data.products.find(p=>p.id==='SP003'))===0`,
    'pending restocks reduce subsequent suggestions and do not add inventory',
  );
  await click('[data-action="purchase-new"]');
  await evaluate(
    `const supplierSelect=document.querySelector('#purchase-supplier');supplierSelect.value='NCC003';supplierSelect.dispatchEvent(new Event('change',{bubbles:true}));`,
  );
  await click('[data-action="purchase-add-suggestion"][data-id="SP006"]');
  await check(
    `purchaseLines.length===1 && purchaseLines[0].id==='SP006' && purchaseLines[0].qty===22 && document.querySelector('[data-action="purchase-add-suggestion"][data-id="SP006"]').disabled`,
    'supplier suggestions add a line and prevent duplicates',
  );
  await click('[data-action="purchase-add-suggestion"][data-id="SP008"]');
  await check(
    `purchaseLines.length===2`,
    'multiple low stock items can share one supplier purchase',
  );
  await evaluate(
    `const supplierSelect2=document.querySelector('#purchase-supplier');supplierSelect2.value='NCC001';supplierSelect2.dispatchEvent(new Event('change',{bubbles:true}));`,
  );
  await check(
    `purchaseLines.length===0 && document.querySelector('#purchase-restock-suggestions').hidden`,
    'changing supplier clears incompatible lines and suggestions',
  );
  await click('[data-action="close-modal"]');
  await evaluate(`purchaseDetail(store.data.purchases[0].id)`);
  await click('[data-action="purchase-receive"]');
  await click('[data-action="confirm"]');
  await click('[data-action="close-modal"]');
  await check(
    `store.data.products.find(p=>p.id==='SP003').stock===36 && !document.querySelector('[data-action="purchase-restock"][data-id="SP003"]')`,
    'receiving stock removes the replenished product from suggestions',
  );
};
