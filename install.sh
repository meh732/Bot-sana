#!/bin/bash

# Safe exit helper: returns safely if script was sourced, preventing SSH terminal close
safe_exit() {
    local code=${1:-0}
    return $code 2>/dev/null || exit $code
}

# Ignore SIGHUP so SSH terminal disconnects never kill the installer/updater process
trap '' HUP 2>/dev/null

# Terminal Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

clear
echo -e "${CYAN}=============================================${NC}"
echo -e "${GREEN}      Sanaei Telegram Bot & Admin Panel      ${NC}"
echo -e "${GREEN}        Automated Installer & Manager        ${NC}"
echo -e "${CYAN}=============================================${NC}"

# Check to see if running as root
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}❌ Please run this script as root (e.g., sudo bash install.sh)${NC}"
  safe_exit 1
fi

GIT_URL="https://github.com/meh732/Bot-sana.git"
FALLBACK_GIT_URL="https://github.com/meh732/botsel.git"
DIR_NAME="sanaei-bot"

show_menu() {
  echo -e "\n${YELLOW}Please select one of the following options:${NC}"
  echo -e "1) ${GREEN}Fresh Installation${NC} - Clean previous install and download full new release"
  echo -e "2) ${BLUE}Update Bot${NC}         - Pull latest Git changes and preserve current database"
  echo -e "3) ${PURPLE}Restart Service${NC}    - Restart bot and rebuild project"
  echo -e "4) ${RED}Uninstall${NC}          - Stop running service and remove all files"
  echo -e "5) ${NC}Exit${NC}"
  echo -e "${CYAN}---------------------------------------------${NC}"
  if [ -c /dev/tty ]; then
    read -p "Enter choice [1-5]: " CHOICE </dev/tty
  else
    read -p "Enter choice [1-5]: " CHOICE
  fi
}

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

do_install_dependencies() {
  echo -e "\n${CYAN}>> Checking system dependencies (Node.js, Git, Build Tools)...${NC}"
  ensure_swap_and_memory
  ensure_valid_cwd
  
  if ! command -v git &> /dev/null || ! command -v curl &> /dev/null; then
    echo -e "${YELLOW}>> Installing Git and Curl...${NC}"
    apt-get update -y && apt-get install -y git curl lsof
  fi

  if ! command -v node &> /dev/null; then
    echo -e "${YELLOW}>> Installing Node.js (v20 LTS)...${NC}"
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
  else
    echo -e "${GREEN}✅ Node.js is already installed ($(node -v)).${NC}"
  fi

  if ! command -v pm2 &> /dev/null; then
    echo -e "${YELLOW}>> Installing PM2 process manager globally...${NC}"
    NODE_OPTIONS="--max-old-space-size=256" npm install -g pm2
  else
    echo -e "${GREEN}✅ PM2 is already installed ($(pm2 -v 2>/dev/null || echo 'ready')).${NC}"
  fi
}

do_uninstall() {
  echo -e "\n${RED}⚠️ Stopping bot processes and removing installation files...${NC}"
  
  # Navigate to home/root first so we don't hold lock on working dir
  cd /root 2>/dev/null || cd "$HOME" 2>/dev/null || cd /tmp
  export PWD=$(pwd -P 2>/dev/null || pwd)

  if command -v pm2 &> /dev/null; then
    pm2 stop "sanaei-bot" &> /dev/null || true
    pm2 delete "sanaei-bot" &> /dev/null || true
    pm2 save --force &> /dev/null || true
    pm2 kill &> /dev/null || true
  fi

  # Kill any stray processes matching server.ts, server.cjs, tsx or stale PM2 daemon
  pkill -9 -f "PM2" 2>/dev/null || true
  pkill -9 -f "node.*dist/server\.cjs" 2>/dev/null || true
  pkill -9 -f "node.*server\.ts" 2>/dev/null || true
  pkill -9 -f "tsx.*server\.ts" 2>/dev/null || true

  # Kill any process on default ports or common ports
  for p in 3000 2020 8080; do
    PID_P=$(lsof -t -i:$p 2>/dev/null)
    if [ -n "$PID_P" ]; then
      kill -9 $PID_P 2>/dev/null
    fi
  done

  rm -rf "$DIR_NAME" "Bot-sana" "botsel" 2>/dev/null
  echo -e "${GREEN}✅ Previous installation files and running processes removed.${NC}"
}

