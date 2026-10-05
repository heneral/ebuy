const API = window.EBUY_API;
const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let currency = 'USD';
const money = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n);
const img = (u) => (u ? (u.startsWith('/') ? API + u : u) : '');
const STATUSES = ['PENDING', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED'];

const session = {
  get token() { return sessionStorage.getItem('ebuy_admin_token'); },
  get user() { try { return JSON.parse(sessionStorage.getItem('ebuy_admin_user')); } catch { return null; } },
  set(s) { if (s) { sessionStorage.setItem('ebuy_admin_token', s.token); sessionStorage.setItem('ebuy_admin_user', JSON.stringify(s.user)); } else { sessionStorage.removeItem('ebuy_admin_token'); sessionStorage.removeItem('ebuy_admin_user'); } },
};

async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    method: opts.method || 'GET',
    headers: { ...(opts.body ? { 'content-type': 'application/json' } : {}), ...(session.token ? { authorization: `Bearer ${session.token}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) { session.set(null); if (location.hash !== '#/login') location.hash = '#/login'; }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 1800); }
const errBox = (e) => `<div class="err" role="alert">${esc(e.message)}</div>`;

const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  orders: '<path d="M4 5h16v4H4zM6 9v10h12V9M10 13h4"/>',
  products: '<path d="M20 12 12 20l-9-9V3h8z"/><circle cx="7.5" cy="7.5" r="1.2"/>',
  out: '<path d="M10 4H5v16h5M15 8l4 4-4 4M19 12H9"/>',
  customers: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.5-4 3-6 6.5-6s6 2 6.5 6M16 5a3.5 3.5 0 0 1 0 7M18 14c2 .6 3.3 2.6 3.5 6"/>',
  categories: '<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/>',
  discounts: '<path d="M20 12 12 20l-9-9V3h8z"/><path d="M8 8l8 8M8.5 8.5h.01M15.5 15.5h.01"/>',
  inventory: '<path d="M3 8l9-5 9 5v8l-9 5-9-5zM3 8l9 5 9-5M12 13v8"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/>',
};
const icon = (n) => `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[n]}</svg>`;
const initial = (n) => esc((n || '?')[0].toUpperCase());
function csv(name, header, rows) {
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const text = [header, ...rows].map((r) => r.map(cell).join(',')).join('\n');
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([text], { type: 'text/csv' })), download: `${name}-${new Date().toISOString().slice(0, 10)}.csv` });
  a.click(); URL.revokeObjectURL(a.href);
}
function chart(series) {
  const W = 760, H = 180, P = 8, max = Math.max(1, ...series.map((d) => d.sales)), bw = (W - P * 2) / series.length;
  const bars = series.map((d, i) => { const h = Math.max(d.sales ? 3 : 1, (d.sales / max) * (H - 30)); return `<rect x="${(P + i * bw + bw * 0.12).toFixed(1)}" y="${(H - 18 - h).toFixed(1)}" width="${(bw * 0.76).toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${d.sales ? '#008060' : '#e1e3e5'}"><title>${d.date}: ${money(d.sales)} · ${d.orders} order(s)</title></rect>`; }).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${bars}<text x="${P}" y="${H - 3}">${series[0].date}</text><text x="${W - P}" y="${H - 3}" text-anchor="end">${series.at(-1).date}</text></svg>`;
}
const ORDER_TONE = { PENDING: 'warn', PROCESSING: 'info', SHIPPED: 'info', DELIVERED: 'ok', CANCELLED: 'crit' };

function layout(active, html) {
  const link = (h, label, ic) => `<a href="#/${h}" class="${active === h ? 'on' : ''}">${icon(ic)}<span>${label}</span></a>`;
  $('#root').innerHTML = `<div class="shell"><header class="top"><div class="logo"><span class="mark">e</span>ebuy</div>
      <label class="gsearch">${icon('search')}<input id="gs" placeholder="Search products" autocomplete="off"></label>
      <div class="me"><span class="avatar">${initial(session.user?.username)}</span><span class="uname">${esc(session.user?.username)}</span></div></header>
    <nav class="side">${link('', 'Home', 'home')}${link('orders', 'Orders', 'orders')}${link('products', 'Products', 'products')}${link('categories', 'Categories', 'categories')}${link('customers', 'Customers', 'customers')}${link('inventory', 'Inventory', 'inventory')}${link('discounts', 'Discounts', 'discounts')}${link('landing', 'Landing pages', 'orders')}${link('builder', 'Home editor', 'products')}${link('navigation', 'Navigation', 'orders')}${link('theme', 'Theme', 'settings')}
      <span class="sp"></span>${link('settings', 'Settings', 'settings')}
      <a href="#" id="out">${icon('out')}<span>Sign out</span></a></nav>
    <main class="main">${html}</main></div>`;
  $('#out').addEventListener('click', (e) => { e.preventDefault(); session.set(null); location.hash = '#/login'; });
  $('#gs').addEventListener('keydown', (e) => { if (e.key === 'Enter') { sessionStorage.setItem('ebuy_admin_q', e.target.value); location.hash = '#/products'; pages.products(); } });
  return $('.main');
}

const pages = {
  async dashboard() {
    const days = Number(sessionStorage.getItem('ebuy_admin_days')) || 30;
    const [s, orders, prods, an] = await Promise.all([api('/api/admin/stats'), api('/api/admin/orders'), api('/api/admin/products?size=100'), api(`/api/admin/analytics?days=${days}`)]);
    const low = prods.items.filter((p) => p.active && p.stockQuantity <= 5);
    const stat = (n, l, t = '') => `<div class="stat ${t}"><span>${l}</span><b>${n}</b></div>`;
    layout('', `<div class="head"><h1>Home</h1><a class="btn" href="#/products/new">Add product</a></div>
      <div class="card stats">${stat(money(s.revenue), 'Total sales')}${stat(s.orders, 'Orders')}${stat(s.pendingOrders, 'Pending', s.pendingOrders ? 'warn' : '')}
      ${stat(s.products, 'Products')}${stat(s.lowStock, 'Low stock', s.lowStock ? 'crit' : '')}${stat(s.customers, 'Customers')}</div>
      <div class="card"><div class="card-h"><h2>Sales</h2><select id="days" class="mini">${[7, 30, 90].map((d) => `<option value="${d}" ${d === days ? 'selected' : ''}>Last ${d} days</option>`).join('')}</select></div>
        <div class="kpis"><div><span>Sales</span><b>${money(an.sales)}</b></div><div><span>Orders</span><b>${an.orders}</b></div><div><span>Average order</span><b>${money(an.aov)}</b></div></div>
        ${chart(an.series)}</div>
      ${an.top.length ? `<div class="card"><div class="card-h"><h2>Top products</h2></div><table><tbody>${an.top.map((t) => `<tr><td><strong>${esc(t.name)}</strong></td><td>${t.units} sold</td><td style="text-align:right">${money(t.revenue)}</td></tr>`).join('')}</tbody></table></div>` : ''}
      <div class="card"><div class="card-h"><h2>Recent orders</h2><a href="#/orders">View all</a></div>
      ${orders.length ? `<table><thead><tr><th>Order</th><th>Customer</th><th>Date</th><th>Total</th><th>Status</th></tr></thead><tbody>
      ${orders.slice(0, 5).map((o) => `<tr><td><strong>${esc(o.orderNumber)}</strong></td><td>${esc(o.customer)}</td><td>${new Date(o.createdAt).toLocaleDateString()}</td><td>${money(o.totalAmount)}</td><td><span class="badge ${ORDER_TONE[o.status]}">${o.status}</span></td></tr>`).join('')}</tbody></table>` : '<p class="empty">No orders yet. They will show up here.</p>'}</div>
      ${low.length ? `<div class="card"><div class="card-h"><h2>Low stock</h2><span class="muted">${low.length} product(s) need restocking</span></div><table><tbody>
      ${low.map((p) => `<tr><td><strong>${esc(p.name)}</strong></td><td class="crit-text">${p.stockQuantity} left</td><td class="actions"><a class="btn ghost sm" href="#/products/${p.id}">Restock</a></td></tr>`).join('')}</tbody></table></div>` : ''}`);
    $('#days').addEventListener('change', (e) => { sessionStorage.setItem('ebuy_admin_days', e.target.value); pages.dashboard(); });
  },

  async products() {
    const { items } = await api('/api/admin/products?size=48');
    const main = layout('products', `<div class="head"><h1>Products</h1><a class="btn" href="#/products/new">Add product</a></div>
      <div class="card"><div class="toolbar"><label class="gsearch">${icon('search')}<input id="pq" placeholder="Filter products" value="${esc(sessionStorage.getItem('ebuy_admin_q') || '')}"></label><span class="muted">${items.length} products <button class="btn ghost sm" id="exp" style="margin-left:10px">Export CSV</button></span></div>
      <table><thead><tr><th></th><th>Name</th><th>Category</th><th>Price</th><th>Stock</th><th>Status</th><th></th></tr></thead><tbody>
      ${items.map((p) => `<tr><td>${p.imageUrl ? `<img class="thumb" src="${esc(img(p.imageUrl))}" alt="">` : '<div class="thumb"></div>'}</td>
        <td><strong>${esc(p.name)}</strong>${p.sku ? `<div class="muted">${esc(p.sku)}</div>` : ''}</td><td>${esc(p.category.name)}</td><td>${money(p.price)}${p.compareAtPrice ? ` <s class="muted">${money(p.compareAtPrice)}</s>` : ''}</td>
        <td><span class="${p.stockQuantity <= 5 ? 'crit-text' : ''}">${p.stockQuantity} in stock</span></td>
        <td><span class="badge ${p.active ? 'ok' : ''}">${p.active ? 'Active' : 'Hidden'}</span></td>
        <td class="actions"><a class="btn ghost sm" href="#/products/${p.id}">Edit</a><button class="btn danger sm" data-del="${p.id}" data-name="${esc(p.name)}">Delete</button></td></tr>`).join('')}
      </tbody></table></div>`);
    const filt = () => { const q = $('#pq').value.toLowerCase(); sessionStorage.setItem('ebuy_admin_q', $('#pq').value); main.querySelectorAll('tbody tr').forEach((r) => { r.hidden = !r.textContent.toLowerCase().includes(q); }); };
    $('#pq').addEventListener('input', filt); filt();
    $('#exp').addEventListener('click', () => csv('products', ['ID', 'Name', 'Category', 'Price', 'Stock', 'Status'], items.map((p) => [p.id, p.name, p.category.name, p.price, p.stockQuantity, p.active ? 'Active' : 'Hidden'])));
    main.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm(`Delete "${b.dataset.name}"? Products with past orders are hidden instead.`)) return;
      try { const r = await api(`/api/admin/products/${b.dataset.del}`, { method: 'DELETE' }); toast(r.archived ? 'Hidden (has orders)' : 'Deleted'); pages.products(); }
      catch (e) { toast(e.message); }
    }));
  },

  async productForm(id) {
    const [cats, p] = await Promise.all([api('/api/categories'), id ? api(`/api/admin/products/${id}`) : Promise.resolve({ active: true, stockQuantity: 0, category: {} })]);
    const main = layout('products', `<div class="head"><h1>${id ? 'Edit product' : 'Add a product'}</h1><a class="btn ghost" href="#/products">← Back</a></div>
      <form class="card form" id="f"><div id="e"></div>
        <label>Name<input name="name" required maxlength="150" value="${esc(p.name)}"></label>
        <label>Description<textarea name="description" rows="3" maxlength="2000">${esc(p.description)}</textarea></label>
        <div class="cols">
          <label>Price<input name="price" type="number" step="0.01" min="0" required value="${esc(p.price)}"></label>
          <label>Compare-at price<input name="compareAtPrice" type="number" step="0.01" min="0" value="${esc(p.compareAtPrice)}"></label>
          <label>SKU<input name="sku" maxlength="60" value="${esc(p.sku)}"></label></div><div class="cols">
          <label>Stock quantity<input name="stockQuantity" type="number" min="0" step="1" required value="${esc(p.stockQuantity)}"></label>
          <label>Category<select name="categoryId" required><option value="">Choose…</option>
            ${cats.map((c) => `<option value="${c.id}" ${c.id === p.category.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label></div>
        <label>Image URL <span class="muted">(https://… or /images/products/…)</span><input name="imageUrl" id="imageUrl" value="${esc(p.imageUrl)}"></label>
        <label>Or upload an image <span class="muted">(PNG, JPG, GIF, WebP · max 5 MB)</span><input type="file" id="file" accept="image/png,image/jpeg,image/gif,image/webp"></label>
        <div id="preview" style="margin-top:8px"></div>
        <label><input type="checkbox" name="active" ${p.active ? 'checked' : ''}>Visible in the storefront</label>
        <br><button class="btn">Save product</button> <a class="btn ghost" href="#/products">Cancel</a></form>`);
    const preview = () => { const u = $('#imageUrl').value.trim(); $('#preview').innerHTML = u ? `<img class="thumb" style="width:96px;height:96px" src="${esc(img(u))}" alt="Preview">` : ''; };
    $('#imageUrl').addEventListener('input', preview); preview();
    $('#file').addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const r = await fetch(API + '/api/admin/upload', { method: 'POST', headers: { authorization: 'Bearer ' + session.token, 'content-type': f.type }, body: f });
        const d = await r.json(); if (!r.ok) throw new Error(d.error);
        $('#imageUrl').value = d.url; preview(); toast('Image uploaded');
      } catch (x) { $('#e').innerHTML = errBox(x); e.target.value = ''; }
    });
    $('#f').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(e.target));
      const body = { ...fd, price: Number(fd.price), stockQuantity: Number(fd.stockQuantity), categoryId: Number(fd.categoryId), active: e.target.active.checked };
      try { await api(id ? `/api/admin/products/${id}` : '/api/admin/products', { method: id ? 'PUT' : 'POST', body }); toast('Saved'); location.hash = '#/products'; }
      catch (x) { $('#e').innerHTML = errBox(x); }
    });
  },

  async orders() {
    const orders = await api('/api/admin/orders');
    const main = layout('orders', `<div class="head"><h1>Orders</h1><button class="btn ghost" id="exp">Export CSV</button></div>
      <div class="card"><div class="tabs">${['ALL', ...STATUSES].map((s) => `<button data-s="${s}" class="${s === 'ALL' ? 'on' : ''}">${s === 'ALL' ? 'All' : s[0] + s.slice(1).toLowerCase()}<i>${s === 'ALL' ? orders.length : orders.filter((o) => o.status === s).length}</i></button>`).join('')}</div>
      <div class="toolbar"><label class="gsearch">${icon('search')}<input id="oq" placeholder="Search order or customer"></label></div>
      ${orders.length ? `<table><thead><tr><th>Order</th><th>Customer</th><th>Date</th><th>Items</th><th>Total</th><th>Status</th></tr></thead><tbody>
      ${orders.map((o) => `<tr class="click" data-status="${o.status}" data-href="#/orders/${o.id}"><td><strong>${esc(o.orderNumber)}</strong></td>
        <td>${esc(o.customer)}</td><td>${new Date(o.createdAt).toLocaleString()}</td><td>${o.items.reduce((n, i) => n + i.quantity, 0)}</td><td>${money(o.totalAmount)}</td>
        <td><span class="badge ${ORDER_TONE[o.status]}">${o.status}</span></td></tr>`).join('')}
      </tbody></table>` : '<p class="empty">No orders yet.</p>'}</div>`);
    let tab = 'ALL';
    const filt = () => { const q = ($('#oq').value || '').toLowerCase(); main.querySelectorAll('tbody tr').forEach((r) => { r.hidden = (tab !== 'ALL' && r.dataset.status !== tab) || !r.textContent.toLowerCase().includes(q); }); };
    main.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.s; main.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b)); filt(); }));
    $('#oq').addEventListener('input', filt);
    main.querySelectorAll('tr[data-href]').forEach((r) => r.addEventListener('click', () => { location.hash = r.dataset.href; }));
    $('#exp').addEventListener('click', () => csv('orders', ['Order', 'Customer', 'Date', 'Items', 'Total', 'Status', 'Recipient', 'Phone', 'Address'],
      orders.map((o) => [o.orderNumber, o.customer, o.createdAt, o.items.map((i) => `${i.name} x${i.quantity}`).join('; '), o.totalAmount, o.status, o.recipientName, o.phone, o.shippingAddress])));
  },

  async orderDetail(id) {
    const o = (await api('/api/admin/orders')).find((x) => String(x.id) === String(id));
    if (!o) throw new Error('Order not found');
    const main = layout('orders', `<div class="head"><h1>${esc(o.orderNumber)} <span class="badge ${ORDER_TONE[o.status]}">${o.status}</span></h1><a class="btn ghost" href="#/orders">← Orders</a></div>
      <div class="split"><div>
        <div class="card"><div class="card-h"><h2>Items</h2></div><table><tbody>
        ${o.items.map((i) => `<tr><td style="width:56px">${i.imageUrl ? `<img class="thumb" src="${esc(img(i.imageUrl))}" alt="">` : '<div class="thumb"></div>'}</td><td><strong>${esc(i.name)}</strong></td>
          <td>${money(i.unitPrice)} × ${i.quantity}</td><td style="text-align:right">${money(i.unitPrice * i.quantity)}</td></tr>`).join('')}
        <tr><td></td><td></td><td>Subtotal</td><td style="text-align:right">${money(o.subtotal)}</td></tr>
        ${o.discountAmount ? `<tr><td></td><td></td><td>Discount <span class="badge">${esc(o.discountCode)}</span></td><td style="text-align:right">−${money(o.discountAmount)}</td></tr>` : ''}
        <tr><td></td><td></td><td>Shipping</td><td style="text-align:right">${money(o.shippingAmount)}</td></tr><tr><td></td><td></td><td>Tax</td><td style="text-align:right">${money(o.taxAmount)}</td></tr>
        <tr><td></td><td></td><td><strong>Total</strong></td><td style="text-align:right"><strong>${money(o.totalAmount)}</strong></td></tr></tbody></table></div>
      </div><div>
        <div class="card pad"><h2>Fulfilment</h2><label>Status<select id="st" ${o.status === 'CANCELLED' ? 'disabled' : ''}>${STATUSES.map((s) => `<option ${s === o.status ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
          <p class="muted">${o.status === 'CANCELLED' ? 'Cancelled orders cannot be reopened.' : 'Cancelling returns the items to stock.'}</p></div>
        <div class="card pad"><h2>Customer</h2><p>${esc(o.customer)}</p><h2>Ship to</h2><p>${esc(o.recipientName)}<br>${esc(o.shippingAddress)}<br>${esc(o.phone)}</p><p class="muted">Placed ${new Date(o.createdAt).toLocaleString()}</p></div>
      </div></div>`);
    $('#st').addEventListener('change', async (e) => {
      if (e.target.value === 'CANCELLED' && !confirm('Cancel this order? Stock will be returned.')) return pages.orderDetail(id);
      try { await api(`/api/admin/orders/${id}/status`, { method: 'PATCH', body: { status: e.target.value } }); toast('Order updated'); } catch (x) { toast(x.message); }
      pages.orderDetail(id);
    });
  },

  async categories(editId) {
    const cats = await api('/api/admin/categories');
    const c = cats.find((x) => String(x.id) === String(editId)) || {};
    const main = layout('categories', `<div class="head"><h1>Categories</h1></div>
      <div class="split"><div class="card"><table><thead><tr><th>Name</th><th>Description</th><th>Products</th><th></th></tr></thead><tbody>
      ${cats.map((x) => `<tr><td><strong>${esc(x.name)}</strong></td><td class="muted">${esc(x.description)}</td><td>${x.products}</td>
        <td class="actions"><a class="btn ghost sm" href="#/categories/${x.id}">Edit</a><button class="btn danger sm" data-del="${x.id}" data-name="${esc(x.name)}">Delete</button></td></tr>`).join('')}</tbody></table></div>
      <form class="card pad" id="f"><h2>${c.id ? 'Edit category' : 'Add category'}</h2><div id="e"></div>
        <label>Name<input name="name" required maxlength="80" value="${esc(c.name)}"></label>
        <label>Description<textarea name="description" rows="3" maxlength="300">${esc(c.description)}</textarea></label>
        <br><button class="btn">${c.id ? 'Save' : 'Add'}</button> ${c.id ? '<a class="btn ghost" href="#/categories">Cancel</a>' : ''}</form></div>`);
    $('#f').addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await api(c.id ? `/api/admin/categories/${c.id}` : '/api/admin/categories', { method: c.id ? 'PUT' : 'POST', body: Object.fromEntries(new FormData(e.target)) }); toast('Saved'); if (c.id) location.hash = '#/categories'; else pages.categories(); }
      catch (x) { $('#e').innerHTML = errBox(x); }
    });
    main.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm(`Delete category "${b.dataset.name}"?`)) return;
      try { await api(`/api/admin/categories/${b.dataset.del}`, { method: 'DELETE' }); toast('Deleted'); pages.categories(); } catch (x) { toast(x.message); }
    }));
  },

  async customers() {
    const list = await api('/api/admin/customers');
    const main = layout('customers', `<div class="head"><h1>Customers</h1><button class="btn ghost" id="exp">Export CSV</button></div>
      <div class="card">${list.length ? `<table><thead><tr><th>Customer</th><th>Email</th><th>Orders</th><th>Total spent</th><th>Last order</th></tr></thead><tbody>
      ${list.map((u) => `<tr><td><strong>${esc(u.fullName || u.username)}</strong><div class="muted">@${esc(u.username)}</div></td><td>${esc(u.email)}</td><td>${u.orders}</td><td>${money(u.spent)}</td><td>${u.lastOrder ? new Date(u.lastOrder).toLocaleDateString() : '—'}</td></tr>`).join('')}</tbody></table>` : '<p class="empty">No customers yet. They appear after they register in the storefront.</p>'}</div>`);
    $('#exp').addEventListener('click', () => csv('customers', ['Username', 'Name', 'Email', 'Phone', 'Orders', 'Spent'], list.map((u) => [u.username, u.fullName, u.email, u.phone, u.orders, u.spent])));
  },

  async inventory() {
    const { items } = await api('/api/admin/products?size=100');
    const main = layout('inventory', `<div class="head"><h1>Inventory</h1><button class="btn ghost" id="exp">Export CSV</button></div>
      <div class="card"><table><thead><tr><th></th><th>Product</th><th>SKU</th><th>Status</th><th style="width:140px">Available</th></tr></thead><tbody>
      ${items.map((p) => `<tr><td>${p.imageUrl ? `<img class="thumb" src="${esc(img(p.imageUrl))}" alt="">` : '<div class="thumb"></div>'}</td><td><strong>${esc(p.name)}</strong></td><td class="muted">${esc(p.sku) || '—'}</td>
        <td>${p.stockQuantity === 0 ? '<span class="badge crit">Out of stock</span>' : p.stockQuantity <= 5 ? '<span class="badge warn">Low stock</span>' : '<span class="badge ok">In stock</span>'}</td>
        <td><input type="number" min="0" step="1" class="qty" data-id="${p.id}" data-v="${p.stockQuantity}" value="${p.stockQuantity}"></td></tr>`).join('')}</tbody></table></div>`);
    main.querySelectorAll('.qty').forEach((i) => i.addEventListener('change', async () => {
      try { await api(`/api/admin/products/${i.dataset.id}/stock`, { method: 'PATCH', body: { stockQuantity: Number(i.value) } }); toast('Stock updated'); pages.inventory(); }
      catch (e) { toast(e.message); i.value = i.dataset.v; }
    }));
    $('#exp').addEventListener('click', () => csv('inventory', ['SKU', 'Product', 'Available'], items.map((p) => [p.sku, p.name, p.stockQuantity])));
  },

  async discounts(editId) {
    const list = await api('/api/admin/discounts');
    const d = list.find((x) => String(x.id) === String(editId)) || {};
    const label = (x) => (x.type === 'PERCENT' ? `${x.value}% off` : `${money(x.value)} off`);
    const state = (x) => (!x.active ? ['Disabled', ''] : x.expiresAt && new Date(x.expiresAt) < new Date() ? ['Expired', 'crit'] : x.maxUses && x.uses >= x.maxUses ? ['Used up', 'warn'] : ['Active', 'ok']);
    const main = layout('discounts', `<div class="head"><h1>Discounts</h1></div>
      <div class="split"><div class="card">${list.length ? `<table><thead><tr><th>Code</th><th>Discount</th><th>Used</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.map((x) => `<tr><td><strong>${esc(x.code)}</strong>${x.minSubtotal ? `<div class="muted">Min. spend ${money(x.minSubtotal)}</div>` : ''}</td><td>${label(x)}</td><td>${x.uses}${x.maxUses ? ` / ${x.maxUses}` : ''}</td>
        <td><span class="badge ${state(x)[1]}">${state(x)[0]}</span></td><td class="actions"><a class="btn ghost sm" href="#/discounts/${x.id}">Edit</a><button class="btn danger sm" data-del="${x.id}" data-name="${esc(x.code)}">Delete</button></td></tr>`).join('')}</tbody></table>` : '<p class="empty">No discount codes yet. Create one to run a promotion.</p>'}</div>
      <form class="card pad" id="f"><h2>${d.id ? 'Edit discount' : 'Create discount'}</h2><div id="e"></div>
        <label>Code<input name="code" required maxlength="40" placeholder="SUMMER10" value="${esc(d.code)}"></label>
        <label>Type<select name="type"><option value="PERCENT" ${d.type !== 'FIXED' ? 'selected' : ''}>Percentage</option><option value="FIXED" ${d.type === 'FIXED' ? 'selected' : ''}>Fixed amount</option></select></label>
        <label>Value<input name="value" type="number" step="0.01" min="0.01" required value="${esc(d.value)}"></label>
        <label>Minimum spend<input name="minSubtotal" type="number" step="0.01" min="0" value="${esc(d.minSubtotal || 0)}"></label>
        <label>Usage limit <span class="muted">(0 = unlimited)</span><input name="maxUses" type="number" step="1" min="0" value="${esc(d.maxUses || 0)}"></label>
        <label>Expires<input name="expiresAt" type="date" value="${d.expiresAt ? d.expiresAt.slice(0, 10) : ''}"></label>
        <label><input type="checkbox" name="active" ${d.id && !d.active ? '' : 'checked'}>Active</label>
        <br><button class="btn">${d.id ? 'Save' : 'Create'}</button> ${d.id ? '<a class="btn ghost" href="#/discounts">Cancel</a>' : ''}</form></div>`);
    $('#f').addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = { ...Object.fromEntries(new FormData(e.target)), active: e.target.active.checked };
      try { await api(d.id ? `/api/admin/discounts/${d.id}` : '/api/admin/discounts', { method: d.id ? 'PUT' : 'POST', body }); toast('Saved'); if (d.id) location.hash = '#/discounts'; else pages.discounts(); }
      catch (x) { $('#e').innerHTML = errBox(x); }
    });
    main.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm(`Delete code ${b.dataset.name}?`)) return;
      try { await api(`/api/admin/discounts/${b.dataset.del}`, { method: 'DELETE' }); toast('Deleted'); pages.discounts(); } catch (x) { toast(x.message); }
    }));
  },

  async navigation() {
    const [items, lp] = await Promise.all([api('/api/admin/nav'), api('/api/admin/pages')]);
    let list = items.map((i) => ({ ...i }));
    const draw = () => {
      layout('navigation', `<div class="head"><h1>Navigation</h1><div><button class="btn ghost" id="reset">Reset</button> <button class="btn" id="save">Save menu</button></div></div>
        <p class="muted">Menu links shown in the storefront header. Toggle a link off to hide it, use the arrows to reorder. Cart and account links are always shown.</p><div id="e"></div>
        <div class="card"><table><thead><tr><th>Visible</th><th>Label</th><th>Link</th><th></th></tr></thead><tbody>
        ${list.map((i, n) => `<tr><td><input type="checkbox" data-v="${n}" ${i.visible ? 'checked' : ''}></td>
          <td><input data-l="${n}" value="${esc(i.label)}" maxlength="30"></td><td><input data-k="${n}" value="${esc(i.link)}"></td>
          <td style="text-align:right;white-space:nowrap"><button class="btn ghost mini" data-up="${n}" ${n ? '' : 'disabled'}>↑</button> <button class="btn ghost mini" data-dn="${n}" ${n < list.length - 1 ? '' : 'disabled'}>↓</button> <button class="btn ghost mini" data-rm="${n}">Remove</button></td></tr>`).join('') || '<tr><td colspan="4" class="muted">No links. The header will only show the logo, cart and account.</td></tr>'}</tbody></table></div>
        <div class="card pad" style="margin-top:16px"><b>Add a link</b><div class="cols" style="grid-template-columns:2fr 1fr auto;align-items:end;margin-top:8px">
          <label>Page<select id="pick"><option value="">Choose…</option><option value="Home|#/">Home</option><option value="Shop|#/products">Shop</option><option value="My orders|#/orders">My orders</option>
          ${lp.map((p) => `<option value="${esc(p.title)}|#/p/${esc(p.slug)}">Landing: ${esc(p.title)}${p.published ? '' : ' (draft)'}</option>`).join('')}</select></label>
          <span></span><button class="btn" id="addp">Add</button></div>
          <div class="cols" style="grid-template-columns:1fr 2fr auto;align-items:end;margin-top:8px"><label>Custom label<input id="cl" maxlength="30"></label><label>Custom URL<input id="cu" placeholder="https://… or #/p/slug"></label><button class="btn ghost" id="addc">Add custom</button></div></div>`);
      const sync = () => { document.querySelectorAll('[data-l]').forEach((el) => { list[el.dataset.l].label = el.value; }); document.querySelectorAll('[data-k]').forEach((el) => { list[el.dataset.k].link = el.value; }); document.querySelectorAll('[data-v]').forEach((el) => { list[el.dataset.v].visible = el.checked; }); };
      const on = (sel, fn) => document.querySelectorAll(sel).forEach((b) => b.addEventListener('click', () => { sync(); fn(b); draw(); }));
      on('[data-up]', (b) => { const n = +b.dataset.up; [list[n - 1], list[n]] = [list[n], list[n - 1]]; });
      on('[data-dn]', (b) => { const n = +b.dataset.dn; [list[n + 1], list[n]] = [list[n], list[n + 1]]; });
      on('[data-rm]', (b) => list.splice(+b.dataset.rm, 1));
      $('#addp').addEventListener('click', () => { sync(); const v = $('#pick').value; if (v) { const [label, link] = v.split('|'); list.push({ label, link, visible: true }); draw(); } });
      $('#addc').addEventListener('click', () => { sync(); const label = $('#cl').value.trim(), link = $('#cu').value.trim(); if (label && link) { list.push({ label, link, visible: true }); draw(); } });
      $('#save').addEventListener('click', async () => { sync(); try { list = await api('/api/admin/nav', { method: 'PUT', body: { items: list } }); toast('Menu saved'); draw(); } catch (x) { $('#e').innerHTML = errBox(x); } });
      $('#reset').addEventListener('click', async () => { if (confirm('Reset menu to default?')) { list = await api('/api/admin/nav', { method: 'DELETE' }); draw(); } });
    };
    draw();
  },

  async landing() {
    const list = await api('/api/admin/pages'), url = location.origin.replace(':3001', ':3000');
    layout('landing', `<div class="head"><h1>Landing pages</h1></div>
      <form class="card pad" id="f" style="margin-bottom:16px"><div id="e"></div><div class="cols" style="grid-template-columns:2fr 1.5fr auto;align-items:end"><label>Title<input name="title" required maxlength="120" placeholder="Summer sale"></label><label>URL slug<input name="slug" required maxlength="60" placeholder="summer-sale" pattern="[a-z0-9]+(-[a-z0-9]+)*"></label><button class="btn">Create page</button></div></form>
      <div class="card"><table><thead><tr><th>Title</th><th>URL</th><th>Status</th><th>Updated</th><th></th></tr></thead><tbody>
      ${list.map((p) => `<tr><td><a href="#/builder/${p.id}"><b>${esc(p.title)}</b></a></td><td class="muted">/p/${esc(p.slug)}</td><td><span class="badge ${p.published ? 'ok' : 'warn'}">${p.published ? 'Published' : 'Draft'}</span>${p.membersOnly ? ' <span class="badge">Members</span>' : ''}</td><td class="muted">${esc(p.updatedAt)}</td>
      <td style="text-align:right"><a class="btn ghost mini" href="#/builder/${p.id}">Edit</a> ${p.published ? `<a class="btn ghost mini" target="_blank" rel="noopener" href="${url}/#/p/${esc(p.slug)}">View</a>` : ''} <button class="btn ghost mini" data-del="${p.id}">Delete</button></td></tr>`).join('') || '<tr><td colspan="5" class="muted">No landing pages yet. Create your first one above.</td></tr>'}</tbody></table></div>`);
    $('#f').addEventListener('submit', async (e) => {
      e.preventDefault();
      try { const r = await api('/api/admin/pages', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); location.hash = `#/builder/${r.id}`; } catch (x) { $('#e').innerHTML = errBox(x); }
    });
    document.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => { if (confirm('Delete this page?')) { await api(`/api/admin/pages/${b.dataset.del}`, { method: 'DELETE' }); pages.landing(); } }));
  },

  async builder(pageId) {
    const [data, cats] = await Promise.all([api(pageId ? `/api/admin/pages/${pageId}` : '/api/admin/layout'), api('/api/admin/categories').catch(() => [])]);
    const T = {
      hero: { label: 'Hero banner', f: [['eyebrow', 'Eyebrow'], ['title', 'Title'], ['text', 'Text', 'area'], ['button', 'Button label'], ['link', 'Button link', 'text', '#/products'], ['image', 'Background image URL']], hint: 'Blank fields use the Theme settings.' },
      heading: { label: 'Heading', f: [['text', 'Text'], ['size', 'Size', ['1:Large', '2:Medium', '3:Small']], ['align', 'Align', ['left:Left', 'center:Center', 'right:Right']]] },
      text: { label: 'Text', f: [['text', 'Text', 'area'], ['align', 'Align', ['left:Left', 'center:Center', 'right:Right']]] },
      image: { label: 'Image', f: [['url', 'Image URL (https or /images/…)'], ['alt', 'Alt text'], ['link', 'Link'], ['fit', 'Width', ['contained:Contained', 'full:Full width']]] },
      button: { label: 'Button', f: [['label', 'Label'], ['link', 'Link', 'text', '#/products'], ['style', 'Style', ['solid:Solid', 'outline:Outline']], ['align', 'Align', ['left:Left', 'center:Center', 'right:Right']]] },
      banner: { label: 'Banner strip', f: [['text', 'Text'], ['link', 'Link'], ['color', 'Colour', 'color']] },
      products: { label: 'Product grid', f: [['eyebrow', 'Eyebrow'], ['title', 'Title'], ['count', 'How many (1–24)', 'number'], ['category', 'Category', ['', ...cats.map((c) => `${c.id}:${c.name}`)].map((v) => (v === '' ? ':All products' : v))]] },
      spacer: { label: 'Spacer', f: [['height', 'Height (px)', 'number']] },
      html: { label: 'Custom HTML', f: [['html', 'HTML', 'code']], hint: 'Raw HTML is shown on your store exactly as written.' },
    };
    const meta = pageId ? { title: data.title, slug: data.slug, description: data.description, published: data.published, membersOnly: data.membersOnly } : null;
    const uid = () => Math.random().toString(36).slice(2, 10);
    const blocks = data.blocks.map((b) => ({ ...b, id: b.id || uid() }));
    let css = data.css, js = data.js || '', sel = null, tab = 'layout', dirty = false;
    const mark = () => { dirty = true; const b = $('#dirty'); if (b) b.hidden = false; };
    const summary = (b) => { const p = b.props; return { hero: p.title || 'Hero (theme defaults)', heading: p.text, text: p.text, image: p.url, button: p.label || 'Shop now', banner: p.text, products: `${p.title || 'Products'} · ${p.count || 6} items`, spacer: `${p.height || 32}px`, html: (p.html || '').slice(0, 60) }[b.type] || ''; };
    const fieldHtml = ([k, label, kind = 'text', ph], v) => {
      const n = `data-k="${k}"`;
      if (Array.isArray(kind)) return `<label>${label}<select ${n}>${kind.map((o) => { const [val, t] = o.split(':'); return `<option value="${esc(val)}" ${String(v ?? '') === val ? 'selected' : ''}>${esc(t)}</option>`; }).join('')}</select></label>`;
      if (kind === 'area') return `<label>${label}<textarea ${n} rows="4">${esc(v)}</textarea></label>`;
      if (kind === 'code') return `<label>${label}<textarea ${n} rows="10" spellcheck="false" style="font-family:ui-monospace,Menlo,monospace;font-size:12px">${esc(v)}</textarea></label>`;
      if (kind === 'color') return `<label>${label}<input ${n} type="color" value="${esc(v || '#c8553d')}" style="height:40px;padding:3px"></label>`;
      return `<label>${label}<input ${n} type="${kind === 'number' ? 'number' : 'text'}" value="${esc(v)}" placeholder="${esc(ph || '')}"></label>`;
    };
    const draw = () => {
      $('#tabs').innerHTML = [['layout', 'Layout'], ['css', 'Custom CSS'], ...(pageId ? [] : [['js', 'Custom JavaScript']])].map(([k, l]) => `<button type="button" class="tab ${tab === k ? 'on' : ''}" data-t="${k}">${l}</button>`).join('');
      const body = $('#body');
      if (tab === 'css' || tab === 'js') {
        body.innerHTML = `<div class="card pad"><p class="muted">${tab === 'css' ? 'Added to every storefront page. Blocks carry <code>data-block</code> and <code>data-id</code> attributes you can target, e.g. <code>[data-block="hero"] h1 { … }</code>.' : 'Runs once when the storefront loads, after the page layout is ready. Use <code>window.ebuy.api(path)</code>, or listen for <code>ebuy:route</code> after each page change. This code runs for every visitor — only add code you trust.'}</p>
          <textarea id="code" rows="22" spellcheck="false" style="font-family:ui-monospace,Menlo,monospace;font-size:13px;width:100%;tab-size:2">${esc(tab === 'css' ? css : js)}</textarea></div>`;
        const ta = $('#code');
        ta.addEventListener('input', () => { if (tab === 'css') css = ta.value; else js = ta.value; mark(); });
        ta.addEventListener('keydown', (e) => { if (e.key === 'Tab') { e.preventDefault(); ta.setRangeText('  ', ta.selectionStart, ta.selectionEnd, 'end'); ta.dispatchEvent(new Event('input')); } });
      } else {
        const b = blocks.find((x) => x.id === sel);
        body.innerHTML = `<div class="bld"><aside class="card pad"><h2>Add element</h2><p class="muted">Drag onto the page, or click.</p>
          ${Object.entries(T).map(([k, t]) => `<div class="pal" draggable="true" data-add="${k}">${esc(t.label)}</div>`).join('')}</aside>
          <section class="card pad canvas" id="cv"><h2>${pageId ? esc(meta.title) : 'Home page'}</h2>
            ${blocks.map((x) => `<div class="blkrow ${x.id === sel ? 'on' : ''}" draggable="true" data-id="${x.id}"><span class="grip" title="Drag to reorder">⋮⋮</span><div class="bi"><b>${esc(T[x.type].label)}</b><div class="muted">${esc(summary(x))}</div></div>
              <button type="button" class="btn ghost mini" data-dup="${x.id}">Duplicate</button><button type="button" class="btn ghost mini" data-del="${x.id}">Delete</button></div>`).join('') || '<p class="muted">Empty page. Drag an element here.</p>'}</section>
          <aside class="card pad" id="props">${b ? `<h2>${esc(T[b.type].label)}</h2>${T[b.type].hint ? `<p class="muted">${esc(T[b.type].hint)}</p>` : ''}${T[b.type].f.map((f) => fieldHtml(f, b.props[f[0]])).join('')}` : '<h2>Properties</h2><p class="muted">Select an element to edit it.</p>'}</aside></div>`;
        wireLayout();
      }
      document.querySelectorAll('[data-t]').forEach((x) => x.addEventListener('click', () => { tab = x.dataset.t; draw(); }));
    };
    const insert = (type, at) => { const b = { id: uid(), type, props: {} }; blocks.splice(at ?? blocks.length, 0, b); sel = b.id; mark(); draw(); };
    function wireLayout() {
      const cv = $('#cv'); let drag = null;
      const idxAt = (y) => { const rows = [...cv.querySelectorAll('.blkrow')]; for (let i = 0; i < rows.length; i++) { const r = rows[i].getBoundingClientRect(); if (y < r.top + r.height / 2) return i; } return rows.length; };
      const clear = () => cv.querySelectorAll('.blkrow').forEach((r) => r.classList.remove('above', 'below'));
      const mk = (y) => { clear(); const i = idxAt(y), rows = cv.querySelectorAll('.blkrow'); if (rows[i]) rows[i].classList.add('above'); else rows[rows.length - 1]?.classList.add('below'); return i; };
      document.querySelectorAll('.pal').forEach((el) => {
        el.addEventListener('dragstart', (e) => { drag = { add: el.dataset.add }; e.dataTransfer.setData('text/plain', el.dataset.add); e.dataTransfer.effectAllowed = 'copy'; });
        el.addEventListener('click', () => insert(el.dataset.add));
      });
      cv.querySelectorAll('.blkrow').forEach((el) => {
        el.addEventListener('dragstart', (e) => { drag = { id: el.dataset.id }; e.dataTransfer.setData('text/plain', el.dataset.id); e.dataTransfer.effectAllowed = 'move'; el.classList.add('dragging'); });
        el.addEventListener('dragend', () => { el.classList.remove('dragging'); clear(); });
        el.addEventListener('click', (e) => { if (e.target.closest('button')) return; sel = el.dataset.id; draw(); });
      });
      cv.addEventListener('dragover', (e) => { e.preventDefault(); mk(e.clientY); });
      cv.addEventListener('dragleave', (e) => { if (!cv.contains(e.relatedTarget)) clear(); });
      cv.addEventListener('drop', (e) => {
        e.preventDefault(); const at = idxAt(e.clientY); clear();
        if (drag?.add) insert(drag.add, at);
        else if (drag?.id) { const from = blocks.findIndex((x) => x.id === drag.id), [b] = blocks.splice(from, 1); blocks.splice(from < at ? at - 1 : at, 0, b); mark(); draw(); }
        drag = null;
      });
      cv.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => { const i = blocks.findIndex((x) => x.id === b.dataset.del); blocks.splice(i, 1); if (sel === b.dataset.del) sel = null; mark(); draw(); }));
      cv.querySelectorAll('[data-dup]').forEach((b) => b.addEventListener('click', () => { const i = blocks.findIndex((x) => x.id === b.dataset.dup); blocks.splice(i + 1, 0, { ...structuredClone(blocks[i]), id: uid() }); mark(); draw(); }));
      $('#props').querySelectorAll('[data-k]').forEach((inp) => inp.addEventListener('input', () => {
        const b = blocks.find((x) => x.id === sel); b.props[inp.dataset.k] = inp.value; mark();
        const row = cv.querySelector(`.blkrow[data-id="${sel}"] .muted`); if (row) row.textContent = summary(b);
      }));
    }
    const storeUrl = location.origin.replace(':3001', ':3000');
    layout(pageId ? 'landing' : 'builder', `<div class="head"><h1>${pageId ? esc(data.title) : 'Page editor'} <span class="badge warn" id="dirty" hidden>Unsaved</span></h1>
      <div style="display:flex;gap:8px">${pageId ? '<a class="btn ghost" href="#/landing">← All pages</a>' : ''}<a class="btn ghost" id="view" target="_blank" rel="noopener" href="${esc(storeUrl + (pageId ? '/#/p/' + data.slug : ''))}">${pageId ? 'View page' : 'View store'}</a>${pageId ? '' : '<button class="btn ghost" id="reset">Reset</button>'}<button class="btn" id="save">${pageId ? 'Save' : 'Save &amp; publish'}</button></div></div>
      ${pageId ? `<div class="card pad" style="margin-bottom:14px"><div class="cols" style="grid-template-columns:2fr 1.5fr 1fr 1.2fr"><label>Title<input id="m-title" value="${esc(meta.title)}" maxlength="120"></label><label>URL (/p/…)<input id="m-slug" value="${esc(meta.slug)}" maxlength="60"></label><label>Status<select id="m-pub"><option value="0" ${meta.published ? '' : 'selected'}>Draft</option><option value="1" ${meta.published ? 'selected' : ''}>Published</option></select></label><label>Access<select id="m-acc"><option value="0" ${meta.membersOnly ? '' : 'selected'}>Public</option><option value="1" ${meta.membersOnly ? 'selected' : ''}>Signed-in customers only</option></select></label></div>
        <label>SEO description<input id="m-desc" maxlength="300" value="${esc(meta.description)}"></label></div>` : ''}
      <div id="tabs" class="tabs"></div><div id="body"></div>`);
    if (pageId) document.querySelectorAll('#m-title,#m-slug,#m-desc,#m-pub,#m-acc').forEach((e) => e.addEventListener('input', mark));
    draw();
    $('#save').addEventListener('click', async () => {
      const bl = blocks.map(({ id, type, props }) => ({ id, type, props }));
      try {
        if (pageId) {
          const r = await api(`/api/admin/pages/${pageId}`, { method: 'PUT', body: { blocks: bl, css, title: $('#m-title').value, slug: $('#m-slug').value, description: $('#m-desc').value, published: $('#m-pub').value === '1', membersOnly: $('#m-acc').value === '1' } });
          $('#view').href = `${storeUrl}/#/p/${r.slug}`; toast(r.published ? 'Saved & published' : 'Saved as draft');
        } else { await api('/api/admin/layout', { method: 'PUT', body: { blocks: bl, css, js } }); toast('Published'); }
        dirty = false; $('#dirty').hidden = true;
      } catch (x) { toast(x.message); }
    });
    $('#reset')?.addEventListener('click', async () => { if (confirm('Reset the home page, CSS and JavaScript to the default?')) { await api('/api/admin/layout', { method: 'DELETE' }); pages.builder(); toast('Reset'); } });
    window.onbeforeunload = () => (dirty ? 'x' : null);
  },

  async theme() {
    const t = await api('/api/admin/theme');
    const FONTS = { system: 'Modern (system)', serif: 'Classic serif', rounded: 'Friendly rounded', mono: 'Technical mono' };
    const PRESETS = { Forest: ['#244638', '#c8553d', '#f6f7f3', '#1d2a24'], Ocean: ['#1f4e79', '#f28c28', '#f3f7fb', '#14263a'], Berry: ['#6a2c5b', '#e8a33d', '#faf5f8', '#2a1626'], Mono: ['#111111', '#e5484d', '#fafafa', '#111111'] };
    const col = (n, l) => `<label>${l}<input name="${n}" type="color" value="${esc(t[n])}" style="height:42px;padding:3px"></label>`;
    layout('theme', `<div class="head"><h1>Theme</h1><a class="btn ghost" href="${esc(location.origin.replace(':3001', ':3000'))}" target="_blank" rel="noopener">View store</a></div>
      <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:20px;align-items:start">
      <form class="card form" id="f"><div id="e"></div><h2>Colours</h2>
        <p class="muted">Presets: ${Object.keys(PRESETS).map((k) => `<button type="button" class="btn ghost sm" data-p="${k}">${k}</button>`).join(' ')}</p>
        <div class="cols" style="grid-template-columns:1fr 1fr">${col('brand', 'Brand')}${col('accent', 'Accent')}${col('bg', 'Background')}${col('ink', 'Text')}</div>
        <h2 style="margin-top:22px">Style</h2><div class="cols" style="grid-template-columns:1fr 1fr">
        <label>Font<select name="font">${Object.entries(FONTS).map(([k, v]) => `<option value="${k}" ${t.font === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label>Corner radius (<span id="rv">${esc(t.radius)}</span>px)<input name="radius" type="range" min="0" max="28" value="${esc(t.radius)}"></label></div>
        <h2 style="margin-top:22px">Content</h2>
        <label>Announcement bar <span class="muted">(blank = hidden)</span><input name="announcement" maxlength="140" value="${esc(t.announcement)}"></label>
        <label>Hero eyebrow<input name="heroEyebrow" maxlength="80" value="${esc(t.heroEyebrow)}"></label>
        <label>Hero title<input name="heroTitle" required maxlength="120" value="${esc(t.heroTitle)}"></label>
        <label>Hero text<textarea name="heroText" rows="2" maxlength="300">${esc(t.heroText)}</textarea></label>
        <label>Hero button label<input name="heroButton" maxlength="40" value="${esc(t.heroButton)}"></label>
        <label>Hero background image URL <span class="muted">(optional)</span><input name="heroImage" placeholder="https://… or /images/uploads/…" value="${esc(t.heroImage)}"></label>
        <label>Footer text<input name="footerText" maxlength="140" value="${esc(t.footerText)}"></label>
        <br><div style="display:flex;gap:8px"><button class="btn">Save theme</button><button type="button" class="btn ghost" id="reset">Reset to default</button></div></form>
      <div class="card" style="position:sticky;top:76px"><h2>Preview</h2><div id="pv"></div></div></div>`);
    const FS = { system: 'system-ui,sans-serif', serif: 'Georgia,serif', rounded: 'ui-rounded,Nunito,system-ui,sans-serif', mono: 'ui-monospace,Menlo,monospace' };
    const f = $('#f');
    const preview = () => {
      const v = Object.fromEntries(new FormData(f)); $('#rv').textContent = v.radius;
      $('#pv').innerHTML = `<div style="background:${v.bg};color:${v.ink};font-family:${FS[v.font]};border:1px solid #ddd;border-radius:${+v.radius + 4}px;overflow:hidden">
        ${v.announcement ? `<div style="background:${v.brand};color:#fff;text-align:center;padding:6px;font-size:.8rem">${esc(v.announcement)}</div>` : ''}
        <div style="padding:10px 14px;font-weight:800;display:flex;gap:6px;align-items:center"><span style="background:${v.brand};color:#fff;border-radius:${v.radius}px;padding:2px 8px">e</span>Store</div>
        <div style="margin:0 14px;padding:22px;border-radius:${+v.radius + 8}px;background:${v.brand}1f">
          <div style="font-size:.65rem;letter-spacing:.1em;text-transform:uppercase;opacity:.7">${esc(v.heroEyebrow)}</div>
          <div style="font-size:1.4rem;font-weight:800;line-height:1.15;margin:4px 0">${esc(v.heroTitle)}</div>
          <div style="font-size:.85rem;opacity:.75;margin-bottom:10px">${esc(v.heroText)}</div>
          ${v.heroButton ? `<span style="display:inline-block;background:${v.brand};color:#fff;padding:6px 14px;border-radius:${v.radius}px;font-weight:600;font-size:.85rem">${esc(v.heroButton)}</span>` : ''}</div>
        <div style="display:flex;gap:10px;padding:14px">${['Tote', 'Mug'].map((n) => `<div style="flex:1;background:#fff;border:1px solid #0001;border-radius:${+v.radius + 4}px;padding:10px"><div style="height:46px;background:#0000000d;border-radius:${v.radius}px"></div><b style="font-size:.85rem">${n}</b><div style="font-size:.8rem">$24.00 <span style="background:${v.accent};color:#fff;border-radius:99px;padding:0 6px;font-size:.7rem">Sale</span></div></div>`).join('')}</div>
        <div style="padding:8px 14px 12px;font-size:.75rem;opacity:.6">© Store · ${esc(v.footerText)}</div></div>`;
    };
    f.addEventListener('input', preview); preview();
    document.querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', () => { PRESETS[b.dataset.p].forEach((c, i) => { f.elements[['brand', 'accent', 'bg', 'ink'][i]].value = c; }); preview(); }));
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await api('/api/admin/theme', { method: 'PUT', body: Object.fromEntries(new FormData(f)) }); toast('Theme saved — refresh your store'); } catch (x) { $('#e').innerHTML = errBox(x); }
    });
    $('#reset').addEventListener('click', async () => { if (confirm('Reset theme to defaults?')) { await api('/api/admin/theme', { method: 'DELETE' }); pages.theme(); toast('Theme reset'); } });
  },

  async settings(tab = 'general') {
    const TABS = [['general', 'General'], ['shipping', 'Shipping'], ['taxes', 'Taxes'], ['payments', 'Payments'], ['integrations', 'Integrations'], ['coupons', 'Coupons']];
    if (!TABS.some((t) => t[0] === tab)) tab = 'general';
    const [cfg, st] = await Promise.all([api('/api/admin/config'), api('/api/admin/settings')]);
    const put = async (section, body, msg = 'Settings saved') => {
      try { const r = await api(`/api/admin/config/${section}`, { method: 'PUT', body }); toast(msg); return r; } catch (x) { $('#e').innerHTML = errBox(x); return null; }
    };
    const nav = `<div class="tabs">${TABS.map(([k, l]) => `<a href="#/settings/${k}" class="${k === tab ? 'on' : ''}">${l}</a>`).join('')}</div>`;
    const head = (t, d) => `<div class="head"><h1>Settings</h1></div>${nav}<p class="muted">${d}</p><div id="e"></div>`;
    const v = (x) => esc(x ?? '');
    if (tab === 'general') {
      const g = cfg.general;
      layout('settings', `${head('General', 'Store details shown to customers in the storefront footer and used for prices.')}
        <form class="card form" id="f"><label>Store name<input name="storeName" required maxlength="60" value="${v(st.storeName)}"></label>
        <label>Contact email<input name="email" type="email" maxlength="120" value="${v(g.email)}"></label>
        <label>Phone<input name="phone" maxlength="40" value="${v(g.phone)}"></label>
        <label>Business address<textarea name="address" rows="2" maxlength="300">${v(g.address)}</textarea></label>
        <label>Currency<select name="currency">${cfg.currencies.map((c) => `<option ${c === g.currency ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
        <br><button class="btn">Save</button></form>`);
      $('#f').addEventListener('submit', async (e) => { e.preventDefault(); const r = await put('general', Object.fromEntries(new FormData(e.target))); if (r) currency = r.general.currency; });
    } else if (tab === 'shipping') {
      let list = cfg.shipping.map((m) => ({ ...m }));
      const draw = () => {
        layout('settings', `${head('Shipping', 'Offer one or more delivery options. Customers pick one at checkout. “Free over” gives free shipping on that option once the order reaches the amount (0 = never).')}
          <div class="card"><table><thead><tr><th>Name</th><th>Price</th><th>Free over</th><th>Delivery time</th><th></th></tr></thead><tbody>
          ${list.map((m, i) => `<tr><td><input data-f="name" data-i="${i}" value="${v(m.name)}" maxlength="60"></td><td><input data-f="price" data-i="${i}" type="number" min="0" step="0.01" value="${v(m.price)}"></td>
            <td><input data-f="freeOver" data-i="${i}" type="number" min="0" step="0.01" value="${v(m.freeOver)}"></td><td><input data-f="days" data-i="${i}" value="${v(m.days)}" placeholder="3-5 business days" maxlength="30"></td>
            <td style="text-align:right"><button class="btn ghost mini" data-rm="${i}" ${list.length < 2 ? 'disabled' : ''}>Remove</button></td></tr>`).join('')}</tbody></table></div>
          <p style="margin-top:14px"><button class="btn ghost" id="add">Add method</button> <button class="btn" id="save">Save shipping</button></p>`);
        const sync = () => document.querySelectorAll('[data-f]').forEach((el) => { list[el.dataset.i][el.dataset.f] = el.value; });
        $('#add').addEventListener('click', () => { sync(); list.push({ name: '', price: 0, freeOver: 0, days: '' }); draw(); });
        document.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => { sync(); list.splice(+b.dataset.rm, 1); draw(); }));
        $('#save').addEventListener('click', async () => { sync(); const r = await put('shipping', { methods: list }); if (r) { list = r.shipping.map((m) => ({ ...m })); draw(); } });
      };
      draw();
    } else if (tab === 'taxes') {
      layout('settings', `${head('Taxes', 'A single tax rate applied to the order after discounts.')}
        <form class="card form" id="f"><label>Tax name<input name="label" maxlength="20" value="${v(cfg.tax.label)}" placeholder="VAT, GST, Sales tax…"></label>
        <label>Rate (%)<input name="taxRate" type="number" step="0.01" min="0" max="100" value="${v(st.taxRate)}"></label><br><button class="btn">Save</button></form>`);
      $('#f').addEventListener('submit', (e) => { e.preventDefault(); put('tax', Object.fromEntries(new FormData(e.target))); });
    } else if (tab === 'payments') {
      const p = cfg.payments;
      layout('settings', `${head('Payments', 'Choose how customers can pay. Online card gateways (Stripe, PayPal) are not connected yet; orders are paid manually.')}
        <form class="card form" id="f"><label class="chk"><input type="checkbox" name="cod" ${p.cod.enabled ? 'checked' : ''}> <b>Cash on delivery</b></label><hr>
        <label class="chk"><input type="checkbox" name="bankEnabled" ${p.bank.enabled ? 'checked' : ''}> <b>Bank transfer</b></label>
        <label>Instructions shown at checkout<textarea name="bankInstructions" rows="3" maxlength="600" placeholder="Bank, account name, account number, reference…">${v(p.bank.instructions)}</textarea></label><br><button class="btn">Save</button></form>`);
      $('#f').addEventListener('submit', (e) => { e.preventDefault(); const f = new FormData(e.target); put('payments', { cod: f.has('cod'), bankEnabled: f.has('bankEnabled'), bankInstructions: f.get('bankInstructions') }); });
    } else if (tab === 'integrations') {
      let hooks = cfg.integrations.webhooks.map((h) => ({ ...h, secret: '' }));
      const log = await api('/api/admin/webhook-log');
      const draw = () => {
        layout('settings', `${head('Integrations', 'Connect analytics and send order events to other systems.')}
          <form class="card form" id="f"><h2>Analytics &amp; tracking</h2><div class="cols" style="grid-template-columns:1fr 1fr"><label>Google Analytics ID<input name="ga" value="${v(cfg.integrations.ga)}" placeholder="G-XXXXXXXXXX"></label>
          <label>Meta (Facebook) Pixel ID<input name="pixel" value="${v(cfg.integrations.pixel)}" placeholder="1234567890"></label></div>
          <h2 style="margin-top:22px">Webhooks</h2><p class="muted">We POST JSON to each URL when an event happens. If you set a secret, requests carry an <code>x-ebuy-signature</code> header (HMAC-SHA256 of the body).</p>
          ${hooks.map((h, i) => `<div class="card pad" style="margin-bottom:10px"><div class="cols" style="grid-template-columns:3fr 2fr"><label>URL<input data-f="url" data-i="${i}" value="${v(h.url)}" placeholder="https://example.com/hook"></label>
            <label>Secret ${h.hasSecret ? '<span class="muted">(saved — leave blank to keep)</span>' : ''}<input data-f="secret" data-i="${i}" type="password" autocomplete="new-password" value=""></label></div>
            <p>${cfg.webhookEvents.map((ev) => `<label class="chk" style="display:inline-flex;margin-right:16px"><input type="checkbox" data-ev="${ev}" data-i="${i}" ${h.events.includes(ev) ? 'checked' : ''}> ${ev}</label>`).join('')}</p>
            <button type="button" class="btn ghost mini" data-test="${i}">Send test</button> <button type="button" class="btn ghost mini" data-rm="${i}">Remove</button></div>`).join('')}
          <p><button type="button" class="btn ghost" id="add">Add webhook</button></p>
          ${log.length ? `<h2 style="margin-top:18px">Recent deliveries</h2><table><tbody>${log.slice(0, 8).map((l) => `<tr><td class="muted">${esc(l.at.slice(11, 19))}</td><td>${esc(l.event)}</td><td class="muted">${esc(l.url)}</td><td><span class="badge ${l.status >= 200 && l.status < 300 ? 'ok' : 'warn'}">${esc(l.status)}</span></td></tr>`).join('')}</tbody></table>` : ''}
          <br><button class="btn">Save integrations</button></form>`);
        const sync = () => { document.querySelectorAll('[data-f]').forEach((el) => { hooks[el.dataset.i][el.dataset.f] = el.value; }); hooks.forEach((h, i) => { h.events = [...document.querySelectorAll(`[data-ev][data-i="${i}"]`)].filter((c) => c.checked).map((c) => c.dataset.ev); }); };
        const body = () => { sync(); const f = new FormData($('#f')); return { ga: f.get('ga'), pixel: f.get('pixel'), webhooks: hooks.map(({ url, secret, events }) => ({ url, secret, events })) }; };
        $('#add').addEventListener('click', () => { const b = body(); cfg.integrations.ga = b.ga; cfg.integrations.pixel = b.pixel; hooks.push({ url: '', secret: '', events: ['order.created'] }); draw(); });
        document.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => { sync(); hooks.splice(+b.dataset.rm, 1); draw(); }));
        document.querySelectorAll('[data-test]').forEach((b) => b.addEventListener('click', async () => {
          try { const r = await api('/api/admin/webhooks/test', { method: 'POST', body: { url: hooks[+b.dataset.test].url } }); toast(`Test sent: ${r.status}`); pages.settings('integrations'); } catch (x) { $('#e').innerHTML = errBox(x); }
        }));
        $('#f').addEventListener('submit', async (e) => { e.preventDefault(); const r = await put('integrations', body()); if (r) { cfg.integrations = r.integrations; hooks = r.integrations.webhooks.map((h) => ({ ...h, secret: '' })); draw(); } });
      };
      draw();
    } else {
      layout('settings', `${head('Coupons', 'Discount codes live in their own section.')}
        <div class="card pad"><p>Create percentage or fixed-amount codes, set minimum spend, usage limits and expiry dates.</p><a class="btn" href="#/discounts">Manage discount codes</a></div>`);
    }
  },

  login() {
    $('#root').innerHTML = `<form class="card login" id="f"><div class="logo"><span class="mark">e</span>ebuy</div><h1>Log in</h1><p class="muted">Continue to your store admin</p><div id="e"></div>
      <label>Username<input name="username" required autocomplete="username"></label>
      <label>Password<input name="password" type="password" required autocomplete="current-password"></label>
      <br><button class="btn" style="width:100%">Sign in</button></form>`;
    $('#f').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const s = await api('/api/auth/login', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
        if (s.user.role !== 'ROLE_ADMIN') throw new Error('This account does not have admin access');
        session.set(s); location.hash = '#/';
      } catch (x) { $('#e').innerHTML = errBox(x); }
    });
  },
};

async function route() {
  const [, section = '', id] = (location.hash.slice(1) || '/').split('/');
  if (section === 'login') return pages.login();
  if (!session.token) { location.hash = '#/login'; return; }
  try {
    if (!route.cur) { route.cur = true; currency = (await api('/api/settings')).currency || 'USD'; }
    if (section === 'products') await (id ? pages.productForm(id === 'new' ? null : id) : pages.products());
    else if (section === 'orders') await (id ? pages.orderDetail(id) : pages.orders());
    else if (section === 'categories') await pages.categories(id);
    else if (section === 'customers') await pages.customers();
    else if (section === 'inventory') await pages.inventory();
    else if (section === 'discounts') await pages.discounts(id);
    else if (section === 'landing') await pages.landing();
    else if (section === 'builder') await pages.builder(id);
    else if (section === 'navigation') await pages.navigation();
    else if (section === 'theme') await pages.theme();
    else if (section === 'settings') await pages.settings(id);
    else await pages.dashboard();
  } catch (e) { if (session.token) layout('', `<h1>Something went wrong</h1>${errBox(e)}`); }
}
window.addEventListener('hashchange', route);
route();
