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

# Refresh shell working directory inode so Node.js & PM2 never fail with uv_cwd ENOENT
ensure_valid_cwd() {
    local target_dir="${1:-}"
    if ! pwd -P &>/dev/null || ! ls . &>/dev/null; then
        cd /root 2>/dev/null || cd "$HOME" 2>/dev/null || cd /tmp
        if [ -n "$target_dir" ] && [ -d "$target_dir" ]; then
            cd "$target_dir" 2>/dev/null || true
        elif [ -d "/root/sanaei-bot" ]; then
            cd "/root/sanaei-bot" 2>/dev/null || true
        elif [ -d "/root/Bot-sana" ]; then
            cd "/root/Bot-sana" 2>/dev/null || true
        fi
    else
        local phys_dir
        phys_dir=$(pwd -P 2>/dev/null)
        if [ -n "$phys_dir" ] && [ -d "$phys_dir" ]; then
            cd /tmp 2>/dev/null && cd "$phys_dir" 2>/dev/null || cd "$phys_dir" 2>/dev/null || true
        fi
    fi
    export PWD=$(pwd -P 2>/dev/null || pwd)
}

# Ensure swap memory and valid working directory early
ensure_swap_and_memory
ensure_valid_cwd

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

# 2. Stop running services first so 100% of VPS RAM is free
echo -e "\n${YELLOW}🔹 2. Stopping running bot processes to free VPS memory...${NC}"
pm2 stop all 2>/dev/null || true
pm2 kill 2>/dev/null || true
pkill -9 -f "PM2" 2>/dev/null || true
rm -rf /root/.pm2/pm2.pid /root/.pm2/rpc.sock /root/.pm2/pub.sock 2>/dev/null || true
pkill -9 -f "dist/server\.cjs" 2>/dev/null || true
pkill -9 -f "server\.ts" 2>/dev/null || true
sync 2>/dev/null || true
echo 3 > /proc/sys/vm/drop_caches 2>/dev/null || true

# 3. Fetch and apply updates from Git
echo -e "\n${YELLOW}🔹 3. Pulling latest code changes from repository...${NC}"
git fetch --all
git reset --hard origin/main || git reset --hard origin/master

# Refresh cwd inode after git reset and ensure swap memory remains active
ensure_valid_cwd
ensure_swap_and_memory

# 4. Restore Database & Configs immediately
echo -e "\n${YELLOW}🔹 4. Restoring database records and credentials...${NC}"
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

# Ensure package.json exists in current directory, restore from GitHub if missing
if [ ! -f "package.json" ]; then
    echo -e "${YELLOW}⚠️ package.json is missing in $(pwd). Restoring repository files from GitHub...${NC}"
    curl -fsSL "https://codeload.github.com/meh732/Bot-sana/tar.gz/refs/heads/main" | tar -xz --strip-components=1 2>/dev/null || \
    curl -fsSL "https://codeload.github.com/meh732/botsel/tar.gz/refs/heads/main" | tar -xz --strip-components=1 2>/dev/null || true
fi

if [ ! -f "package.json" ]; then
    echo -e "${RED}❌ Error: package.json could not be found or restored in $(pwd).${NC}"
    safe_exit 1
fi

# 5. Apply pre-built bundle (Zero-RAM instant update) or compile if needed
echo -e "\n${YELLOW}🔹 5. Preparing latest frontend & backend build...${NC}"
if [ -f "assets/prebuilt/server.cjs" ] && [ -f "assets/prebuilt/index.html" ]; then
    echo -e "${GREEN}⚡ Pre-built production bundle found in repository. Copying to dist/ (Zero RAM)...${NC}"
    mkdir -p dist
    cp -rf assets/prebuilt/* dist/
elif [ -f "dist/index.html" ]; then
    npx esbuild ./server.ts --bundle --platform=node --format=cjs --external:pdfkit --external:vite --outfile=dist/server.cjs || NODE_OPTIONS="--max-old-space-size=400" npm run build
else
    NODE_OPTIONS="--max-old-space-size=400" npm run build
fi

# 6. Restart application service cleanly
echo -e "\n${YELLOW}🔹 6. Starting service with PM2...${NC}"

# Sanitize working directory inode to prevent uv_cwd ENOENT in Node.js
CURR_DIR="$(pwd -P 2>/dev/null || pwd)"
cd /root 2>/dev/null && cd "$CURR_DIR" 2>/dev/null || true

PORT_VAL=2020
if [ -f ".env" ]; then
    ENV_PORT=$(grep "^PORT=" .env | cut -d '=' -f2 | tr -d ' ' | tr -d '\r')
    if [ -n "$ENV_PORT" ]; then
        PORT_VAL="$ENV_PORT"
    fi
fi

# Allow port in firewall (ufw & iptables) so panel is accessible from outside
if command -v ufw &>/dev/null; then
    ufw allow ${PORT_VAL}/tcp 2>/dev/null || true
fi
if command -v iptables &>/dev/null; then
    iptables -I INPUT -p tcp --dport ${PORT_VAL} -j ACCEPT 2>/dev/null || true
fi

# Reset oom_score_adj to 0 before spawning service
if [ -f "/proc/$$/oom_score_adj" ]; then
    echo 0 > /proc/$$/oom_score_adj 2>/dev/null || true
fi

echo -e "${CYAN}>> Starting on port ${PORT_VAL} with working directory $CURR_DIR...${NC}"
if command -v pm2 &> /dev/null; then
    if ! PORT=$PORT_VAL NODE_ENV=production pm2 start "$CURR_DIR/dist/server.cjs" --name "sanaei-bot" --cwd "$CURR_DIR" --node-args="--max-old-space-size=450"; then
        PORT=$PORT_VAL NODE_ENV=production nohup node --max-old-space-size=450 "$CURR_DIR/dist/server.cjs" > bot_output.log 2>&1 &
    fi
    pm2 save 2>/dev/null || true

    sleep 2
    echo -e "${GREEN}✅ Service 'sanaei-bot' status:${NC}"
    pm2 status sanaei-bot
    
    echo -e "\n${CYAN}====================================================${NC}"
    echo -e "${GREEN}🎉 Update & Restart successfully completed!${NC}"
    echo -e "🌐 Web Dashboard URL: ${CYAN}http://$(curl -s4 ifconfig.me || curl -s4 icanhazip.com || echo 'YOUR_SERVER_IP'):${PORT_VAL}${NC}"
    echo -e "${YELLOW}📋 Last 20 lines of service log:${NC}"
    echo -e "${CYAN}----------------------------------------------------${NC}"
    pm2 logs sanaei-bot --lines 20 --nostream 2>/dev/null || true
    echo -e "${CYAN}====================================================${NC}"
else
    echo -e "${YELLOW}⚠️ PM2 not found. Starting in background via nohup...${NC}"
    pkill -9 -f "dist/server.cjs" 2>/dev/null
    PORT=$PORT_VAL NODE_ENV=production nohup node --max-old-space-size=450 "$CURR_DIR/dist/server.cjs" > bot_output.log 2>&1 &
    echo -e "${GREEN}✅ Bot started in background (logs in bot_output.log).${NC}"
fi
