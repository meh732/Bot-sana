#!/bin/bash

# Safe exit helper: returns safely if script was sourced, preventing SSH terminal close
safe_exit() {
    local code=${1:-0}
    return $code 2>/dev/null || exit $code
}

# Ignore SIGHUP
trap '' HUP 2>/dev/null

# Protect this shell script and child processes from Linux OOM Killer
if [ -f "/proc/$$/oom_score_adj" ]; then
    echo -1000 > /proc/$$/oom_score_adj 2>/dev/null || true
fi

# --- Terminal Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}===============================================${NC}"
echo -e "${YELLOW}   🔄 Bot Restart & Process Cleanup Utility    ${NC}"
echo -e "${BLUE}===============================================${NC}"

# 1. Detect port and kill duplicate processes
TARGET_PORT=3000
if [ -f ".env" ]; then
    ENV_PORT=$(grep "^PORT=" .env | cut -d '=' -f2 | tr -d ' ' | tr -d '\r')
    if [ -n "$ENV_PORT" ]; then
        TARGET_PORT="$ENV_PORT"
    fi
fi

echo -e "${YELLOW}🔹 1. Checking and clearing active processes on port ${TARGET_PORT}...${NC}"
fuser -k -9 ${TARGET_PORT}/tcp 2>/dev/null || true
PID_TARGET=$(lsof -t -i:${TARGET_PORT} 2>/dev/null)
if [ ! -z "$PID_TARGET" ]; then
    echo -e "${RED}⚠️ Active process found on port ${TARGET_PORT} (PID: $PID_TARGET). Terminating...${NC}"
    kill -9 $PID_TARGET 2>/dev/null
    echo -e "${GREEN}✅ Port ${TARGET_PORT} is now free.${NC}"
else
    echo -e "${GREEN}✅ Port ${TARGET_PORT} is available.${NC}"
fi

# 2. Kill all background/stale Node/TSX processes matching server/bot
echo -e "${YELLOW}🔹 2. Cleaning stale background Node/TSX processes...${NC}"
pkill -9 -f "server.ts" 2>/dev/null || true
pkill -9 -f "dist/server.cjs" 2>/dev/null || true
pkill -9 -f "tsx" 2>/dev/null || true
echo -e "${GREEN}✅ Stale processes stopped.${NC}"

# 3. Ensure latest bundle is in dist/
echo -e "${YELLOW}🔹 3. Checking and preparing application build...${NC}"
if [ -f "build-fast.sh" ] && ( [ ! -f "dist/server.cjs" ] || [ ! -f "dist/index.html" ] ); then
    bash build-fast.sh
elif [ ! -f "dist/server.cjs" ]; then
    GOMAXPROCS=1 GOGC=30 ./node_modules/.bin/esbuild ./server.ts --bundle --platform=node --format=cjs --external:pdfkit --external:vite --outfile=dist/server.cjs
fi

# Reset oom_score_adj to 0 before spawning service
if [ -f "/proc/$$/oom_score_adj" ]; then
    echo 0 > /proc/$$/oom_score_adj 2>/dev/null || true
fi

# 4. Start the application
echo -e "${BLUE}===============================================${NC}"
echo -e "${YELLOW}🔹 4. Restarting Application Service:${NC}"
echo -e "${BLUE}===============================================${NC}"

# Final sweep of port
fuser -k -9 ${TARGET_PORT}/tcp 2>/dev/null || true
pkill -9 -f "dist/server\.cjs" 2>/dev/null || true
sleep 1

if command -v pm2 &> /dev/null
then
    echo -e "${YELLOW}ℹ️ PM2 detected. Restarting service with PM2...${NC}"
    pm2 delete "sanaei-bot" 2>/dev/null || true
    PORT=$TARGET_PORT NODE_ENV=production pm2 start dist/server.cjs --name "sanaei-bot" -f --node-args="--max-old-space-size=450" --max-restarts 10 --restart-delay 2000
    pm2 save 2>/dev/null || true
    sleep 3
    pm2 status sanaei-bot 2>/dev/null || true
    echo -e "${GREEN}✅ Bot restarted successfully under PM2 as 'sanaei-bot' on port ${TARGET_PORT}.${NC}"
else
    echo -e "${YELLOW}⚠️ PM2 not found. Starting process in background...${NC}"
    PORT=$TARGET_PORT NODE_ENV=production nohup node --max-old-space-size=450 dist/server.cjs > bot_output.log 2>&1 &
    echo -e "${GREEN}✅ Bot started in background (logs: bot_output.log).${NC}"
fi

echo -e "${GREEN}===============================================${NC}"
echo -e "${GREEN}🎉 System updated and restarted successfully!${NC}"
echo -e "${GREEN}===============================================${NC}"
