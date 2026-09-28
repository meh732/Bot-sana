#!/bin/bash

# --- Terminal Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}===============================================${NC}"
echo -e "${YELLOW}   🔄 Bot Restart & Process Cleanup Utility    ${NC}"
echo -e "${BLUE}===============================================${NC}"

# 1. Kill duplicate processes on port 3000
echo -e "${YELLOW}🔹 1. Checking and clearing active processes on port 3000...${NC}"
PID_3000=$(lsof -t -i:3000 2>/dev/null)
if [ ! -z "$PID_3000" ]; then
    echo -e "${RED}⚠️ Active process found on port 3000 (PID: $PID_3000). Terminating...${NC}"
    kill -9 $PID_3000 2>/dev/null
    echo -e "${GREEN}✅ Port 3000 is now free.${NC}"
else
    echo -e "${GREEN}✅ Port 3000 is available.${NC}"
fi

# 2. Kill all background/stale Node/TSX processes matching server/bot
echo -e "${YELLOW}🔹 2. Cleaning stale background Node/TSX processes...${NC}"
pkill -9 -f "server.ts" 2>/dev/null
pkill -9 -f "dist/server.cjs" 2>/dev/null
pkill -9 -f "tsx" 2>/dev/null
echo -e "${GREEN}✅ Stale processes stopped.${NC}"

# 3. Clean and build the project to ensure correct compilation
echo -e "${YELLOW}🔹 3. Compiling and building project to apply code changes...${NC}"
npm run clean 2>/dev/null
npm run build

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Project built and compiled successfully.${NC}"
else
    echo -e "${RED}❌ Build error! Please review the compilation errors above.${NC}"
    exit 1
fi

# 4. Start the application
echo -e "${BLUE}===============================================${NC}"
echo -e "${YELLOW}🔹 4. Restarting Application Service:${NC}"
echo -e "${BLUE}===============================================${NC}"

if command -v pm2 &> /dev/null
then
    echo -e "${YELLOW}ℹ️ PM2 detected. Restarting service with PM2...${NC}"
    pm2 delete "sanaei-bot" 2>/dev/null
    pm2 start dist/server.cjs --name "sanaei-bot" 2>/dev/null || pm2 start npm --name "sanaei-bot" -- run start
    pm2 save
    echo -e "${GREEN}✅ Bot restarted successfully under PM2 as 'sanaei-bot'.${NC}"
else
    echo -e "${YELLOW}⚠️ PM2 not found. Starting process in background...${NC}"
    nohup npm start > bot_output.log 2>&1 &
    echo -e "${GREEN}✅ Bot started in background (logs: bot_output.log).${NC}"
fi

echo -e "${GREEN}===============================================${NC}"
echo -e "${GREEN}🎉 System updated and restarted successfully!${NC}"
echo -e "${GREEN}===============================================${NC}"
