#!/bin/bash

# Terminal Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

clear
echo -e "${CYAN}====================================================${NC}"
echo -e "${GREEN}      Sanaei Telegram Bot Safe Update Utility       ${NC}"
echo -e "${CYAN}====================================================${NC}"

# Navigate to project directory
if [ -f "server.ts" ]; then
    TARGET_DIR="."
elif [ -d "/root/sanaei-bot" ]; then
    TARGET_DIR="/root/sanaei-bot"
elif [ -d "$HOME/sanaei-bot" ]; then
    TARGET_DIR="$HOME/sanaei-bot"
else
    TARGET_DIR="."
fi

cd "$TARGET_DIR" || exit 1
echo -e "${BLUE}📁 Working Directory: $(pwd)${NC}"

# 1. Critical Database & Config Backup
echo -e "\n${YELLOW}🔹 1. Protecting and backing up current database & configurations...${NC}"
if [ -f "db.json" ]; then
    cp db.json /tmp/sanaei_db_backup.json 2>/dev/null
    cp db.json ./db.json.bak 2>/dev/null
    echo -e "${GREEN}✅ Database db.json backed up safely to /tmp/sanaei_db_backup.json${NC}"
fi

if [ -f ".env" ]; then
    cp .env /tmp/sanaei_env_backup.env 2>/dev/null
    cp .env ./.env.bak 2>/dev/null
    echo -e "${GREEN}✅ Environment file .env backed up safely.${NC}"
fi

# 2. Fetch and apply updates from Git
echo -e "\n${YELLOW}🔹 2. Pulling latest code changes from repository...${NC}"
git fetch --all
git reset --hard origin/main || git reset --hard origin/master

# 3. Restore Database & Configs immediately
echo -e "\n${YELLOW}🔹 3. Restoring database records and credentials...${NC}"
if [ -f "/tmp/sanaei_db_backup.json" ]; then
    # Verify backup is not dummy
    if grep -q "123456789:ABC" /tmp/sanaei_db_backup.json; then
        echo -e "${YELLOW}ℹ️ Backup contained default template. Checking backups folder...${NC}"
    else
        cp /tmp/sanaei_db_backup.json ./db.json
        echo -e "${GREEN}✅ Database db.json restored successfully with your real bot token & data.${NC}"
    fi
elif [ -f "./db.json.bak" ]; then
    cp ./db.json.bak ./db.json
    echo -e "${GREEN}✅ Database restored from db.json.bak.${NC}"
fi

if [ -f "/tmp/sanaei_env_backup.env" ]; then
    cp /tmp/sanaei_env_backup.env ./.env
    echo -e "${GREEN}✅ Configuration .env restored successfully.${NC}"
fi

# 4. Install dependencies and build project
echo -e "\n${YELLOW}🔹 4. Installing dependencies & building project (Vite + esbuild)...${NC}"
npm install
npm run clean 2>/dev/null
npm run build

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Build failed! Please inspect compilation errors above.${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Build completed successfully (dist/server.cjs generated).${NC}"

# 5. Restart application service cleanly
echo -e "\n${YELLOW}🔹 5. Restarting service with PM2...${NC}"

if command -v pm2 &> /dev/null; then
    # Restart or start fresh
    pm2 delete "sanaei-bot" 2>/dev/null
    
    # Load port from .env if present
    PORT_VAL=2020
    if [ -f ".env" ]; then
        ENV_PORT=$(grep "^PORT=" .env | cut -d '=' -f2 | tr -d ' ' | tr -d '\r')
        if [ -n "$ENV_PORT" ]; then
            PORT_VAL="$ENV_PORT"
        fi
    fi
    
    echo -e "${CYAN}>> Starting on port ${PORT_VAL}...${NC}"
    PORT=$PORT_VAL NODE_ENV=production pm2 start dist/server.cjs --name "sanaei-bot"
    pm2 save
    
    echo -e "${GREEN}✅ Service 'sanaei-bot' restarted under PM2.${NC}"
    echo -e "\n${CYAN}====================================================${NC}"
    echo -e "${GREEN}🎉 Update & Restart successfully completed!${NC}"
    echo -e "${YELLOW}📋 Last 20 lines of service log:${NC}"
    echo -e "${CYAN}----------------------------------------------------${NC}"
    pm2 logs sanaei-bot --lines 20 --nostream
    echo -e "${CYAN}====================================================${NC}"
else
    echo -e "${YELLOW}⚠️ PM2 not found. Starting in background via nohup...${NC}"
    pkill -9 -f "dist/server.cjs" 2>/dev/null
    nohup npm start > bot_output.log 2>&1 &
    echo -e "${GREEN}✅ Bot started in background (logs in bot_output.log).${NC}"
fi
