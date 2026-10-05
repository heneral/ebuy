import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomBytes, createHmac } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { db, tx } from './db.js';

const PORT = Number(process.env.PORT || 4000);
const ORIGINS = (process.env.CORS_ORIGINS || 'http://localhost:3000,http://localhost:3001').split(',');
const SECRET = process.env.JWT_SECRET || randomBytes(32).toString('hex');
if (!process.env.JWT_SECRET) console.warn('JWT_SECRET not set: using a random secret, sessions reset on restart.');
const STATUSES = ['PENDING', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED'];

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (msg) => new HttpError(400, msg);
const wrap = (fn) => (req, res, next) => { try { Promise.resolve(fn(req, res, next)).catch(next); } catch (e) { next(e); } };
const str = (v, max = 255) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

const publicUser = (u) => ({ id: u.id, username: u.username, email: u.email, fullName: u.full_name, phone: u.phone, address: u.address, role: u.role });
const productOut = (p) => ({ id: p.id, name: p.name, description: p.description, sku: p.sku, price: p.price, compareAtPrice: p.compare_at_price, stockQuantity: p.stock_quantity, imageUrl: p.image_url, active: !!p.active, category: { id: p.category_id, name: p.category_name } });
const PRODUCT_SQL = 'SELECT p.*, c.name AS category_name FROM products p JOIN categories c ON c.id = p.category_id';

function auth(req, _res, next) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) {
    try {
      const { sub } = jwt.verify(h.slice(7), SECRET);
      req.user = db.prepare('SELECT * FROM users WHERE id = ?').get(sub);
    } catch { /* treated as anonymous */ }
  }
  next();
}
const requireUser = (req, _res, next) => (req.user ? next() : next(new HttpError(401, 'Sign in required')));
const requireAdmin = (req, _res, next) => {
  if (!req.user) return next(new HttpError(401, 'Sign in required'));
  if (req.user.role !== 'ROLE_ADMIN') return next(new HttpError(403, 'Admin access required'));
  next();
};
const sign = (u) => jwt.sign({ sub: u.id }, SECRET, { expiresIn: '8h' });

const app = express();
app.use(cors({ origin: ORIGINS }));
const IMG_DIR = new URL('../public/images', import.meta.url).pathname;
const MAGIC = [['png', [0x89, 0x50, 0x4e, 0x47]], ['jpg', [0xff, 0xd8, 0xff]], ['gif', [0x47, 0x49, 0x46, 0x38]], ['webp', [0x52, 0x49, 0x46, 0x46]]];
app.post('/api/admin/upload', auth, requireAdmin, express.raw({ type: () => true, limit: '5mb' }), wrap((req, res) => {
  const buf = req.body;
  const ext = Buffer.isBuffer(buf) && MAGIC.find(([, sig]) => sig.every((b, i) => buf[i] === b))?.[0];
  if (!ext) throw bad('Upload a PNG, JPG, GIF or WebP image (max 5 MB)');
  mkdirSync(`${IMG_DIR}/uploads`, { recursive: true });
  const name = `${Date.now()}-${randomBytes(4).toString('hex')}.${ext}`;
  writeFileSync(`${IMG_DIR}/uploads/${name}`, buf);
  res.status(201).json({ url: `/images/uploads/${name}` });
}));
app.use(express.json({ limit: '400kb' }));
app.use('/images', express.static(IMG_DIR, { maxAge: '1h' }));
app.use(auth);

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// ---- auth
const attempts = new Map();
function throttle(req) {
  const key = req.ip, now = Date.now();
  const recent = (attempts.get(key) || []).filter((t) => now - t < 60_000);
  if (recent.length >= 10) throw new HttpError(429, 'Too many attempts, try again in a minute');
  recent.push(now); attempts.set(key, recent);
}

app.post('/api/auth/login', wrap((req, res) => {
  throttle(req);
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(str(req.body.username));
  if (!u || !bcrypt.compareSync(String(req.body.password || ''), u.password)) throw new HttpError(401, 'Invalid username or password');
  res.json({ token: sign(u), user: publicUser(u) });
}));

app.post('/api/auth/register', wrap((req, res) => {
  throttle(req);
  const username = str(req.body.username, 50), email = str(req.body.email, 120).toLowerCase(), password = String(req.body.password || '');
  if (username.length < 3) throw bad('Username must be at least 3 characters');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('Enter a valid email');
  if (password.length < 8) throw bad('Password must be at least 8 characters');
  if (db.prepare('SELECT 1 FROM users WHERE username = ? OR email = ?').get(username, email)) throw new HttpError(409, 'Username or email already in use');
  const id = db.prepare('INSERT INTO users (username,email,password,full_name,phone,address,role) VALUES (?,?,?,?,?,?,?)')
    .run(username, email, bcrypt.hashSync(password, 10), str(req.body.fullName), str(req.body.phone, 40), str(req.body.address, 500), 'ROLE_CUSTOMER').lastInsertRowid;
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  res.status(201).json({ token: sign(u), user: publicUser(u) });
}));

app.get('/api/auth/me', requireUser, (req, res) => res.json(publicUser(req.user)));

// ---- catalog
app.get('/api/categories', (_req, res) => res.json(db.prepare('SELECT * FROM categories ORDER BY name').all()));

