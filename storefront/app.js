const API = window.EBUY_API;
const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const was = (p) => (p.compareAtPrice > p.price ? ` <s class="muted">${money(p.compareAtPrice)}</s>` : '');
let settings = { currency: 'USD', contact: {}, shippingMethods: [], payments: { cod: true, bank: null }, tracking: {} };
const money = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: settings.currency }).format(n);
const img = (u) => (u ? (u.startsWith('/') ? API + u : u) : '');

const store = {
  get token() { return localStorage.getItem('ebuy_token'); },
  get user() { try { return JSON.parse(localStorage.getItem('ebuy_user')); } catch { return null; } },
  set session(s) { if (s) { localStorage.setItem('ebuy_token', s.token); localStorage.setItem('ebuy_user', JSON.stringify(s.user)); } else { localStorage.removeItem('ebuy_token'); localStorage.removeItem('ebuy_user'); } },
  get cart() { try { return JSON.parse(localStorage.getItem('ebuy_cart')) || []; } catch { return []; } },
  set cart(c) { localStorage.setItem('ebuy_cart', JSON.stringify(c)); },
};

async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    method: opts.method || 'GET',
    headers: { ...(opts.body ? { 'content-type': 'application/json' } : {}), ...(store.token ? { authorization: `Bearer ${store.token}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && store.token) { store.session = null; renderNav(); }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 1800); }
const go = (h) => { location.hash = h; };
const err = (e) => `<div class="err" role="alert">${esc(e.message || e)}</div>`;

const FONT_STACKS = { system: 'system-ui, -apple-system, "Segoe UI", sans-serif', serif: 'Georgia, "Times New Roman", serif', rounded: 'ui-rounded, "Nunito", "Segoe UI", system-ui, sans-serif', mono: 'ui-monospace, "SFMono-Regular", Menlo, monospace' };
let theme = { storeName: 'ebuy', heroEyebrow: '', heroTitle: '', heroText: '', heroButton: '', heroImage: '', footerText: '', announcement: '' };
function applyTheme(t) {
  theme = { ...theme, ...t };
  const r = document.documentElement.style;
  r.setProperty('--brand', t.brand); r.setProperty('--accent', t.accent); r.setProperty('--bg', t.bg); r.setProperty('--ink', t.ink);
  r.setProperty('--radius', `${t.radius}px`); r.setProperty('--font', FONT_STACKS[t.font] || FONT_STACKS.system);
  document.title = `${t.storeName} | Everyday finds`;
  $('#announce').hidden = !t.announcement; $('#announce').textContent = t.announcement || '';
  const c = settings.contact || {};
  $('#foot').textContent = [`© ${t.storeName} · ${t.footerText}`, c.email, c.phone, c.address].filter(Boolean).join(' · ');
}
window.__applyTheme = applyTheme;

let navItems = [{ label: 'Shop', link: '#/products' }];
function renderNav() {
  const count = store.cart.reduce((n, l) => n + l.quantity, 0), u = store.user;
  $('#nav').innerHTML = `
    <a class="logo" href="#/"><b>${esc((theme.storeName || 'e')[0].toUpperCase())}</b>${esc(theme.storeName)}</a>
    ${navItems.map((i) => `<a class="l" href="${esc(i.link)}"${/^https?:/.test(i.link) ? ' target="_blank" rel="noopener"' : ''}>${esc(i.label)}</a>`).join('')}
    <span class="sp"></span>
    <a class="l" href="#/cart">Cart${count ? `<span class="badge">${count}</span>` : ''}</a>
    ${u ? `<a class="l" href="#/orders">My orders</a><span class="muted">Hi, ${esc(u.username)}</span><button class="btn ghost sm" id="out">Sign out</button>`
        : `<a class="l" href="#/login">Sign in</a><a class="btn sm" href="#/register">Create account</a>`}`;
  $('#out')?.addEventListener('click', () => { store.session = null; renderNav(); go('#/'); });
}

const card = (p) => `
  <article class="card">
    <a class="img" href="#/products/${p.id}">${p.imageUrl ? `<img src="${esc(img(p.imageUrl))}" alt="${esc(p.name)}" loading="lazy">` : ''}</a>
    <div class="body">
      <div class="cat">${esc(p.category.name)}</div>
      <h3><a href="#/products/${p.id}">${esc(p.name)}</a></h3>
      <p class="desc">${esc(p.description)}</p>
      <div class="row"><span class="price">${money(p.price)}${was(p)}</span>
        <span class="stock ${p.stockQuantity ? '' : 'out'}">${p.stockQuantity ? 'In stock' : 'Sold out'}</span></div>
    </div>
  </article>`;

function addToCart(p, quantity = 1) {
  const cart = store.cart, line = cart.find((l) => l.id === p.id);
  const next = Math.min(p.stockQuantity, (line?.quantity || 0) + quantity);
  if (line) line.quantity = next; else cart.push({ id: p.id, name: p.name, price: p.price, imageUrl: p.imageUrl, stock: p.stockQuantity, quantity: next });
  store.cart = cart; renderNav(); toast(`Added ${p.name}`);
}

let layout = { blocks: [], css: '', js: '' };
const align = (v) => (v ? ` style="text-align:${v}"` : '');
async function renderBlock(b) {
  const p = b.props || {}, id = `data-block="${esc(b.type)}" data-id="${esc(b.id || '')}"`;
  switch (b.type) {
    case 'hero': {
      const t = (k, d) => p[k] || d, image = p.image || theme.heroImage, link = p.link || '#/products';
      const bg = image ? ` style="background-image:linear-gradient(90deg,rgba(255,255,255,.88),rgba(255,255,255,.35)),url('${esc(img(image))}');background-size:cover;background-position:center"` : '';
      const btn = t('button', theme.heroButton);
      return `<section class="hero" ${id}${bg}><p class="eyebrow">${esc(t('eyebrow', theme.heroEyebrow))}</p><h1>${esc(t('title', theme.heroTitle))}</h1><p>${esc(t('text', theme.heroText))}</p>${btn ? `<a class="btn" href="${esc(link)}">${esc(btn)}</a>` : ''}</section>`;
    }
    case 'heading': { const n = p.size || '2'; return `<h${n} class="blk" ${id}${align(p.align)}>${esc(p.text)}</h${n}>`; }
    case 'text': return `<div class="blk blk-text" ${id}${align(p.align)}>${esc(p.text).replace(/\n/g, '<br>')}</div>`;
    case 'image': { if (!p.url) return ''; const im = `<img src="${esc(img(p.url))}" alt="${esc(p.alt)}" loading="lazy">`; return `<figure class="blk blk-image ${p.fit === 'full' ? 'full' : ''}" ${id}>${p.link ? `<a href="${esc(p.link)}">${im}</a>` : im}</figure>`; }
    case 'button': return `<div class="blk" ${id}${align(p.align)}><a class="btn ${p.style === 'outline' ? 'ghost' : ''}" href="${esc(p.link || '#/products')}">${esc(p.label || 'Shop now')}</a></div>`;
    case 'banner': return `<div class="blk blk-banner" ${id} style="${p.color ? `background:${esc(p.color)}` : ''}">${p.link ? `<a href="${esc(p.link)}">${esc(p.text)}</a>` : esc(p.text)}</div>`;
    case 'spacer': return `<div class="blk" ${id} style="height:${Number(p.height) || 32}px" aria-hidden="true"></div>`;
    case 'html': return `<div class="blk" ${id}>${p.html || ''}</div>`;
    case 'products': {
      const { items } = await api(`/api/products?size=${Number(p.count) || 6}${p.category ? `&category=${Number(p.category)}` : ''}`);
      return `<section class="blk" ${id}>${p.eyebrow ? `<p class="eyebrow">${esc(p.eyebrow)}</p>` : ''}${p.title ? `<h2>${esc(p.title)}</h2><br>` : ''}<div class="grid">${items.map(card).join('')}</div></section>`;
    }
    default: return '';
  }
}
function applyTracking() {
  const { ga, pixel } = settings.tracking || {};
  const add = (id, code) => { if (document.getElementById(id)) return; const s = document.createElement('script'); s.id = id; s.textContent = code; document.head.appendChild(s); };
  if (ga && /^[A-Za-z0-9-]+$/.test(ga)) {
    const s = document.createElement('script'); s.async = true; s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ga)}`; document.head.appendChild(s);
    add('ga-init', `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config',${JSON.stringify(ga)});`);
  }
  if (pixel && /^\d+$/.test(pixel)) add('fb-init', `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${pixel}');fbq('track','PageView');`);
}
function applyLayoutAssets() {
  document.getElementById('custom-css')?.remove();
  if (layout.css) { const st = document.createElement('style'); st.id = 'custom-css'; st.textContent = layout.css; document.head.appendChild(st); }
  document.getElementById('custom-js')?.remove();
  if (layout.js) { const sc = document.createElement('script'); sc.id = 'custom-js'; sc.textContent = `try {\n${layout.js}\n} catch (e) { console.error('[ebuy custom js]', e); }`; document.body.appendChild(sc); }
}

const pages = {
  async home(app) {
    const L = layout;
    const parts = await Promise.all(L.blocks.map((b) => renderBlock(b).catch(() => '')));
    app.innerHTML = parts.join('') || '<p class="muted">This page has no content yet.</p>';
  },

  async landing(app, slug) {
    let pg;
    try { pg = await api(`/api/pages/${encodeURIComponent(slug)}`); } catch (e) {
      if (e.status === 401 || /sign in/i.test(e.message || '')) { app.innerHTML = '<h2>Members only</h2><p class="muted">Please sign in to view this page.</p><a class="btn" href="#/login">Sign in</a>'; return; } app.innerHTML = '<h2>Page not found</h2><p class="muted">This page does not exist or is not published.</p><a class="btn" href="#/">Back home</a>'; return; }
    document.title = `${pg.title} | ${theme.storeName}`;
    const parts = await Promise.all(pg.blocks.map((b) => renderBlock(b).catch(() => '')));
    app.innerHTML = parts.join('');
    if (pg.css) { const st = document.createElement('style'); st.className = 'page-css'; st.textContent = pg.css; app.prepend(st); }
  },

  async products(app, _id, query) {
    const q = new URLSearchParams(query), page = Number(q.get('page') || 0);
    const [cats, data] = await Promise.all([api('/api/categories'), api(`/api/products?size=9&${new URLSearchParams({ q: q.get('q') || '', category: q.get('category') || '', page })}`)]);
    app.innerHTML = `
      <p class="eyebrow">Find your next favorite</p><h2>The collection</h2>
      <form class="filters" id="f">
        <input name="q" type="search" placeholder="Search by product name…" value="${esc(q.get('q') || '')}" aria-label="Search products">
        <select name="category" aria-label="Category"><option value="">All categories</option>
          ${cats.map((c) => `<option value="${c.id}" ${q.get('category') == c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
        <button class="btn">Find products</button></form>
      <p class="muted">${data.total} item${data.total === 1 ? '' : 's'}</p>
      <div class="grid">${data.items.map(card).join('') || '<p>No products match.</p>'}</div>
      ${data.totalPages > 1 ? `<div class="pager">${Array.from({ length: data.totalPages }, (_, i) =>
        `<a class="btn sm ${i === page ? '' : 'ghost'}" href="#/products?${new URLSearchParams({ q: q.get('q') || '', category: q.get('category') || '', page: i })}">${i + 1}</a>`).join('')}</div>` : ''}`;
    $('#f').addEventListener('submit', (e) => { e.preventDefault(); go('#/products?' + new URLSearchParams(Object.fromEntries(new FormData(e.target)))); });
  },

  async product(app, id) {
    const p = await api(`/api/products/${id}`);
    app.innerHTML = `
      <p><a href="#/products">← Back to shop</a></p>
      <div class="detail">
        <div class="pic">${p.imageUrl ? `<img src="${esc(img(p.imageUrl))}" alt="${esc(p.name)}">` : ''}</div>
        <div><div class="cat">${esc(p.category.name)}</div><h1>${esc(p.name)}</h1>
          <p class="price" style="font-size:1.5rem">${money(p.price)}${was(p)}</p><p class="muted">${esc(p.description)}</p>
          <p class="stock ${p.stockQuantity ? '' : 'out'}">${p.stockQuantity ? `${p.stockQuantity} in stock` : 'Sold out'}</p>
          <button class="btn" id="add" ${p.stockQuantity ? '' : 'disabled'}>Add to cart</button></div>
      </div>`;
    $('#add').addEventListener('click', () => addToCart(p));
  },

  cart(app) {
    const cart = store.cart;
    if (!cart.length) { app.innerHTML = `<h2>Your cart</h2><p class="muted">Your cart is empty.</p><a class="btn" href="#/products">Start shopping</a>`; return; }
    const total = cart.reduce((s, l) => s + l.price * l.quantity, 0);
    app.innerHTML = `<h2>Your cart</h2><br>
      <table><thead><tr><th></th><th>Product</th><th>Price</th><th>Qty</th><th>Subtotal</th><th></th></tr></thead><tbody>
      ${cart.map((l) => `<tr><td>${l.imageUrl ? `<img class="thumb" src="${esc(img(l.imageUrl))}" alt="">` : ''}</td><td>${esc(l.name)}</td><td>${money(l.price)}</td>
        <td><input class="qty" type="number" min="1" max="${l.stock}" value="${l.quantity}" data-id="${l.id}" aria-label="Quantity for ${esc(l.name)}"></td>
        <td>${money(l.price * l.quantity)}</td><td><button class="btn ghost sm" data-rm="${l.id}">Remove</button></td></tr>`).join('')}
      </tbody></table>
      <p class="row" style="margin-top:20px"><strong>Total: ${money(total)}</strong><a class="btn" href="#/checkout">Checkout</a></p>`;
    app.querySelectorAll('.qty').forEach((i) => i.addEventListener('change', () => {
      const c = store.cart, l = c.find((x) => x.id == i.dataset.id);
      l.quantity = Math.max(1, Math.min(l.stock, parseInt(i.value) || 1)); store.cart = c; renderNav(); pages.cart(app);
    }));
    app.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => { store.cart = store.cart.filter((l) => l.id != b.dataset.rm); renderNav(); pages.cart(app); }));
  },

  checkout(app) {
    if (!store.user) { sessionStorage.setItem('ebuy_next', '#/checkout'); return go('#/login'); }
    const cart = store.cart, u = store.user;
    if (!cart.length) return go('#/cart');
    app.innerHTML = `<h2>Checkout</h2><div class="detail" style="margin-top:18px">
      <form class="panel" id="f"><div id="e"></div>
        <label>Recipient name<input name="recipientName" required value="${esc(u.fullName || '')}"></label>
        <label>Phone<input name="phone" required value="${esc(u.phone || '')}"></label>
        <label>Shipping address<textarea name="shippingAddress" rows="3" required>${esc(u.address || '')}</textarea></label>
        <h3>Shipping method</h3><div id="ship">${settings.shippingMethods.map((m, i) => `<label class="opt"><input type="radio" name="shippingMethod" value="${esc(m.id)}" ${i ? '' : 'checked'}> ${esc(m.name)}${m.days ? ` <span class="muted">(${esc(m.days)})</span>` : ''}</label>`).join('')}</div>
        <h3>Payment</h3>${[settings.payments.cod && ['cod', 'Cash on delivery'], settings.payments.bank && ['bank', 'Bank transfer']].filter(Boolean).map((p, i) => `<label class="opt"><input type="radio" name="paymentMethod" value="${p[0]}" ${i ? '' : 'checked'}> ${p[1]}</label>`).join('')}
        <p class="muted" id="bankinfo" hidden>${esc(settings.payments.bank?.instructions || '')}</p>
        <br><button class="btn" id="place">Place order</button></form>
      <div class="panel"><h3 style="margin-top:0">Order summary</h3>
        ${cart.map((l) => `<div class="row"><span>${esc(l.name)} × ${l.quantity}</span><span>${money(l.price * l.quantity)}</span></div>`).join('')}
        <hr><div style="display:flex;gap:8px"><input id="promo" placeholder="Discount code" style="flex:1" value="${esc(sessionStorage.getItem('ebuy_promo') || '')}"><button type="button" class="btn ghost" id="apply">Apply</button></div>
        <div id="pe"></div><div id="sum" style="margin-top:12px"></div></div></div>`;
    const items = cart.map((l) => ({ productId: l.id, quantity: l.quantity }));
    const refresh = async () => {
      const code = $('#promo').value.trim();
      try {
        const q = await api('/api/checkout/quote', { method: 'POST', body: { items, discountCode: code, shippingMethod: document.querySelector('[name=shippingMethod]:checked')?.value } });
        sessionStorage.setItem('ebuy_promo', q.code || ''); $('#pe').innerHTML = q.code ? `<p class="muted">Code ${esc(q.code)} applied</p>` : '';
        $('#sum').innerHTML = `<div class="row"><span>Subtotal</span><span>${money(q.subtotal)}</span></div>
          ${q.discount ? `<div class="row"><span>Discount</span><span>−${money(q.discount)}</span></div>` : ''}
          <div class="row"><span>Shipping${q.shippingMethod ? ` · ${esc(q.shippingMethod)}` : ''}</span><span>${q.shipping ? money(q.shipping) : 'Free'}</span></div>
          ${q.tax ? `<div class="row"><span>${esc(settings.taxLabel || 'Tax')}</span><span>${money(q.tax)}</span></div>` : ''}
          <hr><div class="row"><strong>Total</strong><strong>${money(q.total)}</strong></div>`;
        $('#place').textContent = `Place order · ${money(q.total)}`; $('#place').disabled = false;
      } catch (x) {
        if (code && !x.message.includes('stock') && !x.message.includes('cart')) { $('#promo').value = ''; sessionStorage.removeItem('ebuy_promo'); await refresh(); }
        else $('#place').disabled = true;
        $('#pe').innerHTML = err(x);
      }
    };
    app.querySelectorAll('[name=shippingMethod]').forEach((r) => r.addEventListener('change', refresh));
    app.querySelectorAll('[name=paymentMethod]').forEach((r) => r.addEventListener('change', () => { $('#bankinfo').hidden = document.querySelector('[name=paymentMethod]:checked').value !== 'bank'; }));
    $('#apply').addEventListener('click', () => { sessionStorage.removeItem('ebuy_promo'); refresh(); });
    refresh();
    $('#f').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('#place'); btn.disabled = true;
      try {
        const body = { ...Object.fromEntries(new FormData(e.target)), items, discountCode: $('#promo').value.trim() };
        const order = await api('/api/orders', { method: 'POST', body });
        sessionStorage.removeItem('ebuy_promo'); store.cart = []; renderNav(); go(`#/orders/${order.id}`);
      } catch (x) { $('#e').innerHTML = err(x); btn.disabled = false; }
    });
  },

  async orders(app) {
    if (!store.user) return go('#/login');
    const orders = await api('/api/orders');
    app.innerHTML = `<h2>My orders</h2><br>${orders.length ? `<table><thead><tr><th>Order</th><th>Date</th><th>Status</th><th>Total</th></tr></thead><tbody>
      ${orders.map((o) => `<tr><td><a href="#/orders/${o.id}">${esc(o.orderNumber)}</a></td><td>${new Date(o.createdAt).toLocaleDateString()}</td><td><span class="status ${o.status}">${o.status}</span></td><td>${money(o.totalAmount)}</td></tr>`).join('')}
      </tbody></table>` : '<p class="muted">No orders yet.</p>'}`;
  },

  async order(app, id) {
    if (!store.user) return go('#/login');
    const o = await api(`/api/orders/${id}`);
    app.innerHTML = `<p><a href="#/orders">← My orders</a></p><h2>Order ${esc(o.orderNumber)}</h2>
      <p><span class="status ${o.status}">${o.status}</span> <span class="muted">placed ${new Date(o.createdAt).toLocaleString()}</span></p>
      <p class="muted">${o.shippingMethod ? `Shipping: ${esc(o.shippingMethod)} · ` : ''}Payment: ${o.paymentMethod === 'bank' ? 'Bank transfer' : 'Cash on delivery'}</p>
      <p class="muted">Ship to ${esc(o.recipientName)}, ${esc(o.shippingAddress)} · ${esc(o.phone)}</p>
      <table><tbody>${o.items.map((i) => `<tr><td>${esc(i.name)}</td><td>${i.quantity} × ${money(i.unitPrice)}</td><td>${money(i.quantity * i.unitPrice)}</td></tr>`).join('')}</tbody></table>
      <div style="text-align:right;margin-top:16px">${o.discountAmount ? `<p class="muted">Discount (${esc(o.discountCode)}): −${money(o.discountAmount)}</p>` : ''}${o.shippingAmount ? `<p class="muted">Shipping: ${money(o.shippingAmount)}</p>` : ''}${o.taxAmount ? `<p class="muted">Tax: ${money(o.taxAmount)}</p>` : ''}<strong>Total: ${money(o.totalAmount)}</strong></div>`;
  },

  login(app) { authForm(app, 'login'); },
  register(app) { authForm(app, 'register'); },
};

