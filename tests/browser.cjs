'use strict';
// Browser checks use the installed Microsoft Edge through the DevTools protocol.
// No browser package or network dependency is required.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { createServer } = require('../server');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function main() {
  const server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const browserPath =
    process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'retailflow-browser-'));
  const output = path.join(__dirname, '..', 'preview');
  fs.mkdirSync(output, { recursive: true });
  const child = spawn(
    browserPath,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--window-size=1440,1000',
      'about:blank',
    ],
    { windowsHide: true, stdio: 'ignore' },
  );
  let ws;
  const errors = [];
  let sequence = 0;
  const pending = new Map();
  child.on('error', (e) => errors.push(e.message));
  try {
    const active = path.join(profile, 'DevToolsActivePort');
    for (let n = 0; n < 100 && !fs.existsSync(active); n++) await delay(100);
    if (!fs.existsSync(active)) throw new Error('Edge did not start. ' + errors.join('; '));
    const debugPort = fs.readFileSync(active, 'utf8').split('\n')[0];
    const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((r, j) => {
      ws.addEventListener('open', r, { once: true });
      ws.addEventListener('error', j, { once: true });
    });
    ws.addEventListener('message', (event) => {
      const data = JSON.parse(event.data);
      if (data.id) {
        const p = pending.get(data.id);
        if (p) {
          clearTimeout(p.timeout);
          pending.delete(data.id);
          data.error ? p.reject(new Error(JSON.stringify(data.error))) : p.resolve(data.result);
        }
      } else if (data.method === 'Runtime.exceptionThrown')
        errors.push(
          data.params.exceptionDetails.exception?.description || data.params.exceptionDetails.text,
        );
    });
    const command = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++sequence;
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(new Error('CDP timeout: ' + method));
        }, 15000);
        pending.set(id, { resolve, reject, timeout });
        ws.send(JSON.stringify({ id, method, params }));
      });
    const evaluate = async (expression) => {
      const r = await command('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (r.exceptionDetails)
        throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    };
    const click = (selector) =>
      evaluate(
        `(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw new Error('Missing selector: '+${JSON.stringify(selector)});el.click();})()`,
      );
    const fill = (selector, value) =>
      evaluate(
        `(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw new Error('Missing field');el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('input',{bubbles:true}));})()`,
      );
    const submit = (id) =>
      evaluate(`document.getElementById(${JSON.stringify(id)}).requestSubmit()`);
    const check = async (expression, label) => {
      assert.ok(await evaluate(expression), label);
      console.log('PASS ' + label);
    };
    const screenshot = async (name) => {
      const result = await command('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
      });
      fs.writeFileSync(path.join(output, name), Buffer.from(result.data, 'base64'));
    };
    await command('Runtime.enable');
    await command('Page.enable');
    await command('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await command('Page.navigate', { url: `http://127.0.0.1:${port}` });
    for (let n = 0; n < 60; n++) {
      if (await evaluate(`!!document.querySelector('#login-form')`)) break;
      await delay(100);
    }
    await screenshot('01-login.png');
    await submit('login-form');
    await check(`!!document.querySelector('h1') && page==='dashboard'`, 'admin login');
    await screenshot('02-dashboard.png');
    await evaluate(`for(const p of pages)navigate(p[0]);navigate('pos')`);
    await check(
      `document.querySelectorAll('.product-card').length===29`,
      'all management pages render, 29 products',
    );
    await click('[data-action="add-cart"]');
    await click('[data-action="cart-qty"][data-delta="1"]');
    await check(`store.data.draft.items[0].qty===2`, 'cart quantity increase');
    await click('[data-action="cart-qty"][data-delta="-1"]');
    await check(`store.data.draft.items[0].qty===1`, 'cart quantity decrease');
    await click('[data-action="hold"]');
    await click('[data-action="held-orders"]');
    await click('[data-action="restore-held"]');
    await check(
      `store.data.draft.items.length===1 && store.data.held.length===0`,
      'save and restore held invoice',
    );
    await screenshot('03-pos.png');
    const stockBefore = await evaluate(`store.data.products[0].stock`);
    await click('[data-action="checkout"]');
    await fill('#cash-input', 100000);
    await submit('checkout-form');
    await check(
      `store.data.orders.length===29 && store.data.orders[0].payment==='cash' && store.data.products[0].stock===${stockBefore - 1}`,
      'cash payment persists and reduces stock',
    );
    await screenshot('04-invoice.png');
    await click('[data-action="close-modal"]');
    for (const method of ['transfer', 'card']) {
      await click('[data-action="add-cart"]');
      await click('[data-action="checkout"]');
      await click(`[data-method="${method}"]`);
      await fill('[name="paymentRef"]', 'TEST-' + method);
      await click('[name="confirmed"]');
      await submit('checkout-form');
      await check(
        `store.data.orders[0].payment===${JSON.stringify(method)} && store.data.orders[0].paymentRef===${JSON.stringify('TEST-' + method)}`,
        method + ' payment recorded',
      );
      await click('[data-action="close-modal"]');
    }
    await evaluate(`navigate('orders');orderDetail(store.data.orders[0].id)`);
    await click('[data-action="return-new"]');
    await fill('[data-return-id]', 1);
    await fill('[name="reason"]', 'Trả hàng kiểm thử');
    await submit('return-form');
    await check(`store.data.returns[0].status==='pending'`, 'return request created');
    await click('[data-action="return-approve"]');
    await click('[data-action="confirm"]');
    await check(
      `store.data.returns[0].status==='approved' && store.data.orders[0].status==='refunded'`,
      'return approval updates invoice',
    );
    await click('[data-action="close-modal"]');
    await evaluate(`navigate('inventory')`);
    await click('[data-action="audit-new"]');
    await fill('[name="counted"]', 120);
    await fill('[name="reason"]', 'Kiểm kê thử');
    await submit('audit-form');
    await click('[data-tab="audits"]');
    await check(
      `document.querySelector('#content').textContent.includes('Kiểm kê thử')`,
      'inventory audit history renders actual count',
    );
    await evaluate(`navigate('purchases')`);
    await click('[data-action="purchase-new"]');
    await fill('#purchase-qty', 5);
    await click('[data-action="purchase-line-add"]');
    await submit('purchase-form');
    await click('[data-action="purchase-detail"]');
    await click('[data-action="purchase-receive"]');
    await click('[data-action="confirm"]');
    await check(
      `store.data.purchases[0].status==='received' && store.data.products[0].stock===125`,
      'purchase receipt updates stock once',
    );
    await click('[data-action="close-modal"]');
    await evaluate(`navigate('customers')`);
    await click('[data-action="entity-new"]');
    await fill('[name="name"]', 'Khách kiểm thử');
    await fill('[name="phone"]', '0909999888');
    await submit('entity-form');
    await check(`store.data.customers.some(c=>c.name==='Khách kiểm thử')`, 'customer create form');
    await fill('#global-search', 'Khách kiểm thử');
    await fill('#global-search', 'san pham');
    await check(
      `!!document.querySelector('#global-results button') && !document.querySelector('#global-results').hidden`,
      'global search results visible',
    );
    await evaluate(`navigate('orders')`);
    await fill('#filter-orders', 'HD-DEMO');
    await check(`document.querySelectorAll('tbody tr').length===10`, 'order search and pagination');
    await evaluate(`filters={};navigate('products')`);
    await fill('#filter-products', 'vinamilk');
    await check(
      `document.querySelectorAll('tbody tr').length===1`,
      'accent insensitive product search',
    );
    await command('Page.reload');
    await delay(350);
    await check(
      `!!store.user && store.data.orders.length===31 && store.data.products[0].stock===125`,
      'reload preserves session, invoices, inventory',
    );
    await command('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await evaluate(`navigate('pos')`);
    await delay(100);
    await screenshot('05-mobile-pos.png');
    await check(
      `document.documentElement.scrollWidth<=window.innerWidth+1`,
      'mobile POS fits viewport',
    );
    await click('[data-action="mobile-menu"]');
    await check(
      `document.querySelector('.sidebar').classList.contains('open')`,
      'mobile navigation opens',
    );
    await evaluate(`navigate('dashboard')`);
    await check(
      `!document.querySelector('.sidebar').classList.contains('open')`,
      'mobile navigation closes after selection',
    );
    await command('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await click('[data-action="logout"]');
    await fill('[name="username"]', 'nhanvien');
    await fill('[name="password"]', '123456');
    await submit('login-form');
    await check(
      `page==='pos' && !document.querySelector('.nav-item[data-page="settings"]')`,
      'cashier role restricts admin screens',
    );
    await click('[data-action="logout"]');
    await fill('[name="username"]', 'kho');
    await fill('[name="password"]', '123456');
    await submit('login-form');
    await check(
      `page==='products' && !document.querySelector('.nav-item[data-page="pos"]')`,
      'warehouse role restricts selling',
    );
    assert.deepEqual(errors, [], 'No uncaught browser errors');
    console.log('PASS no uncaught browser errors');
    console.log('Screenshots saved to preview/.');
  } finally {
    if (ws) {
      try {
        ws.send(JSON.stringify({ id: ++sequence, method: 'Browser.close' }));
      } catch {}
      ws.close();
    }
    child.kill();
    server.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
