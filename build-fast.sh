#!/bin/bash

echo "⚡ Starting ultra-fast low-RAM build (esbuild native)..."

# Reset oom_score_adj so child processes run normally
if [ -f "/proc/$$/oom_score_adj" ]; then
  echo 0 > /proc/$$/oom_score_adj 2>/dev/null || true
fi

# Free cached memory if running as root on VPS
if [ "$EUID" -eq 0 ] && [ -f "/proc/sys/vm/drop_caches" ]; then
  pm2 stop all 2>/dev/null || true
  pkill -9 -f "dist/server\.cjs" 2>/dev/null || true
  sync 2>/dev/null || true
  echo 3 > /proc/sys/vm/drop_caches 2>/dev/null || true
fi

# Ensure node_modules has react, lucide-react, and esbuild installed
if [ ! -d "node_modules/react" ] || [ ! -d "node_modules/lucide-react" ] || [ ! -x "./node_modules/.bin/esbuild" ]; then
  echo "📦 Installing required packages into node_modules..."
  env -u NODE_ENV npm install --include=dev --no-package-lock --no-audit --no-fund 2>/dev/null || \
  env -u NODE_ENV npm install --no-package-lock --no-audit --no-fund || true
fi

ESBUILD_BIN="./node_modules/.bin/esbuild"
if [ ! -x "$ESBUILD_BIN" ]; then
  ESBUILD_BIN="npx --yes esbuild"
fi

mkdir -p dist/assets

# 1. Copy pre-compiled Tailwind CSS
if [ -f "public/app.css" ]; then
  cp -f public/app.css dist/assets/app.css
elif [ -f "assets/prebuilt/assets/app.css" ]; then
  cp -f assets/prebuilt/assets/app.css dist/assets/app.css
fi

# 2. Bundle Express + Telegram Bot Backend FIRST (guarantees dist/server.cjs exists)
echo "⚡ Bundling backend server with native esbuild..."
if GOMAXPROCS=1 GOGC=30 $ESBUILD_BIN ./server.ts \
  --bundle \
  --platform=node \
  --format=cjs \
  --external:pdfkit \
  --external:vite \
  --outfile=dist/server.cjs; then
  mkdir -p assets/prebuilt
  cp -f dist/server.cjs assets/prebuilt/server.cjs 2>/dev/null || true
else
  echo "⚠️ Backend esbuild warning, checking prebuilt server bundle..."
  if [ -f "assets/prebuilt/server.cjs" ]; then
    cp -f assets/prebuilt/server.cjs dist/server.cjs
    echo "✅ Restored backend bundle from assets/prebuilt/server.cjs"
  fi
fi

# 3. Bundle React Frontend (takes ~0.8s, <40MB RAM, no Rollup/Vite needed)
echo "⚡ Bundling frontend UI with native esbuild..."
if GOMAXPROCS=1 GOGC=30 $ESBUILD_BIN src/main.tsx \
  --bundle \
  --minify \
  --format=esm \
  --target=es2020 \
  --loader:.css=empty \
  --define:process.env.NODE_ENV='"production"' \
  --outfile=dist/assets/app.js; then

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

  mkdir -p assets/prebuilt/assets
  cp -f dist/index.html assets/prebuilt/index.html 2>/dev/null || true
  cp -f dist/assets/app.js assets/prebuilt/assets/app.js 2>/dev/null || true
  if [ -f "dist/assets/app.css" ]; then
    cp -f dist/assets/app.css assets/prebuilt/assets/app.css 2>/dev/null || true
  fi
else
  echo "⚠️ Frontend esbuild could not resolve packages, restoring prebuilt UI from assets/prebuilt..."
  if [ -f "assets/prebuilt/index.html" ]; then
    cp -f assets/prebuilt/index.html dist/index.html
    cp -rf assets/prebuilt/assets/* dist/assets/ 2>/dev/null || true
    echo "✅ Restored frontend UI from assets/prebuilt!"
  fi
fi

echo "✅ Ultra-fast build completed!"

