// One-off import of the CSV exports of the legacy H2 database. Usage: node src/migrate-h2.js <export-dir>
import { readFileSync } from 'node:fs';
import { db, tx } from './db.js';

function parseCsv(text) {
  const rows = []; let row = [], field = '', quoted = false, wasQuoted = false;
  const push = () => { row.push(field === '' && !wasQuoted ? null : field); field = ''; wasQuoted = false; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') { quoted = true; wasQuoted = true; }
    else if (c === ',') push();
    else if (c === '\n') { push(); rows.push(row); row = []; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { push(); rows.push(row); }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.toLowerCase(), r[i]])));
}

const dir = process.argv[2];
if (!dir) { console.error('usage: node src/migrate-h2.js <export-dir>'); process.exit(1); }
const load = (t) => parseCsv(readFileSync(`${dir}/${t}.csv`, 'utf8'));
const num = (v) => (v == null ? null : Number(v));

tx(() => {
  for (const r of load('categories'))
    db.prepare('INSERT OR REPLACE INTO categories (id,name,description) VALUES (?,?,?)').run(num(r.id), r.name, r.description);
  for (const r of load('users'))
    db.prepare('INSERT OR REPLACE INTO users (id,username,email,password,full_name,phone,address,role) VALUES (?,?,?,?,?,?,?,?)')
      .run(num(r.id), r.username, r.email, r.password, r.full_name, r.phone, r.address, r.role);
  for (const r of load('products'))
    db.prepare('INSERT OR REPLACE INTO products (id,name,description,price,stock_quantity,image_url,active,category_id) VALUES (?,?,?,?,?,?,?,?)')
      .run(num(r.id), r.name, r.description, num(r.price), num(r.stock_quantity), r.image_url, r.active === 'TRUE' ? 1 : 0, num(r.category_id));
  for (const r of load('store_orders'))
    db.prepare('INSERT OR REPLACE INTO store_orders (id,order_number,user_id,recipient_name,phone,shipping_address,status,total_amount,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(num(r.id), r.order_number, num(r.user_id), r.recipient_name, r.phone, r.shipping_address, r.status, num(r.total_amount), r.created_at);
  for (const r of load('order_items'))
    db.prepare('INSERT OR REPLACE INTO order_items (id,order_id,product_id,quantity,unit_price) VALUES (?,?,?,?,?)')
      .run(num(r.id), num(r.order_id), num(r.product_id), num(r.quantity), num(r.unit_price));
});
console.log('Imported:', Object.fromEntries(['categories', 'products', 'users', 'store_orders', 'order_items']
  .map((t) => [t, db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c])));
