import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const file = process.env.DB_FILE || new URL('../data/ebuy.db', import.meta.url).pathname;
mkdirSync(dirname(file), { recursive: true });

export const db = new DatabaseSync(file);
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
db.exec(`
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT,
  price REAL NOT NULL CHECK (price >= 0), stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  image_url TEXT, active INTEGER NOT NULL DEFAULT 1,
  category_id INTEGER NOT NULL REFERENCES categories(id));
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL, full_name TEXT, phone TEXT, address TEXT,
  role TEXT NOT NULL DEFAULT 'ROLE_CUSTOMER');
CREATE TABLE IF NOT EXISTS store_orders (
  id INTEGER PRIMARY KEY, order_number TEXT NOT NULL UNIQUE, user_id INTEGER NOT NULL REFERENCES users(id),
  recipient_name TEXT NOT NULL, phone TEXT NOT NULL, shipping_address TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING', total_amount REAL NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES store_orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id), quantity INTEGER NOT NULL, unit_price REAL NOT NULL);
`);

const addCol = (t, c, def) => { if (!db.prepare(`PRAGMA table_info(${t})`).all().some((x) => x.name === c)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${def}`); };
addCol('products', 'sku', 'TEXT');
addCol('landing_pages', 'members_only', 'INTEGER NOT NULL DEFAULT 0');
addCol('products', 'compare_at_price', 'REAL');
addCol('store_orders', 'shipping_method', 'TEXT');
addCol('store_orders', 'payment_method', 'TEXT');
for (const c of ['subtotal', 'discount_amount', 'shipping_amount', 'tax_amount']) addCol('store_orders', c, 'REAL NOT NULL DEFAULT 0');
addCol('store_orders', 'discount_code', 'TEXT');
db.exec(`
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS discounts (
  id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, type TEXT NOT NULL CHECK (type IN ('PERCENT','FIXED')),
  value REAL NOT NULL CHECK (value > 0), min_subtotal REAL NOT NULL DEFAULT 0, max_uses INTEGER NOT NULL DEFAULT 0,
  uses INTEGER NOT NULL DEFAULT 0, expires_at TEXT, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS landing_pages (
  id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  blocks TEXT NOT NULL DEFAULT '[]', css TEXT NOT NULL DEFAULT '', published INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
`);

export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
