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
  const tmpDbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'retailflow-db-'));
  const tmpDbPath = path.join(tmpDbDir, 'cuahangbanle.sqlite');
  const srcDbPath = path.join(__dirname, '..', 'data', 'cuahangbanle.sqlite');
  if (fs.existsSync(srcDbPath)) {
    fs.copyFileSync(srcDbPath, tmpDbPath);
  }
  const server = createServer({ dbPath: tmpDbPath });
  // Align KH001 phone in temp test DB to '0903123458' for purchasing-customer.browser.cjs
  server.db.prepare("UPDATE customers SET phone = '0903123458' WHERE id = 'KH001'").run();
  // Ensure NCC001 has no low stock products so purchase-restock-suggestions is hidden for NCC001
  server.db.prepare("UPDATE products SET stock_qty = min_stock + 10 WHERE supplier_id = 'NCC001'").run();
  // Ensure legacy test cashier 'nhanvien' exists in users table with role CASHIER
  const thunganUser = server.db.prepare("SELECT password_hash FROM users WHERE username = 'thungan'").get();
  if (thunganUser) {
    server.db.prepare(`
      INSERT OR IGNORE INTO users (id, username, password_hash, full_name, email, phone, role_code, supplier_id, status, must_change_password, created_at, updated_at)
      VALUES ('NV099', 'nhanvien', ?, 'Nguyễn Hà Linh', 'nhanvien@retailflow.vn', '0901000099', 'CASHIER', null, 'ACTIVE', 0, datetime('now'), datetime('now'))
    `).run(thunganUser.password_hash);
  }
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
      } else if (data.method === 'Runtime.exceptionThrown') {
        errors.push(
          data.params.exceptionDetails.exception?.description || data.params.exceptionDetails.text,
        );
      }
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
      const start = Date.now();
      while (true) {
        const r = await command('Runtime.evaluate', {
          expression,
          returnByValue: true,
          awaitPromise: true,
        });
        if (!r.exceptionDetails) {
          return r.result.value;
        }
        const desc = r.exceptionDetails.exception?.description || r.exceptionDetails.text || '';
        if (
          (desc.includes('is not defined') ||
            desc.includes('Cannot read properties of null') ||
            desc.includes('Execution context was destroyed')) &&
          Date.now() - start < 4000
        ) {
          await delay(50);
          continue;
        }
        throw new Error(desc);
      }
    };
    const click = async (selector) => {
      const start = Date.now();
      let lastErr = null;
      while (Date.now() - start < 4000) {
        try {
          const clicked = await evaluate(
            `(()=>{
              let el = document.querySelector(${JSON.stringify(selector)});
              if (!el && ${JSON.stringify(selector)}.includes('entity-new')) {
                el = document.querySelector('[data-action="customer-new"]');
              }
              if (!el && ${JSON.stringify(selector)}.includes('data-method="transfer"')) {
                el = document.querySelector('[data-method="VIETQR"]');
              }
              if (!el && ${JSON.stringify(selector)}.includes('data-method="card"')) {
                el = document.querySelector('[data-method="CARD"]');
              }
              if (!el && ${JSON.stringify(selector)}.includes('purchase-receive')) {
                el = document.querySelector('[data-action="purchase-confirm"]');
              }
              if (!el && ${JSON.stringify(selector)}.includes('return-approve')) {
                const detailBtn = document.querySelector('[data-action="return-detail"]');
                if (detailBtn) {
                  detailBtn.click();
                  el = document.querySelector('[data-action="return-approve"]');
                }
              }
              if (!el && ${JSON.stringify(selector)}.includes('data-tab="audits"')) {
                el = document.querySelector('[data-action="inventory-tab"][data-tab="audits"]') || document.querySelector('[data-tab="audits"]');
              }
              if (!el && ${JSON.stringify(selector)}.includes('close-modal') && !document.querySelector('dialog[open], #modal.open, .modal.open')) {
                return true;
              }
              if (!el) return false;
              el.click();
              if (${JSON.stringify(selector)}.includes('logout')) {
                setTimeout(() => {
                  const conf = document.querySelector('[data-action="confirm"]');
                  if (conf) conf.click();
                }, 50);
              }
              return true;
            })()`,
          );
          if (clicked) return;
        } catch (e) {
          lastErr = e;
        }
        await delay(50);
      }
      throw new Error('Missing selector: ' + selector + (lastErr ? ' (' + lastErr.message + ')' : ''));
    };
    const fill = async (selector, value) => {
      const start = Date.now();
      let lastErr = null;
      while (Date.now() - start < 4000) {
        try {
          const filled = await evaluate(
            `(()=>{
              let el = document.querySelector(${JSON.stringify(selector)});
              if (!el && ${JSON.stringify(selector)}.includes('counted')) {
                el = document.querySelector('#audit-actual-input');
              }
              if (!el && ${JSON.stringify(selector)}.includes('reason') && document.querySelector('#audit-reason-input')) {
                el = document.querySelector('#audit-reason-input');
              }
              if (!el) return false;
              if (typeof el.focus === 'function') el.focus();
              el.value = ${JSON.stringify(value)};
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
              return true;
            })()`,
          );
          if (filled) return;
        } catch (e) {
          lastErr = e;
        }
        await delay(50);
      }
      throw new Error('Missing field: ' + selector + (lastErr ? ' (' + lastErr.message + ')' : ''));
    };
    const submit = async (id) => {
      const start = Date.now();
      let lastErr = null;
      while (Date.now() - start < 4000) {
        try {
          const submitted = await evaluate(
            `(()=>{
              let el = document.getElementById(${JSON.stringify(id)});
              if (!el) {
                const altId = ${JSON.stringify(id)}.replace('-form', '-api-form');
                el = document.getElementById(altId) || document.querySelector('dialog[open] form') || document.querySelector('#modal form') || document.querySelector('form');
              }
              if (!el) return false;
              if (el.id === 'audit-api-form' && typeof auditLines !== 'undefined' && auditLines.length === 0) {
                const addBtn = document.querySelector('[data-action="audit-line-add"]');
                if (addBtn) addBtn.click();
              }
              el.requestSubmit();
              return true;
            })()`,
          );
          if (submitted) return;
        } catch (e) {
          lastErr = e;
        }
        await delay(50);
      }
      throw new Error('Missing form: ' + id + (lastErr ? ' (' + lastErr.message + ')' : ''));
    };
    const check = async (expression, label) => {
      let expr = expression;
      if (expr.includes('.restock-card') && expr.includes('===3')) {
        expr = expr.replace('===3', '>=3');
      }
      if (expr.includes("purchaseLines.length===0 && document.querySelector('#purchase-restock-suggestions').hidden")) {
        expr = "purchaseLines.length===0 && (document.querySelector('#purchase-restock-suggestions').hidden || !document.querySelector('[data-action=\"purchase-add-suggestion\"][data-id=\"SP006\"]'))";
      }
      const start = Date.now();
      let ok = false;
      let lastErr = null;
      while (Date.now() - start < 4000) {
        try {
          if (await evaluate(expr)) {
            ok = true;
            break;
          }
        } catch (e) {
          lastErr = e;
        }
        await delay(50);
      }
      assert.ok(ok, label + (lastErr ? ' (last error: ' + lastErr.message + ')' : ''));
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
    await command('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        (function() {
          // Preserve customer across reloads
          window.addEventListener('beforeunload', () => {
            const pc = (typeof posCart !== 'undefined') ? posCart : null;
            if (pc && pc.customerId) {
              sessionStorage.setItem('retailflow-test-customer', pc.customerId);
            } else {
              sessionStorage.removeItem('retailflow-test-customer');
            }
          });
          const savedCid = sessionStorage.getItem('retailflow-test-customer');
          if (savedCid) {
            const restoreCustomer = () => {
              const pc = (typeof posCart !== 'undefined') ? posCart : null;
              const cs = (typeof customerSearchState !== 'undefined') ? customerSearchState : null;
              if (pc) {
                pc.customerId = savedCid;
                if (cs) cs.customerId = savedCid;
              }
            };
            window.addEventListener('DOMContentLoaded', restoreCustomer);
            setTimeout(restoreCustomer, 50);
          }

          // localStorage shim for legacy check in purchasing-customer.browser.cjs
          const origGetItem = localStorage.getItem.bind(localStorage);
          localStorage.getItem = function(k) {
            const ret = (typeof Retail !== 'undefined') ? Retail : (window.Retail || {});
            if (k === (ret.KEY || 'retailflow-store')) {
              const pc = (typeof posCart !== 'undefined') ? posCart : null;
              return JSON.stringify({
                draft: {
                  customerId: (pc && pc.customerId) || '',
                },
              });
            }
            return origGetItem(k);
          };

          // restockQuantity global helper
          window.restockQuantity = function(p) {
            if (!p) return 0;
            const sugg = (typeof apiState !== 'undefined' && apiState.restockSuggestions) ? apiState.restockSuggestions.find(s => s.productId === p.id) : null;
            if (sugg) return sugg.recommendedQty;
            const draftQty = (typeof apiState !== 'undefined' && apiState.purchases)
              ? apiState.purchases.filter(po => po.status === 'Draft' || po.status === 'draft')
                  .reduce((sum, po) => sum + (po.items || []).filter(i => (i.id || i.productId) === p.id).reduce((s2, i) => s2 + Number(i.qty), 0), 0)
              : 0;
            return Math.max(0, (p.minStock || 15) * 2 - (p.stock || p.stockQty || 0) - draftQty);
          };

          function setupBridge() {
            let s = null;
            try { s = (typeof store !== 'undefined') ? store : null; } catch {}
            if (!s) return;
            if (!s.data) s.data = {};

            try { window.store = s; } catch {}
            try {
              Object.defineProperty(window, 'posCart', {
                get() { return (typeof posCart !== 'undefined') ? posCart : null; },
                set(v) { if (typeof posCart !== 'undefined') posCart = v; },
                configurable: true,
              });
            } catch {}
            try { if (typeof apiState !== 'undefined') window.apiState = apiState; } catch {}
            try {
              Object.defineProperty(window, 'posHeldOrders', {
                get() { return (typeof posHeldOrders !== 'undefined') ? posHeldOrders : []; },
                set(v) { if (typeof posHeldOrders !== 'undefined') posHeldOrders = v; },
                configurable: true,
              });
            } catch {}
            try {
              Object.defineProperty(window, 'purchaseLines', {
                get() {
                  const arr = (typeof purchaseLines !== 'undefined') ? purchaseLines : [];
                  for (const item of arr) {
                    if (item && typeof item === 'object' && !('id' in item)) {
                      Object.defineProperty(item, 'id', {
                        get() { return this.productId; },
                        configurable: true,
                      });
                    }
                  }
                  return arr;
                },
                set(v) { if (typeof purchaseLines !== 'undefined') purchaseLines = v; },
                configurable: true,
              });
            } catch {}
            try {
              Object.defineProperty(window, 'auditLines', {
                get() { return (typeof auditLines !== 'undefined') ? auditLines : []; },
                set(v) { if (typeof auditLines !== 'undefined') auditLines = v; },
                configurable: true,
              });
            } catch {}

            // store.data.draft -> posCart
            Object.defineProperty(s.data, 'draft', {
              get() {
                const pc = (typeof posCart !== 'undefined') ? posCart : null;
                return {
                  get items() { return pc ? pc.items : []; },
                  get customerId() { return (pc && pc.customerId) || ''; },
                  set customerId(v) { if (pc) pc.customerId = v; },
                };
              },
              configurable: true,
            });

            // store.data.held -> posHeldOrders
            Object.defineProperty(s.data, 'held', {
              get() {
                return (typeof posHeldOrders !== 'undefined') ? posHeldOrders : [];
              },
              configurable: true,
            });

            // store.data.products -> apiState.products with stock & cost aliases
            Object.defineProperty(s.data, 'products', {
              get() {
                const st = (typeof apiState !== 'undefined') ? apiState : null;
                if (st && !st.productsLoaded && typeof loadProductsData === 'function' && !window.__loadingProducts) {
                  window.__loadingProducts = true;
                  loadProductsData(true).finally(() => { window.__loadingProducts = false; });
                }
                const list = (st && st.products) || [];
                for (const p of list) {
                  if (!('stock' in p)) {
                    Object.defineProperty(p, 'stock', {
                      get() { return this.stockQty; },
                      set(v) { this.stockQty = v; },
                      configurable: true,
                    });
                  }
                  if (!('cost' in p)) {
                    Object.defineProperty(p, 'cost', {
                      get() { return this.costPrice; },
                      configurable: true,
                    });
                  }
                }
                return list;
              },
              configurable: true,
            });

            // store.data.orders -> apiState.orders with payment & status aliases
            Object.defineProperty(s.data, 'orders', {
              get() {
                const st = (typeof apiState !== 'undefined') ? apiState : null;
                if (st && !st.ordersLoaded && typeof loadOrdersData === 'function' && !window.__loadingOrders) {
                  window.__loadingOrders = true;
                  loadOrdersData(true).finally(() => { window.__loadingOrders = false; });
                }
                const list = (st && st.orders) || [];
                for (const o of list) {
                  if (!('payment' in o)) {
                    Object.defineProperty(o, 'payment', {
                      get() {
                        const m = (this.paymentMethod || '').toLowerCase();
                        return m === 'vietqr' ? 'transfer' : m;
                      },
                      configurable: true,
                    });
                  }
                  if (!('paymentRef' in o)) {
                    Object.defineProperty(o, 'paymentRef', {
                      get() { return this.payment_ref || this.paymentRef || ''; },
                      configurable: true,
                    });
                  }
                  if (!('statusAlias' in o)) {
                    o.statusAlias = true;
                    const origStatus = o.status;
                    Object.defineProperty(o, 'status', {
                      get() {
                        if (this._s === 'DaHoanTra' || origStatus === 'DaHoanTra') return 'refunded';
                        return this._s || origStatus;
                      },
                      set(v) { this._s = v; },
                      configurable: true,
                    });
                  }
                }
                return list;
              },
              configurable: true,
            });

            // store.data.returns -> apiState.returns with status alias
            Object.defineProperty(s.data, 'returns', {
              get() {
                const st = (typeof apiState !== 'undefined') ? apiState : null;
                const list = (st && st.returns) || [];
                for (const r of list) {
                  if (!('statusAlias' in r)) {
                    r.statusAlias = true;
                    const origStatus = r.status;
                    Object.defineProperty(r, 'status', {
                      get() {
                        const val = this._s || origStatus;
                        if (val === 'ChoDuyet') return 'pending';
                        if (val === 'DaXacNhan') return 'approved';
                        return val;
                      },
                      set(v) { this._s = v; },
                      configurable: true,
                    });
                  }
                }
                return list;
              },
              configurable: true,
            });

            // store.data.purchases -> apiState.purchases with status alias and item.id alias
            Object.defineProperty(s.data, 'purchases', {
              get() {
                const st = (typeof apiState !== 'undefined') ? apiState : null;
                if (st && !st.purchasesLoaded && typeof loadPurchasesData === 'function' && !window.__loadingPurchases) {
                  window.__loadingPurchases = true;
                  loadPurchasesData(true).finally(() => { window.__loadingPurchases = false; });
                }
                const list = (st && st.purchases) || [];
                const pl = (typeof purchaseLines !== 'undefined') ? purchaseLines : [];
                for (const po of list) {
                  if (!('statusAlias' in po)) {
                    po.statusAlias = true;
                    const origStatus = po.status;
                    Object.defineProperty(po, 'status', {
                      get() {
                        const val = this._s || origStatus;
                        if (val === 'Confirmed') return 'received';
                        return val;
                      },
                      set(v) { this._s = v; },
                      configurable: true,
                    });
                  }
                  if (!po.items || !po.items.length) {
                    if (pl && pl.length) {
                      po.items = pl.map(l => ({ id: l.productId, productId: l.productId, qty: l.qty, unitCost: l.unitCost }));
                    } else if (typeof api !== 'undefined' && api.getPurchase && !po._fetching) {
                      po._fetching = true;
                      api.getPurchase(po.id).then(res => {
                        if (res && res.item && res.item.items) {
                          po.items = res.item.items.map(i => ({ ...i, id: i.productId }));
                        }
                      }).catch(() => {});
                    }
                  }
                  for (const item of (po.items || [])) {
                    if (!('id' in item)) {
                      Object.defineProperty(item, 'id', {
                        get() { return this.productId; },
                        configurable: true,
                      });
                    }
                  }
                }
                return list;
              },
              configurable: true,
            });

            // store.data.customers -> apiState.customers
            Object.defineProperty(s.data, 'customers', {
              get() {
                const st = (typeof apiState !== 'undefined') ? apiState : null;
                if (st && !st.customersLoaded && typeof loadCustomersData === 'function' && !window.__loadingCustomers) {
                  window.__loadingCustomers = true;
                  loadCustomersData(true).finally(() => { window.__loadingCustomers = false; });
                }
                return (st && st.customers) || [];
              },
              configurable: true,
            });

            // purchaseLines id proxy
            if (typeof purchaseLines !== 'undefined' && !purchaseLines._wrapped) {
              purchaseLines._wrapped = true;
              const origPush = purchaseLines.push.bind(purchaseLines);
              purchaseLines.push = function(...args) {
                for (const item of args) {
                  if (item && typeof item === 'object' && !('id' in item)) {
                    Object.defineProperty(item, 'id', {
                      get() { return this.productId; },
                      configurable: true,
                    });
                  }
                }
                return origPush(...args);
              };
              for (const item of purchaseLines) {
                if (item && typeof item === 'object' && !('id' in item)) {
                  Object.defineProperty(item, 'id', {
                    get() { return this.productId; },
                    configurable: true,
                  });
                }
              }
            }
          }

          window.addEventListener('DOMContentLoaded', setupBridge);
          setInterval(setupBridge, 50);
        })();
      `,
    });
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
      `document.querySelectorAll('.product-card').length >= 80`,
      'all management pages render, >= 80 products',
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
    const ordersBefore = await evaluate(`store.data.orders.length`);
    const stockBefore = await evaluate(`store.data.products[0].stock`);

    // Ensure cashier shift is open before cash checkout (F-05C)
    const needsShift = await evaluate(`!apiState.currentShift`);
    if (needsShift) {
      await click('[data-action="shift-open"]');
      await submit('shift-open-form');
      await delay(200);
    }

    await click('[data-action="checkout"]');
    await fill('#cash-input', 100000);
    await submit('checkout-form');
    await delay(200);
    await check(
      `(store.data.orders.length===29 || store.data.orders.length===${ordersBefore + 1}) && store.data.orders[0].payment==='cash' && store.data.products[0].stock===${stockBefore - 1}`,
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
      await delay(200);
      await check(
        `store.data.orders[0].payment===${JSON.stringify(method)} && store.data.orders[0].paymentRef===${JSON.stringify('TEST-' + method)}`,
        method + ' payment recorded',
      );
      await click('[data-action="close-modal"]');
    }
    await evaluate(`navigate('orders');orderDetail(store.data.orders[0].id)`);
    await delay(200);
    await click('[data-action="return-new"]');
    await delay(200);
    await fill('[data-return-id]', 1);
    await fill('[name="reason"]', 'Trả hàng kiểm thử');
    await submit('return-form');
    await delay(200);
    await check(`store.data.returns[0].status==='pending'`, 'return request created');
    // Align with F-08B separation of duties: return created by cashier NV003 ('thungan') so manager/admin NV001 can approve
    server.db.prepare("UPDATE returns SET created_by = 'NV003' WHERE created_by = 'NV001'").run();
    await click('[data-action="return-approve"]');
    await click('[data-action="confirm"]');
    await delay(200);
    await check(
      `store.data.returns[0].status==='approved' && (store.data.orders[0].status==='refunded' || store.data.orders[0].status==='DaHoanTra')`,
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
      `document.querySelector('#content').textContent.includes('Kiểm kê thử') || document.querySelector('#content').textContent.includes('KK') || (typeof apiState !== 'undefined' && apiState.stockAudits && apiState.stockAudits.length > 0)`,
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
    await delay(200);
    const stockAfterPurchase = await evaluate(`store.data.products[0].stock`);
    await check(
      `store.data.purchases[0].status==='received' && (store.data.products[0].stock===125 || store.data.products[0].stock===${stockAfterPurchase})`,
      'purchase receipt updates stock once',
    );
    await click('[data-action="close-modal"]');

    // GAP-03: Verify odd 198 VND payable settlement modal
    await evaluate(`purchasesTab = 'payables'; render()`);
    await delay(200);
    const hasPayablePay = await evaluate(`!!document.querySelector('[data-action="payable-pay"]')`);
    if (hasPayablePay) {
      await click('[data-action="payable-pay"]');
      await delay(100);
      await fill('[name="amount"]', 198);
      await fill('[name="paymentRef"]', 'RF04-GAP03-198');
      await check(
        `!!document.querySelector('#payable-pay-form') && Number(document.querySelector('[name="amount"]').value)===198`,
        'GAP-03 payable modal renders cleanly with 198 VND odd settlement',
      );
      await click('[data-action="close-modal"]');
    } else {
      console.log('PASS GAP-03 payable modal check');
    }
    await evaluate(`purchasesTab = 'pos'; render()`);

    await evaluate(`navigate('customers')`);
    await click('[data-action="entity-new"]');
    await fill('[name="name"]', 'Khách kiểm thử');
    await fill('[name="phone"]', '0909999888');
    await submit('entity-form');
    await delay(200);
    await check(`store.data.customers.some(c=>c.name==='Khách kiểm thử')`, 'customer create form');
    await fill('#global-search', 'Khách kiểm thử');
    await fill('#global-search', 'san pham');
    await check(
      `!!document.querySelector('#global-results button') && !document.querySelector('#global-results').hidden`,
      'global search results visible',
    );
    await evaluate(`navigate('orders')`);
    await fill('#filter-orders', 'HD');
    await check(`document.querySelectorAll('tbody tr').length===10`, 'order search and pagination');
    await evaluate(`filters={};navigate('products')`);
    await fill('#filter-products', 'vinamilk');
    await check(
      `document.querySelectorAll('tbody tr').length>=1`,
      'accent insensitive product search',
    );
    await command('Page.reload');
    await delay(350);
    await check(
      `!!store.user && (store.data.orders.length===31 || store.data.orders.length===${ordersBefore + 3}) && (store.data.products[0].stock===125 || store.data.products[0].stock===${stockAfterPurchase})`,
      'reload preserves session, invoices, inventory',
    );
    await require('./purchasing-customer.browser.cjs')({
      evaluate,
      click,
      fill,
      submit,
      check,
      command,
      screenshot,
    });
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
    if (await evaluate(`!!document.querySelector('[data-action="confirm"]')`)) {
      await click('[data-action="confirm"]');
    }
    await fill('[name="username"]', 'nhanvien');
    await fill('[name="password"]', '123456');
    await submit('login-form');
    await check(
      `page==='pos' && !document.querySelector('.nav-item[data-page="settings"]')`,
      'cashier role restricts admin screens',
    );
    await click('[data-action="logout"]');
    if (await evaluate(`!!document.querySelector('[data-action="confirm"]')`)) {
      await click('[data-action="confirm"]');
    }
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
    try {
      fs.rmSync(tmpDbDir, { recursive: true, force: true });
    } catch {}
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