do_fresh_install() {
  echo -e "\n${YELLOW}⚠️ This operation will stop any existing bot and perform a clean installation of '$DIR_NAME'.${NC}"
  if [ -c /dev/tty ]; then
    read -p "Are you sure you want to proceed? (y/n): " confirm </dev/tty
  else
    confirm="y"
  fi
  if [[ $confirm != "y" && $confirm != "Y" ]]; then
    echo -e "${RED}❌ Installation cancelled.${NC}"
    return
  fi

  echo -e "\n${CYAN}=============================================${NC}"
  echo -e "${YELLOW}       Admin & Web Panel Configuration       ${NC}"
  echo -e "${CYAN}=============================================${NC}"
  if [ -c /dev/tty ]; then
    read -p "Enter web panel port [default: 2020]: " PANEL_PORT </dev/tty
    read -p "Enter panel admin username (optional): " PANEL_USER </dev/tty
    read -sp "Enter panel admin password (optional): " PANEL_PASS </dev/tty
    echo ""
  else
    PANEL_PORT="2020"
  fi
  PANEL_PORT=${PANEL_PORT:-2020}

  # Kill port if currently used
  PID_TARGET=$(lsof -t -i:$PANEL_PORT 2>/dev/null)
  if [ -n "$PID_TARGET" ]; then
    kill -9 $PID_TARGET 2>/dev/null
  fi

  do_uninstall
  do_install_dependencies

  cd /root 2>/dev/null || cd "$HOME" 2>/dev/null || cd /tmp
  export PWD=$(pwd -P 2>/dev/null || pwd)

  echo -e "\n${CYAN}>> Cloning latest repository code from GitHub...${NC}"
  rm -rf "$DIR_NAME" 2>/dev/null || true
  git clone "$GIT_URL" "$DIR_NAME" 2>/dev/null || true
  
  if [ ! -f "$DIR_NAME/package.json" ]; then
    echo -e "${YELLOW}>> Trying fallback repository...${NC}"
    rm -rf "$DIR_NAME" 2>/dev/null || true
    git clone "$FALLBACK_GIT_URL" "$DIR_NAME" 2>/dev/null || true
  fi

  if [ ! -f "$DIR_NAME/package.json" ]; then
    echo -e "${YELLOW}>> Trying archive download fallback...${NC}"
    mkdir -p "$DIR_NAME"
    curl -fsSL "https://codeload.github.com/meh732/Bot-sana/tar.gz/refs/heads/main" | tar -xz -C "$DIR_NAME" --strip-components=1 2>/dev/null || \
    curl -fsSL "https://codeload.github.com/meh732/botsel/tar.gz/refs/heads/main" | tar -xz -C "$DIR_NAME" --strip-components=1 2>/dev/null || true
  fi

  if [ ! -f "$DIR_NAME/package.json" ]; then
    echo -e "${RED}❌ Error: Failed to download repository files from GitHub.${NC}"
    echo -e "${YELLOW}Please verify internet connection or GitHub access on this VPS.${NC}"
    safe_exit 1
  fi

  cd "$DIR_NAME" || safe_exit 1
  ensure_valid_cwd "$PWD"

  echo "PORT=$PANEL_PORT" > .env
  echo "NODE_ENV=production" >> .env
  if [ -n "$PANEL_USER" ] && [ -n "$PANEL_PASS" ]; then
    echo "PANEL_USERNAME=$PANEL_USER" >> .env
    echo "PANEL_PASSWORD=$PANEL_PASS" >> .env
  fi

  if [ ! -f "package.json" ]; then
    echo -e "${RED}❌ Error: package.json is missing in $PWD.${NC}"
    safe_exit 1
  fi

  echo -e "\n${CYAN}>> Installing lightweight backend runtime dependencies...${NC}"
  pkill -9 -f "npm install" 2>/dev/null || true
  if ! nice -n 19 env NODE_ENV=production npm install --omit=dev --no-package-lock --no-audit --no-fund; then
    echo -e "${YELLOW}>> Cleaning corrupted node_modules & npm cache and retrying...${NC}"
    rm -rf node_modules package-lock.json /root/.npm ~/.npm 2>/dev/null || true
    npm cache clean --force 2>/dev/null || true
    nice -n 19 env NODE_ENV=production npm install --omit=dev --no-package-lock --no-audit --no-fund
  fi

  ensure_valid_cwd "$PWD"

  # Ensure dist directory exists
  mkdir -p dist

  # If esbuild binary is locally installed, re-bundle server.ts; otherwise use the pre-built dist/server.cjs from repository
  if [ -x "./node_modules/.bin/esbuild" ]; then
    echo -e "\n${CYAN}>> Updating backend bundle with local esbuild...${NC}"
    ./node_modules/.bin/esbuild server.ts --bundle --platform=node --format=cjs --packages=external --outfile=dist/server.cjs || true
  elif [ ! -f "dist/server.cjs" ]; then
    echo -e "\n${CYAN}>> Generating backend bundle with esbuild...${NC}"
    npx --yes esbuild server.ts --bundle --platform=node --format=cjs --packages=external --outfile=dist/server.cjs
  else
    echo -e "${GREEN}✅ Pre-built backend bundle (dist/server.cjs) verified from repository.${NC}"
  fi

  if [ -f "dist/index.html" ]; then
    echo -e "${GREEN}✅ Pre-built frontend release (dist/index.html) verified from repository.${NC}"
  elif [ -x "./node_modules/.bin/vite" ]; then
    nice -n 19 env NODE_OPTIONS="--max-old-space-size=768" ./node_modules/.bin/vite build || true
  fi

  # Allow port in firewall (ufw & iptables) so panel is accessible from outside
  if command -v ufw &>/dev/null; then
    ufw allow ${PANEL_PORT}/tcp 2>/dev/null || true
  fi
  if command -v iptables &>/dev/null; then
    iptables -I INPUT -p tcp --dport ${PANEL_PORT} -j ACCEPT 2>/dev/null || true
  fi

  echo -e "\n${CYAN}>> Starting bot service with PM2 on port ${PANEL_PORT} with working directory $PWD...${NC}"
  # Completely kill stale PM2 daemon and clear stale socket files
  pm2 kill 2>/dev/null || true
  pkill -9 -f "PM2" 2>/dev/null || true
  rm -rf /root/.pm2/pm2.pid /root/.pm2/rpc.sock /root/.pm2/pub.sock 2>/dev/null || true

  # Ensure dist/server.cjs exists before PM2 start
  if [ ! -f "$PWD/dist/server.cjs" ]; then
    echo -e "${YELLOW}>> Recompiling dist/server.cjs with esbuild...${NC}"
    npx --yes esbuild server.ts --bundle --platform=node --format=cjs --packages=external --outfile=dist/server.cjs
  fi

  PORT=$PANEL_PORT NODE_ENV=production pm2 start "$PWD/dist/server.cjs" --name "sanaei-bot" --cwd "$PWD"
  pm2 save 2>/dev/null || true
  pm2 startup 2>/dev/null || true

  sleep 2
  echo -e "${GREEN}✅ PM2 Process Status:${NC}"
  pm2 status sanaei-bot
  pm2 logs sanaei-bot --lines 15 --nostream 2>/dev/null || true

  SERVER_IP=$(curl -s4 ifconfig.me || curl -s4 icanhazip.com || echo "YOUR_SERVER_IP")

  echo -e "\n${GREEN}=============================================${NC}"
  echo -e "${GREEN}🎉 Fresh installation completed successfully!${NC}"
  echo -e "🌐 Web Dashboard URL: ${CYAN}http://${SERVER_IP}:${PANEL_PORT}${NC}"
  echo -e "🔧 View live logs with:"
  echo -e "   ${YELLOW}pm2 logs sanaei-bot${NC}"
  echo -e "${GREEN}=============================================${NC}"
}

