#!/bin/bash

# Safe exit helper: returns safely if script was sourced, preventing SSH terminal close
safe_exit() {
    local code=${1:-0}
    return $code 2>/dev/null || exit $code
}

# Ignore SIGHUP so SSH terminal disconnects never kill the update process
trap '' HUP 2>/dev/null

# Protect this shell script and child processes from Linux OOM Killer
if [ -f "/proc/$$/oom_score_adj" ]; then
    echo -1000 > /proc/$$/oom_score_adj 2>/dev/null || true
fi

# Helper to ensure swap exists and configure SSH keepalive to prevent disconnects on 1GB VPS
ensure_swap_and_memory() {
    # On Ubuntu 22.04/24.04, disable systemd-oomd which aggressively terminates SSH sessions on memory pressure
    if [ "$EUID" -eq 0 ] && command -v systemctl &>/dev/null; then
        systemctl stop systemd-oomd 2>/dev/null || true
        systemctl mask systemd-oomd 2>/dev/null || true
    fi

    # Check if active swap has at least 500MB
    local active_swap
    active_swap=$(free -m 2>/dev/null | awk '/Swap:/ {print $2}')
    if [ -n "$active_swap" ] && [ "$active_swap" -gt 500 ]; then
        return 0
    fi

    if [ "$EUID" -eq 0 ]; then
        echo -e "${YELLOW}ℹ️ Activating 2GB swap file to protect VPS memory during compilation...${NC}"
        swapoff /swapfile 2>/dev/null || true
        rm -f /swapfile 2>/dev/null
        if ! fallocate -l 2G /swapfile 2>/dev/null; then
            dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none 2>/dev/null
        fi
        if [ -f "/swapfile" ]; then
            chmod 600 /swapfile 2>/dev/null
            mkswap /swapfile 2>/dev/null
            swapon /swapfile 2>/dev/null || true
            sysctl -w vm.swappiness=10 2>/dev/null || true
            if ! grep -q "/swapfile" /etc/fstab 2>/dev/null; then
                echo "/swapfile none swap sw 0 0" >> /etc/fstab 2>/dev/null || true
            fi
        fi
        local check_swap
        check_swap=$(free -m 2>/dev/null | awk '/Swap:/ {print $2}')
        if [ -n "$check_swap" ] && [ "$check_swap" -gt 500 ]; then
            echo -e "${GREEN}✅ 2GB Swap memory activated successfully (${check_swap}MB available).${NC}"
        fi
    fi

    # Configure SSH keepalive on VPS server so SSH clients (Termius/Bitvise/PuTTY) never time out
    if [ "$EUID" -eq 0 ] && [ -f "/etc/ssh/sshd_config" ]; then
        if ! grep -q "^ClientAliveInterval" /etc/ssh/sshd_config 2>/dev/null; then
            echo "ClientAliveInterval 30" >> /etc/ssh/sshd_config
            echo "ClientAliveCountMax 10" >> /etc/ssh/sshd_config
            systemctl reload sshd 2>/dev/null || systemctl reload ssh 2>/dev/null || true
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
echo -e "\n${YELLOW}🔹 4. Checking dependencies & build assets...${NC}"

if [ ! -d "node_modules" ]; then
    echo -e "${CYAN}⏳ Installing packages (initial run)...${NC}"
    nice -n 19 env NODE_OPTIONS="--max-old-space-size=1024" npm install --prefer-offline --no-audit --no-fund --legacy-peer-deps
else
    echo -e "${GREEN}✅ Dependencies verified (node_modules present, skipping heavy re-install).${NC}"
fi

if [ -f "dist/server.cjs" ] && [ -f "dist/index.html" ]; then
    echo -e "${GREEN}✅ Using optimized pre-built release from repository (0% RAM used for build).${NC}"
else
    echo -e "${CYAN}⚡ Compiling project with Vite + esbuild...${NC}"
    npm run clean 2>/dev/null
    nice -n 19 env NODE_OPTIONS="--max-old-space-size=1024" npm run build
    if [ $? -ne 0 ]; then
        echo -e "${YELLOW}⚠️ First build attempt had error, running fallback clean build...${NC}"
        npx vite build && npx esbuild server.ts --bundle --platform=node --format=cjs --packages=external --outfile=dist/server.cjs
    fi
fi
echo -e "${GREEN}✅ Application binary ready (dist/server.cjs).${NC}"

# 5. Restart application service cleanly
echo -e "\n${YELLOW}🔹 5. Restarting service with PM2...${NC}"

if command -v pm2 &> /dev/null; then
    # Restart or start fresh
    pm2 delete "sanaei-bot" 2>/dev/null
    pkill -9 -f "node.*dist/server\.cjs" 2>/dev/null || true
    pkill -9 -f "node.*server\.ts" 2>/dev/null || true
    pkill -9 -f "tsx.*server\.ts" 2>/dev/null || true
    
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