function authForm(app, mode) {
  const reg = mode === 'register';
  app.innerHTML = `<form class="panel narrow" id="f"><h2>${reg ? 'Create account' : 'Sign in'}</h2><div id="e"></div>
    <label>Username<input name="username" required autocomplete="username"></label>
    ${reg ? '<label>Email<input name="email" type="email" required autocomplete="email"></label><label>Full name<input name="fullName"></label>' : ''}
    <label>Password<input name="password" type="password" required minlength="${reg ? 8 : 1}" autocomplete="${reg ? 'new-password' : 'current-password'}"></label>
    <br><button class="btn">${reg ? 'Create account' : 'Sign in'}</button>
    <p class="muted">${reg ? 'Have an account? <a href="#/login">Sign in</a>' : 'New to ebuy? <a href="#/register">Create an account</a>'}</p></form>`;
  $('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      store.session = await api(`/api/auth/${mode}`, { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
      renderNav();
      const next = sessionStorage.getItem('ebuy_next') || '#/'; sessionStorage.removeItem('ebuy_next'); go(next);
    } catch (x) { $('#e').innerHTML = err(x); }
  });
}

async function route() {
  const [path, query = ''] = (location.hash.slice(1) || '/').split('?');
  const [, section = '', id] = path.split('/');
  const map = { '': 'home', p: 'landing', products: id ? 'product' : 'products', cart: 'cart', checkout: 'checkout', orders: id ? 'order' : 'orders', login: 'login', register: 'register' };
  const app = $('#app');
  renderNav(); document.title = `${theme.storeName} | Everyday finds`;
  try { await (pages[map[section]] || pages.home)(app, id, query); window.scrollTo(0, 0); window.dispatchEvent(new CustomEvent('ebuy:route', { detail: { path } })); }
  catch (e) { app.innerHTML = `<h2>Something went wrong</h2>${err(e)}<a class="btn" href="#/">Back home</a>`; }
}
window.addEventListener('hashchange', route);
window.ebuy = { api, money, go };
Promise.all([api('/api/settings').then((s) => { settings = s; }).catch(() => {}), api('/api/theme').then(applyTheme), api('/api/layout').then((l) => { layout = l; }), api('/api/nav').then((n) => { navItems = n; })]).catch(() => {}).finally(() => { applyTheme(theme); applyTracking(); applyLayoutAssets(); route(); });
