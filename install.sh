#!/bin/bash

# Terminal Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
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
  exit 1
fi

GIT_URL="https://github.com/meh732/botsel.git"
FALLBACK_GIT_URL="https://github.com/meh732/Bot-sana.git"
DIR_NAME="sanaei-bot"

show_menu() {
  echo -e "\n${YELLOW}Please select one of the following options:${NC}"
  echo -e "1) ${GREEN}Fresh Installation${NC} - Clean previous install and download full new release"
  echo -e "2) ${BLUE}Update Bot${NC}         - Pull latest Git changes and preserve current database"
  echo -e "3) ${PURPLE}Restart Service${NC}    - Restart bot and rebuild project"
  echo -e "4) ${RED}Uninstall${NC}          - Stop running service and remove all files"
  echo -e "5) ${NC}Exit${NC}"
  echo -e "${CYAN}---------------------------------------------${NC}"
  read -p "Enter choice [1-5]: " CHOICE
}

do_install_dependencies() {
  echo -e "\n${CYAN}>> Checking system dependencies (Node.js, Git, Build Tools)...${NC}"
  
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
    npm install -g pm2
  else
    echo -e "${GREEN}✅ PM2 is already installed ($(pm2 -v)).${NC}"
  fi
}

do_uninstall() {
  echo -e "\n${RED}⚠️ Stopping bot processes and removing installation files...${NC}"
  if command -v pm2 &> /dev/null; then
    pm2 stop "sanaei-bot" &> /dev/null
    pm2 delete "sanaei-bot" &> /dev/null
    pm2 save --force &> /dev/null
  fi

  # Kill any stray port 3000 processes
  PID_3000=$(lsof -t -i:3000 2>/dev/null)
  if [ ! -z "$PID_3000" ]; then
    kill -9 $PID_3000 2>/dev/null
  fi

  if [ -d "$DIR_NAME" ]; then
    rm -rf "$DIR_NAME"
    echo -e "${GREEN}✅ Directory '$DIR_NAME' and all associated files have been removed.${NC}"
  elif [ -d "Bot-sana" ]; then
    rm -rf "Bot-sana"
    echo -e "${GREEN}✅ Directory 'Bot-sana' removed.${NC}"
  else
    echo -e "${YELLOW}ℹ️ Installation directory not found (already clean).${NC}"
  fi
}

do_fresh_install() {
  echo -e "\n${YELLOW}⚠️ This operation will stop any existing bot and overwrite '$DIR_NAME'.${NC}"
  read -p "Are you sure you want to proceed? (y/n): " confirm
  if [[ $confirm != "y" && $confirm != "Y" ]]; then
    echo -e "${RED}❌ Installation cancelled.${NC}"
    return
  fi

  echo -e "\n${CYAN}=============================================${NC}"
  echo -e "${YELLOW}       Admin & Web Panel Configuration       ${NC}"
  echo -e "${CYAN}=============================================${NC}"
  read -p "Enter web panel port [default: 3000]: " PANEL_PORT
  PANEL_PORT=${PANEL_PORT:-3000}
  
  read -p "Enter panel admin username (optional): " PANEL_USER
  read -sp "Enter panel admin password (optional): " PANEL_PASS
  echo ""

  do_uninstall
  do_install_dependencies

  echo -e "\n${CYAN}>> Cloning latest repository code...${NC}"
  git clone "$GIT_URL" "$DIR_NAME" 2>/dev/null || git clone "$FALLBACK_GIT_URL" "$DIR_NAME"
  
  if [ ! -d "$DIR_NAME" ]; then
    echo -e "${RED}❌ Error: Failed to clone repository from GitHub.${NC}"
    echo -e "${YELLOW}Please check your internet connection or verify the repository URL.${NC}"
    exit 1
  fi

  cd "$DIR_NAME" || exit 1

  echo "PORT=$PANEL_PORT" > .env
  if [ -n "$PANEL_USER" ] && [ -n "$PANEL_PASS" ]; then
    echo "PANEL_USERNAME=$PANEL_USER" >> .env
    echo "PANEL_PASSWORD=$PANEL_PASS" >> .env
  fi

  echo -e "\n${CYAN}>> Installing project dependencies...${NC}"
  npm install

  echo -e "\n${CYAN}>> Building and compiling application...${NC}"
  npm run build

  echo -e "\n${CYAN}>> Starting bot service with PM2...${NC}"
  pm2 start npm --name "sanaei-bot" -- run start
  pm2 save
  pm2 startup

  echo -e "\n${GREEN}=============================================${NC}"
  echo -e "${GREEN}🎉 Fresh installation completed successfully!${NC}"
  echo -e "🌐 Web Dashboard URL: ${CYAN}http://YOUR_SERVER_IP:${PANEL_PORT}${NC}"
  echo -e "🔧 View live logs with:"
  echo -e "   ${YELLOW}pm2 logs sanaei-bot${NC}"
  echo -e "${GREEN}=============================================${NC}"
}

do_update() {
  echo -e "\n${CYAN}>> Starting update process...${NC}"
  
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
    cd "$TARGET_DIR" || exit 1
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
  git fetch --all
  git reset --hard origin/main || git reset --hard origin/master

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

  echo -e "\n${CYAN}>> Updating dependencies...${NC}"
  npm install

  echo -e "\n${CYAN}>> Rebuilding project...${NC}"
  npm run build

  echo -e "\n${CYAN}>> Restarting bot service...${NC}"
  if command -v pm2 &> /dev/null && pm2 describe "sanaei-bot" &> /dev/null; then
    pm2 restart "sanaei-bot"
  else
    pm2 start npm --name "sanaei-bot" -- run start
    pm2 save
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

show_menu

case $CHOICE in
  1)
    do_fresh_install
    ;;
  2)
    do_update
    ;;
  3)
    do_restart
    ;;
  4)
    do_uninstall
    echo -e "${GREEN}✅ All files and processes removed successfully.${NC}"
    ;;
  5)
    echo -e "${YELLOW}Exiting.${NC}"
    exit 0
    ;;
  *)
    echo -e "${RED}❌ Invalid selection. Please enter a number from 1 to 5.${NC}"
    exit 1
    ;;
esac