do_update() {
  echo -e "\n${CYAN}>> Starting update process...${NC}"
  ensure_swap_and_memory
  ensure_valid_cwd
  
  TARGET_DIR=""
  if [ -f "server.ts" ] && [ -f "package.json" ]; then
    TARGET_DIR="$(pwd -P)"
  elif [ -d "/root/$DIR_NAME" ]; then
    TARGET_DIR="/root/$DIR_NAME"
  elif [ -d "$DIR_NAME" ]; then
    TARGET_DIR="$DIR_NAME"
  elif [ -d "/root/Bot-sana" ]; then
    TARGET_DIR="/root/Bot-sana"
  elif [ -d "Bot-sana" ]; then
    TARGET_DIR="Bot-sana"
  fi

  if [ -z "$TARGET_DIR" ]; then
    echo -e "${RED}❌ Installation directory not found.${NC}"
    echo -e "${YELLOW}Please select Option 1 (Fresh Installation) first.${NC}"
    return
  fi

  cd "$TARGET_DIR" || safe_exit 1
  ensure_valid_cwd "$TARGET_DIR"

  # Secure backup of current database & env
  if [ -f "db.json" ]; then
    echo -e "${GREEN}📦 Backing up database (db.json)...${NC}"
    cp db.json /tmp/db.json.bak 2>/dev/null || cp db.json ../db.json.bak 2>/dev/null
  fi
  if [ -f ".env" ]; then
    cp .env /tmp/.env.bak 2>/dev/null || cp .env ../.env.bak 2>/dev/null
  fi

  echo -e "\n${CYAN}>> Pulling latest updates from Git...${NC}"
  git fetch --all 2>/dev/null || true
  git reset --hard origin/main 2>/dev/null || git reset --hard origin/master 2>/dev/null || true

  # Refresh cwd inode after git reset and ensure swap memory is active
  ensure_valid_cwd "$TARGET_DIR"
  ensure_swap_and_memory

  # Restore state database safely
  if [ -f "/tmp/db.json.bak" ]; then
    cp /tmp/db.json.bak db.json
    echo -e "${GREEN}✅ Database and user records restored successfully.${NC}"
  elif [ -f "../db.json.bak" ]; then
    cp ../db.json.bak db.json
    echo -e "${GREEN}✅ Database and user records restored successfully.${NC}"
  fi

  if [ -f "/tmp/.env.bak" ]; then
    cp /tmp/.env.bak .env
  elif [ -f "../.env.bak" ]; then
    cp ../.env.bak .env
  fi

  # Ensure package.json exists before attempting npm operations
  if [ ! -f "package.json" ]; then
    echo -e "${YELLOW}⚠️ package.json is missing in $TARGET_DIR. Restoring repository files...${NC}"
    curl -fsSL "https://codeload.github.com/meh732/Bot-sana/tar.gz/refs/heads/main" | tar -xz --strip-components=1 2>/dev/null || \
    curl -fsSL "https://codeload.github.com/meh732/botsel/tar.gz/refs/heads/main" | tar -xz --strip-components=1 2>/dev/null || true
  fi

  if [ ! -f "package.json" ]; then
    echo -e "${RED}❌ Error: package.json could not be found or restored in $TARGET_DIR.${NC}"
    safe_exit 1
  fi

  # 4. Handle runtime dependencies safely (skip heavy frontend devDependencies since dist/ is pre-built)
  pkill -9 -f "npm install" 2>/dev/null || true
  if [ ! -d "node_modules/express" ] || [ ! -d "node_modules/node-telegram-bot-api" ] || [ ! -d "node_modules/pdfkit" ] || [ ! -d "node_modules/qrcode" ]; then
    echo -e "\n${CYAN}>> Installing lightweight backend runtime packages...${NC}"
    if ! nice -n 19 env NODE_ENV=production npm install --omit=dev --no-package-lock --no-audit --no-fund; then
      echo -e "${YELLOW}>> Cleaning corrupted node_modules & npm cache and retrying...${NC}"
      rm -rf node_modules package-lock.json /root/.npm ~/.npm 2>/dev/null || true
      npm cache clean --force 2>/dev/null || true
      nice -n 19 env NODE_ENV=production npm install --omit=dev --no-package-lock --no-audit --no-fund
    fi
  else
    echo -e "${GREEN}✅ Backend runtime dependencies verified (skipping heavy re-install).${NC}"
  fi

  ensure_valid_cwd "$TARGET_DIR"

  # 5. Verify pre-built dist/server.cjs and dist/index.html from repository
  mkdir -p dist
  if [ -x "./node_modules/.bin/esbuild" ]; then
    echo -e "\n${CYAN}>> Updating server bundle with local esbuild...${NC}"
    ./node_modules/.bin/esbuild server.ts --bundle --platform=node --format=cjs --packages=external --outfile=dist/server.cjs || true
  elif [ ! -f "dist/server.cjs" ]; then
    echo -e "\n${CYAN}>> Generating backend bundle with esbuild...${NC}"
    npx --yes esbuild server.ts --bundle --platform=node --format=cjs --packages=external --outfile=dist/server.cjs
  else
    echo -e "${GREEN}✅ Latest pre-built server bundle (dist/server.cjs) loaded from repository.${NC}"
  fi

  if [ -f "dist/index.html" ]; then
    echo -e "${GREEN}✅ Pre-built frontend release (dist/index.html) verified from repository.${NC}"
  fi

  ensure_valid_cwd "$TARGET_DIR"

  echo -e "\n${CYAN}>> Restarting bot service with PM2...${NC}"
  if command -v pm2 &> /dev/null; then
    # If PM2 daemon itself has a broken cwd (uv_cwd error), kill and respawn PM2 daemon cleanly
    if ! pm2 ping &>/dev/null; then
      echo -e "${YELLOW}ℹ️ Resetting stale PM2 daemon...${NC}"
      pkill -9 -f "PM2" 2>/dev/null || true
    fi
    pm2 delete "sanaei-bot" 2>/dev/null || true
    pkill -9 -f "node.*dist/server\.cjs" 2>/dev/null || true
    pkill -9 -f "node.*server\.ts" 2>/dev/null || true
    pkill -9 -f "tsx.*server\.ts" 2>/dev/null || true

    PORT_VAL=2020
    if [ -f ".env" ]; then
      ENV_PORT=$(grep "^PORT=" .env | cut -d '=' -f2 | tr -d ' ' | tr -d '\r')
      if [ -n "$ENV_PORT" ]; then
        PORT_VAL="$ENV_PORT"
      fi
    fi

    echo -e "${CYAN}>> Starting on port ${PORT_VAL} with working directory $PWD...${NC}"
    PORT=$PORT_VAL NODE_ENV=production pm2 start "$PWD/dist/server.cjs" --name "sanaei-bot" --cwd "$PWD" || pm2 start npm --name "sanaei-bot" --cwd "$PWD" -- run start
    pm2 save 2>/dev/null || true
  else
    pkill -9 -f "dist/server.cjs" 2>/dev/null || true
    nohup npm start > bot_output.log 2>&1 &
  fi

  echo -e "\n${GREEN}=============================================${NC}"
  echo -e "${GREEN}🎉 Update completed successfully!${NC}"
  echo -e "🔧 View live logs with: ${YELLOW}pm2 logs sanaei-bot${NC}"
  echo -e "${GREEN}=============================================${NC}"
}

