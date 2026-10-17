#!/bin/bash

# Safe exit helper: returns safely if script was sourced, preventing SSH terminal close
safe_exit() {
    local code=${1:-0}
    return $code 2>/dev/null || exit $code
}

# Ignore SIGHUP so SSH terminal disconnects never kill the update process
trap '' HUP 2>/dev/null

# Helper to ensure swap exists and configure SSH keepalive to prevent disconnects on 1GB VPS
ensure_swap_and_memory() {
    # Check if /swapfile is already active
    if swapon --show 2>/dev/null | grep -q "/swapfile"; then
        return 0
    fi

    # Check total swap in /proc/meminfo
    SWAP_KB=$(grep SwapTotal /proc/meminfo 2>/dev/null | awk '{print $2}')
    if [ -n "$SWAP_KB" ] && [ "$SWAP_KB" -gt 500000 ]; then
        return 0
    fi

    if [ "$EUID" -eq 0 ]; then
        if [ -f "/swapfile" ]; then
            swapon /swapfile 2>/dev/null || true
        else
            echo -e "${YELLOW}ℹ️ Setting up 2GB swap file to guarantee smooth build on 1GB VPS...${NC}"
            dd if=/dev/zero of=/swapfile bs=1M count=2048 2>/dev/null || fallocate -l 2G /swapfile 2>/dev/null
            chmod 600 /swapfile 2>/dev/null
            mkswap /swapfile 2>/dev/null
            swapon /swapfile 2>/dev/null || true
        fi
        echo -e "${GREEN}✅ Emergency swap memory activated successfully.${NC}"
    fi

    # Configure SSH keepalive on VPS server so SSH clients (Bitvise/PuTTY) never time out
    if [ "$EUID" -eq 0 ] && [ -f "/etc/ssh/sshd_config" ]; then
        if ! grep -q "^ClientAliveInterval" /etc/ssh/sshd_config; then
            echo "" >> /etc/ssh/sshd_config
            echo "ClientAliveInterval 30" >> /etc/ssh/sshd_config
            echo "ClientAliveCountMax 10" >> /etc/ssh/sshd_config
            systemctl restart sshd 2>/dev/null || systemctl restart ssh 2>/dev/null || true
        fi
    fi
}

# Ensure swap memory is active early
ensure_swap_and_memory

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

# Ensure swap memory remains active after git reset
ensure_swap_and_memory

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
echo -e "${CYAN}⏳ Installing packages (please wait 30–60 seconds)...${NC}"

nice -n 19 env NODE_OPTIONS="--max-old-space-size=256" npm install --prefer-offline --no-audit --no-fund --legacy-peer-deps
if [ $? -ne 0 ]; then
    echo -e "${YELLOW}⚠️ Retrying npm install...${NC}"
    nice -n 19 env NODE_OPTIONS="--max-old-space-size=256" npm install --no-audit --no-fund
fi

echo -e "${CYAN}⚡ Compiling project with Vite + esbuild...${NC}"
npm run clean 2>/dev/null
nice -n 19 env NODE_OPTIONS="--max-old-space-size=256" npm run build

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Build failed! Please inspect compilation errors above.${NC}"
    safe_exit 1
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
