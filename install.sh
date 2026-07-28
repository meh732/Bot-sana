#!/bin/bash

# Define beautiful terminal colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

clear
echo -e "${CYAN}=============================================${NC}"
echo -e "${GREEN}      مدیریت و نصب ربات تلگرام سنایی (X-UI)       ${NC}"
echo -e "${CYAN}=============================================${NC}"

# Check to see if running as root
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}❌ لطفاً اسکریپت را به عنوان کاربر root اجرا کنید (مثال: sudo bash install.sh)${NC}"
  exit 1
fi

GIT_URL="https://github.com/meh732/botsel.git"
DIR_NAME="botsel"

show_menu() {
  echo -e "\n${YELLOW}لطفاً یکی از گزینه‌های زیر را انتخاب نمایید:${NC}"
  echo -e "1) ${GREEN}نصب جدید و تمیز (Fresh Install)${NC} - پاک کردن نسخه قبلی و دانلود و نصب کانفیگ کامل جدید"
  echo -e "2) ${BLUE}بروزرسانی ربات (Update)${NC} - کشیدن آخرین تغییرات گیت و حفظ فایل دیتابیس فعلی"
  echo -e "3) ${RED}حذف کامل از سرور (Uninstall)${NC} - متوقف کردن ربات زنده و پاک کردن کامل بقیه فایل‌ها"
  echo -e "4) ${NC}خروج (Exit)${NC}"
  echo -e "${CYAN}---------------------------------------------${NC}"
  read -p "عدد گزینه دلخواه را وارد کنید [1-4]: " CHOICE
}

do_install_dependencies() {
  echo -e "\n${CYAN}>> در حال بررسی و پیش‌نیازهای سیستمی (Node.js & Git)...${NC}"
  if ! command -v node &> /dev/null; then
    echo -e "${YELLOW}>> در حال نصب و پیکربندی Node.js...${NC}"
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs git
  else
    echo -e "${GREEN}✅ Node.js از قبل روی سرور شما نصب است.${NC}"
  fi

  if ! command -v pm2 &> /dev/null; then
    echo -e "${YELLOW}>> در حال نصب سراسری ابزار PM2 جهت مدیریت فرآیندها...${NC}"
    npm install -g pm2
  else
    echo -e "${GREEN}✅ PM2 از قبل روی سرور شما نصب است.${NC}"
  fi
}

do_uninstall() {
  echo -e "\n${RED}⚠️ در حال توقف فعالیت ربات و حذف کامل اطلاعات...${NC}"
  if command -v pm2 &> /dev/null; then
    pm2 stop "sanaei-bot" &> /dev/null
    pm2 delete "sanaei-bot" &> /dev/null
    pm2 save --force &> /dev/null
  fi

  if [ -d "$DIR_NAME" ]; then
    rm -rf "$DIR_NAME"
    echo -e "${GREEN}✅ دایرکتوری $DIR_NAME با تمامی اطلاعات مربوطه حذف شد.${NC}"
  else
    echo -e "${YELLOW}ℹ️ دایرکتوری نصب یافت نشد و از قبل پاک شده است.${NC}"
  fi
}