do_restart() {
  echo -e "\n${CYAN}>> Restarting bot service...${NC}"
  if [ -f "./restart.sh" ]; then
    bash ./restart.sh
  elif [ -f "../restart.sh" ]; then
    bash ../restart.sh
  elif command -v pm2 &> /dev/null; then
    pm2 restart "sanaei-bot"
    echo -e "${GREEN}✅ Bot service restarted under PM2.${NC}"
  else
    echo -e "${RED}❌ Unable to find restart script or PM2.${NC}"
  fi
}

pause_and_continue() {
  echo ""
  if [ -c /dev/tty ]; then
    read -p "Press [Enter] to return to menu..." _dummy </dev/tty || true
  else
    read -p "Press [Enter] to return to menu..." _dummy || true
  fi
}

execute_action() {
  local action="$1"
  case $action in
    1|install|fresh)
      do_fresh_install
      ;;
    2|update)
      do_update
      ;;
    3|restart)
      do_restart
      ;;
    4|uninstall)
      do_uninstall
      echo -e "${GREEN}✅ All files and processes removed successfully.${NC}"
      ;;
    5|exit)
      echo -e "${YELLOW}Exiting.${NC}"
      safe_exit 0
      ;;
    *)
      echo -e "${RED}❌ Invalid selection: '$action'. Please enter a number from 1 to 5.${NC}"
      ;;
  esac
}

# Main Execution Flow
CLI_ARG="${1:-}"

if [ -n "$CLI_ARG" ]; then
  # Non-interactive CLI argument mode
  execute_action "$CLI_ARG"
  safe_exit 0
fi

# Interactive Loop: never closes terminal abruptly
while true; do
  show_menu
  if [ "$CHOICE" = "5" ] || [ "$CHOICE" = "exit" ]; then
    echo -e "${YELLOW}Exiting.${NC}"
    safe_exit 0
  fi
  execute_action "$CHOICE"
  pause_and_continue
done

