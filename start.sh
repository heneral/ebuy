#!/usr/bin/env bash
# Starts the API (4000), storefront (3000) and admin (3001). Ctrl+C stops all three.
cd "$(dirname "$0")"
export JWT_SECRET="${JWT_SECRET:-$(head -c 24 /dev/urandom | base64)}"
(cd api && npm start) & node serve.mjs storefront 3000 & node serve.mjs admin 3001 &
trap 'kill 0' INT TERM
wait