function listProducts(req, res, includeInactive) {
  const page = Math.max(0, parseInt(req.query.page) || 0), size = Math.min(48, Math.max(1, parseInt(req.query.size) || 12));
  const where = [], args = [];
  if (!includeInactive) where.push('p.active = 1');
  if (req.query.q) { where.push('p.name LIKE ?'); args.push(`%${str(req.query.q, 80)}%`); }
  if (req.query.category) { where.push('p.category_id = ?'); args.push(Number(req.query.category)); }
  const w = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) c FROM products p${w}`).get(...args).c;
  const items = db.prepare(`${PRODUCT_SQL}${w} ORDER BY p.name LIMIT ? OFFSET ?`).all(...args, size, page * size).map(productOut);
  res.json({ items, page, size, total, totalPages: Math.ceil(total / size) });
}
app.get('/api/products', wrap((req, res) => listProducts(req, res, false)));
app.get('/api/products/:id', wrap((req, res) => {
  const p = db.prepare(`${PRODUCT_SQL} WHERE p.id = ? AND p.active = 1`).get(Number(req.params.id));
  if (!p) throw new HttpError(404, 'Product not found');
  res.json(productOut(p));
}));

// ---- settings & pricing
const SETTING_DEFAULTS = { storeName: 'ebuy', taxRate: '0', shippingFlat: '0', freeShippingOver: '0' };
const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'SGD', 'MYR', 'IDR', 'PHP', 'INR'];
const CONFIG_DEFAULTS = {
  general: { email: '', phone: '', address: '', currency: 'USD' },
  tax: { label: 'Tax' },
  shipping: null,
  payments: { cod: { enabled: true }, bank: { enabled: false, instructions: '' } },
  integrations: { ga: '', pixel: '', webhooks: [] },
};
const getConfig = () => {
  let c = {}; try { c = JSON.parse(db.prepare("SELECT value FROM settings WHERE key = 'config'").get()?.value || '{}'); } catch {}
  const base = (() => { const o = { ...SETTING_DEFAULTS }; for (const r of db.prepare('SELECT * FROM settings').all()) o[r.key] = r.value; return o; })();
  const legacy = [{ id: 'standard', name: 'Standard shipping', price: Number(base.shippingFlat), freeOver: Number(base.freeShippingOver), days: '' }];
  return {
    general: { ...CONFIG_DEFAULTS.general, ...c.general }, tax: { ...CONFIG_DEFAULTS.tax, ...c.tax },
    shipping: Array.isArray(c.shipping) && c.shipping.length ? c.shipping : legacy,
    payments: { cod: { ...CONFIG_DEFAULTS.payments.cod, ...c.payments?.cod }, bank: { ...CONFIG_DEFAULTS.payments.bank, ...c.payments?.bank } },
    integrations: { ...CONFIG_DEFAULTS.integrations, ...c.integrations },
  };
};
const saveConfig = (section, value) => {
  let c = {}; try { c = JSON.parse(db.prepare("SELECT value FROM settings WHERE key = 'config'").get()?.value || '{}'); } catch {}
  c[section] = value;
  db.prepare("INSERT INTO settings (key,value) VALUES ('config',?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(c));
};
const getSettings = () => {
  const o = { ...SETTING_DEFAULTS };
  for (const r of db.prepare('SELECT * FROM settings').all()) o[r.key] = r.value;
  const c = getConfig();
  return { storeName: o.storeName, taxRate: Number(o.taxRate), taxLabel: c.tax.label, currency: c.general.currency, shippingMethods: c.shipping, payments: c.payments,
    shippingFlat: c.shipping[0].price, freeShippingOver: c.shipping[0].freeOver };
};
const r2 = (n) => Math.round(n * 100) / 100;
const publicSettings = () => {
  const s = getSettings(), c = getConfig();
  return { storeName: s.storeName, taxRate: s.taxRate, taxLabel: s.taxLabel, currency: s.currency, contact: { email: c.general.email, phone: c.general.phone, address: c.general.address },
    shippingMethods: s.shippingMethods, payments: { cod: s.payments.cod.enabled, bank: s.payments.bank.enabled ? { instructions: s.payments.bank.instructions } : null },
    tracking: { ga: c.integrations.ga, pixel: c.integrations.pixel } };
};
app.get('/api/settings', (_req, res) => res.json(publicSettings()));

const THEME_DEFAULTS = { brand: '#244638', accent: '#c8553d', bg: '#f6f7f3', ink: '#1d2a24', font: 'system', radius: 12, announcement: '',
  heroEyebrow: 'A little better, every day', heroTitle: 'Good things for everyday living.', heroText: 'Well-chosen essentials for your home, your work, and everywhere in between.',
  heroButton: 'Explore the collection →', heroImage: '', footerText: 'Thoughtfully picked. Made for everyday.' };
const FONTS = ['system', 'serif', 'rounded', 'mono'];
const getTheme = () => {
  const r = db.prepare("SELECT value FROM settings WHERE key = 'theme'").get();
  let t = {}; try { t = JSON.parse(r?.value || '{}'); } catch {}
  return { ...THEME_DEFAULTS, ...t };
};
app.get('/api/theme', (_req, res) => res.json({ ...getTheme(), storeName: getSettings().storeName }));


function findDiscount(code, subtotal) {
  const c = str(code, 40).toUpperCase();
  if (!c) return null;
  const d = db.prepare('SELECT * FROM discounts WHERE code = ?').get(c);
  if (!d || !d.active) throw bad('Discount code is not valid');
  if (d.expires_at && new Date(d.expires_at) < new Date()) throw bad('Discount code has expired');
  if (d.max_uses > 0 && d.uses >= d.max_uses) throw bad('Discount code has been fully used');
  if (subtotal < d.min_subtotal) throw bad(`Spend at least ${d.min_subtotal.toFixed(2)} to use this code`);
  return d;
}
function quote(lines, code, forOrder = false, shippingMethod = '') {
  const merged = new Map();
  for (const l of Array.isArray(lines) ? lines : []) {
    const q = Number(l.quantity);
    if (!Number.isInteger(q) || q < 1 || q > 99) throw bad('Invalid quantity');
    merged.set(Number(l.productId), (merged.get(Number(l.productId)) || 0) + q);
  }
  if (!merged.size) throw bad('Your cart is empty');
  const items = [...merged].map(([id, quantity]) => {
    const p = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(id);
    if (!p) throw bad('A product in your cart is no longer available');
    if (p.stock_quantity < quantity) throw new HttpError(409, `Only ${p.stock_quantity} of "${p.name}" left in stock`);
    return { p, quantity };
  });
  const subtotal = r2(items.reduce((s, { p, quantity }) => s + p.price * quantity, 0));
  const disc = findDiscount(code, subtotal);
  const discount = disc ? r2(Math.min(subtotal, disc.type === 'PERCENT' ? subtotal * disc.value / 100 : disc.value)) : 0;
  const st = getSettings(), net = subtotal - discount;
  const method = st.shippingMethods.find((m) => m.id === shippingMethod) || st.shippingMethods[0];
  const shipping = method.freeOver > 0 && net >= method.freeOver ? 0 : method.price;
  const tax = r2(net * st.taxRate / 100);
  return { items, disc, subtotal, discount, shipping, tax, total: r2(net + shipping + tax), code: disc?.code || null, shippingMethod: method.name };
}
const quoteOut = ({ subtotal, discount, shipping, tax, total, code, shippingMethod }) => ({ subtotal, discount, shipping, tax, total, code, shippingMethod });
app.post('/api/checkout/quote', wrap((req, res) => res.json(quoteOut(quote(req.body.items, req.body.discountCode, false, req.body.shippingMethod)))));

// ---- orders
const orderOut = (o, withItems = true) => ({
  id: o.id, orderNumber: o.order_number, status: o.status, totalAmount: o.total_amount, createdAt: o.created_at,
  subtotal: o.subtotal || o.total_amount, discountAmount: o.discount_amount, shippingAmount: o.shipping_amount, taxAmount: o.tax_amount, discountCode: o.discount_code, shippingMethod: o.shipping_method, paymentMethod: o.payment_method,
  recipientName: o.recipient_name, phone: o.phone, shippingAddress: o.shipping_address,
  ...(o.username ? { customer: o.username } : {}),
  ...(withItems ? { items: db.prepare('SELECT oi.quantity, oi.unit_price AS unitPrice, p.id AS productId, p.name, p.image_url AS imageUrl FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = ?').all(o.id) } : {}),
});

app.post('/api/orders', requireUser, wrap((req, res) => {
  const recipientName = str(req.body.recipientName, 120), phone = str(req.body.phone, 40), shippingAddress = str(req.body.shippingAddress, 500);
  if (!recipientName || !phone || !shippingAddress) throw bad('Name, phone and shipping address are required');
  const order = tx(() => {
    const q = quote(req.body.items, req.body.discountCode, true, req.body.shippingMethod);
    const pay = getSettings().payments, wanted = str(req.body.paymentMethod, 10) || (pay.cod.enabled ? 'cod' : 'bank');
    if (!(wanted === 'cod' && pay.cod.enabled) && !(wanted === 'bank' && pay.bank.enabled)) throw bad('That payment method is not available');
    const number = `EB-${Date.now().toString(36).toUpperCase()}-${randomBytes(2).toString('hex').toUpperCase()}`;
    const id = db.prepare('INSERT INTO store_orders (order_number,user_id,recipient_name,phone,shipping_address,status,total_amount,created_at,subtotal,discount_amount,shipping_amount,tax_amount,discount_code,shipping_method,payment_method) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(number, req.user.id, recipientName, phone, shippingAddress, 'PENDING', q.total, new Date().toISOString(), q.subtotal, q.discount, q.shipping, q.tax, q.code, q.shippingMethod, wanted).lastInsertRowid;
    for (const { p, quantity } of q.items) {
      db.prepare('INSERT INTO order_items (order_id,product_id,quantity,unit_price) VALUES (?,?,?,?)').run(id, p.id, quantity, p.price);
      db.prepare('UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ?').run(quantity, p.id);
    }
    if (q.disc) db.prepare('UPDATE discounts SET uses = uses + 1 WHERE id = ?').run(q.disc.id);
    return db.prepare('SELECT * FROM store_orders WHERE id = ?').get(id);
  });
  fireWebhooks('order.created', orderOut(order));
  res.status(201).json(orderOut(order));
}));

app.get('/api/orders', requireUser, (req, res) =>
  res.json(db.prepare('SELECT * FROM store_orders WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id).map((o) => orderOut(o, false))));
app.get('/api/orders/:id', requireUser, wrap((req, res) => {
  const o = db.prepare('SELECT * FROM store_orders WHERE id = ? AND user_id = ?').get(Number(req.params.id), req.user.id);
  if (!o) throw new HttpError(404, 'Order not found');
  res.json(orderOut(o));
}));

// ---- admin
const admin = express.Router();
admin.use(requireAdmin);

admin.get('/stats', (_req, res) => {
  const one = (sql) => db.prepare(sql).get();
  res.json({
    products: one('SELECT COUNT(*) c FROM products').c,
    lowStock: one('SELECT COUNT(*) c FROM products WHERE active = 1 AND stock_quantity <= 5').c,
    orders: one('SELECT COUNT(*) c FROM store_orders').c,
    pendingOrders: one("SELECT COUNT(*) c FROM store_orders WHERE status = 'PENDING'").c,
    revenue: one("SELECT COALESCE(SUM(total_amount),0) s FROM store_orders WHERE status != 'CANCELLED'").s,
    customers: one("SELECT COUNT(*) c FROM users WHERE role = 'ROLE_CUSTOMER'").c,
  });
});

function readProduct(body, forId) {
  const name = str(body.name, 150), price = Number(body.price), stock = Number(body.stockQuantity), categoryId = Number(body.categoryId);
  if (!name) throw bad('Name is required');
  if (!Number.isFinite(price) || price < 0) throw bad('Price must be 0 or more');
  if (!Number.isInteger(stock) || stock < 0) throw bad('Stock must be a whole number, 0 or more');
  if (!db.prepare('SELECT 1 FROM categories WHERE id = ?').get(categoryId)) throw bad('Choose a category');
  const image = str(body.imageUrl, 500);
  if (image && !/^(https?:\/\/|\/images\/)/.test(image)) throw bad('Image must be an http(s) URL or /images/ path');
  const cmp = body.compareAtPrice === '' || body.compareAtPrice == null ? null : Number(body.compareAtPrice);
  if (cmp !== null && (!Number.isFinite(cmp) || cmp < price)) throw bad('Compare-at price must be higher than the price');
  const sku = str(body.sku, 60) || null;
  if (sku && db.prepare('SELECT 1 FROM products WHERE sku = ? AND id != ?').get(sku, Number(forId) || 0)) throw new HttpError(409, 'SKU already in use');
  return [name, str(body.description, 2000), Math.round(price * 100) / 100, stock, image || null, body.active === false ? 0 : 1, categoryId, sku, cmp];
}

admin.get('/products', wrap((req, res) => listProducts(req, res, true)));
admin.get('/products/:id', wrap((req, res) => {
  const p = db.prepare(`${PRODUCT_SQL} WHERE p.id = ?`).get(Number(req.params.id));
  if (!p) throw new HttpError(404, 'Product not found');
  res.json(productOut(p));
}));
admin.post('/products', wrap((req, res) => {
  const id = db.prepare('INSERT INTO products (name,description,price,stock_quantity,image_url,active,category_id,sku,compare_at_price) VALUES (?,?,?,?,?,?,?,?,?)').run(...readProduct(req.body)).lastInsertRowid;
  res.status(201).json(productOut(db.prepare(`${PRODUCT_SQL} WHERE p.id = ?`).get(id)));
}));
admin.put('/products/:id', wrap((req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM products WHERE id = ?').get(id)) throw new HttpError(404, 'Product not found');
  db.prepare('UPDATE products SET name=?,description=?,price=?,stock_quantity=?,image_url=?,active=?,category_id=?,sku=?,compare_at_price=? WHERE id=?').run(...readProduct(req.body, id), id);
  res.json(productOut(db.prepare(`${PRODUCT_SQL} WHERE p.id = ?`).get(id)));
}));
admin.delete('/products/:id', wrap((req, res) => {
  const id = Number(req.params.id);
  if (db.prepare('SELECT 1 FROM order_items WHERE product_id = ?').get(id)) {
    db.prepare('UPDATE products SET active = 0 WHERE id = ?').run(id);
    return res.json({ deleted: false, archived: true });
  }
  db.prepare('DELETE FROM products WHERE id = ?').run(id);
  res.json({ deleted: true });
}));

const catOut = (c) => ({ id: c.id, name: c.name, description: c.description, products: c.products ?? 0 });
const CAT_SQL = 'SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS products FROM categories c';
admin.get('/categories', (_req, res) => res.json(db.prepare(`${CAT_SQL} ORDER BY c.name`).all().map(catOut)));
admin.post('/categories', wrap((req, res) => {
  const name = str(req.body.name, 80);
  if (!name) throw bad('Name is required');
  if (db.prepare('SELECT 1 FROM categories WHERE name = ?').get(name)) throw new HttpError(409, 'Category already exists');
  const id = db.prepare('INSERT INTO categories (name,description) VALUES (?,?)').run(name, str(req.body.description, 300)).lastInsertRowid;
  res.status(201).json(catOut(db.prepare(`${CAT_SQL} WHERE c.id = ?`).get(id)));
}));
admin.put('/categories/:id', wrap((req, res) => {
  const id = Number(req.params.id), name = str(req.body.name, 80);
  if (!db.prepare('SELECT 1 FROM categories WHERE id = ?').get(id)) throw new HttpError(404, 'Category not found');
  if (!name) throw bad('Name is required');
  if (db.prepare('SELECT 1 FROM categories WHERE name = ? AND id != ?').get(name, id)) throw new HttpError(409, 'Category already exists');
  db.prepare('UPDATE categories SET name = ?, description = ? WHERE id = ?').run(name, str(req.body.description, 300), id);
  res.json(catOut(db.prepare(`${CAT_SQL} WHERE c.id = ?`).get(id)));
}));
admin.delete('/categories/:id', wrap((req, res) => {
  const id = Number(req.params.id);
  if (db.prepare('SELECT 1 FROM products WHERE category_id = ?').get(id)) throw new HttpError(409, 'Move or delete this category\'s products first');
  db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  res.json({ deleted: true });
}));

admin.get('/customers', (_req, res) => res.json(db.prepare(`
  SELECT u.id, u.username, u.email, u.full_name AS fullName, u.phone, COUNT(o.id) AS orders,
         COALESCE(SUM(CASE WHEN o.status != 'CANCELLED' THEN o.total_amount END), 0) AS spent, MAX(o.created_at) AS lastOrder
  FROM users u LEFT JOIN store_orders o ON o.user_id = u.id WHERE u.role = 'ROLE_CUSTOMER' GROUP BY u.id ORDER BY spent DESC, u.username`).all()));

admin.get('/orders', (_req, res) =>
  res.json(db.prepare('SELECT o.*, u.username FROM store_orders o JOIN users u ON u.id = o.user_id ORDER BY o.created_at DESC').all().map((o) => orderOut(o))));
admin.patch('/orders/:id/status', wrap((req, res) => {
  const id = Number(req.params.id), status = req.body.status;
  if (!STATUSES.includes(status)) throw bad(`Status must be one of ${STATUSES.join(', ')}`);
  tx(() => {
    const o = db.prepare('SELECT * FROM store_orders WHERE id = ?').get(id);
    if (!o) throw new HttpError(404, 'Order not found');
    if (o.status === 'CANCELLED' && status !== 'CANCELLED') throw new HttpError(409, 'Cancelled orders cannot be reopened');
    if (status === 'CANCELLED' && o.status !== 'CANCELLED')
      for (const it of db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(id))
        db.prepare('UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?').run(it.quantity, it.product_id);
    if (status === 'CANCELLED' && o.status !== 'CANCELLED' && o.discount_code) db.prepare('UPDATE discounts SET uses = MAX(uses - 1, 0) WHERE code = ?').run(o.discount_code);
    db.prepare('UPDATE store_orders SET status = ? WHERE id = ?').run(status, id);
  });
  const updated = orderOut(db.prepare('SELECT o.*, u.username FROM store_orders o JOIN users u ON u.id = o.user_id WHERE o.id = ?').get(id));
  fireWebhooks('order.updated', updated);
  res.json(updated);
}));
admin.patch('/products/:id/stock', wrap((req, res) => {
  const id = Number(req.params.id), n = Number(req.body.stockQuantity);
  if (!Number.isInteger(n) || n < 0) throw bad('Stock must be a whole number, 0 or more');
  if (!db.prepare('UPDATE products SET stock_quantity = ? WHERE id = ?').run(n, id).changes) throw new HttpError(404, 'Product not found');
  res.json({ id, stockQuantity: n });
}));

// ---- page builder (home page blocks + custom CSS/JS)
const BLOCKS = {
  hero: { eyebrow: 80, title: 120, text: 300, button: 40, link: 300, image: 500 },
  heading: { text: 200, size: 2, align: 8 },
  text: { text: 3000, align: 8 },
  image: { url: 500, alt: 200, link: 300, fit: 10 },
  button: { label: 60, link: 300, align: 8, style: 8 },
  banner: { text: 300, link: 300, color: 7 },
  products: { eyebrow: 80, title: 120, count: 2, category: 6 },
  spacer: { height: 3 },
  html: { html: 20000 },
};
const LAYOUT_DEFAULT = { blocks: [{ type: 'hero', props: {} }, { type: 'products', props: { eyebrow: 'Selected for you', title: 'Shop the favorites', count: '6', category: '' } }], css: '', js: '' };
const safeLink = (v) => (/^(https?:\/\/|#\/|\/)/.test(v) ? v : '');
const safeImg = (v) => (/^(https?:\/\/|\/images\/)/.test(v) ? v : '');
function cleanBlock(b, i) {
  const spec = BLOCKS[b?.type];
  if (!spec) throw bad(`Block ${i + 1}: unknown type`);
  const props = {};
  for (const [k, max] of Object.entries(spec)) {
    let v = typeof b.props?.[k] === 'string' || typeof b.props?.[k] === 'number' ? String(b.props[k]).slice(0, max) : '';
    if (['link'].includes(k) || (b.type === 'image' && k === 'link')) v = safeLink(v.trim());
    if (k === 'image' || (b.type === 'image' && k === 'url')) v = safeImg(v.trim());
    if (k === 'color' && v && !/^#[0-9a-fA-F]{6}$/.test(v)) v = '';
    if (k === 'align' && !['left', 'center', 'right', ''].includes(v)) v = '';
    if (k === 'size' && !['1', '2', '3', ''].includes(v)) v = '';
    if (k === 'style' && !['solid', 'outline', ''].includes(v)) v = '';
    if (k === 'fit' && !['contained', 'full', ''].includes(v)) v = '';
    if (['count', 'height', 'category'].includes(k)) { const n = Math.floor(Number(v)); v = v !== '' && Number.isFinite(n) && n >= 0 ? String(k === 'count' ? Math.min(24, Math.max(1, n)) : k === 'height' ? Math.min(400, n) : n) : ''; }
    props[k] = v;
  }
  return { id: str(String(b.id || ''), 20) || Math.random().toString(36).slice(2, 10), type: b.type, props };
}
const getLayout = () => {
  const r = db.prepare("SELECT value FROM settings WHERE key = 'layout'").get();
  if (!r) return LAYOUT_DEFAULT;
  try { const l = JSON.parse(r.value); return { blocks: l.blocks || [], css: l.css || '', js: l.js || '' }; } catch { return LAYOUT_DEFAULT; }
};
app.get('/api/layout', (_req, res) => res.json(getLayout()));
// ---- landing pages
const RESERVED = ['products', 'cart', 'checkout', 'orders', 'login', 'register', 'p', 'admin', 'api'];
const pageOut = (r, full) => ({ id: r.id, slug: r.slug, title: r.title, description: r.description, published: !!r.published, membersOnly: !!r.members_only, updatedAt: r.updated_at, ...(full ? { blocks: JSON.parse(r.blocks), css: r.css } : {}) });
function readPage(b) {
  const title = str(b.title, 120), slug = str(b.slug, 60).toLowerCase();
  if (!title) throw bad('Title is required');
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) throw bad('URL slug may only contain lowercase letters, numbers and dashes');
  if (RESERVED.includes(slug)) throw bad('That URL slug is reserved');
  return { title, slug, description: str(b.description, 300) };
}
const uniqueSlug = (slug, id) => { if (db.prepare('SELECT 1 FROM landing_pages WHERE slug = ? AND id IS NOT ?').get(slug, id ?? null)) throw new HttpError(409, 'That URL is already used by another page'); };
app.get('/api/pages/:slug', wrap((req, res) => {
  const r = db.prepare('SELECT * FROM landing_pages WHERE slug = ? AND published = 1').get(String(req.params.slug));
  if (!r) throw new HttpError(404, 'Page not found');
  if (r.members_only && !req.user) throw new HttpError(401, 'Sign in to view this page');
  res.json(pageOut(r, true));
}));
admin.get('/pages', (_req, res) => res.json(db.prepare('SELECT * FROM landing_pages ORDER BY updated_at DESC, id DESC').all().map((r) => pageOut(r))));
admin.get('/pages/:id', wrap((req, res) => {
  const r = db.prepare('SELECT * FROM landing_pages WHERE id = ?').get(Number(req.params.id));
  if (!r) throw new HttpError(404, 'Page not found');
  res.json(pageOut(r, true));
}));
admin.post('/pages', wrap((req, res) => {
  const v = readPage(req.body || {}); uniqueSlug(v.slug);
  const blocks = JSON.stringify([{ type: 'hero', props: { title: v.title, text: '', eyebrow: '', button: '' } }]);
  const id = db.prepare('INSERT INTO landing_pages (slug,title,description,blocks) VALUES (?,?,?,?)').run(v.slug, v.title, v.description, blocks).lastInsertRowid;
  res.status(201).json(pageOut(db.prepare('SELECT * FROM landing_pages WHERE id = ?').get(id), true));
}));
admin.put('/pages/:id', wrap((req, res) => {
  const id = Number(req.params.id), b = req.body || {};
  if (!db.prepare('SELECT 1 FROM landing_pages WHERE id = ?').get(id)) throw new HttpError(404, 'Page not found');
  const v = readPage(b); uniqueSlug(v.slug, id);
  if (!Array.isArray(b.blocks) || b.blocks.length > 60) throw bad('blocks must be a list of at most 60 items');
  const css = typeof b.css === 'string' ? b.css.slice(0, 50000) : '';
  db.prepare("UPDATE landing_pages SET slug=?, title=?, description=?, blocks=?, css=?, published=?, members_only=?, updated_at=CURRENT_TIMESTAMP WHERE id=?")
    .run(v.slug, v.title, v.description, JSON.stringify(b.blocks.map(cleanBlock)), css, b.published ? 1 : 0, b.membersOnly ? 1 : 0, id);
  res.json(pageOut(db.prepare('SELECT * FROM landing_pages WHERE id = ?').get(id), true));
}));
admin.delete('/pages/:id', wrap((req, res) => { db.prepare('DELETE FROM landing_pages WHERE id = ?').run(Number(req.params.id)); res.status(204).end(); }));

admin.get('/layout', (_req, res) => res.json(getLayout()));
admin.put('/layout', wrap((req, res) => {
  const b = req.body || {};
  if (!Array.isArray(b.blocks) || b.blocks.length > 60) throw bad('blocks must be a list of at most 60 items');
  const css = typeof b.css === 'string' ? b.css.slice(0, 50000) : '', js = typeof b.js === 'string' ? b.js.slice(0, 50000) : '';
  const value = JSON.stringify({ blocks: b.blocks.map(cleanBlock), css, js });
  db.prepare("INSERT INTO settings (key,value) VALUES ('layout',?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(value);
  res.json(getLayout());
}));
admin.delete('/layout', wrap((_req, res) => { db.prepare("DELETE FROM settings WHERE key = 'layout'").run(); res.json(getLayout()); }));

// ---- navigation menu
const NAV_DEFAULT = [{ label: 'Shop', link: '#/products', visible: true }];
const getNav = () => {
  const r = db.prepare("SELECT value FROM settings WHERE key = 'nav'").get();
  if (!r) return NAV_DEFAULT;
  try { const n = JSON.parse(r.value); return Array.isArray(n) ? n : NAV_DEFAULT; } catch { return NAV_DEFAULT; }
};
app.get('/api/nav', (req, res) => {
  const live = new Set(db.prepare('SELECT slug FROM landing_pages WHERE published = 1 AND (members_only = 0 OR ?)').all(req.user ? 1 : 0).map((r) => r.slug));
  res.json(getNav().filter((i) => i.visible && !(/^#\/p\//.test(i.link) && !live.has(i.link.slice(4)))));
});
admin.get('/nav', (_req, res) => res.json(getNav()));
admin.put('/nav', wrap((req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 12) : null;
  if (!items) throw new HttpError(400, 'items required');
  const clean = items.map((i) => ({ label: str(String(i?.label || ''), 30).trim(), link: safeLink(String(i?.link || '').trim()), visible: !!i?.visible }));
  if (clean.some((i) => !i.label || !i.link)) throw new HttpError(400, 'Each menu item needs a label and a valid link (#/…, /… or https://…)');
  db.prepare("INSERT INTO settings (key,value) VALUES ('nav',?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(clean));
  res.json(clean);
}));
admin.delete('/nav', wrap((_req, res) => { db.prepare("DELETE FROM settings WHERE key = 'nav'").run(); res.json(NAV_DEFAULT); }));

admin.get('/theme', (_req, res) => res.json(getTheme()));
admin.put('/theme', wrap((req, res) => {
  const b = req.body || {}, t = {};
  for (const k of ['brand', 'accent', 'bg', 'ink']) {
    if (!/^#[0-9a-fA-F]{6}$/.test(String(b[k] ?? ''))) throw bad(`${k} must be a hex colour like #244638`);
    t[k] = b[k].toLowerCase();
  }
  if (!FONTS.includes(b.font)) throw bad('Unknown font');
  t.font = b.font;
  const rad = Number(b.radius);
  if (!Number.isFinite(rad) || rad < 0 || rad > 28) throw bad('radius must be between 0 and 28');
  t.radius = Math.round(rad);
  for (const [k, max] of [['announcement', 140], ['heroEyebrow', 80], ['heroTitle', 120], ['heroText', 300], ['heroButton', 40], ['footerText', 140]]) t[k] = str(b[k], max) || '';
  if (!t.heroTitle) throw bad('Hero title is required');
  const hi = String(b.heroImage || '').trim();
  if (hi && !/^(https?:\/\/|\/images\/)/.test(hi)) throw bad('Hero image must be an https URL or /images path');
  t.heroImage = hi.slice(0, 500);
  db.prepare("INSERT INTO settings (key,value) VALUES ('theme',?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(t));
  res.json(getTheme());
}));
admin.delete('/theme', wrap((_req, res) => { db.prepare("DELETE FROM settings WHERE key = 'theme'").run(); res.json(getTheme()); }));