do_fresh_install() {
  echo -e "\n${YELLOW}⚠️ این کار فرآیند اجرای قبلی ربات را متوقف کرده و پوشه $DIR_NAME را بازنویسی می‌کند.${NC}"
  read -p "آیا مطمئن هستید؟ (y/n): " confirm
  if [[ $confirm != "y" && $confirm != "Y" ]]; then
    echo -e "${RED}❌ عملیات تعلیق شد.${NC}"
    return
  fi

  echo -e "\n${CYAN}=============================================${NC}"
  echo -e "${YELLOW}پیکربندی مدیر و پنل${NC}"
  echo -e "${CYAN}=============================================${NC}"
  read -p "پورت دلخواه جهت اجرای پنل وب [پیش‌فرض 3000]: " PANEL_PORT
  PANEL_PORT=${PANEL_PORT:-3000}
  
  read -p "نام کاربری جهت ورود به پنل ربات (توصیه می‌شود وارد کنید): " PANEL_USER
  read -sp "کلمه عبور جهت ورود به پنل ربات: " PANEL_PASS
  echo ""

  do_uninstall
  do_install_dependencies

  echo -e "\n${CYAN}>> در حال دریافت کدهای جدید ربات از گیت‌هاب...${NC}"
  git clone "$GIT_URL" "$DIR_NAME"
  
  if [ ! -d "$DIR_NAME" ]; then
    echo -e "${RED}❌ خطای بزرگ: دریافت مخزن از گیت‌هاب با خطا مواجه شد.${NC}"
    exit 1
  fi

  cd "$DIR_NAME"

  echo "PORT=$PANEL_PORT" > .env
  if [ -n "$PANEL_USER" ] && [ -n "$PANEL_PASS" ]; then
    echo "PANEL_USERNAME=$PANEL_USER" >> .env
    echo "PANEL_PASSWORD=$PANEL_PASS" >> .env
  fi

  echo -e "\n${CYAN}>> در حال نصب کردن پکیج‌های پیش نیاز پروژه...${NC}"
  npm install

  echo -e "\n${CYAN}>> در حال ساخت و کامپایل کردن پروژه...${NC}"
  npm run build

  echo -e "\n${CYAN}>> در حال استارت و راه‌اندازی ربات در پس‌زمینه...${NC}"
  pm2 start npm --name "sanaei-bot" -- run start
  pm2 save
  pm2 startup

  echo -e "\n${GREEN}=============================================${NC}"
  echo -e "${GREEN}🎉 نصب جدید با موفقیت به پایان رسید!${NC}"
  echo -e "🌐 آدرس پنل مانیتورینگ شما: ${CYAN}http://YOUR_SERVER_IP:${PANEL_PORT}${NC}"
  echo -e "🔧 جهت مشاهده لاگ‌ها دستور زیر را وارد کنید:"
  echo -e "   ${YELLOW}pm2 logs sanaei-bot${NC}"
  echo -e "${GREEN}=============================================${NC}"
}

do_update() {
  echo -e "\n${CYAN}>> در حال شروع فرآیند بروزرسانی و آپدیت...${NC}"
  if [ ! -d "$DIR_NAME" ]; then
    echo -e "${RED}❌ دایرکتوری نصب ($DIR_NAME) یافت نشد.${NC}"
    echo -e "${YELLOW}ابتدا باید گزینه ۱ (نصب جدید) را انتخاب کنید.${NC}"
    return
  fi

  cd "$DIR_NAME"

  # Secure backup of current db.json in temporary directory just in case
  if [ -f "db.json" ]; then
    echo -e "${GREEN}📦 در حال تهیه فایل پشتیبان موقت از دیتابیس فعلی کاربران...${NC}"
    cp db.json ../db.json.bak
  fi
  if [ -f ".env" ]; then
    cp .env ../.env.bak
  fi

  echo -e "\n${CYAN}>> در حال دریافت جدیدترین آپدیت‌ها از سرور گیت‌هاب...${NC}"
  git fetch --all
  git reset --hard origin/main || git reset --hard origin/master

  # Restore state database safely
  if [ -f "../db.json.bak" ]; then
    mv ../db.json.bak db.json
    echo -e "${GREEN}✅ دیتابیس و اطلاعات کاربران با موفقیت بازیابی شد.${NC}"
  fi
  if [ -f "../.env.bak" ]; then
    mv ../.env.bak .env
  fi

  echo -e "\n${CYAN}>> در حال نصب پکیج‌های جدید احتمالی...${NC}"
  npm install

  echo -e "\n${CYAN}>> در حال کامپایل نهایی لایه‌های سیستم...${NC}"
  npm run build

  echo -e "\n${CYAN}>> در حال راه اندازی مجدد پروسه ربات...${NC}"
  if command -v pm2 &> /dev/null && pm2 describe "sanaei-bot" &> /dev/null; then
    pm2 restart "sanaei-bot"
  else
    pm2 start npm --name "sanaei-bot" -- run start
    pm2 save
  fi

  echo -e "\n${GREEN}=============================================${NC}"
  echo -e "${GREEN}🎉 بروزرسانی با موفقیت کامل شد و فایل‌های جدید جایگذاری شدند!${NC}"
  echo -e "🔧 جهت مشاهده لاگ‌های ربات: ${YELLOW}pm2 logs sanaei-bot${NC}"
  echo -e "${GREEN}=============================================${NC}"
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
    do_uninstall
    echo -e "${GREEN}✅ تمامی فایل‌ها و فرآیندها با موفقیت از سرور حذف شدند.${NC}"
    ;;
  4)
    echo -e "${YELLOW}خروج از اسکریپت.${NC}"
    exit 0
    ;;
  *)
    echo -e "${RED}❌ انتخاب نامعتبر است! لطفا یک گزینه بین ۱ تا ۴ وارد کنید.${NC}"
    exit 1
    ;;
esac
