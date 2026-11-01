#!/bin/bash
set -e

echo "⚡ Starting ultra-fast low-RAM build (esbuild native)..."

# Reset oom_score_adj so child processes run normally
if [ -f "/proc/$$/oom_score_adj" ]; then
  echo 0 > /proc/$$/oom_score_adj 2>/dev/null || true
fi

# Free cached memory if running as root on VPS
if [ "$EUID" -eq 0 ] && [ -f "/proc/sys/vm/drop_caches" ]; then
  # Stop PM2 and old bot process first during build so PM2 doesn't respawn it mid-build
  pm2 stop all 2>/dev/null || true
  pkill -9 -f "dist/server\.cjs" 2>/dev/null || true
  sync 2>/dev/null || true
  echo 3 > /proc/sys/vm/drop_caches 2>/dev/null || true
fi

ESBUILD_BIN="./node_modules/.bin/esbuild"
if [ ! -x "$ESBUILD_BIN" ]; then
  ESBUILD_BIN="npx esbuild"
fi

mkdir -p dist/assets

# 1. Copy pre-compiled Tailwind CSS
if [ -f "public/app.css" ]; then
  cp -f public/app.css dist/assets/app.css
fi

# 2. Bundle React Frontend (takes ~0.8s, <40MB RAM, no Rollup/Vite needed)
echo "⚡ Bundling frontend UI with native esbuild..."
GOMAXPROCS=1 GOGC=30 $ESBUILD_BIN src/main.tsx \
  --bundle \
  --minify \
  --format=esm \
  --target=es2020 \
  --loader:.css=empty \
  --define:process.env.NODE_ENV='"production"' \
  --outfile=dist/assets/app.js

# 3. Generate production dist/index.html
cat > dist/index.html << 'EOF'
<!doctype html>
<html lang="fa">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Sanaei Telegram Bot Dashboard</title>
    <meta name="description" content="Admin dashboard and server integration with X-UI Sanaei panel, featuring a completely automated Telegram bot for account distribution, subscriptions, and billing." />
    <link rel="stylesheet" href="/assets/app.css" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/assets/app.js"></script>
  </body>
</html>
EOF

# 4. Bundle Express + Telegram Bot Backend (takes ~1.0s, <45MB RAM)
echo "⚡ Bundling backend server with native esbuild..."
GOMAXPROCS=1 GOGC=30 $ESBUILD_BIN ./server.ts \
  --bundle \
  --platform=node \
  --format=cjs \
  --external:pdfkit \
  --external:vite \
  --outfile=dist/server.cjs

echo "✅ Ultra-fast build completed in < 2 seconds!"

# 5. If running on Linux VPS, ensure at least one server.cjs process is running after 12s
if [ "$EUID" -eq 0 ] && { [ -d "/root/sanaei-bot" ] || [ -d "/root/Bot-sana" ]; }; then
  WORK_DIR="$(pwd -P 2>/dev/null || pwd)"
  PORT_VAL=2121
  if [ -f ".env" ]; then
    ENV_PORT=$(grep "^PORT=" .env | cut -d '=' -f2 | tr -d ' ' | tr -d '\r')
    if [ -n "$ENV_PORT" ]; then
      PORT_VAL="$ENV_PORT"
    fi
  fi
  NODE_BIN=$(command -v node || echo "/usr/bin/node")
  (
    sleep 12
    if ! pgrep -f "dist/server\.cjs" >/dev/null 2>&1; then
      PORT=${PORT_VAL} NODE_ENV=production nohup ${NODE_BIN} --max-old-space-size=400 "${WORK_DIR}/dist/server.cjs" > "${WORK_DIR}/bot_output.log" 2>&1 &
    fi
  ) >/dev/null 2>&1 &
fi