// ---- webhooks & config
const webhookLog = [];
const WEBHOOK_EVENTS = ['order.created', 'order.updated'];
async function deliver(hook, event, data) {
  const body = JSON.stringify({ event, createdAt: new Date().toISOString(), data });
  const entry = { at: new Date().toISOString(), url: hook.url, event, status: 'pending' };
  webhookLog.unshift(entry); webhookLog.length = Math.min(webhookLog.length, 30);
  try {
    const r = await fetch(hook.url, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(5000),
      headers: { 'content-type': 'application/json', 'x-ebuy-event': event, ...(hook.secret ? { 'x-ebuy-signature': createHmac('sha256', hook.secret).update(body).digest('hex') } : {}) }, body });
    entry.status = r.status;
  } catch (e) { entry.status = `error: ${e.name === 'TimeoutError' ? 'timeout' : 'unreachable'}`; }
}
function fireWebhooks(event, data) {
  for (const h of getConfig().integrations.webhooks) if (h.url && h.events.includes(event)) deliver(h, event, data);
}
const num = (v, max, name) => { const n = Number(v); if (!Number.isFinite(n) || n < 0 || n > max) throw bad(`${name} must be between 0 and ${max}`); return r2(n); };
const maskHooks = (c) => ({ ...c, integrations: { ...c.integrations, webhooks: c.integrations.webhooks.map((h) => ({ ...h, secret: undefined, hasSecret: !!h.secret })) } });
admin.get('/config', (_req, res) => res.json({ ...maskHooks(getConfig()), currencies: CURRENCIES, webhookEvents: WEBHOOK_EVENTS }));
admin.get('/webhook-log', (_req, res) => res.json(webhookLog));
admin.put('/config/:section', wrap((req, res) => {
  const b = req.body || {}, sec = req.params.section;
  if (sec === 'general') {
    const currency = str(b.currency, 3).toUpperCase(), email = str(b.email, 120);
    if (!CURRENCIES.includes(currency)) throw bad('Unsupported currency');
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('Enter a valid email address');
    const name = str(b.storeName, 60); if (!name) throw bad('Store name is required');
    db.prepare("INSERT INTO settings (key,value) VALUES ('storeName',?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(name);
    saveConfig('general', { email, phone: str(b.phone, 40), address: str(b.address, 300), currency });
  } else if (sec === 'tax') {
    db.prepare("INSERT INTO settings (key,value) VALUES ('taxRate',?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(num(b.taxRate, 100, 'Tax rate')));
    saveConfig('tax', { label: str(b.label, 20) || 'Tax' });
  } else if (sec === 'shipping') {
    const list = Array.isArray(b.methods) ? b.methods.slice(0, 10) : [];
    if (!list.length) throw bad('Add at least one shipping method');
    saveConfig('shipping', list.map((m, i) => {
      const name = str(m?.name, 60); if (!name) throw bad('Every shipping method needs a name');
      return { id: str(String(m.id || ''), 20) || randomBytes(4).toString('hex'), name, price: num(m.price, 10000, 'Price'), freeOver: num(m.freeOver || 0, 1000000, 'Free shipping threshold'), days: str(m.days, 30) };
    }));
  } else if (sec === 'payments') {
    if (!b.cod && !b.bankEnabled) throw bad('Enable at least one payment method');
    saveConfig('payments', { cod: { enabled: !!b.cod }, bank: { enabled: !!b.bankEnabled, instructions: str(b.bankInstructions, 600) } });
  } else if (sec === 'integrations') {
    const ga = str(b.ga, 20), pixel = str(b.pixel, 20);
    if (ga && !/^(G|UA|AW)-[A-Z0-9-]{4,16}$/i.test(ga)) throw bad('Google Analytics ID should look like G-XXXXXXXXXX');
    if (pixel && !/^\d{5,20}$/.test(pixel)) throw bad('Meta Pixel ID should be numeric');
    const old = getConfig().integrations.webhooks;
    const hooks = (Array.isArray(b.webhooks) ? b.webhooks : []).slice(0, 10).map((h) => {
      const url = str(h?.url, 500); let u; try { u = new URL(url); } catch { throw bad('Webhook URL is not valid'); }
      if (!['http:', 'https:'].includes(u.protocol)) throw bad('Webhook URL must start with http:// or https://');
      const prev = old.find((o) => o.url === url);
      return { url, secret: typeof h.secret === 'string' && h.secret ? str(h.secret, 100) : (prev?.secret || ''), events: (Array.isArray(h.events) ? h.events : []).filter((e) => WEBHOOK_EVENTS.includes(e)) };
    });
    saveConfig('integrations', { ga, pixel, webhooks: hooks });
  } else throw new HttpError(404, 'Unknown settings section');
  res.json({ ...maskHooks(getConfig()), currencies: CURRENCIES, webhookEvents: WEBHOOK_EVENTS });
}));
admin.post('/webhooks/test', wrap(async (req, res) => {
  const h = getConfig().integrations.webhooks.find((x) => x.url === req.body?.url);
  if (!h) throw new HttpError(404, 'Save the webhook first');
  await deliver(h, 'ping', { message: 'Test from ebuy' });
  res.json(webhookLog[0]);
}));

admin.get('/settings', (_req, res) => res.json(getSettings()));

const discOut = (d) => ({ id: d.id, code: d.code, type: d.type, value: d.value, minSubtotal: d.min_subtotal, maxUses: d.max_uses, uses: d.uses, expiresAt: d.expires_at, active: !!d.active });
function readDiscount(b) {
  const code = str(b.code, 40).toUpperCase().replace(/[^A-Z0-9_-]/g, ''), value = Number(b.value);
  if (code.length < 3) throw bad('Code needs at least 3 letters or numbers');
  if (!['PERCENT', 'FIXED'].includes(b.type)) throw bad('Choose percent or fixed amount');
  if (!Number.isFinite(value) || value <= 0 || (b.type === 'PERCENT' && value > 100)) throw bad('Enter a valid discount value');
  const min = Number(b.minSubtotal) || 0, max = Number(b.maxUses) || 0;
  if (min < 0 || !Number.isInteger(max) || max < 0) throw bad('Minimum spend and usage limit must be 0 or more');
  const exp = b.expiresAt ? new Date(b.expiresAt) : null;
  if (exp && isNaN(exp)) throw bad('Invalid expiry date');
  return [code, b.type, value, min, max, exp ? exp.toISOString() : null, b.active === false ? 0 : 1];
}
admin.get('/discounts', (_req, res) => res.json(db.prepare('SELECT * FROM discounts ORDER BY id DESC').all().map(discOut)));
admin.post('/discounts', wrap((req, res) => {
  const v = readDiscount(req.body);
  if (db.prepare('SELECT 1 FROM discounts WHERE code = ?').get(v[0])) throw new HttpError(409, 'Code already exists');
  const id = db.prepare('INSERT INTO discounts (code,type,value,min_subtotal,max_uses,expires_at,active) VALUES (?,?,?,?,?,?,?)').run(...v).lastInsertRowid;
  res.status(201).json(discOut(db.prepare('SELECT * FROM discounts WHERE id = ?').get(id)));
}));
admin.put('/discounts/:id', wrap((req, res) => {
  const id = Number(req.params.id), v = readDiscount(req.body);
  if (!db.prepare('SELECT 1 FROM discounts WHERE id = ?').get(id)) throw new HttpError(404, 'Discount not found');
  if (db.prepare('SELECT 1 FROM discounts WHERE code = ? AND id != ?').get(v[0], id)) throw new HttpError(409, 'Code already exists');
  db.prepare('UPDATE discounts SET code=?,type=?,value=?,min_subtotal=?,max_uses=?,expires_at=?,active=? WHERE id=?').run(...v, id);
  res.json(discOut(db.prepare('SELECT * FROM discounts WHERE id = ?').get(id)));
}));
admin.delete('/discounts/:id', wrap((req, res) => { db.prepare('DELETE FROM discounts WHERE id = ?').run(Number(req.params.id)); res.json({ deleted: true }); }));

admin.get('/analytics', wrap((req, res) => {
  const days = Math.min(90, Math.max(7, parseInt(req.query.days) || 30));
  const since = new Date(Date.now() - (days - 1) * 864e5).toISOString().slice(0, 10);
  const rows = db.prepare("SELECT substr(created_at,1,10) d, COUNT(*) orders, SUM(total_amount) sales FROM store_orders WHERE status != 'CANCELLED' AND substr(created_at,1,10) >= ? GROUP BY d").all(since);
  const map = new Map(rows.map((r) => [r.d, r]));
  const series = Array.from({ length: days }, (_, i) => { const d = new Date(Date.now() - (days - 1 - i) * 864e5).toISOString().slice(0, 10); const r = map.get(d); return { date: d, orders: r?.orders || 0, sales: r2(r?.sales || 0) }; });
  const top = db.prepare(`SELECT p.id, p.name, SUM(oi.quantity) units, SUM(oi.quantity * oi.unit_price) revenue FROM order_items oi
    JOIN store_orders o ON o.id = oi.order_id JOIN products p ON p.id = oi.product_id WHERE o.status != 'CANCELLED' AND substr(o.created_at,1,10) >= ? GROUP BY p.id ORDER BY revenue DESC LIMIT 5`).all(since);
  const sales = r2(series.reduce((s, x) => s + x.sales, 0)), orders = series.reduce((s, x) => s + x.orders, 0);
  res.json({ days, series, top, sales, orders, aov: orders ? r2(sales / orders) : 0 });
}));
app.use('/api/admin', admin);

app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found')));
app.use((err, _req, res, _next) => {
  if (!err.status) console.error(err);
  res.status(err.status || (err.type === 'entity.parse.failed' ? 400 : 500)).json({ error: err.status ? err.message : 'Something went wrong' });
});

app.listen(PORT, () => console.log(`ebuy API on http://localhost:${PORT}`));
