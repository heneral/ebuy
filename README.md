# ebuy

A Shopify/BigCommerce-style e-commerce platform with a separate backend API, customer storefront and admin dashboard. It started as a Spring MVC (Java) application and was rebuilt as a decoupled Node.js stack.

## Languages and technologies

| Language / technology | Where it is used |
|-----------------------|------------------|
| JavaScript (ES modules, Node.js 22+) | REST API in `api/`, static file server `serve.mjs`, storefront and admin single-page apps |
| HTML5 | Storefront and admin shells, legacy Thymeleaf templates in `src/main/templates` |
| CSS3 | Storefront and admin styling, theme variables, per-page custom CSS |
| SQL (SQLite) | Database schema, queries and migrations (`api/src/db.js`), built-in `node:sqlite` |
| Shell (Bash) | `start.sh` launcher |
| SVG | Product images and icons in `api/public/images` |
| JSON | Configuration stored in the database, API payloads, `package.json` |
| Java 17 (Spring Boot, Spring MVC, Thymeleaf, H2, Maven) | Legacy application, kept under `src/` and `target/`; superseded by the Node stack |

Node libraries used by the API: Express 5, cors, bcryptjs (password hashing), jsonwebtoken (JWT auth).
The frontends use no framework or build step: plain JavaScript with hash-based routing.

## Architecture

| Part | Folder | URL |
|------|--------|-----|
| REST API (Express + SQLite) | `api/` | http://localhost:4000 |
| Storefront (customers) | `storefront/` | http://localhost:3000 |
| Admin dashboard (staff) | `admin/` | http://localhost:3001 |

The frontends are static files that talk to the API over HTTP, so they can be hosted separately.

## Running

1. Install Node.js 22 or newer.
2. Run `npm install` once inside `api/`.
3. Run `./start.sh` from the project root to start all three services.

Set `JWT_SECRET` to keep logins valid across restarts. To point a frontend at another API, edit `config.js` in that frontend folder.
To import data from the legacy H2 database, export each table to CSV and run `npm run migrate -- <export-dir>` in `api/`.

Default admin account: `admin` / `Admin12345!` (change it after first login).

## Features

### Storefront
- Product listing with search, category filter and pagination
- Product detail pages with images, SKU, stock status and compare-at (sale) price
- Shopping cart stored in the browser
- Customer registration, sign in and sign out
- Checkout with discount codes, shipping method selection and payment method selection
- Order summary with subtotal, discount, shipping, tax and total
- Order history and order detail pages
- Landing pages at `#/p/<slug>`, including members-only pages that require sign in
- Header navigation driven by the admin
- Theme, announcement bar, footer and contact details driven by the admin
- Google Analytics and Meta Pixel tracking when configured

### Admin dashboard
- Dashboard with sales chart, top products and low-stock alerts
- Orders: list, search, status tabs, order detail, status changes (Pending, Processing, Shipped, Delivered, Cancelled), CSV export. Cancelling restocks items.
- Products: create, edit, delete, SKU, compare-at price, stock, category, image upload
- Categories: create, edit, delete
- Customers: list with order counts
- Inventory: inline stock editing
- Discounts: percent or fixed codes, minimum spend, usage limit, expiry
- Analytics: revenue and order reports
- Settings hub (see below)

### Page editor and theme
Admin, Editor: add elements (hero, heading, text, image, button, banner, product grid, spacer, custom HTML) by drag and drop or click, reorder by dragging, and edit their properties. Add custom CSS and custom JavaScript that load on every storefront page (`window.ebuy.api`, `ebuy:route` event).
Admin, Theme: colours, font, corner radius, announcement bar and footer.
Custom JavaScript and HTML run for every visitor, so only trusted admins should have access.

### Landing pages
Admin, Landing pages creates standalone pages served at `storefront/#/p/<slug>`. Each page uses the drag-and-drop editor, has its own CSS, an SEO description and a Draft or Published status. Drafts return "Page not found". Access can be set to Public or Signed-in customers only; the API returns 401 to anonymous visitors of members-only pages.

### Navigation
Admin, Navigation controls the storefront header menu: show or hide links, reorder, rename, and add Home, Shop, landing pages or custom URLs. Links to unpublished landing pages are hidden automatically, and members-only links are hidden from visitors who are not signed in.

### Settings
- General: store name, contact email, phone, address, currency (USD, EUR, GBP, CAD, AUD, JPY, SGD, MYR, IDR, PHP, INR)
- Shipping: multiple methods, each with price, free-over threshold and delivery time; customers choose at checkout
- Taxes: tax name and rate
- Payments: cash on delivery and bank transfer with instructions. Card gateways (Stripe, PayPal) are not connected.
- Integrations: Google Analytics ID, Meta Pixel ID, and webhooks for `order.created` and `order.updated`, with a test button and a recent-deliveries log
- Coupons: links to Discounts

Webhook requests carry an `x-ebuy-event` header and, when a secret is set, an `x-ebuy-signature` header (HMAC-SHA256 of the body). Redirects are not followed. The delivery log is kept in memory and resets on API restart.

## API overview

Public: `GET /api/health`, `GET /api/products`, `GET /api/products/:id`, `GET /api/categories`, `GET /api/settings`, `GET /api/theme`, `GET /api/layout`, `GET /api/nav`, `GET /api/pages/:slug`.
Auth: `POST /api/auth/login`, `POST /api/auth/register`, `GET /api/auth/me`.
Customer: `POST /api/checkout/quote`, `POST /api/orders`, `GET /api/orders`, `GET /api/orders/:id`.
Admin (requires an admin token, under `/api/admin`): stats, analytics, products, categories, customers, orders, discounts, pages, layout, nav, theme, config, webhook-log, webhooks/test, upload.

## Not included

Email/SMTP, staff accounts and roles, shipping zones, per-country tax, product variants, refunds, abandoned carts, reviews, and card payment gateways.
