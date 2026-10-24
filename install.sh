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

do_install_dependencies() {
  echo -e "\n${CYAN}>> Checking system dependencies (Node.js, Git, Build Tools)...${NC}"
  ensure_swap_and_memory
  
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
    echo -e "${GREEN}✅ PM2 is already installed ($(pm2 -v)).${NC}"
  fi
}

do_uninstall() {
  echo -e "\n${RED}⚠️ Stopping bot processes and removing installation files...${NC}"
  
  # Navigate to home/root first so we don't hold lock on working dir
  cd /root 2>/dev/null || cd "$HOME" 2>/dev/null || cd /tmp

  if command -v pm2 &> /dev/null; then
    pm2 stop "sanaei-bot" &> /dev/null
    pm2 delete "sanaei-bot" &> /dev/null
    pm2 save --force &> /dev/null
  fi

  # Kill any stray processes matching server.ts, server.cjs or tsx
  pkill -9 -f "node.*dist/server\.cjs" 2>/dev/null
  pkill -9 -f "node.*server\.ts" 2>/dev/null
  pkill -9 -f "tsx.*server\.ts" 2>/dev/null

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

  echo -e "\n${CYAN}>> Cloning latest repository code from GitHub...${NC}"
  git clone "$GIT_URL" "$DIR_NAME"
  
  if [ ! -d "$DIR_NAME" ]; then
    echo -e "${YELLOW}>> Trying fallback repository...${NC}"
    git clone "$FALLBACK_GIT_URL" "$DIR_NAME"
  fi

  if [ ! -d "$DIR_NAME" ]; then
    echo -e "${RED}❌ Error: Failed to clone repository from GitHub.${NC}"
    echo -e "${YELLOW}Please check your internet connection or verify the repository URL: $GIT_URL${NC}"
    safe_exit 1
  fi

  cd "$DIR_NAME" || safe_exit 1

  echo "PORT=$PANEL_PORT" > .env
  echo "NODE_ENV=production" >> .env
  if [ -n "$PANEL_USER" ] && [ -n "$PANEL_PASS" ]; then
    echo "PANEL_USERNAME=$PANEL_USER" >> .env
    echo "PANEL_PASSWORD=$PANEL_PASS" >> .env
  fi

  echo -e "\n${CYAN}>> Installing project dependencies...${NC}"
  nice -n 19 env NODE_OPTIONS="--max-old-space-size=256" npm install --prefer-offline --no-audit --no-fund --legacy-peer-deps || nice -n 19 env NODE_OPTIONS="--max-old-space-size=256" npm install --no-audit --no-fund

  echo -e "\n${CYAN}>> Building and compiling application (Vite + Node Server)...${NC}"
  npm run clean 2>/dev/null
  nice -n 19 env NODE_OPTIONS="--max-old-space-size=1024" npm run build
  if [ $? -ne 0 ]; then
    echo -e "${YELLOW}⚠️ First build attempt had error, running fallback build...${NC}"
    npx vite build && npx esbuild server.ts --bundle --platform=node --format=cjs --packages=external --outfile=dist/server.cjs
  fi

  echo -e "\n${CYAN}>> Starting bot service with PM2 on port ${PANEL_PORT}...${NC}"
  pm2 delete "sanaei-bot" 2>/dev/null
  PORT=$PANEL_PORT NODE_ENV=production pm2 start dist/server.cjs --name "sanaei-bot" || pm2 start npm --name "sanaei-bot" -- run start
  pm2 save
  pm2 startup

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
  
  TARGET_DIR=""
  if [ -d "$DIR_NAME" ]; then
    TARGET_DIR="$DIR_NAME"
  elif [ -d "Bot-sana" ]; then
    TARGET_DIR="Bot-sana"
  elif [ -f "server.ts" ] || [ -f "package.json" ]; then
    TARGET_DIR="."
  fi

  if [ -z "$TARGET_DIR" ]; then
    echo -e "${RED}❌ Installation directory not found.${NC}"
    echo -e "${YELLOW}Please select Option 1 (Fresh Installation) first.${NC}"
    return
  fi

  if [ "$TARGET_DIR" != "." ]; then
    cd "$TARGET_DIR" || safe_exit 1
  fi

  # Secure backup of current database & env
  if [ -f "db.json" ]; then
    echo -e "${GREEN}📦 Backing up database (db.json)...${NC}"
    cp db.json ../db.json.bak 2>/dev/null || cp db.json /tmp/db.json.bak
  fi
  if [ -f ".env" ]; then
    cp .env ../.env.bak 2>/dev/null || cp .env /tmp/.env.bak
  fi

  echo -e "\n${CYAN}>> Pulling latest updates from Git...${NC}"
  git fetch --all 2>/dev/null || true
  git reset --hard origin/main 2>/dev/null || git reset --hard origin/master 2>/dev/null || true

  # Ensure swap memory is active
  ensure_swap_and_memory

  # Restore state database safely
  if [ -f "../db.json.bak" ]; then
    mv ../db.json.bak db.json
    echo -e "${GREEN}✅ Database and user records restored successfully.${NC}"
  elif [ -f "/tmp/db.json.bak" ]; then
    mv /tmp/db.json.bak db.json
    echo -e "${GREEN}✅ Database and user records restored successfully.${NC}"
  fi

  if [ -f "../.env.bak" ]; then
    mv ../.env.bak .env
  elif [ -f "/tmp/.env.bak" ]; then
    mv /tmp/.env.bak .env
  fi

  echo -e "\n${CYAN}>> Updating dependencies (please wait 30–60 seconds)...${NC}"
  nice -n 19 env NODE_OPTIONS="--max-old-space-size=256" npm install --prefer-offline --no-audit --no-fund --legacy-peer-deps || nice -n 19 env NODE_OPTIONS="--max-old-space-size=256" npm install --no-audit --no-fund

  echo -e "\n${CYAN}>> Rebuilding project with Vite + esbuild...${NC}"
  npm run clean 2>/dev/null
  nice -n 19 env NODE_OPTIONS="--max-old-space-size=1024" npm run build
  if [ $? -ne 0 ]; then
    echo -e "${YELLOW}⚠️ First build attempt had error, running fallback clean build...${NC}"
    npx vite build && npx esbuild server.ts --bundle --platform=node --format=cjs --packages=external --outfile=dist/server.cjs
  fi

  echo -e "\n${CYAN}>> Restarting bot service...${NC}"
  if command -v pm2 &> /dev/null; then
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

    PORT=$PORT_VAL NODE_ENV=production pm2 start dist/server.cjs --name "sanaei-bot" || pm2 start npm --name "sanaei-bot" -- run start
    pm2 save
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

